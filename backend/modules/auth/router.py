"""
Authentication and User Management FastAPI Router
"""
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel

from core.security import verify_password, create_access_token, verify_token
from core import user_model

router = APIRouter()


# Pydantic schemas
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
    """Dependency function to decode current user from token."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authentication header.")
    
    # Bearer <token>
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header format.")
    
    token = parts[1]
    payload = verify_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    
    user = user_model.get_user_by_username(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Authenticated user not found.")
    
    return user


@router.post("/login")
def login(req: LoginRequest) -> Dict[str, Any]:
    """Authenticates users and produces a JWT access token."""
    user = user_model.get_user_by_username(req.username)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    
    token = create_access_token(data={"sub": user["username"]})
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
def get_me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
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
def list_users(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Retrieves all registered user accounts on the panel."""
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Permission denied. Admin only.")
    return {
        "status": "success",
        "users": user_model.get_all_users()
    }


@router.post("/users")
def register_user(req: CreateUserRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Registers a new user profile on the system."""
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Permission denied. Admin only.")
    
    # Defaults
    import json
    try:
        user_id = user_model.create_user(
            username=req.username,
            password_plain=req.password,
            role=req.role,
            permitted_modules=json.dumps(req.permitted_modules),
            permitted_folders=json.dumps(req.permitted_folders)
        )
        return {
            "status": "success",
            "message": f"Successfully created user '{req.username}'",
            "user_id": user_id
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/users/{user_id}")
def edit_user(user_id: int, req: UpdateUserRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Updates user roles and permissions."""
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Permission denied. Admin only.")
    
    import json
    updated = user_model.update_user(
        user_id=user_id,
        role=req.role,
        permitted_modules=json.dumps(req.permitted_modules),
        permitted_folders=json.dumps(req.permitted_folders)
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    return {
        "status": "success",
        "message": f"Successfully updated user ID {user_id}"
    }


@router.delete("/users/{user_id}")
def remove_user(user_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Deletes a user account."""
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Permission denied. Admin only.")
    
    deleted = user_model.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found.")
    
    return {
        "status": "success",
        "message": f"Successfully deleted user ID {user_id}"
    }


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
def user_change_password(req: ChangePasswordRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Allows any logged-in user to change their own password, validating the old one."""
    if not verify_password(req.old_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect old password.")
    
    updated = user_model.change_password(user["id"], req.new_password)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to change password.")
    return {
        "status": "success",
        "message": "Password changed successfully."
    }
