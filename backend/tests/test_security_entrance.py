"""Panel HTTPS certificate and removal of the secret entrance path."""
from __future__ import annotations

import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.security_entrance import (
    CERT_DAYS,
    HTTP_START,
    SERVER_START,
    TLS_START,
    apply_nginx_text,
    build_panel_url,
    ensure_certificate,
    forget_entrance,
    maybe_auto_repair,
    panel_nginx_current,
    ssl_paths,
    strip_entrance,
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

OLD_ENTRANCE = """\
# BEGIN COPANEL SECURITY ENTRANCE
map $uri $copanel_entrance_pass {
    default 0;
}
# END COPANEL SECURITY ENTRANCE
"""

OLD_SERVER = """\
# BEGIN COPANEL SECURITY ENTRANCE SERVER
    location = /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa {
        auth_basic off;
        return 302 /;
    }
    if ($copanel_entrance_pass != 1) {
        return 404;
    }
# END COPANEL SECURITY ENTRANCE SERVER
"""


class CertificateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Path(self.tmp.name) / "config"
        self.config.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_certificate_is_kept_on_second_call(self):
        crt, key = ensure_certificate(
            self.config,
            dns_names=["localhost", "panel.example"],
            ip_addrs=["127.0.0.1", "203.0.113.10"],
        )
        key_bytes = key.read_bytes()
        crt_bytes = crt.read_bytes()
        again_crt, again_key = ensure_certificate(
            self.config,
            dns_names=["other.example"],
            ip_addrs=["198.51.100.5"],
        )
        self.assertEqual(again_crt, crt)
        self.assertEqual(again_key.read_bytes(), key_bytes)
        self.assertEqual(again_crt.read_bytes(), crt_bytes)
        self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
        text = subprocess.check_output(
            ["openssl", "x509", "-in", str(crt), "-noout", "-text"],
            text=True,
        )
        self.assertIn("203.0.113.10", text)
        self.assertIn("panel.example", text)
        self.assertIn("127.0.0.1", text)
        enddate = subprocess.check_output(
            ["openssl", "x509", "-in", str(crt), "-noout", "-enddate"],
            text=True,
        )
        self.assertIn("notAfter=", enddate)
        self.assertGreaterEqual(CERT_DAYS, 3650)

    def test_forget_entrance_removes_the_token_file(self):
        path = self.config / "security_entrance.json"
        path.write_text('{"token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "enabled": true}\n', encoding="utf-8")
        self.assertTrue(forget_entrance(self.config))
        self.assertFalse(path.exists())
        self.assertFalse(forget_entrance(self.config))

    def test_panel_url_has_no_secret_path(self):
        self.assertEqual(build_panel_url("203.0.113.10"), "https://203.0.113.10:8686/")
        self.assertEqual(build_panel_url("panel.example.com", port=None), "https://panel.example.com/")


class NginxSnippetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = self.root / "config"
        self.config.mkdir()
        crt, key = ensure_certificate(
            self.config,
            dns_names=["localhost"],
            ip_addrs=["127.0.0.1"],
        )
        self.template = NGINX_TEMPLATE.replace("__CRT__", str(crt)).replace("__KEY__", str(key))
        self.gated = self.template.replace(
            "server {\n",
            OLD_ENTRANCE + "server {\n",
            1,
        ).replace(
            "    client_max_body_size 100M;\n",
            "    client_max_body_size 100M;\n" + OLD_SERVER,
            1,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_apply_strips_the_secret_path_and_is_idempotent(self):
        self.assertIn("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", self.gated)
        once = apply_nginx_text(self.gated)
        twice = apply_nginx_text(once)
        self.assertEqual(once, twice)
        self.assertNotIn(HTTP_START, twice)
        self.assertNotIn(SERVER_START, twice)
        self.assertNotIn("copanel_entrance_pass", twice)
        self.assertNotIn("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", twice)
        self.assertNotIn("return 404", twice)
        self.assertIn(TLS_START, twice)
        self.assertIn("absolute_redirect off;", twice)
        self.assertIn("port_in_redirect off;", twice)
        self.assertIn("real_ip_header CF-Connecting-IP;", twice)
        self.assertIn("error_page 497 =301 https://$http_host$request_uri;", twice)
        self.assertNotIn("$host:$server_port", twice)
        self.assertIn("listen 8686 ssl http2;", twice)
        self.assertIn("listen [::]:8686 ssl http2;", twice)
        self.assertIn("listen 127.0.0.1:8687;", twice)
        self.assertNotIn("listen 8687;", twice)
        self.assertEqual(twice.count("listen 127.0.0.1:8687;"), 1)
        self.assertIn("location /phpmyadmin {", twice)
        self.assertIn("location /health {", twice)
        self.assertIn('proxy_set_header Upgrade $http_upgrade;', twice)
        self.assertIn("proxy_read_timeout 86400s;", twice)
        self.assertIn("proxy_read_timeout 300s;", twice)
        self.assertTrue(panel_nginx_current(twice))
        self.assertEqual(strip_entrance(self.gated).count(HTTP_START), 0)

    def test_basic_auth_gate_still_lands_inside_location_slash(self):
        from modules.panel_settings.logic import (
            NGINX_AUTH_END,
            NGINX_AUTH_START,
            _apply_nginx_gate,
            _nginx_gate_at_server_level,
        )

        opened = apply_nginx_text(self.gated)
        gated = _apply_nginx_gate(opened, "/opt/copanel/config/panel_access.htpasswd")
        self.assertIn(NGINX_AUTH_START, gated)
        self.assertIn(NGINX_AUTH_END, gated)
        self.assertFalse(_nginx_gate_at_server_level(gated))
        spa_at = gated.find("location / {")
        gate_at = gated.find(NGINX_AUTH_START)
        self.assertLess(spa_at, gate_at)
        reapplied = apply_nginx_text(gated)
        self.assertIn(NGINX_AUTH_START, reapplied)
        self.assertNotIn(HTTP_START, reapplied)
        self.assertFalse(_nginx_gate_at_server_level(reapplied))
        self.assertIn("location /phpmyadmin {", reapplied)

    def test_auto_repair_removes_the_gate_without_touching_host_nginx(self):
        site = self.root / "copanel.conf"
        site.write_text(self.gated, encoding="utf-8")
        token = self.config / "security_entrance.json"
        token.write_text('{"token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "enabled": true}\n', encoding="utf-8")

        class Ok:
            returncode = 0
            stdout = ""
            stderr = ""

        with patch("core.security_entrance.nginx_test", return_value=Ok()), patch(
            "core.security_entrance.nginx_reload", return_value=Ok()
        ) as reload:
            result = maybe_auto_repair(self.config, site)
            self.assertEqual(reload.call_count, 1)
        self.assertEqual(result["repaired"], True)
        self.assertEqual(result["reload_ok"], True)
        self.assertTrue(result["entrance_file_removed"])
        self.assertFalse(token.exists())
        self.assertTrue(panel_nginx_current(site.read_text(encoding="utf-8")))
        self.assertIsNone(maybe_auto_repair(self.config, site))

    def test_generated_site_passes_nginx_syntax_check(self):
        if subprocess.call(["bash", "-c", "command -v nginx >/dev/null"]) != 0:
            self.skipTest("nginx is not installed")
        import shutil

        if shutil.which("nginx") is None:
            self.skipTest("nginx is not installed")
        site = self.root / "copanel.conf"
        site.write_text(apply_nginx_text(self.gated), encoding="utf-8")
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
