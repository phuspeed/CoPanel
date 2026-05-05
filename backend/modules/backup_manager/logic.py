import os
import re
import json
import sqlite3
import subprocess
import shutil
import threading
import time
import configparser
import secrets
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
from datetime import datetime

DB_PATH = Path("/opt/copanel/config/backup_manager.db")
CRON_TAG_START = "# BEGIN COPANEL BACKUP"
CRON_TAG_END = "# END COPANEL BACKUP"
BACKUP_DIR = Path("/opt/copanel/backups")


class ProfileManager:
    @staticmethod
    def _get_db():
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def init_db():
        with ProfileManager._get_db() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_path TEXT NOT NULL,
                    remote_name TEXT NOT NULL,
                    remote_path TEXT NOT NULL,
                    cron_expression TEXT,
                    is_active INTEGER DEFAULT 1,
                    realtime_sync INTEGER DEFAULT 0,
                    rclone_flags TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS oauth_clients (
                    provider TEXT PRIMARY KEY,
                    client_id TEXT NOT NULL,
                    client_secret TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS oauth_tokens (
                    remote_name TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    access_token TEXT NOT NULL,
                    refresh_token TEXT,
                    token_type TEXT,
                    expiry TEXT,
                    scope TEXT,
                    encrypted_blob TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    remote_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
            """)

    @staticmethod
    def get_profiles():
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("SELECT * FROM profiles ORDER BY id DESC")
            return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_profile(profile_id: int):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def create_profile(data: dict):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("""
                INSERT INTO profiles (
                    profile_name, source_type, source_path, remote_name,
                    remote_path, cron_expression, is_active, realtime_sync, rclone_flags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                data.get("profile_name", "Untitled"),
                data.get("source_type", "folder"),
                data.get("source_path", ""),
                data.get("remote_name", ""),
                data.get("remote_path", ""),
                data.get("cron_expression", ""),
                int(data.get("is_active", 1)),
                int(data.get("realtime_sync", 0)),
                json.dumps(data.get("rclone_flags", {}))
            ))
        ProfileManager.sync_crontab()
        RealtimeSyncManager.update_watchers()
        return cursor.lastrowid

    @staticmethod
    def update_profile(profile_id: int, data: dict):
        fields = []
        values = []
        for k in ["profile_name", "source_type", "source_path", "remote_name", "remote_path", "cron_expression", "is_active", "realtime_sync"]:
            if k in data:
                fields.append(f"{k} = ?")
                values.append(int(data[k]) if isinstance(data[k], bool) else data[k])
        if "rclone_flags" in data:
            fields.append("rclone_flags = ?")
            values.append(json.dumps(data["rclone_flags"]))

        if not fields:
            return False

        values.append(profile_id)
        with ProfileManager._get_db() as conn:
            conn.execute(f"UPDATE profiles SET {', '.join(fields)} WHERE id = ?", values)
        ProfileManager.sync_crontab()
        RealtimeSyncManager.update_watchers()
        return True

    @staticmethod
    def delete_profile(profile_id: int):
        with ProfileManager._get_db() as conn:
            conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
        ProfileManager.sync_crontab()
        RealtimeSyncManager.update_watchers()
        return True

    @staticmethod
    def set_setting(key: str, value: str):
        with ProfileManager._get_db() as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))

    @staticmethod
    def get_setting(key: str, default: str = "") -> str:
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row["value"] if row else default

    @staticmethod
    def get_rclone_config_path() -> Path:
        """
        Detect rclone config path by asking rclone itself, then fallback to
        well-known locations. This ensures sync commands use the same config
        that rclone would use by default for the running user.
        """
        # Ask rclone for its own config path (most reliable)
        try:
            if shutil.which("rclone"):
                res = subprocess.run(
                    ["rclone", "config", "file"],
                    capture_output=True, text=True, timeout=5
                )
                if res.returncode == 0:
                    for line in res.stdout.splitlines():
                        line = line.strip()
                        # rclone prints the path directly, or a message containing it
                        if line and line.endswith(".conf"):
                            p = Path(line)
                            p.parent.mkdir(parents=True, exist_ok=True)
                            return p
                        # handle "Configuration file is stored at:\n/path/to/rclone.conf"
                        match = re.search(r'(/[^\s]+\.conf)', line)
                        if match:
                            p = Path(match.group(1))
                            p.parent.mkdir(parents=True, exist_ok=True)
                            return p
        except Exception:
            pass

        # Fallback: scan common locations in priority order
        for p in [
            "/root/.config/rclone/rclone.conf",
            "/home/copanel/.config/rclone/rclone.conf",
            "/opt/copanel/config/rclone.conf",
        ]:
            if Path(p).exists():
                return Path(p)

        # Last resort: create in opt path
        opt_path = Path("/opt/copanel/config/rclone.conf")
        opt_path.parent.mkdir(parents=True, exist_ok=True)
        return opt_path

    @staticmethod
    def load_rclone_config() -> str:
        """Reads the raw rclone.conf file."""
        try:
            path = ProfileManager.get_rclone_config_path()
            if path.exists():
                return path.read_text(encoding="utf-8")
            return ""
        except Exception:
            return ""

    @staticmethod
    def save_rclone_config(content: str) -> bool:
        """Writes to rclone.conf file."""
        try:
            path = ProfileManager.get_rclone_config_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            return True
        except Exception:
            return False

    @staticmethod
    def get_rclone_remotes_detail() -> list:
        """
        Returns a list of dicts: [{name, type}] for all configured remotes.
        Priority:
          1. `rclone listremotes --long --config <path>` (most accurate)
          2. configparser on rclone.conf (fallback when binary missing)
        """
        config_path = ProfileManager.get_rclone_config_path()
        remotes = []

        # Try rclone binary first (it handles edge cases like encrypted configs)
        if shutil.which("rclone"):
            try:
                res = subprocess.run(
                    ["rclone", "listremotes", "--long", "--config", str(config_path)],
                    capture_output=True, text=True, timeout=8
                )
                if res.returncode == 0 and res.stdout.strip():
                    for line in res.stdout.splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        # format: "remote_name:           type"
                        if ":" in line:
                            parts = line.split(":", 1)
                            name = parts[0].strip()
                            rtype = parts[1].strip() if len(parts) > 1 else "unknown"
                            if name:
                                remotes.append({"name": name, "type": rtype})
                    if remotes:
                        return remotes
            except Exception:
                pass

        # Fallback: parse rclone.conf with configparser
        try:
            if config_path.exists():
                cfg = configparser.ConfigParser()
                cfg.read(str(config_path), encoding="utf-8")
                for section in cfg.sections():
                    remotes.append({
                        "name": section.strip(),
                        "type": cfg.get(section, "type", fallback="unknown")
                    })
        except Exception:
            pass

        return remotes

    @staticmethod
    def save_oauth_client(provider: str, client_id: str, client_secret: str, redirect_uri: str):
        now = datetime.utcnow().isoformat()
        with ProfileManager._get_db() as conn:
            conn.execute(
                """
                INSERT INTO oauth_clients (provider, client_id, client_secret, redirect_uri, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    client_id = excluded.client_id,
                    client_secret = excluded.client_secret,
                    redirect_uri = excluded.redirect_uri,
                    updated_at = excluded.updated_at
                """,
                (provider, client_id, client_secret, redirect_uri, now, now),
            )

    @staticmethod
    def get_oauth_client(provider: str):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("SELECT * FROM oauth_clients WHERE provider = ?", (provider,))
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def create_oauth_state(provider: str, remote_name: str, ttl_seconds: int = 600) -> str:
        state = secrets.token_urlsafe(24)
        now = datetime.utcnow()
        expires = now.timestamp() + ttl_seconds
        with ProfileManager._get_db() as conn:
            conn.execute(
                "INSERT INTO oauth_states (state, provider, remote_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (state, provider, remote_name, now.isoformat(), str(expires)),
            )
        return state

    @staticmethod
    def consume_oauth_state(provider: str, state: str):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute("SELECT * FROM oauth_states WHERE state = ? AND provider = ?", (state, provider))
            row = cursor.fetchone()
            conn.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
        if not row:
            return None
        data = dict(row)
        try:
            if time.time() > float(data.get("expires_at", "0")):
                return None
        except Exception:
            return None
        return data

    @staticmethod
    def save_oauth_token(remote_name: str, provider: str, token_data: dict):
        now = datetime.utcnow().isoformat()
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", "")
        token_type = token_data.get("token_type", "Bearer")
        expiry = token_data.get("expiry", "")
        scope = token_data.get("scope", "")
        encrypted_blob = json.dumps(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expiry": expiry,
            },
            ensure_ascii=False,
        )
        with ProfileManager._get_db() as conn:
            conn.execute(
                """
                INSERT INTO oauth_tokens (
                    remote_name, provider, access_token, refresh_token, token_type,
                    expiry, scope, encrypted_blob, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(remote_name) DO UPDATE SET
                    provider = excluded.provider,
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    token_type = excluded.token_type,
                    expiry = excluded.expiry,
                    scope = excluded.scope,
                    encrypted_blob = excluded.encrypted_blob,
                    updated_at = excluded.updated_at
                """,
                (
                    remote_name, provider, access_token, refresh_token, token_type,
                    expiry, scope, encrypted_blob, now, now,
                ),
            )

    @staticmethod
    def get_oauth_token(remote_name: str, provider: str = "google"):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute(
                "SELECT * FROM oauth_tokens WHERE remote_name = ? AND provider = ?",
                (remote_name, provider),
            )
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def list_oauth_status(provider: str = "google"):
        with ProfileManager._get_db() as conn:
            cursor = conn.execute(
                "SELECT remote_name, provider, expiry, updated_at FROM oauth_tokens WHERE provider = ? ORDER BY updated_at DESC",
                (provider,),
            )
            return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def sync_google_remote_to_rclone(remote_name: str):
        token = ProfileManager.get_oauth_token(remote_name, "google")
        client = ProfileManager.get_oauth_client("google")
        if not token or not client:
            raise ValueError("Missing OAuth token or Google OAuth client settings")

        config_path = ProfileManager.get_rclone_config_path()
        config_path.parent.mkdir(parents=True, exist_ok=True)
        cfg = configparser.ConfigParser()
        if config_path.exists():
            cfg.read(str(config_path), encoding="utf-8")

        if not cfg.has_section(remote_name):
            cfg.add_section(remote_name)
        cfg.set(remote_name, "type", "drive")
        cfg.set(remote_name, "scope", "drive")
        cfg.set(remote_name, "client_id", client["client_id"])
        cfg.set(remote_name, "client_secret", client["client_secret"])
        token_json = json.dumps(
            {
                "access_token": token.get("access_token", ""),
                "token_type": token.get("token_type", "Bearer"),
                "refresh_token": token.get("refresh_token", ""),
                "expiry": token.get("expiry", ""),
            },
            separators=(",", ":"),
        )
        cfg.set(remote_name, "token", token_json)

        with config_path.open("w", encoding="utf-8") as f:
            cfg.write(f)
        return str(config_path)

    @staticmethod
    def get_rclone_remotes() -> list:
        """Returns list of remote names (strings) for backward compat."""
        return [r["name"] for r in ProfileManager.get_rclone_remotes_detail()]

    @staticmethod
    def sync_crontab():
        """Updates the OS crontab cleanly for all active profiles."""
        if os.name == 'nt':
            return

        profiles = ProfileManager.get_profiles()
        rclone_config = str(ProfileManager.get_rclone_config_path())

        res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        current_cron = res.stdout if res.returncode == 0 else ""

        lines = current_cron.splitlines()
        clean_lines = []
        in_block = False
        for line in lines:
            if line.strip() == CRON_TAG_START:
                in_block = True
                continue
            if line.strip() == CRON_TAG_END:
                in_block = False
                continue
            if not in_block:
                clean_lines.append(line)

        new_block = [CRON_TAG_START]
        for p in profiles:
            if p["is_active"] and p.get("cron_expression"):
                expr = p["cron_expression"].strip()
                pid = p["id"]
                cmd = (
                    f"{expr} RCLONE_CONFIG={rclone_config} "
                    f"/opt/copanel/venv/bin/python -c "
                    f"'import sys; sys.path.append(\"/opt/copanel/backend\"); "
                    f"from modules.backup_manager.logic import BackupTaskEngine; "
                    f"BackupTaskEngine.run_sync_task({pid})' "
                    f">> /opt/copanel/logs/backup_{pid}.log 2>&1"
                )
                new_block.append(cmd)
        new_block.append(CRON_TAG_END)

        if len(new_block) > 2:
            clean_lines.extend(new_block)

        new_cron_text = "\n".join(clean_lines) + "\n"
        subprocess.run(["crontab", "-"], input=new_cron_text, text=True)


class BackupTaskEngine:
    @staticmethod
    def export_mysql(db_name: str, out_file: Path) -> bool:
        if os.name == 'nt':
            out_file.write_text("Mock SQL dump data")
            return True
        try:
            with open(out_file, "w") as f:
                res = subprocess.run(
                    ["mysqldump", db_name],
                    stdout=f, stderr=subprocess.PIPE, text=True
                )
                if res.returncode != 0:
                    print(f"MySQL Dump Error: {res.stderr}")
                    return False
            return True
        except Exception as e:
            print(f"Exception during mysql dump: {e}")
            return False

    @staticmethod
    def run_sync_task(profile_id: int):
        """Runs the actual sync task blocking (used by Cron or internal tools)."""
        profile = ProfileManager.get_profile(profile_id)
        if not profile:
            return

        flags_str = profile.get("rclone_flags", "{}")
        flags = json.loads(flags_str) if flags_str else {}

        source_path = profile["source_path"]
        remote_path = f"{profile['remote_name']}:{profile['remote_path']}"
        rclone_config = str(ProfileManager.get_rclone_config_path())

        BACKUP_DIR.mkdir(parents=True, exist_ok=True)

        if profile["source_type"] == "mysql":
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dump_file = BACKUP_DIR / f"{source_path}_{timestamp}.sql"
            success = BackupTaskEngine.export_mysql(source_path, dump_file)
            if not success:
                return
            source_path = str(dump_file)

        cmd = [
            "rclone",
            "sync" if flags.get("sync_deletions") else "copy",
            source_path,
            remote_path,
            "--config", rclone_config,
        ]
        if flags.get("inplace"):
            cmd.append("--inplace")
        if flags.get("metadata"):
            cmd.append("--metadata")
        if flags.get("size_only"):
            cmd.append("--size-only")
        cmd.extend(["--transfers", str(flags.get("transfers", 4))])

        subprocess.run(cmd, capture_output=True)

        if profile["source_type"] == "mysql" and os.path.exists(source_path):
            os.remove(source_path)


class RealtimeSyncManager:
    """Manages background threads for Real-time inotifywait syncing."""
    _threads = {}

    @staticmethod
    def update_watchers():
        if os.name == 'nt':
            return

        profiles = ProfileManager.get_profiles()
        active_realtime_ids = set()

        for p in profiles:
            pid = p["id"]
            if p["is_active"] and p["realtime_sync"] and p["source_type"] == "folder":
                active_realtime_ids.add(pid)
                if pid not in RealtimeSyncManager._threads:
                    RealtimeSyncManager.start_watcher(p)

        to_stop = set(RealtimeSyncManager._threads.keys()) - active_realtime_ids
        for pid in to_stop:
            RealtimeSyncManager.stop_watcher(pid)

    @staticmethod
    def start_watcher(profile: dict):
        pid = profile["id"]
        source_path = profile["source_path"]

        if not shutil.which("inotifywait"):
            return

        def _watcher_loop():
            proc = subprocess.Popen(
                ["inotifywait", "-m", "-r", "-e", "modify,create,delete,move", source_path],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
            )
            RealtimeSyncManager._threads[pid] = {"process": proc, "running": True}

            last_sync = 0
            for _ in proc.stdout:
                if not RealtimeSyncManager._threads.get(pid, {}).get("running"):
                    break
                now = time.time()
                if now - last_sync > 60:
                    last_sync = now
                    time.sleep(10)
                    BackupTaskEngine.run_sync_task(pid)

            proc.terminate()

        t = threading.Thread(target=_watcher_loop, daemon=True)
        t.start()

    @staticmethod
    def stop_watcher(profile_id: int):
        t_info = RealtimeSyncManager._threads.get(profile_id)
        if t_info:
            t_info["running"] = False
            t_info["process"].terminate()
            del RealtimeSyncManager._threads[profile_id]


class GoogleOAuthService:
    AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"

    @staticmethod
    def start_oauth(remote_name: str, client_id: str, client_secret: str, redirect_uri: str):
        if not remote_name.strip():
            raise ValueError("remote_name is required")
        if not client_id.strip() or not client_secret.strip() or not redirect_uri.strip():
            raise ValueError("client_id, client_secret, redirect_uri are required")

        ProfileManager.save_oauth_client("google", client_id.strip(), client_secret.strip(), redirect_uri.strip())
        state = ProfileManager.create_oauth_state("google", remote_name.strip())

        query = urlencode(
            {
                "client_id": client_id.strip(),
                "redirect_uri": redirect_uri.strip(),
                "response_type": "code",
                "scope": "https://www.googleapis.com/auth/drive",
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
            }
        )
        return {"state": state, "auth_url": f"{GoogleOAuthService.AUTH_URL}?{query}"}

    @staticmethod
    def exchange_code(code: str, state: str):
        state_row = ProfileManager.consume_oauth_state("google", state)
        if not state_row:
            raise ValueError("Invalid or expired OAuth state")
        client = ProfileManager.get_oauth_client("google")
        if not client:
            raise ValueError("Google OAuth client is not configured")

        body = urlencode(
            {
                "code": code,
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
                "redirect_uri": client["redirect_uri"],
                "grant_type": "authorization_code",
            }
        ).encode("utf-8")
        req = Request(
            GoogleOAuthService.TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=20) as resp:
                token_data = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise ValueError(f"Google token exchange failed: {detail}") from e

        if "access_token" not in token_data:
            raise ValueError("Google token response did not include access_token")

        ProfileManager.save_oauth_token(state_row["remote_name"], "google", token_data)
        config_path = ProfileManager.sync_google_remote_to_rclone(state_row["remote_name"])
        return {"remote_name": state_row["remote_name"], "config_path": config_path}


# Initialize DB on module load
ProfileManager.init_db()
