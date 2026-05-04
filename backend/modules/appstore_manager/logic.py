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
CATALOG_API_URL = "https://api.github.com/repos/phuspeed/CoPanel-AppStore/contents/packages.json"
BUILD_TASKS = {}


def is_update_available(remote_version: str, local_version: str) -> bool:
    try:
        r = [int(x) for x in remote_version.split(".")]
        l = [int(x) for x in local_version.split(".")]
        return r > l
    except Exception:
        try:
            from packaging.version import parse
            return parse(remote_version) > parse(local_version)
        except Exception:
            return remote_version != local_version and remote_version > local_version


def get_local_version(pkg_id: str, modules_dir: Path) -> str:
    # 1. Check version.txt inside backend module directory
    version_file = modules_dir / pkg_id / "version.txt"
    if version_file.exists():
        try:
            return version_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass

    # 2. Check in all possible locations for installed_packages.json
    possible_installed_files = [
        Path("/opt/copanel/config/installed_packages.json"),
        modules_dir.parent / "config" / "installed_packages.json",
        modules_dir.parent.parent / "config" / "installed_packages.json"
    ]
    for installed_file in possible_installed_files:
        if installed_file.exists():
            try:
                with open(installed_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and pkg_id in data:
                        return str(data[pkg_id])
            except Exception:
                pass

    # 3. Default fallback
    return "1.0.0"


def save_local_version(pkg_id: str, version: str):
    if Path("/opt/copanel").exists():
        modules_dir = Path("/opt/copanel/backend/modules")
    else:
        current_file_dir = Path(__file__).parent.resolve()
        modules_dir = current_file_dir.parent.parent.resolve() / "backend" / "modules"
        
    try:
        vfile = modules_dir / pkg_id / "version.txt"
        vfile.parent.mkdir(parents=True, exist_ok=True)
        vfile.write_text(version, encoding="utf-8")
    except Exception:
        pass
        
    # Save to both possible paths for reliability
    possible_cfg_dirs = [
        Path("/opt/copanel/config"),
        modules_dir.parent / "config",
        modules_dir.parent.parent / "config"
    ]
    for cfg_dir in possible_cfg_dirs:
        try:
            cfg_dir.mkdir(parents=True, exist_ok=True)
            installed_file = cfg_dir / "installed_packages.json"
            data = {}
            if installed_file.exists():
                try:
                    with open(installed_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if not isinstance(data, dict):
                            data = {}
                except Exception:
                    pass
            data[pkg_id] = version
            with open(installed_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        except Exception:
            pass


APT_YUM_MAPPING = {
    "redis": {"apt": "redis-server", "yum": "redis"},
    "nginx": {"apt": "nginx", "yum": "nginx"},
    "mariadb": {"apt": "mariadb-server", "yum": "mariadb-server"},
    "mysql": {"apt": "mysql-server", "yum": "mysql-community-server"},
    "postgresql": {"apt": "postgresql", "yum": "postgresql-server"},
    "memcached": {"apt": "memcached", "yum": "memcached"},
}


DEPENDENCY_PACKAGES = {
    "module_redis": {"id": "redis", "apt": "redis-server", "yum": "redis"},
    "module_cron": {"id": "memcached", "apt": "memcached", "yum": "memcached"},
    "web_manager": {"id": "nginx", "apt": "nginx", "yum": "nginx"},
    "database_manager": {"id": "mariadb", "apt": "mariadb-server", "yum": "mariadb-server"},
}


APPSTORE_CONFIG_FILE = Path("/opt/copanel/config/appstore_config.json") if Path("/opt/copanel").exists() else Path(__file__).parent.parent.parent.resolve() / "config" / "appstore_config.json"

class AppStoreManager:
    @staticmethod
    def load_config() -> dict:
        """Loads config for AppStore (e.g., custom community catalogs)."""
        if APPSTORE_CONFIG_FILE.exists():
            try:
                with open(APPSTORE_CONFIG_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"community_urls": []}

    @staticmethod
    def save_config(cfg: dict) -> bool:
        """Saves config for AppStore."""
        try:
            APPSTORE_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(APPSTORE_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=4)
            return True
        except Exception:
            return False

    @staticmethod
    def get_catalog() -> list:
        """Fetches available packages from remote GitHub catalog with installed status."""
        current_file_dir = Path(__file__).parent.resolve()
        project_root = current_file_dir.parent.parent.parent.resolve()
        
        if Path("/opt/copanel").exists():
            modules_dir = Path("/opt/copanel/backend/modules")
        else:
            modules_dir = project_root / "backend" / "modules"
            
        packages = []
        try:
            req = urllib.request.Request(
                CATALOG_API_URL, 
                headers={
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                packages = json.loads(response.read().decode("utf-8"))
        except Exception:
            try:
                import time
                url_with_t = f"{CATALOG_URL}?t={int(time.time())}"
                req = urllib.request.Request(
                    url_with_t, 
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                with urllib.request.urlopen(req, timeout=5) as response:
                    packages = json.loads(response.read().decode("utf-8"))
            except Exception:
                packages = []

        # Load community URLs from config
        cfg = AppStoreManager.load_config()
        community_urls = cfg.get("community_urls", [])
        for url in community_urls:
            if not url or not isinstance(url, str) or not url.startswith("http"):
                continue
            try:
                fetch_url = url
                headers = {'User-Agent': 'Mozilla/5.0'}
                if "raw.githubusercontent.com" in url:
                    parts = url.replace("https://raw.githubusercontent.com/", "").split("/")
                    if len(parts) >= 3:
                        user, repo = parts[0], parts[1]
                        fetch_url = f"https://api.github.com/repos/{user}/{repo}/contents/packages.json"
                        headers['Accept'] = 'application/vnd.github.v3.raw'

                req = urllib.request.Request(fetch_url, headers=headers)
                with urllib.request.urlopen(req, timeout=5) as response:
                    comm_pkgs = json.loads(response.read().decode("utf-8"))
                    if isinstance(comm_pkgs, list):
                        for p in comm_pkgs:
                            if isinstance(p, dict) and "id" in p:
                                p["is_community"] = True
                                packages.append(p)
            except Exception:
                pass

        seen = set()
        merged_packages = []
        for p in packages:
            if p.get("id") not in seen:
                seen.add(p["id"])
                merged_packages.append(p)

        packages = merged_packages

        for p in packages:
            installed = (modules_dir / p["id"]).exists()
            p["installed"] = installed
            if installed:
                local_ver = get_local_version(p["id"], modules_dir)
                p["local_version"] = local_ver
                p["has_update"] = is_update_available(p.get("version", "1.0.0"), local_ver)
            else:
                p["local_version"] = ""
                p["has_update"] = False
            
        return packages



    @staticmethod
    def install_package(pkg_id: str, download_url: str, version: str = "1.0.0", system_packages: list = None) -> dict:
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
            
            # Auto-install Linux package dependencies in parallel
            deps = []
            if isinstance(system_packages, list) and system_packages:
                for sp in system_packages:
                    if isinstance(sp, str):
                        mapping = APT_YUM_MAPPING.get(sp.lower(), {"apt": sp.lower(), "yum": sp.lower()})
                        deps.append({"id": sp, "apt": mapping.get("apt", sp), "yum": mapping.get("yum", sp)})
            else:
                dep = DEPENDENCY_PACKAGES.get(pkg_id)
                if dep:
                    deps.append(dep)

            for dep in deps:
                import shutil
                if not shutil.which(dep.get("apt")) and not shutil.which(dep.get("yum", dep.get("id"))):
                    BUILD_TASKS[pkg_id]["logs"].append(f"Package system dependency '{dep['id']}' not found. Installing in background...")
                    import subprocess
                    import platform as plat
                    if plat.system() != "Windows":
                        if shutil.which("apt-get"):
                            cmd = f"sudo DEBIAN_FRONTEND=noninteractive apt-get install -y {dep['apt']}"
                        elif shutil.which("yum"):
                            cmd = f"sudo yum install -y {dep['yum']}"
                        else:
                            cmd = None
                            
                        if cmd:
                            try:
                                subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                BUILD_TASKS[pkg_id]["logs"].append(f"Successfully triggered installation for '{dep['id']}' via OS package manager.")
                            except Exception as e:
                                BUILD_TASKS[pkg_id]["logs"].append(f"Warning: Could not auto-install '{dep['id']}': {str(e)}")
                    else:
                        BUILD_TASKS[pkg_id]["logs"].append(f"OS is Windows. Skipping auto-installation of Linux package '{dep['id']}'.")

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
                    try:
                        save_local_version(pkg_id, version)
                    except Exception:
                        pass
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

    @staticmethod
    def uninstall_package(pkg_id: str) -> dict:
        """Removes installed package directories."""
        current_file_dir = Path(__file__).parent.resolve()
        project_root = current_file_dir.parent.parent.parent.resolve()
        
        if Path("/opt/copanel").exists():
            dst_backend = Path(f"/opt/copanel/backend/modules/{pkg_id}")
            dst_frontend = Path(f"/opt/copanel/frontend/src/modules/{pkg_id}")
            frontend_cwd = Path("/opt/copanel/frontend")
        else:
            dst_backend = project_root / "backend" / "modules" / pkg_id
            dst_frontend = project_root / "frontend" / "src" / "modules" / pkg_id
            frontend_cwd = project_root / "frontend"
            
        try:
            if dst_backend.exists():
                shutil.rmtree(dst_backend)
            if dst_frontend.exists():
                shutil.rmtree(dst_frontend)
                
            # Trigger build to remove the module from the frontend bundle
            import platform
            is_windows = platform.system() == "Windows"
            subprocess.Popen(["npm", "run", "build"], cwd=frontend_cwd, shell=is_windows)
            
            return {"status": "success", "message": f"Package {pkg_id} uninstalled successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

