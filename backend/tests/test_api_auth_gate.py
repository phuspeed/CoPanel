"""Regression tests: unauthenticated callers must not reach panel APIs.

DevTools / F12 can only edit the SPA. These tests prove the backend still
rejects requests without a valid JWT (the real security boundary).
"""
from __future__ import annotations

import os
import unittest

# Force auth ON for this module even though conftest defaults DISABLE_AUTH=1.
os.environ["COPANEL_DISABLE_AUTH"] = "0"

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


class ApiAuthGateTests(unittest.TestCase):
    def setUp(self):
        # Reload flag from env for the already-imported module.
        import core.auth as auth_mod

        auth_mod._AUTH_DISABLED = False
        self.client = TestClient(_app_with_gate())

    def tearDown(self):
        import core.auth as auth_mod

        auth_mod._AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"

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


class TerminalWsAuthTests(unittest.TestCase):
    def test_websocket_rejects_without_token(self):
        import core.auth as auth_mod
        from modules.terminal.router import router as terminal_router

        auth_mod._AUTH_DISABLED = False
        app = FastAPI()
        app.include_router(terminal_router, prefix="/api/terminal")
        client = TestClient(app)
        with self.assertRaises(Exception):
            with client.websocket_connect("/api/terminal/ws"):
                pass
        auth_mod._AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"

    def test_websocket_accepts_access_token_query(self):
        import core.auth as auth_mod
        from unittest.mock import patch
        from modules.terminal.router import router as terminal_router

        auth_mod._AUTH_DISABLED = False
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
        auth_mod._AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"


class PlatformExtensionsTests(unittest.TestCase):
    def test_extensions_requires_auth(self):
        import core.auth as auth_mod
        from modules.platform.router import router as platform_router

        auth_mod._AUTH_DISABLED = False
        app = FastAPI()
        app.middleware("http")(api_auth_middleware)
        app.include_router(platform_router, prefix="/api/platform")
        client = TestClient(app)
        res = client.get("/api/platform/extensions")
        self.assertEqual(res.status_code, 401)
        auth_mod._AUTH_DISABLED = os.environ.get("COPANEL_DISABLE_AUTH") == "1"


if __name__ == "__main__":
    unittest.main()
