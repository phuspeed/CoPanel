"""
Database Manager Logic
Exposes commands to create, list, and remove MySQL/MariaDB databases.
Supports Mock mode on Windows.
"""
import os
import shutil
import subprocess
import json
from pathlib import Path
from typing import List, Dict, Any

IS_WINDOWS = os.name == 'nt'
MOCK_DB_FILE = Path("./test_nginx/databases.json") if IS_WINDOWS else Path("/var/lib/copanel/databases.json")

class DBManager:
    @staticmethod
    def _load_mock_dbs() -> List[Dict[str, Any]]:
        if not MOCK_DB_FILE.exists():
            MOCK_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
            default_dbs = [
                {"name": "wordpress_db", "size": "2.4 MB"},
                {"name": "ecommerce_prod", "size": "15.1 MB"},
            ]
            MOCK_DB_FILE.write_text(json.dumps(default_dbs), encoding="utf-8")
            return default_dbs
        try:
            return json.loads(MOCK_DB_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []

    @staticmethod
    def _save_mock_dbs(dbs: List[Dict[str, Any]]):
        MOCK_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
        MOCK_DB_FILE.write_text(json.dumps(dbs), encoding="utf-8")

    @staticmethod
    def get_databases() -> List[Dict[str, Any]]:
        """List MySQL/MariaDB databases."""
        if IS_WINDOWS:
            return DBManager._load_mock_dbs()

        # Check if mysql CLI exists
        if not shutil.which("mysql"):
            # Fallback to local json file if MySQL is not installed
            return DBManager._load_mock_dbs()

        try:
            # Query MySQL for database names
            res = subprocess.run(
                ["sudo", "mysql", "-u", "root", "-e", "SHOW DATABASES;"],
                capture_output=True, text=True, check=True
            )
            lines = res.stdout.strip().splitlines()
            dbs = []
            for line in lines:
                dbname = line.strip()
                if dbname and dbname not in ["Database", "information_schema", "performance_schema", "mysql", "sys"]:
                    dbs.append({"name": dbname, "size": "N/A"})
            return dbs
        except Exception:
            # Fallback to mock
            return DBManager._load_mock_dbs()

    @staticmethod
    def create_database(name: str) -> Dict[str, Any]:
        """Create a new MySQL/MariaDB database."""
        if not name or not name.isalnum():
            # Support alphanumeric and underscores
            if "_" not in name:
                return {"status": "error", "message": "Database name must be valid."}

        if IS_WINDOWS:
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 MB"})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock mode)."}

        # Check if mysql CLI exists
        if not shutil.which("mysql"):
            # Fallback to mock
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 MB"})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock fallback)."}

        try:
            cmd = ["sudo", "mysql", "-u", "root", "-e", f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"Database '{name}' created successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def delete_database(name: str) -> Dict[str, Any]:
        """Delete an existing MySQL/MariaDB database."""
        if IS_WINDOWS:
            dbs = DBManager._load_mock_dbs()
            new_dbs = [db for db in dbs if db["name"] != name]
            DBManager._save_mock_dbs(new_dbs)
            return {"status": "success", "message": f"Database '{name}' deleted successfully (Mock mode)."}

        # Check if mysql CLI exists
        if not shutil.which("mysql"):
            dbs = DBManager._load_mock_dbs()
            new_dbs = [db for db in dbs if db["name"] != name]
            DBManager._save_mock_dbs(new_dbs)
            return {"status": "success", "message": f"Database '{name}' deleted successfully (Mock fallback)."}

        try:
            cmd = ["sudo", "mysql", "-u", "root", "-e", f"DROP DATABASE IF EXISTS `{name}`;"]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"Database '{name}' deleted successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
