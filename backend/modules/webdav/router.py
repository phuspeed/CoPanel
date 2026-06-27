"""WebDAV + SMB router."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin, require_module

from . import logic
from .schemas import SaveConfigRequest

router = APIRouter()


@router.on_event("startup")
async def on_startup() -> None:
    logic.restore_on_startup()


@router.get("/version")
def get_version(user: Dict[str, Any] = Depends(require_module("webdav"))) -> Dict[str, Any]:
    return ok(logic.get_module_version())


@router.get("/config")
def get_config(user: Dict[str, Any] = Depends(require_module("webdav"))) -> Dict[str, Any]:
    return ok(logic.get_public_config())


@router.put("/config")
def save_config(
    req: SaveConfigRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        cfg = logic.save_config(req.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "webdav.config.save",
        module="webdav",
        target="config",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(cfg)


@router.get("/status")
def get_status(user: Dict[str, Any] = Depends(require_module("webdav"))) -> Dict[str, Any]:
    return ok(logic.get_status())


@router.post("/webdav/{action}")
def webdav_service(
    action: str,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    if action not in {"start", "stop", "restart"}:
        raise ApiError("VALIDATION_ERROR", "Action must be start, stop, or restart.", http_status=400)
    try:
        result = logic.webdav_action(action)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        f"webdav.service.{action}",
        module="webdav",
        target="webdav",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)


@router.post("/smb/{action}")
def smb_service(
    action: str,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    if action not in {"start", "stop", "restart", "apply"}:
        raise ApiError("VALIDATION_ERROR", "Action must be start, stop, restart, or apply.", http_status=400)
    try:
        result = logic.smb_action(action)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        f"webdav.smb.{action}",
        module="webdav",
        target="smb",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)


@router.post("/smb/sync-password")
def sync_smb_password(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.sync_smb_password()
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "webdav.smb.sync_password",
        module="webdav",
        target="smb",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)
