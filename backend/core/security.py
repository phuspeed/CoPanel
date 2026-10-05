"""
JWT and authentication utilities for CoPanel using explicit bcrypt.
Avoids passlib Python 3.12 compatibility issues.
"""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from .paths import config_dir, write_private_text

# SHA-256 of the retired hard-coded JWT default. The plaintext is kept out of
# this module so a checkout cannot be used to forge admin tokens.
_RETIRED_PUBLIC_SECRET_SHA256 = (
    "0d356ede0ba49981912e357d2b5ef4a870a721fd186a5b0881e7425f08b68e13"
)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours


def _is_retired_public_secret(value: str) -> bool:
    if not value:
        return True
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return digest == _RETIRED_PUBLIC_SECRET_SHA256


def jwt_secret_path() -> Path:
    """Persistent secret file. ``JWT_SECRET_FILE`` overrides the location."""
    override = os.environ.get("JWT_SECRET_FILE", "").strip()
    if override:
        return Path(override)
    return config_dir() / "jwt_secret"


def load_or_create_jwt_secret() -> str:
    """Resolve the HMAC secret. Never falls back to a fixed public string.

    Order:
    1. ``JWT_SECRET_KEY`` when it is set and is not the retired public default.
    2. An existing secret file (mode forced to 0600).
    3. A new ``secrets.token_urlsafe(48)`` value written to that file.
    """
    env_secret = os.environ.get("JWT_SECRET_KEY", "").strip()
    if env_secret and not _is_retired_public_secret(env_secret):
        return env_secret

    path = jwt_secret_path()
    try:
        if path.is_file():
            existing = path.read_text(encoding="utf-8").strip()
            if existing and not _is_retired_public_secret(existing):
                try:
                    os.chmod(path, 0o600)
                except OSError:
                    pass
                return existing
    except OSError:
        pass

    generated = secrets.token_urlsafe(48)
    write_private_text(path, generated)
    return generated


SECRET_KEY = load_or_create_jwt_secret()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    now = datetime.now(timezone.utc)
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def hash_password(password: str) -> str:
    """Hash a password directly using the bcrypt library."""
    pwd_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash using the bcrypt library."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False
