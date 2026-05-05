"""Tests for the standardized API contract."""
import unittest

from core.api import ApiError, fail, ok, _default_code_for


class CoreApiTests(unittest.TestCase):
    def test_ok_envelope(self):
        env = ok({"a": 1})
        self.assertEqual(env["status"], "success")
        self.assertEqual(env["data"], {"a": 1})

    def test_fail_envelope(self):
        resp = fail("X", "boom", http_status=400)
        self.assertEqual(resp.status_code, 400)
        # JSONResponse stores body as bytes; we don't decode, just ensure shape exists
        self.assertTrue(resp.body)

    def test_api_error_carries_code(self):
        err = ApiError("WHATEVER", "Nope", 418, {"k": "v"})
        self.assertEqual(err.code, "WHATEVER")
        self.assertEqual(err.status_code, 418)
        self.assertEqual(err.details, {"k": "v"})

    def test_default_codes(self):
        self.assertEqual(_default_code_for(404), "NOT_FOUND")
        self.assertEqual(_default_code_for(403), "FORBIDDEN")
        self.assertEqual(_default_code_for(999), "HTTP_999")


if __name__ == "__main__":
    unittest.main()
