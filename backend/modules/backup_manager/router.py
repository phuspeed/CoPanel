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
