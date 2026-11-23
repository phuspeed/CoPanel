"""
AppStore Manager Router
Exposes FastAPI endpoints for AppStore catalog and installation actions.
"""
import secrets
from typing import Dict, Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends

from core.auth import require_admin, require_module
from .logic import (
    AppStoreManager,
    BATCH_UPDATE_TASK_ID,
    PackageIntegrityError,
    derive_pkg_id_from_upload_name,
    get_copanel_home,
    resolve_catalog_package,
    validate_pkg_id,
)

# Viewing the catalog needs the module grant. Installing, updating, removing,
# uploading and configuring sources run code as root, so they are
# superadmin-only (require_admin) regardless of module grants.
router = APIRouter(dependencies=[Depends(require_module("appstore_manager"))])
ADMIN = [Depends(require_admin)]

@router.get("/catalog")
def get_catalog() -> Dict[str, Any]:
    """Retrieve all available AppStore packages."""
    try:
        catalog = AppStoreManager.get_catalog()
        return {"status": "success", "data": catalog}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/install", dependencies=ADMIN)
def install_package(req: dict) -> Dict[str, Any]:
    """Install one package by id. Everything else (download URL, SHA-256,
    dependencies) comes from the catalog the server fetched itself; values
    sent by the browser are ignored."""
    try:
        pkg = resolve_catalog_package(req.get("id"))
    except PackageIntegrityError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        res = AppStoreManager.install_package(
            pkg["id"],
            pkg["download_url"],
            pkg["version"],
            pkg["system_packages"],
            pkg["pip_packages"],
            pkg["requires_copanel_restart"],
            pkg["frontend_install"],
            pkg["is_core"],
            sha256=pkg["sha256"],
        )
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/install-batch", dependencies=ADMIN)
def install_packages_batch(req: dict) -> Dict[str, Any]:
    """Install/update several packages (by id) with a single frontend build."""
    packages = req.get("packages")
    if not isinstance(packages, list) or not packages:
        raise HTTPException(status_code=400, detail="packages array is required.")

    try:
        catalog = AppStoreManager.get_catalog()
        normalized = []
        seen = set()
        for pkg in packages:
            pid = pkg.get("id") if isinstance(pkg, dict) else pkg
            if not pid or pid in seen:
                continue
            seen.add(pid)
            normalized.append(resolve_catalog_package(pid, catalog))
    except PackageIntegrityError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not normalized:
        raise HTTPException(status_code=400, detail="Each package requires an id.")

    try:
        res = AppStoreManager.install_packages_batch(normalized)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/batch-task-id")
def get_batch_task_id() -> Dict[str, str]:
    """Return the build-status task id used for batch updates."""
    return {"task_id": BATCH_UPDATE_TASK_ID}


@router.get("/build-status/{pkg_id}")
def get_build_status(pkg_id: str) -> Dict[str, Any]:
    """Retrieves real-time build logs and installation status."""
    if pkg_id != BATCH_UPDATE_TASK_ID:
        try:
            validate_pkg_id(pkg_id)
        except PackageIntegrityError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return AppStoreManager.get_build_status(pkg_id)


@router.post("/restart-copanel")
def restart_copanel(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Restart copanel systemd service after module install (superadmin)."""
    try:
        result = AppStoreManager.trigger_copanel_restart()
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.post("/uninstall", dependencies=ADMIN)
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


@router.get("/config", dependencies=ADMIN)
def get_appstore_config() -> Dict[str, Any]:
    """Retrieves AppStore custom settings and URLs."""
    try:
        return AppStoreManager.load_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config", dependencies=ADMIN)
def save_appstore_config(req: dict) -> Dict[str, Any]:
    """Saves AppStore custom settings (community catalog URLs must be https)."""
    urls = (req or {}).get("community_urls", [])
    if not isinstance(urls, list) or any(
        not isinstance(u, str) or not u.strip().lower().startswith("https://") for u in urls
    ):
        raise HTTPException(status_code=400, detail="Community catalog URLs must be https:// URLs.")
    try:
        res = AppStoreManager.save_config(req)
        if not res:
            raise HTTPException(status_code=500, detail="Failed to save AppStore configuration.")
        return {"status": "success", "message": "Configuration saved successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-install", dependencies=ADMIN)
async def upload_install(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Install a module ZIP uploaded by the superadmin (explicit local code)."""
    try:
        body = await file.read()
        if not body:
            raise HTTPException(status_code=400, detail="Empty file upload")

        try:
            pkg_id = validate_pkg_id(derive_pkg_id_from_upload_name(file.filename or ""))
        except PackageIntegrityError as e:
            raise HTTPException(status_code=400, detail=str(e))
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
@router.post("/upload_zip", dependencies=ADMIN)
async def upload_zip_alias(file: UploadFile = File(...)) -> Dict[str, Any]:
    return await upload_install(file)

