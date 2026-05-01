"""
File Manager Module Router - Role-Based Sandbox
Handles listing, creating, renaming, deleting, moving, reading, and writing files.
Includes full system access for SuperAdmins and isolated sandbox for regular Users.
"""
import os
import json
import shutil
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from modules.auth.router import get_current_user

router = APIRouter()

IS_WINDOWS = os.name == 'nt'

def check_safe_path(requested_path: str, user: Dict[str, Any]) -> str:
    """Validate and return safe absolute path depending on User Role."""
    if not requested_path:
        # Default starting location based on role
        if user["role"] == "superadmin":
            requested_path = "C:\\" if IS_WINDOWS else "/"
        else:
            # First permitted folder or fallback
            p_folders = user.get("permitted_folders", "[]")
            if isinstance(p_folders, str):
                try:
                    p_folders = json.loads(p_folders)
                except:
                    p_folders = [p_folders]
            requested_path = p_folders[0] if (p_folders and len(p_folders) > 0) else "/home"

    # 1. SuperAdmin has unrestricted system-wide access
    if user["role"] == "superadmin":
        return os.path.abspath(requested_path)

    # 2. Regular User is strictly restricted to their permitted directories
    p_folders = user.get("permitted_folders", "[]")
    if isinstance(p_folders, str):
        try:
            p_folders = json.loads(p_folders)
        except:
            p_folders = [p_folders]

    if not p_folders:
        p_folders = ["/home"]

    abs_requested = os.path.abspath(requested_path)
    # Check if starts with any allowed user path
    for p in p_folders:
        try:
            abs_p = os.path.abspath(p)
            if abs_requested.startswith(abs_p):
                return abs_requested
        except:
            continue

    raise HTTPException(
        status_code=403,
        detail=f"Access denied. Normal users are strictly isolated to their home folders: {p_folders}"
    )


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
async def list_directory(path: Optional[str] = Query(None), user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """List directory contents."""
    try:
        target_path = check_safe_path(path, user)
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
async def read_file(path: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Read file content."""
    try:
        target_path = check_safe_path(path, user)
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
async def write_file_content(req: WriteFileRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Write content to a file."""
    try:
        target_path = check_safe_path(req.path, user)
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
async def create_file(req: CreateFileRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Create a new file."""
    try:
        target_path = check_safe_path(req.path, user)
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
async def create_dir(req: CreateDirRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Create a new directory."""
    try:
        target_path = check_safe_path(req.path, user)
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
async def rename_item(req: RenameRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Rename a file or directory."""
    try:
        old_path = check_safe_path(req.old_path, user)
        new_path = check_safe_path(req.new_path, user)

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
async def delete_item(req: DeleteRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Delete a file or directory."""
    try:
        target_path = check_safe_path(req.path, user)
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
async def move_item(req: MoveRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Move/Cut-and-paste a file or directory."""
    try:
        source_path = check_safe_path(req.source_path, user)
        target_path = check_safe_path(req.target_path, user)

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


class CopyRequest(BaseModel):
    source_paths: List[str]
    target_dir: str

class MoveMultipleRequest(BaseModel):
    source_paths: List[str]
    target_dir: str

class DeleteMultipleRequest(BaseModel):
    paths: List[str]

class ZipRequest(BaseModel):
    paths: List[str]
    archive_path: str

class ExtractRequest(BaseModel):
    archive_path: str
    target_dir: str

class ChmodRequest(BaseModel):
    paths: List[str]
    mode: str


@router.post("/copy")
async def copy_items(req: CopyRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Copy files and directories to target directory."""
    try:
        target_dir = check_safe_path(req.target_dir, user)
        if not os.path.exists(target_dir):
            raise HTTPException(status_code=404, detail="Target directory does not exist.")
        if not os.path.isdir(target_dir):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")

        for p in req.source_paths:
            source_path = check_safe_path(p, user)
            if not os.path.exists(source_path):
                raise HTTPException(status_code=404, detail=f"Source path not found: {p}")
            
            base_name = os.path.basename(source_path)
            dest = os.path.join(target_dir, base_name)
            if os.path.exists(dest):
                dest = os.path.join(target_dir, f"copy_of_{base_name}")
            
            if os.path.isdir(source_path):
                shutil.copytree(source_path, dest)
            else:
                shutil.copy2(source_path, dest)

        return {"status": "success", "message": "Items copied successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/move-multiple")
async def move_multiple_items(req: MoveMultipleRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Move multiple files or directories to target directory."""
    try:
        target_dir = check_safe_path(req.target_dir, user)
        if not os.path.exists(target_dir):
            raise HTTPException(status_code=404, detail="Target directory does not exist.")
        if not os.path.isdir(target_dir):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")

        for p in req.source_paths:
            source_path = check_safe_path(p, user)
            if not os.path.exists(source_path):
                continue
            
            base_name = os.path.basename(source_path)
            dest = os.path.join(target_dir, base_name)
            if os.path.exists(dest):
                if os.path.isdir(dest):
                    shutil.rmtree(dest)
                else:
                    os.remove(dest)
            
            shutil.move(source_path, dest)

        return {"status": "success", "message": "Items moved successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete-multiple")
async def delete_multiple_items(req: DeleteMultipleRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Delete multiple files or directories."""
    try:
        for p in req.paths:
            target_path = check_safe_path(p, user)
            if not os.path.exists(target_path):
                continue

            if os.path.isdir(target_path):
                shutil.rmtree(target_path)
            else:
                os.remove(target_path)

        return {"status": "success", "message": "Items deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/zip")
async def zip_items(req: ZipRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Compress files/folders into a zip archive."""
    try:
        import zipfile
        archive_path = check_safe_path(req.archive_path, user)
        
        if not archive_path.endswith('.zip'):
            archive_path += '.zip'
            
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for p in req.paths:
                abs_p = check_safe_path(p, user)
                if not os.path.exists(abs_p):
                    continue
                
                if os.path.isdir(abs_p):
                    for root, dirs, files in os.walk(abs_p):
                        for file in files:
                            file_path = os.path.join(root, file)
                            rel_path = os.path.relpath(file_path, os.path.dirname(abs_p))
                            zip_file.write(file_path, rel_path)
                else:
                    zip_file.write(abs_p, os.path.basename(abs_p))

        return {"status": "success", "message": "Items compressed successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract")
async def extract_item(req: ExtractRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Extract a zip archive to the target directory."""
    try:
        import zipfile
        archive_path = check_safe_path(req.archive_path, user)
        target_dir = check_safe_path(req.target_dir, user)
        
        if not os.path.exists(archive_path):
            raise HTTPException(status_code=404, detail="Archive file not found.")
        if not zipfile.is_zipfile(archive_path):
            raise HTTPException(status_code=400, detail="Path is not a valid zip file.")
            
        os.makedirs(target_dir, exist_ok=True)
        with zipfile.ZipFile(archive_path, 'r') as zip_file:
            zip_file.extractall(target_dir)

        return {"status": "success", "message": "Archive extracted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chmod")
async def chmod_items(req: ChmodRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Change item permissions."""
    try:
        mode_str = req.mode
        if not mode_str:
            mode_str = "755"
        
        try:
            mode_int = int(mode_str, 8)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid octal mode string.")

        for p in req.paths:
            abs_p = check_safe_path(p, user)
            if os.path.exists(abs_p):
                try:
                    os.chmod(abs_p, mode_int)
                except Exception:
                    pass

        return {"status": "success", "message": "Permissions updated successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

