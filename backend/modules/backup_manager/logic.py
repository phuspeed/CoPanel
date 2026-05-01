"""
Backup & Sync Management Logic
Supports local directory backup, scheduling cron jobs, and syncing via Rclone to Google Drive.
"""
from pathlib import Path
import json
import shutil
import subprocess
import zipfile
from datetime import datetime

CONFIG_FILE = Path("/opt/copanel/config/backup_config.json")

class BackupManager:
    @staticmethod
    def load_config() -> dict:
        """Loads Backup and Rclone configurations from disk."""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "source_dir": "",
            "rclone_remote_name": "gdrive",
            "rclone_folder": "CoPanel-Backups",
            "google_drive_client_id": "",
            "google_drive_client_secret": "",
            "google_drive_refresh_token": "",
            "cron_expression": "0 0 * * *",
        }

    @staticmethod
    def save_config(cfg: dict) -> bool:
        """Saves Backup and Rclone configurations to disk."""
        try:
            CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
            return True
        except Exception:
            return False

    @staticmethod
    def backup_and_sync() -> dict:
        """Zips source directory and uploads using Rclone."""
        cfg = BackupManager.load_config()
        src = cfg.get("source_dir")
        if not src or not Path(src).exists():
            return {"status": "error", "message": f"Target folder {src} does not exist."}

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path("/opt/copanel/backups")
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        zip_path = backup_dir / f"backup_{timestamp}.zip"
        
        try:
            # Create local backup zip
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                source_path = Path(src)
                for file_path in source_path.rglob('*'):
                    if file_path.is_file():
                        zipf.write(file_path, file_path.relative_to(source_path))
            
            # Sync to Google Drive via Rclone
            remote = cfg.get("rclone_remote_name", "gdrive")
            rclone_folder = cfg.get("rclone_folder", "CoPanel-Backups")
            
            if shutil.which("rclone") and cfg.get("google_drive_refresh_token"):
                # Update/Create rclone config on the fly
                rc_conf = Path("/root/.config/rclone/rclone.conf")
                rc_conf.parent.mkdir(parents=True, exist_ok=True)
                
                conf_data = f"[{remote}]\ntype = drive\n"
                if cfg.get("google_drive_client_id"):
                    conf_data += f"client_id = {cfg.get('google_drive_client_id')}\n"
                if cfg.get("google_drive_client_secret"):
                    conf_data += f"client_secret = {cfg.get('google_drive_client_secret')}\n"
                if cfg.get("google_drive_refresh_token"):
                    conf_data += f"token = {cfg.get('google_drive_refresh_token')}\n"
                
                rc_conf.write_text(conf_data)
                
                # Copy file to remote
                subprocess.run(["rclone", "copy", str(zip_path), f"{remote}:{rclone_folder}"], timeout=300)
                
            return {"status": "success", "file": str(zip_path), "message": "Backup generated and synced successfully!"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def list_cron_jobs() -> list:
        """Retrieves CoPanel backup crons from active crontab."""
        try:
            res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            if res.returncode == 0:
                lines = res.stdout.strip().split("\n")
                return [line for line in lines if "backup_and_sync" in line]
        except Exception:
            pass
        return []

    @staticmethod
    def setup_cron(cron_expr: str) -> bool:
        """Adds or updates backup crontab timing schedule."""
        cron_command = f"{cron_expr} /opt/copanel/venv/bin/python -c 'import sys; sys.path.append(\"/opt/copanel/backend\"); from modules.backup_manager.logic import BackupManager; BackupManager.backup_and_sync()' >> /opt/copanel/logs/backup.log 2>&1"
        try:
            res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            current_lines = []
            if res.returncode == 0:
                current_lines = [line for line in res.stdout.split("\n") if line and "backup_and_sync" not in line]
            
            current_lines.append(cron_command)
            new_crontab = "\n".join(current_lines) + "\n"
            
            subprocess.run(["crontab", "-"], input=new_crontab, text=True)
            return True
        except Exception:
            return False

    @staticmethod
    def delete_cron() -> bool:
        """Removes active CoPanel backup crons."""
        try:
            res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            if res.returncode == 0:
                current_lines = [line for line in res.stdout.split("\n") if line and "backup_and_sync" not in line]
                new_crontab = "\n".join(current_lines) + "\n"
                subprocess.run(["crontab", "-"], input=new_crontab, text=True)
            return True
        except Exception:
            return False
