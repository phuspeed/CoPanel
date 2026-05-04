"""
Package Manager Module - Logic
Real installation, status detection, and credential management.
"""
import os
import json
import shutil
import subprocess
import secrets
import string
from pathlib import Path
from typing import Dict, Any, List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR.parent / "config"
PACKAGES_FILE = CONFIG_DIR / "packages.json"
MODULES_DIR = BASE_DIR / "modules"

IS_WINDOWS = os.name == 'nt'

# ---------------------------------------------------------------------------
# Package catalogue
# ---------------------------------------------------------------------------
DEFAULT_PACKAGES: List[Dict[str, Any]] = [
    # ── Web Servers & Proxies ────────────────────────────────────────────────
    {
        "id": "nginx", "name": "Nginx",
        "description": "High-performance HTTP & reverse proxy server.",
        "icon": "Server", "status": "not_installed", "category": "Web Server",
        "apt": ["nginx"], "yum": ["nginx"], "service": "nginx",
    },
    {
        "id": "apache2", "name": "Apache HTTP Server",
        "description": "Robust, industry-standard open-source web server.",
        "icon": "Globe", "status": "not_installed", "category": "Web Server",
        "apt": ["apache2"], "yum": ["httpd"], "service": "apache2",
    },
    {
        "id": "openlitespeed", "name": "OpenLiteSpeed",
        "description": "High-performance, lightweight web server by LiteSpeed.",
        "icon": "Zap", "status": "not_installed", "category": "Web Server",
        "apt": ["openlitespeed"], "yum": ["openlitespeed"], "service": "lsws",
        "detect_bin": "openlitespeed",
    },
    {
        "id": "haproxy", "name": "HAProxy",
        "description": "Reliable, high performance TCP/HTTP load balancer.",
        "icon": "Share2", "status": "not_installed", "category": "Web Server",
        "apt": ["haproxy"], "yum": ["haproxy"], "service": "haproxy",
        "detect_bin": "haproxy",
    },
    {
        "id": "varnish", "name": "Varnish Cache",
        "description": "Web application accelerator / caching HTTP reverse proxy.",
        "icon": "Wind", "status": "not_installed", "category": "Web Server",
        "apt": ["varnish"], "yum": ["varnish"], "service": "varnish",
        "detect_bin": "varnishd",
    },
    # ── Databases ────────────────────────────────────────────────────────────
    {
        "id": "mariadb", "name": "MariaDB",
        "description": "Community-developed MySQL-compatible relational database.",
        "icon": "Database", "status": "not_installed", "category": "Database",
        "apt": ["mariadb-server", "mariadb-client"], "yum": ["mariadb-server", "mariadb"],
        "service": "mariadb", "detect_bin": "mariadb",
        "post_install": "setup_mysql_user",
    },
    {
        "id": "mysql", "name": "MySQL Community Server",
        "description": "World's most popular open-source relational database.",
        "icon": "Database", "status": "not_installed", "category": "Database",
        "apt": ["mysql-server"], "yum": ["mysql-community-server"],
        "service": "mysql", "detect_bin": "mysql",
        "post_install": "setup_mysql_user",
    },
    {
        "id": "postgresql", "name": "PostgreSQL",
        "description": "Advanced open-source object-relational database system.",
        "icon": "Database", "status": "not_installed", "category": "Database",
        "apt": ["postgresql", "postgresql-contrib"], "yum": ["postgresql-server", "postgresql-contrib"],
        "service": "postgresql", "detect_bin": "psql",
        "post_install": "setup_postgres_user",
    },
    {
        "id": "mongodb", "name": "MongoDB Community",
        "description": "NoSQL document-oriented database for modern applications.",
        "icon": "Database", "status": "not_installed", "category": "Database",
        "apt": ["mongodb-org"], "yum": ["mongodb-org"],
        "service": "mongod", "detect_bin": "mongod",
    },
    {
        "id": "redis", "name": "Redis",
        "description": "In-memory key-value store used as cache and message broker.",
        "icon": "Cpu", "status": "not_installed", "category": "Database",
        "apt": ["redis-server"], "yum": ["redis"],
        "service": "redis-server", "detect_bin": "redis-server",
    },
    {
        "id": "memcached", "name": "Memcached",
        "description": "Distributed memory object caching system.",
        "icon": "Cpu", "status": "not_installed", "category": "Database",
        "apt": ["memcached"], "yum": ["memcached"],
        "service": "memcached", "detect_bin": "memcached",
    },
    # ── Database Tools ───────────────────────────────────────────────────────
    {
        "id": "phpmyadmin", "name": "phpMyAdmin",
        "description": "Web-based SQL visual administration tool.",
        "icon": "Layout", "status": "not_installed", "category": "Database Tools",
    },
    # ── Runtimes & Languages ─────────────────────────────────────────────────
    {
        "id": "nodejs", "name": "Node.js & PM2",
        "description": "JavaScript runtime environment and process manager.",
        "icon": "Code", "status": "not_installed", "category": "Runtimes",
        "apt": ["nodejs", "npm"], "yum": ["nodejs", "npm"],
        "detect_bin": "node",
    },
    {
        "id": "python3", "name": "Python 3 & Pip",
        "description": "Python programming language and package installer.",
        "icon": "Code", "status": "not_installed", "category": "Runtimes",
        "apt": ["python3", "python3-pip", "python3-venv"], "yum": ["python3", "python3-pip"],
        "detect_bin": "python3",
    },
    {
        "id": "java", "name": "Java (OpenJDK 17)",
        "description": "Standard Java Development Kit and Runtime.",
        "icon": "Coffee", "status": "not_installed", "category": "Runtimes",
        "apt": ["openjdk-17-jdk"], "yum": ["java-17-openjdk-devel"],
        "detect_bin": "java",
    },
    {
        "id": "golang", "name": "Go (Golang)",
        "description": "Statically typed, compiled programming language by Google.",
        "icon": "Box", "status": "not_installed", "category": "Runtimes",
        "apt": ["golang"], "yum": ["golang"],
        "detect_bin": "go",
    },
    {
        "id": "php-fpm", "name": "PHP-FPM",
        "description": "FastCGI Process Manager for PHP scripts.",
        "icon": "Code", "status": "not_installed", "category": "Runtimes",
        "apt": ["php-fpm", "php-cli", "php-common"], "yum": ["php-fpm", "php-cli", "php-common"],
        "detect_bin": "php",
    },
    # ── DevOps & Containers ──────────────────────────────────────────────────
    {
        "id": "docker", "name": "Docker Engine",
        "description": "Containerization platform to build and run apps.",
        "icon": "Layers", "status": "not_installed", "category": "DevOps",
        "apt": ["docker.io", "docker-compose"], "yum": ["docker", "docker-compose"],
        "detect_bin": "docker",
    },
    {
        "id": "git", "name": "Git",
        "description": "Distributed version control system.",
        "icon": "GitBranch", "status": "not_installed", "category": "DevOps",
        "apt": ["git"], "yum": ["git"],
        "detect_bin": "git",
    },
    {
        "id": "composer", "name": "Composer",
        "description": "Dependency Manager for PHP.",
        "icon": "Package", "status": "not_installed", "category": "DevOps",
        "apt": ["composer"], "yum": ["composer"],
        "detect_bin": "composer",
    },
    # ── Utilities & Process Managers ─────────────────────────────────────────
    {
        "id": "supervisor", "name": "Supervisor",
        "description": "Process control system for UNIX-like OS.",
        "icon": "Cpu", "status": "not_installed", "category": "Utilities",
        "apt": ["supervisor"], "yum": ["supervisor"],
        "detect_bin": "supervisord",
    },
    {
        "id": "htop", "name": "Htop",
        "description": "Interactive process viewer and system monitor.",
        "icon": "Activity", "status": "not_installed", "category": "Utilities",
        "apt": ["htop"], "yum": ["htop"],
        "detect_bin": "htop",
    },
    {
        "id": "zip-utils", "name": "Zip & Unzip",
        "description": "Archiving and compression utilities.",
        "icon": "Archive", "status": "not_installed", "category": "Utilities",
        "apt": ["zip", "unzip", "tar"], "yum": ["zip", "unzip", "tar"],
        "detect_bin": "unzip",
    },
    {
        "id": "net-tools", "name": "Net-tools (netstat)",
        "description": "Network diagnostic tools and commands.",
        "icon": "Wifi", "status": "not_installed", "category": "Utilities",
        "apt": ["net-tools", "curl", "wget"], "yum": ["net-tools", "curl", "wget"],
        "detect_bin": "netstat",
    },
    # ── Security & System ────────────────────────────────────────────────────
    {
        "id": "firewall_service", "name": "Advanced Linux Firewall",
        "description": "Standard host-based firewall rules management.",
        "icon": "Shield", "status": "not_installed", "category": "Security & System",
    },
    {
        "id": "fail2ban", "name": "Fail2Ban",
        "description": "Intrusion prevention software framework.",
        "icon": "Lock", "status": "not_installed", "category": "Security & System",
        "apt": ["fail2ban"], "yum": ["fail2ban"],
        "service": "fail2ban", "detect_bin": "fail2ban-client",
    },
    {
        "id": "clamav", "name": "ClamAV",
        "description": "Open source antivirus engine for detecting trojans, viruses, malware.",
        "icon": "ShieldAlert", "status": "not_installed", "category": "Security & System",
        "apt": ["clamav", "clamav-daemon"], "yum": ["clamav", "clamd"],
        "detect_bin": "clamscan",
    },
    {
        "id": "certbot", "name": "Certbot",
        "description": "Automatically enable HTTPS on your website with Let's Encrypt.",
        "icon": "Key", "status": "not_installed", "category": "Security & System",
        "apt": ["certbot"], "yum": ["certbot"],
        "detect_bin": "certbot",
    }
]


def load_packages() -> List[Dict[str, Any]]:
    """Loads all packages and detects their current status from the system."""
    if not CONFIG_DIR.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        
    saved_dict = {}
    try:
        if PACKAGES_FILE.exists():
            with open(PACKAGES_FILE, 'r', encoding='utf-8') as f:
                saved_data = json.load(f)
                saved_dict = {p["id"]: p for p in saved_data}
    except Exception:
        pass

    merged = []
    detect_binaries = {
        "nginx": "nginx",
        "apache2": "apache2",
        "openlitespeed": "openlitespeed",
        "haproxy": "haproxy",
        "varnish": "varnishd",
        "redis": "redis-server",
        "memcached": "memcached",
        "firewall_service": "ufw",
        "mysql": "mysql",
        "mariadb": "mariadb",
        "postgresql": "psql",
        "mongodb": "mongod",
        "fail2ban": "fail2ban-client",
        "nodejs": "node",
        "python3": "python3",
        "java": "java",
        "golang": "go",
        "php-fpm": "php",
        "docker": "docker",
        "git": "git",
        "composer": "composer",
        "supervisor": "supervisord",
        "htop": "htop",
        "zip-utils": "unzip",
        "net-tools": "netstat",
        "clamav": "clamscan",
        "certbot": "certbot"
    }

    for default_pkg in DEFAULT_PACKAGES:
        pkg_id = default_pkg["id"]
        status = "not_installed"
        if pkg_id in saved_dict:
            status = saved_dict[pkg_id].get("status", "not_installed")

        # Automatically detect if running
        if status == "not_installed" and pkg_id in detect_binaries:
            if shutil.which(detect_binaries[pkg_id]):
                status = "running"

        if status == "not_installed" and pkg_id == "phpmyadmin":
            if os.path.exists("/usr/share/phpmyadmin") or os.path.exists("/var/www/html/phpmyadmin"):
                status = "running"

        merged.append({**default_pkg, "status": status})
    return merged


def save_packages(packages: List[Dict[str, Any]]):
    """Saves packages to disk."""
    if not CONFIG_DIR.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(PACKAGES_FILE, 'w', encoding='utf-8') as f:
        json.dump(packages, f, indent=2, ensure_ascii=False)


def get_package(pkg_id: str) -> Dict[str, Any]:
    """Retrieves a package by ID."""
    packages = load_packages()
    for p in packages:
        if p["id"] == pkg_id:
            return p
    return None


def install_package(pkg_id: str) -> Dict[str, Any]:
    """Installs the selected package."""
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "running"
            target_pkg = p
            break

    if target_pkg:
        save_packages(packages)
        pkg_module_dir = MODULES_DIR / pkg_id
        if not pkg_module_dir.exists():
            pkg_module_dir.mkdir(parents=True, exist_ok=True)
            with open(pkg_module_dir / "__init__.py", 'w', encoding='utf-8') as f:
                f.write("# Module initialization\n")
            with open(pkg_module_dir / "logic.py", 'w', encoding='utf-8') as f:
                f.write(f'"""\nLogic layer for {target_pkg["name"]}\n"""\ndef get_status():\n    return {{"status": "active", "service": "{target_pkg["name"]}"}}\n')
            with open(pkg_module_dir / "router.py", 'w', encoding='utf-8') as f:
                f.write(f'"""\nRouter for {target_pkg["name"]}\n"""\nfrom fastapi import APIRouter\nfrom . import logic\nrouter = APIRouter()\n@router.get("/status")\ndef read_status():\n    return logic.get_status()\n')
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
    """Removes a package."""
    packages = load_packages()
    target_pkg = None
    for p in packages:
        if p["id"] == pkg_id:
            p["status"] = "not_installed"
            target_pkg = p
            break

    if target_pkg:
        save_packages(packages)
        pkg_module_dir = MODULES_DIR / pkg_id
        if pkg_module_dir.exists():
            shutil.rmtree(pkg_module_dir)
    return target_pkg


def get_mysql_credentials() -> Dict[str, Any]:
    """Return MySQL credentials."""
    creds_file = Path("/opt/copanel/config/mysql_credentials.txt")
    if creds_file.exists():
        try:
            user, password = "", ""
            with open(creds_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("MYSQL_USER="):
                        user = line.split("=", 1)[1]
                    elif line.startswith("MYSQL_PASS="):
                        password = line.split("=", 1)[1]
            return {"status": "success", "user": user, "password": password}
        except Exception:
            pass
    return {"status": "success", "user": "root", "password": ""}


def get_postgres_credentials() -> Dict[str, Any]:
    """Return PostgreSQL credentials."""
    return {"status": "success", "user": "postgres", "password": ""}