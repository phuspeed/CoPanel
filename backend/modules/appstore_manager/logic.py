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
BUILD_TASKS = {}


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
        """Starts package installation and frontend build in a background thread."""
        global BUILD_TASKS
        BUILD_TASKS[pkg_id] = {
            "status": "running",
            "logs": ["Starting download and extraction..."],
            "error": ""
        }
        
        def run_install():
            import platform
            import threading
            is_windows = platform.system() == "Windows"
            
            current_file_dir = Path(__file__).parent.resolve()
            project_root = current_file_dir.parent.parent.parent.resolve()
            
            tmp_dir = project_root / "tmp"
            tmp_dir.mkdir(exist_ok=True)
            
            tmp_zip = tmp_dir / f"{pkg_id}.zip"
            extracted_dir = tmp_dir / f"extracted_{pkg_id}"
            
            try:
                BUILD_TASKS[pkg_id]["logs"].append(f"Downloading from {download_url}...")
                req = urllib.request.Request(
                    download_url, 
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                with urllib.request.urlopen(req, timeout=30) as response, open(tmp_zip, 'wb') as out_file:
                    out_file.write(response.read())
                
                BUILD_TASKS[pkg_id]["logs"].append("Download complete.")
                
                if extracted_dir.exists():
                    shutil.rmtree(extracted_dir)
                
                with zipfile.ZipFile(tmp_zip, 'r') as zip_ref:
                    zip_ref.extractall(extracted_dir)
                    
                BUILD_TASKS[pkg_id]["logs"].append("Extraction complete.")
                
                src_backend = extracted_dir / "backend"
                src_frontend = extracted_dir / "frontend"
                
                if Path("/opt/copanel").exists():
                    dst_backend = Path(f"/opt/copanel/backend/modules/{pkg_id}")
                    dst_frontend = Path(f"/opt/copanel/frontend/src/modules/{pkg_id}")
                    frontend_cwd = Path("/opt/copanel/frontend")
                else:
                    dst_backend = project_root / "backend" / "modules" / pkg_id
                    dst_frontend = project_root / "frontend" / "src" / "modules" / pkg_id
                    frontend_cwd = project_root / "frontend"
                
                if src_backend.exists():
                    BUILD_TASKS[pkg_id]["logs"].append(f"Installing backend module to {dst_backend}...")
                    shutil.copytree(src_backend, dst_backend, dirs_exist_ok=True)
                    
                if src_frontend.exists():
                    BUILD_TASKS[pkg_id]["logs"].append(f"Installing frontend module to {dst_frontend}...")
                    shutil.copytree(src_frontend, dst_frontend, dirs_exist_ok=True)
                
                BUILD_TASKS[pkg_id]["logs"].append("Starting frontend build (npm run build)...")
                
                cmd = ["npm", "run", "build"]
                
                process = subprocess.Popen(
                    cmd,
                    cwd=frontend_cwd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    shell=is_windows,
                    bufsize=1
                )
                
                while True:
                    line = process.stdout.readline()
                    if not line and process.poll() is not None:
                        break
                    if line:
                        stripped_line = line.strip()
                        if stripped_line:
                            BUILD_TASKS[pkg_id]["logs"].append(stripped_line)
                            
                return_code = process.wait()
                if return_code == 0:
                    BUILD_TASKS[pkg_id]["status"] = "success"
                    BUILD_TASKS[pkg_id]["logs"].append("🎉 Build completed successfully!")
                else:
                    BUILD_TASKS[pkg_id]["status"] = "failed"
                    BUILD_TASKS[pkg_id]["error"] = f"npm run build failed with exit code {return_code}"
                    BUILD_TASKS[pkg_id]["logs"].append(f"❌ npm run build failed with exit code {return_code}")
                    
            except Exception as e:
                BUILD_TASKS[pkg_id]["status"] = "failed"
                BUILD_TASKS[pkg_id]["error"] = str(e)
                BUILD_TASKS[pkg_id]["logs"].append(f"❌ Error: {str(e)}")
            finally:
                if tmp_zip.exists(): tmp_zip.unlink()
                if extracted_dir.exists(): shutil.rmtree(extracted_dir)
                
        import threading
        thread = threading.Thread(target=run_install)
        thread.daemon = True
        thread.start()
        
        return {"status": "success", "message": f"Package {pkg_id} installation started."}

    @staticmethod
    def get_build_status(pkg_id: str) -> dict:
        """Retrieves status and logs for the given package ID."""
        global BUILD_TASKS
        return BUILD_TASKS.get(pkg_id, {"status": "not_started", "logs": [], "error": ""})
