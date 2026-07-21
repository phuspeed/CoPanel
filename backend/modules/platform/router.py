"""
CoPanel platform endpoints.

Exposes the cross-cutting primitives - jobs, events, audit, notifications -
to the frontend Task Center, Notification Center and Audit pages.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.api import ApiError, ok
from core.audit import query_audit, record_audit
from core.auth import optional_user_sse, require_admin, require_user
from core.events import sse_stream
from core.jobs import jobs
from core import notifications as notif
from core import panel_update

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
def platform_health() -> Dict[str, Any]:
    return ok({"running": True, "service": "platform"})


# ----- Jobs --------------------------------------------------------------

@router.get("/jobs")
def list_jobs(
    user: Dict[str, Any] = Depends(require_user),
    limit: int = Query(50, ge=1, le=500),
    module: Optional[str] = None,
) -> Dict[str, Any]:
    """List recent jobs (newest first)."""
    return ok(jobs.list(limit=limit, module=module))


@router.get("/jobs/{job_id}")
def job_detail(job_id: str, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    job = jobs.get(job_id, include_logs=True)
    if not job:
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    return ok(job)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    if not jobs.cancel(job_id):
        raise ApiError("INVALID_STATE", "Job is not cancellable.", http_status=400)
    record_audit(
        "job.cancel",
        module="platform",
        target=job_id,
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok({"cancelled": True})


@router.get("/events")
async def event_stream(
    topics: str = Query("jobs,notifications"),
    user: Optional[Dict[str, Any]] = Depends(optional_user_sse),
) -> StreamingResponse:
    """SSE stream. ``topics`` is a comma-separated subscription list."""
    if user is None and os.environ.get("COPANEL_DISABLE_AUTH") != "1":
        raise ApiError("UNAUTHORIZED", "Authentication required.", http_status=401)
    chosen = [t.strip() for t in topics.split(",") if t.strip()]
    return StreamingResponse(
        sse_stream(chosen),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ----- Extensions (AppStore runtime modules) ---------------------------

@router.get("/extensions")
def list_installed_extensions(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Installed AppStore frontend extensions for the desktop shell.

    Authenticated users can list extensions (JWT). Static ``/extensions/index.json``
    remains as a fallback when nginx serves extension assets directly.
    """
    from modules.appstore_manager.logic import AppStoreManager

    return ok(AppStoreManager.list_installed_extensions())


# ----- Notifications -----------------------------------------------------

class MarkReadRequest(BaseModel):
    ids: List[str]


class CreateNotificationRequest(BaseModel):
    title: str
    body: Optional[str] = None
    level: str = "info"
    module: Optional[str] = None
    action_url: Optional[str] = None


@router.get("/notifications")
def list_notifications(
    user: Dict[str, Any] = Depends(require_user),
    limit: int = Query(50, ge=1, le=200),
    unread: bool = False,
) -> Dict[str, Any]:
    return ok({
        "items": notif.list_notifications(limit=limit, only_unread=unread),
        "unread": notif.unread_count(),
    })


@router.post("/notifications/read")
def read_notifications(req: MarkReadRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    return ok({"updated": notif.mark_read(req.ids)})


@router.post("/notifications/read-all")
def read_all(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    return ok({"updated": notif.mark_all_read()})


@router.post("/notifications")
def create_notification(req: CreateNotificationRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    record = notif.notify(
        req.title,
        body=req.body,
        level=req.level,
        module=req.module,
        actor=user.get("username"),
        action_url=req.action_url,
    )
    return ok(record)


# ----- Audit -------------------------------------------------------------

@router.get("/audit")
def list_audit(
    user: Dict[str, Any] = Depends(require_admin),
    limit: int = Query(100, ge=1, le=500),
    module: Optional[str] = None,
    actor: Optional[str] = None,
    before_id: Optional[int] = None,
) -> Dict[str, Any]:
    rows = list(query_audit(module=module, actor=actor, limit=limit, before_id=before_id))
    return ok(rows)


# ----- Observability ------------------------------------------------------

@router.get("/panel-update/check")
def check_panel_update(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Compare local VERSION with GitHub main (superadmin only)."""
    return ok(panel_update.check_for_update())


@router.post("/panel-update/run")
async def run_panel_update(user: Dict[str, Any] = Depends(require_admin)) -> StreamingResponse:
    """Stream `scripts/install.sh` stdout (root/VPS installs only). Superadmin only."""
    script = panel_update.install_script_path()
    if not script.is_file():
        raise ApiError(
            "NOT_FOUND",
            f"Upgrade script not found at {script}. Panel self-upgrade runs only on Linux installs under /opt/copanel.",
            http_status=404,
        )
    record_audit(
        "panel.upgrade",
        module="platform",
        target=str(script),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )

    async def stream_stdout() -> Any:
        env = os.environ.copy()
        env["COPANEL_NONINTERACTIVE"] = "1"
        try:
            proc = await asyncio.create_subprocess_exec(
                "/bin/bash",
                str(script),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
        except OSError as e:
            logger.exception("Failed to start panel upgrade subprocess")
            yield f"\n__COPANEL_EXIT__:-1\n{e}\n"
            return

        if proc.stdout:
            while True:
                chunk = await proc.stdout.readline()
                if not chunk:
                    break
                yield chunk.decode("utf-8", errors="replace")
        rc = await proc.wait()
        yield f"\n__COPANEL_EXIT__:{rc}\n"

    return StreamingResponse(
        stream_stdout(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/metrics")
def metrics(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Lightweight self-metrics for the panel itself.

    This intentionally avoids Prometheus exposition - the data is already
    JSON-friendly and visualised by the dashboard. Heavier observability
    (long-term metrics, alert rules) can be layered on later.
    """
    job_list = jobs.list(limit=200)
    by_status: Dict[str, int] = {}
    for j in job_list:
        by_status[j["status"]] = by_status.get(j["status"], 0) + 1
    return ok({
        "jobs": {
            "total_recent": len(job_list),
            "by_status": by_status,
        },
        "notifications": {
            "unread": notif.unread_count(),
        },
    })
