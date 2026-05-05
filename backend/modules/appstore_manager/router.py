"""
AppStore Manager Router
Exposes FastAPI endpoints for AppStore catalog and installation actions.
"""
import secrets
from typing import Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File

from .logic import AppStoreManager, get_copanel_home, derive_pkg_id_from_upload_name

router = APIRouter()

@router.get("/catalog")
def get_catalog() -> Dict[str, Any]:
    """Retrieve all available AppStore packages."""
    try:
        catalog = AppStoreManager.get_catalog()
        return {"status": "success", "data": catalog}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/install")
def install_package(req: dict) -> Dict[str, Any]:
    """Downloads and installs a selected package."""
    pkg_id = req.get("id")
    download_url = req.get("download_url")
    version = req.get("version", "1.0.0")
    system_packages = req.get("system_packages", [])
    if not pkg_id or not download_url:
        raise HTTPException(status_code=400, detail="Package id and download_url are required.")
    
    try:
        res = AppStoreManager.install_package(pkg_id, download_url, version, system_packages)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/build-status/{pkg_id}")
def get_build_status(pkg_id: str) -> Dict[str, Any]:
    """Retrieves real-time build logs and installation status."""
    return AppStoreManager.get_build_status(pkg_id)

@router.post("/uninstall")
def uninstall_package(req: dict) -> Dict[str, Any]:
    """Removes the selected package."""
    pkg_id = req.get("id")
    if not pkg_id:
        raise HTTPException(status_code=400, detail="Package id is required.")
        
    try:
        res = AppStoreManager.uninstall_package(pkg_id)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
def get_appstore_config() -> Dict[str, Any]:
    """Retrieves AppStore custom settings and URLs."""
    try:
        return AppStoreManager.load_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
def save_appstore_config(req: dict) -> Dict[str, Any]:
    """Saves AppStore custom settings."""
    try:
        res = AppStoreManager.save_config(req)
        if not res:
            raise HTTPException(status_code=500, detail="Failed to save AppStore configuration.")
        return {"status": "success", "message": "Configuration saved successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-install")
async def upload_install(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Handles on-demand custom module ZIP installation via file upload."""
    try:
        body = await file.read()
        if not body:
            raise HTTPException(status_code=400, detail="Empty file upload")

        pkg_id = derive_pkg_id_from_upload_name(file.filename or "")
        tmp_dir = get_copanel_home() / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        zip_path = tmp_dir / f"upload_{pkg_id}_{secrets.token_hex(3)}.zip"
        zip_path.write_bytes(body)

        res = AppStoreManager.install_local_zip(pkg_id, zip_path)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res.get("message"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Alias: some reverse proxies mishandle paths with hyphens
@router.post("/upload_zip")
async def upload_zip_alias(file: UploadFile = File(...)) -> Dict[str, Any]:
    return await upload_install(file)

