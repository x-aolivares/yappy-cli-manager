"""FastAPI application assembly for the Region Sync web UI.

Serves the static pages plus the JSON API. The API lives in routers under
``src.web.api``; this module only wires them together and mounts the
frontend assets.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import db, envs, params, sessions

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
    "/sessions": "sessions.html",
    "/sessions/{session_id}": "sessions.html",
}

for _route, _fname in _PAGES.items():
    app.get(_route, response_class=FileResponse, include_in_schema=False)(
        lambda f=_fname: FileResponse(str(STATIC_DIR / f))
    )

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(envs.router)
app.include_router(db.router)
app.include_router(params.router)
app.include_router(sessions.router)