"""
Backup & Sync Management Router
FastAPI endpoints for local directory backup, scheduling cron jobs, and Rclone OAuth.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from .logic import BackupManager

router = APIRouter()

@router.get("/config")
def read_config() -> Dict[str, Any]:
    """Get Backup and Rclone configs."""
    try:
        cfg = BackupManager.load_config()
        return {"status": "success", "data": cfg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config")
def save_config(cfg: dict) -> Dict[str, Any]:
    """Save Backup and Rclone configs."""
    try:
        ok = BackupManager.save_config(cfg)
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to save backup config file.")
        return {"status": "success", "message": "Configuration saved successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cronjobs")
def get_cronjobs() -> Dict[str, Any]:
    """Fetch active backup cron jobs."""
    try:
        crons = BackupManager.list_cron_jobs()
        return {"status": "success", "data": crons}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cronjobs")
def save_cronjob(req: dict) -> Dict[str, Any]:
    """Create a new backup cron job timer."""
    try:
        cron_expr = req.get("cron_expression")
        if not cron_expr:
            raise HTTPException(status_code=400, detail="Cron expression is required.")
        ok = BackupManager.setup_cron(cron_expr)
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to append cron job.")
        return {"status": "success", "message": f"Successfully created cron timer: {cron_expr}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cronjobs/delete")
def remove_cronjob() -> Dict[str, Any]:
    """Remove active backup crons."""
    try:
        ok = BackupManager.delete_cron()
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to clear active cron timers.")
        return {"status": "success", "message": "All backup crons cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backup-now")
def run_backup_now() -> Dict[str, Any]:
    """Trigger an manual, real-time backup upload."""
    try:
        res = BackupManager.backup_and_sync()
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/backups")
def get_backups() -> Dict[str, Any]:
    """Fetch all local backup files."""
    try:
        backups = BackupManager.list_backups()
        return {"status": "success", "data": backups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backups/delete")
def delete_backup_file(req: dict) -> Dict[str, Any]:
    """Remove a backup file from disk."""
    try:
        filename = req.get("filename")
        if not filename:
            raise HTTPException(status_code=400, detail="Filename is required.")
        ok = BackupManager.delete_backup(filename)
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to delete backup file.")
        return {"status": "success", "message": "Backup file removed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/exchange-oauth-code")
def exchange_oauth_code(req: dict) -> Dict[str, Any]:
    """Exchange OAuth code from browser with Google."""
    try:
        import requests
        client_id = req.get("client_id")
        client_secret = req.get("client_secret")
        code = req.get("code")
        redirect_uri = req.get("redirect_uri")
        
        if not all([client_id, client_secret, code, redirect_uri]):
            raise HTTPException(status_code=400, detail="Missing required OAuth parameters.")
            
        res = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code"
        }, timeout=30)
        
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail=res.text)
            
        data = res.json()
        import json
        import datetime

        cfg = BackupManager.load_config()
        prev_token_str = cfg.get("google_drive_refresh_token") or "{}"
        prev_token = {}
        if prev_token_str.strip().startswith("{"):
            try:
                prev_token = json.loads(prev_token_str)
            except Exception:
                pass

        merged_token = {
            "access_token": data.get("access_token") or prev_token.get("access_token") or "",
            "token_type": data.get("token_type") or prev_token.get("token_type") or "Bearer",
            "refresh_token": data.get("refresh_token") or prev_token.get("refresh_token") or "",
            "expiry": prev_token.get("expiry") or "0001-01-01T00:00:00Z"
        }
        if "expires_in" in data:
            expiry_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=data["expires_in"])
            merged_token["expiry"] = expiry_time.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        full_token_json_str = json.dumps(merged_token)

        cfg["google_drive_client_id"] = client_id
        cfg["google_drive_client_secret"] = client_secret
        cfg["google_drive_refresh_token"] = full_token_json_str
        BackupManager.save_config(cfg)

        return {"status": "success", "refresh_token": full_token_json_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/test_connection")
def test_connection() -> Dict[str, Any]:
    """Test connection to Google Drive using Rclone."""
    import subprocess
    from .logic import BackupManager
    cfg = BackupManager.load_config()
    remote = cfg.get("rclone_remote_name", "gdrive")
    
    if not cfg.get("google_drive_refresh_token"):
        raise HTTPException(status_code=400, detail="Missing Google Drive Token. Please authenticate first.")
        
    try:
        from pathlib import Path
        rc_conf = Path("/root/.config/rclone/rclone.conf")
        rc_conf.parent.mkdir(parents=True, exist_ok=True)
        
        token_str = cfg.get("google_drive_refresh_token") or ""
        is_valid_json = False
        if token_str.strip().startswith("{"):
            try:
                import json
                json.loads(token_str)
                is_valid_json = True
            except Exception:
                pass

        if token_str and not is_valid_json:
            import json
            token_str = json.dumps({
                "access_token": "",
                "token_type": "Bearer",
                "refresh_token": token_str.strip(),
                "expiry": "0001-01-01T00:00:00Z"
            })

        conf_data = f"[{remote}]\ntype = drive\n"
        if cfg.get("google_drive_client_id"):
            conf_data += f"client_id = {cfg.get('google_drive_client_id')}\n"
        if cfg.get("google_drive_client_secret"):
            conf_data += f"client_secret = {cfg.get('google_drive_client_secret')}\n"
        if token_str:
            conf_data += f"token = {token_str}\n"
        rc_conf.write_text(conf_data)
        
        res = subprocess.run(["rclone", "about", f"{remote}:"], capture_output=True, text=True, timeout=15)
        if res.returncode == 0:
            return {"status": "success", "message": "Connected to Google Drive successfully!"}
        else:
            return {"status": "error", "message": res.stderr.strip() or "Rclone test failed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backup-task-now")
def run_backup_task_now(req: dict) -> Dict[str, Any]:
    """Trigger a specific multiple backup task immediately."""
    from .logic import BackupManager
    try:
        t_id = req.get("id")
        if not t_id:
            raise HTTPException(status_code=400, detail="Task ID is required.")
        res = BackupManager.run_backup_task(t_id)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
