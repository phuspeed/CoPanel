"""
rsync_manager — SSH compatibility checks and rsync over SSH (optional AppStore module).
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.api import ApiError, ok
from core.auth import require_module

from . import logic

router = APIRouter()


class CompatibilityBody(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    port: int = Field(22, ge=1, le=65535)
    user: str = Field(..., min_length=1, max_length=64)
    identity_file: Optional[str] = Field(None, max_length=4096)
    estimated_bytes: int = Field(0, ge=0, le=2**50)


class SyncBody(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    port: int = Field(22, ge=1, le=65535)
    user: str = Field(..., min_length=1, max_length=64)
    identity_file: Optional[str] = Field(None, max_length=4096)
    local_path: str = Field(..., min_length=1, max_length=4096)
    remote_path: str = Field(..., min_length=1, max_length=2048)
    excludes: List[str] = Field(default_factory=list)
    dry_run: bool = True


@router.get("/presets")
def get_presets(user: Dict[str, Any] = Depends(require_module("rsync_manager"))):
    return ok(
        {
            "copanel": {
                "label_en": "CoPanel install tree (/opt/copanel)",
                "label_vi": "Cây cài CoPanel (/opt/copanel)",
                "excludes": logic.PRESET_EXCLUDES_COPANEL,
            }
        }
    )


@router.get("/version")
def get_version(user: Dict[str, Any] = Depends(require_module("rsync_manager"))):
    from pathlib import Path

    vfile = Path(__file__).resolve().parent / "version.txt"
    ver = vfile.read_text(encoding="utf-8").strip() if vfile.is_file() else "0"
    return ok({"module": "rsync_manager", "version": ver})


@router.post("/compatibility")
def post_compatibility(
    body: CompatibilityBody,
    user: Dict[str, Any] = Depends(require_module("rsync_manager")),
):
    try:
        margin = int(body.estimated_bytes * 1.15) if body.estimated_bytes > 0 else 0
        result = logic.compatibility_check(
            body.host.strip(),
            body.port,
            body.user.strip(),
            (body.identity_file.strip() if body.identity_file else None) or None,
            min_free_bytes=margin,
        )
    except ValueError as e:
        raise ApiError("VALIDATION_ERROR", str(e), http_status=400)
    return ok(result)


@router.post("/sync")
def post_sync(
    body: SyncBody,
    user: Dict[str, Any] = Depends(require_module("rsync_manager")),
):
    try:
        result = logic.run_rsync(
            body.host.strip(),
            body.port,
            body.user.strip(),
            (body.identity_file.strip() if body.identity_file else None) or None,
            body.local_path.strip(),
            body.remote_path.strip(),
            body.excludes,
            dry_run=body.dry_run,
            delete=False,
        )
    except ValueError as e:
        raise ApiError("VALIDATION_ERROR", str(e), http_status=400)
    except RuntimeError as e:
        raise ApiError("RUNTIME_ERROR", str(e), http_status=500)
    return ok(result)
