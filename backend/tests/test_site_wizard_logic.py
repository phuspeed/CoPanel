"""Tests for Site Wizard input validation."""
import unittest

from modules.site_wizard.logic import _validate_doc_root, _validate_domain


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


if __name__ == "__main__":
    unittest.main()
