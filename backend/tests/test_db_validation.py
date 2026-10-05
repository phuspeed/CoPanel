"""Database identifiers are allow-listed before any mysql/psql call."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from modules.database_manager.logic import DBManager


class DBValidationTests(unittest.TestCase):
    def test_create_user_rejects_injection_without_subprocess(self):
        with patch("modules.database_manager.logic.subprocess.run") as mocked:
            res = DBManager.create_user("a'@'%' --", "localhost", "secret", "appdb")
        self.assertEqual(res["status"], "error")
        mocked.assert_not_called()

    def test_delete_user_and_password_reject_bad_names(self):
        with patch("modules.database_manager.logic.subprocess.run") as mocked:
            deleted = DBManager.delete_user("root'; DROP USER x; --", "localhost")
            changed = DBManager.set_user_password("ok", "localhost'; --", "pw")
            created = DBManager.create_database("app; DROP DATABASE x")
        self.assertEqual(deleted["status"], "error")
        self.assertEqual(changed["status"], "error")
        self.assertEqual(created["status"], "error")
        mocked.assert_not_called()

    def test_valid_user_sql_goes_to_stdin(self):
        with patch("modules.database_manager.logic.shutil.which", return_value="/usr/bin/mysql"):
            with patch("core.sysexec.is_root", return_value=True):
                with patch("modules.database_manager.logic.subprocess.run") as mocked:
                    mocked.return_value.returncode = 0
                    mocked.return_value.stderr = ""
                    mocked.return_value.stdout = ""
                    res = DBManager.create_user("app_user", "localhost", "p'a$(id)", "app_db")
        self.assertEqual(res["status"], "success", res)
        args, kwargs = mocked.call_args
        self.assertIsInstance(args[0], list)
        self.assertNotEqual(kwargs.get("shell"), True)
        self.assertNotIn("-e", args[0])
        self.assertNotIn("p'a$(id)", " ".join(args[0]))
        sql = kwargs.get("input") or ""
        self.assertIn("$(id)", sql)
        self.assertIn("\\'", sql)
        self.assertIn("app_user", sql)


if __name__ == "__main__":
    unittest.main()
