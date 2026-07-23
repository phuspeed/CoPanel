"""
CoPanel: Lightweight Linux VPS Management Panel
Main FastAPI Application Entry Point.

Phase 0 (October 2026 upgrade): adds a standardized API envelope, request
context, audit logging, and a global job/event subsystem so every long-
running module task can flow through the unified Task Center.
"""
import asyncio
import logging
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.loader import ModuleLoader
from core import api as core_api
from core.auth import api_auth_middleware
from core.jobs import jobs as job_manager

try:
    from core import module_reload as module_reload
except ImportError:
    module_reload = None  # type: ignore[assignment]

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
MODULES_DIR = BASE_DIR / "modules"


def _read_app_version() -> str:
    """Prefer /opt/copanel/VERSION (or COPANEL_HOME), then repo root VERSION."""
    import os

    for base in (
        Path(os.environ.get("COPANEL_HOME", "/opt/copanel")),
        BASE_DIR.parent,
    ):
        vf = base / "VERSION"
        if vf.is_file():
            try:
                v = vf.read_text(encoding="utf-8").strip().split()[0]
                if v:
                    return v
            except OSError:
                continue
    return "1.1.2"


APP_VERSION = _read_app_version()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan event handler."""
    logger.info("CoPanel starting...")
    logger.info("Scanning modules in: %s", MODULES_DIR)
    if module_reload is not None:
        module_reload.set_event_loop(asyncio.get_running_loop())
    else:
        logger.warning("core.module_reload missing — hot-reload disabled; update CoPanel core (git pull).")
    await job_manager.start(app)

    # Never block startup on nginx reload — systemctl reload can hang past
    # systemd TimeoutStartSec and leave the API in a 502 crash loop.
    def _nginx_gate_repair_bg() -> None:
        try:
            from modules.panel_settings.logic import maybe_auto_repair_nginx_gate

            maybe_auto_repair_nginx_gate()
        except Exception as exc:
            logger.warning("panel_settings startup hook: %s", exc)

    threading.Thread(
        target=_nginx_gate_repair_bg,
        name="nginx-gate-auto-repair",
        daemon=True,
    ).start()

    yield
    await job_manager.stop()
    logger.info("CoPanel shutting down...")


app = FastAPI(
    title="CoPanel API",
    description="Lightweight Linux VPS Management Panel",
    version=APP_VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8686"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global JWT gate for /api/* (except login / public branding / OAuth callback).
# Must run for every API request so DevTools UI bypass cannot reach panel actions.
app.middleware("http")(api_auth_middleware)
app.middleware("http")(core_api.request_context_middleware)
core_api.install_exception_handlers(app)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "CoPanel",
            "version": app.version,
        }
    )


@app.get("/api")
async def api_root():
    """API root endpoint."""
    return JSONResponse(
        status_code=200,
        content={
            "message": "CoPanel API",
            "version": app.version,
            "endpoints": {
                "health": "/health",
                "modules": "/api/modules",
                "platform": {
                    "jobs": "/api/platform/jobs",
                    "events": "/api/platform/events",
                    "notifications": "/api/platform/notifications",
                    "audit": "/api/platform/audit",
                },
            }
        }
    )


loader = ModuleLoader(MODULES_DIR)
loaded_modules = loader.load_modules(app)
if module_reload is not None:
    module_reload.configure(app, loader)


@app.get("/api/modules")
async def list_modules():
    """List loaded modules and live API route paths (reflects hot-reload).

    Protected by the global API auth middleware (valid JWT required).
    """
    modules: Dict[str, Any] = {}
    for name in loader.loaded_modules:
        paths = loader.list_route_paths(app, name)
        modules[name] = {"route_count": len(paths), "routes": paths}
    return JSONResponse(
        status_code=200,
        content={
            "modules": modules,
            "count": len(modules),
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
