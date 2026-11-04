"""Short-lived stream tickets replace JWTs in SSE / WebSocket query strings."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import stream_tickets
from core.api import install_exception_handlers
from core.auth import api_auth_middleware
from core.security import create_access_token
from modules.auth.router import router as auth_router
from modules.platform.router import router as platform_router


class StreamTicketTests(unittest.TestCase):
    def setUp(self):
        import core.auth as auth_mod
        from core import user_model

        self._prev_env = os.environ.get("COPANEL_DISABLE_AUTH")
        self._prev_flag = auth_mod._AUTH_DISABLED
        os.environ["COPANEL_DISABLE_AUTH"] = "0"
        auth_mod._AUTH_DISABLED = False
        stream_tickets.clear_tickets()

        self.username = "stream-ticket-user"
        existing = user_model.get_user_by_username(self.username)
        if existing:
            user_model.delete_user(int(existing["id"]))
        self.user_id = user_model.create_user(self.username, "unused-password-9", "user", "[]", "[]")
        user = user_model.get_user_by_id(self.user_id)
        self.jwt = create_access_token(
            {"sub": self.username, "token_version": int(user.get("token_version") or 0)}
        )

        app = FastAPI()
        app.middleware("http")(api_auth_middleware)
        install_exception_handlers(app)
        app.include_router(auth_router, prefix="/api/auth")
        app.include_router(platform_router, prefix="/api/platform")
        self.client = TestClient(app)

    def tearDown(self):
        import core.auth as auth_mod

        if self._prev_env is None:
            os.environ.pop("COPANEL_DISABLE_AUTH", None)
        else:
            os.environ["COPANEL_DISABLE_AUTH"] = self._prev_env
        auth_mod._AUTH_DISABLED = self._prev_flag
        stream_tickets.clear_tickets()

    def _ticket(self) -> str:
        res = self.client.post(
            "/api/auth/stream-ticket", headers={"Authorization": f"Bearer {self.jwt}"}
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertLessEqual(body["expires_in"], 60)
        self.assertNotIn(".", body["ticket"])  # opaque, not a JWT
        return body["ticket"]

    def test_issue_requires_auth(self):
        self.assertEqual(self.client.post("/api/auth/stream-ticket").status_code, 401)

    def test_ticket_is_random(self):
        self.assertNotEqual(self._ticket(), self._ticket())

    def test_consume_ticket_single_use(self):
        ticket = self._ticket()
        user = stream_tickets.consume_ticket(ticket)
        self.assertIsNotNone(user)
        self.assertEqual(user["username"], self.username)
        self.assertIsNone(stream_tickets.consume_ticket(ticket))

    def test_invalid_ticket_rejected(self):
        self.assertIsNone(stream_tickets.consume_ticket("nope"))
        self.assertIsNone(stream_tickets.consume_ticket(None))
        self.assertIsNone(stream_tickets.consume_ticket(""))
        res = self.client.get("/api/platform/events?ticket=bogus")
        self.assertEqual(res.status_code, 401)

    def test_expired_ticket_rejected(self):
        ticket = self._ticket()
        real = stream_tickets.time.monotonic
        with patch.object(stream_tickets.time, "monotonic", lambda: real() + 61):
            self.assertIsNone(stream_tickets.consume_ticket(ticket))

    def test_token_version_bump_invalidates_ticket(self):
        from core import user_model

        ticket = self._ticket()
        user_model.bump_token_version(int(self.user_id))
        self.assertIsNone(stream_tickets.consume_ticket(ticket))

    def test_jwt_in_query_rejected_on_events(self):
        res = self.client.get(f"/api/platform/events?access_token={self.jwt}")
        self.assertEqual(res.status_code, 401)
        res = self.client.get(f"/api/platform/events?ticket={self.jwt}")
        self.assertEqual(res.status_code, 401)

    def test_ticket_not_accepted_on_regular_api(self):
        ticket = self._ticket()
        res = self.client.get(f"/api/auth/me?ticket={ticket}")
        self.assertEqual(res.status_code, 401)

    def test_ticket_accepted_on_events(self):
        ticket = self._ticket()

        async def _empty_stream(_topics):
            yield ": ok\n\n"

        with patch("modules.platform.router.sse_stream", _empty_stream):
            res = self.client.get(f"/api/platform/events?topics=jobs&ticket={ticket}")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn("text/event-stream", res.headers.get("content-type", ""))
        # Single use: replay of the same URL is refused.
        res = self.client.get(f"/api/platform/events?topics=jobs&ticket={ticket}")
        self.assertEqual(res.status_code, 401)

    def test_ticket_accepted_on_events_without_middleware(self):
        app = FastAPI()
        install_exception_handlers(app)
        app.include_router(platform_router, prefix="/api/platform")
        client = TestClient(app)
        ticket = self._ticket()

        async def _empty_stream(_topics):
            yield ": ok\n\n"

        with patch("modules.platform.router.sse_stream", _empty_stream):
            res = client.get(f"/api/platform/events?ticket={ticket}")
        self.assertEqual(res.status_code, 200, res.text)


class NginxLogRedactionTests(unittest.TestCase):
    def test_install_sh_uses_redacted_log_format(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        for rel in ("scripts/install.sh", "config/nginx.conf"):
            text = (root / rel).read_text(encoding="utf-8")
            self.assertIn("log_format copanel_redacted", text, rel)
            self.assertIn("access_log /var/log/nginx/access.log copanel_redacted;", text, rel)
            for param in ("access_token=", "ticket=", "[?&]token="):
                self.assertIn(param, text, rel)


if __name__ == "__main__":
    unittest.main()
