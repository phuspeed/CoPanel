"""DNS Manager router."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module

from . import logic

router = APIRouter()


class CreateZoneRequest(BaseModel):
    domain: str
    backend: str = "local"


class CreateRecordRequest(BaseModel):
    type: str
    name: str = "@"
    value: str
    ttl: int = 300
    priority: Optional[int] = None


@router.get("/zones")
def list_zones(user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    return ok(logic.list_zones())


@router.post("/zones")
def create_zone(req: CreateZoneRequest, user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    try:
        zone = logic.create_zone(req.domain, req.backend)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "dns.zone.create",
        module="dns_manager",
        target=zone["domain"],
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(zone)


@router.get("/zones/{zone_id}")
def get_zone(zone_id: str, user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    z = logic.get_zone(zone_id)
    if not z:
        raise ApiError("NOT_FOUND", "Zone not found.", http_status=404)
    return ok(z)


@router.delete("/zones/{zone_id}")
def delete_zone(zone_id: str, user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    if not logic.delete_zone(zone_id):
        raise ApiError("NOT_FOUND", "Zone not found.", http_status=404)
    record_audit(
        "dns.zone.delete",
        module="dns_manager",
        target=zone_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"deleted": True})


@router.post("/zones/{zone_id}/records")
def add_record(zone_id: str, req: CreateRecordRequest, user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    try:
        rec = logic.add_record(zone_id, req.dict())
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "dns.record.create",
        module="dns_manager",
        target=f"{zone_id}/{rec['type']} {rec['name']}",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(rec)


@router.delete("/zones/{zone_id}/records/{record_id}")
def delete_record(zone_id: str, record_id: str, user: Dict[str, Any] = Depends(require_module("dns_manager"))) -> Dict[str, Any]:
    if not logic.delete_record(zone_id, record_id):
        raise ApiError("NOT_FOUND", "Record not found.", http_status=404)
    record_audit(
        "dns.record.delete",
        module="dns_manager",
        target=f"{zone_id}/{record_id}",
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"deleted": True})
