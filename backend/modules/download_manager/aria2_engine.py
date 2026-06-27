"""aria2 JSON-RPC client for BitTorrent and HTTP downloads."""
from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_aria2_start_lock = threading.Lock()
_last_aria2_start_attempt = 0.0
_ARIA2_START_COOLDOWN_SEC = 5.0
_aria2_proc: Optional[subprocess.Popen] = None


def _resolve_aria2_bin() -> Optional[str]:
    for candidate in (
        shutil.which("aria2c"),
        "/usr/bin/aria2c",
        "/usr/local/bin/aria2c",
    ):
        if candidate and Path(candidate).is_file():
            return candidate
    return None


class Aria2Engine:
  """Thin wrapper around aria2 RPC."""

  def __init__(self, host: str = "127.0.0.1", port: int = 6800, secret: str = "") -> None:
      self.host = host or "127.0.0.1"
      self.port = int(port or 6800)
      self.secret = (secret or "").strip()
      self._rpc_url = f"http://{self.host}:{self.port}/jsonrpc"

  def _params(self, *args: Any) -> List[Any]:
      if self.secret:
          return [f"token:{self.secret}", *args]
      return list(args)

  def call(self, method: str, *args: Any) -> Any:
      payload = {
          "jsonrpc": "2.0",
          "id": str(uuid.uuid4()),
          "method": method,
          "params": self._params(*args),
      }
      req = Request(
          self._rpc_url,
          data=json.dumps(payload).encode("utf-8"),
          headers={"Content-Type": "application/json"},
          method="POST",
      )
      try:
          with urlopen(req, timeout=15) as resp:
              body = json.loads(resp.read().decode("utf-8"))
      except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
          raise RuntimeError(f"aria2 RPC failed: {exc}") from exc
      if "error" in body:
          err = body["error"]
          raise RuntimeError(err.get("message") or str(err))
      return body.get("result")

  def is_available(self) -> bool:
      try:
          self.call("aria2.getVersion")
          return True
      except Exception:
          return False

  def get_version(self) -> str:
      try:
          info = self.call("aria2.getVersion")
          return (info or {}).get("version") or ""
      except Exception:
          return ""

  def apply_speed_limits(self, download_kbps: int, upload_kbps: int) -> None:
      opts: Dict[str, str] = {}
      if download_kbps and download_kbps > 0:
          opts["max-overall-download-limit"] = f"{download_kbps}K"
      else:
          opts["max-overall-download-limit"] = "0"
      if upload_kbps and upload_kbps > 0:
          opts["max-overall-upload-limit"] = f"{upload_kbps}K"
      else:
          opts["max-overall-upload-limit"] = "0"
      self.call("aria2.changeGlobalOption", opts)

  def add_uri(self, uris: List[str], options: Optional[Dict[str, str]] = None) -> str:
      gid = self.call("aria2.addUri", uris, options or {})
      return str(gid)

  def add_torrent(self, torrent_bytes: bytes, options: Optional[Dict[str, str]] = None) -> str:
      encoded = base64.b64encode(torrent_bytes).decode("ascii")
      gid = self.call("aria2.addTorrent", encoded, [], options or {})
      return str(gid)

  def add_magnet(self, magnet_uri: str, options: Optional[Dict[str, str]] = None) -> str:
      return self.add_uri([magnet_uri], options)

  def pause(self, gid: str) -> None:
      self.call("aria2.pause", gid)

  def unpause(self, gid: str) -> None:
      self.call("aria2.unpause", gid)

  def remove(self, gid: str) -> None:
      try:
          self.call("aria2.remove", gid)
      except Exception:
          pass

  def tell_status(self, gid: str) -> Dict[str, Any]:
      return self.call("aria2.tellStatus", gid) or {}


def get_engine_from_settings(settings: Dict[str, Any]) -> Aria2Engine:
    return Aria2Engine(
        host=settings.get("aria2_rpc_host") or "127.0.0.1",
        port=int(settings.get("aria2_rpc_port") or 6800),
        secret=settings.get("aria2_rpc_secret") or "",
    )


def _is_local_rpc_host(host: str) -> bool:
    h = (host or "127.0.0.1").strip().lower()
    return h in ("127.0.0.1", "localhost", "::1")


def _rpc_host_for_socket(host: str) -> str:
    h = (host or "127.0.0.1").strip().lower()
    return "127.0.0.1" if h in ("localhost", "::1") else host


def _port_is_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((_rpc_host_for_socket(host), int(port or 6800)), timeout=1.0):
            return True
    except OSError:
        return False


def read_aria2_log_tail(log_file: Path, max_lines: int = 8) -> str:
    if not log_file.is_file():
        return ""
    try:
        lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    tail = [ln.strip() for ln in lines[-max_lines:] if ln.strip()]
    return " | ".join(tail)


def _clear_stale_pid(pid_file: Path) -> None:
    if not pid_file.is_file():
        return
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        pid_file.unlink(missing_ok=True)
        return
    try:
        os.kill(pid, 0)
    except OSError:
        pid_file.unlink(missing_ok=True)


def _stop_managed_aria2() -> None:
    global _aria2_proc
    proc = _aria2_proc
    _aria2_proc = None
    if proc is None:
        return
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def ensure_aria2_daemon(
    *,
    config_dir: Path,
    host: str,
    port: int,
    secret: str,
    download_dir: str,
) -> bool:
    """Start local aria2c with RPC when unreachable. Returns True if RPC responds."""
    global _last_aria2_start_attempt, _aria2_proc

    if not _is_local_rpc_host(host):
        return False

    engine = Aria2Engine(host=host, port=port, secret=secret)
    if engine.is_available():
        return True

    now = time.time()
    with _aria2_start_lock:
        if engine.is_available():
            return True
        if now - _last_aria2_start_attempt < _ARIA2_START_COOLDOWN_SEC:
            return engine.is_available()
        _last_aria2_start_attempt = now

        bin_path = _resolve_aria2_bin()
        if not bin_path:
            return False

        config_dir.mkdir(parents=True, exist_ok=True)
        session = config_dir / "aria2.session"
        log_file = config_dir / "aria2.log"
        pid_file = config_dir / "aria2.pid"
        dest = Path(download_dir or config_dir / "downloads")
        dest.mkdir(parents=True, exist_ok=True)
        session.touch(exist_ok=True)
        _clear_stale_pid(pid_file)

        if _aria2_proc and _aria2_proc.poll() is not None:
            _aria2_proc = None

        if _aria2_proc is None and not _port_is_open(host, port):
            cmd = [
                bin_path,
                "--enable-rpc",
                f"--rpc-listen-port={int(port or 6800)}",
                "--rpc-allow-origin-all",
                "--continue",
                f"--dir={dest}",
                f"--input-file={session}",
                f"--save-session={session}",
                "--save-session-interval=30",
                f"--log={log_file}",
                "--log-level=notice",
            ]
            if secret:
                cmd.append(f"--rpc-secret={secret}")

            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                with open(log_file, "a", encoding="utf-8") as logfh:
                    logfh.write(f"\n--- copanel start {stamp} ---\n")
                    logfh.write("cmd: " + " ".join(cmd) + "\n")
                    logfh.flush()
            except OSError:
                pass

            try:
                _aria2_proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                    close_fds=True,
                )
                try:
                    pid_file.write_text(str(_aria2_proc.pid), encoding="utf-8")
                except OSError:
                    pass
            except OSError as exc:
                try:
                    with open(log_file, "a", encoding="utf-8") as logfh:
                        logfh.write(f"spawn failed: {exc}\n")
                except OSError:
                    pass
                return False

        for attempt in range(40):
            if _aria2_proc and _aria2_proc.poll() is not None:
                code = _aria2_proc.returncode
                _aria2_proc = None
                try:
                    with open(log_file, "a", encoding="utf-8") as logfh:
                        logfh.write(f"aria2 exited early (code {code})\n")
                except OSError:
                    pass
                return False
            if engine.is_available():
                return True
            time.sleep(0.25)

        if _port_is_open(host, port) and not engine.is_available():
            try:
                with open(log_file, "a", encoding="utf-8") as logfh:
                    logfh.write("port open but RPC auth/handshake failed — check RPC secret in Settings\n")
            except OSError:
                pass
    return engine.is_available()


def map_aria2_status(status: str) -> str:
    mapping = {
        "active": "downloading",
        "waiting": "queued",
        "paused": "paused",
        "complete": "completed",
        "error": "error",
        "removed": "stopped",
    }
    return mapping.get(status, "downloading")


def parse_aria2_progress(info: Dict[str, Any]) -> Dict[str, Any]:
    total = int(info.get("totalLength") or 0)
    done = int(info.get("completedLength") or 0)
    dl = int(info.get("downloadSpeed") or 0)
    ul = int(info.get("uploadSpeed") or 0)
    prog = (done / total * 100) if total else 0.0
    files = info.get("files") or []
    name = ""
    if files:
        path = (files[0] or {}).get("path") or ""
        name = Path(path).name
    return {
        "total_bytes": total,
        "downloaded_bytes": done,
        "download_speed": dl,
        "upload_speed": ul,
        "progress": round(prog, 1),
        "name": name,
        "status": map_aria2_status(info.get("status") or ""),
        "error_message": info.get("errorMessage") or "",
    }
