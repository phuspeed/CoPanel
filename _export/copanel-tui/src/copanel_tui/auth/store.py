from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_TOKEN_PATH = Path.home() / ".config" / "copanel" / "tui_token.json"


class TokenStore:
    """Persist JWT + last server URL with restrictive file mode."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DEFAULT_TOKEN_PATH

    def load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def save(self, *, base_url: str, token: str, username: str = "") -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"base_url": base_url.rstrip("/"), "token": token, "username": username}
        self.path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def clear(self) -> None:
        if self.path.is_file():
            try:
                self.path.unlink()
            except OSError:
                pass

    @property
    def token(self) -> str | None:
        return self.load().get("token") or None

    @property
    def base_url(self) -> str | None:
        return self.load().get("base_url") or None

    @property
    def username(self) -> str | None:
        return self.load().get("username") or None
