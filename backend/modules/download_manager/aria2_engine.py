"""aria2 JSON-RPC client for BitTorrent and HTTP downloads."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_aria2_start_lock = threading.Lock()
_last_aria2_start_attempt = 0.0
_ARIA2_START_COOLDOWN_SEC = 10.0


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


def ensure_aria2_daemon(
    *,
    config_dir: Path,
    host: str,
    port: int,
    secret: str,
    download_dir: str,
) -> bool:
    """Start local aria2c with RPC when unreachable. Returns True if RPC responds."""
    global _last_aria2_start_attempt

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
            return False
        _last_aria2_start_attempt = now

        bin_path = _resolve_aria2_bin()
        if not bin_path:
            return False

        config_dir.mkdir(parents=True, exist_ok=True)
        session = config_dir / "aria2.session"
        log_file = config_dir / "aria2.log"
        dest = Path(download_dir or ".")
        dest.mkdir(parents=True, exist_ok=True)

        cmd = [
            bin_path,
            "--enable-rpc",
            f"--rpc-listen-port={int(port or 6800)}",
            "--rpc-listen-all=false",
            "--rpc-allow-origin-all=true",
            "--continue=true",
            f"--dir={dest}",
            f"--input-file={session}",
            f"--save-session={session}",
            "--save-session-interval=30",
            "--daemon=true",
            "--quiet=true",
        ]
        if secret:
            cmd.append(f"--rpc-secret={secret}")

        try:
            with open(log_file, "a", encoding="utf-8") as logfh:
                subprocess.run(
                    cmd,
                    stdout=logfh,
                    stderr=subprocess.STDOUT,
                    timeout=15,
                    check=False,
                )
        except Exception:
            return False

        for _ in range(15):
            time.sleep(0.2)
            if engine.is_available():
                return True
    return False


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
