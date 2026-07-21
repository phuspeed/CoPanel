"""Tests for Site Wizard logic."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from modules.site_wizard.logic import (
    _ensure_wp_config,
    _validate_doc_root,
    _validate_domain,
    _wordpress_files_present,
    _write_wp_config,
)
from modules.ssl_manager.logic import SSLManager


class SiteWizardValidationTests(unittest.TestCase):
    def test_valid_domain(self):
        self.assertEqual(_validate_domain("example.com"), "example.com")

    def test_invalid_domain(self):
        with self.assertRaises(ValueError):
            _validate_domain("no_dot_here")
        with self.assertRaises(ValueError):
            _validate_domain("bad domain.com")

    def test_doc_root_required(self):
        with self.assertRaises(ValueError):
            _validate_doc_root("")


class WordPressHelperTests(unittest.TestCase):
    def test_wordpress_files_present_requires_core_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.php").write_text("<?php", encoding="utf-8")
            self.assertFalse(_wordpress_files_present(root))
            (root / "wp-includes").mkdir()
            (root / "wp-includes" / "version.php").write_text("<?php", encoding="utf-8")
            self.assertTrue(_wordpress_files_present(root))

    def test_ensure_wp_config_updates_existing_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wp_config = root / "wp-config.php"
            wp_config.write_text(
                "define('DB_NAME', 'old_db');\n"
                "define('DB_USER', 'old_user');\n"
                "define('DB_PASSWORD', 'old_pass');\n"
                "define('DB_HOST', 'localhost');\n",
                encoding="utf-8",
            )
            database = {"name": "new_db", "user": "new_user", "password": "new_pass", "host": "localhost"}
            self.assertTrue(_ensure_wp_config(root, database))
            cfg = wp_config.read_text(encoding="utf-8")
            self.assertIn("new_db", cfg)
            self.assertIn("new_user", cfg)
            self.assertIn("new_pass", cfg)

    def test_ensure_wp_config_updates_double_quoted_defines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wp_config = root / "wp-config.php"
            wp_config.write_text(
                'define( "DB_NAME", "old_db" );\n'
                'define( "DB_USER", "old_user" );\n'
                'define( "DB_PASSWORD", "old_pass" );\n'
                'define( "DB_HOST", "localhost" );\n',
                encoding="utf-8",
            )
            database = {"name": "new_db", "user": "new_user", "password": "p'a$s", "host": "127.0.0.1"}
            self.assertTrue(_ensure_wp_config(root, database))
            cfg = wp_config.read_text(encoding="utf-8")
            self.assertIn("new_db", cfg)
            self.assertIn("new_user", cfg)
            self.assertIn("p\\'a$s", cfg)
            self.assertIn("127.0.0.1", cfg)

    def test_write_wp_config_from_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sample = root / "wp-config-sample.php"
            sample.write_text(
                "define('DB_NAME', 'database_name_here');\n"
                "define('DB_USER', 'username_here');\n"
                "define('DB_PASSWORD', 'password_here');\n"
                "define('DB_HOST', 'localhost');\n",
                encoding="utf-8",
            )
            database = {"name": "test_db", "user": "test_user", "password": "secret", "host": "localhost"}
            self.assertTrue(_write_wp_config(root, database))
            cfg = (root / "wp-config.php").read_text(encoding="utf-8")
            self.assertIn("test_db", cfg)
            self.assertIn("test_user", cfg)
            self.assertIn("secret", cfg)
            self.assertFalse(_write_wp_config(root, database))


class SSLVhostLookupTests(unittest.TestCase):
    def test_find_nginx_vhost_prefers_conf_suffix(self):
        import modules.ssl_manager.logic as ssl_logic

        with tempfile.TemporaryDirectory() as tmp:
            sites = Path(tmp)
            (sites / "example.com.conf").write_text("server { server_name example.com; }", encoding="utf-8")
            real_path = Path

            def patched_path(value):
                if str(value) == "/etc/nginx/sites-available":
                    return sites
                return real_path(value)

            with patch.object(ssl_logic, "IS_WINDOWS", False), patch.object(ssl_logic, "Path", side_effect=patched_path):
                found = SSLManager.find_nginx_vhost_path("example.com")
                self.assertEqual(found, sites / "example.com.conf")


class HttpVerifyTests(unittest.TestCase):
    @patch("modules.site_wizard.logic.urllib.request.urlopen")
    @patch("modules.site_wizard.logic.socket.gethostbyname", return_value="127.0.0.1")
    def test_http_verify_treats_400_as_unreachable(self, _dns, mock_urlopen):
        from modules.site_wizard.logic import _http_verify

        resp = MagicMock()
        resp.status = 400
        resp.reason = "Bad Request"
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = resp

        result = _http_verify("example.com", use_https=False)
        self.assertFalse(result["reachable"])
        self.assertEqual(result["status_code"], 400)


class WordPressInstallScriptTests(unittest.TestCase):
    @patch("modules.site_wizard.logic._resolve_wp_db_host", return_value="127.0.0.1")
    @patch("modules.site_wizard.logic.subprocess.run")
    def test_install_script_seeds_http_host(self, mock_run, _host):
        from modules.site_wizard.logic import _run_wordpress_db_install

        captured = {}

        def fake_run(cmd, **kwargs):
            script_path = Path(cmd[-1])
            captured["script"] = script_path.read_text(encoding="utf-8")
            mock = MagicMock()
            mock.returncode = 0
            mock.stdout = "OK"
            mock.stderr = ""
            return mock

        mock_run.side_effect = fake_run

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wp-load.php").write_text("<?php", encoding="utf-8")
            database = {"name": "db", "user": "u", "password": "p", "host": "127.0.0.1"}
            result = _run_wordpress_db_install(str(root), "example.com", database)

        self.assertTrue(result["db_installed"])
        script = captured["script"]
        self.assertIn("HTTP_HOST", script)
        self.assertIn('"example.com"', script)
        self.assertIn("WP_HOME", script)


if __name__ == "__main__":
    unittest.main()
