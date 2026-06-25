"""Cloudflare DDNS router."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module

from . import logic
from .schemas import (
    CreateDdnsRequest,
    CreateRecordRequest,
    CreateTunnelRequest,
    SaveConfigRequest,
    SaveTunnelConfigRequest,
    UpdateDdnsRequest,
    UpdateRecordRequest,
)

router = APIRouter()


@router.on_event("startup")
async def on_startup() -> None:
    try:
        logic.sync_crontab()
    except Exception:
        pass


# --- Config ---

@router.get("/config")
def get_config(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    return ok(logic.get_public_config())


@router.put("/config")
def save_config(req: SaveConfigRequest, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        cfg = logic.save_config(api_token=req.api_token, account_id=req.account_id)
    except Exception as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "cloudflare.config.save",
        module="cloudflare_ddns",
        target="config",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(cfg)


@router.post("/config/verify")
def verify_config(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        result = logic.verify_config()
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    return ok(result)


# --- Zones & DNS records ---

@router.get("/zones")
def list_zones(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        return ok(logic.list_zones())
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)


@router.get("/zones/{zone_id}/records")
def list_records(zone_id: str, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        return ok(logic.list_records(zone_id))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)


@router.post("/zones/{zone_id}/records")
def create_record(
    zone_id: str,
    req: CreateRecordRequest,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        rec = logic.create_record(zone_id, req.model_dump())
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    record_audit(
        "cloudflare.record.create",
        module="cloudflare_ddns",
        target=f"{zone_id}/{req.name}",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(rec)


@router.patch("/zones/{zone_id}/records/{record_id}")
def update_record(
    zone_id: str,
    record_id: str,
    req: UpdateRecordRequest,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        rec = logic.update_record(zone_id, record_id, req.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    record_audit(
        "cloudflare.record.update",
        module="cloudflare_ddns",
        target=f"{zone_id}/{record_id}",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(rec)


@router.delete("/zones/{zone_id}/records/{record_id}")
def delete_record(
    zone_id: str,
    record_id: str,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        logic.delete_record(zone_id, record_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    record_audit(
        "cloudflare.record.delete",
        module="cloudflare_ddns",
        target=f"{zone_id}/{record_id}",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"deleted": True})


# --- DDNS profiles ---

@router.get("/ddns")
def list_ddns(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    return ok(logic.list_ddns_profiles())


@router.post("/ddns")
def create_ddns(req: CreateDdnsRequest, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        profile = logic.create_ddns_profile(req.model_dump())
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "cloudflare.ddns.create",
        module="cloudflare_ddns",
        target=profile["id"],
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(profile)


@router.put("/ddns/{profile_id}")
def update_ddns(
    profile_id: str,
    req: UpdateDdnsRequest,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        profile = logic.update_ddns_profile(profile_id, req.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "cloudflare.ddns.update",
        module="cloudflare_ddns",
        target=profile_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(profile)


@router.delete("/ddns/{profile_id}")
def delete_ddns(profile_id: str, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    if not logic.delete_ddns_profile(profile_id):
        raise ApiError("NOT_FOUND", "DDNS profile not found.", http_status=404)
    record_audit(
        "cloudflare.ddns.delete",
        module="cloudflare_ddns",
        target=profile_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"deleted": True})


@router.post("/ddns/{profile_id}/run")
def run_ddns(profile_id: str, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        result = logic.run_ddns_profile(profile_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("DDNS_ERROR", str(exc), http_status=500)
    record_audit(
        "cloudflare.ddns.run",
        module="cloudflare_ddns",
        target=profile_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta=result,
    )
    return ok(result)


@router.post("/ddns/run-all")
def run_all_ddns(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    results = logic.run_all_ddns()
    record_audit(
        "cloudflare.ddns.run_all",
        module="cloudflare_ddns",
        target="all",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(results)


# --- Tunnels ---

@router.get("/tunnels")
def list_tunnels(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        return ok(logic.list_tunnels())
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)


@router.post("/tunnels")
def create_tunnel(req: CreateTunnelRequest, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        tunnel = logic.create_tunnel(req.name)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    record_audit(
        "cloudflare.tunnel.create",
        module="cloudflare_ddns",
        target=tunnel.get("id") or req.name,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(tunnel)


@router.get("/tunnels/service/status")
def tunnel_status(user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    return ok(logic.tunnel_service_status())


@router.delete("/tunnels/{tunnel_id}")
def delete_tunnel(tunnel_id: str, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    try:
        logic.delete_tunnel(tunnel_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("CLOUDFLARE_ERROR", str(exc), http_status=502)
    record_audit(
        "cloudflare.tunnel.delete",
        module="cloudflare_ddns",
        target=tunnel_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"deleted": True})


@router.get("/tunnels/{tunnel_id}/config")
def get_tunnel_config(tunnel_id: str, user: Dict[str, Any] = Depends(require_module("cloudflare_ddns"))) -> Dict[str, Any]:
    return ok(logic.get_tunnel_local_config(tunnel_id))


@router.put("/tunnels/{tunnel_id}/config")
def save_tunnel_config(
    tunnel_id: str,
    req: SaveTunnelConfigRequest,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        cfg = logic.save_tunnel_local_config(tunnel_id, req.tunnel_name, [r.model_dump() for r in req.ingress])
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("TUNNEL_ERROR", str(exc), http_status=500)
    record_audit(
        "cloudflare.tunnel.config",
        module="cloudflare_ddns",
        target=tunnel_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(cfg)


@router.post("/tunnels/{tunnel_id}/install")
def install_tunnel(
    tunnel_id: str,
    user: Dict[str, Any] = Depends(require_module("cloudflare_ddns")),
) -> Dict[str, Any]:
    try:
        status = logic.install_tunnel_service(tunnel_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except Exception as exc:
        raise ApiError("TUNNEL_ERROR", str(exc), http_status=500)
    record_audit(
        "cloudflare.tunnel.install",
        module="cloudflare_ddns",
        target=tunnel_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(status)
