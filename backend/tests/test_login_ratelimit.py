"""Login failures are limited per IP and per username."""
from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.auth.router import (
    _LOGIN_MAX_FAILURES,
    _record_login_failure,
    _reset_login_attempts,
    router,
)


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self):
        _reset_login_attempts()
        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        self.client = TestClient(app)

    def tearDown(self):
        _reset_login_attempts()

    def test_repeated_failures_return_429(self):
        last = None
        for _ in range(_LOGIN_MAX_FAILURES):
            last = self.client.post(
                "/api/auth/login",
                json={"username": "nobody", "password": "wrong"},
            )
            self.assertEqual(last.status_code, 401, last.text)
        blocked = self.client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "wrong"},
        )
        self.assertEqual(blocked.status_code, 429, blocked.text)

    def test_username_limit_is_independent_of_ip(self):
        for index in range(_LOGIN_MAX_FAILURES):
            _record_login_failure(f"203.0.113.{index}", "bob")
        blocked = self.client.post(
            "/api/auth/login",
            json={"username": "bob", "password": "wrong"},
        )
        self.assertEqual(blocked.status_code, 429, blocked.text)
        other = self.client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong"},
        )
        self.assertEqual(other.status_code, 401, other.text)


if __name__ == "__main__":
    unittest.main()
