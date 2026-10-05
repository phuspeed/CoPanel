"""phpMyAdmin credential save must not invoke a shell."""
from __future__ import annotations

import os
import stat
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.web_manager.router import router


class PhpMyAdminInjectionTests(unittest.TestCase):
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

    def test_metacharacters_are_passed_on_stdin_without_shell(self):
        password = '$(touch /tmp/x)"'
        with patch("modules.web_manager.router.subprocess.run") as mocked:
            res = self.client.post(
                "/api/web_manager/phpmyadmin/save",
                json={"user": "pma_user", "password": password},
            )
        self.assertEqual(res.status_code, 200, res.text)
        mocked.assert_called()
        args, kwargs = mocked.call_args
        self.assertIsInstance(args[0], list)
        self.assertNotEqual(kwargs.get("shell"), True)
        self.assertFalse(kwargs.get("shell", False))
        joined = " ".join(str(part) for part in args[0])
        self.assertNotIn(password, joined)
        self.assertNotIn("$(touch", joined)
        sql = kwargs.get("input") or ""
        self.assertIn("$(touch /tmp/x)", sql)
        self.assertNotIn("$(touch /tmp/x)\"", sql)
        creds = os.path.join(os.environ["COPANEL_TEST_CONFIG_DIR"], "mysql_credentials.txt")
        mode = stat.S_IMODE(os.stat(creds).st_mode)
        self.assertEqual(mode, 0o600)

    def test_get_does_not_return_password(self):
        with patch("modules.web_manager.router.subprocess.run"):
            save = self.client.post(
                "/api/web_manager/phpmyadmin/save",
                json={"user": "pma_user", "password": "s3cret-value"},
            )
        self.assertEqual(save.status_code, 200, save.text)
        res = self.client.get("/api/web_manager/phpmyadmin")
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertNotIn("password", body)
        self.assertEqual(body["user"], "pma_user")
        self.assertIs(body["has_password"], True)

    def test_invalid_username_does_not_call_mysql(self):
        with patch("modules.web_manager.router.subprocess.run") as mocked:
            res = self.client.post(
                "/api/web_manager/phpmyadmin/save",
                json={"user": "bad user", "password": "x"},
            )
        self.assertEqual(res.status_code, 400, res.text)
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
