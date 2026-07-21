"""
Shared authentication & authorization dependencies.

Use these instead of duplicating ``get_current_user`` in every module router.

Examples:
    from core.auth import require_user, require_admin, require_module

    router = APIRouter(dependencies=[Depends(require_module("web_manager"))])

    @router.post("/sites")
    def create_site(user = Depends(require_admin)):
        ...
"""
from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, List, Optional

from fastapi import Header, Query, Request
from fastapi.responses import JSONResponse

from .api import ApiError
from .security import verify_token
from . import user_model


# Public HTTP endpoints exempt from the global API auth gate.
# Login, login-page branding, and OAuth browser redirects must stay reachable
# without a Bearer token. Everything else under ``/api/*`` requires auth.
_PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/panel_settings/branding/public",
    "/api/backup_manager/oauth/google/callback",
    "/api/cloud_sync/oauth/google/callback",
}

# When CoPanel is started in development without a database (e.g. a test
# harness) it can be useful to skip auth. Off by default in production.
_AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"


def auth_disabled() -> bool:
    """True when ``COPANEL_DISABLE_AUTH=1`` (test / local harness only)."""
    return _AUTH_DISABLED


def _normalize_permitted(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except json.JSONDecodeError:
            return []
    return []


def _user_from_bearer_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    payload = verify_token(token)
    if not payload or "sub" not in payload:
        return None
    return user_model.get_user_by_username(payload["sub"])


def _user_from_token(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return _user_from_bearer_token(parts[1])


def _resolve_user(
    authorization: Optional[str] = None,
    access_token: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve caller from Bearer header or ``access_token`` / ``token`` query."""
    if _AUTH_DISABLED:
        return {"id": 0, "username": "dev", "role": "superadmin", "permitted_modules": "[\"all\"]"}
    user = (
        _user_from_token(authorization)
        or _user_from_bearer_token(access_token)
        or _user_from_bearer_token(token)
    )
    if not user:
        raise ApiError("UNAUTHORIZED", "Authentication required.", http_status=401)
    return user


def require_user(
    authorization: str = Header(None),
    access_token: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Standard dependency: returns the current user or raises 401.

    EventSource / media elements cannot set Authorization; they may pass
    ``access_token`` or ``token`` as a query parameter instead.
    """
    return _resolve_user(authorization, access_token, token)


def require_admin(
    authorization: str = Header(None),
    access_token: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Dependency that ensures the caller is a superadmin."""
    user = _resolve_user(authorization, access_token, token)
    if user.get("role") != "superadmin":
        raise ApiError("FORBIDDEN", "Administrator privileges required.", http_status=403)
    return user


def require_module(module_id: str) -> Callable[..., Dict[str, Any]]:
    """Dependency factory that ensures the caller can access ``module_id``.

    Superadmins always pass; other users must include the module id (or
    ``"all"``) in their ``permitted_modules`` list.
    """

    def _dep(
        authorization: str = Header(None),
        access_token: Optional[str] = Query(None),
        token: Optional[str] = Query(None),
    ) -> Dict[str, Any]:
        user = _resolve_user(authorization, access_token, token)
        if user.get("role") == "superadmin":
            return user
        permitted = _normalize_permitted(user.get("permitted_modules"))
        if "all" in permitted or module_id in permitted:
            return user
        raise ApiError(
            "FORBIDDEN",
            f"Access to module '{module_id}' is not granted.",
            http_status=403,
            details={"module": module_id},
        )

    return _dep


def optional_user(authorization: str = Header(None)) -> Optional[Dict[str, Any]]:
    """Returns the user if a valid token is present, else ``None``."""
    return _user_from_token(authorization)


def optional_user_sse(
    authorization: str = Header(None),
    access_token: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
) -> Optional[Dict[str, Any]]:
    """EventSource cannot send Authorization headers; accept ``access_token`` / ``token`` query."""
    return _user_from_token(authorization) or _user_from_bearer_token(access_token or token)


def user_from_access_token(access_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Resolve a user from a raw bearer token string (WebSocket / query)."""
    return _user_from_bearer_token(access_token)


def user_has_module(user: Dict[str, Any], module_id: str) -> bool:
    """Return True if ``user`` may access ``module_id``."""
    if user.get("role") == "superadmin":
        return True
    permitted = _normalize_permitted(user.get("permitted_modules"))
    return "all" in permitted or module_id in permitted


async def api_auth_middleware(request: Request, call_next):
    """Reject unauthenticated access to ``/api/*`` except public paths.

    This is the primary defense against login-UI / DevTools bypass: even if the
    SPA is forced to render, mutating or reading panel data still requires a
    valid JWT. Module routers should still use ``require_module`` for RBAC.
    """
    if _AUTH_DISABLED:
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if not path.startswith("/api/") and path != "/api":
        return await call_next(request)

    if path in _PUBLIC_PATHS:
        return await call_next(request)

    authorization = request.headers.get("authorization")
    # Also accept legacy ``?token=`` used by HTML5 audio/img (audio_station).
    access_token = request.query_params.get("access_token") or request.query_params.get("token")
    user = _user_from_token(authorization) or _user_from_bearer_token(access_token)
    if not user:
        return JSONResponse(
            status_code=401,
            content={
                "status": "error",
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Authentication required.",
                    "details": None,
                },
            },
        )

    return await call_next(request)
