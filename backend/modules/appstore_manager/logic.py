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


def get_copanel_home() -> Path:
    """Production: /opt/copanel. Dev: repo root (directory that contains backend/)."""
    if Path("/opt/copanel").exists():
        return Path("/opt/copanel")
    # This file: <root>/backend/modules/appstore_manager/logic.py
    return Path(__file__).resolve().parent.parent.parent.parent


def appstore_config_file() -> Path:
    return get_copanel_home() / "config" / "appstore_config.json"


def derive_pkg_id_from_upload_name(filename: str) -> str:
    """Stable module id from an uploaded zip name (handles path junk and *.v1.0.0 style)."""
    name = Path(filename or "custom_module.zip").name
    if name.lower().endswith(".zip"):
        name = name[:-4]
    name = name.split("-v")[0].split("_v")[0]
    name = name.split(".")[0].strip().lower()
    return name or "custom_module"


def normalize_version(v: str) -> str:
    if not v or not isinstance(v, str):
        return "0.0.0"
    s = v.strip()
    if s.lower().startswith("v"):
        s = s[1:].strip()
    return s or "0.0.0"


def compare_versions(a: str, b: str) -> int:
    """
    Semver-aware comparison. Returns negative if a < b, 0 if equal, positive if a > b.
    Falls back to numeric tuple compare when PEP 440 parsing fails.
    """
    from packaging.version import InvalidVersion, Version

    na, nb = normalize_version(a), normalize_version(b)
    try:
        va, vb = Version(na), Version(nb)
        if va < vb:
            return -1
        if va > vb:
            return 1
        return 0
    except InvalidVersion:
        pass
    try:
        def numeric_tuple(s: str) -> tuple:
            parts = []
            for segment in s.replace("-", ".").split("."):
                segment = "".join(c for c in segment if c.isdigit())
                if segment:
                    parts.append(int(segment))
            return tuple(parts) if parts else (0,)

        ta, tb = numeric_tuple(na), numeric_tuple(nb)
        maxlen = max(len(ta), len(tb))
        ta = ta + (0,) * (maxlen - len(ta))
        tb = tb + (0,) * (maxlen - len(tb))
        if ta < tb:
            return -1
        if ta > tb:
            return 1
        return 0
    except Exception:
        if na == nb:
            return 0
        return 1 if na > nb else -1


def is_update_available(remote_version: str, local_version: str) -> bool:
    return compare_versions(remote_version, local_version) > 0


def restart_backend_service(delay: float = 2.0):
    """
    Restart the copanel systemd service so newly-installed Python modules
    are picked up without requiring manual VPS access.
    Runs in a daemon thread with a short delay so the caller's HTTP response
    can be flushed before the process is replaced.
    Only acts on Linux when systemctl is available.
    """
    import platform
    import threading

    if platform.system() == "Windows":
        return

    def _do_restart():
        import time
        import shutil
        time.sleep(delay)
        if shutil.which("systemctl"):
            try:
                subprocess.run(
                    ["systemctl", "restart", "copanel"],
                    capture_output=True,
                    timeout=10,
                )
            except Exception:
                pass

    t = threading.Thread(target=_do_restart, daemon=True)
    t.start()


CORE_PACKAGE_VERSIONS = {
    "appstore_manager": "1.0.9",
    "ssl_manager": "1.0.1",
    "backup_manager": "1.0.3",
    "package_manager": "1.0.0"
}

def get_local_version(pkg_id: str, modules_dir: Path) -> str:
    # 1. Check version.txt inside backend module directory first
    version_file = modules_dir / pkg_id / "version.txt"
    if version_file.exists():
        try:
            raw = version_file.read_text(encoding="utf-8").strip()
            if raw:
                return normalize_version(raw)
        except Exception:
            pass

    # 2. installed_packages.json under CoPanel config
    possible_installed_files = [
        get_copanel_home() / "config" / "installed_packages.json",
    ]
    for installed_file in possible_installed_files:
        if installed_file.exists():
            try:
                with open(installed_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and pkg_id in data:
                        val = data[pkg_id]
                        if isinstance(val, dict) and val.get("version") is not None:
                            return normalize_version(str(val["version"]))
                        return normalize_version(str(val))
            except Exception:
                pass

    # 3. Fall back to core package hardcoded version
    if pkg_id in CORE_PACKAGE_VERSIONS:
        return normalize_version(CORE_PACKAGE_VERSIONS[pkg_id])

    # 4. Default fallback
    return normalize_version("1.0.0")


def save_local_version(pkg_id: str, version: str):
    ver = normalize_version(version)
    home = get_copanel_home()
    modules_dir = home / "backend" / "modules"
    try:
        vfile = modules_dir / pkg_id / "version.txt"
        vfile.parent.mkdir(parents=True, exist_ok=True)
        vfile.write_text(ver, encoding="utf-8")
    except Exception:
        pass

    for cfg_dir in [home / "config"]:
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
            data[pkg_id] = ver
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


class AppStoreManager:
    @staticmethod
    def load_config() -> dict:
        """Loads config for AppStore (e.g., custom community catalogs)."""
        cfg_path = appstore_config_file()
        if not cfg_path.exists():
            legacy = get_copanel_home() / "backend" / "config" / "appstore_config.json"
            if legacy.exists():
                try:
                    cfg_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(legacy, cfg_path)
                except Exception:
                    pass
        if cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    urls = data.get("community_urls", [])
                    if not isinstance(urls, list):
                        urls = []
                    return {**data, "community_urls": urls}
            except Exception:
                pass
        return {"community_urls": []}

    @staticmethod
    def save_config(update: dict) -> bool:
        """Merges into appstore_config.json under CoPanel config dir (single canonical file)."""
        cfg_path = appstore_config_file()
        try:
            cfg_path.parent.mkdir(parents=True, exist_ok=True)
            current: dict = {}
            if cfg_path.exists():
                try:
                    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        current = raw
                except Exception:
                    current = {}
            merged = {**current, **update}
            if "community_urls" in merged:
                u = merged["community_urls"]
                merged["community_urls"] = list(u) if isinstance(u, list) else []
            with open(cfg_path, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=4)
            return True
        except Exception:
            return False

    @staticmethod
    def get_catalog() -> list:
        """Fetches available packages from remote GitHub catalog with installed status."""
        project_root = get_copanel_home()
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
            if not isinstance(p, dict) or "id" not in p:
                continue
            remote_ver = normalize_version(p.get("version", "1.0.0"))
            p["version"] = remote_ver
            p["remote_version"] = remote_ver
            installed = (modules_dir / p["id"]).exists()
            p["installed"] = installed
            if installed:
                local_ver = get_local_version(p["id"], modules_dir)
                p["local_version"] = local_ver
                cmpv = compare_versions(remote_ver, local_ver)
                if cmpv > 0:
                    p["has_update"] = True
                    p["update_status"] = "update_available"
                elif cmpv < 0:
                    p["has_update"] = False
                    p["update_status"] = "ahead"
                else:
                    p["has_update"] = False
                    p["update_status"] = "up_to_date"
            else:
                p["local_version"] = ""
                p["has_update"] = False
                p["update_status"] = "not_installed"
            
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

            project_root = get_copanel_home()
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
                    BUILD_TASKS[pkg_id]["logs"].append("♻️ Restarting backend service to load new modules...")
                    restart_backend_service(delay=2.0)
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
        project_root = get_copanel_home()
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

    @staticmethod
    def install_local_zip(pkg_id: str, zip_path: Path) -> dict:
        """Installs a module directly from a local zip file."""
        global BUILD_TASKS
        BUILD_TASKS[pkg_id] = {
            "status": "running",
            "logs": ["Starting installation from uploaded ZIP..."],
            "error": ""
        }
        
        def run_install():
            import platform
            import threading
            import zipfile
            import shutil
            import subprocess
            is_windows = platform.system() == "Windows"
            
            project_root = get_copanel_home()
            tmp_dir = project_root / "tmp"
            tmp_dir.mkdir(exist_ok=True)
            extracted_dir = tmp_dir / f"extracted_{pkg_id}"
            
            try:
                if extracted_dir.exists():
                    shutil.rmtree(extracted_dir)
                
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(extracted_dir)
                    
                BUILD_TASKS[pkg_id]["logs"].append("Extraction complete.")
                
                found_backend = None
                found_frontend = None
                
                # Check all deep matches
                for p in extracted_dir.rglob("*"):
                    if p.is_dir():
                        if p.name == pkg_id and p.parent.name == "modules" and p.parent.parent.name == "backend":
                            found_backend = p
                        elif p.name == pkg_id and p.parent.name == "modules" and p.parent.parent.name == "src" and p.parent.parent.parent.name == "frontend":
                            found_frontend = p

                # Fallback 1: search for any backend or frontend directories
                if not found_backend:
                    for p in extracted_dir.rglob("backend"):
                        if p.is_dir():
                            if (p / "modules" / pkg_id).exists():
                                found_backend = p / "modules" / pkg_id
                            else:
                                found_backend = p

                if not found_frontend:
                    for p in extracted_dir.rglob("frontend"):
                        if p.is_dir():
                            if (p / "src" / "modules" / pkg_id).exists():
                                found_frontend = p / "src" / "modules" / pkg_id
                            else:
                                found_frontend = p

                # Fallback 2: nested parent directories
                if not found_backend or not found_frontend:
                    subdirs = [x for x in extracted_dir.iterdir() if x.is_dir()]
                    if len(subdirs) == 1:
                        if (subdirs[0] / "backend").exists():
                            found_backend = subdirs[0] / "backend"
                        if (subdirs[0] / "frontend").exists():
                            found_frontend = subdirs[0] / "frontend"

                if not found_backend and not found_frontend:
                    BUILD_TASKS[pkg_id]["status"] = "failed"
                    BUILD_TASKS[pkg_id]["error"] = "Invalid ZIP structure: 'backend' or 'frontend' folder not found."
                    BUILD_TASKS[pkg_id]["logs"].append("❌ Invalid ZIP structure: neither 'backend' nor 'frontend' folder found.")
                    return

                if Path("/opt/copanel").exists():
                    dst_backend = Path(f"/opt/copanel/backend/modules/{pkg_id}")
                    dst_frontend = Path(f"/opt/copanel/frontend/src/modules/{pkg_id}")
                    frontend_cwd = Path("/opt/copanel/frontend")
                else:
                    dst_backend = project_root / "backend" / "modules" / pkg_id
                    dst_frontend = project_root / "frontend" / "src" / "modules" / pkg_id
                    frontend_cwd = project_root / "frontend"
                
                if found_backend and found_backend.exists():
                    BUILD_TASKS[pkg_id]["logs"].append(f"Installing backend module to {dst_backend}...")
                    dst_backend.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(found_backend, dst_backend, dirs_exist_ok=True)
                    
                if found_frontend and found_frontend.exists():
                    BUILD_TASKS[pkg_id]["logs"].append(f"Installing frontend module to {dst_frontend}...")
                    dst_frontend.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(found_frontend, dst_frontend, dirs_exist_ok=True)
                
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
                        if Path("/opt/copanel").exists():
                            mod_dir = Path(f"/opt/copanel/backend/modules/{pkg_id}")
                        else:
                            mod_dir = project_root / "backend" / "modules" / pkg_id
                        vf = mod_dir / "version.txt"
                        if vf.exists():
                            save_local_version(pkg_id, vf.read_text(encoding="utf-8").strip())
                    except Exception:
                        pass
                    BUILD_TASKS[pkg_id]["logs"].append("♻️ Restarting backend service to load new modules...")
                    restart_backend_service(delay=2.0)
                else:
                    BUILD_TASKS[pkg_id]["status"] = "failed"
                    BUILD_TASKS[pkg_id]["error"] = f"npm run build failed with exit code {return_code}"
                    BUILD_TASKS[pkg_id]["logs"].append(f"❌ npm run build failed with exit code {return_code}")
                    
            except Exception as e:
                BUILD_TASKS[pkg_id]["status"] = "failed"
                BUILD_TASKS[pkg_id]["error"] = str(e)
                BUILD_TASKS[pkg_id]["logs"].append(f"❌ Error: {str(e)}")
            finally:
                if zip_path.exists(): zip_path.unlink()
                if extracted_dir.exists(): shutil.rmtree(extracted_dir)
                
        import threading
        thread = threading.Thread(target=run_install)
        thread.daemon = True
        thread.start()
        
        return {"status": "success", "message": f"Module {pkg_id} installation started."}

