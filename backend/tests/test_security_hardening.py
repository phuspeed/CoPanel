"""Pen-test follow-ups: private DB mode, docs off, query JWT, login lockout."""
from __future__ import annotations

import os
import stat
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.api import install_exception_handlers
from core.auth import api_auth_middleware
from core.paths import connect_private_sqlite, harden_config_private_files, harden_private_file
from core.security import create_access_token
from modules.auth.router import (
    _LOGIN_MAX_FAILURES,
    _record_login_failure,
    _reset_login_attempts,
    router as auth_router,
)


class PrivateDbModeTests(unittest.TestCase):
    def test_connect_private_sqlite_creates_mode_0600(self):
        path = Path(os.environ["COPANEL_TEST_CONFIG_DIR"]) / "private-create.db"
        if path.exists():
            path.unlink()
        conn = connect_private_sqlite(path)
        conn.close()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_connect_private_sqlite_tightens_existing_world_readable(self):
        path = Path(os.environ["COPANEL_TEST_CONFIG_DIR"]) / "private-upgrade.db"
        path.write_bytes(b"")
        path.chmod(0o644)
        conn = connect_private_sqlite(path)
        conn.close()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_harden_config_private_files_covers_db_and_named_secrets(self):
        root = Path(os.environ["COPANEL_TEST_CONFIG_DIR"]) / "harden-root"
        root.mkdir(exist_ok=True)
        db = root / "copanel.db"
        secret = root / "jwt_secret"
        other = root / "notes.txt"
        for item in (db, secret, other):
            item.write_text("x", encoding="utf-8")
            item.chmod(0o644)
        harden_config_private_files(root)
        self.assertEqual(stat.S_IMODE(db.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(secret.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(other.stat().st_mode), 0o644)
        harden_private_file(other)
        self.assertEqual(stat.S_IMODE(other.stat().st_mode), 0o600)


class DocsDisabledTests(unittest.TestCase):
    def test_docs_kwargs_disabled_by_default(self):
        from core.auth import fastapi_docs_enabled, fastapi_docs_kwargs

        previous = os.environ.pop("COPANEL_ENABLE_DOCS", None)
        try:
            self.assertFalse(fastapi_docs_enabled())
            self.assertEqual(
                fastapi_docs_kwargs(),
                {"docs_url": None, "redoc_url": None, "openapi_url": None},
            )
            app = FastAPI(**fastapi_docs_kwargs())
            client = TestClient(app)
            self.assertEqual(client.get("/docs").status_code, 404)
            self.assertEqual(client.get("/redoc").status_code, 404)
            self.assertEqual(client.get("/openapi.json").status_code, 404)
        finally:
            if previous is None:
                os.environ.pop("COPANEL_ENABLE_DOCS", None)
            else:
                os.environ["COPANEL_ENABLE_DOCS"] = previous

    def test_docs_kwargs_enabled_when_flag_set(self):
        from core.auth import fastapi_docs_enabled, fastapi_docs_kwargs

        previous = os.environ.get("COPANEL_ENABLE_DOCS")
        os.environ["COPANEL_ENABLE_DOCS"] = "1"
        try:
            self.assertTrue(fastapi_docs_enabled())
            self.assertEqual(fastapi_docs_kwargs(), {})
        finally:
            if previous is None:
                os.environ.pop("COPANEL_ENABLE_DOCS", None)
            else:
                os.environ["COPANEL_ENABLE_DOCS"] = previous


class QueryTokenRejectedTests(unittest.TestCase):
    def setUp(self):
        import core.auth as auth_mod

        self._prev_env = os.environ.get("COPANEL_DISABLE_AUTH")
        self._prev_flag = auth_mod._AUTH_DISABLED
        os.environ["COPANEL_DISABLE_AUTH"] = "0"
        auth_mod._AUTH_DISABLED = False

        from core import user_model

        self._username = "query-token-user"
        existing = user_model.get_user_by_username(self._username)
        if existing:
            user_model.delete_user(int(existing["id"]))
        user_id = user_model.create_user(self._username, "unused-password-9", "user", "[]", "[]")
        user = user_model.get_user_by_id(user_id)
        assert user is not None
        self.token = create_access_token(
            {"sub": self._username, "token_version": int(user.get("token_version") or 0)}
        )

        app = FastAPI()
        app.middleware("http")(api_auth_middleware)
        install_exception_handlers(app)
        app.include_router(auth_router, prefix="/api/auth")
        self.client = TestClient(app)

    def tearDown(self):
        import core.auth as auth_mod

        if self._prev_env is None:
            os.environ.pop("COPANEL_DISABLE_AUTH", None)
        else:
            os.environ["COPANEL_DISABLE_AUTH"] = self._prev_env
        auth_mod._AUTH_DISABLED = self._prev_flag

    def test_query_access_token_rejected_on_me(self):
        res = self.client.get(f"/api/auth/me?access_token={self.token}")
        self.assertEqual(res.status_code, 401, res.text)

    def test_query_token_rejected_on_me(self):
        res = self.client.get(f"/api/auth/me?token={self.token}")
        self.assertEqual(res.status_code, 401, res.text)

    def test_bearer_header_still_works(self):
        res = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["user"]["username"], self._username)

    def test_query_token_still_accepted_on_sse_path(self):
        res = self.client.get(f"/api/platform/events?access_token={self.token}")
        # Path is not mounted here; middleware must not 401 a valid query token.
        self.assertNotEqual(res.status_code, 401, res.text)


class LoginContentTypeTests(unittest.TestCase):
    def setUp(self):
        _reset_login_attempts()
        app = FastAPI()
        install_exception_handlers(app)
        app.include_router(auth_router, prefix="/api/auth")
        self.client = TestClient(app)

    def tearDown(self):
        _reset_login_attempts()

    def test_form_urlencoded_login_is_422_not_500(self):
        res = self.client.post(
            "/api/auth/login",
            data={"username": "admin", "password": "nope"},
        )
        self.assertNotEqual(res.status_code, 500, res.text)
        self.assertIn(res.status_code, (400, 422))


class AdminPasswordFileTests(unittest.TestCase):
    def test_clear_admin_password_file_removes_plaintext(self):
        from core import user_model
        from core.paths import write_private_text

        path = user_model.pwd_path()
        write_private_text(path, "temporary-install-password")
        self.assertTrue(path.is_file())
        user_model.clear_admin_password_file()
        self.assertFalse(path.is_file())


class LoginLockoutPolicyTests(unittest.TestCase):
    def setUp(self):
        _reset_login_attempts()
        app = FastAPI()
        install_exception_handlers(app)
        app.include_router(auth_router, prefix="/api/auth")
        self.client = TestClient(app)

    def tearDown(self):
        _reset_login_attempts()

    def test_shared_ip_does_not_lock_other_usernames(self):
        for _ in range(_LOGIN_MAX_FAILURES):
            res = self.client.post(
                "/api/auth/login",
                json={"username": "nobody", "password": "wrong"},
            )
            self.assertEqual(res.status_code, 401, res.text)
        blocked = self.client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "wrong"},
        )
        self.assertEqual(blocked.status_code, 429, blocked.text)
        other = self.client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong"},
        )
        self.assertEqual(other.status_code, 401, other.text)

    def test_recorded_ip_failures_do_not_block_other_user(self):
        for _ in range(_LOGIN_MAX_FAILURES):
            _record_login_failure("testclient", "spray-user")
        other = self.client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong"},
        )
        self.assertEqual(other.status_code, 401, other.text)


if __name__ == "__main__":
    unittest.main()
