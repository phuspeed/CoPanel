"""Safe OAuth popup result page.

Uses ``core.oauth_popup`` (CoPanel 1.1.15+); older cores get the same
implementation inline. Nothing from the request is reflected as markup, the
payload is escaped JSON, ``postMessage`` targets the panel's own origin, and
a nonce CSP blocks any other script.
"""
from __future__ import annotations

try:
    from core.oauth_popup import oauth_result_page, safe_error_code  # noqa: F401
except ImportError:  # pragma: no cover - CoPanel < 1.1.15
    import html
    import json
    import re
    import secrets
    from typing import Any, Dict

    from fastapi.responses import HTMLResponse

    _ERROR_CODE_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")

    def safe_error_code(value: Any) -> str:
        text = str(value or "").strip()
        return text if _ERROR_CODE_RE.match(text) else "oauth_error"

    def _script_json(payload: Dict[str, Any]) -> str:
        raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
        return raw.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

    def oauth_result_page(payload: Dict[str, Any], message: str, status_code: int = 200) -> HTMLResponse:
        nonce = secrets.token_urlsafe(16)
        script = (
            "(function(){var d=" + _script_json(payload) + ";"
            "try{if(window.opener){window.opener.postMessage(d,window.location.origin);}}catch(e){}"
            "window.close();})();"
        )
        body = (
            '<!doctype html><html><head><meta charset="utf-8"><title>CoPanel</title></head><body>'
            f'<script nonce="{nonce}">{script}</script><p>{html.escape(message)}</p></body></html>'
        )
        return HTMLResponse(
            content=body,
            status_code=status_code,
            headers={
                "Content-Security-Policy": (
                    f"default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; "
                    "form-action 'none'; frame-ancestors 'none'"
                ),
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cache-Control": "no-store",
                "X-Frame-Options": "DENY",
            },
        )
