"""FastAPI application assembly for the Region Sync web UI.

``Factory-style app``: wiring together the API routers and the frontend.

- If the Angular app is compiled (``frontend/dist/browser`` exists) it is
  served as a SPA: every unknown path goes to ``index.html`` and the API
  keeps working.
- Otherwise it falls back to the legacy vanilla pages under ``static/``,
  preserving the previous behavior exactly.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import db, envs, params, sessions

STATIC_DIR = Path(__file__).resolve().parent / "static"
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist" / "browser"

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


def _serve_spa(app: FastAPI) -> None:
    """Serve the compiled Angular app. Registered last so /api and docs win."""
    index = FRONTEND_DIST / "index.html"

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str = ""):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(index))


def _serve_legacy_pages(app: FastAPI) -> None:
    """Legacy vanilla pages + static assets (pre-Angular behavior)."""
    for _route, _fname in _PAGES.items():
        app.get(_route, response_class=FileResponse, include_in_schema=False)(
            lambda f=_fname: FileResponse(str(STATIC_DIR / f))
        )
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _create_app() -> FastAPI:
    app = FastAPI(
        title="Yappy Region Sync",
        description="Diff de DB (tablas/SP) y de parámetros SSM/Secrets entre regiones de origen y destino",
        version="2.0.0",
    )
    app.include_router(envs.router)
    app.include_router(db.router)
    app.include_router(params.router)
    app.include_router(sessions.router)
    if FRONTEND_DIST.is_dir():
        _serve_spa(app)
    else:
        _serve_legacy_pages(app)
    return app


app = _create_app()