import os
import json
import subprocess
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from .logic import ProfileManager, BackupTaskEngine, BACKUP_DIR
from datetime import datetime
import asyncio

router = APIRouter()


@router.on_event("startup")
async def on_startup():
    from .logic import RealtimeSyncManager
    RealtimeSyncManager.update_watchers()


@router.get("/profiles")
def get_profiles() -> Dict[str, Any]:
    return {"status": "success", "data": ProfileManager.get_profiles()}


@router.post("/profiles")
def create_profile(data: dict) -> Dict[str, Any]:
    pid = ProfileManager.create_profile(data)
    return {"status": "success", "id": pid}


@router.put("/profiles/{profile_id}")
def update_profile(profile_id: int, data: dict) -> Dict[str, Any]:
    ok = ProfileManager.update_profile(profile_id, data)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to update profile")
    return {"status": "success"}


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: int) -> Dict[str, Any]:
    ProfileManager.delete_profile(profile_id)
    return {"status": "success"}


@router.get("/remotes")
def list_remotes() -> Dict[str, Any]:
    """Returns detailed remote info: [{name, type}]"""
    remotes = ProfileManager.get_rclone_remotes_detail()
    if not remotes and os.name == 'nt':
        # Mock data for Windows dev environment
        return {
            "status": "success",
            "data": [
                {"name": "gdrive", "type": "drive"},
                {"name": "s3_backup", "type": "s3"},
                {"name": "dropbox", "type": "dropbox"},
            ],
            "config_path": "/mock/rclone.conf"
        }
    return {
        "status": "success",
        "data": remotes,
        "config_path": str(ProfileManager.get_rclone_config_path())
    }


@router.get("/system-folders")
def get_system_folders() -> Dict[str, Any]:
    if os.name == 'nt':
        current_file_dir = Path(__file__).parent.resolve()
        proj = current_file_dir.parent.parent.parent.resolve()
        return {
            "status": "success",
            "data": [
                {"name": "Project Root", "path": str(proj)},
                {"name": "Backup Dir", "path": str(proj / "backups")}
            ]
        }
    return {
        "status": "success",
        "data": [
            {"name": "Root (/)", "path": "/"},
            {"name": "CoPanel (/opt/copanel)", "path": "/opt/copanel"},
            {"name": "Web Content (/var/www)", "path": "/var/www"},
            {"name": "User Homes (/home)", "path": "/home"},
            {"name": "System Logs (/var/log)", "path": "/var/log"},
        ]
    }


@router.get("/rclone-config")
def get_rclone_config() -> Dict[str, Any]:
    return {
        "status": "success",
        "content": ProfileManager.load_rclone_config(),
        "path": str(ProfileManager.get_rclone_config_path())
    }


@router.post("/rclone-config")
def save_rclone_config(data: dict) -> Dict[str, Any]:
    content = data.get("content", "")
    ok = ProfileManager.save_rclone_config(content)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to save rclone configuration file.")
    return {"status": "success"}


@router.get("/explore")
def explore_files(path: str = "/") -> Dict[str, Any]:
    """Simple file explorer for Visual File Selector."""
    if os.name == 'nt' and path == "/":
        current_file_dir = Path(__file__).parent.resolve()
        path = str(current_file_dir.parent.parent.parent.resolve())

    target = Path(path)
    if not target.exists() or not target.is_dir():
        return {"status": "error", "data": [], "current_path": str(target), "message": "Path not found or not a directory"}

    items = []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            if entry.is_dir():
                items.append({"name": entry.name, "path": str(entry), "type": "folder"})
            else:
                items.append({"name": entry.name, "path": str(entry), "type": "file"})
    except PermissionError:
        return {"status": "error", "data": [], "current_path": str(target), "message": "Permission denied"}
    except Exception as e:
        return {"status": "error", "data": [], "current_path": str(target), "message": str(e)}

    return {"status": "success", "data": items, "current_path": str(target)}


@router.get("/stream_task/{profile_id}")
async def stream_task(profile_id: int):
    """
    Server-Sent Events (SSE) stream for real-time rclone progress.
    EventSource cannot send Authorization headers; auth is handled by
    the application-level session since the backend does not enforce
    global JWT middleware on these routes.
    """
    profile = ProfileManager.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    rclone_config = str(ProfileManager.get_rclone_config_path())

    async def event_generator():
        flags_str = profile.get("rclone_flags", "{}")
        flags = json.loads(flags_str) if flags_str else {}
        source_path = profile["source_path"]
        remote_path = f"{profile['remote_name']}:{profile['remote_path']}"

        if profile["source_type"] == "mysql":
            yield f"data: {json.dumps({'msg': 'Starting MySQL dump...', 'progress': 0})}\n\n"
            await asyncio.sleep(0.3)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dump_file = BACKUP_DIR / f"{source_path}_{timestamp}.sql"
            success = BackupTaskEngine.export_mysql(source_path, dump_file)

            if not success:
                yield f"data: {json.dumps({'error': 'MySQL dump failed. Aborting.', 'progress': 0, 'done': True})}\n\n"
                return

            source_path = str(dump_file)
            yield f"data: {json.dumps({'msg': 'MySQL dump completed.', 'progress': 10})}\n\n"

        cmd = [
            "rclone",
            "sync" if flags.get("sync_deletions") else "copy",
            source_path,
            remote_path,
            "--config", rclone_config,
        ]
        if flags.get("inplace"):
            cmd.append("--inplace")
        if flags.get("metadata"):
            cmd.append("--metadata")
        if flags.get("size_only"):
            cmd.append("--size-only")
        cmd.extend(["--transfers", str(flags.get("transfers", 4))])
        cmd.extend(["--use-json-log", "-v", "--stats", "1s"])

        if os.name == 'nt':
            yield f"data: {json.dumps({'msg': f'[Mock] rclone {\" \".join(cmd[1:3])} started', 'progress': 20})}\n\n"
            await asyncio.sleep(1)
            yield f"data: {json.dumps({'msg': 'Syncing files...', 'progress': 60})}\n\n"
            await asyncio.sleep(1)
            yield f"data: {json.dumps({'msg': 'Sync complete!', 'progress': 100, 'done': True})}\n\n"
            return

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )

            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                line_str = line.decode("utf-8", errors="replace").strip()
                if not line_str:
                    continue

                try:
                    log_data = json.loads(line_str)
                    if "stats" in log_data:
                        stats = log_data["stats"]
                        transferred_bytes = stats.get("bytes", 0)
                        total_bytes = stats.get("totalBytes", 0)
                        checks = stats.get("checks", 0)
                        transfers = stats.get("transfers", 0)
                        errors = stats.get("errors", 0)

                        # Calculate progress percentage when totalBytes is known
                        progress = -1
                        if total_bytes and total_bytes > 0:
                            progress = round(min(transferred_bytes / total_bytes * 100, 99))

                        yield f"data: {json.dumps({'progress': progress, 'stats': stats, 'msg': f'Transferred {_fmt_bytes(transferred_bytes)} / {_fmt_bytes(total_bytes)} — {transfers} files, {checks} checks', 'errors': errors})}\n\n"
                    else:
                        msg = log_data.get("msg", "")
                        level = log_data.get("level", "")
                        if msg:
                            yield f"data: {json.dumps({'msg': msg, 'level': level})}\n\n"
                except json.JSONDecodeError:
                    yield f"data: {json.dumps({'msg': line_str})}\n\n"

            await process.wait()

            if process.returncode == 0:
                yield f"data: {json.dumps({'msg': 'Sync completed successfully!', 'progress': 100, 'done': True})}\n\n"
            else:
                yield f"data: {json.dumps({'error': f'rclone exited with code {process.returncode}', 'progress': 100, 'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"
        finally:
            if profile["source_type"] == "mysql":
                try:
                    if os.path.exists(source_path):
                        os.remove(source_path)
                except Exception:
                    pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


def _fmt_bytes(n: int) -> str:
    """Format bytes into human-readable string."""
    if n < 1024:
        return f"{n} B"
    elif n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    elif n < 1024 ** 3:
        return f"{n / 1024 ** 2:.1f} MB"
    return f"{n / 1024 ** 3:.2f} GB"
