"""Nginx vhost creation rejects injected server_name and document roots."""
from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.web_manager.router import router


class CreateSiteValidationTests(unittest.TestCase):
    def setUp(self):
        import core.auth as auth_mod

        self._prev = auth_mod._AUTH_DISABLED
        auth_mod._AUTH_DISABLED = True
        app = FastAPI()
        app.include_router(router, prefix="/api/web_manager")
        self.client = TestClient(app)

    def tearDown(self):
        import core.auth as auth_mod

        auth_mod._AUTH_DISABLED = self._prev

    def test_injected_doc_root_is_400(self):
        res = self.client.post(
            "/api/web_manager/create",
            json={
                "domain": "example.com",
                "root": "/var/www/x; include /etc/passwd;",
            },
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_traversal_domain_is_400(self):
        res = self.client.post(
            "/api/web_manager/create",
            json={
                "domain": "../../etc/cron.d/x",
                "root": "/var/www/example",
            },
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_doc_root_outside_allowed_roots_is_400(self):
        res = self.client.post(
            "/api/web_manager/create",
            json={
                "domain": "example.com",
                "root": "/etc/nginx/evil",
            },
        )
        self.assertEqual(res.status_code, 400, res.text)


if __name__ == "__main__":
    unittest.main()
