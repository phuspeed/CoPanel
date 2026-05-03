"""
Database Manager Router
Exposes FastAPI endpoints to list, create, and remove MySQL databases and users.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from pydantic import BaseModel
from .logic import DBManager

router = APIRouter()

class CreateDBRequest(BaseModel):
    name: str

class DeleteDBRequest(BaseModel):
    name: str

class CreateUserRequest(BaseModel):
    user: str
    host: str = "localhost"
    password: str
    db: str

class DeleteUserRequest(BaseModel):
    user: str
    host: str = "localhost"

@router.get("/list")
def list_databases() -> Dict[str, Any]:
    try:
        dbs = DBManager.get_databases()
        return {"status": "success", "databases": dbs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/create")
def create_database(req: CreateDBRequest) -> Dict[str, Any]:
    try:
        res = DBManager.create_database(req.name)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete")
def delete_database(req: DeleteDBRequest) -> Dict[str, Any]:
    try:
        res = DBManager.delete_database(req.name)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/users")
def list_users() -> Dict[str, Any]:
    try:
        users = DBManager.get_users()
        return {"status": "success", "users": users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/create")
def create_user(req: CreateUserRequest) -> Dict[str, Any]:
    try:
        res = DBManager.create_user(req.user, req.host, req.password, req.db)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/delete")
def delete_user(req: DeleteUserRequest) -> Dict[str, Any]:
    try:
        res = DBManager.delete_user(req.user, req.host)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
