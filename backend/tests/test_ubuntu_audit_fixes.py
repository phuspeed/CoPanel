"""Regression tests for Ubuntu 24.04 audit findings (jobs, paths, cron, firewall)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.job_secrets import redact_job_row, user_may_access_job
from modules.cron_manager.schedule_validate import validate_cron_command, validate_cron_schedule
from modules.firewall.router import parse_ufw_rule_line, validate_ufw_comment, validate_ufw_port
from modules.file_manager.router import check_safe_path


class JobAccessTests(unittest.TestCase):
    def test_redact_passwords_in_payload(self):
        row = {
            "id": "1",
            "payload": {"database_password": "secret123", "domain": "x.com"},
            "result": {"admin_password": "pw"},
        }
        out = redact_job_row(row)
        self.assertEqual(out["payload"]["database_password"], "***")
        self.assertEqual(out["payload"]["domain"], "x.com")
        self.assertEqual(out["result"]["admin_password"], "***")

    def test_non_admin_only_sees_own_jobs(self):
        admin = {"username": "admin", "role": "superadmin"}
        alice = {"username": "alice", "role": "user"}
        job_alice = {"actor": "alice", "id": "a"}
        job_bob = {"actor": "bob", "id": "b"}
        self.assertTrue(user_may_access_job(admin, job_alice))
        self.assertTrue(user_may_access_job(alice, job_alice))
        self.assertFalse(user_may_access_job(alice, job_bob))


class FileManagerPathTests(unittest.TestCase):
    def test_prefix_trap_blocked(self):
        with tempfile.TemporaryDirectory() as base:
            alice = os.path.join(base, "alice")
            alice2 = os.path.join(base, "alice2")
            os.makedirs(alice)
            os.makedirs(alice2)
            secret = os.path.join(alice2, "secret.txt")
            Path(secret).write_text("nope", encoding="utf-8")
            user = {"role": "user", "permitted_folders": [alice]}
            with self.assertRaises(Exception):
                check_safe_path(secret, user)


class CronValidationTests(unittest.TestCase):
    def test_rejects_invalid_minute(self):
        with self.assertRaises(ValueError):
            validate_cron_schedule({"minute": "99", "hour": "*", "day": "*", "month": "*", "weekday": "*"})

    def test_accepts_step_and_range(self):
        validate_cron_schedule({"minute": "*/5", "hour": "1-3", "day": "*", "month": "*", "weekday": "0,6"})

    def test_rejects_newline_in_command(self):
        with self.assertRaises(ValueError):
            validate_cron_command("echo hi\nrm -rf /")


class FirewallValidationTests(unittest.TestCase):
    def test_invalid_port_400(self):
        with self.assertRaises(ValueError):
            validate_ufw_port("not-a-port")

    def test_valid_port_specs(self):
        self.assertEqual(validate_ufw_port("443/tcp"), "443/tcp")
        self.assertEqual(validate_ufw_port("80"), "80")

    def test_ufw_parsing_drops_anywhere_comment(self):
        parsed = parse_ufw_rule_line("8686/tcp                     ALLOW       Anywhere")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["port"], "8686/tcp")
        self.assertEqual(parsed["from"], "Anywhere")
        self.assertEqual(parsed["comment"], "")

    def test_ufw_parsing_ipv4_from_and_hash_comment(self):
        line = "80/tcp                     ALLOW IN    Anywhere                   # rtest2"
        parsed = parse_ufw_rule_line(line)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["port"], "80/tcp")
        self.assertEqual(parsed["action"], "ALLOW")
        self.assertEqual(parsed["from"], "Anywhere")
        self.assertEqual(parsed["comment"], "rtest2")

    def test_ufw_parsing_ipv6_rule_line(self):
        line = "8686/tcp (v6)              ALLOW IN    Anywhere (v6)              # Panel UI"
        parsed = parse_ufw_rule_line(line)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["port"], "8686/tcp (v6)")
        self.assertEqual(parsed["from"], "Anywhere (v6)")
        self.assertEqual(parsed["comment"], "Panel UI")

    def test_ufw_comment_validation(self):
        self.assertEqual(validate_ufw_comment("  Web Traffic  "), "Web Traffic")
        self.assertIsNone(validate_ufw_comment(""))
        with self.assertRaises(ValueError):
            validate_ufw_comment("a" * 81)
        with self.assertRaises(ValueError):
            validate_ufw_comment("bad\nline")


if __name__ == "__main__":
    unittest.main()
