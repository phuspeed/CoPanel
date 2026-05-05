"""
Authentication and User Management FastAPI Router.

NOTE: This router still keeps its own ``get_current_user`` for backwards
compatibility - other modules that imported it directly continue to work.
New modules should prefer ``core.auth.require_user`` / ``require_admin``.
"""
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin, require_user
from core.security import verify_password, create_access_token, verify_token
from core import user_model

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


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
    if not payload or "sub" not in payload:
        raise ApiError("UNAUTHORIZED", "Invalid or expired token.", http_status=401)
    user = user_model.get_user_by_username(payload["sub"])
    if not user:
        raise ApiError("UNAUTHORIZED", "Authenticated user not found.", http_status=401)
    return user


@router.post("/login")
def login(req: LoginRequest) -> Dict[str, Any]:
    """Authenticates users and produces a JWT access token."""
    user = user_model.get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        record_audit(
            "auth.login.fail",
            module="auth",
            target=req.username,
            actor=req.username,
            status="error",
        )
        raise ApiError("INVALID_CREDENTIALS", "Incorrect username or password.", http_status=401)

    token = create_access_token(data={"sub": user["username"]})
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
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "permitted_modules": user["permitted_modules"],
            "permitted_folders": user["permitted_folders"]
        }
    }


@router.get("/me")
def get_me(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Returns details about the current logged-in user."""
    return {
        "status": "success",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "permitted_modules": user["permitted_modules"],
            "permitted_folders": user["permitted_folders"]
        }
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
    import json
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
    import json
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
