from typing import Any, Dict, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module

from . import logic

router = APIRouter()

class CleanRequest(BaseModel):
    categories: List[str]

class DeleteRequest(BaseModel):
    path: str

@router.get("/junk")
def get_junk_info(user: Dict[str, Any] = Depends(require_module("system_cleaner"))) -> Dict[str, Any]:
    return ok(logic.get_junk_info())

@router.post("/clean")
def clean_junk(req: CleanRequest, user: Dict[str, Any] = Depends(require_module("system_cleaner"))) -> Dict[str, Any]:
    if not req.categories:
        raise ApiError("VALIDATION_ERROR", "No categories provided for cleaning.")
    
    result = logic.clean_junk(req.categories)
    
    record_audit(
        "cleaner.clean",
        module="system_cleaner",
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"categories": req.categories, "logs": result.get("logs")}
    )
    
    return ok(result)

@router.get("/disk/tree")
def get_disk_tree(path: str = "/", user: Dict[str, Any] = Depends(require_module("system_cleaner"))) -> Dict[str, Any]:
    try:
        items = logic.get_disk_tree(path)
        return ok({"path": path, "items": items})
    except ValueError as e:
        raise ApiError("VALIDATION_ERROR", str(e), http_status=400)
    except Exception as e:
        raise ApiError("INTERNAL_ERROR", str(e), http_status=500)

@router.get("/disk/large-files")
def get_large_files(path: str = "/", min_size_mb: int = 50, user: Dict[str, Any] = Depends(require_module("system_cleaner"))) -> Dict[str, Any]:
    try:
        items = logic.get_large_files(path, min_size_mb)
        return ok({"path": path, "items": items})
    except Exception as e:
        raise ApiError("INTERNAL_ERROR", str(e), http_status=500)

@router.delete("/disk/delete")
def delete_file_or_dir(req: DeleteRequest, user: Dict[str, Any] = Depends(require_module("system_cleaner"))) -> Dict[str, Any]:
    try:
        success = logic.delete_file_or_dir(req.path)
        if not success:
            raise ApiError("NOT_FOUND", "Path not found.")
            
        record_audit(
            "cleaner.delete",
            module="system_cleaner",
            target=req.path,
            actor=user.get("username"),
            actor_id=user.get("id")
        )
        return ok({"deleted": True})
    except ValueError as e:
        raise ApiError("VALIDATION_ERROR", str(e), http_status=400)
    except Exception as e:
        raise ApiError("INTERNAL_ERROR", str(e), http_status=500)
