"""Security entrance: token persistence, nginx snippet, and denied access."""
from __future__ import annotations

import json
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.paths import config_dir
from core.security_entrance import (
    COOKIE_NAME,
    CERT_DAYS,
    HTTP_END,
    HTTP_START,
    SERVER_END,
    SERVER_START,
    EntranceState,
    apply_nginx_text,
    build_entrance_url,
    ensure_certificate,
    ensure_state,
    entrance_file,
    entrance_nginx_current,
    generate_token,
    load_state,
    maybe_auto_repair,
    request_allowed,
    resolve_config_dir,
    rotate_state,
    save_state,
    security_entrance_middleware,
    set_enabled,
    ssl_paths,
)


NGINX_TEMPLATE = """\
upstream copanel_backend {
    server 127.0.0.1:8000;
}

upstream php_fpm {
    server unix:/run/php/php8.3-fpm.sock;
}

server {
    listen 8686 ssl;
    listen [::]:8686 ssl;
    server_name _;
    ssl_certificate     __CRT__;
    ssl_certificate_key __KEY__;
    ssl_protocols       TLSv1.2 TLSv1.3;
    error_page 497 =301 https://$host:$server_port$request_uri;
    client_max_body_size 100M;

    location / {
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    location /phpmyadmin {
        root /usr/share/;
        index index.php;
    }

    location /api/platform/events {
        proxy_pass http://copanel_backend;
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }

    location /api/ {
        proxy_pass http://copanel_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /health {
        proxy_pass http://copanel_backend;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
"""


class TokenPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Path(self.tmp.name) / "config"
        self.config.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_generate_token_is_32_hex(self):
        token = generate_token()
        self.assertEqual(len(token), 32)
        self.assertNotEqual(token, generate_token())
        int(token, 16)

    def test_ensure_is_idempotent_and_private(self):
        first = ensure_state(self.config)
        second = ensure_state(self.config)
        self.assertEqual(first, second)
        self.assertTrue(first.enabled)
        path = entrance_file(self.config)
        mode = stat.S_IMODE(path.stat().st_mode)
        self.assertEqual(mode, 0o600)
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["token"], first.token)
        self.assertTrue(saved["enabled"])

    def test_ensure_keeps_disabled_flag(self):
        created = ensure_state(self.config)
        disabled = set_enabled(self.config, False)
        self.assertEqual(disabled.token, created.token)
        self.assertFalse(disabled.enabled)
        again = ensure_state(self.config)
        self.assertEqual(again, disabled)

    def test_rotate_changes_token_and_keeps_enabled_flag(self):
        created = ensure_state(self.config)
        set_enabled(self.config, False)
        rotated = rotate_state(self.config)
        self.assertNotEqual(rotated.token, created.token)
        self.assertFalse(rotated.enabled)
        self.assertEqual(load_state(self.config), rotated)

    def test_missing_file_allows_requests(self):
        state = load_state(self.config)
        self.assertTrue(
            request_allowed(
                state,
                path="/api/auth/login",
                cookie_header=None,
                client_host="203.0.113.8",
                x_real_ip="203.0.113.8",
            )
        )

    def test_config_dir_matches_paths_helper(self):
        self.assertEqual(resolve_config_dir(), config_dir())


class AccessDecisionTests(unittest.TestCase):
    def setUp(self):
        self.state = EntranceState("ab" * 16, True)

    def test_external_without_cookie_is_denied(self):
        self.assertFalse(
            request_allowed(
                self.state,
                path="/api/auth/login",
                cookie_header=None,
                client_host="203.0.113.9",
                x_real_ip=None,
            )
        )

    def test_proxied_external_without_cookie_is_denied(self):
        # nginx connects from loopback but sets X-Real-IP to the browser.
        self.assertFalse(
            request_allowed(
                self.state,
                path="/",
                cookie_header=None,
                client_host="127.0.0.1",
                x_real_ip="198.51.100.20",
            )
        )

    def test_cookie_allows_proxied_client(self):
        self.assertTrue(
            request_allowed(
                self.state,
                path="/api/auth/login",
                cookie_header=f"other=1; {COOKIE_NAME}={self.state.token}",
                client_host="127.0.0.1",
                x_real_ip="198.51.100.20",
            )
        )

    def test_wrong_cookie_is_denied(self):
        self.assertFalse(
            request_allowed(
                self.state,
                path="/api/auth/login",
                cookie_header=f"{COOKIE_NAME}={'cd' * 16}",
                client_host="198.51.100.20",
                x_real_ip="198.51.100.20",
            )
        )

    def test_direct_localhost_api_stays_open(self):
        self.assertTrue(
            request_allowed(
                self.state,
                path="/api/auth/login",
                cookie_header=None,
                client_host="127.0.0.1",
                x_real_ip=None,
            )
        )

    def test_loopback_health_is_allowed(self):
        self.assertTrue(
            request_allowed(
                self.state,
                path="/health",
                cookie_header=None,
                client_host="127.0.0.1",
                x_real_ip="127.0.0.1",
            )
        )

    def test_external_health_is_denied(self):
        self.assertFalse(
            request_allowed(
                self.state,
                path="/health",
                cookie_header=None,
                client_host="127.0.0.1",
                x_real_ip="203.0.113.4",
            )
        )

    def test_spoofed_real_ip_from_non_loopback_does_not_open_health(self):
        self.assertFalse(
            request_allowed(
                self.state,
                path="/health",
                cookie_header=None,
                client_host="testclient",
                x_real_ip="127.0.0.1",
            )
        )

    def test_disabled_entrance_allows_external_login(self):
        state = EntranceState(self.state.token, False)
        self.assertTrue(
            request_allowed(
                state,
                path="/api/auth/login",
                cookie_header=None,
                client_host="203.0.113.9",
                x_real_ip="203.0.113.9",
            )
        )

    def test_url_uses_host_header_port_once(self):
        self.assertEqual(
            build_entrance_url(self.state.token, "203.0.113.10", port=8686),
            f"https://203.0.113.10:8686/{self.state.token}/",
        )
        self.assertEqual(build_entrance_url("zz", "203.0.113.10"), "")


class MiddlewareDenyTests(unittest.TestCase):
    def setUp(self):
        self.path = entrance_file(config_dir())
        self.token = "ef" * 16
        save_state(config_dir(), EntranceState(self.token, True))
        app = FastAPI()
        app.middleware("http")(security_entrance_middleware)

        @app.post("/api/auth/login")
        def login():
            return {"ok": True}

        @app.get("/health")
        def health():
            return {"status": "healthy"}

        @app.get("/api/terminal/ws")
        def terminal():
            return {"ws": True}

        self.client = TestClient(app)

    def tearDown(self):
        if self.path.is_file():
            self.path.unlink()

    def test_login_without_entrance_is_404(self):
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": "x"})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("token", response.text.lower())
        self.assertNotIn("entrance", response.text.lower())

    def test_login_with_entrance_cookie_reaches_the_handler(self):
        self.client.cookies.set(COOKIE_NAME, self.token)
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": "x"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_terminal_path_without_cookie_is_404(self):
        response = self.client.get("/api/terminal/ws")
        self.assertEqual(response.status_code, 404)

    def test_external_style_health_without_cookie_is_404(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 404)


class NginxSnippetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = self.root / "config"
        self.config.mkdir()
        self.state = ensure_state(self.config)
        crt, key = ensure_certificate(
            self.config,
            dns_names=["localhost", "panel.example"],
            ip_addrs=["127.0.0.1", "203.0.113.10"],
        )
        self.crt = crt
        self.key = key
        self.template = NGINX_TEMPLATE.replace("__CRT__", str(crt)).replace("__KEY__", str(key))

    def tearDown(self):
        self.tmp.cleanup()

    def test_certificate_is_kept_on_second_call(self):
        key_bytes = self.key.read_bytes()
        crt_bytes = self.crt.read_bytes()
        again_crt, again_key = ensure_certificate(
            self.config,
            dns_names=["other.example"],
            ip_addrs=["198.51.100.5"],
        )
        self.assertEqual(again_crt, self.crt)
        self.assertEqual(again_key.read_bytes(), key_bytes)
        self.assertEqual(again_crt.read_bytes(), crt_bytes)
        mode = stat.S_IMODE(self.key.stat().st_mode)
        self.assertEqual(mode, 0o600)
        text = subprocess.check_output(
            ["openssl", "x509", "-in", str(self.crt), "-noout", "-text"],
            text=True,
        )
        self.assertIn("203.0.113.10", text)
        self.assertIn("panel.example", text)
        self.assertIn("127.0.0.1", text)
        enddate = subprocess.check_output(
            ["openssl", "x509", "-in", str(self.crt), "-noout", "-enddate"],
            text=True,
        )
        self.assertIn("notAfter=", enddate)
        # 10-year lifetime is far beyond a short-lived default.
        self.assertGreaterEqual(CERT_DAYS, 3650)

    def test_apply_is_idempotent_and_preserves_panel_locations(self):
        once = apply_nginx_text(self.template, self.state)
        twice = apply_nginx_text(once, self.state)
        self.assertEqual(once, twice)
        self.assertIn(HTTP_START, twice)
        self.assertIn(HTTP_END, twice)
        self.assertIn(SERVER_START, twice)
        self.assertIn(SERVER_END, twice)
        self.assertIn(f"location = /{self.state.token} {{", twice)
        self.assertIn("auth_basic off;", twice)
        self.assertIn("error_page 497", twice)
        self.assertIn("location /phpmyadmin {", twice)
        self.assertIn("location /health {", twice)
        self.assertIn('proxy_set_header Upgrade $http_upgrade;', twice)
        self.assertIn("proxy_read_timeout 86400s;", twice)
        self.assertIn("proxy_read_timeout 300s;", twice)
        self.assertIn('proxy_set_header X-Real-IP $remote_addr;', twice)
        self.assertTrue(entrance_nginx_current(twice, self.state))

    def test_disabled_entrance_stops_denying(self):
        enabled = apply_nginx_text(self.template, self.state)
        disabled_state = EntranceState(self.state.token, False)
        disabled = apply_nginx_text(enabled, disabled_state)
        self.assertIn("map $uri $copanel_entrance_pass {\n    default 1;\n}", disabled)
        self.assertNotIn("default 0;", disabled)
        self.assertIn(f"location = /{self.state.token} {{", disabled)
        self.assertEqual(disabled, apply_nginx_text(disabled, disabled_state))

    def test_basic_auth_gate_still_lands_inside_location_slash(self):
        from modules.panel_settings.logic import (
            NGINX_AUTH_END,
            NGINX_AUTH_START,
            _apply_nginx_gate,
            _nginx_gate_at_server_level,
        )

        with_entrance = apply_nginx_text(self.template, self.state)
        gated = _apply_nginx_gate(with_entrance, "/opt/copanel/config/panel_access.htpasswd")
        self.assertIn(NGINX_AUTH_START, gated)
        self.assertIn(NGINX_AUTH_END, gated)
        self.assertFalse(_nginx_gate_at_server_level(gated))
        entrance_at = gated.find(f"location = /{self.state.token} {{")
        gate_at = gated.find(NGINX_AUTH_START)
        spa_at = gated.find("location / {")
        self.assertLess(entrance_at, spa_at)
        self.assertLess(spa_at, gate_at)
        window = gated[entrance_at : entrance_at + 400]
        self.assertIn("auth_basic off;", window)
        # Re-applying the entrance must not drop the basic-auth gate.
        reapplied = apply_nginx_text(gated, self.state)
        self.assertIn(NGINX_AUTH_START, reapplied)
        self.assertFalse(_nginx_gate_at_server_level(reapplied))
        self.assertIn("location /phpmyadmin {", reapplied)

    def test_auto_repair_rewrites_a_wiped_site_without_touching_host_nginx(self):
        site = self.root / "copanel.conf"
        site.write_text(self.template, encoding="utf-8")

        class Ok:
            returncode = 0
            stdout = ""
            stderr = ""

        with patch("core.security_entrance.nginx_test", return_value=Ok()), patch(
            "core.security_entrance.nginx_reload", return_value=Ok()
        ) as reload:
            result = maybe_auto_repair(self.config, site)
            self.assertEqual(reload.call_count, 1)
        self.assertEqual(result, {"repaired": True, "reload_ok": True, "enabled": True})
        self.assertTrue(entrance_nginx_current(site.read_text(encoding="utf-8"), self.state))
        # Already current: do not reload nginx again.
        self.assertIsNone(maybe_auto_repair(self.config, site))

    def test_generated_site_passes_nginx_syntax_check(self):
        if shutil.which("nginx") is None:
            self.skipTest("nginx is not installed")
        site = self.root / "copanel.conf"
        site.write_text(apply_nginx_text(self.template, self.state), encoding="utf-8")
        main = self.root / "nginx.conf"
        for name in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
            (self.root / name).mkdir()
        main.write_text(
            "worker_processes 1;\n"
            f"error_log {self.root / 'error.log'};\n"
            f"pid {self.root / 'nginx.pid'};\n"
            "events { worker_connections 64; }\n"
            "http {\n"
            f"    access_log {self.root / 'access.log'};\n"
            "    default_type application/octet-stream;\n"
            f"    client_body_temp_path {self.root / 'body'};\n"
            f"    proxy_temp_path {self.root / 'proxy'};\n"
            f"    fastcgi_temp_path {self.root / 'fastcgi'};\n"
            f"    uwsgi_temp_path {self.root / 'uwsgi'};\n"
            f"    scgi_temp_path {self.root / 'scgi'};\n"
            f"    include {site};\n"
            "}\n",
            encoding="utf-8",
        )
        proc = subprocess.run(
            ["nginx", "-t", "-c", str(main), "-p", str(self.root)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)


class CertificatePathsTests(unittest.TestCase):
    def test_ssl_paths_live_under_config(self):
        crt, key = ssl_paths(Path("/opt/copanel/config"))
        self.assertEqual(crt, Path("/opt/copanel/config/ssl/panel.crt"))
        self.assertEqual(key, Path("/opt/copanel/config/ssl/panel.key"))


if __name__ == "__main__":
    unittest.main()
