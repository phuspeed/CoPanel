"""
Authentication and User Management FastAPI Router.

NOTE: This router still keeps its own ``get_current_user`` for backwards
compatibility - other modules that imported it directly continue to work.
New modules should prefer ``core.auth.require_user`` / ``require_admin``.
"""
import json
import threading
import time
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin, require_user, user_from_verified_payload
from core.security import verify_password, create_access_token, verify_token
from core import user_model

# In-memory login lockout. 10 failures per IP or per username inside 15 minutes.
_LOGIN_WINDOW_SEC = 15 * 60
_LOGIN_MAX_FAILURES = 10
_login_failures: Dict[str, List[float]] = {}
_login_lock = threading.Lock()


def _reset_login_attempts() -> None:
    """Test helper: drop every recorded login failure."""
    with _login_lock:
        _login_failures.clear()


def _prune_attempts(now: float, stamps: List[float]) -> List[float]:
    return [stamp for stamp in stamps if now - stamp < _LOGIN_WINDOW_SEC]


def _attempt_keys(ip: str, username: str) -> List[str]:
    user_key = (username or "").strip().lower()[:128] or "-"
    ip_key = (ip or "unknown").strip()[:128] or "unknown"
    return [f"ip:{ip_key}", f"user:{user_key}"]


def _client_ip(request: Request) -> str:
    """Peer address. Trust forwarding headers only from the local nginx proxy."""
    peer = request.client.host if request.client and request.client.host else "unknown"
    if peer in {"127.0.0.1", "::1", "localhost"}:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded[:128]
        real_ip = (request.headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip[:128]
    return peer


def _login_is_limited(ip: str, username: str) -> bool:
    now = time.monotonic()
    with _login_lock:
        if len(_login_failures) > 10000:
            _login_failures.clear()
        for key in _attempt_keys(ip, username):
            stamps = _prune_attempts(now, _login_failures.get(key, []))
            if stamps:
                _login_failures[key] = stamps
            elif key in _login_failures:
                del _login_failures[key]
            if len(stamps) >= _LOGIN_MAX_FAILURES:
                return True
    return False


def _record_login_failure(ip: str, username: str) -> None:
    now = time.monotonic()
    with _login_lock:
        for key in _attempt_keys(ip, username):
            stamps = _prune_attempts(now, _login_failures.get(key, []))
            stamps.append(now)
            _login_failures[key] = stamps


def _clear_login_failures(ip: str, username: str) -> None:
    with _login_lock:
        for key in _attempt_keys(ip, username):
            _login_failures.pop(key, None)


def _enforce_login_rate_limit(ip: str, username: str) -> None:
    if _login_is_limited(ip, username):
        raise ApiError(
            "RATE_LIMITED",
            "Too many login attempts. Try again later.",
            http_status=429,
        )

router = APIRouter()


def _public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "permitted_modules": user["permitted_modules"],
        "permitted_folders": user["permitted_folders"],
        "totp_enabled": bool(user.get("totp_enabled")),
    }


class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str
    permitted_modules: List[str]
    permitted_folders: List[str]


class UpdateUserRequest(BaseModel):
    role: str
    permitted_modules: List[str]
    permitted_folders: List[str]


def get_current_user(authorization: str = Header(None)) -> Dict[str, Any]:
    """Backwards-compatible dependency used by older modules.

    New code should import :func:`core.auth.require_user` directly.
    """
    if not authorization:
        raise ApiError("UNAUTHORIZED", "Missing authentication header.", http_status=401)
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ApiError("UNAUTHORIZED", "Invalid authorization header format.", http_status=401)
    payload = verify_token(parts[1])
    user = user_from_verified_payload(payload)
    if not user:
        raise ApiError("UNAUTHORIZED", "Invalid or expired token.", http_status=401)
    return user


@router.post("/login")
def login(req: LoginRequest, request: Request) -> Dict[str, Any]:
    """Authenticates users and produces a JWT access token."""
    client_ip = _client_ip(request)
    _enforce_login_rate_limit(client_ip, req.username)
    user = user_model.get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        _record_login_failure(client_ip, req.username)
        record_audit(
            "auth.login.fail",
            module="auth",
            target=req.username,
            actor=req.username,
            status="error",
        )
        raise ApiError("INVALID_CREDENTIALS", "Incorrect username or password.", http_status=401)

    if user.get("totp_enabled"):
        code = (req.totp_code or "").strip()
        if not code:
            raise ApiError(
                "TOTP_REQUIRED",
                "Two-factor authentication code required.",
                http_status=401,
                details={"need_2fa": True},
            )
        secret = user.get("totp_secret") or ""
        import pyotp
        if not secret or not pyotp.TOTP(secret).verify(code, valid_window=1):
            record_audit(
                "auth.login.fail",
                module="auth",
                target=req.username,
                actor=req.username,
                status="error",
                meta={"reason": "totp"},
            )
            _record_login_failure(client_ip, req.username)
            raise ApiError("INVALID_CREDENTIALS", "Invalid two-factor code.", http_status=401)

    _clear_login_failures(client_ip, req.username)
    token = create_access_token(
        data={
            "sub": user["username"],
            "token_version": int(user.get("token_version") or 0),
        }
    )
    record_audit(
        "auth.login.ok",
        module="auth",
        target=user["username"],
        actor=user["username"],
        actor_id=user["id"],
    )
    return {
        "status": "success",
        "access_token": token,
        "token_type": "bearer",
        "user": _public_user(user),
    }


@router.post("/logout")
def logout(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Invalidate every token for this user (logout-all)."""
    user_model.bump_token_version(int(user["id"]))
    record_audit(
        "auth.logout",
        module="auth",
        target=user.get("username"),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return {
        "status": "success",
        "message": "Logged out.",
    }


@router.get("/me")
def get_me(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Returns details about the current logged-in user."""
    return {
        "status": "success",
        "user": _public_user(user),
    }


@router.get("/users")
def list_users(user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Retrieves all registered user accounts on the panel."""
    return {
        "status": "success",
        "users": user_model.get_all_users()
    }


@router.post("/users")
def register_user(req: CreateUserRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Registers a new user profile on the system."""
    try:
        user_id = user_model.create_user(
            username=req.username,
            password_plain=req.password,
            role=req.role,
            permitted_modules=json.dumps(req.permitted_modules),
            permitted_folders=json.dumps(req.permitted_folders)
        )
        record_audit(
            "users.create",
            module="auth",
            target=req.username,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"role": req.role},
        )
        return {
            "status": "success",
            "message": f"Successfully created user '{req.username}'",
            "user_id": user_id
        }
    except ValueError as e:
        raise ApiError("CONFLICT", str(e), http_status=400)


@router.put("/users/{user_id}")
def edit_user(user_id: int, req: UpdateUserRequest, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Updates user roles and permissions."""
    updated = user_model.update_user(
        user_id=user_id,
        role=req.role,
        permitted_modules=json.dumps(req.permitted_modules),
        permitted_folders=json.dumps(req.permitted_folders)
    )
    if not updated:
        raise ApiError("NOT_FOUND", "User not found.", http_status=404)

    record_audit(
        "users.update",
        module="auth",
        target=str(user_id),
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"role": req.role},
    )
    return {
        "status": "success",
        "message": f"Successfully updated user ID {user_id}"
    }


@router.delete("/users/{user_id}")
def remove_user(user_id: int, user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Deletes a user account."""
    deleted = user_model.delete_user(user_id)
    if not deleted:
        raise ApiError("NOT_FOUND", "User not found.", http_status=404)

    record_audit(
        "users.delete",
        module="auth",
        target=str(user_id),
        actor=user.get("username"),
        actor_id=user.get("id"),
    )
    return {
        "status": "success",
        "message": f"Successfully deleted user ID {user_id}"
    }


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
def user_change_password(req: ChangePasswordRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Allows any logged-in user to change their own password, validating the old one."""
    if not verify_password(req.old_password, user["password_hash"]):
        raise ApiError("INVALID_CREDENTIALS", "Incorrect old password.", http_status=400)

    updated = user_model.change_password(user["id"], req.new_password)
    if not updated:
        raise ApiError("INTERNAL_ERROR", "Failed to change password.", http_status=500)
    record_audit(
        "auth.password.change",
        module="auth",
        target=user["username"],
        actor=user["username"],
        actor_id=user["id"],
    )
    return {
        "status": "success",
        "message": "Password changed successfully."
    }
