from fastapi import APIRouter
from typing import Dict, Any, List
from . import logic

router = APIRouter()

@router.get("/versions")
def get_versions() -> Dict[str, Any]:
    """List all available PHP versions."""
    return {
        "status": "success",
        "versions": logic.get_php_versions()
    }

@router.get("/modules")
def get_modules() -> Dict[str, Any]:
    """List all standard PHP modules."""
    return {
        "status": "success",
        "modules": logic.get_php_modules()
    }
