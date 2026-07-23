"""Tests for nginx gate persistence / auto-repair after install.sh overwrite."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


CLEAN_NGINX = """\
server {
    listen 8686;
    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://copanel_backend;
    }
    location /health {
        proxy_pass http://copanel_backend;
    }
}
"""

LEGACY_SERVER_LEVEL_GATE = """\
server {
    listen 8686;
    # BEGIN COPANEL NGINX GATE
    auth_basic "CoPanel";
    auth_basic_user_file /opt/copanel/config/panel_access.htpasswd;
    # END COPANEL NGINX GATE
    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://copanel_backend;
    }
}
"""


class NginxGateAutoRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config_dir = self.root / "config"
        self.config_dir.mkdir()
        self.store_path = self.config_dir / "panel_settings.json"
        self.htpasswd = self.config_dir / "panel_access.htpasswd"
        self.nginx_site = self.root / "copanel"
        self.nginx_site.write_text(CLEAN_NGINX, encoding="utf-8")

        # Import after paths are ready; patch module-level constants.
        from modules.panel_settings import logic as gate_logic

        self.logic = gate_logic
        self.patches = [
            patch.object(gate_logic, "IS_WINDOWS", False),
            patch.object(gate_logic, "CONFIG_DIR", self.config_dir),
            patch.object(gate_logic, "STORE_PATH", self.store_path),
            patch.object(gate_logic, "HTPASSWD_PATH", self.htpasswd),
            patch.object(gate_logic, "NGINX_SITE", self.nginx_site),
            patch.object(gate_logic, "_nginx_site_path", return_value=self.nginx_site),
            patch.object(gate_logic, "_run_privileged", side_effect=self._fake_privileged),
            patch.object(gate_logic, "_write_file_privileged", side_effect=self._fake_write),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def _fake_write(self, path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")

    def _fake_privileged(self, cmd, *, input_text=None, timeout=120):
        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    def _write_store(self, enabled: bool, username: str = "copanel") -> None:
        self.store_path.write_text(
            json.dumps({"nginx_gate": {"enabled": enabled, "username": username}}),
            encoding="utf-8",
        )

    def test_needs_repair_when_settings_enabled_but_markers_missing(self):
        self._write_store(True)
        self.htpasswd.write_text("copanel:hash\n", encoding="utf-8")
        self.assertTrue(self.logic.nginx_gate_needs_auto_repair())
        settings = self.logic.get_settings()
        self.assertTrue(settings["nginx_gate"]["needs_repair"])
        self.assertTrue(settings["nginx_gate"]["enabled"])

    def test_no_repair_when_gate_disabled(self):
        self._write_store(False)
        self.htpasswd.write_text("copanel:hash\n", encoding="utf-8")
        self.assertFalse(self.logic.nginx_gate_needs_auto_repair())

    def test_no_repair_when_already_present(self):
        self._write_store(True)
        self.htpasswd.write_text("copanel:hash\n", encoding="utf-8")
        content = self.logic._apply_nginx_gate(CLEAN_NGINX, str(self.htpasswd))
        self.nginx_site.write_text(content, encoding="utf-8")
        self.assertFalse(self.logic.nginx_gate_needs_auto_repair())
        self.assertFalse(self.logic.get_settings()["nginx_gate"]["needs_repair"])

    def test_needs_repair_for_legacy_server_level(self):
        self._write_store(True)
        self.htpasswd.write_text("copanel:hash\n", encoding="utf-8")
        self.nginx_site.write_text(LEGACY_SERVER_LEVEL_GATE, encoding="utf-8")
        self.assertTrue(self.logic.nginx_gate_needs_auto_repair())
        self.assertTrue(self.logic._nginx_gate_at_server_level())

    def test_auto_repair_restores_markers_after_overwrite(self):
        self._write_store(True)
        self.htpasswd.write_text("copanel:hash\n", encoding="utf-8")
        self.assertNotIn(self.logic.NGINX_AUTH_START, self.nginx_site.read_text(encoding="utf-8"))

        result = self.logic.maybe_auto_repair_nginx_gate()
        self.assertIsNotNone(result)
        self.assertTrue(result.get("enabled"))
        restored = self.nginx_site.read_text(encoding="utf-8")
        self.assertIn(self.logic.NGINX_AUTH_START, restored)
        # Gate must live inside location /, not at server level.
        self.assertFalse(self.logic._nginx_gate_at_server_level(restored))
        self.assertFalse(self.logic.nginx_gate_needs_auto_repair())


if __name__ == "__main__":
    unittest.main()
