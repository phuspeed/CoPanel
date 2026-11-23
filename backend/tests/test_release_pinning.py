"""1.1.15: Panel Update installs only the latest *signed* release (review
item: updater followed the tip of main without verification)."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from core import panel_update as pu
from core import panel_update_runner as runner

REPO_ROOT = Path(__file__).resolve().parents[2]
needs_tools = pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("git")), reason="ssh-keygen/git missing")


def _keypair(tmp_path, name="k"):
    key = tmp_path / name
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    pub = (tmp_path / f"{name}.pub").read_text().split()
    signers = tmp_path / f"{name}.signers"
    signers.write_text(f'copanel-release namespaces="copanel-release" {pub[0]} {pub[1]}\n')
    return key, signers


def _sign(key, data: bytes, tmp_path) -> bytes:
    f = tmp_path / "m.json"
    f.write_bytes(data)
    sig = tmp_path / "m.json.sig"
    sig.unlink(missing_ok=True)
    subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", str(key), "-n", "copanel-release", str(f)], check=True)
    return sig.read_bytes()


def _manifest(tag="v1.2.3", commit="a" * 40, **kw):
    d = {"repo": "phuspeed/CoPanel", "tag": tag, "version": tag[1:], "commit": commit}
    d.update(kw)
    return json.dumps(d).encode()


def test_committed_key_matches_install_sh():
    signers = (REPO_ROOT / "scripts" / "release" / "allowed_signers").read_text().split()
    assert signers[0] == "copanel-release" and signers[1] == 'namespaces="copanel-release"'
    script = (REPO_ROOT / "scripts" / "install.sh").read_text()
    m = re.search(r'^COPANEL_RELEASE_PUBKEY="([^"]+)"', script, re.M)
    assert m and m.group(1) == f"{signers[2]} {signers[3]}"


@needs_tools
def test_verify_manifest_accepts_good_and_rejects_bad(tmp_path):
    key, signers = _keypair(tmp_path)
    other, _ = _keypair(tmp_path, "other")
    data = _manifest()
    runner.verify_manifest(data, _sign(key, data, tmp_path), signers)
    with pytest.raises(runner.ReleaseVerificationError):
        runner.verify_manifest(data, _sign(other, data, tmp_path), signers)
    with pytest.raises(runner.ReleaseVerificationError):
        runner.verify_manifest(_manifest(commit="b" * 40), _sign(key, data, tmp_path), signers)
    with pytest.raises(runner.ReleaseVerificationError):
        runner.verify_manifest(data, b"garbage", signers)
    with pytest.raises(runner.ReleaseVerificationError):
        runner.verify_manifest(data, _sign(key, data, tmp_path), tmp_path / "missing")


def test_verify_manifest_fails_closed_without_ssh_keygen(tmp_path, monkeypatch):
    monkeypatch.setattr(runner.shutil, "which", lambda _n: None)
    with pytest.raises(runner.ReleaseVerificationError, match="ssh-keygen"):
        runner.verify_manifest(b"{}", b"", tmp_path / "s")


@pytest.mark.parametrize(
    "data",
    [_manifest(repo="evil/CoPanel"), _manifest(tag="v9.9.9"), _manifest(version="1.2.4"), _manifest(commit="xyz"), b"[]", b"nope"],
)
def test_parse_manifest_rejects_mismatch(data):
    with pytest.raises(runner.ReleaseVerificationError):
        runner.parse_manifest(data, "v1.2.3")


def test_latest_tag_must_be_version(monkeypatch):
    monkeypatch.setattr(runner, "_http_get", lambda url, **kw: json.dumps({"tag_name": "main"}).encode())
    with pytest.raises(runner.ReleaseVerificationError):
        runner.latest_release_tag()
    monkeypatch.setattr(runner, "_http_get", lambda url, **kw: json.dumps({"tag_name": "v1.1.15"}).encode())
    assert runner.latest_release_tag() == "v1.1.15"


def _git(*args, cwd):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path):
    origin = tmp_path / "origin"
    origin.mkdir()
    _git("init", "-q", "-b", "main", cwd=origin)
    (origin / "scripts" / "release").mkdir(parents=True)
    (origin / "scripts" / "install.sh").write_text("echo release-install\n")
    (origin / "VERSION").write_text("1.2.3\n")
    _git("add", "-A", cwd=origin)
    _git("commit", "-qm", "r", cwd=origin)
    _git("tag", "-a", "v1.2.3", "-m", "r", cwd=origin)
    good = _git("rev-parse", "HEAD", cwd=origin)
    (origin / "scripts" / "install.sh").write_text("echo EVIL-main\n")
    _git("commit", "-qam", "evil", cwd=origin)
    evil = _git("rev-parse", "HEAD", cwd=origin)
    home = tmp_path / "home"
    subprocess.run(["git", "clone", "-q", "--depth", "1", "-b", "main", origin.as_uri(), str(home)], check=True)
    key, signers = _keypair(tmp_path)
    (home / "scripts" / "release" / "allowed_signers").parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(signers, home / "scripts" / "release" / "allowed_signers")
    state = tmp_path / "state"
    state.mkdir()
    return {"origin": origin, "home": home, "key": key, "good": good, "evil": evil, "state": state, "tmp": tmp_path}


def _serve(monkeypatch, r, manifest, sig, tag="v1.2.3"):
    def fake_get(url, **_kw):
        if url == runner.RELEASES_LATEST_API:
            return json.dumps({"tag_name": tag}).encode()
        if url.endswith("/copanel-release.json"):
            return manifest
        if url.endswith("/copanel-release.json.sig"):
            return sig
        raise AssertionError(url)

    monkeypatch.setattr(runner, "_http_get", fake_get)


@needs_tools
def test_stage_uses_signed_tag_not_main(repos, monkeypatch):
    r = repos
    m = _manifest(commit=r["good"])
    _serve(monkeypatch, r, m, _sign(r["key"], m, r["tmp"]))
    with open(r["tmp"] / "log", "wb") as log:
        script, tag, commit = runner.stage_install_script(r["home"], r["state"], log)
    assert (tag, commit) == ("v1.2.3", r["good"])
    assert script.read_text() == "echo release-install\n"


@needs_tools
def test_stage_refuses_manifest_pointing_elsewhere(repos, monkeypatch):
    r = repos
    m = _manifest(commit=r["evil"])  # signed, but the tag is not at this commit
    _serve(monkeypatch, r, m, _sign(r["key"], m, r["tmp"]))
    with pytest.raises(runner.ReleaseVerificationError, match="not the signed commit"):
        with open(r["tmp"] / "log", "wb") as log:
            runner.stage_install_script(r["home"], r["state"], log)
    assert not (r["state"] / "install.sh").exists()


@needs_tools
def test_runner_fails_closed_on_bad_signature(repos, monkeypatch):
    r = repos
    other, _ = _keypair(r["tmp"], "attacker")
    m = _manifest(commit=r["good"])
    _serve(monkeypatch, r, m, _sign(other, m, r["tmp"]))
    ran = []
    real_run = subprocess.run

    def spy(cmd, **kw):
        if cmd and cmd[0] == "/bin/bash":
            ran.append(cmd)
        return real_run(cmd, **kw)

    monkeypatch.setattr(runner.subprocess, "run", spy)
    assert runner.main(["--state-dir", str(r["state"]), "--home", str(r["home"])]) == 1
    assert ran == []
    state = json.loads((r["state"] / "state.json").read_text())
    assert state["status"] == "failed"
    assert "Nothing was changed" in (r["state"] / "update.log").read_text()


@needs_tools
def test_runner_passes_pinned_ref_to_install(repos, monkeypatch):
    r = repos
    m = _manifest(commit=r["good"])
    _serve(monkeypatch, r, m, _sign(r["key"], m, r["tmp"]))
    seen = {}
    real_run = subprocess.run

    def spy(cmd, **kw):
        if cmd and cmd[0] == "/bin/bash":
            seen["env"] = kw["env"]
        return real_run(cmd, **kw)

    monkeypatch.setenv("COPANEL_GIT_BRANCH", "evil-branch")
    monkeypatch.setattr(runner.subprocess, "run", spy)
    assert runner.main(["--state-dir", str(r["state"]), "--home", str(r["home"])]) == 0
    assert seen["env"]["COPANEL_GIT_REF"] == "v1.2.3"
    assert seen["env"]["COPANEL_EXPECT_COMMIT"] == r["good"]
    assert "COPANEL_GIT_BRANCH" not in seen["env"]
    assert "release-install" in (r["state"] / "update.log").read_text()


def test_check_for_update_uses_latest_release(monkeypatch):
    pu._CACHE.clear()
    monkeypatch.setattr(pu, "_http_get_json", lambda url, **kw: {"tag_name": "v9.8.7"} if url == pu.RELEASES_LATEST_API else {})
    assert pu._fetch_remote_version() == ("9.8.7", None, None)

    def down(url, **kw):
        raise OSError("down")

    monkeypatch.setattr(pu, "_http_get_json", down)
    monkeypatch.setattr(pu, "_latest_release_tag_from_redirect", lambda: "v9.8.8")
    assert pu._fetch_remote_version() == ("9.8.8", None, None)


def test_install_sh_release_pinning_present():
    s = (REPO_ROOT / "scripts" / "install.sh").read_text()
    assert "copanel_resolve_release_ref" in s and "copanel_check_expected_commit" in s
    assert 'git checkout -f --detach "refs/tags/${COPANEL_GIT_REF}"' in s
    # A bad signature never falls back to main.
    block = s[s.index("copanel_resolve_release_ref() {"):s.index("copanel_check_expected_commit() {")]
    assert "is NOT valid. Refusing to install it." in block
    assert block.index("is NOT valid") < block.index("exit 1", block.index("is NOT valid") - 200) + 200
