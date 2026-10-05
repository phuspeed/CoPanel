"""JWT secret must not fall back to the retired public default."""
from __future__ import annotations

import os
import stat
import unittest
from pathlib import Path

from jose import jwt

from core.security import (
    ALGORITHM,
    create_access_token,
    load_or_create_jwt_secret,
    verify_token,
)

RETIRED_DEFAULT = "your-secret-key-change-in-production"


class JwtSecretTests(unittest.TestCase):
    def test_missing_env_does_not_use_public_default(self):
        env_key = os.environ.pop("JWT_SECRET_KEY", None)
        previous_file = os.environ.get("JWT_SECRET_FILE")
        try:
            secret_path = Path(os.environ["COPANEL_TEST_CONFIG_DIR"]) / "jwt-secret-fresh"
            if secret_path.exists():
                secret_path.unlink()
            os.environ["JWT_SECRET_FILE"] = str(secret_path)
            secret = load_or_create_jwt_secret()
            self.assertNotEqual(secret, RETIRED_DEFAULT)
            self.assertGreaterEqual(len(secret), 32)
            self.assertEqual(secret_path.read_text(encoding="utf-8").strip(), secret)
            mode = stat.S_IMODE(secret_path.stat().st_mode)
            self.assertEqual(mode, 0o600)
            self.assertEqual(load_or_create_jwt_secret(), secret)
        finally:
            if env_key is None:
                os.environ.pop("JWT_SECRET_KEY", None)
            else:
                os.environ["JWT_SECRET_KEY"] = env_key
            if previous_file is None:
                os.environ.pop("JWT_SECRET_FILE", None)
            else:
                os.environ["JWT_SECRET_FILE"] = previous_file

    def test_retired_env_value_is_ignored(self):
        previous = os.environ.get("JWT_SECRET_KEY")
        previous_file = os.environ.get("JWT_SECRET_FILE")
        try:
            secret_path = Path(os.environ["COPANEL_TEST_CONFIG_DIR"]) / "jwt-secret-retired"
            if secret_path.exists():
                secret_path.unlink()
            os.environ["JWT_SECRET_FILE"] = str(secret_path)
            os.environ["JWT_SECRET_KEY"] = RETIRED_DEFAULT
            secret = load_or_create_jwt_secret()
            self.assertNotEqual(secret, RETIRED_DEFAULT)
        finally:
            if previous is None:
                os.environ.pop("JWT_SECRET_KEY", None)
            else:
                os.environ["JWT_SECRET_KEY"] = previous
            if previous_file is None:
                os.environ.pop("JWT_SECRET_FILE", None)
            else:
                os.environ["JWT_SECRET_FILE"] = previous_file

    def test_forged_token_with_retired_secret_is_rejected(self):
        forged = jwt.encode({"sub": "admin", "token_version": 0}, RETIRED_DEFAULT, algorithm=ALGORITHM)
        self.assertIsNone(verify_token(forged))

    def test_issued_token_round_trips_and_carries_iat(self):
        token = create_access_token({"sub": "admin", "token_version": 0})
        payload = verify_token(token)
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["sub"], "admin")
        self.assertIn("iat", payload)
        self.assertEqual(payload["token_version"], 0)

    def test_password_change_and_logout_invalidate_tokens(self):
        from core.auth import user_from_verified_payload
        from core import user_model

        user_id = user_model.create_user("secret-user", "old-password-1", "user", "[]", "[]")
        user = user_model.get_user_by_id(user_id)
        assert user is not None
        token = create_access_token(
            {"sub": "secret-user", "token_version": int(user.get("token_version") or 0)}
        )
        self.assertIsNotNone(user_from_verified_payload(verify_token(token)))

        user_model.change_password(user_id, "new-password-2")
        self.assertIsNone(user_from_verified_payload(verify_token(token)))

        refreshed = user_model.get_user_by_id(user_id)
        assert refreshed is not None
        current = create_access_token(
            {"sub": "secret-user", "token_version": int(refreshed.get("token_version") or 0)}
        )
        self.assertIsNotNone(user_from_verified_payload(verify_token(current)))
        user_model.bump_token_version(user_id)
        self.assertIsNone(user_from_verified_payload(verify_token(current)))


if __name__ == "__main__":
    unittest.main()
