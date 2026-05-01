"""
Package Manager Module - Logic
Manages installed packages and status persistent to disk.
"""
import os
import json
import shutil
from pathlib import Path
from typing import Dict, Any, List

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR.parent / "config"
PACKAGES_FILE = CONFIG_DIR / "packages.json"
MODULES_DIR = BASE_DIR / "modules"

DEFAULT_PACKAGES = [
    {
        "id": "nginx",
        "name": "Nginx Web Server",
        "description": "High-performance HTTP server and reverse proxy.",
        "icon": "Server",
        "status": "not_installed",
        "category": "Web Server"
    },
    {
        "id": "apache",
        "name": "Apache HTTP Server",
        "description": "Robust, industry-standard open-source web server.",
        "icon": "Globe",
        "status": "not_installed",
        "category": "Web Server"
    },
    {
        "id": "litespeed",
        "name": "LiteSpeed Web Server",
        "description": "High-performance, high-scalability web server.",
        "icon": "Zap",
        "status": "not_installed",
        "category": "Web Server"
    },
    {
        "id": "redis",
        "name": "Redis Data Store",
        "description": "Fast in-memory key-value data store and cache.",
        "icon": "Database",
        "status": "not_installed",
        "category": "Database & Caching"
    },
    {
        "id": "memcached",
        "name": "Memcached Cache Service",
        "description": "High-performance distributed memory object caching system.",
        "icon": "Cpu",
        "status": "not_installed",
        "category": "Database & Caching"
    },
    {
        "id": "firewall_service",
        "name": "Advanced Linux Firewall",
        "description": "Standard host-based firewall rules management.",
        "icon": "Shield",
        "status": "not_installed",
        "category": "Security & System"
    },
    {
        "id": "letsencrypt",
        "name": "Let's Encrypt SSL Manager",
        "description": "Automated free and open SSL/TLS certificate management.",
        "icon": "Lock",
        "status": "not_installed",
        "category": "Security & System"
    },
    {
        "id": "antiav",
        "name": "ClamAV Anti-virus",
        "description": "Open-source antivirus engine for detecting trojans and malware.",
        "icon": "ShieldAlert",
        "status": "not_installed",
        "category": "Security & System"
    }
]


def load_packages() -> List[Dict[str, Any]]:
    """Loads all packages and their status from storage."""
    if not CONFIG_DIR.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    
    # Mapping package ids to binary names for auto-detection
    detect_binaries = {
        "nginx": "nginx",
        "apache": "apache2",
        "redis": "redis-server",
        "memcached": "memcached",
        "firewall_service": "ufw",
    }

    try:
        saved_dict = {}
        if PACKAGES_FILE.exists():
            with open(PACKAGES_FILE, 'r', encoding='utf-8') as f:
                saved_data = json.load(f)
                saved_dict = {p["id"]: p for p in saved_data}

        merged = []
        for default_pkg in DEFAULT_PACKAGES:
            pkg_id = default_pkg["id"]
            status = "not_installed"
            if pkg_id in saved_dict:
                status = saved_dict[pkg_id].get("status", "not_installed")

            # Check if package binary is already installed on the host OS
            if status == "not_installed" and pkg_id in detect_binaries:
                if shutil.which(detect_binaries[pkg_id]):
                    status = "running"

            merged.append({**default_pkg, "status": status})
        return merged
    except Exception:
        return DEFAULT_PACKAGES


def save_packages(packages: List[Dict[str, Any]]):
    """Saves the package list to disk."""
    if not CONFIG_DIR.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(PACKAGES_FILE, 'w', encoding='utf-8') as f:
        json.dump(packages, f, indent=2, ensure_ascii=False)


def get_package(pkg_id: str) -> Dict[str, Any]:
    """Retrieves a specific package by ID."""
    packages = load_packages()
    for p in packages:
        if p["id"] == pkg_id:
            return p
    return None


def install_package(pkg_id: str) -> Dict[str, Any]:
    """Simulates package installation and generates backend modules."""
    import subprocess
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "running"
            target_pkg = p
            break

    if target_pkg:
        # If the user clicks install on 'firewall_service', physically install ufw
        if pkg_id == "firewall_service":
            if not shutil.which("ufw"):
                if shutil.which("apt-get"):
                    try:
                        subprocess.run(["apt-get", "update"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        subprocess.run(["apt-get", "install", "-y", "ufw"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except Exception:
                        pass
                elif shutil.which("yum"):
                    try:
                        subprocess.run(["yum", "install", "-y", "ufw"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except Exception:
                        pass
        save_packages(packages)
        # Load the module dynamically to backend/modules/<pkg_id>
        pkg_module_dir = MODULES_DIR / pkg_id
        if not pkg_module_dir.exists():
            pkg_module_dir.mkdir(parents=True, exist_ok=True)
            # Create standard router.py and logic.py inside the package subfolder
            with open(pkg_module_dir / "__init__.py", 'w', encoding='utf-8') as f:
                f.write("# Module initialization")
            
            with open(pkg_module_dir / "logic.py", 'w', encoding='utf-8') as f:
                f.write(f'"""\nLogic layer for {target_pkg["name"]}\n"""\n\ndef get_status():\n    return {{"status": "active", "service": "{target_pkg["name"]}"}}\n')

            with open(pkg_module_dir / "router.py", 'w', encoding='utf-8') as f:
                f.write(f'"""\nRouter for {target_pkg["name"]}\n"""\nfrom fastapi import APIRouter\nfrom . import logic\n\nrouter = APIRouter()\n\n@router.get("/status")\ndef read_status():\n    return logic.get_status()\n')

    return target_pkg


def restart_package(pkg_id: str) -> Dict[str, Any]:
    """Restarts a running package."""
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "running"
            target_pkg = p
            break
    if target_pkg:
        save_packages(packages)
    return target_pkg


def stop_package(pkg_id: str) -> Dict[str, Any]:
    """Stops a running package."""
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "stopped"
            target_pkg = p
            break
    if target_pkg:
        save_packages(packages)
    return target_pkg


def remove_package(pkg_id: str) -> Dict[str, Any]:
    """Removes a package and drops the dynamic module subfolder."""
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "not_installed"
            target_pkg = p
            break

    if target_pkg:
        save_packages(packages)
        # Clean up dynamic module directory if it exists
        pkg_module_dir = MODULES_DIR / pkg_id
        if pkg_module_dir.exists():
            shutil.rmtree(pkg_module_dir)

    return target_pkg
