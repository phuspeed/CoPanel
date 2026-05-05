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

from fastapi import Header

from .api import ApiError
from .security import verify_token
from . import user_model


# Public endpoints exempt from auth even if the module wires the global
# dependency. ``auth/login`` must always stay public; the rest are usually
# health/status helpers.
_PUBLIC_PATHS = {"/api/auth/login"}

# When CoPanel is started in development without a database (e.g. a test
# harness) it can be useful to skip auth. Off by default in production.
_AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"


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


def _user_from_token(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    payload = verify_token(parts[1])
    if not payload or "sub" not in payload:
        return None
    return user_model.get_user_by_username(payload["sub"])


def require_user(authorization: str = Header(None)) -> Dict[str, Any]:
    """Standard dependency: returns the current user or raises 401."""
    if _AUTH_DISABLED:
        return {"id": 0, "username": "dev", "role": "superadmin", "permitted_modules": "[\"all\"]"}
    user = _user_from_token(authorization)
    if not user:
        raise ApiError("UNAUTHORIZED", "Authentication required.", http_status=401)
    return user


def require_admin(authorization: str = Header(None)) -> Dict[str, Any]:
    """Dependency that ensures the caller is a superadmin."""
    user = require_user(authorization)
    if user.get("role") != "superadmin":
        raise ApiError("FORBIDDEN", "Administrator privileges required.", http_status=403)
    return user


def require_module(module_id: str) -> Callable[..., Dict[str, Any]]:
    """Dependency factory that ensures the caller can access ``module_id``.

    Superadmins always pass; other users must include the module id (or
    ``"all"``) in their ``permitted_modules`` list.
    """

    def _dep(authorization: str = Header(None)) -> Dict[str, Any]:
        user = require_user(authorization)
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
