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

IS_WINDOWS = os.name == 'nt'

# ---------------------------------------------------------------------------
# Package catalogue
# ---------------------------------------------------------------------------
DEFAULT_PACKAGES: List[Dict[str, Any]] = [
    # ── Web Servers ─────────────────────────────────────────────────────────
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
        "description": 