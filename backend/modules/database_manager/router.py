"""
Database Manager Router
Exposes FastAPI endpoints to list, create, and remove MySQL databases.
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
