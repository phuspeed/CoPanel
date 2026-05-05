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

class SetActiveRequest(BaseModel):
    version: str

class ModuleToggleRequest(BaseModel):
    version: str
    module: str
    enable: bool

class SavePHPIniRequest(BaseModel):
    content: str

@router.get("/versions")
def get_versions() -> Dict[str, Any]:
    """List all available PHP versions."""
    payload = logic.get_php_versions_meta()
    return {"status": "success", **payload}

@router.get("/modules")
def get_modules() -> Dict[str, Any]:
    """List all standard PHP modules."""
    return {
        "status": "success",
        "modules": logic.get_php_modules()
    }

@router.get("/modules/{version}")
def get_modules_for_version(version: str) -> Dict[str, Any]:
    """List enabled PHP modules for a specific version."""
    return {
        "status": "success",
        "enabled": logic.get_enabled_modules(version),
        "all": logic.get_php_modules(),
    }

@router.post("/install")
def install_php(req: InstallPHPRequest) -> Dict[str, Any]:
    """Install a new PHP version."""
    res = logic.install_php_version(req.version)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res

@router.delete("/uninstall/{version}")
def uninstall_php(version: str) -> Dict[str, Any]:
    """Remove an installed PHP version."""
    res = logic.uninstall_php_version(version)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res

@router.post("/set_active")
def set_active_php(req: SetActiveRequest) -> Dict[str, Any]:
    """Set the active/default PHP version."""
    res = logic.set_active_php_version(req.version)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res

@router.post("/module_toggle")
def toggle_module(req: ModuleToggleRequest) -> Dict[str, Any]:
    """Enable/disable a specific PHP module."""
    res = logic.toggle_php_module(req.version, req.module, req.enable)
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
