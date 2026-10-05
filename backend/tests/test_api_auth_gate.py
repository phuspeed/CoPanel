"""Regression tests: unauthenticated callers must not reach panel APIs.

DevTools / F12 can only edit the SPA. These tests prove the backend still
rejects requests without a valid JWT (the real security boundary).
"""
from __future__ import annotations

import os
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.auth import api_auth_middleware, _PUBLIC_PATHS


def _app_with_gate() -> FastAPI:
    app = FastAPI()
    app.middleware("http")(api_auth_middleware)

    @app.get("/api/secret")
    def secret():
        return {"ok": True}

    @app.get("/api/auth/login")
    def login_get():
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/panel_settings/branding/public")
    def branding():
        return {"ok": True}

    return app


class _AuthFlagMixin:
    """Turn the global auth gate on for one test and restore it afterwards.

    ``test_api_auth_gate`` used to set ``COPANEL_DISABLE_AUTH=0`` at import
    time and never put it back, which made later docker tests return 401.
    """

    def enable_auth(self) -> None:
        import core.auth as auth_mod

        self._prev_auth_env = os.environ.get("COPANEL_DISABLE_AUTH")
        self._prev_auth_flag = auth_mod._AUTH_DISABLED
        os.environ["COPANEL_DISABLE_AUTH"] = "0"
        auth_mod._AUTH_DISABLED = False

    def restore_auth(self) -> None:
        import core.auth as auth_mod

        if getattr(self, "_prev_auth_env", None) is None:
            os.environ.pop("COPANEL_DISABLE_AUTH", None)
        else:
            os.environ["COPANEL_DISABLE_AUTH"] = self._prev_auth_env
        auth_mod._AUTH_DISABLED = self._prev_auth_flag


class ApiAuthGateTests(_AuthFlagMixin, unittest.TestCase):
    def setUp(self):
        self.enable_auth()
        self.client = TestClient(_app_with_gate())

    def tearDown(self):
        self.restore_auth()

    def test_api_without_token_is_401(self):
        res = self.client.get("/api/secret")
        self.assertEqual(res.status_code, 401)
        body = res.json()
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["error"]["code"], "UNAUTHORIZED")

    def test_api_with_bogus_bearer_is_401(self):
        res = self.client.get(
            "/api/secret",
            headers={"Authorization": "Bearer not-a-real-jwt"},
        )
        self.assertEqual(res.status_code, 401)

    def test_public_login_path_allowed(self):
        self.assertIn("/api/auth/login", _PUBLIC_PATHS)
        res = self.client.get("/api/auth/login")
        self.assertEqual(res.status_code, 200)

    def test_public_branding_allowed(self):
        res = self.client.get("/api/panel_settings/branding/public")
        self.assertEqual(res.status_code, 200)

    def test_non_api_health_allowed(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)

    def test_options_preflight_allowed(self):
        res = self.client.options("/api/secret")
        # Starlette TestClient may return 405 for OPTIONS without route; middleware must not 401.
        self.assertNotEqual(res.status_code, 401)


class TerminalWsAuthTests(_AuthFlagMixin, unittest.TestCase):
    def test_websocket_rejects_without_token(self):
        from modules.terminal.router import router as terminal_router

        self.enable_auth()
        try:
            app = FastAPI()
            app.include_router(terminal_router, prefix="/api/terminal")
            client = TestClient(app)
            with self.assertRaises(Exception):
                with client.websocket_connect("/api/terminal/ws"):
                    pass
        finally:
            self.restore_auth()

    def test_websocket_accepts_access_token_query(self):
        from unittest.mock import patch
        from modules.terminal.router import router as terminal_router

        self.enable_auth()
        try:
            app = FastAPI()
            app.include_router(terminal_router, prefix="/api/terminal")
            client = TestClient(app)
            fake_user = {
                "id": 1,
                "username": "admin",
                "role": "superadmin",
                "permitted_modules": '["all"]',
            }
            with patch("modules.terminal.router.user_from_access_token", return_value=fake_user):
                with patch("modules.terminal.router.IS_WINDOWS", True):
                    with client.websocket_connect("/api/terminal/ws?access_token=test-jwt") as ws:
                        msg = ws.receive_text()
                        self.assertIn("mock", msg.lower())
        finally:
            self.restore_auth()


class PlatformExtensionsTests(_AuthFlagMixin, unittest.TestCase):
    def test_extensions_requires_auth(self):
        from modules.platform.router import router as platform_router

        self.enable_auth()
        try:
            app = FastAPI()
            app.middleware("http")(api_auth_middleware)
            app.include_router(platform_router, prefix="/api/platform")
            client = TestClient(app)
            res = client.get("/api/platform/extensions")
            self.assertEqual(res.status_code, 401)
        finally:
            self.restore_auth()


if __name__ == "__main__":
    unittest.main()
