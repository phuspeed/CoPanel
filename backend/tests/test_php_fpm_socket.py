"""Tests for PHP-FPM socket helpers used to prevent nginx 502."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.web_manager.logic import repair_nginx_php_socket


class RepairNginxPhpSocketTests(unittest.TestCase):
    @patch("modules.web_manager.logic.ensure_php_fpm_socket", return_value="/run/php/php8.3-fpm.sock")
    def test_updates_stale_fastcgi_pass(self, _ensure):
        with tempfile.TemporaryDirectory() as tmp:
            vhost = Path(tmp) / "example.com.conf"
            vhost.write_text(
                "server {\n"
                "    listen 443 ssl;\n"
                "    location ~ \\.php$ {\n"
                "        fastcgi_pass unix:/run/php/php8.2-fpm.sock;\n"
                "    }\n"
                "}\n",
                encoding="utf-8",
            )
            with patch("modules.ssl_manager.logic.SSLManager.find_nginx_vhost_path", return_value=vhost):
                with patch("modules.web_manager.logic.IS_WINDOWS", True):
                    result = repair_nginx_php_socket("example.com", "8.2")
            self.assertEqual(result["status"], "success")
            self.assertTrue(result["updated"])
            self.assertIn("php8.3-fpm.sock", vhost.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
