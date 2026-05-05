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


def _unwrap_result(res: Dict[str, Any]) -> Dict[str, Any]:
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Operation failed."))
    return res

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
        return _unwrap_result(DBManager.create_database(req.name))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete")
def delete_database(req: DeleteDBRequest) -> Dict[str, Any]:
    try:
        return _unwrap_result(DBManager.delete_database(req.name))
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
        return _unwrap_result(DBManager.create_user(req.user, req.host, req.password, req.db))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/delete")
def delete_user(req: DeleteUserRequest) -> Dict[str, Any]:
    try:
        return _unwrap_result(DBManager.delete_user(req.user, req.host))
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


class EngineDeleteUser(BaseModel):
    user: str
    host: str = "localhost"


class EngineSetPassword(BaseModel):
    user: str
    password: str
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


@router.get("/overview")
def overview() -> Dict[str, Any]:
    mysql_dbs = DBManager.get_databases()
    mysql_users = DBManager.get_users()
    pg_dbs = PostgresManager.list_databases()
    pg_users = PostgresManager.list_users()
    return {
        "status": "success",
        "overview": {
            "mysql": {**DBManager.detect_status(), "database_count": len(mysql_dbs), "user_count": len(mysql_users)},
            "postgres": {**PostgresManager.detect_status(), "database_count": len(pg_dbs), "user_count": len(pg_users)},
        },
    }


@router.post("/engines/{engine}/password/generate")
def engine_generate_password(engine: str) -> Dict[str, Any]:
    impl = _engine(engine)
    if not hasattr(impl, "generate_password"):
        raise HTTPException(status_code=400, detail="Engine does not support password generator")
    return {"status": "success", "password": impl.generate_password()}


@router.get("/engines/{engine}/databases")
def engine_list(engine: str) -> Dict[str, Any]:
    impl = _engine(engine)
    if hasattr(impl, "list_databases"):
        return {"status": "success", "databases": impl.list_databases()}
    return {"status": "success", "databases": impl.get_databases()}


@router.post("/engines/{engine}/databases")
def engine_create(engine: str, req: EngineCreateDB) -> Dict[str, Any]:
    impl = _engine(engine)
    return _unwrap_result(impl.create_database(req.name))


@router.delete("/engines/{engine}/databases/{name}")
def engine_drop(engine: str, name: str) -> Dict[str, Any]:
    impl = _engine(engine)
    return _unwrap_result(impl.delete_database(name))


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
    return _unwrap_result(res)


@router.delete("/engines/{engine}/users")
def engine_user_delete(engine: str, req: EngineDeleteUser) -> Dict[str, Any]:
    impl = _engine(engine)
    if engine == "mysql":
        res = impl.delete_user(req.user, req.host)
    else:
        res = impl.delete_user(req.user)
    return _unwrap_result(res)


@router.post("/engines/{engine}/users/password")
def engine_user_password(engine: str, req: EngineSetPassword) -> Dict[str, Any]:
    impl = _engine(engine)
    if not hasattr(impl, "set_user_password"):
        raise HTTPException(status_code=400, detail="Engine does not support password update")
    if engine == "mysql":
        return _unwrap_result(impl.set_user_password(req.user, req.host, req.password))
    return _unwrap_result(impl.set_user_password(req.user, req.password))
