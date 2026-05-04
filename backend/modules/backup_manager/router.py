import os
import json
import subprocess
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List
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
    if os.name == 'nt':
        return {"status": "success", "data": ["gdrive:", "dropbox:", "s3:"]}
    try:
        res = subprocess.run(["rclone", "listremotes"], capture_output=True, text=True, timeout=5)
        remotes = [line.strip() for line in res.stdout.splitlines() if line.strip()]
        return {"status": "success", "data": remotes}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/explore")
def explore_files(path: str = "/") -> Dict[str, Any]:
    """Simple file explorer for Visual File Selector"""
    target = Path(path)
    if not target.exists() or not target.is_dir():
        return {"status": "success", "data": []}
        
    items = []
    try:
        for entry in target.iterdir():
            if entry.is_dir():
                items.append({"name": entry.name, "path": str(entry), "type": "folder"})
            else:
                items.append({"name": entry.name, "path": str(entry), "type": "file"})
    except Exception:
        pass
        
    items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
    return {"status": "success", "data": items, "current_path": str(target)}

@router.get("/stream_task/{profile_id}")
async def stream_task(profile_id: int):
    """Server-Sent Events (SSE) generator for Real-time Rclone Progress"""
    profile = ProfileManager.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    async def event_generator():
        flags_str = profile.get("rclone_flags", "{}")
        flags = json.loads(flags_str) if flags_str else {}
        source_path = profile["source_path"]
        remote_path = f"{profile['remote_name']}:{profile['remote_path']}"
        
        # SQL Dump if needed
        if profile["source_type"] == "mysql":
            yield f"data: {json.dumps({'msg': 'Starting MySQL Dump...', 'progress': 0})}\n\n"
            await asyncio.sleep(0.5) # Give UI time to render
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dump_file = BACKUP_DIR / f"{source_path}_{timestamp}.sql"
            success = BackupTaskEngine.export_mysql(source_path, dump_file)
            
            if not success:
                yield f"data: {json.dumps({'error': 'MySQL Dump Failed. Aborting.', 'progress': 0})}\n\n"
                return
            
            source_path = str(dump_file)
            yield f"data: {json.dumps({'msg': 'MySQL Dump Completed.', 'progress': 10})}\n\n"

        cmd = ["rclone", "sync" if flags.get("sync_deletions") else "copy", source_path, remote_path]
        if flags.get("inplace"): cmd.append("--inplace")
        if flags.get("metadata"): cmd.append("--metadata")
        if flags.get("size_only"): cmd.append("--size-only")
        cmd.extend(["--transfers", str(flags.get("transfers", 4))])
        
        # Enforce JSON log format for SSE parsing
        cmd.extend(["--use-json-log", "-v", "--stats", "1s"])
        
        if os.name == 'nt':
            # Mock SSE for Windows
            yield f"data: {json.dumps({'msg': 'Mock sync started on Windows', 'progress': 20})}\n\n"
            await asyncio.sleep(2)
            yield f"data: {json.dumps({'msg': 'Syncing...', 'progress': 60})}\n\n"
            await asyncio.sleep(2)
            yield f"data: {json.dumps({'msg': 'Sync Complete!', 'progress': 100})}\n\n"
            return
            
        try:
            # Run rclone asynchronously and capture streaming output
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                    
                line_str = line.decode('utf-8').strip()
                if not line_str: continue
                
                try:
                    log_data = json.loads(line_str)
                    # Parse rclone stats block if present
                    if "stats" in log_data:
                        stats = log_data["stats"]
                        bytes_total = stats.get("bytes", 0)
                        bytes_done = stats.get("bytes", 0)
                        checks = stats.get("checks", 0)
                        transfers = stats.get("transfers", 0)
                        
                        # Rclone doesn't always give easy 0-100% in stats dict directly,
                        # but we can send raw stats up to UI
                        payload = {
                            "progress": -1, # UI handles dynamic stats mapping
                            "stats": stats,
                            "msg": f"Transferred: {bytes_done} bytes, Checks: {checks}"
                        }
                        yield f"data: {json.dumps(payload)}\n\n"
                    else:
                        yield f"data: {json.dumps({'msg': log_data.get('msg', ''), 'level': log_data.get('level', '')})}\n\n"
                except json.JSONDecodeError:
                    yield f"data: {json.dumps({'msg': line_str})}\n\n"

            await process.wait()
            
            if process.returncode == 0:
                yield f"data: {json.dumps({'msg': 'Sync Completed Successfully!', 'progress': 100, 'done': True})}\n\n"
            else:
                yield f"data: {json.dumps({'error': f'Rclone exited with code {process.returncode}', 'progress': 100, 'done': True})}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"
        finally:
            if profile["source_type"] == "mysql" and os.path.exists(source_path):
                try:
                    os.remove(source_path)
                except Exception:
                    pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")
