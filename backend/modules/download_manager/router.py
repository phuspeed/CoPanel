"""Download Manager API."""
from __future__ import annotations

import json
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import HTMLResponse

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module

from . import logic
from .google_oauth import GoogleOAuthService, GoogleOAuthStore
from .schemas import (
    CreateHostingAccountRequest,
    CreateHostingProfileRequest,
    CreateTaskRequest,
    DetectUrlRequest,
    GoogleOAuthStartRequest,
    SaveSettingsRequest,
    UpdateHostingAccountRequest,
    UpdateHostingProfileRequest,
)

router = APIRouter()


@router.on_event("startup")
async def on_startup() -> None:
    logic.ensure_worker()


@router.get("/settings")
def get_settings(user: Dict[str, Any] = Depends(require_module("download_manager"))) -> Dict[str, Any]:
    return ok(logic.get_settings())


@router.put("/settings")
def save_settings(
    req: SaveSettingsRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    data = req.model_dump(exclude_none=True)
    saved = logic.save_settings(data)
    record_audit("download.settings", module="download_manager", actor=user.get("username"))
    return ok(saved)


@router.get("/tasks")
def list_tasks(
    filter: str = Query("all", alias="filter"),
    search: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    return ok(logic.list_tasks(filter_key=filter, search=search))


@router.get("/tasks/{task_id}")
def get_task(
    task_id: str,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    task = logic.get_task(task_id)
    if not task:
        raise ApiError("NOT_FOUND", "Task not found", http_status=404)
    return ok(task)


@router.post("/tasks")
def create_task(
    req: CreateTaskRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    try:
        task = logic.create_task(req.model_dump(), username=user.get("username") or "")
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "download.add",
        module="download_manager",
        target=task.get("id"),
        actor=user.get("username"),
        meta={"url": req.url},
    )
    return ok(task)


@router.post("/tasks/upload-torrent")
async def upload_torrent(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    content = await file.read()
    try:
        task = logic.create_task_from_torrent_bytes(
            content,
            file.filename or "upload.torrent",
            username=user.get("username") or "",
        )
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit(
        "download.torrent_upload",
        module="download_manager",
        target=task.get("id"),
        actor=user.get("username"),
    )
    return ok(task)


@router.get("/engine/status")
def engine_status(
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    return ok(logic.get_engine_status())


@router.post("/tasks/{task_id}/{action}")
def task_action(
    task_id: str,
    action: str,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    if action not in ("pause", "resume", "stop"):
        raise ApiError("VALIDATION_ERROR", f"Unknown action: {action}", http_status=400)
    try:
        task = logic.set_task_status(task_id, action)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    if not task:
        raise ApiError("NOT_FOUND", "Task not found", http_status=404)
    record_audit(
        f"download.{action}",
        module="download_manager",
        target=task_id,
        actor=user.get("username"),
    )
    return ok(task)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    if not logic.delete_task(task_id):
        raise ApiError("NOT_FOUND", "Task not found", http_status=404)
    record_audit("download.delete", module="download_manager", target=task_id, actor=user.get("username"))
    return ok({"deleted": True})


@router.delete("/tasks/completed")
def clear_completed(
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    count = logic.clear_completed()
    record_audit("download.clear_completed", module="download_manager", actor=user.get("username"), meta={"count": count})
    return ok({"deleted": count})


@router.post("/detect-url")
def detect_url(
    req: DetectUrlRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    return ok(logic.detect_url(req.url))


@router.get("/folders/browse")
def browse_folders(
    path: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    return ok(logic.browse_folders(path))


@router.get("/file-hosting")
def list_hosting(
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    profiles = logic.list_hosting_profiles()
    detailed = []
    for p in profiles:
        detailed.append({**p, "accounts": logic.list_hosting_accounts(p["id"])})
    return ok(detailed)


@router.post("/file-hosting")
def create_hosting(
    req: CreateHostingProfileRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    payload = req.model_dump()
    if payload.get("api_config"):
        payload["api_config"] = payload["api_config"]
    profile = logic.create_hosting_profile(payload)
    record_audit("download.hosting.create", module="download_manager", target=profile.get("id"), actor=user.get("username"))
    return ok(profile)


@router.put("/file-hosting/{profile_id}")
def update_hosting(
    profile_id: str,
    req: UpdateHostingProfileRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    profile = logic.update_hosting_profile(profile_id, req.model_dump(exclude_none=True))
    if not profile:
        raise ApiError("NOT_FOUND", "Profile not found", http_status=404)
    return ok(profile)


@router.delete("/file-hosting/{profile_id}")
def delete_hosting(
    profile_id: str,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    if not logic.delete_hosting_profile(profile_id):
        raise ApiError("NOT_FOUND", "Profile not found", http_status=404)
    return ok({"deleted": True})


@router.post("/file-hosting/{profile_id}/accounts")
def create_account(
    profile_id: str,
    req: CreateHostingAccountRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    if not logic.get_hosting_profile(profile_id):
        raise ApiError("NOT_FOUND", "Profile not found", http_status=404)
    account = logic.create_hosting_account(profile_id, req.model_dump())
    return ok(account)


@router.put("/file-hosting/{profile_id}/accounts/{account_id}")
def update_account(
    profile_id: str,
    account_id: str,
    req: UpdateHostingAccountRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    account = logic.update_hosting_account(profile_id, account_id, req.model_dump(exclude_none=True))
    if not account:
        raise ApiError("NOT_FOUND", "Account not found", http_status=404)
    return ok(account)


@router.delete("/file-hosting/{profile_id}/accounts/{account_id}")
def delete_account(
    profile_id: str,
    account_id: str,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    if not logic.delete_hosting_account(profile_id, account_id):
        raise ApiError("NOT_FOUND", "Account not found", http_status=404)
    return ok({"deleted": True})


@router.post("/oauth/google/start")
def oauth_google_start(
    req: GoogleOAuthStartRequest,
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    try:
        result = GoogleOAuthService.start_oauth(
            req.client_id, req.client_secret, req.redirect_uri, req.account_name
        )
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    return ok(result)


@router.get("/oauth/google/callback")
def oauth_google_callback(code: str = "", state: str = "", error: str = ""):
    if error:
        payload = {"type": "copanel_dm_google_oauth", "ok": False, "error": error}
        return HTMLResponse(
            content=f"<html><body><script>window.opener&&window.opener.postMessage({json.dumps(payload)},'*');window.close();</script>Authorization failed: {error}</body></html>"
        )
    try:
        result = GoogleOAuthService.exchange_code(code=code, state=state)
        payload = {"type": "copanel_dm_google_oauth", "ok": True, "account_name": result["account_name"]}
        return HTMLResponse(
            content=f"<html><body><script>window.opener&&window.opener.postMessage({json.dumps(payload)},'*');window.close();</script>Google connected.</body></html>"
        )
    except Exception as exc:
        payload = {"type": "copanel_dm_google_oauth", "ok": False, "error": str(exc)}
        return HTMLResponse(
            content=f"<html><body><script>window.opener&&window.opener.postMessage({json.dumps(payload)},'*');window.close();</script>{str(exc)}</body></html>",
            status_code=400,
        )


@router.get("/oauth/google/status")
def oauth_google_status(
    user: Dict[str, Any] = Depends(require_module("download_manager")),
) -> Dict[str, Any]:
    return ok({
        "configured": GoogleOAuthService.oauth_configured(),
        "connected": GoogleOAuthService.get_access_token() is not None,
        "accounts": GoogleOAuthStore.list_status(),
    })
