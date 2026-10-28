"""phpMyAdmin nginx snippet: one PHP-FPM socket, both access modes.

Direct ``http://HOST:8686/phpmyadmin/`` must stay plain HTTP. A Cloudflare
Tunnel (HTTPS at the edge, HTTP origin) must see scheme https without nginx
returning 502 from a dead ``upstream php_fpm`` list.
"""
from __future__ import annotations

import http.client
import os
import shutil
import socket
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.package_manager import logic
from modules.package_manager import phpmyadmin_nginx as pma


REPO = Path(__file__).resolve().parents[2]

OLD_SITE = """\
upstream copanel_backend {
    server 127.0.0.1:8000;
}

upstream php_fpm {
    server unix:/run/php/php8.3-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.2-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php8.1-fpm.sock max_fails=1 fail_timeout=1s;
    server unix:/run/php/php7.4-fpm.sock max_fails=1 fail_timeout=1s;
}

server {
    listen 8686;
    listen [::]:8686;
    server_name _;

    location / {
        # BEGIN COPANEL NGINX GATE
        auth_basic "CoPanel";
        auth_basic_user_file /opt/copanel/config/panel_access.htpasswd;
        # END COPANEL NGINX GATE
        root /opt/copanel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    location /phpmyadmin {
        root /usr/share/;
        index index.php index.html index.htm;
        location ~ ^/phpmyadmin/(.+\\.php)$ {
            try_files $uri =404;
            root /usr/share/;
            fastcgi_pass php_fpm;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        }
    }

    location /api/ {
        proxy_pass http://copanel_backend;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /health {
        proxy_pass http://copanel_backend;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
"""


class SnippetTests(unittest.TestCase):
    def test_rewrite_replaces_dead_upstream_and_keeps_panel_routes(self):
        updated = pma.rewrite_nginx_text(
            OLD_SITE, "/run/php/php8.3-fpm.sock", "/usr/share/phpmyadmin"
        )
        self.assertEqual(
            updated,
            pma.rewrite_nginx_text(updated, "/run/php/php8.3-fpm.sock", "/usr/share/phpmyadmin"),
        )
        self.assertNotIn("upstream php_fpm", updated)
        self.assertNotIn("max_fails", updated)
        self.assertNotIn("fastcgi_pass php_fpm", updated)
        self.assertEqual(updated.count("fastcgi_pass "), 1)
        self.assertIn("fastcgi_pass unix:/run/php/php8.3-fpm.sock;", updated)
        self.assertIn("fastcgi_buffer_size 32k;", updated)
        self.assertIn("fastcgi_buffers 16 16k;", updated)
        self.assertIn("return 301 /phpmyadmin/;", updated)
        self.assertNotIn("return 301 http://", updated)
        self.assertIn("fastcgi_param HTTPS $copanel_pma_https if_not_empty;", updated)
        self.assertIn("fastcgi_param HTTP_X_FORWARDED_PROTO $http_x_forwarded_proto;", updated)
        self.assertIn("fastcgi_param HTTP_HOST $http_host;", updated)
        self.assertIn("fastcgi_param SERVER_PORT $copanel_pma_server_port;", updated)
        self.assertIn("fastcgi_param SCRIPT_FILENAME /usr/share/phpmyadmin/$pma_script;", updated)
        self.assertIn("(?<pma_script>.+\\.php)", updated)
        self.assertIn('default $scheme;', updated)
        self.assertIn("https   443;", updated)
        self.assertIn("# BEGIN COPANEL NGINX GATE", updated)
        self.assertIn('auth_basic "CoPanel";', updated)
        self.assertIn("location /api/ {", updated)
        self.assertIn("location /health {", updated)
        self.assertIn("proxy_read_timeout 300s;", updated)
        self.assertIn("try_files $uri $uri/ /index.html;", updated)

    def test_capitalized_docroot_is_used_literally(self):
        text = pma.render_location("/run/php-fpm/www.sock", "/usr/share/phpMyAdmin")
        self.assertIn("alias /usr/share/phpMyAdmin/;", text)
        self.assertIn("fastcgi_param SCRIPT_FILENAME /usr/share/phpMyAdmin/$pma_script;", text)
        self.assertIn("fastcgi_pass unix:/run/php-fpm/www.sock;", text)

    def test_rejects_paths_that_could_break_nginx(self):
        for bad in ("/tmp/a b.sock", "/run/php/php8.3-fpm.sock;daemon off", "unix:/run/php/x.sock", "../run/php.sock"):
            with self.assertRaises(ValueError):
                pma.validate_socket(bad)
        for bad in ("/usr/share/phpmyadmin;}", "/usr/share/../../etc", "relative/phpmyadmin"):
            with self.assertRaises(ValueError):
                pma.validate_docroot(bad)

    def test_reference_configs_match_the_renderer(self):
        nginx_conf = (REPO / "config" / "nginx.conf").read_text(encoding="utf-8")
        install_sh = (REPO / "scripts" / "install.sh").read_text(encoding="utf-8")
        self.assertIn(pma.render_map(), nginx_conf)
        self.assertIn(
            pma.render_location(pma.FALLBACK_SOCKET, pma.FALLBACK_DOCROOT),
            nginx_conf,
        )
        self.assertIn(pma.render_map(), install_sh)
        self.assertIn(
            pma.render_location("__COPANEL_PHP_FPM_SOCK__", "__COPANEL_PMA_ROOT__"),
            install_sh,
        )
        self.assertNotIn("upstream php_fpm", nginx_conf)
        self.assertNotIn("upstream php_fpm", install_sh)
        self.assertIn("copanel_apply_phpmyadmin_nginx_paths", install_sh)
        self.assertIn("--no-install-recommends", (REPO / "backend/modules/package_manager/phpmyadmin_nginx.py").read_text(encoding="utf-8"))
        rewritten = pma.rewrite_nginx_text(
            nginx_conf, pma.FALLBACK_SOCKET, pma.FALLBACK_DOCROOT
        )
        self.assertEqual(rewritten, nginx_conf)

    def test_apply_rolls_back_when_nginx_test_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "copanel.conf"
            site.write_text(OLD_SITE, encoding="utf-8")

            def fake_run(cmd, timeout, as_root=False, env_extra=None, input=None, check=False):
                self.assertIsInstance(cmd, list)
                if list(cmd)[:2] == ["nginx", "-t"]:
                    return subprocess.CompletedProcess(cmd, 1, "", "nginx: [emerg] boom")
                raise AssertionError(f"unexpected command {cmd}")

            with patch.object(pma.sysexec, "run", side_effect=fake_run), patch.object(
                pma.shutil, "which", return_value="/usr/sbin/nginx"
            ):
                with self.assertRaises(RuntimeError):
                    pma.apply_nginx_site(
                        "/run/php/php8.3-fpm.sock",
                        "/usr/share/phpmyadmin",
                        site,
                    )
            self.assertEqual(site.read_text(encoding="utf-8"), OLD_SITE)

    def test_repair_does_not_install_packages_when_phpmyadmin_is_absent(self):
        os.environ.pop("COPANEL_TEST_CONFIG_DIR", None)
        os.environ.pop("COPANEL_DISABLE_PMA_REPAIR", None)
        with patch.object(pma, "find_docroot", return_value=None), patch.object(
            pma, "install_php_fpm_packages", side_effect=AssertionError("apt should not run")
        ):
            self.assertIsNone(pma.maybe_repair_phpmyadmin())


class InstallCommandTests(unittest.TestCase):
    def test_apt_installs_php_fpm_and_not_apache(self):
        calls = []

        def fake_run(cmd, timeout, as_root=False, env_extra=None, input=None, check=False):
            self.assertIsInstance(cmd, list)
            self.assertNotIn("shell", cmd)
            calls.append((list(cmd), input, env_extra))
            return subprocess.CompletedProcess(cmd, 0, "", "")

        def which(name):
            if name in {"apt-get", "debconf-set-selections"}:
                return f"/usr/bin/{name}"
            return None

        with patch.object(pma.sysexec, "run", side_effect=fake_run), patch.object(
            pma.shutil, "which", side_effect=which
        ), patch.object(
            pma, "list_live_sockets", return_value=["/run/php/php8.3-fpm.sock"]
        ), patch.object(
            pma, "find_docroot", return_value="/usr/share/phpmyadmin"
        ), patch.object(
            pma, "apply_nginx_site", return_value={"updated": True}
        ) as apply:
            result = pma.install_phpmyadmin()

        install = next(cmd for cmd, _inp, _env in calls if cmd[0] == "apt-get" and "install" in cmd)
        self.assertIn("--no-install-recommends", install)
        self.assertIn("php-fpm", install)
        self.assertIn("php-mysql", install)
        self.assertIn("phpmyadmin", install)
        self.assertNotIn("apache2", install)
        self.assertNotIn("libapache2-mod-php", install)
        preseed = next(inp for cmd, inp, _env in calls if cmd[0] == "debconf-set-selections")
        self.assertIn("phpmyadmin/reconfigure-webserver multiselect", preseed)
        self.assertNotIn("apache2", preseed)
        env = next(env for cmd, _inp, env in calls if cmd[0] == "apt-get" and "install" in cmd)
        self.assertEqual(env["DEBIAN_FRONTEND"], "noninteractive")
        apply.assert_called_once()
        self.assertEqual(apply.call_args.args[0], "/run/php/php8.3-fpm.sock")
        self.assertEqual(result["socket"], "/run/php/php8.3-fpm.sock")

    def test_package_manager_delegates_phpmyadmin_install(self):
        pkg = {"id": "phpmyadmin", "status": "not_installed", "name": "phpMyAdmin"}
        with patch.object(logic, "load_packages", return_value=[pkg]), patch.object(
            logic, "save_packages"
        ) as save, patch(
            "modules.package_manager.phpmyadmin_nginx.install_phpmyadmin",
            return_value={"updated": True},
        ) as install:
            result = logic.install_package("phpmyadmin")
        install.assert_called_once_with()
        self.assertEqual(result["status"], "running")
        saved = save.call_args.args[0]
        self.assertEqual(saved[0]["status"], "running")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _http(port: int, path: str, headers: dict | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("GET", path, headers=headers or {})
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
        hdrs = {k.lower(): v for k, v in resp.getheaders()}
        return resp.status, hdrs, body
    finally:
        conn.close()


def _parse_env(body: str) -> dict:
    env = {}
    for line in body.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            env[key] = value
    return env


def _php_socket() -> str:
    sockets = sorted(Path("/run/php").glob("php*-fpm.sock")) if Path("/run/php").is_dir() else []
    for candidate in sockets:
        if stat.S_ISSOCK(candidate.stat().st_mode):
            return str(candidate)
    if shutil.which("php-fpm8.3"):
        subprocess.run(["sudo", "-n", "php-fpm8.3", "--daemonize"], check=False, timeout=20)
        for candidate in Path("/run/php").glob("php*-fpm.sock"):
            try:
                if stat.S_ISSOCK(candidate.stat().st_mode):
                    return str(candidate)
            except OSError:
                continue
    return ""


@unittest.skipUnless(shutil.which("nginx") and _php_socket(), "nginx and php-fpm socket required")
class LiveAccessModeTests(unittest.TestCase):
    """Prove both access modes against a real nginx and PHP-FPM."""

    @classmethod
    def setUpClass(cls):
        cls.sock = _php_socket()
        cls.prefix = Path(tempfile.mkdtemp(prefix="copanel-pma-nginx-"))
        cls.docroot = cls.prefix / "phpmyadmin"
        cls.dist = cls.prefix / "dist"
        cls.docroot.mkdir()
        cls.dist.mkdir()
        (cls.dist / "index.html").write_text("panel-ok\n", encoding="utf-8")
        (cls.docroot / "index.php").write_text(
            textwrap.dedent(
                """\
                <?php
                header('Content-Type: text/plain; charset=utf-8');
                foreach (['HTTPS','REQUEST_SCHEME','HTTP_SCHEME','HTTP_HOST','SERVER_PORT','SERVER_NAME','SCRIPT_FILENAME','DOCUMENT_ROOT','HTTP_X_FORWARDED_PROTO','REQUEST_URI'] as $k) {
                    echo $k, '=', isset($_SERVER[$k]) ? $_SERVER[$k] : '', "\\n";
                }
                echo "OK\\n";
                """
            ),
            encoding="utf-8",
        )
        (cls.docroot / "big.php").write_text(
            textwrap.dedent(
                """\
                <?php
                header('X-Big: ' . str_repeat('B', 20000));
                header('Content-Type: text/plain');
                echo "BIG\\n";
                """
            ),
            encoding="utf-8",
        )
        (cls.docroot / "themes").mkdir()
        (cls.docroot / "themes" / "app.css").write_text("body{}\n", encoding="utf-8")
        (cls.docroot / "libraries").mkdir()
        (cls.docroot / "libraries" / "secret.php").write_text("<?php echo 'SECRET';\n", encoding="utf-8")
        (cls.docroot / "config.inc.php").write_text("<?php echo 'CONFIG';\n", encoding="utf-8")
        (cls.docroot / ".hidden").write_text("nope\n", encoding="utf-8")
        for path in cls.prefix.rglob("*"):
            mode = path.stat().st_mode
            if stat.S_ISDIR(mode):
                path.chmod(0o755)
            else:
                path.chmod(0o644)
        cls.prefix.chmod(0o755)
        cls.port = _free_port()
        cls.dead_port = _free_port()
        cls.conf = cls.prefix / "nginx.conf"
        cls.pid = cls.prefix / "nginx.pid"
        cls.err = cls.prefix / "error.log"
        location = pma.render_location(cls.sock, str(cls.docroot))
        # Dead-socket upstream is the old panel config: every peer missing, so
        # nginx answers 502 (the Cloudflare "Host Error" page).
        cls.conf.write_text(
            "user www-data;\n"
            "worker_processes 1;\n"
            f"error_log {cls.err} info;\n"
            f"pid {cls.pid};\n"
            "events { worker_connections 64; }\n"
            "http {\n"
            "    access_log off;\n"
            "    default_type text/plain;\n"
            + pma.render_map()
            + "upstream php_fpm_dead {\n"
            "    server unix:/run/php/php8.2-fpm.sock max_fails=1 fail_timeout=30s;\n"
            "    server unix:/run/php/php8.1-fpm.sock max_fails=1 fail_timeout=30s;\n"
            "    server unix:/run/php/php7.4-fpm.sock max_fails=1 fail_timeout=30s;\n"
            "}\n"
            "server {\n"
            f"    listen 127.0.0.1:{cls.port};\n"
            "    server_name _;\n"
            "    location / {\n"
            f"        root {cls.dist};\n"
            "        try_files $uri $uri/ /index.html;\n"
            "    }\n"
            + location
            + '    location /api/ { default_type text/plain; return 200 "api-ok"; }\n'
            '    location /health { default_type text/plain; return 200 "health-ok"; }\n'
            "}\n"
            "server {\n"
            f"    listen 127.0.0.1:{cls.dead_port};\n"
            "    server_name _;\n"
            "    root " + str(cls.prefix) + ";\n"
            "    location ~ ^/phpmyadmin/.+\\.php$ {\n"
            "        fastcgi_pass php_fpm_dead;\n"
            "        include /etc/nginx/fastcgi_params;\n"
            "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n"
            "    }\n"
            "}\n"
            "}\n",
            encoding="utf-8",
        )
        test = subprocess.run(
            ["sudo", "-n", "nginx", "-t", "-p", str(cls.prefix), "-c", str(cls.conf)],
            capture_output=True,
            text=True,
        )
        if test.returncode != 0:
            raise unittest.SkipTest(f"nginx -t failed: {test.stderr or test.stdout}")
        started = subprocess.run(
            ["sudo", "-n", "nginx", "-p", str(cls.prefix), "-c", str(cls.conf)],
            capture_output=True,
            text=True,
        )
        if started.returncode != 0:
            raise unittest.SkipTest(f"nginx start failed: {started.stderr or started.stdout}")

    @classmethod
    def tearDownClass(cls):
        if cls.pid.exists() or True:
            subprocess.run(
                ["sudo", "-n", "nginx", "-p", str(cls.prefix), "-c", str(cls.conf), "-s", "stop"],
                capture_output=True,
                text=True,
            )
        shutil.rmtree(cls.prefix, ignore_errors=True)

    def _log_tail(self) -> str:
        try:
            return self.err.read_text(encoding="utf-8", errors="replace")[-1500:]
        except OSError:
            return ""

    def test_direct_http_port_stays_http(self):
        status, _hdrs, body = _http(self.port, "/phpmyadmin/index.php")
        self.assertEqual(status, 200, self._log_tail())
        env = _parse_env(body)
        self.assertEqual(env.get("OK") or ("OK" if body.endswith("OK\n") else ""), "OK")
        self.assertIn("OK", body)
        self.assertNotEqual(env["HTTPS"], "on")
        self.assertEqual(env["REQUEST_SCHEME"], "http")
        self.assertEqual(env["HTTP_SCHEME"], "http")
        self.assertEqual(env["SERVER_PORT"], str(self.port))
        self.assertIn(f":{self.port}", env["HTTP_HOST"])
        self.assertTrue(env["SCRIPT_FILENAME"].endswith("/index.php"), env["SCRIPT_FILENAME"])
        self.assertEqual(env["DOCUMENT_ROOT"], str(self.docroot))

    def test_tunnel_forwarded_https(self):
        status, _hdrs, body = _http(
            self.port,
            "/phpmyadmin/index.php",
            {
                "Host": "intelnuc.phutv.io.vn",
                "X-Forwarded-Proto": "https",
            },
        )
        self.assertEqual(status, 200, self._log_tail() + body)
        env = _parse_env(body)
        self.assertEqual(env["HTTPS"], "on")
        self.assertEqual(env["REQUEST_SCHEME"], "https")
        self.assertEqual(env["HTTP_SCHEME"], "https")
        self.assertEqual(env["HTTP_X_FORWARDED_PROTO"], "https")
        self.assertEqual(env["HTTP_HOST"], "intelnuc.phutv.io.vn")
        self.assertEqual(env["SERVER_PORT"], "443")
        self.assertNotIn(":8686", env["HTTP_HOST"])

    def test_tunnel_cf_visitor_without_forwarded_proto(self):
        status, _hdrs, body = _http(
            self.port,
            "/phpmyadmin/index.php",
            {"Host": "intelnuc.phutv.io.vn", "CF-Visitor": '{"scheme":"https"}'},
        )
        self.assertEqual(status, 200, body)
        env = _parse_env(body)
        self.assertEqual(env["REQUEST_SCHEME"], "https")
        self.assertEqual(env["SERVER_PORT"], "443")
        self.assertEqual(env["HTTPS"], "on")

    def test_forwarded_port_overrides_443(self):
        status, _hdrs, body = _http(
            self.port,
            "/phpmyadmin/index.php",
            {
                "Host": "intelnuc.phutv.io.vn",
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Port": "8443",
            },
        )
        self.assertEqual(status, 200, body)
        env = _parse_env(body)
        self.assertEqual(env["SERVER_PORT"], "8443")
        self.assertEqual(env["HTTPS"], "on")

    def test_slash_redirect_is_relative(self):
        status, hdrs, _body = _http(self.port, "/phpmyadmin")
        self.assertEqual(status, 301)
        self.assertEqual(hdrs.get("location"), "/phpmyadmin/")
        status_https, hdrs_https, _body = _http(
            self.port,
            "/phpmyadmin",
            {"Host": "intelnuc.phutv.io.vn", "X-Forwarded-Proto": "https"},
        )
        self.assertEqual(status_https, 301)
        self.assertEqual(hdrs_https.get("location"), "/phpmyadmin/")

    def test_directory_index_and_static_and_panel_routes(self):
        status, _hdrs, body = _http(self.port, "/phpmyadmin/")
        self.assertEqual(status, 200, self._log_tail() + body)
        self.assertIn("OK", body)
        status, _hdrs, body = _http(self.port, "/phpmyadmin/themes/app.css")
        self.assertEqual(status, 200, body)
        self.assertIn("body{}", body)
        status, _hdrs, body = _http(self.port, "/")
        self.assertEqual(status, 200, body)
        self.assertIn("panel-ok", body)
        status, _hdrs, body = _http(self.port, "/api/")
        self.assertEqual(status, 200, body)
        self.assertIn("api-ok", body)
        status, _hdrs, body = _http(self.port, "/health")
        self.assertEqual(status, 200, body)
        self.assertIn("health-ok", body)

    def test_sensitive_paths_are_denied(self):
        for path in (
            "/phpmyadmin/libraries/secret.php",
            "/phpmyadmin/config.inc.php",
            "/phpmyadmin/.hidden",
        ):
            status, _hdrs, body = _http(self.port, path)
            self.assertIn(status, (403, 404), f"{path} -> {status} {body}")
            self.assertNotIn("SECRET", body)
            self.assertNotIn("CONFIG", body)

    def test_large_response_header_is_not_502(self):
        status, hdrs, body = _http(self.port, "/phpmyadmin/big.php")
        self.assertEqual(status, 200, self._log_tail() + body)
        self.assertIn("BIG", body)
        self.assertGreaterEqual(len(hdrs.get("x-big", "")), 20000)

    def test_missing_sockets_upstream_returns_502(self):
        status, _hdrs, _body = _http(self.dead_port, "/phpmyadmin/index.php")
        self.assertEqual(status, 502, self._log_tail())


if __name__ == "__main__":
    unittest.main()
