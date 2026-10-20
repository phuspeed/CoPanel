"""
Package Manager Module - Router
"""
import asyncio
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from core.auth import require_module
from core.jobs import jobs
from pydantic import BaseModel

from . import logic

router = APIRouter(dependencies=[Depends(require_module("package_manager"))])

class PackageResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    status: str
    category: str


@router.get("")
@router.get("/")
@router.get("/list")
@router.get("/list/")
@router.get("/api/package_manager")
@router.get("/api/package_manager/")
@router.get("/api/package_manager/list")
@router.get("/api/package_manager/list/")
def list_all_packages() -> Dict[str, Any]:
    """Retrieves all system packages."""
    return {
        "status": "success",
        "packages": logic.load_packages()
    }




@router.post("/{pkg_id}/install")
async def install_pkg(pkg_id: str) -> Dict[str, Any]:
    """Install the selected package as a background platform job."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")

    active = jobs.find_active(kind="package_manager.install", payload_key="pkg_id", payload_value=pkg_id)
    if active:
        return {
            "status": "success",
            "message": f"Install for {pkg_id} is already running.",
            "job_id": active,
        }

    async def _handler(job, package_id: str):
        job.update(progress=5, message=f"Installing {package_id}")
        try:
            updated_pkg = await asyncio.to_thread(logic.install_package, package_id)
        except Exception as exc:
            job.log(str(exc), level="error")
            raise
        job.update(progress=100, message="Install finished")
        return {"package": updated_pkg, "message": f"Successfully installed package {package_id}"}

    job = jobs.submit(
        kind="package_manager.install",
        title=f"Install {pkg_id}",
        module="package_manager",
        payload={"pkg_id": pkg_id},
        handler=_handler,
        args=(pkg_id,),
    )
    return {
        "status": "success",
        "message": f"Package install started for {pkg_id}",
        "job_id": job.id,
    }


@router.post("/{pkg_id}/restart")
def restart_pkg(pkg_id: str) -> Dict[str, Any]:
    """Restarts the selected package."""
    pkg = logic.get_package(pkg_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{pkg_id}' not found.")
    
    try:
        updated_pkg = logic.restart_package(pkg_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    
    try:
        updated_pkg = logic.stop_package(pkg_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    
    try:
        updated_pkg = logic.remove_package(pkg_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
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
