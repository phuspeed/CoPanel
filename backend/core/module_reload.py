"""
Runtime reload of CoPanel API modules after AppStore install (no full copanel restart).
"""
from __future__ import annotations

from typing import Optional, Tuple

from fastapi import FastAPI

from .loader import ModuleLoader

_app: Optional[FastAPI] = None
_loader: Optional[ModuleLoader] = None


def configure(app: FastAPI, loader: ModuleLoader) -> None:
    global _app, _loader
    _app = app
    _loader = loader


def reload_module(module_id: str) -> Tuple[bool, str]:
    """Reload one module's FastAPI router from disk. Returns (ok, message)."""
    if _app is None or _loader is None:
        return False, "Module reload is not configured on this process."
    return _loader.reload_module(_app, module_id)
