"""
Database Manager Logic
Exposes commands to create, list, and remove MySQL/MariaDB databases and users.
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
MOCK_USER_FILE = Path("./test_nginx/database_users.json") if IS_WINDOWS else Path("/var/lib/copanel/database_users.json")

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
    def _load_mock_users() -> List[Dict[str, Any]]:
        if not MOCK_USER_FILE.exists():
            MOCK_USER_FILE.parent.mkdir(parents=True, exist_ok=True)
            default_users = [
                {"user": "wp_user", "host": "localhost", "db": "wordpress_db"},
                {"user": "shop_admin", "host": "localhost", "db": "ecommerce_prod"},
            ]
            MOCK_USER_FILE.write_text(json.dumps(default_users), encoding="utf-8")
            return default_users
        try:
            return json.loads(MOCK_USER_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []

    @staticmethod
    def _save_mock_users(users: List[Dict[str, Any]]):
        MOCK_USER_FILE.parent.mkdir(parents=True, exist_ok=True)
        MOCK_USER_FILE.write_text(json.dumps(users), encoding="utf-8")

    @staticmethod
    def get_databases() -> List[Dict[str, Any]]:
        """List MySQL/MariaDB databases."""
        if IS_WINDOWS:
            return DBManager._load_mock_dbs()

        if not shutil.which("mysql"):
            return DBManager._load_mock_dbs()

        try:
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
            return DBManager._load_mock_dbs()

    @staticmethod
    def create_database(name: str) -> Dict[str, Any]:
        """Create a new MySQL/MariaDB database."""
        if not name or not name.replace('_', '').isalnum():
            return {"status": "error", "message": "Database name must be valid."}

        if IS_WINDOWS:
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 MB"})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock mode)."}

        if not shutil.which("mysql"):
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

    @staticmethod
    def get_users() -> List[Dict[str, Any]]:
        """List MySQL/MariaDB Users."""
        if IS_WINDOWS:
            return DBManager._load_mock_users()

        if not shutil.which("mysql"):
            return DBManager._load_mock_users()

        try:
            # Query MySQL for user names
            res = subprocess.run(
                ["sudo", "mysql", "-u", "root", "-e", "SELECT user, host FROM mysql.user;"],
                capture_output=True, text=True, check=True
            )
            lines = res.stdout.strip().splitlines()
            users = []
            for line in lines:
                parts = line.strip().split()
                if parts and len(parts) >= 2:
                    username = parts[0]
                    host = parts[1]
                    if username not in ["user", "root", "mysql.session", "mysql.sys", "debian-sys-maint"]:
                        users.append({"user": username, "host": host, "db": "ALL / Selected"})
            return users
        except Exception:
            return DBManager._load_mock_users()

    @staticmethod
    def create_user(username: str, host: str, password: str, dbname: str) -> Dict[str, Any]:
        """Create a database user and assign privileges."""
        if not username or not password:
            return {"status": "error", "message": "Username and password are required."}

        if IS_WINDOWS:
            users = DBManager._load_mock_users()
            if any(u["user"] == username for u in users):
                return {"status": "error", "message": "User already exists."}
            users.append({"user": username, "host": host, "db": dbname})
            DBManager._save_mock_users(users)
            return {"status": "success", "message": f"User '{username}' created successfully (Mock mode)."}

        if not shutil.which("mysql"):
            users = DBManager._load_mock_users()
            if any(u["user"] == username for u in users):
                return {"status": "error", "message": "User already exists."}
            users.append({"user": username, "host": host, "db": dbname})
            DBManager._save_mock_users(users)
            return {"status": "success", "message": f"User '{username}' created successfully (Mock fallback)."}

        try:
            # Create the user & Grant privileges
            sql_user_cmd = f"CREATE USER IF NOT EXISTS '{username}'@'{host}' IDENTIFIED BY '{password}';"
            sql_grant_cmd = f"GRANT ALL PRIVILEGES ON `{dbname}`.* TO '{username}'@'{host}';"
            sql_flush_cmd = "FLUSH PRIVILEGES;"
            
            # Execute MySQL queries
            subprocess.run(["sudo", "mysql", "-u", "root", "-e", sql_user_cmd], check=True)
            if dbname and dbname != "all_databases":
                subprocess.run(["sudo", "mysql", "-u", "root", "-e", sql_grant_cmd], check=True)
            subprocess.run(["sudo", "mysql", "-u", "root", "-e", sql_flush_cmd], check=True)

            return {"status": "success", "message": f"User '{username}' created and linked to '{dbname}' successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def delete_user(username: str, host: str) -> Dict[str, Any]:
        """Delete an existing MySQL database user."""
        if IS_WINDOWS:
            users = DBManager._load_mock_users()
            new_users = [u for u in users if u["user"] != username]
            DBManager._save_mock_users(new_users)
            return {"status": "success", "message": f"User '{username}' deleted successfully (Mock mode)."}

        if not shutil.which("mysql"):
            users = DBManager._load_mock_users()
            new_users = [u for u in users if u["user"] != username]
            DBManager._save_mock_users(new_users)
            return {"status": "success", "message": f"User '{username}' deleted successfully (Mock fallback)."}

        try:
            cmd = f"DROP USER IF EXISTS '{username}'@'{host}';"
            subprocess.run(["sudo", "mysql", "-u", "root", "-e", cmd], check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"User '{username}' deleted successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
