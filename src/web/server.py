"""FastAPI web app for the Region Sync tools.

Serves two static pages (DB diff and parameter/secret diff) plus a JSON API.
"""

from __future__ import annotations

import os
import threading
import webbrowser
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..config import Config
from ..logger import info
from ..sync import db_objects as obj
from ..sync import ddl
from ..sync import diff as db_diff
from ..sync import exec as syncexec
from ..sync import params as p
from ..sync.conn import SyncError, connect

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(
    title="Yappy Region Sync",
    description="Diff de DB (tablas/SP) y de parámetros SSM/Secrets entre ambientes (B → A)",
    version="2.0.0",
)

_PAGES = {
    "/": "index.html",
    "/db-diff": "db-diff.html",
    "/params-diff": "params-diff.html",
    "/compile": "compile.html",
}

for _route, _fname in _PAGES.items():
    app.get(_route, response_class=FileResponse, include_in_schema=False)(
        lambda f=_fname: FileResponse(str(STATIC_DIR / f))
    )

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class DbDiffRequest(BaseModel):
    env_a: str
    env_b: str
    schema_name: str
    object_type: str  # "table" | "procedure"
    object_name: str


class ParamsDiffRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    name: str


class ExecuteRequest(BaseModel):
    env: str
    object_type: str  # "table" | "procedure"
    schema_name: str = ""
    code: str


def _env_cfg(env: str) -> Config:
    if env not in Config.known_environments():
        raise HTTPException(status_code=400, detail=f"Ambiente desconocido: '{env}'")
    try:
        return Config.with_env(env)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/envs")
def api_envs():
    config_dir = Config._get_config_dir()
    found = Config.known_environments()
    environments = []
    for env in found:
        entry = {"env": env, "region": None, "profile": None, "load_error": None}
        try:
            cfg = Config.with_env(env)
            entry["region"] = cfg.region
            entry["profile"] = cfg.profile
        except Exception as exc:
            # Never drop an environment: keep it visible and explain the failure.
            entry["load_error"] = str(exc)
        environments.append(entry)
    return {
        "config_dir": str(config_dir),
        "override_set": bool(os.environ.get("YAPPY_CONFIG_DIR")),
        "environments": environments,
    }


def _table_structure(conn, schema: str, name: str):
    return (
        obj.table_columns(conn, schema, name),
        obj.table_indexes(conn, schema, name),
    )


@app.post("/api/db/diff")
def api_db_diff(req: DbDiffRequest):
    if req.env_a == req.env_b:
        raise HTTPException(status_code=400, detail="env_a y env_b deben ser distintos")
    if req.object_type not in ("table", "procedure"):
        raise HTTPException(status_code=400, detail="object_type debe ser 'table' o 'procedure'")

    cfg_a = _env_cfg(req.env_a)
    cfg_b = _env_cfg(req.env_b)

    try:
        with connect(cfg_a) as conn_a, connect(cfg_b) as conn_b:
            schema, name = req.schema_name, req.object_name

            if req.object_type == "procedure":
                code_a = obj.show_create_procedure(conn_a, schema, name)
                code_b = obj.show_create_procedure(conn_b, schema, name)
                col_ops, index_ops = [], []
            else:
                code_a = obj.show_create_table(conn_a, schema, name)
                code_b = obj.show_create_table(conn_b, schema, name)
                cols_a, idx_a = _table_structure(conn_a, schema, name)
                cols_b, idx_b = _table_structure(conn_b, schema, name)
                col_ops, index_ops = db_diff.diff_tables(cols_a, cols_b, idx_a, idx_b)

            if code_a is None and code_b is None:
                status = "none"
                script = None
                notes = ["El objeto no existe en ninguna de las dos regiones."]
            elif code_a is None:
                status = "missing_in_a"
                if req.object_type == "procedure":
                    script = ddl.create_procedure_script(code_b)
                else:
                    script = ddl.create_table_script(code_b)
                notes = [f"Existe solo en {req.env_b} — debe crearse en {req.env_a}."]
            elif code_b is None:
                status = "missing_in_b"
                script = None
                notes = [
                    f"Existe en {req.env_a} pero no en {req.env_b} — "
                    "no hay nada que sincronizar (B→A)."
                ]
            elif (
                obj.normalize_ddl(code_a) == obj.normalize_ddl(code_b)
                and not col_ops
                and not index_ops
            ):
                status = "equal"
                script = None
                notes = ["Sin cambios."]
            else:
                status = "different"
                if req.object_type == "procedure":
                    script = ddl.replace_procedure_script(code_b)
                    notes = [
                        "El stored procedure difiere — se regenera con "
                        "CREATE OR REPLACE (Aurora MySQL 3 / MySQL 8; "
                        "para MySQL 5.7 ejecutar DROP + CREATE)."
                    ]
                else:
                    script = ddl.alter_table_script(schema, name, col_ops, index_ops)
                    if not script:
                        notes = [
                            "El texto del DDL difiere pero la estructura "
                            "(columnas e índices) es idéntica "
                            "(p. ej. contador AUTO_INCREMENT)."
                        ]
                    else:
                        notes = ["La tabla difiere — se aplicaron los cambios de columnas e índices."]

            return {
                "env_a": req.env_a,
                "env_b": req.env_b,
                "object_type": req.object_type,
                "schema_name": schema,
                "object_name": name,
                "status": status,
                "code_a": code_a,
                "code_b": code_b,
                "script": script,
                "notes": notes,
            }
    except SyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de base de datos: {exc}") from exc


@app.post("/api/params/diff")
def api_params_diff(req: ParamsDiffRequest):
    if req.env_a == req.env_b:
        raise HTTPException(status_code=400, detail="env_a y env_b deben ser distintos")
    if req.service not in ("ssm", "secretsmanager"):
        raise HTTPException(status_code=400, detail="service debe ser 'ssm' o 'secretsmanager'")

    cfg_a = _env_cfg(req.env_a)
    cfg_b = _env_cfg(req.env_b)

    try:
        result = p.diff_params(cfg_a, cfg_b, req.service, req.name, req.env_a, req.env_b)
        return result.to_dict()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de AWS: {exc}") from exc


@app.post("/api/execute/sql")
def api_execute_sql(req: ExecuteRequest):
    if req.object_type not in ("table", "procedure"):
        raise HTTPException(status_code=400, detail="object_type debe ser 'table' o 'procedure'")
    if not req.code or not req.code.strip():
        raise HTTPException(status_code=400, detail="El código a ejecutar no puede estar vacío.")

    cfg = _env_cfg(req.env)

    try:
        results = syncexec.execute_sql(cfg, req.schema_name.strip(), req.code)
    except syncexec.SyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de base de datos: {exc}") from exc

    return {
        "env": req.env,
        "object_type": req.object_type,
        "schema_name": req.schema_name,
        "results": [r.__dict__ for r in results],
        "ok_count": sum(1 for r in results if r.ok),
        "err_count": sum(1 for r in results if not r.ok),
    }


def run(host: str = "127.0.0.1", port: int = 8000, open_browser: bool = True) -> None:
    """Start the Region Sync web UI (blocking)."""
    import uvicorn

    config_dir = Config._get_config_dir()
    envs = Config.known_environments()
    if os.environ.get("YAPPY_CONFIG_DIR"):
        info(
            f"YAPPY_CONFIG_DIR override activo: "
            f"{os.environ['YAPPY_CONFIG_DIR']} -> {config_dir}"
        )
    if not config_dir.is_dir() or not envs:
        info(
            "ADVERTENCIA: no se encontraron ambientes. "
            f"Config dir resuelto: {config_dir}. "
            "Si las regiones están en otra carpeta, exportá YAPPY_CONFIG_DIR=<ruta>/config."
        )
    else:
        info(f"Config dir: {config_dir}")
        info(f"Ambientes: {', '.join(envs)}")

    url = f"http://{host}:{port}"
    info(f"Region Sync web -> {url}")
    if open_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run()