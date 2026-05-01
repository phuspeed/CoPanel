"""
File Manager Module Router
Handles listing, creating, renaming, deleting, moving, reading, and writing files.
"""
import os
import shutil
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()

# On Windows (non-Linux), fall back to mock data or localized project workspace path
IS_WINDOWS = os.name == 'nt'

# Define base/allowed directories
if IS_WINDOWS:
    # Current directory and workspace for Dev Compatibility
    ALLOWED_ROOTS = [os.path.abspath(os.getcwd()), "C:\\"]
else:
    ALLOWED_ROOTS = ["/var/www", "/root", "/opt", "/tmp"]

def get_base_root(requested_path: str) -> Optional[str]:
    """Check if the requested path starts with one of the allowed roots."""
    abs_requested = os.path.abspath(requested_path)
    for root in ALLOWED_ROOTS:
        try:
            abs_root = os.path.abspath(root)
            if abs_requested.startswith(abs_root):
                return abs_root
        except:
            continue
    return None

def check_safe_path(requested_path: str) -> str:
    """Validate and return safe absolute path."""
    # Return directly if not safe
    base = get_base_root(requested_path)
    if not base:
        # For full Dev Compatibility, if on Windows and path doesn't start with any allowed root,
        # fallback to current workspace's root.
        if IS_WINDOWS:
            return os.path.abspath(requested_path)
        raise HTTPException(
            status_code=403,
            detail=f"Access denied. Path must be inside: {ALLOWED_ROOTS}"
        )
    return os.path.abspath(requested_path)


# Schemas
class CreateFileRequest(BaseModel):
    path: str
    content: Optional[str] = ""

class CreateDirRequest(BaseModel):
    path: str

class RenameRequest(BaseModel):
    old_path: str
    new_path: str

class DeleteRequest(BaseModel):
    path: str

class MoveRequest(BaseModel):
    source_path: str
    target_path: str

class WriteFileRequest(BaseModel):
    path: str
    content: str


@router.get("/list")
async def list_directory(path: Optional[str] = Query(None)) -> Dict[str, Any]:
    """List directory contents."""
    try:
        if not path:
            # Provide default path based on environment
            path = ALLOWED_ROOTS[0]
        
        target_path = check_safe_path(path)
        if not os.path.exists(target_path):
            return {
                "status": "success",
                "path": target_path,
                "is_dir": False,
                "files": []
            }

        if not os.path.isdir(target_path):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")

        items = []
        for entry in os.scandir(target_path):
            try:
                stats = entry.stat()
                items.append({
                    "name": entry.name,
                    "path": os.path.abspath(entry.path),
                    "is_dir": entry.is_dir(),
                    "size": stats.st_size,
                    "modified": stats.st_mtime
                })
            except Exception:
                continue

        # Sort: directories first, then files alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return {
            "status": "success",
            "path": target_path,
            "files": items
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/read")
async def read_file(path: str) -> Dict[str, Any]:
    """Read file content."""
    try:
        target_path = check_safe_path(path)
        if not os.path.exists(target_path):
            raise HTTPException(status_code=404, detail="File not found.")

        if not os.path.isfile(target_path):
            raise HTTPException(status_code=400, detail="Path is a directory, not a file.")

        with open(target_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        return {
            "status": "success",
            "path": target_path,
            "content": content
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/write")
async def write_file(req: WriteFileRequest) -> Dict[str, Any]:
    """Write content to a file."""
    try:
        target_path = check_safe_path(req.path)
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(req.content)

        return {
            "status": "success",
            "message": "File updated successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-file")
async def create_file(req: CreateFileRequest) -> Dict[str, Any]:
    """Create a new file."""
    try:
        target_path = check_safe_path(req.path)
        if os.path.exists(target_path):
            raise HTTPException(status_code=400, detail="Path already exists.")

        with open(target_path, "w", encoding="utf-8") as f:
            f.write(req.content or "")

        return {
            "status": "success",
            "message": "File created successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-dir")
async def create_dir(req: CreateDirRequest) -> Dict[str, Any]:
    """Create a new directory."""
    try:
        target_path = check_safe_path(req.path)
        if os.path.exists(target_path):
            raise HTTPException(status_code=400, detail="Path already exists.")

        os.makedirs(target_path, exist_ok=True)

        return {
            "status": "success",
            "message": "Directory created successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rename")
async def rename_item(req: RenameRequest) -> Dict[str, Any]:
    """Rename a file or directory."""
    try:
        old_path = check_safe_path(req.old_path)
        new_path = check_safe_path(req.new_path)

        if not os.path.exists(old_path):
            raise HTTPException(status_code=404, detail="Source path not found.")

        if os.path.exists(new_path):
            raise HTTPException(status_code=400, detail="New path already exists.")

        os.rename(old_path, new_path)

        return {
            "status": "success",
            "message": "Item renamed successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete")
async def delete_item(req: DeleteRequest) -> Dict[str, Any]:
    """Delete a file or directory."""
    try:
        target_path = check_safe_path(req.path)
        if not os.path.exists(target_path):
            raise HTTPException(status_code=404, detail="Path not found.")

        if os.path.isdir(target_path):
            shutil.rmtree(target_path)
        else:
            os.remove(target_path)

        return {
            "status": "success",
            "message": "Item deleted successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/move")
async def move_item(req: MoveRequest) -> Dict[str, Any]:
    """Move/Cut-and-paste a file or directory."""
    try:
        source_path = check_safe_path(req.source_path)
        target_path = check_safe_path(req.target_path)

        if not os.path.exists(source_path):
            raise HTTPException(status_code=404, detail="Source path not found.")

        if os.path.exists(target_path):
            raise HTTPException(status_code=400, detail="Target path already exists.")

        shutil.move(source_path, target_path)

        return {
            "status": "success",
            "message": "Item moved successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
