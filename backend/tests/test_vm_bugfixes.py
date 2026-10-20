"""Regression tests for VM audit bugfixes (security + validation)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.job_secrets import job_visible_to_user, redact_secrets, sanitize_job_for_api
from core.jobs import jobs
from modules.cron_manager.validate import validate_cron_command, validate_cron_schedule
from modules.file_manager.path_safety import path_is_within, resolve_allowed_path
from modules.firewall.validation import parse_ufw_status_lines, validate_port_spec
from modules.site_wizard.logic import _install_wordpress_core, _merge_wp_database
from modules.web_manager.logic import is_apache_installed


class JobSecretsTests(unittest.TestCase):
    def test_redact_password_fields(self):
        payload = {"database": {"password": "sekrit", "user": "wp"}}
        redacted = redact_secrets(payload)
        self.assertEqual(redacted["database"]["password"], "***")
        self.assertEqual(redacted["database"]["user"], "wp")

    def test_job_visibility_by_actor(self):
        admin = {"username": "admin", "role": "superadmin"}
        alice = {"username": "alice", "role": "user"}
        job = {"actor": "bob", "payload": {}}
        self.assertTrue(job_visible_to_user(job, admin))
        self.assertFalse(job_visible_to_user(job, alice))

    def test_sanitize_job_for_api(self):
        job = {"id": "1", "payload": {"database_password": "x"}, "result": {"password": "y"}}
        clean = sanitize_job_for_api(job)
        self.assertEqual(clean["payload"]["database_password"], "***")
        self.assertEqual(clean["result"]["password"], "***")


class FileManagerPathTests(unittest.TestCase):
    def test_prefix_trap_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            alice = os.path.join(tmp, "alice")
            alice2 = os.path.join(tmp, "alice2")
            os.makedirs(alice)
            os.makedirs(alice2)
            secret = os.path.join(alice2, "secret.txt")
            Path(secret).write_text("nope", encoding="utf-8")
            self.assertFalse(path_is_within(secret, alice))
            with self.assertRaises(PermissionError):
                resolve_allowed_path(secret, [alice])

    def test_symlink_containment(self):
        with tempfile.TemporaryDirectory() as tmp:
            allowed = os.path.join(tmp, "home", "alice")
            outside = os.path.join(tmp, "outside")
            os.makedirs(allowed)
            os.makedirs(outside)
            link = os.path.join(allowed, "link")
            target = os.path.join(outside, "file.txt")
            Path(target).write_text("data", encoding="utf-8")
            os.symlink(outside, link)
            with self.assertRaises(PermissionError):
                resolve_allowed_path(target, [allowed])


class CronValidationTests(unittest.TestCase):
    def test_rejects_newline_injection(self):
        with self.assertRaises(ValueError):
            validate_cron_command("echo hi\n* * * * * malicious")

    def test_valid_schedule(self):
        fields = validate_cron_schedule({"minute": "*/5", "hour": "1", "day": "*", "month": "*", "weekday": "0"})
        self.assertEqual(fields["minute"], "*/5")


class FirewallTests(unittest.TestCase):
    def test_invalid_port_returns_validation_error(self):
        with self.assertRaises(ValueError):
            validate_port_spec("99999")

    def test_parse_ufw_comment_column(self):
        lines = [
            "Status: active",
            "     To                         Action      From",
            "[ 1] 80/tcp                     ALLOW IN    Anywhere                   # Web Traffic",
        ]
        rules = parse_ufw_status_lines(lines)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["comment"], "Web Traffic")
        self.assertEqual(rules[0]["port"], "80/tcp")


class ApacheDetectTests(unittest.TestCase):
    def test_not_installed_without_package(self):
        with patch("modules.web_manager.logic.IS_WINDOWS", False), patch(
            "modules.web_manager.logic.shutil.which", return_value=None
        ), patch("modules.web_manager.logic.subprocess.run") as run:
            run.return_value.stdout = ""
            run.return_value.returncode = 1
            self.assertFalse(is_apache_installed())


class SiteWizardRerunTests(unittest.TestCase):
    def test_merge_password_from_wp_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wp-config.php").write_text(
                "<?php define('DB_NAME', 'db'); define('DB_USER', 'u'); "
                "define('DB_PASSWORD', 'from-file'); define('DB_HOST', 'localhost');",
                encoding="utf-8",
            )
            merged = _merge_wp_database(root, {"name": "db", "user": "u", "password": None, "host": "localhost"})
            self.assertEqual(merged["password"], "from-file")

    def test_wordpress_rerun_with_existing_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wp-includes").mkdir()
            (root / "wp-includes" / "version.php").write_text("<?php", encoding="utf-8")
            (root / "wp-config.php").write_text(
                "<?php define('DB_NAME', 'db'); define('DB_USER', 'u'); "
                "define('DB_PASSWORD', 'from-file'); define('DB_HOST', 'localhost');",
                encoding="utf-8",
            )
            database = {"name": "db", "user": "u", "password": None, "host": "localhost"}
            with patch("modules.site_wizard.logic._resolve_wp_db_host", return_value="localhost"), patch(
                "modules.site_wizard.logic._wordpress_db_installed", return_value=True
            ):
                result = _install_wordpress_core(str(root), "example.com", database)
            self.assertEqual(result["status"], "success")
            self.assertIn("already installed", result["message"].lower())


class JobListActorFilterTests(unittest.TestCase):
    def test_list_filters_by_actor(self):
        jobs.submit(
            kind="test.actor",
            title="alice job",
            module="test",
            actor="alice",
            payload={},
            handler=None,
        )
        jobs.submit(
            kind="test.actor",
            title="bob job",
            module="test",
            actor="bob",
            payload={},
            handler=None,
        )
        alice_rows = jobs.list(limit=50, actor="alice")
        self.assertTrue(all(row.get("actor") == "alice" for row in alice_rows))


if __name__ == "__main__":
    unittest.main()
