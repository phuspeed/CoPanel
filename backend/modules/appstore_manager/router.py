"""
AppStore Manager Router
Exposes FastAPI endpoints for AppStore catalog and installation actions.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from .logic import AppStoreManager

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
    if not pkg_id or not download_url:
        raise HTTPException(status_code=400, detail="Package id and download_url are required.")
    
    try:
        res = AppStoreManager.install_package(pkg_id, download_url)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
