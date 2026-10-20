"""package_manager apt recovery when dpkg was interrupted."""
from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from modules.package_manager import logic


class DpkgRecoveryTests(unittest.TestCase):
    def test_retries_after_configure_when_dpkg_interrupted(self):
        calls: list[list[str]] = []

        def fake_run(cmd, check=True):
            calls.append(list(cmd))
            if cmd[:3] == ["apt-get", "install", "-y"]:
                if len([c for c in calls if c[:3] == ["apt-get", "install", "-y"]]) == 1:
                    return subprocess.CompletedProcess(cmd, 100, "", "dpkg was interrupted")
                return subprocess.CompletedProcess(cmd, 0, "ok", "")
            if cmd[:3] == ["dpkg", "--configure", "-a"]:
                return subprocess.CompletedProcess(cmd, 0, "", "")
            raise AssertionError(f"unexpected cmd {cmd}")

        with patch.object(logic, "_run_with_optional_sudo", side_effect=fake_run):
            logic._apt_install_with_dpkg_recovery("apt-get", ["nginx"])

        self.assertEqual(calls[0], ["apt-get", "install", "-y", "nginx"])
        self.assertEqual(calls[1], ["dpkg", "--configure", "-a"])
        self.assertEqual(calls[2], ["apt-get", "install", "-y", "nginx"])
