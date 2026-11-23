"""Safe HTML for OAuth popup callbacks (public, unauthenticated pages).

The page posts a small result object to ``window.opener`` and closes itself.
Nothing from the request is reflected as markup:

* the payload is JSON with ``<``, ``>``, ``&`` and U+2028/2029 escaped, so it
  cannot close the ``<script>`` element;
* the visible message is a fixed string chosen by the caller, HTML-escaped;
* provider error codes are reduced to ``[A-Za-z0-9_.-]{1,64}`` and exception
  text is never sent to the page;
* ``postMessage`` targets the panel's own origin, never ``*``;
* a strict CSP (nonce-only script, no other sources) plus ``no-store`` /
  ``no-referrer`` / ``nosniff`` headers.
"""
from __future__ import annotations

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


def script_json(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    return (
        raw.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def oauth_result_page(payload: Dict[str, Any], message: str, status_code: int = 200) -> HTMLResponse:
    nonce = secrets.token_urlsafe(16)
    script = (
        "(function(){var d=" + script_json(payload) + ";"
        "try{if(window.opener){window.opener.postMessage(d,window.location.origin);}}catch(e){}"
        "window.close();})();"
    )
    body = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>CoPanel</title></head><body>"
        f"<script nonce=\"{nonce}\">{script}</script>"
        f"<p>{html.escape(message)}</p></body></html>"
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
