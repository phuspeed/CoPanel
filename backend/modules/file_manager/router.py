"""
File Manager Module Router - Role-Based Sandbox
Handles listing, creating, renaming, deleting, moving, reading, and writing files.
Includes full system access for SuperAdmins and isolated sandbox for regular Users.
"""
import os
import json
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from modules.auth.router import get_current_user
from core.auth import require_module
try:
    from core.user_home import chown_new, owner_for
except ImportError:  # AppStore zip installed on a core older than 1.1.12
    def chown_new(paths, user, recursive=False):  # type: ignore[no-redef]
        return None

    def owner_for(path, user):  # type: ignore[no-redef]
        return None
try:
    from core import safe_fs
except ImportError:  # core older than 1.1.15: restricted users are refused (fail closed)
    safe_fs = None  # type: ignore[assignment]

# Every endpoint also requires the file_manager module grant (superadmin always passes).
router = APIRouter(dependencies=[Depends(require_module("file_manager"))])

IS_WINDOWS = os.name == 'nt'

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
BOOKMARKS_STORE_DIR = os.path.join(MODULE_DIR, "bookmarks_store")
MAX_BOOKMARKS = 100

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
            if not p_folders:
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: no folders are assigned to this account.",
                )
            requested_path = p_folders[0]

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

    if not isinstance(p_folders, list):
        p_folders = []
    p_folders = [p for p in p_folders if isinstance(p, str) and p.strip() and os.path.isabs(p.strip())]
    if not p_folders:
        # No assigned folders means no file access at all (never a /home fallback).
        raise HTTPException(status_code=403, detail="Access denied: no folders are assigned to this account.")

    try:
        abs_requested = Path(requested_path).resolve()
    except (OSError, RuntimeError, ValueError):
        raise HTTPException(status_code=403, detail="Access denied: invalid path.")

    for p in p_folders:
        try:
            abs_p = Path(p).resolve()
        except (OSError, RuntimeError, ValueError):
            continue
        try:
            if abs_requested == abs_p or abs_requested.is_relative_to(abs_p):
                return str(abs_requested)
        except AttributeError:
            # Python < 3.9 fallback (not expected on panel hosts)
            prefix = str(abs_p)
            req_s = str(abs_requested)
            if req_s == prefix or req_s.startswith(prefix + os.sep):
                return req_s

    raise HTTPException(
        status_code=403,
        detail=f"Access denied. Normal users are strictly isolated to their home folders: {p_folders}"
    )


def safe_child_name(name: Optional[str]) -> str:
    """Reduce a client-supplied file name to a single safe path component.

    Directory components (``/`` and ``\\``) are stripped; empty, ``.``, ``..``
    and names containing NUL are rejected with 400.
    """
    if not name or "\x00" in name:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    base = name.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    if not base or base in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return base


def safe_join(target_dir: str, name: str, user: Dict[str, Any]) -> str:
    """Join ``name`` under ``target_dir`` and re-validate the final path.

    ``check_safe_path`` resolves symlinks for sandboxed users, so a child that
    is (or traverses) a symlink pointing outside the permitted folders is 403.
    The final path must also stay directly inside ``target_dir``.
    """
    candidate = os.path.join(target_dir, name)
    if os.path.dirname(os.path.abspath(candidate)) != os.path.abspath(target_dir):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return check_safe_path(candidate, user)


CONFLICT_POLICIES = ("overwrite", "skip", "rename", "error")


def _conflict_policy(value: Optional[str], default: str) -> str:
    """Normalize an ``on_conflict`` value; unknown values are rejected with 400."""
    if value is None or value == "":
        return default
    v = str(value).strip().lower()
    if v not in CONFLICT_POLICIES:
        raise HTTPException(status_code=400, detail="on_conflict must be overwrite, skip, rename or error.")
    return v


def _relative_parts(rel: Optional[str]) -> List[str]:
    """Split a client relative path (``site/css/a.css``) into safe components.

    Absolute paths, ``.``/``..``, empty components (``a//b``), backslashes and
    NUL are rejected with 400, so the result can only point below the target.
    """
    if rel is None or rel == "":
        return []
    if "\x00" in rel or "\\" in rel or rel.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid relative path.")
    parts = rel.split("/")
    if len(parts) > 64:
        raise HTTPException(status_code=400, detail="Relative path is too deep.")
    for part in parts:
        if not part or part in (".", "..") or len(part) > 255:
            raise HTTPException(status_code=400, detail="Invalid relative path.")
    return parts


def _free_name(target_dir: str, name: str) -> str:
    """First ``name (n).ext`` that does not exist in ``target_dir``."""
    stem, ext = os.path.splitext(name)
    if stem == "":  # dotfile such as ".env"
        stem, ext = name, ""
    for n in range(1, 1000):
        candidate = f"{stem} ({n}){ext}"
        if not os.path.lexists(os.path.join(target_dir, candidate)):
            return candidate
    raise HTTPException(status_code=409, detail="Could not find a free name.")


def _is_same_or_inside(path: str, ancestor: str) -> bool:
    p = os.path.realpath(path)
    a = os.path.realpath(ancestor)
    return p == a or p.startswith(a.rstrip(os.sep) + os.sep)


def _restricted(user: Dict[str, Any]) -> bool:
    """Sandboxed user: every filesystem call goes through ``core.safe_fs``."""
    if user.get("role") == "superadmin":
        return False
    if safe_fs is None or not safe_fs.supported():
        raise HTTPException(
            status_code=503,
            detail="This File Manager needs CoPanel 1.1.15 or newer for restricted users. Update CoPanel first.",
        )
    return True


def _fs_error(exc: Exception) -> HTTPException:
    """Map filesystem errors to HTTP errors."""
    if isinstance(exc, HTTPException):
        return exc
    if safe_fs is not None and isinstance(exc, safe_fs.SymlinkRefused):
        return HTTPException(status_code=403, detail="Access denied: the path contains a symbolic link or a hard-linked file.")
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail="Path not found.")
    if isinstance(exc, FileExistsError):
        return HTTPException(status_code=400, detail="Path already exists.")
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail="Permission denied.")
    if isinstance(exc, (IsADirectoryError, NotADirectoryError)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


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


class BookmarkEntry(BaseModel):
    path: str
    is_dir: bool
    label: Optional[str] = ""


class BookmarksPayload(BaseModel):
    bookmarks: List[BookmarkEntry]


def _bookmarks_json_path(user_id: int) -> str:
    os.makedirs(BOOKMARKS_STORE_DIR, exist_ok=True)
    return os.path.join(BOOKMARKS_STORE_DIR, f"{user_id}.json")


def _load_bookmarks_raw(user_id: int) -> List[Dict[str, Any]]:
    fp = _bookmarks_json_path(user_id)
    if not os.path.isfile(fp):
        return []
    try:
        with open(fp, "r", encoding="utf-8") as f:
            data = json.load(f)
        items = data.get("bookmarks")
        if not isinstance(items, list):
            return []
        return items
    except Exception:
        return []


def _save_bookmarks_raw(user_id: int, items: List[Dict[str, Any]]) -> None:
    fp = _bookmarks_json_path(user_id)
    payload = {"version": 1, "bookmarks": items}
    tmp = fp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp, fp)


def _normalize_bookmark_entry(it: Dict[str, Any], user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    p = it.get("path")
    if not p or not isinstance(p, str):
        return None
    try:
        safe = check_safe_path(p, user)
    except HTTPException:
        return None
    abs_p = os.path.abspath(safe)
    label = it.get("label") if isinstance(it.get("label"), str) else ""
    label = label.strip()[:200]
    return {
        "path": abs_p,
        "is_dir": bool(it.get("is_dir", False)),
        "label": label,
    }


@router.get("/bookmarks")
async def get_bookmarks(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Load saved path bookmarks for the current user (JSON file per user id)."""
    uid = user.get("id")
    if uid is None:
        raise HTTPException(status_code=401, detail="Missing user id in session.")
    raw = _load_bookmarks_raw(int(uid))
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        norm = _normalize_bookmark_entry(it, user)
        if not norm:
            continue
        key = norm["path"]
        if key in seen:
            continue
        seen.add(key)
        out.append(norm)
    return {"status": "success", "bookmarks": out}


@router.put("/bookmarks")
async def put_bookmarks(req: BookmarksPayload, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Replace all bookmarks (validated paths, deduped). Persists to JSON."""
    uid = user.get("id")
    if uid is None:
        raise HTTPException(status_code=401, detail="Missing user id in session.")
    if len(req.bookmarks) > MAX_BOOKMARKS:
        raise HTTPException(status_code=400, detail=f"Too many bookmarks (max {MAX_BOOKMARKS}).")
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for b in req.bookmarks:
        norm = _normalize_bookmark_entry(b.model_dump(), user)
        if not norm:
            continue
        key = norm["path"]
        if key in seen:
            continue
        seen.add(key)
        out.append(norm)
    _save_bookmarks_raw(int(uid), out)
    return {"status": "success", "bookmarks": out}


@router.get("/list")
async def list_directory(
    path: Optional[str] = Query(None),
    must_exist: bool = Query(False),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """List directory contents.

    ``must_exist=1`` (used by the typed path bar) returns 404 for a missing
    path instead of an empty listing. Access rules are unchanged: the path is
    always validated by ``check_safe_path`` first. Listing never creates
    folders (missing permitted folders are created at login / user save).
    """
    try:
        target_path = check_safe_path(path, user)
        restricted = _restricted(user)
        if not os.path.exists(target_path):
            if must_exist:
                raise HTTPException(status_code=404, detail="Path not found.")
            return {
                "status": "success",
                "path": target_path,
                "is_dir": False,
                "files": []
            }

        if not os.path.isdir(target_path):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")

        if must_exist and not os.access(target_path, os.R_OK | os.X_OK):
            raise HTTPException(status_code=403, detail="Permission denied.")

        items = []
        try:
            if restricted:
                with safe_fs.dir_fd(target_path) as dfd:
                    entries = list(os.scandir(dfd))
                    for entry in entries:
                        try:
                            lst = os.stat(entry.name, dir_fd=dfd, follow_symlinks=False)
                            is_dir = stat_is_dir(lst.st_mode)
                            items.append({
                                "name": entry.name,
                                "path": os.path.join(target_path, entry.name),
                                "is_dir": is_dir,
                                "is_symlink": stat_is_link(lst.st_mode),
                                "size": lst.st_size,
                                "modified": lst.st_mtime,
                            })
                        except OSError:
                            continue
            else:
                entries = list(os.scandir(target_path))
                for entry in entries:
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
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied.")

        # Sort: directories first, then files alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return {
            "status": "success",
            "path": target_path,
            "files": items
        }
    except Exception as e:
        raise _fs_error(e)


def stat_is_dir(mode: int) -> bool:
    import stat as _stat
    return _stat.S_ISDIR(mode)


def stat_is_link(mode: int) -> bool:
    import stat as _stat
    return _stat.S_ISLNK(mode)


@router.get("/read")
async def read_file(path: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Read file content."""
    try:
        target_path = check_safe_path(path, user)
        if not os.path.exists(target_path):
            raise HTTPException(status_code=404, detail="File not found.")

        if not os.path.isfile(target_path):
            raise HTTPException(status_code=400, detail="Path is a directory, not a file.")

        if _restricted(user):
            content = safe_fs.read_bytes(target_path).decode("utf-8", errors="ignore")
        else:
            with open(target_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

        return {
            "status": "success",
            "path": target_path,
            "content": content
        }
    except Exception as e:
        raise _fs_error(e)


@router.post("/write")
async def write_file_content(req: WriteFileRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Write content to a file."""
    try:
        target_path = check_safe_path(req.path, user)
        if _restricted(user):
            safe_fs.write_bytes(target_path, req.content.encode("utf-8"), owner_for(target_path, user))
        else:
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(req.content)

        return {
            "status": "success",
            "message": "File updated successfully."
        }
    except Exception as e:
        raise _fs_error(e)


@router.post("/create-file")
async def create_file(req: CreateFileRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Create a new file."""
    try:
        target_path = check_safe_path(req.path, user)
        if os.path.lexists(target_path):
            raise HTTPException(status_code=400, detail="Path already exists.")

        if _restricted(user):
            safe_fs.write_bytes(
                target_path, (req.content or "").encode("utf-8"), owner_for(target_path, user), exclusive=True
            )
        else:
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(req.content or "")

        return {
            "status": "success",
            "message": "File created successfully."
        }
    except Exception as e:
        raise _fs_error(e)


@router.post("/create-dir")
async def create_dir(req: CreateDirRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Create a new directory."""
    try:
        target_path = check_safe_path(req.path, user)
        if os.path.lexists(target_path):
            raise HTTPException(status_code=400, detail="Path already exists.")

        if _restricted(user):
            safe_fs.makedirs(target_path, owner_for(target_path, user))
        else:
            os.makedirs(target_path, exist_ok=True)

        return {
            "status": "success",
            "message": "Directory created successfully."
        }
    except Exception as e:
        raise _fs_error(e)


@router.post("/rename")
async def rename_item(req: RenameRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Rename a file or directory."""
    try:
        old_path = check_safe_path(req.old_path, user)
        new_path = check_safe_path(req.new_path, user)

        if not os.path.lexists(old_path):
            raise HTTPException(status_code=404, detail="Source path not found.")

        if os.path.lexists(new_path):
            raise HTTPException(status_code=400, detail="New path already exists.")

        if _restricted(user):
            safe_fs.rename(old_path, new_path)
        else:
            os.rename(old_path, new_path)

        return {
            "status": "success",
            "message": "Item renamed successfully."
        }
    except Exception as e:
        raise _fs_error(e)


def _delete_path(target_path: str, user: Dict[str, Any]) -> None:
    if _restricted(user):
        safe_fs.remove(target_path)
    elif os.path.isdir(target_path) and not os.path.islink(target_path):
        shutil.rmtree(target_path)
    else:
        os.remove(target_path)


@router.post("/delete")
async def delete_item(req: DeleteRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Delete a file or directory."""
    try:
        target_path = check_safe_path(req.path, user)
        if not os.path.lexists(target_path):
            raise HTTPException(status_code=404, detail="Path not found.")
        _delete_path(target_path, user)

        return {
            "status": "success",
            "message": "Item deleted successfully."
        }
    except Exception as e:
        raise _fs_error(e)


def _move_path(source_path: str, dest: str, user: Dict[str, Any]) -> None:
    if not _restricted(user):
        shutil.move(source_path, dest)
        return
    try:
        safe_fs.rename(source_path, dest)
    except OSError as exc:
        import errno as _errno
        if exc.errno != _errno.EXDEV:
            raise
        # Different filesystem: symlink-safe copy, then delete the source.
        safe_fs.copy(source_path, dest, owner_for(dest, user))
        safe_fs.remove(source_path)


@router.post("/move")
async def move_item(req: MoveRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Move/Cut-and-paste a file or directory."""
    try:
        source_path = check_safe_path(req.source_path, user)
        target_path = check_safe_path(req.target_path, user)

        if not os.path.lexists(source_path):
            raise HTTPException(status_code=404, detail="Source path not found.")

        if os.path.lexists(target_path):
            raise HTTPException(status_code=400, detail="Target path already exists.")

        _move_path(source_path, target_path, user)

        return {
            "status": "success",
            "message": "Item moved successfully."
        }
    except Exception as e:
        raise _fs_error(e)


class CopyRequest(BaseModel):
    source_paths: List[str]
    target_dir: str
    # None keeps the old behaviour (a clash is copied as ``copy_of_<name>``).
    on_conflict: Optional[str] = None

class MoveMultipleRequest(BaseModel):
    source_paths: List[str]
    target_dir: str
    # None keeps the old behaviour (a clash is overwritten).
    on_conflict: Optional[str] = None

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
    """Copy files and directories to target directory.

    Symbolic links inside a copied tree are copied as links (never followed),
    so a copy can never pull in content from outside the source tree.

    ``on_conflict``: ``rename`` (``name (1).ext``), ``skip``, ``overwrite`` or
    ``error`` (409). Omitted keeps the legacy ``copy_of_<name>`` behaviour.
    """
    try:
        policy = _conflict_policy(req.on_conflict, "legacy") if req.on_conflict else "legacy"
        target_dir = check_safe_path(req.target_dir, user)
        if not os.path.exists(target_dir):
            raise HTTPException(status_code=404, detail="Target directory does not exist.")
        if not os.path.isdir(target_dir):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")
        restricted = _restricted(user)
        copied: List[str] = []
        skipped: List[str] = []

        for p in req.source_paths:
            source_path = check_safe_path(p, user)
            if not os.path.lexists(source_path):
                raise HTTPException(status_code=404, detail=f"Source path not found: {p}")
            if os.path.isdir(source_path) and not os.path.islink(source_path) and _is_same_or_inside(target_dir, source_path):
                raise HTTPException(status_code=400, detail="Cannot copy a folder into itself.")

            base_name = safe_child_name(os.path.basename(source_path))
            dest = safe_join(target_dir, base_name, user)
            if os.path.lexists(dest):
                same = os.path.realpath(dest) == os.path.realpath(source_path)
                if policy == "legacy":
                    dest = safe_join(target_dir, f"copy_of_{base_name}", user)
                    if os.path.lexists(dest):
                        raise HTTPException(status_code=400, detail=f"Target already exists: {dest}")
                elif policy == "skip":
                    skipped.append(dest)
                    continue
                elif policy == "error":
                    raise HTTPException(status_code=409, detail=f"Target already exists: {dest}")
                elif policy == "rename" or same:
                    dest = safe_join(target_dir, _free_name(target_dir, base_name), user)
                else:  # overwrite
                    _delete_path(dest, user)

            if restricted:
                safe_fs.copy(source_path, dest, owner_for(dest, user))
            elif os.path.isdir(source_path) and not os.path.islink(source_path):
                shutil.copytree(source_path, dest, symlinks=True)
            else:
                shutil.copy2(source_path, dest, follow_symlinks=False)
            copied.append(dest)

        return {"status": "success", "message": "Items copied successfully.", "copied": copied, "skipped": skipped}
    except Exception as e:
        raise _fs_error(e)


@router.post("/move-multiple")
async def move_multiple_items(req: MoveMultipleRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Move multiple files or directories to target directory.

    ``on_conflict``: ``overwrite`` (default, legacy), ``skip``, ``rename`` or
    ``error`` (409). Moving an item onto itself is a no-op; moving a folder
    into itself or one of its sub-folders is refused (400).
    """
    try:
        policy = _conflict_policy(req.on_conflict, "overwrite")
        target_dir = check_safe_path(req.target_dir, user)
        if not os.path.exists(target_dir):
            raise HTTPException(status_code=404, detail="Target directory does not exist.")
        if not os.path.isdir(target_dir):
            raise HTTPException(status_code=400, detail="Target path is not a directory.")
        moved: List[str] = []
        skipped: List[str] = []

        for p in req.source_paths:
            source_path = check_safe_path(p, user)
            if not os.path.lexists(source_path):
                continue
            if os.path.isdir(source_path) and not os.path.islink(source_path) and _is_same_or_inside(target_dir, source_path):
                raise HTTPException(status_code=400, detail="Cannot move a folder into itself.")

            base_name = safe_child_name(os.path.basename(source_path))
            # Validate the final destination (rejects a symlink pointing outside
            # the sandbox) but keep operating on the in-directory name.
            safe_join(target_dir, base_name, user)
            dest = os.path.join(target_dir, base_name)
            if os.path.abspath(os.path.dirname(source_path)) == os.path.abspath(target_dir):
                skipped.append(dest)  # already there
                continue
            if os.path.lexists(dest):
                if policy == "skip":
                    skipped.append(dest)
                    continue
                if policy == "error":
                    raise HTTPException(status_code=409, detail=f"Target already exists: {dest}")
                if policy == "rename":
                    new_name = _free_name(target_dir, base_name)
                    safe_join(target_dir, new_name, user)
                    dest = os.path.join(target_dir, new_name)
                else:
                    _delete_path(dest, user)

            _move_path(source_path, dest, user)
            moved.append(dest)

        return {"status": "success", "message": "Items moved successfully.", "moved": moved, "skipped": skipped}
    except Exception as e:
        raise _fs_error(e)


@router.post("/delete-multiple")
async def delete_multiple_items(req: DeleteMultipleRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Delete multiple files or directories."""
    try:
        for p in req.paths:
            target_path = check_safe_path(p, user)
            if not os.path.lexists(target_path):
                continue
            _delete_path(target_path, user)

        return {"status": "success", "message": "Items deleted successfully."}
    except Exception as e:
        raise _fs_error(e)


@router.post("/zip")
async def zip_items(req: ZipRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Compress files/folders into a zip archive (symlinks are skipped)."""
    try:
        import zipfile
        archive_path = check_safe_path(req.archive_path, user)

        if not archive_path.endswith('.zip'):
            archive_path = check_safe_path(archive_path + '.zip', user)
        restricted = _restricted(user)
        sources = []
        for p in req.paths:
            abs_p = check_safe_path(p, user)
            if os.path.lexists(abs_p):
                sources.append(abs_p)

        if restricted:
            out_fd = safe_fs.open_write(archive_path, owner_for(archive_path, user))
            out_fh = os.fdopen(out_fd, "wb")
        else:
            out_fh = open(archive_path, "wb")
        with out_fh, zipfile.ZipFile(out_fh, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for abs_p in sources:
                if os.path.isdir(abs_p) and not os.path.islink(abs_p):
                    base_dir = os.path.dirname(abs_p)
                    if restricted:
                        for rel, dfd, name in safe_fs.walk_files(abs_p):
                            fd = safe_fs.open_read_at(dfd, name)
                            with os.fdopen(fd, "rb") as src, zip_file.open(rel.replace('\\', '/'), "w") as dst:
                                shutil.copyfileobj(src, dst, 1024 * 1024)
                    else:
                        for root, dirs, files in os.walk(abs_p):
                            for file in files:
                                file_path = os.path.join(root, file)
                                if os.path.islink(file_path):
                                    continue
                                rel_path = os.path.relpath(file_path, base_dir).replace('\\', '/')
                                zip_file.write(file_path, rel_path)
                elif restricted:
                    fd = safe_fs.open_read(abs_p)
                    with os.fdopen(fd, "rb") as src, zip_file.open(os.path.basename(abs_p), "w") as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
                elif not os.path.islink(abs_p):
                    zip_file.write(abs_p, os.path.basename(abs_p))

        return {"status": "success", "message": "Items compressed successfully."}
    except Exception as e:
        raise _fs_error(e)


def _normalize_zip_member(name: str) -> str:
    """Normalize archive member paths — Windows zips often use backslashes."""
    member = name.replace('\\', '/')
    while member.startswith('/'):
        member = member[1:]
    if len(member) >= 2 and member[1] == ':':
        member = member.split(':', 1)[1].lstrip('/')
    return member


def _assert_extract_dest(dest: str, target_root: str, raw_name: str) -> str:
    """Zip-slip guard: resolved path must stay under target_root."""
    dest_real = os.path.realpath(dest)
    root = os.path.realpath(target_root)
    prefix = root if root.endswith(os.sep) else root + os.sep
    if dest_real != root and not dest_real.startswith(prefix):
        raise HTTPException(status_code=400, detail=f"Unsafe path in archive: {raw_name}")
    return dest_real


def _safe_extract_zip(zip_file, target_dir: str, owner=None, restricted: bool = False) -> List[str]:
    """Extract zip members with normalized paths and directory creation.

    Restricted users: every directory and file is created through
    ``core.safe_fs`` (no symlink is ever followed, new items get ``owner``
    from the fd). Returns the files and directories this call created.
    """
    target_root = os.path.realpath(target_dir)
    created: List[str] = []
    if restricted:
        created.extend(safe_fs.makedirs(target_root, owner))
    else:
        os.makedirs(target_root, exist_ok=True)

    def _mkdirs(path: str) -> None:
        if restricted:
            created.extend(safe_fs.makedirs(path, owner))
            return
        missing = []
        probe = path
        while probe and not os.path.exists(probe):
            missing.append(probe)
            parent = os.path.dirname(probe)
            if parent == probe:
                break
            probe = parent
        os.makedirs(path, exist_ok=True)
        created.extend(reversed(missing))

    for info in zip_file.infolist():
        member = _normalize_zip_member(info.filename)
        if not member or member in ('.', '..'):
            continue
        parts = [p for p in member.split('/') if p not in ('', '.')]
        if any(p == '..' for p in parts):
            raise HTTPException(status_code=400, detail=f"Unsafe path in archive: {info.filename}")

        is_dir = member.endswith('/') or (
            hasattr(info, 'is_dir') and callable(info.is_dir) and info.is_dir()
        )
        if is_dir:
            dir_path = os.path.join(target_root, *parts) if parts else target_root
            _assert_extract_dest(dir_path, target_root, info.filename)
            _mkdirs(dir_path)
            continue

        dest = os.path.join(target_root, *parts)
        _assert_extract_dest(dest, target_root, info.filename)
        parent = os.path.dirname(dest)
        if parent:
            _mkdirs(parent)
        with zip_file.open(info, 'r') as src:
            if restricted:
                safe_fs.write_stream(dest, src, owner)
            else:
                with open(dest, 'wb') as out:
                    shutil.copyfileobj(src, out)
        created.append(dest)
    return created


@router.post("/extract")
async def extract_item(req: ExtractRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Extract a zip archive to the target directory."""
    try:
        import zipfile
        archive_path = check_safe_path(req.archive_path, user)
        target_dir = check_safe_path(req.target_dir, user)

        if not os.path.exists(archive_path):
            raise HTTPException(status_code=404, detail="Archive file not found.")
        restricted = _restricted(user)
        if restricted:
            fd = safe_fs.open_read(archive_path)
            src = os.fdopen(fd, "rb")
        else:
            src = open(archive_path, "rb")
        with src:
            if not zipfile.is_zipfile(src):
                raise HTTPException(status_code=400, detail="Path is not a valid zip file.")
            src.seek(0)
            target_existed = os.path.isdir(target_dir)
            with zipfile.ZipFile(src, 'r') as zip_file:
                created = _safe_extract_zip(
                    zip_file, target_dir, owner_for(target_dir, user) if restricted else None, restricted
                )
        if not restricted:
            chown_new(([] if target_existed else [target_dir]) + created, user)

        return {"status": "success", "message": "Archive extracted successfully."}
    except Exception as e:
        raise _fs_error(e)


@router.post("/chmod")
async def chmod_items(req: ChmodRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Change item permissions.

    Restricted users cannot set setuid / setgid / sticky bits, and symlinks
    are never followed.
    """
    try:
        mode_str = req.mode
        if not mode_str:
            mode_str = "755"

        try:
            mode_int = int(mode_str, 8)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid octal mode string.")
        if mode_int < 0 or mode_int > 0o7777:
            raise HTTPException(status_code=400, detail="Invalid octal mode string.")
        restricted = _restricted(user)
        if restricted:
            mode_int &= 0o777

        for p in req.paths:
            abs_p = check_safe_path(p, user)
            if not os.path.lexists(abs_p):
                continue
            try:
                if restricted:
                    safe_fs.chmod(abs_p, mode_int)
                else:
                    os.chmod(abs_p, mode_int)
            except Exception as exc:
                if safe_fs is not None and isinstance(exc, safe_fs.SymlinkRefused):
                    raise
                continue

        return {"status": "success", "message": "Permissions updated successfully."}
    except Exception as e:
        raise _fs_error(e)


from fastapi import File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse


@router.get("/download")
async def download_file(path: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Download a file."""
    try:
        target_path = check_safe_path(path, user)
        if not os.path.exists(target_path):
            raise HTTPException(status_code=404, detail="File not found.")
        if not os.path.isfile(target_path):
            raise HTTPException(status_code=400, detail="Path is a directory, not a file.")

        if _restricted(user):
            fd = safe_fs.open_read(target_path)
            size = os.fstat(fd).st_size
            fh = os.fdopen(fd, "rb")

            def _iter():
                with fh:
                    while True:
                        chunk = fh.read(1024 * 1024)
                        if not chunk:
                            break
                        yield chunk

            from urllib.parse import quote as _q
            name = os.path.basename(target_path)
            return StreamingResponse(
                _iter(),
                media_type="application/octet-stream",
                headers={
                    "Content-Length": str(size),
                    "Content-Disposition": f"attachment; filename*=utf-8''{_q(name)}",
                },
            )
        return FileResponse(
            path=target_path,
            filename=os.path.basename(target_path),
            media_type="application/octet-stream"
        )
    except Exception as e:
        raise _fs_error(e)


@router.post("/upload")
async def upload_file(
    path: str = Query(...),
    file: UploadFile = File(...),
    on_conflict: Optional[str] = None,
    relative_path: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Upload a file to the target directory.

    ``relative_path`` (folder upload, e.g. ``site/css/a.css``) places the file
    in sub-folders of ``path``, creating them as needed. Every component is
    validated (no ``..``, absolute paths, backslashes or NUL) and the final
    folder is re-checked with ``check_safe_path``.

    ``on_conflict`` when the file exists: ``overwrite`` (default, legacy),
    ``skip``, ``rename`` (``name (1).ext``) or ``error`` (409).
    """
    try:
        policy = _conflict_policy(on_conflict, "overwrite")
        target_dir = check_safe_path(path, user)
        if not os.path.isdir(target_dir):
            raise HTTPException(status_code=400, detail="Path is not a directory.")
        restricted = _restricted(user)

        parts = _relative_parts(relative_path)
        if parts:
            filename = parts[-1]
            if "\x00" in filename:
                raise HTTPException(status_code=400, detail="Invalid filename.")
            sub_dirs = parts[:-1]
        else:
            if not file.filename:
                raise HTTPException(status_code=400, detail="Missing filename.")
            filename = safe_child_name(file.filename)
            sub_dirs = []

        dest_dir = target_dir
        created: List[str] = []
        for comp in sub_dirs:
            nxt = safe_join(dest_dir, comp, user)
            if os.path.lexists(nxt):
                if os.path.islink(nxt) or not os.path.isdir(nxt):
                    raise HTTPException(status_code=400, detail=f"Not a folder: {comp}")
            else:
                if restricted:
                    safe_fs.mkdir(nxt, owner_for(nxt, user))
                else:
                    os.mkdir(nxt)
                created.append(nxt)
            dest_dir = nxt

        file_path = safe_join(dest_dir, filename, user)
        if os.path.lexists(file_path):
            if os.path.isdir(file_path) and not os.path.islink(file_path):
                if policy == "skip":
                    return {"status": "skipped", "path": file_path, "message": f"'{filename}' exists; skipped."}
                if policy != "rename":
                    raise HTTPException(status_code=409 if policy == "error" else 400,
                                        detail="A directory with that name already exists.")
            if policy == "skip":
                return {"status": "skipped", "path": file_path, "message": f"'{filename}' exists; skipped."}
            if policy == "error":
                raise HTTPException(status_code=409, detail=f"'{filename}' already exists.")
            if policy == "rename":
                filename = _free_name(dest_dir, filename)
                file_path = safe_join(dest_dir, filename, user)

        if restricted:
            safe_fs.write_stream(file_path, file.file, owner_for(file_path, user))
        else:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

        return {
            "status": "success",
            "path": file_path,
            "message": f"File '{filename}' uploaded successfully."
        }
    except Exception as e:
        raise _fs_error(e)
