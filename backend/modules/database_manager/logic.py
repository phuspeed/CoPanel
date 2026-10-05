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

from core import sysexec
from core.validators import (
    escape_mysql_literal,
    validate_db_name,
    validate_db_username,
    validate_mysql_host,
)

_DB_NAME_SAFE = re.compile(r"^[a-zA-Z0-9_]{1,64}$")
_FORBIDDEN_DUMPS = frozenset(
    {"information_schema", "performance_schema", "mysql", "sys"}
)

IS_WINDOWS = os.name == 'nt'
MOCK_DB_FILE = Path("./test_nginx/databases.json") if IS_WINDOWS else Path("/var/lib/copanel/databases.json")
MOCK_USER_FILE = Path("./test_nginx/database_users.json") if IS_WINDOWS else Path("/var/lib/copanel/database_users.json")

def _use_mock() -> bool:
    """Fake databases are only for Windows and explicit test mode."""
    if IS_WINDOWS:
        return True
    return os.environ.get("COPANEL_MOCK") == "1"


def _mysql_missing() -> Dict[str, Any]:
    return {
        "status": "error",
        "message": "MySQL/MariaDB is not installed (mysql client not found).",
    }


def _mysql_stdin(sql: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run SQL as root via stdin so statements never appear in process argv."""
    argv = sysexec.prepare_argv(["mysql", "-u", "root", "--batch"], as_root=True)
    return subprocess.run(
        argv,
        input=sql,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        shell=False,
    )


def _mysql_ok(res: subprocess.CompletedProcess) -> None:
    if res.returncode != 0:
        detail = (res.stderr or res.stdout or "mysql failed").strip()
        raise RuntimeError(detail or "mysql failed")


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
                sysexec.prepare_argv(["mysql", "-u", "root", "-N", "-B"], as_root=True),
                input=sql,
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
        quoted_name = shlex.quote(db_name)
        quoted_path = shlex.quote(path)
        dump_argv = sysexec.prepare_argv(
            [dump_bin, "-u", "root", "--single-transaction", "--quick", "--routines", "--events", "--triggers", db_name],
            as_root=True,
        )
        quoted_dump = " ".join(shlex.quote(part) for part in dump_argv[:-1])
        cmd = f"{quoted_dump} {quoted_name} | gzip -c > {quoted_path}"
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
        mode = "mock" if _use_mock() else ("native" if mysql_bin else "unavailable")
        return {"installed": installed, "running": running, "mode": mode, "engine": "mysql"}

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
            if _use_mock():
                return DBManager._load_mock_dbs()
            return []

        try:
            sizes = DBManager._mysql_schema_sizes_bytes()
            res = _mysql_stdin("SHOW DATABASES;", timeout=60)
            if res.returncode != 0:
                raise RuntimeError((res.stderr or res.stdout or "mysql failed").strip())
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
            if _use_mock():
                return DBManager._load_mock_dbs()
            return []

    @staticmethod
    def create_database(name: str) -> Dict[str, Any]:
        """Create a new MySQL/MariaDB database."""
        try:
            name = validate_db_name(name)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}
        if not DBManager.validate_mysql_db_name(name):
            return {"status": "error", "message": "Database name must be valid."}

        if IS_WINDOWS:
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 B", "size_bytes": 0})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock mode)."}

        if not shutil.which("mysql"):
            if not _use_mock():
                return _mysql_missing()
            dbs = DBManager._load_mock_dbs()
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 B", "size_bytes": 0})
            DBManager._save_mock_dbs(dbs)
            return {"status": "success", "message": f"Database '{name}' created successfully (Mock fallback)."}

        try:
            sql = (
                f"CREATE DATABASE IF NOT EXISTS `{name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
            )
            _mysql_ok(_mysql_stdin(sql))
            return {"status": "success", "message": f"Database '{name}' created successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def delete_database(name: str) -> Dict[str, Any]:
        """Delete an existing MySQL/MariaDB database."""
        try:
            name = validate_db_name(name)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}
        if not DBManager.validate_mysql_db_name(name):
            return {"status": "error", "message": "Database name must be valid."}

        if IS_WINDOWS:
            dbs = DBManager._load_mock_dbs()
            new_dbs = [db for db in dbs if db["name"] != name]
            DBManager._save_mock_dbs(new_dbs)
            return {"status": "success", "message": f"Database '{name}' deleted successfully (Mock mode)."}

        if not shutil.which("mysql"):
            if not _use_mock():
                return _mysql_missing()
            dbs = DBManager._load_mock_dbs()
            new_dbs = [db for db in dbs if db["name"] != name]
            DBManager._save_mock_dbs(new_dbs)
            return {"status": "success", "message": f"Database '{name}' deleted successfully (Mock fallback)."}

        try:
            _mysql_ok(_mysql_stdin(f"DROP DATABASE IF EXISTS `{name}`;"))
            return {"status": "success", "message": f"Database '{name}' deleted successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def get_users() -> List[Dict[str, Any]]:
        """List MySQL/MariaDB Users."""
        if IS_WINDOWS:
            return DBManager._load_mock_users()

        if not shutil.which("mysql"):
            if _use_mock():
                return DBManager._load_mock_users()
            return []

        try:
            # Query MySQL for user names
            res = _mysql_stdin("SELECT user, host FROM mysql.user;", timeout=30)
            if res.returncode != 0:
                raise RuntimeError((res.stderr or res.stdout or "mysql failed").strip())
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
            if _use_mock():
                return DBManager._load_mock_users()
            return []

    @staticmethod
    def create_user(username: str, host: str, password: str, dbname: str) -> Dict[str, Any]:
        """Create a database user and assign privileges."""
        try:
            username = validate_db_username(username)
            host = validate_mysql_host(host)
            if dbname and dbname != "all_databases":
                dbname = validate_db_name(dbname)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}
        if not password or "\x00" in password:
            return {"status": "error", "message": "Username and password are required."}

        if IS_WINDOWS:
            users = DBManager._load_mock_users()
            if any(u["user"] == username for u in users):
                return {"status": "error", "message": "User already exists."}
            users.append({"user": username, "host": host, "db": dbname})
            DBManager._save_mock_users(users)
            return {"status": "success", "message": f"User '{username}' created successfully (Mock mode)."}

        if not shutil.which("mysql"):
            if not _use_mock():
                return _mysql_missing()
            users = DBManager._load_mock_users()
            if any(u["user"] == username for u in users):
                return {"status": "error", "message": "User already exists."}
            users.append({"user": username, "host": host, "db": dbname})
            DBManager._save_mock_users(users)
            return {"status": "success", "message": f"User '{username}' created successfully (Mock fallback)."}

        try:
            safe_pwd = escape_mysql_literal(password)
            hosts = [host]
            if host == "localhost":
                hosts.append("127.0.0.1")
            elif host == "127.0.0.1":
                hosts.append("localhost")

            statements = []
            for user_host in dict.fromkeys(hosts):
                statements.append(
                    f"CREATE USER IF NOT EXISTS '{username}'@'{user_host}' IDENTIFIED BY '{safe_pwd}';"
                    f"ALTER USER '{username}'@'{user_host}' IDENTIFIED BY '{safe_pwd}';"
                )
                if dbname and dbname != "all_databases":
                    statements.append(
                        f"GRANT ALL PRIVILEGES ON `{dbname}`.* TO '{username}'@'{user_host}';"
                    )
            statements.append("FLUSH PRIVILEGES;")
            _mysql_ok(_mysql_stdin("".join(statements)))

            return {"status": "success", "message": f"User '{username}' created and linked to '{dbname}' successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def _query_lines(sql: str) -> List[str]:
        res = _mysql_stdin(sql, timeout=15)
        _mysql_ok(res)
        lines = []
        for line in (res.stdout or "").splitlines():
            text = line.strip()
            if not text or text.lower() in {"db", "user", "database"}:
                continue
            lines.append(text.split("\t", 1)[0])
        return lines

    @staticmethod
    def database_exists(name: str) -> bool:
        name = validate_db_name(name)
        if _use_mock() or not shutil.which("mysql"):
            return any(db.get("name") == name for db in DBManager._load_mock_dbs()) if _use_mock() else False
        try:
            return name in DBManager._query_lines(f"SHOW DATABASES LIKE '{name}';")
        except Exception:
            return False

    @staticmethod
    def user_databases(username: str) -> List[str]:
        username = validate_db_username(username)
        if not shutil.which("mysql"):
            return []
        return DBManager._query_lines(
            f"SELECT Db FROM mysql.db WHERE User='{username}';"
        )

    @staticmethod
    def mysql_user_exists(username: str) -> bool:
        username = validate_db_username(username)
        if not shutil.which("mysql"):
            return False
        return username in DBManager._query_lines(
            f"SELECT User FROM mysql.user WHERE User='{username}';"
        )

    @staticmethod
    def ensure_site_user(username: str, host: str, password: str, dbname: str) -> Dict[str, Any]:
        """Create a site DB user without resetting a password that belongs to another site.

        If the account already has privileges on a different database, this
        refuses to run ``ALTER USER``. If it already belongs to ``dbname``,
        the password is left unchanged.
        """
        try:
            username = validate_db_username(username)
            host = validate_mysql_host(host)
            dbname = validate_db_name(dbname)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}
        if not password or "\x00" in password:
            return {"status": "error", "message": "Username and password are required."}
        if _use_mock():
            return DBManager.create_user(username, host, password, dbname)
        if not shutil.which("mysql"):
            return _mysql_missing()
        try:
            other = [db for db in DBManager.user_databases(username) if db and db != dbname]
            if other:
                return {
                    "status": "error",
                    "message": (
                        f"Database user '{username}' already has privileges on "
                        f"{', '.join(other)}. Refusing to change its password."
                    ),
                }
            exists = DBManager.mysql_user_exists(username)
            hosts = [host]
            if host == "localhost":
                hosts.append("127.0.0.1")
            elif host == "127.0.0.1":
                hosts.append("localhost")
            statements = []
            if not exists:
                safe_pwd = escape_mysql_literal(password)
                for user_host in dict.fromkeys(hosts):
                    statements.append(
                        f"CREATE USER '{username}'@'{user_host}' IDENTIFIED BY '{safe_pwd}';"
                    )
            for user_host in dict.fromkeys(hosts):
                statements.append(
                    f"GRANT ALL PRIVILEGES ON `{dbname}`.* TO '{username}'@'{user_host}';"
                )
            statements.append("FLUSH PRIVILEGES;")
            _mysql_ok(_mysql_stdin("".join(statements)))
            if exists:
                return {
                    "status": "success",
                    "created": False,
                    "password_unchanged": True,
                    "message": f"Database user '{username}' already exists; password was not changed.",
                }
            return {
                "status": "success",
                "created": True,
                "password_unchanged": False,
                "message": f"User '{username}' created and linked to '{dbname}'.",
            }
        except Exception as exc:
            return {"status": "error", "message": str(exc)}

    @staticmethod
    def delete_user(username: str, host: str) -> Dict[str, Any]:
        """Delete an existing MySQL database user."""
        try:
            username = validate_db_username(username)
            host = validate_mysql_host(host)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}

        if IS_WINDOWS:
            users = DBManager._load_mock_users()
            new_users = [u for u in users if u["user"] != username]
            DBManager._save_mock_users(new_users)
            return {"status": "success", "message": f"User '{username}' deleted successfully (Mock mode)."}

        if not shutil.which("mysql"):
            if not _use_mock():
                return _mysql_missing()
            users = DBManager._load_mock_users()
            new_users = [u for u in users if u["user"] != username]
            DBManager._save_mock_users(new_users)
            return {"status": "success", "message": f"User '{username}' deleted successfully (Mock fallback)."}

        try:
            _mysql_ok(_mysql_stdin(f"DROP USER IF EXISTS '{username}'@'{host}';"))
            return {"status": "success", "message": f"User '{username}' deleted successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def set_user_password(username: str, host: str, password: str) -> Dict[str, Any]:
        try:
            username = validate_db_username(username)
            host = validate_mysql_host(host)
        except ValueError as exc:
            return {"status": "error", "message": str(exc)}
        if not password or "\x00" in password:
            return {"status": "error", "message": "Username and password are required."}
        if IS_WINDOWS or (_use_mock() and not shutil.which("mysql")):
            users = DBManager._load_mock_users()
            if not any(u["user"] == username and u.get("host", "localhost") == host for u in users):
                return {"status": "error", "message": "User not found."}
            return {"status": "success", "message": f"Password updated for '{username}' (mock)."}
        if not shutil.which("mysql"):
            return _mysql_missing()
        try:
            safe_pwd = escape_mysql_literal(password)
            sql = (
                f"ALTER USER '{username}'@'{host}' IDENTIFIED BY '{safe_pwd}'; "
                "FLUSH PRIVILEGES;"
            )
            _mysql_ok(_mysql_stdin(sql))
            return {"status": "success", "message": f"Password updated for '{username}'."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
