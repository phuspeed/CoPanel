"""Google OAuth for Drive downloads (folder listing + private files)."""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

IS_WINDOWS = os.name == "nt"
CONFIG_DIR = Path("./test_nginx/download_manager") if IS_WINDOWS else Path("/opt/copanel/config/download_manager")
DB_PATH = CONFIG_DIR / "download_manager.db"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _db() -> sqlite3.Connection:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


class GoogleOAuthStore:
    @staticmethod
    def _ensure_tables() -> None:
        with _db() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS oauth_clients (
                    provider TEXT PRIMARY KEY,
                    client_id TEXT NOT NULL,
                    client_secret TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS oauth_tokens (
                    account_name TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    access_token TEXT NOT NULL,
                    refresh_token TEXT,
                    token_type TEXT,
                    expiry TEXT,
                    scope TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    account_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def save_client(client_id: str, client_secret: str, redirect_uri: str) -> None:
        GoogleOAuthStore._ensure_tables()
        now = _utc_now()
        with _db() as conn:
            conn.execute(
                """
                INSERT INTO oauth_clients (provider, client_id, client_secret, redirect_uri, created_at, updated_at)
                VALUES ('google', ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    client_id = excluded.client_id,
                    client_secret = excluded.client_secret,
                    redirect_uri = excluded.redirect_uri,
                    updated_at = excluded.updated_at
                """,
                (client_id, client_secret, redirect_uri, now, now),
            )

    @staticmethod
    def get_client() -> Optional[Dict[str, Any]]:
        GoogleOAuthStore._ensure_tables()
        with _db() as conn:
            row = conn.execute("SELECT * FROM oauth_clients WHERE provider = 'google'").fetchone()
        return dict(row) if row else None

    @staticmethod
    def create_state(account_name: str, ttl_seconds: int = 1800) -> str:
        GoogleOAuthStore._ensure_tables()
        state = secrets.token_urlsafe(24)
        expires = str(time.time() + ttl_seconds)
        with _db() as conn:
            conn.execute(
                "INSERT INTO oauth_states (state, provider, account_name, created_at, expires_at) VALUES (?, 'google', ?, ?, ?)",
                (state, account_name, _utc_now(), expires),
            )
        return state

    @staticmethod
    def get_state(state: str) -> Optional[Dict[str, Any]]:
        GoogleOAuthStore._ensure_tables()
        with _db() as conn:
            row = conn.execute(
                "SELECT * FROM oauth_states WHERE state = ? AND provider = 'google'",
                (state,),
            ).fetchone()
        if not row:
            return None
        try:
            if time.time() > float(row["expires_at"]):
                return None
        except (TypeError, ValueError):
            return None
        return dict(row)

    @staticmethod
    def delete_state(state: str) -> None:
        with _db() as conn:
            conn.execute("DELETE FROM oauth_states WHERE state = ?", (state,))

    @staticmethod
    def save_token(account_name: str, token_data: Dict[str, Any]) -> None:
        GoogleOAuthStore._ensure_tables()
        now = _utc_now()
        expiry = token_data.get("expiry") or ""
        if not expiry and token_data.get("expires_in"):
            try:
                expiry = datetime.utcfromtimestamp(
                    time.time() + int(token_data["expires_in"])
                ).isoformat()
            except (TypeError, ValueError):
                expiry = ""
        scope = token_data.get("scope", "")
        if isinstance(scope, list):
            scope = " ".join(scope)
        with _db() as conn:
            conn.execute(
                """
                INSERT INTO oauth_tokens
                (account_name, provider, access_token, refresh_token, token_type, expiry, scope, created_at, updated_at)
                VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_name) DO UPDATE SET
                    access_token = excluded.access_token,
                    refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
                    token_type = excluded.token_type,
                    expiry = excluded.expiry,
                    scope = excluded.scope,
                    updated_at = excluded.updated_at
                """,
                (
                    account_name,
                    token_data.get("access_token", ""),
                    token_data.get("refresh_token", ""),
                    token_data.get("token_type", "Bearer"),
                    expiry,
                    scope,
                    now,
                    now,
                ),
            )

    @staticmethod
    def get_token(account_name: str = "default") -> Optional[Dict[str, Any]]:
        GoogleOAuthStore._ensure_tables()
        with _db() as conn:
            row = conn.execute(
                "SELECT * FROM oauth_tokens WHERE account_name = ? AND provider = 'google'",
                (account_name,),
            ).fetchone()
        return dict(row) if row else None

    @staticmethod
    def list_status() -> List[Dict[str, Any]]:
        GoogleOAuthStore._ensure_tables()
        with _db() as conn:
            rows = conn.execute(
                "SELECT account_name, expiry, updated_at FROM oauth_tokens WHERE provider = 'google' ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]


class GoogleOAuthService:
    AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    DEFAULT_ACCOUNT = "default"

    @staticmethod
    def start_oauth(client_id: str, client_secret: str, redirect_uri: str, account_name: str = "") -> Dict[str, str]:
        account = (account_name or GoogleOAuthService.DEFAULT_ACCOUNT).strip() or GoogleOAuthService.DEFAULT_ACCOUNT
        if not client_id.strip() or not client_secret.strip() or not redirect_uri.strip():
            raise ValueError("client_id, client_secret, redirect_uri are required")
        GoogleOAuthStore.save_client(client_id.strip(), client_secret.strip(), redirect_uri.strip())
        state = GoogleOAuthStore.create_state(account)
        query = urlencode(
            {
                "client_id": client_id.strip(),
                "redirect_uri": redirect_uri.strip(),
                "response_type": "code",
                "scope": "https://www.googleapis.com/auth/drive.readonly",
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
            }
        )
        return {"state": state, "auth_url": f"{GoogleOAuthService.AUTH_URL}?{query}", "account_name": account}

    @staticmethod
    def exchange_code(code: str, state: str) -> Dict[str, str]:
        if not code or not state:
            raise ValueError("Missing OAuth code or state")
        state_row = GoogleOAuthStore.get_state(state)
        if not state_row:
            raise ValueError("Invalid or expired OAuth state")
        client = GoogleOAuthStore.get_client()
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
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ValueError(f"Google token exchange failed: {detail}") from exc
        if "access_token" not in token_data:
            raise ValueError("Google token response missing access_token")
        GoogleOAuthStore.save_token(state_row["account_name"], token_data)
        GoogleOAuthStore.delete_state(state)
        return {"account_name": state_row["account_name"]}

    @staticmethod
    def get_access_token(account_name: str = "") -> Optional[str]:
        account = (account_name or GoogleOAuthService.DEFAULT_ACCOUNT).strip() or GoogleOAuthService.DEFAULT_ACCOUNT
        row = GoogleOAuthStore.get_token(account)
        if not row:
            return None
        expiry = row.get("expiry") or ""
        if expiry:
            try:
                exp_ts = datetime.fromisoformat(expiry.replace("Z", "")).timestamp()
                if time.time() > exp_ts - 60:
                    refreshed = GoogleOAuthService._refresh_token(account, row)
                    if refreshed:
                        return refreshed
            except (TypeError, ValueError):
                pass
        return row.get("access_token") or None

    @staticmethod
    def _refresh_token(account_name: str, row: Dict[str, Any]) -> Optional[str]:
        refresh = row.get("refresh_token") or ""
        if not refresh:
            return None
        client = GoogleOAuthStore.get_client()
        if not client:
            return None
        body = urlencode(
            {
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
                "refresh_token": refresh,
                "grant_type": "refresh_token",
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
        except Exception:
            return None
        if "access_token" not in token_data:
            return None
        if not token_data.get("refresh_token"):
            token_data["refresh_token"] = refresh
        GoogleOAuthStore.save_token(account_name, token_data)
        return token_data["access_token"]

    @staticmethod
    def oauth_configured() -> bool:
        return GoogleOAuthStore.get_client() is not None
