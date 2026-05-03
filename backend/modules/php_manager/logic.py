"""
Advanced PHP Manager Logic
Provides installation for PHP versions, and editing of php.ini config files.
"""
import os
import shutil
import subprocess
from pathlib import Path
from typing import List, Dict, Any

IS_WINDOWS = os.name == 'nt'
SUPPORTED_VERSIONS = ["8.3", "8.2", "8.1", "8.0", "7.4"]
DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]

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

def get_php_modules() -> List[str]:
    """Retrieves standard PHP modules."""
    return DEFAULT_MODULES

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
            cmd = ["sudo", "apt-get", "install", "-y", f"php{version}-fpm", f"php{version}-mysql", f"php{version}-curl"]
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
