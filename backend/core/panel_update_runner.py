"""Detached panel updater (stdlib only).

Started by ``core.panel_update.launch_update`` in its own systemd transient
unit (``systemd-run --unit=copanel-update``), so stopping or restarting
``copanel.service`` during the install does not kill it.

Steps:
1. Find the latest GitHub release, download its manifest
   (``copanel-release.json``) and signature, and verify the signature with
   ``ssh-keygen -Y verify`` against the release key that ships with the
   *installed* panel (``scripts/release/allowed_signers``). The manifest
   names the tag and the exact commit.
2. Fetch that tag, check it resolves to the signed commit, and stage
   ``scripts/install.sh`` from that commit into the state dir. Running a copy
   outside the panel tree means ``install.sh`` takes its git-update path and
   that ``git reset`` cannot rewrite the script while bash is reading it.
3. Run it with ``COPANEL_GIT_REF``/``COPANEL_EXPECT_COMMIT`` so it checks out
   exactly that commit, with output in ``update.log``.
4. Record the exit code in ``state.json``.

Any verification failure stops the update before anything is changed
(fail closed); the running panel keeps working.

Everything goes to files, so the panel can report progress again after the
backend restarts.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

STATE_FILE = "state.json"
LOG_FILE = "update.log"
STAGED_SCRIPT = "install.sh"
LOCK_FILE = "lock"
EXIT_MARKER = "__COPANEL_EXIT__"


def read_state(state_dir: Path) -> dict:
    try:
        data = json.loads((state_dir / STATE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state_dir: Path, **fields) -> dict:
    state = read_state(state_dir)
    state.update(fields)
    tmp = state_dir / (STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, state_dir / STATE_FILE)
    return state


def replace_state(state_dir: Path, state: dict) -> None:
    tmp = state_dir / (STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(state or {}), encoding="utf-8")
    os.replace(tmp, state_dir / STATE_FILE)


@contextlib.contextmanager
def update_lock(state_dir: Path, *, blocking: bool):
    """Exclusive flock on ``<state>/lock``; yields True when held."""
    import fcntl

    fd = os.open(str(state_dir / LOCK_FILE), os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _git(home: Path, *args: str, log, capture: bool = False, timeout: int = 300):
    return subprocess.run(
        ["git", "-c", f"safe.directory={home}", "-C", str(home), *args],
        stdout=subprocess.PIPE if capture else log,
        stderr=log,
        timeout=timeout,
        check=False,
    )


RELEASE_REPO = "phuspeed/CoPanel"
RELEASES_LATEST_API = f"https://api.github.com/repos/{RELEASE_REPO}/releases/latest"
RELEASE_DOWNLOAD = f"https://github.com/{RELEASE_REPO}/releases/download/{{tag}}/{{name}}"
MANIFEST_NAME = "copanel-release.json"
SIGNATURE_NAME = "copanel-release.json.sig"
SIGNERS_REL_PATH = Path("scripts") / "release" / "allowed_signers"
SIGNER_IDENTITY = "copanel-release"
SIGNATURE_NAMESPACE = "copanel-release"
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_MAX_META_BYTES = 256 * 1024


class ReleaseVerificationError(RuntimeError):
    """The release could not be verified; nothing was changed."""


class _HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise ReleaseVerificationError("release download redirected to a non-https URL")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _http_get(url: str, *, accept: str = "*/*", timeout: int = 30) -> bytes:
    opener = urllib.request.build_opener(_HttpsOnly())
    req = urllib.request.Request(url, headers={"User-Agent": "CoPanel-Updater", "Accept": accept})
    with opener.open(req, timeout=timeout) as resp:
        data = resp.read(_MAX_META_BYTES + 1)
    if len(data) > _MAX_META_BYTES:
        raise ReleaseVerificationError(f"response from {url} is too large")
    return data


def latest_release_tag() -> str:
    try:
        data = json.loads(_http_get(RELEASES_LATEST_API, accept="application/vnd.github+json"))
    except ReleaseVerificationError:
        raise
    except Exception as exc:
        raise ReleaseVerificationError(f"could not read the latest release from GitHub: {exc}") from exc
    tag = str(data.get("tag_name") or "") if isinstance(data, dict) else ""
    if not TAG_RE.match(tag):
        raise ReleaseVerificationError(f"latest release tag {tag!r} is not a version tag")
    return tag


def verify_manifest(manifest: bytes, signature: bytes, signers: Path) -> None:
    """Raise unless ``signature`` is a valid release-key signature of ``manifest``."""
    keygen = shutil.which("ssh-keygen")
    if not keygen:
        raise ReleaseVerificationError("ssh-keygen is not installed (apt-get install openssh-client)")
    if not signers.is_file():
        raise ReleaseVerificationError(f"release key file {signers} is missing")
    with tempfile.TemporaryDirectory(prefix="copanel-verify-") as tmp:
        sig_path = Path(tmp) / "manifest.sig"
        sig_path.write_bytes(signature)
        res = subprocess.run(
            [keygen, "-Y", "verify", "-f", str(signers), "-I", SIGNER_IDENTITY,
             "-n", SIGNATURE_NAMESPACE, "-s", str(sig_path)],
            input=manifest,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
        )
    if res.returncode != 0:
        detail = (res.stderr or res.stdout or b"").decode("utf-8", "replace").strip()[-300:]
        raise ReleaseVerificationError(f"release signature is not valid ({detail or 'ssh-keygen failed'})")


def parse_manifest(manifest: bytes, tag: str) -> dict:
    try:
        data = json.loads(manifest)
    except ValueError as exc:
        raise ReleaseVerificationError("release manifest is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ReleaseVerificationError("release manifest is not an object")
    if data.get("repo") != RELEASE_REPO or data.get("tag") != tag:
        raise ReleaseVerificationError("release manifest does not belong to this release")
    if str(data.get("version")) != tag[1:]:
        raise ReleaseVerificationError("release manifest version does not match the tag")
    if not COMMIT_RE.match(str(data.get("commit") or "")):
        raise ReleaseVerificationError("release manifest has no valid commit id")
    return data


def resolve_signed_release(home: Path, log) -> dict:
    tag = latest_release_tag()
    log.write(f"[copanel-update] Latest release: {tag}\n".encode())
    try:
        manifest = _http_get(RELEASE_DOWNLOAD.format(tag=tag, name=MANIFEST_NAME))
        signature = _http_get(RELEASE_DOWNLOAD.format(tag=tag, name=SIGNATURE_NAME))
    except ReleaseVerificationError:
        raise
    except Exception as exc:
        raise ReleaseVerificationError(f"could not download the signed manifest for {tag}: {exc}") from exc
    verify_manifest(manifest, signature, home / SIGNERS_REL_PATH)
    data = parse_manifest(manifest, tag)
    log.write(f"[copanel-update] Release signature verified: {tag} -> {data['commit']}\n".encode())
    return data


def stage_install_script(home: Path, state_dir: Path, log) -> tuple:
    """Verify the latest release and stage its install.sh.

    Returns ``(script_path, tag, commit)``. Raises ReleaseVerificationError
    (nothing changed) when the release cannot be verified.
    """
    if not (home / ".git").exists() or not shutil.which("git"):
        raise ReleaseVerificationError(f"{home} is not a git checkout; update with the install one-liner instead")
    release = resolve_signed_release(home, log)
    tag, commit = release["tag"], release["commit"]
    fetched = _git(home, "fetch", "--depth", "1", "--force", "origin", f"+refs/tags/{tag}:refs/tags/{tag}", log=log)
    if fetched.returncode != 0:
        raise ReleaseVerificationError(f"git fetch of {tag} failed")
    resolved = _git(home, "rev-parse", f"refs/tags/{tag}^{{commit}}", log=log, capture=True, timeout=60)
    got = (resolved.stdout or b"").decode().strip()
    if resolved.returncode != 0 or got != commit:
        raise ReleaseVerificationError(f"tag {tag} points to {got or 'nothing'}, not the signed commit {commit}")
    shown = _git(home, "show", f"{commit}:scripts/install.sh", log=log, capture=True, timeout=60)
    if shown.returncode != 0 or not shown.stdout:
        raise ReleaseVerificationError(f"scripts/install.sh not found in {commit}")
    staged = state_dir / STAGED_SCRIPT
    staged.write_bytes(shown.stdout)
    staged.chmod(0o700)
    log.write(f"[copanel-update] Using install.sh from {tag} ({commit[:12]}).\n".encode())
    return staged, tag, commit


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--home", required=True)
    args = parser.parse_args(argv)
    state_dir = Path(args.state_dir)
    home = Path(args.home)
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Same lock as the launcher: waits for the launch to finish, then keeps
    # any second update out until this install is done.
    with update_lock(state_dir, blocking=True):
        return _run_locked(state_dir, home)


def _run_locked(state_dir: Path, home: Path) -> int:
    write_state(state_dir, status="running", pid=os.getpid(), runner_started_at=time.time())

    rc = -1
    # A new run starts a fresh log (only once the lock is held).
    with open(state_dir / LOG_FILE, "wb", buffering=0) as log:
        try:
            script, tag, commit = stage_install_script(home, state_dir, log)
            env = {
                k: v for k, v in os.environ.items()
                if k not in ("COPANEL_ENV", "COPANEL_GIT_BRANCH", "COPANEL_GIT_REMOTE")
            }
            env["COPANEL_NONINTERACTIVE"] = "1"
            env["COPANEL_HOME"] = str(home)
            env["COPANEL_GIT_REF"] = tag
            env["COPANEL_EXPECT_COMMIT"] = commit
            rc = subprocess.run(
                ["/bin/bash", str(script)],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                cwd=str(state_dir),
                env=env,
                check=False,
            ).returncode
        except ReleaseVerificationError as exc:
            log.write(
                f"\n[copanel-update] Update stopped: {exc}. Nothing was changed; the panel keeps running "
                "the current version.\n".encode()
            )
            rc = -1
        except Exception as exc:  # report, never leave the state at "running"
            log.write(f"\n[copanel-update] updater error: {exc}\n".encode())
            rc = -1
        log.write(f"\n{EXIT_MARKER}:{rc}\n".encode())
    write_state(
        state_dir,
        status="success" if rc == 0 else "failed",
        exit_code=rc,
        finished_at=time.time(),
    )
    return 0 if rc == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
