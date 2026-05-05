"""
PostgreSQL adapter for database_manager.

Mirrors the MySQL :class:`DBManager` API so the wizard / dashboard can
treat the two engines uniformly. The actual implementation just shells out
to ``psql`` via ``sudo -u postgres`` on Linux; on Windows it falls back to
the same JSON mock store the MySQL adapter uses.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

IS_WINDOWS = os.name == "nt"
MOCK_PG_FILE = (
    Path("./test_nginx/postgres_databases.json")
    if IS_WINDOWS
    else Path("/var/lib/copanel/postgres_databases.json")
)
MOCK_PG_USERS = (
    Path("./test_nginx/postgres_users.json")
    if IS_WINDOWS
    else Path("/var/lib/copanel/postgres_users.json")
)


def _has_psql() -> bool:
    return bool(shutil.which("psql")) and not IS_WINDOWS


def _psql(sql: str) -> subprocess.CompletedProcess:
    cmd = ["sudo", "-u", "postgres", "psql", "-tAqc", sql]
    return subprocess.run(cmd, capture_output=True, text=True)


def _load_mock(path: Path, default: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(default), encoding="utf-8")
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_mock(path: Path, data: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


class PostgresManager:
    @staticmethod
    def list_databases() -> List[Dict[str, Any]]:
        if not _has_psql():
            return _load_mock(MOCK_PG_FILE, [{"name": "demo_pg", "size": "1.0 MB"}])
        try:
            res = _psql("SELECT datname FROM pg_database WHERE datistemplate = false;")
            if res.returncode != 0:
                return _load_mock(MOCK_PG_FILE, [])
            names = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            ignore = {"postgres", "template0", "template1"}
            return [{"name": n, "size": "N/A"} for n in names if n not in ignore]
        except Exception:
            return _load_mock(MOCK_PG_FILE, [])

    @staticmethod
    def create_database(name: str) -> Dict[str, Any]:
        if not name or not name.replace("_", "").isalnum():
            return {"status": "error", "message": "Database name must be alphanumeric/_."}
        if not _has_psql():
            dbs = _load_mock(MOCK_PG_FILE, [])
            if any(db["name"] == name for db in dbs):
                return {"status": "error", "message": "Database already exists."}
            dbs.append({"name": name, "size": "0 MB"})
            _save_mock(MOCK_PG_FILE, dbs)
            return {"status": "success", "message": f"Database '{name}' created (mock)."}
        res = _psql(f"CREATE DATABASE \"{name}\";")
        if res.returncode != 0:
            return {"status": "error", "message": res.stderr.strip() or "Failed to create database"}
        return {"status": "success", "message": f"Database '{name}' created successfully."}

    @staticmethod
    def delete_database(name: str) -> Dict[str, Any]:
        if not _has_psql():
            dbs = _load_mock(MOCK_PG_FILE, [])
            _save_mock(MOCK_PG_FILE, [d for d in dbs if d["name"] != name])
            return {"status": "success", "message": f"Database '{name}' deleted (mock)."}
        res = _psql(f"DROP DATABASE IF EXISTS \"{name}\";")
        if res.returncode != 0:
            return {"status": "error", "message": res.stderr.strip()}
        return {"status": "success", "message": f"Database '{name}' deleted successfully."}

    @staticmethod
    def list_users() -> List[Dict[str, Any]]:
        if not _has_psql():
            return _load_mock(MOCK_PG_USERS, [])
        try:
            res = _psql("SELECT usename FROM pg_user;")
            if res.returncode != 0:
                return _load_mock(MOCK_PG_USERS, [])
            return [{"user": line.strip(), "host": "localhost"} for line in res.stdout.splitlines() if line.strip()]
        except Exception:
            return _load_mock(MOCK_PG_USERS, [])

    @staticmethod
    def create_user(username: str, password: str, dbname: str) -> Dict[str, Any]:
        if not username or not password:
            return {"status": "error", "message": "Username and password required."}
        if not _has_psql():
            users = _load_mock(MOCK_PG_USERS, [])
            if any(u["user"] == username for u in users):
                return {"status": "error", "message": "User already exists."}
            users.append({"user": username, "host": "localhost", "db": dbname})
            _save_mock(MOCK_PG_USERS, users)
            return {"status": "success", "message": f"User '{username}' created (mock)."}
        # Quote password safely
        safe_pwd = password.replace("'", "''")
        for sql in (
            f"CREATE USER \"{username}\" WITH PASSWORD '{safe_pwd}';",
            f"GRANT ALL PRIVILEGES ON DATABASE \"{dbname}\" TO \"{username}\";",
        ):
            res = _psql(sql)
            if res.returncode != 0:
                return {"status": "error", "message": res.stderr.strip()}
        return {"status": "success", "message": f"User '{username}' created and granted on '{dbname}'."}

    @staticmethod
    def delete_user(username: str) -> Dict[str, Any]:
        if not _has_psql():
            users = _load_mock(MOCK_PG_USERS, [])
            _save_mock(MOCK_PG_USERS, [u for u in users if u["user"] != username])
            return {"status": "success", "message": f"User '{username}' deleted (mock)."}
        res = _psql(f"DROP USER IF EXISTS \"{username}\";")
        if res.returncode != 0:
            return {"status": "error", "message": res.stderr.strip()}
        return {"status": "success", "message": f"User '{username}' deleted."}
