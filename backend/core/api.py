"""
Standardized API contract for CoPanel.

All modules SHOULD use these helpers so the frontend can rely on a consistent
response envelope:

    {"status": "success" | "error", "data": ..., "error": {...}, "meta": {...}}

The global exception handler installed in `main.py` automatically wraps any
unhandled exception in the same envelope, so legacy modules stay compatible
while we migrate.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Optional

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def _envelope(status_str: str, **fields: Any) -> dict:
    base = {"status": status_str}
    base.update({k: v for k, v in fields.items() if v is not None})
    return base


def ok(data: Any = None, message: Optional[str] = None, meta: Optional[dict] = None) -> dict:
    """Standard success envelope."""
    return _envelope("success", data=data, message=message, meta=meta)


def fail(
    code: str,
    message: str,
    *,
    http_status: int = 400,
    details: Optional[dict] = None,
) -> JSONResponse:
    """Return a JSONResponse with standard error envelope.

    ``code`` is a stable, machine-readable identifier used by the frontend
    to translate or branch behavior; ``message`` is human-friendly text.
    """
    body = _envelope(
        "error",
        error={
            "code": code,
            "message": message,
            "details": details,
        },
    )
    return JSONResponse(status_code=http_status, content=body)


class ApiError(HTTPException):
    """HTTPException subclass that carries a stable error code.

    Any module can ``raise ApiError("RES_NOT_FOUND", "Site not found", 404)``;
    the global handler turns it into the standard envelope.
    """

    def __init__(
        self,
        code: str,
        message: str,
        http_status: int = 400,
        details: Optional[dict] = None,
    ) -> None:
        super().__init__(status_code=http_status, detail=message)
        self.code = code
        self.message = message
        self.details = details


async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    code = getattr(exc, "code", None) or _default_code_for(exc.status_code)
    details = getattr(exc, "details", None)
    return fail(code, str(exc.detail), http_status=exc.status_code, details=details)


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return fail(
        "VALIDATION_ERROR",
        "Request validation failed",
        http_status=422,
        details={"errors": exc.errors()},
    )


async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception in request: %s", exc)
    return fail(
        "INTERNAL_ERROR",
        "Internal server error",
        http_status=500,
        details={"type": exc.__class__.__name__},
    )


def _default_code_for(http_status: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }.get(http_status, f"HTTP_{http_status}")


class RequestContext:
    """Per-request metadata: request_id, latency_ms, user.

    Attached to ``request.state.copanel`` by ``request_context_middleware``.
    """

    def __init__(self) -> None:
        self.request_id: str = str(uuid.uuid4())
        self.started_at: float = time.monotonic()
        self.user: Optional[dict] = None

    def latency_ms(self) -> float:
        return round((time.monotonic() - self.started_at) * 1000.0, 2)


async def request_context_middleware(request: Request, call_next):
    """Attach a ``RequestContext`` to every request and add an X-Request-Id header."""
    ctx = RequestContext()
    request.state.copanel = ctx
    try:
        response = await call_next(request)
    except Exception:
        raise
    response.headers["X-Request-Id"] = ctx.request_id
    response.headers["X-Response-Time-Ms"] = str(ctx.latency_ms())
    return response


def install_exception_handlers(app) -> None:
    """Register the global exception handlers on a FastAPI app."""
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
