"""DNS Manager logic tests using the local JSON store."""
import importlib
import os
import tempfile
import unittest
from pathlib import Path


class DnsLogicTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        store_path = Path(self.tmp.name) / "dns_zones.json"
        os.environ["COPANEL_DNS_STORE"] = str(store_path)
        from modules.dns_manager import logic as dns_logic
        importlib.reload(dns_logic)
        dns_logic.STORE_PATH = store_path
        self.logic = dns_logic

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_and_list(self):
        self.logic.create_zone("example.com")
        zones = self.logic.list_zones()
        self.assertEqual(len(zones), 1)
        self.assertEqual(zones[0]["domain"], "example.com")

    def test_add_and_delete_record(self):
        zone = self.logic.create_zone("example.org")
        rec = self.logic.add_record(zone["id"], {"type": "A", "name": "@", "value": "1.2.3.4"})
        self.assertTrue(rec["id"].startswith("rec_"))
        self.assertTrue(self.logic.delete_record(zone["id"], rec["id"]))

    def test_invalid_record_type(self):
        zone = self.logic.create_zone("example.io")
        with self.assertRaises(ValueError):
            self.logic.add_record(zone["id"], {"type": "ZZ", "value": "x"})


if __name__ == "__main__":
    unittest.main()
