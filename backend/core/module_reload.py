"""
Runtime reload of CoPanel API modules after AppStore install (no full copanel restart).

Reload must run on the uvicorn event-loop thread. AppStore install calls this from a
background thread; scheduling onto the loop avoids route-table races (404 on new routes).
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import List, Optional, Tuple

from fastapi import FastAPI

from .loader import ModuleLoader

logger = logging.getLogger(__name__)

_app: Optional[FastAPI] = None
_loader: Optional[ModuleLoader] = None
_loop: Optional[asyncio.AbstractEventLoop] = None
_reload_lock = threading.Lock()


def configure(app: FastAPI, loader: ModuleLoader) -> None:
    global _app, _loader
    _app = app
    _loader = loader


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called from FastAPI lifespan — required for thread-safe hot-reload."""
    global _loop
    _loop = loop


def _reload_on_loop(module_id: str) -> Tuple[bool, str]:
    if _app is None or _loader is None:
        return False, "Module reload is not configured on this process."
    with _reload_lock:
        return _loader.reload_module(_app, module_id)


def reload_module(module_id: str) -> Tuple[bool, str]:
    """Reload one module's FastAPI router from disk. Returns (ok, message)."""
    loop = _loop
    if loop is None or loop.is_closed():
        logger.warning("module_reload: no event loop — reloading on caller thread for %s", module_id)
        return _reload_on_loop(module_id)

    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None

    if running is loop:
        return _reload_on_loop(module_id)

    future = asyncio.run_coroutine_threadsafe(_reload_async(module_id), loop)
    try:
        return future.result(timeout=120)
    except Exception as exc:
        logger.exception("module_reload failed for %s", module_id)
        return False, str(exc)


async def _reload_async(module_id: str) -> Tuple[bool, str]:
    return _reload_on_loop(module_id)


def list_module_route_paths(module_id: str) -> List[str]:
    if _app is None or _loader is None:
        return []
    return _loader.list_route_paths(_app, module_id)


def get_app() -> Optional[FastAPI]:
    return _app
