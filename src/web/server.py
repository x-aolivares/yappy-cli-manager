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
    description="Diff de DB (tablas/SP) y de parámetros SSM/Secrets entre regiones de origen y destino",
    version="2.0.0",
)

_PAGES = {
    "/": "index.html",
    "/db-diff": "db-diff.html",
    "/params-diff": "params-diff.html",
    "/params-read": "params-read.html",
    "/params-create": "params-create.html",
    "/params-edit": "params-edit.html",
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
    include_deletes: bool = False


class ParamsDiffRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    name: str
    include_deletes: bool = False


class ApplyParamsRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    name: str
    new_value: str
    value_type: str = "String"


class ExecuteParamsRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    op: str = "update"  # "update" | "delete"
    name: str
    new_value: str = ""
    value_type: str = "String"
    confirm: bool = False


class CreateMultiParamsRequest(BaseModel):
    name: str
    value: str = ""
    value_type: str = "String"
    envs: list[str] = []
    create_secret: bool = False
    dry_run: bool = False
    confirm: bool = False


class ExecuteRequest(BaseModel):
    env: str
    object_type: str  # "table" | "procedure"
    schema_name: str = ""
    code: str


class ReadParamsEntry(BaseModel):
    key: str = ""
    name: str = ""
    is_secret: bool = False


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
                if req.include_deletes:
                    script = (
                        ddl.drop_procedure_script(schema, name)
                        if req.object_type == "procedure"
                        else ddl.drop_table_script(schema, name)
                    )
                    notes = [
                        f"Existe en {req.env_a} (destino) pero no en {req.env_b} (origen) — "
                        "se elimina para que la región destino quede igual a la de origen."
                    ]
                else:
                    script = None
                    notes = [
                        f"Existe en {req.env_a} (destino) pero no en {req.env_b} (origen) — "
                        "no hay nada que sincronizar (origen → destino). "
                        "Marcá la opción 'Incluir eliminaciones' para generar el DROP."
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
        result = p.diff_params(
            cfg_a, cfg_b, req.service, req.name, req.env_a, req.env_b,
            include_deletes=req.include_deletes,
        )
        return result.to_dict()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de AWS: {exc}") from exc


@app.post("/api/params/apply")
def api_params_apply(req: ApplyParamsRequest):
    if req.env_a == req.env_b:
        raise HTTPException(status_code=400, detail="env_a y env_b deben ser distintos")
    if req.service not in ("ssm", "secretsmanager"):
        raise HTTPException(status_code=400, detail="service debe ser 'ssm' o 'secretsmanager'")

    cfg_a = _env_cfg(req.env_a)
    _env_cfg(req.env_b)

    script = (
        p.build_ssm_script(req.name, req.new_value, req.value_type, cfg_a)
        if req.service == "ssm"
        else p.build_secret_script(req.name, req.new_value, cfg_a)
    )
    return {
        "env_a": req.env_a,
        "env_b": req.env_b,
        "service": req.service,
        "name": req.name,
        "script": script,
    }


@app.post("/api/params/apply-execute")
def api_params_apply_execute(req: ExecuteParamsRequest):
    if req.env_a == req.env_b:
        raise HTTPException(status_code=400, detail="env_a y env_b deben ser distintos")
    if req.service not in ("ssm", "secretsmanager"):
        raise HTTPException(status_code=400, detail="service debe ser 'ssm' o 'secretsmanager'")
    if req.op not in ("update", "delete"):
        raise HTTPException(status_code=400, detail="op debe ser 'update' o 'delete'")
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Se requiere confirmación explícita para ejecutar.")

    cfg_a = _env_cfg(req.env_a)
    _env_cfg(req.env_b)

    try:
        if req.service == "ssm":
            result = (
                p.put_parameter(cfg_a, req.name, req.new_value, req.value_type)
                if req.op == "update"
                else p.delete_parameter(cfg_a, req.name)
            )
        else:
            result = (
                p.update_secret(cfg_a, req.name, req.new_value)
                if req.op == "update"
                else p.delete_secret(cfg_a, req.name)
            )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de ejecución: {exc}") from exc

    return {
        "ok": True,
        "message": result["message"],
        "env_a": req.env_a,
        "env_b": req.env_b,
        "service": req.service,
        "op": req.op,
        "name": req.name,
    }


@app.post("/api/params/multi")
def api_params_multi(req: CreateMultiParamsRequest):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Ingresá el nombre del parámetro.")
    if not req.envs:
        raise HTTPException(status_code=400, detail="Elegí al menos una región destino.")
    if req.value_type not in ("String", "StringList", "SecureString"):
        raise HTTPException(
            status_code=400,
            detail="value_type debe ser String, StringList o SecureString.",
        )
    if not req.dry_run and not req.confirm:
        raise HTTPException(status_code=400, detail="Se requiere confirmación explícita para ejecutar.")

    # Modo secreto: el parámetro se escribe siempre como SecureString.
    value_type = "SecureString" if req.create_secret else req.value_type

    results = []
    for env in req.envs:
        try:
            cfg = _env_cfg(env)
        except HTTPException as exc:
            results.append({"env": env, "ok": False, "error": str(exc.detail)})
            continue
        try:
            if req.dry_run:
                scripts = [p.build_ssm_script(req.name, req.value, value_type, cfg)]
                if req.create_secret:
                    scripts.insert(0, p.build_secret_script(req.name, req.value, cfg))
                results.append({"env": env, "ok": True, "script": "\n\n".join(scripts)})
            else:
                errors = []
                messages = []
                if req.create_secret:
                    try:
                        messages.append(p.update_secret(cfg, req.name, req.value)["message"])
                    except Exception as exc:
                        errors.append(f"secreto: {exc}")
                try:
                    messages.append(
                        p.put_parameter(cfg, req.name, req.value, value_type)["message"]
                    )
                except Exception as exc:
                    errors.append(f"parámetro: {exc}")
                if errors:
                    results.append(
                        {"env": env, "ok": False, "error": " | ".join(errors)}
                    )
                else:
                    results.append(
                        {"env": env, "ok": True, "message": " ".join(messages)}
                    )
        except Exception as exc:
            results.append({"env": env, "ok": False, "error": f"Error de ejecución: {exc}"})

    return {
        "name": req.name,
        "value_type": value_type,
        "create_secret": req.create_secret,
        "dry_run": req.dry_run,
        "results": results,
        "ok_count": sum(1 for r in results if r["ok"]),
        "err_count": sum(1 for r in results if not r["ok"]),
    }


@app.get("/api/params/get")
def api_params_get(env: str, name: str):
    cfg = _env_cfg(env)
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Ingresá el nombre del parámetro.")
    try:
        value, type_ = p.read_parameter(cfg, name)
    except p.ParamNotFound as exc:
        raise HTTPException(
            status_code=404, detail=f"No existe el parámetro '{name}' en {env}."
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de AWS: {exc}") from exc
    return {"env": env, "name": name, "value": value, "value_type": type_}


@app.post("/api/params/read")
def api_params_read(env: str, body: list[ReadParamsEntry]):
    cfg = _env_cfg(env)
    try:
        results = p.read_many(cfg, [e.model_dump() for e in body])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error de AWS: {exc}") from exc
    return {
        "env": env,
        "results": results,
        "ok_count": sum(1 for r in results if r.get("ok")),
        "err_count": sum(1 for r in results if not r.get("ok")),
    }


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