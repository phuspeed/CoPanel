"""
Advanced PHP Manager Logic
Provides installation for PHP versions, and editing of php.ini config files.
"""
import os
import shutil
import subprocess
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

IS_WINDOWS = os.name == 'nt'
SUPPORTED_VERSIONS = ["8.3", "8.2", "8.1", "8.0", "7.4"]
DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]


def _run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def get_active_php_version() -> str:
    """Best-effort detect active system PHP CLI version."""
    if IS_WINDOWS:
        return SUPPORTED_VERSIONS[0]
    try:
        if shutil.which("php"):
            res = _run(["php", "-v"])
            if res.returncode == 0 and res.stdout:
                m = re.search(r"PHP\s+(\d+\.\d+)", res.stdout)
                if m:
                    return m.group(1)
    except Exception:
        pass
    installed = get_php_versions()
    return installed[0] if installed else "8.2"

def get_php_versions() -> List[str]:
    """Retrieves all available PHP versions."""
    if IS_WINDOWS:
        return SUPPORTED_VERSIONS
    
    installed = []
    for v in SUPPORTED_VERSIONS:
        # Check if FPM exists
        if shutil.which(f"php-fpm{v}") or os.path.exists(f"/etc/php/{v}"):
            installed.append(v)
    return installed if installed else SUPPORTED_VERSIONS


def get_php_versions_meta() -> Dict[str, Any]:
    installed = get_php_versions()
    return {
        "versions": installed,
        "active": get_active_php_version(),
    }

def get_php_modules() -> List[str]:
    """Retrieves standard PHP modules."""
    return DEFAULT_MODULES


def get_enabled_modules(version: str) -> List[str]:
    """Return enabled extensions for a specific PHP version."""
    if IS_WINDOWS:
        return DEFAULT_MODULES
    enabled_dir = Path(f"/etc/php/{version}/mods-enabled")
    if enabled_dir.exists():
        modules = []
        for ini in enabled_dir.glob("*.ini"):
            modules.append(ini.stem.replace(".ini", ""))
        return sorted(set(modules))
    php_bin = shutil.which(f"php{version}") or shutil.which("php")
    if php_bin:
        res = _run([php_bin, "-m"])
        if res.returncode == 0:
            return sorted([ln.strip().lower() for ln in res.stdout.splitlines() if ln.strip() and ln.strip()[0].isalpha()])
    return []

def install_php_version(version: str) -> Dict[str, Any]:
    """Install a specific PHP version via apt-get or yum."""
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}

    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} installed successfully (Mock mode)."}

    # Use apt-get or yum
    try:
        pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
        if pkg_manager == "apt-get":
            cmd = [
                "sudo", "apt-get", "install", "-y",
                f"php{version}", f"php{version}-fpm", f"php{version}-mysql", f"php{version}-curl",
                f"php{version}-mbstring", f"php{version}-xml", f"php{version}-zip",
            ]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully."}
        elif pkg_manager == "yum":
            # For CentOS / AlmaLinux, usually via Remi repo
            cmd = ["sudo", "yum", "install", "-y", f"php{version}-fpm", f"php{version}-mysql"]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully via yum."}
        return {"status": "error", "message": "No recognized package manager found to install PHP."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def uninstall_php_version(version: str) -> Dict[str, Any]:
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} removed successfully (Mock mode)."}
    try:
        pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
        if pkg_manager == "apt-get":
            cmd = ["sudo", "apt-get", "remove", "-y", f"php{version}", f"php{version}-*"]
            subprocess.run(cmd, check=False, capture_output=True, text=True)
            subprocess.run(["sudo", "apt-get", "autoremove", "-y"], check=False, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} removed."}
        if pkg_manager == "yum":
            cmd = ["sudo", "yum", "remove", "-y", f"php{version}*", f"php-fpm{version}"]
            subprocess.run(cmd, check=False, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} removed."}
        return {"status": "error", "message": "No recognized package manager found."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def set_active_php_version(version: str) -> Dict[str, Any]:
    """Switch active CLI PHP and restart matching FPM if available."""
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} set active (Mock mode)."}
    try:
        php_bin = shutil.which(f"php{version}")
        if php_bin and shutil.which("update-alternatives"):
            _run(["sudo", "update-alternatives", "--set", "php", php_bin])
        if shutil.which("systemctl"):
            _run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
        return {"status": "success", "message": f"PHP {version} set as active."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def toggle_php_module(version: str, module: str, enable: bool) -> Dict[str, Any]:
    """Enable/disable PHP module for selected version."""
    if not module:
        return {"status": "error", "message": "Module is required."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"Module {module} {'enabled' if enable else 'disabled'} (Mock mode)."}
    try:
        if shutil.which("phpenmod") and shutil.which("phpdismod"):
            cmd = ["sudo", "phpenmod" if enable else "phpdismod", "-v", version, module]
            res = _run(cmd)
            if res.returncode != 0 and res.stderr:
                # A few modules may not have INI link but are built-in.
                if "not found" in res.stderr.lower() or "doesn't exist" in res.stderr.lower():
                    return {"status": "error", "message": f"Module '{module}' not found for PHP {version}."}
            _run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
            return {"status": "success", "message": f"Module {module} {'enabled' if enable else 'disabled'}."}
        return {"status": "error", "message": "phpenmod/phpdismod not found on this system."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def get_php_ini(version: str) -> str:
    """Reads the php.ini configuration file for the selected PHP version."""
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    
    if ini_path.exists():
        return ini_path.read_text(encoding="utf-8", errors="ignore")
    
    # Fallback to creating a sample php.ini file
    sample = f"""; Sample php.ini for PHP {version}
memory_limit = 256M
upload_max_filesize = 500M
post_max_size = 500M
max_execution_time = 300
date.timezone = UTC
display_errors = Off
"""
    if IS_WINDOWS:
        ini_path.parent.mkdir(parents=True, exist_ok=True)
        ini_path.write_text(sample, encoding="utf-8")
        return sample
    return sample

def save_php_ini(version: str, content: str) -> Dict[str, Any]:
    """Writes to php.ini and restarts php-fpm to apply."""
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    
    try:
        ini_path.parent.mkdir(parents=True, exist_ok=True)
        ini_path.write_text(content, encoding="utf-8")
        
        # Restart FPM service on Linux
        if not IS_WINDOWS:
            service_name = f"php{version}-fpm"
            subprocess.run(["sudo", "systemctl", "restart", service_name], check=True, capture_output=True, text=True)
        
        return {"status": "success", "message": f"php.ini for PHP {version} successfully updated and restarted."}
    except Exception as e:
        return {"status": "error", "message": str(e)}
