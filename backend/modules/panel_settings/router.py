"""Panel settings router — superadmin only."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin

from . import logic
from .schemas import NginxGateRequest, RootPasswordRequest, SshPortRequest, TotpDisableRequest, TotpVerifyRequest

router = APIRouter()


@router.get("/version")
def get_version(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.get_module_version())


@router.get("/")
def get_settings(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.get_settings())


@router.get("/ssh")
def get_ssh(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok({"port": logic._read_ssh_port()})


@router.put("/ssh/port")
def set_ssh_port(req: SshPortRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.change_ssh_port(req.port, confirm=req.confirm)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "panel_settings.ssh_port",
        module="panel_settings",
        target=str(req.port),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)


@router.post("/root-password")
def set_root_password(req: RootPasswordRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.change_root_password(req.new_password, req.confirm_password)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "panel_settings.root_password",
        module="panel_settings",
        target="root",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)


@router.put("/nginx-gate")
def set_nginx_gate(req: NginxGateRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.configure_nginx_gate(req.enabled, req.username, req.password)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "panel_settings.nginx_gate",
        module="panel_settings",
        target="nginx",
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"enabled": req.enabled},
    )
    return ok(result)


@router.post("/totp/setup")
def totp_setup(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.totp_setup(user["username"])
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    return ok(result)


@router.post("/totp/enable")
def totp_enable(req: TotpVerifyRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.totp_enable(user["username"], req.code)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "panel_settings.totp.enable",
        module="panel_settings",
        target=user.get("username"),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)


@router.post("/totp/disable")
def totp_disable(req: TotpDisableRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.totp_disable(user["username"], req.password, req.code)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "panel_settings.totp.disable",
        module="panel_settings",
        target=user.get("username"),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(result)
