"""
Package Manager Module - Router
"""
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import logic

router = APIRouter()

class PackageResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    status: str
    category: str


@router.get("")
@router.get("/")
def list_all_packages() -> Dict[str, Any]:
    """Retrieves all system packages."""
    return {
        "status": "success",
        "packages": logic.load_packages()
    }


@router.post("/{pkg_id}/install")
def install_pkg(pkg_id: str) -> Dict[str, Any]:
    """Installs the selected package."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")
    
    updated_pkg = logic.install_package(pkg_id)
    return {
        "status": "success",
        "message": f"Successfully installed package {pkg_id}",
        "package": updated_pkg
    }


@router.post("/{pkg_id}/restart")
def restart_pkg(pkg_id: str) -> Dict[str, Any]:
    """Restarts the selected package."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")
    
    updated_pkg = logic.restart_package(pkg_id)
    return {
        "status": "success",
        "message": f"Successfully restarted package {pkg_id}",
        "package": updated_pkg
    }


@router.post("/{pkg_id}/stop")
def stop_pkg(pkg_id: str) -> Dict[str, Any]:
    """Stops the selected package."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")
    
    updated_pkg = logic.stop_package(pkg_id)
    return {
        "status": "success",
        "message": f"Successfully stopped package {pkg_id}",
        "package": updated_pkg
    }


@router.post("/{pkg_id}/remove")
def remove_pkg(pkg_id: str) -> Dict[str, Any]:
    """Removes the selected package."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")
    
    updated_pkg = logic.remove_package(pkg_id)
    return {
        "status": "success",
        "message": f"Successfully removed package {pkg_id}",
        "package": updated_pkg
    }


@router.get("/credentials/mysql")
def mysql_credentials() -> Dict[str, Any]:
    """Return MySQL/MariaDB login credentials (created on install)."""
    return logic.get_mysql_credentials()


@router.get("/credentials/postgres")
def postgres_credentials() -> Dict[str, Any]:
    """Return PostgreSQL login credentials (created on install)."""
    return logic.get_postgres_credentials()
