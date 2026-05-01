"""
CoPanel: Lightweight Linux VPS Management Panel
Main FastAPI Application Entry Point
"""
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from core.loader import ModuleLoader

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Get base directory
BASE_DIR = Path(__file__).parent
MODULES_DIR = BASE_DIR / "modules"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan event handler."""
    logger.info("🚀 CoPanel starting...")
    logger.info(f"📦 Scanning modules in: {MODULES_DIR}")
    yield
    logger.info("🛑 CoPanel shutting down...")


# Initialize FastAPI app
app = FastAPI(
    title="CoPanel API",
    description="Lightweight Linux VPS Management Panel",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8686"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "CoPanel",
            "version": "1.0.0"
        }
    )


@app.get("/api")
async def api_root():
    """API root endpoint."""
    return JSONResponse(
        status_code=200,
        content={
            "message": "CoPanel API",
            "version": "1.0.0",
            "endpoints": {
                "health": "/health",
                "modules": "/api/modules"
            }
        }
    )


# Load modules dynamically
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
