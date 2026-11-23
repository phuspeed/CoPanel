"""
CoPanel platform endpoints.

Exposes the cross-cutting primitives - jobs, events, audit, notifications -
to the frontend Task Center, Notification Center and Audit pages.
"""
from __future__ import annotations

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
from core.stream_tickets import revalidator
from core.job_secrets import redact_job_row, user_may_access_job
from core.jobs import jobs
from core import notifications as notif
from core import panel_update

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
def platform_health() -> Dict[str, Any]:
    return ok({"running": True, "service": "platform"})


# ----- Jobs --------------------------------------------------------------

def _visible_jobs(user: Dict[str, Any], *, limit: int, module: Optional[str]) -> List[Dict[str, Any]]:
    rows = jobs.list(limit=limit, module=module)
    if user.get("role") == "superadmin":
        return [redact_job_row(r) for r in rows]
    return [redact_job_row(r) for r in rows if user_may_access_job(user, r)]


@router.get("/jobs")
def list_jobs(
    user: Dict[str, Any] = Depends(require_user),
    limit: int = Query(50, ge=1, le=500),
    module: Optional[str] = None,
) -> Dict[str, Any]:
    """List recent jobs (newest first)."""
    return ok(_visible_jobs(user, limit=limit, module=module))


@router.get("/jobs/{job_id}")
def job_detail(job_id: str, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    job = jobs.get(job_id, include_logs=True)
    if not job:
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    if not user_may_access_job(user, job):
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    return ok(redact_job_row(job, include_logs=True))


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    job = jobs.get(job_id, include_logs=False)
    if not job:
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
    if not user_may_access_job(user, job):
        raise ApiError("NOT_FOUND", "Job not found.", http_status=404)
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
        sse_stream(chosen, still_valid=revalidator(user)),
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


# ----- Folder picker -----------------------------------------------------
# Directory-only browser for pickers in other modules (e.g. Docker Manager
# "choose project folder"). Any logged-in user may use it, but only inside
# the folders File Manager's ``check_safe_path`` allows them (superadmin:
# whole filesystem; others: their ``permitted_folders``). It never returns
# file names or contents; the only write is creating one directory.

class FolderPickerMkdirRequest(BaseModel):
    parent: str
    name: str


# Modules whose UI uses the folder picker. A user needs at least one of them;
# the folder list itself is still limited to their ``permitted_folders``.
FOLDER_PICKER_MODULES = (
    "file_manager",
    "docker_manager",
    "download_manager",
    "audio_station",
    "web_manager",
    "backup_manager",
    "ftp_manager",
    "rsync_manager",
    "cloud_sync",
    "webdav",
)


def require_folder_picker(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    from core.auth import user_has_module

    if any(user_has_module(user, m) for m in FOLDER_PICKER_MODULES):
        return user
    raise ApiError("FORBIDDEN", "The folder picker needs access to a module that uses it.", http_status=403)


@router.get("/folder-picker")
def folder_picker_list(
    user: Dict[str, Any] = Depends(require_folder_picker),
    path: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """List sub-directories of ``path`` (default: the user's start folder).

    Read-only: it never creates folders. Users with no assigned folders get 403.
    """
    from fastapi import HTTPException
    from modules.file_manager.router import check_safe_path

    target = check_safe_path(path or "", user)
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Folder not found.")
    dirs: List[Dict[str, Any]] = []
    try:
        entries = list(os.scandir(target))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied.")
    restricted = user.get("role") != "superadmin"
    for entry in entries:
        try:
            if restricted and entry.is_symlink():
                continue
            if entry.is_dir():
                dirs.append({"name": entry.name, "path": os.path.abspath(entry.path), "is_dir": True})
        except OSError:
            continue
    dirs.sort(key=lambda d: d["name"].lower())
    return {"status": "success", "path": target, "files": dirs}


@router.post("/folder-picker/create-dir")
def folder_picker_mkdir(
    req: FolderPickerMkdirRequest,
    user: Dict[str, Any] = Depends(require_folder_picker),
) -> Dict[str, Any]:
    """Create one new directory ``name`` directly inside ``parent``."""
    from fastapi import HTTPException
    from modules.file_manager.router import check_safe_path, safe_child_name, safe_join

    parent = check_safe_path(req.parent, user)
    if not os.path.isdir(parent):
        raise HTTPException(status_code=404, detail="Folder not found.")
    name = safe_child_name(req.name)
    if name != req.name:
        raise HTTPException(status_code=400, detail="Invalid folder name.")
    target = safe_join(parent, name, user)
    if os.path.lexists(os.path.join(parent, name)):
        raise HTTPException(status_code=400, detail="Path already exists.")
    if user.get("role") == "superadmin":
        os.mkdir(target)
    else:
        from core import safe_fs
        from core.user_home import owner_for

        try:
            safe_fs.mkdir(os.path.join(parent, name), owner_for(target, user))
        except safe_fs.SymlinkRefused:
            raise HTTPException(status_code=403, detail="Access denied: the path contains a symbolic link.")
    return {"status": "success", "path": target}


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
def run_panel_update(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Start `scripts/install.sh` detached from copanel.service (superadmin only).

    The installer runs in its own systemd transient unit, so it survives the
    service stop/restart (and the service cgroup) during the install.
    Progress: ``GET /panel-update/status``.
    """
    script = panel_update.install_script_path()
    if not script.is_file():
        raise ApiError(
            "NOT_FOUND",
            f"Upgrade script not found at {script}. Panel self-upgrade runs only on Linux installs under /opt/copanel.",
            http_status=404,
        )
    try:
        status = panel_update.launch_update(actor=user.get("username"))
    except panel_update.UpdateAlreadyRunning as exc:
        raise ApiError("CONFLICT", str(exc), http_status=409)
    except (OSError, RuntimeError) as exc:
        logger.exception("Failed to start panel update")
        raise ApiError("UPDATE_START_FAILED", str(exc), http_status=500)
    record_audit(
        "panel.upgrade",
        module="platform",
        target=str(script),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return ok(status)


@router.get("/panel-update/status")
def panel_update_status(
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    """Detached updater state + log from byte ``offset`` (superadmin only)."""
    return ok(panel_update.update_status(offset))


@router.get("/metrics")
def metrics(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Lightweight self-metrics for the panel itself.

    This intentionally avoids Prometheus exposition - the data is already
    JSON-friendly and visualised by the dashboard. Heavier observability
    (long-term metrics, alert rules) can be layered on later.
    """
    job_list = _visible_jobs(user, limit=200, module=None)
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
