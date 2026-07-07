"""Panel settings router — superadmin only."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin

from . import logic
from .schemas import (
    BrandingSettingsRequest,
    NetworkConfigRequest,
    NginxGateRequest,
    RootPasswordRequest,
    SshPortRequest,
    TotpDisableRequest,
    TotpVerifyRequest,
)

router = APIRouter()


@router.get("/version")
def get_version(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.get_module_version())


@router.get("/")
def get_settings(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.get_settings())


@router.get("/branding/public")
def get_public_branding() -> Dict[str, Any]:
    return ok(logic.get_public_branding())


@router.put("/branding")
def set_branding(req: BrandingSettingsRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.update_branding(req.site_title, req.site_subtitle, req.favicon_data_url, req.logo_data_url)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "panel_settings.branding",
        module="panel_settings",
        target="branding",
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"site_title": result.get("site_title")},
    )
    return ok(result)


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


@router.post("/nginx-gate/repair")
def repair_nginx_gate(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    try:
        result = logic.repair_nginx_gate()
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "panel_settings.nginx_gate.repair",
        module="panel_settings",
        target="nginx",
        actor=user.get("username"),
        actor_id=user.get("id"),
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


@router.get("/network/summary")
def get_network_summary(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.get_network_summary())


@router.get("/network")
def list_network(_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return ok(logic.list_network_interfaces())


@router.put("/network/{interface_name}")
def set_network(
    interface_name: str,
    req: NetworkConfigRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = logic.apply_interface_network(
            interface_name,
            method=req.method,
            address=req.address,
            prefix=req.prefix,
            gateway=req.gateway,
            dns=req.dns,
            confirm=req.confirm,
        )
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("SERVICE_ERROR", str(exc), http_status=503)
    record_audit(
        "panel_settings.network",
        module="panel_settings",
        target=interface_name,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"method": req.method, "address": req.address},
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
