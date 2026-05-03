"""
Advanced PHP Manager Router
Exposes endpoints to install PHP versions, and get/set php.ini contents.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from pydantic import BaseModel
from . import logic

router = APIRouter()

class InstallPHPRequest(BaseModel):
    version: str

class SavePHPIniRequest(BaseModel):
    content: str

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

@router.post("/install")
def install_php(req: InstallPHPRequest) -> Dict[str, Any]:
    """Install a new PHP version."""
    res = logic.install_php_version(req.version)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res

@router.get("/php_ini/{version}")
def get_php_ini(version: str) -> Dict[str, Any]:
    """Fetch the php.ini content for the selected version."""
    try:
        content = logic.get_php_ini(version)
        return {"status": "success", "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/php_ini/{version}")
def save_php_ini(version: str, req: SavePHPIniRequest) -> Dict[str, Any]:
    """Update php.ini file for a specific version."""
    res = logic.save_php_ini(version, req.content)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res
