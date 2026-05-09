"""
Database Manager Logic
Exposes commands to create, list, and remove MySQL/MariaDB databases and users.
Supports Mock mode on Windows.
"""
import json
import os
import secrets
import shlex
import shutil
import string
import subprocess
import tempfile
from pathlib import Path
import re
from typing import Any, Dict, List

_DB_NAME_SAFE = re.compile(r"^[a-zA-Z0-9_]{1,64}$")
_FORBIDDEN_DUMPS = frozenset(
    {"information_schema", "performance_schema", "mysql", "sys"}
)

IS_WINDOWS = os.name == 'nt'
MOCK_DB_FILE = Path("./test_nginx/databases.json") if IS_WINDOWS else Path("/var/lib/copanel/databases.json")
MOCK_USER_FILE = Path("./test_nginx/database_users.json") if IS_WINDOWS else Path("/var/lib/copanel/database_users.json")

def _format_storage_size(size_bytes: float) -> str:
    """Human-readable size from bytes (MySQL data_length + index_length)."""
    if size_bytes >= 1024**3:
        return f"{size_bytes / (1024 ** 3):.2f} GB"
    if size_bytes >= 1024**2:
        return f"{size_bytes / (1024 ** 2):.2f} MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.2f} KB"
    if size_bytes > 0:
        return f"{int(size_bytes)} B"
    return "0 B"


class DBManager:
    @staticmethod
    def validate_mysql_db_name(name: str) -> bool:
        if not name or not _DB_NAME_SAFE.match(name):
            return False
        return name.lower() not in _FORBIDDEN_DUMPS

    @staticmethod
    def _mysql_schema_sizes_bytes() -> Dict[str, int]:
        """Disk usage per schema from information_schema (data + indexes)."""
        if IS_WINDOWS or not shutil.which("mysql"):
            return {}
        sql = """
SELECT s.schema_name,
       COALESCE(SUM(t.data_length + t.index_length), 0) AS sz
FROM information_schema.schemata s
LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
WHERE s.schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
GROUP BY s.schema_name;
"""
        try:
            res = subprocess.run(
                ["sudo", "mysql", "-u", "root", "-N", "-B", "-e", sql],
                capture_output=True,
                text=True,
                check=True,
                timeout=120,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
            return {}
        sizes: Dict[str, int] = {}
        for line in (res.stdout or "").strip().splitlines():
            line = line.strip()
            if not line or "\t" not in line:
                continue
            name, _, rest = line.partition("\t")
            name = name.strip()
            rest = rest.strip()
            try:
                sizes[name] = int(float(rest))
            except ValueError:
                continue
        return sizes

    @staticmethod
    def dump_database_gzip_file(db_name: str) -> str:
        """Run mysqldump | gzip into a temp file. Caller must delete the path."""
        if IS_WINDOWS:
            raise RuntimeError("Database dump is not available in Windows mock mode.")
        if not DBManager.validate_mysql_db_name(db_name):
            raise ValueError("Invalid or reserved database name.")
        dump_bin = shutil.which("mysqldump") or shutil.which("mariadb-dump")
        if not dump_bin:
            raise RuntimeError("mysqldump / mariadb-dump not found on PATH.")

        fd, path = tempfile.mkstemp(suffix=".sql.gz")
        os.close(fd)
        try:
            os.unlink(path)
        except OSError:
            pass
        quoted_dump = shlex.quote(dump_bin)
        quoted_name = shlex.quote(db_name)
        quoted_path = shlex.quote(path)
        cmd = (
            f"sudo {quoted_dump} -u root --single-transaction --quick "
            f"--routines --events --triggers {quoted_name} "
            f"| gzip -c > {quoted_path}"
        )
        try:
            res = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=3600,
            )
            if res.returncode != 0 or not os.path.isfile(path) or os.path.getsize(path) == 0:
                try:
                    if os.path.isfile(path):
                        os.unlink(path)
                except OSError:
                    pass
                raise RuntimeError(
                    (res.stderr or res.stdout or "mysqldump failed.").strip() or "mysqldump failed."
                )
        except Exception:
            try:
                if os.path.isfile(path):
                    os.unlink(path)
            except OSError:
                pass
            raise
        return path

    @staticmethod
    def detect_status() -> Dict[str, Any]:
        mysql_bin = shutil.which("mysql")
        mariadb_bin = shutil.which("mariadb")
        installed = bool(mysql_bin or mariadb_bin or (not IS_WINDOWS and os.path.exists("/var/lib/mysql")))
        if IS_WINDOWS:
            return {"installed": True, "running": True, "mode": "mock", "engine": "mysql"}
        running = False
        if installed:
            try:
                res = subprocess.run(["systemctl", "is-active", "mysql"], capture_output=True, text=True)
                if res.stdout.strip() == "active":
                    running = True
                else:
                    res2 = subprocess.run(["systemctl", "is-active", "mariadb"], capture_output=True, text=True)
                    running = res2.stdout.strip() == "active"
            except Exception:
                running = False
        return {"installed": installed, "running": running, "mode": "native" if mysql_bin else "mock", "engine": "mysql"}

    @staticmethod
    def generate_password(length: int = 18) -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
        return "".join(secrets.choice(alphabet) for _ in range(max(12, min(length, 64))))

    @staticmethod
    def _load_mock_dbs() -> List[Dict[str, Any]]:
        if not MOCK_DB_FILE.exists():
            MOCK_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
            default_dbs = [
                {"name": "wordpress_db", "size": "2.40 MB", "size_bytes": 2516582},
                {"name": "ecommerce_prod", "size": "15.10 MB", "size_bytes": 15833498},
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
            sizes = DBManager._mysql_schema_sizes_bytes()
            res = subprocess.run(
                ["sudo", "mysql", "-u", "root", "-e", "SHOW DATABASES;"],
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            )
            lines = res.stdout.strip().splitlines()
            dbs = []
            skip = {"Database", "information_schema", "performance_schema", "mysql", "sys"}
            for line in lines:
                dbname = line.strip()
                if dbname and dbname not in skip:
                    b = int(sizes.get(dbname, 0))
                    dbs.append(
                        {
                            "name": dbname,
                            "size": _format_storage_size(b),
                            "size_bytes": b,
                        }
                    )
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
            dbs.append({"name": name, "size": "0 B", "size_bytes": 0})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock mode)."}

        if not shutil.which("mysql"):
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 B", "size_bytes": 0})
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

    @staticmethod
    def set_user_password(username: str, host: str, password: str) -> Dict[str, Any]:
        if not username or not password:
            return {"status": "error", "message": "Username and password are required."}
        if IS_WINDOWS or not shutil.which("mysql"):
            users = DBManager._load_mock_users()
            if not any(u["user"] == username and u.get("host", "localhost") == host for u in users):
                return {"status": "error", "message": "User not found."}
            return {"status": "success", "message": f"Password updated for '{username}' (mock)."}
        try:
            safe_pwd = password.replace("'", "\\'")
            cmd = f"ALTER USER '{username}'@'{host}' IDENTIFIED BY '{safe_pwd}'; FLUSH PRIVILEGES;"
            subprocess.run(["sudo", "mysql", "-u", "root", "-e", cmd], check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"Password updated for '{username}'."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
