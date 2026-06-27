"""
Embedded WebDAV server with CoPanel superadmin authentication.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from core.security import verify_password
from core import user_model

logger = logging.getLogger(__name__)

IS_WINDOWS = os.name == "nt"

_server_thread: Optional[threading.Thread] = None
_server_handle: Any = None
_server_lock = threading.Lock()
_running_config: Optional[Dict[str, Any]] = None


class CoPanelDomainController:
    """WebDAV auth: only superadmin (root panel user) may connect."""

    def __init__(self, wsgidav_app: Any, config: Dict[str, Any]) -> None:
        self.wsgidav_app = wsgidav_app
        self.config = config

    def get_domain_realm(self, path_info: str, environ: Dict[str, Any]) -> str:
        return "CoPanel WebDAV"

    def require_authentication(self, realm: str, environ: Dict[str, Any]) -> bool:
        return True

    def is_share_anonymous(self, share: str) -> bool:
        return False

    def basic_auth_user(
        self,
        realm: str,
        user_name: str,
        password: str,
        environ: Dict[str, Any],
    ) -> bool:
        user = user_model.get_user_by_username(user_name)
        if not user or user.get("role") != "superadmin":
            return False
        return verify_password(password, user.get("password_hash", ""))

    def supports_http_digest_auth(self) -> bool:
        return False

    def digest_auth_user(
        self,
        realm: str,
        user_name: str,
        environ: Dict[str, Any],
    ) -> Optional[bool]:
        return None


def _build_wsgidav_app(share_path: str, share_name: str) -> Any:
    from wsgidav.fs_dav_provider import FilesystemProvider
    from wsgidav.wsgidav_app import WsgiDAVApp

    root = Path(share_path).resolve()
    root.mkdir(parents=True, exist_ok=True)

    share_mount = f"/{share_name.strip('/')}" if share_name.strip("/") else "/"
    provider = FilesystemProvider(str(root), readonly=False)

    config = {
        "provider_mapping": {share_mount: provider},
        "http_authenticator": {
            "domain_controller": CoPanelDomainController,
            "accept_basic": True,
            "accept_digest": False,
            "default_to_digest": False,
        },
        "verbose": 0,
        "logging": {"enable": False},
    }
    return WsgiDAVApp(config)


def is_running() -> bool:
    with _server_lock:
        return _server_thread is not None and _server_thread.is_alive()


def running_config() -> Optional[Dict[str, Any]]:
    with _server_lock:
        return dict(_running_config) if _running_config else None


def start_server(bind_address: str, port: int, share_path: str, share_name: str) -> Dict[str, Any]:
    """Start WebDAV in a background thread. Idempotent if same config."""
    global _server_thread, _server_handle, _running_config

    if IS_WINDOWS:
        return {
            "running": False,
            "message": "WebDAV server is only supported on Linux hosts.",
        }

    desired = {
        "bind_address": bind_address,
        "port": port,
        "share_path": str(Path(share_path).resolve()),
        "share_name": share_name.strip("/") or "copanel",
    }

    with _server_lock:
        if _server_thread and _server_thread.is_alive() and _running_config == desired:
            return {"running": True, "message": "WebDAV already running.", **desired}

        stop_server_unlocked()

        app = _build_wsgidav_app(desired["share_path"], desired["share_name"])

        try:
            from cheroot import wsgi
        except ImportError as exc:
            raise RuntimeError("cheroot is required for WebDAV (pip install wsgidav).") from exc

        server = wsgi.Server(
            bind_addr=(bind_address, port),
            wsgi_app=app,
            numthreads=30,
            request_queue_size=64,
        )

        def _serve() -> None:
            try:
                server.start()
            except Exception:
                logger.exception("WebDAV server stopped with error")

        thread = threading.Thread(target=_serve, name="copanel-webdav", daemon=True)
        thread.start()

        _server_thread = thread
        _server_handle = server
        _running_config = desired

    return {"running": True, "message": "WebDAV started.", **desired}


def stop_server_unlocked() -> None:
    global _server_thread, _server_handle, _running_config

    if _server_handle is not None:
        try:
            _server_handle.stop()
        except Exception:
            logger.exception("Failed to stop WebDAV server")
    _server_handle = None
    _server_thread = None
    _running_config = None


def stop_server() -> Dict[str, Any]:
    with _server_lock:
        was_running = _server_thread is not None and _server_thread.is_alive()
        stop_server_unlocked()
    return {"running": False, "message": "WebDAV stopped." if was_running else "WebDAV was not running."}


def restart_server(bind_address: str, port: int, share_path: str, share_name: str) -> Dict[str, Any]:
    stop_server()
    return start_server(bind_address, port, share_path, share_name)
