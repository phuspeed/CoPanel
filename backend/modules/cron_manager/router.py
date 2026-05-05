"""Cron Manager router."""
from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module

from . import logic

router = APIRouter()


class AddJobRequest(BaseModel):
    minute: str = "*"
    hour: str = "*"
    day: str = "*"
    month: str = "*"
    weekday: str = "*"
    command: str = Field(..., min_length=1)


class SetJobStateRequest(BaseModel):
    active: bool


@router.get("/jobs")
def list_jobs(user: Dict[str, Any] = Depends(require_module("cron_manager"))) -> Dict[str, Any]:
    return ok(logic.list_jobs())


@router.post("/jobs")
def add_job(req: AddJobRequest, user: Dict[str, Any] = Depends(require_module("cron_manager"))) -> Dict[str, Any]:
    try:
        job = logic.add_job(req.dict(exclude={"command"}), req.command)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    except RuntimeError as exc:
        raise ApiError("INTERNAL_ERROR", str(exc), http_status=500)
    record_audit(
        "cron.add",
        module="cron_manager",
        target=job["id"],
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"command": req.command},
    )
    return ok(job)


@router.delete("/jobs/{job_id}")
def remove_job(job_id: str, user: Dict[str, Any] = Depends(require_module("cron_manager"))) -> Dict[str, Any]:
    if not logic.remove_job(job_id):
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    record_audit(
        "cron.remove",
        module="cron_manager",
        target=job_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"removed": True})


@router.post("/jobs/{job_id}/state")
def set_job_state(
    job_id: str,
    req: SetJobStateRequest,
    user: Dict[str, Any] = Depends(require_module("cron_manager")),
) -> Dict[str, Any]:
    if not logic.set_job_active(job_id, req.active):
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    record_audit(
        "cron.state",
        module="cron_manager",
        target=job_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"active": req.active},
    )
    return ok({"id": job_id, "active": req.active})
