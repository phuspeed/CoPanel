"""Nginx SSE location must not inherit panel Basic Auth."""
from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[2]

INSTALLER_EVENTS_SNIPPET = """\
    location /api/platform/events {
        auth_basic off;
        proxy_pass http://copanel_backend;
"""

# Live vhost shaped like a 1.1.15–1.1.18 site that copied the events
# location from config/nginx.conf but left server-level Basic Auth on.
LEGACY_SERVER_GATE_WITH_EVENTS = """\
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
    location /api/platform/events {
        proxy_pass http://copanel_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
    location /api/ {
        proxy_pass http://copanel_backend;
    }
    location /health {
        proxy_pass http://copanel_backend;
    }
}
"""

# Tight layout that used to skip /api/ exemption: 900-char window from
# location /api/ could already contain the events tag.
CLOSE_LOCATIONS = """\
server {
    listen 8686;
    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://copanel_backend;
    }
    location /api/platform/events {
        proxy_pass http://copanel_backend;
        proxy_buffering off;
    }
}
"""

NO_EVENTS_LOCATION = """\
server {
    listen 8686;
    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://copanel_backend;
    }
}
"""


def _events_block(content: str) -> str:
    match = re.search(r"(?m)^[ \t]*location\s+(?:\^~\s+)?/api/platform/events\s*\{", content)
    if not match:
        return ""
    start = match.start()
    depth = 0
    for i, ch in enumerate(content[content.find("{", start) :], start=content.find("{", start)):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return content[start : i + 1]
    return ""


class EventsSseNginxTests(unittest.TestCase):
    def test_reference_nginx_conf_has_events_auth_basic_off(self):
        conf = (REPO / "config" / "nginx.conf").read_text(encoding="utf-8")
        block = _events_block(conf)
        self.assertTrue(block, "config/nginx.conf must define location /api/platform/events")
        self.assertRegex(block, r"(?m)^\s*auth_basic\s+off\s*;")
        self.assertIn("proxy_buffering off", block)
        self.assertIn("86400s", block)

        api = re.search(r"(?m)^[ \t]*location /api/ \{.*?\n    \}", conf, re.DOTALL)
        self.assertIsNotNone(api)
        self.assertIn("auth_basic off", api.group(0))

    def test_install_sh_template_has_events_auth_basic_off(self):
        script = (REPO / "scripts" / "install.sh").read_text(encoding="utf-8")
        self.assertIn(INSTALLER_EVENTS_SNIPPET, script)
        # The events location must appear inside the installer heredoc that
        # writes the live site, not only in a comment.
        heredoc = script.split("cat > \"$NGINX_CONF\" << 'EOF'", 1)[1].split("\nEOF", 1)[0]
        block = _events_block(heredoc)
        self.assertTrue(block)
        self.assertRegex(block, r"(?m)^\s*auth_basic\s+off\s*;")
        self.assertIn("proxy_buffering off", block)
        self.assertIn("86400s", block)
        api = _location(heredoc, "location /api/ {")
        self.assertIn("auth_basic off", api)

    def test_ensure_injects_auth_basic_off_into_existing_events_location(self):
        from modules.panel_settings.logic import ensure_events_sse_location

        updated = ensure_events_sse_location(LEGACY_SERVER_GATE_WITH_EVENTS)
        block = _events_block(updated)
        self.assertRegex(block, r"(?m)^\s*auth_basic\s+off\s*;")
        # Do not invent a second events location or drop SSE settings.
        self.assertEqual(updated.count("location /api/platform/events"), 1)
        self.assertIn("proxy_read_timeout 86400s", block)

    def test_ensure_inserts_events_location_when_missing(self):
        from modules.panel_settings.logic import ensure_events_sse_location

        updated = ensure_events_sse_location(NO_EVENTS_LOCATION)
        block = _events_block(updated)
        self.assertTrue(block)
        self.assertRegex(block, r"(?m)^\s*auth_basic\s+off\s*;")
        self.assertIn("proxy_buffering off", block)
        # Inserted immediately before location /api/.
        events_at = updated.find("location /api/platform/events")
        api_at = updated.find("location /api/ {")
        self.assertGreater(api_at, events_at)
        # Idempotent.
        self.assertEqual(ensure_events_sse_location(updated), updated)

    def test_inject_exemptions_does_not_skip_neighbor_locations(self):
        from modules.panel_settings.logic import _inject_auth_exemptions

        updated = _inject_auth_exemptions(CLOSE_LOCATIONS)
        self.assertRegex(_events_block(updated), r"(?m)^\s*auth_basic\s+off\s*;")
        self.assertIn("auth_basic off", _location(updated, "location /api/ {"))

    def test_apply_nginx_gate_exempts_events_and_moves_auth_to_slash(self):
        from modules.panel_settings.logic import (
            NGINX_AUTH_START,
            _apply_nginx_gate,
            _nginx_gate_at_server_level,
        )

        updated = _apply_nginx_gate(
            LEGACY_SERVER_GATE_WITH_EVENTS,
            "/opt/copanel/config/panel_access.htpasswd",
        )
        self.assertFalse(_nginx_gate_at_server_level(updated))
        # Auth only on the SPA shell.
        slash = _location(updated, "location / {")
        self.assertIn(NGINX_AUTH_START, slash)
        self.assertIn('auth_basic "CoPanel";', slash)
        self.assertRegex(_events_block(updated), r"(?m)^\s*auth_basic\s+off\s*;")
        self.assertIn("auth_basic off", _location(updated, "location /api/ {"))
        # Server body must not still require Basic Auth before the first location.
        head = updated.split("location ", 1)[0]
        self.assertNotIn('auth_basic "CoPanel";', head)

    def test_apply_gate_on_reference_nginx_conf(self):
        from modules.panel_settings.logic import _apply_nginx_gate, _nginx_gate_at_server_level

        conf = (REPO / "config" / "nginx.conf").read_text(encoding="utf-8")
        updated = _apply_nginx_gate(conf, "/opt/copanel/config/panel_access.htpasswd")
        self.assertFalse(_nginx_gate_at_server_level(updated))
        block = _events_block(updated)
        # Only one auth_basic off (template already has it; do not duplicate wildly).
        self.assertGreaterEqual(len(re.findall(r"auth_basic\s+off", block)), 1)
        self.assertLessEqual(len(re.findall(r"auth_basic\s+off", block)), 2)

    def test_startup_repair_rewrites_site_and_reloads(self):
        from modules.panel_settings import logic as gate_logic

        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "copanel"
            site.write_text(LEGACY_SERVER_GATE_WITH_EVENTS, encoding="utf-8")
            calls = []

            def fake_write(path, content):
                path.write_text(content, encoding="utf-8")

            def fake_priv(cmd, *, input_text=None, timeout=120):
                calls.append(cmd)

                class Result:
                    returncode = 0
                    stdout = ""
                    stderr = ""

                return Result()

            with patch.object(gate_logic, "IS_WINDOWS", False), patch.object(
                gate_logic, "NGINX_SITE", site
            ), patch.object(
                gate_logic, "_nginx_site_path", return_value=site
            ), patch.object(
                gate_logic, "_write_file_privileged", side_effect=fake_write
            ), patch.object(
                gate_logic, "_run_privileged", side_effect=fake_priv
            ):
                result = gate_logic.maybe_repair_events_sse_location()

            self.assertEqual(result, {"repaired": True, "reload_ok": True})
            self.assertRegex(_events_block(site.read_text(encoding="utf-8")), r"(?m)^\s*auth_basic\s+off\s*;")
            self.assertIn(["nginx", "-t"], calls)
            self.assertIn(["systemctl", "reload", "nginx"], calls)
            # Second pass is a no-op.
            with patch.object(gate_logic, "IS_WINDOWS", False), patch.object(
                gate_logic, "_nginx_site_path", return_value=site
            ):
                self.assertIsNone(gate_logic.maybe_repair_events_sse_location())


def _location(content: str, marker: str) -> str:
    idx = content.find(marker)
    if idx == -1:
        return ""
    brace = content.find("{", idx)
    depth = 0
    for i, ch in enumerate(content[brace:], start=brace):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return content[idx : i + 1]
    return ""


if __name__ == "__main__":
    unittest.main()
