"""
Database Manager Router

Phase 3: now multi-engine. Existing /list, /create, etc. keep MySQL for
backwards compatibility, while /engines/{engine}/* routes expose the
unified API (mysql / postgres) consumed by the new dashboard widgets and
Site Wizard.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from pydantic import BaseModel
from .logic import DBManager
from .postgres import PostgresManager

router = APIRouter()


def _engine(name: str):
    if name == "mysql":
        return DBManager
    if name == "postgres":
        return PostgresManager
    raise HTTPException(status_code=400, detail=f"Unsupported engine '{name}'.")

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


# ----- Multi-engine unified API (Phase 3) ------------------------------

class EngineCreateDB(BaseModel):
    name: str


class EngineCreateUser(BaseModel):
    user: str
    password: str
    db: str
    host: str = "localhost"


@router.get("/engines")
def list_engines() -> Dict[str, Any]:
    """Lightweight registry of database engines this panel can drive."""
    return {
        "status": "success",
        "engines": [
            {"id": "mysql", "name": "MySQL / MariaDB"},
            {"id": "postgres", "name": "PostgreSQL"},
        ],
    }


@router.get("/engines/{engine}/databases")
def engine_list(engine: str) -> Dict[str, Any]:
    impl = _engine(engine)
    if hasattr(impl, "list_databases"):
        return {"status": "success", "databases": impl.list_databases()}
    return {"status": "success", "databases": impl.get_databases()}


@router.post("/engines/{engine}/databases")
def engine_create(engine: str, req: EngineCreateDB) -> Dict[str, Any]:
    impl = _engine(engine)
    res = impl.create_database(req.name)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res


@router.delete("/engines/{engine}/databases/{name}")
def engine_drop(engine: str, name: str) -> Dict[str, Any]:
    impl = _engine(engine)
    res = impl.delete_database(name)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res


@router.get("/engines/{engine}/users")
def engine_users(engine: str) -> Dict[str, Any]:
    impl = _engine(engine)
    if hasattr(impl, "list_users"):
        return {"status": "success", "users": impl.list_users()}
    return {"status": "success", "users": impl.get_users()}


@router.post("/engines/{engine}/users")
def engine_user_create(engine: str, req: EngineCreateUser) -> Dict[str, Any]:
    impl = _engine(engine)
    if engine == "mysql":
        res = impl.create_user(req.user, req.host, req.password, req.db)
    else:
        res = impl.create_user(req.user, req.password, req.db)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res["message"])
    return res
