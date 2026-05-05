"""
CoPanel: Lightweight Linux VPS Management Panel
Main FastAPI Application Entry Point.

Phase 0 (October 2026 upgrade): adds a standardized API envelope, request
context, audit logging, and a global job/event subsystem so every long-
running module task can flow through the unified Task Center.
"""
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.loader import ModuleLoader
from core import api as core_api
from core.jobs import jobs as job_manager

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
MODULES_DIR = BASE_DIR / "modules"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan event handler."""
    logger.info("CoPanel starting...")
    logger.info("Scanning modules in: %s", MODULES_DIR)
    await job_manager.start(app)
    yield
    await job_manager.stop()
    logger.info("CoPanel shutting down...")


app = FastAPI(
    title="CoPanel API",
    description="Lightweight Linux VPS Management Panel",
    version="1.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8686"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/api/modules")
async def list_modules():
    """List all loaded modules."""
    return JSONResponse(
        status_code=200,
        content={
            "modules": list(loaded_modules.keys()),
            "count": len(loaded_modules)
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
