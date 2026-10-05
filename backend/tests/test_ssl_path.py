"""Custom SSL install must reject path-traversal domains."""
from __future__ import annotations

import unittest
from pathlib import Path

from modules.ssl_manager.logic import SSLManager


class SslPathTests(unittest.TestCase):
    def test_traversal_domain_is_rejected(self):
        cron_payload = Path("/etc/cron.d/x")
        existed = cron_payload.exists()
        res = SSLManager.install_custom_ssl("../../etc/cron.d/x", "PRIVATE KEY", "CERTIFICATE")
        self.assertEqual(res["status"], "error")
        self.assertEqual(cron_payload.exists(), existed)

    def test_domain_with_newline_is_rejected(self):
        res = SSLManager.install_custom_ssl("example.com\nssl_certificate /tmp/x;", "k", "c")
        self.assertEqual(res["status"], "error")


if __name__ == "__main__":
    unittest.main()
