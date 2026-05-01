"""
AppStore Manager Logic Layer
Pulls package details from dynamic GitHub index file, handles on-demand installation.
"""
import urllib.request
import json
import zipfile
import shutil
import subprocess
from pathlib import Path

CATALOG_URL = "https://raw.githubusercontent.com/phuspeed/CoPanel-AppStore/main/packages.json"

class AppStoreManager:
    @staticmethod
    def get_catalog() -> list:
        """Fetches available packages from remote GitHub catalog."""
        try:
            req = urllib.request.Request(
                CATALOG_URL, 
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                return json.loads(response.read().decode())
        except Exception:
            # Fallback mock packages for a complete AppStore demonstration
            return [
                {
                    "id": "module_redis",
                    "name": "Redis Cache Manager",
                    "description": "Visual dashboard to view keys, monitor memory, and restart local Redis instance.",
                    "version": "1.0.0",
                    "icon": "Database",
                    "download_url": "https://raw.githubusercontent.com/phuspeed/CoPanel-AppStore/main/packages/module_redis.zip"
                },
                {
                    "id": "module_cron",
                    "name": "Cloud Backup Extension",
                    "description": "Premium scheduled cron backup and cloud uploader.",
                    "version": "1.0.1",
                    "icon": "Cloud",
                    "download_url": "https://raw.githubusercontent.com/phuspeed/CoPanel-AppStore/main/packages/module_cron.zip"
                }
            ]

    @staticmethod
    def install_package(pkg_id: str, download_url: str) -> dict:
        """Downloads package zip, extracts files, and rebuilds the frontend."""
        tmp_zip = Path(f"/tmp/{pkg_id}.zip")
        extracted_dir = Path(f"/tmp/extracted_{pkg_id}")
        
        try:
            # Download the remote zip
            req = urllib.request.Request(
                download_url, 
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req, timeout=30) as response, open(tmp_zip, 'wb') as out_file:
                out_file.write(response.read())

            # Extract the content
            if extracted_dir.exists():
                shutil.rmtree(extracted_dir)
            
            with zipfile.ZipFile(tmp_zip, 'r') as zip_ref:
                zip_ref.extractall(extracted_dir)
            
            # Check source structure and copy to destinations
            src_backend = extracted_dir / "backend"
            src_frontend = extracted_dir / "frontend"
            
            if src_backend.exists():
                dst_backend = Path(f"/opt/copanel/backend/modules/{pkg_id}")
                shutil.copytree(src_backend, dst_backend, dirs_exist_ok=True)
            if src_frontend.exists():
                dst_frontend = Path(f"/opt/copanel/frontend/src/modules/{pkg_id}")
                shutil.copytree(src_frontend, dst_frontend, dirs_exist_ok=True)
                
            # Rebuild frontend in the background if on Linux VPS
            if Path("/opt/copanel").exists():
                subprocess.Popen(["npm", "run", "build"], cwd="/opt/copanel/frontend")

            return {"status": "success", "message": f"Package {pkg_id} installed successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
        finally:
            # Cleanup temp files
            if tmp_zip.exists(): tmp_zip.unlink()
            if extracted_dir.exists(): shutil.rmtree(extracted_dir)
