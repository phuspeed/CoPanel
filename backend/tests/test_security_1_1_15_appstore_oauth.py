"""1.1.15 security regressions: OAuth popup XSS and AppStore install integrity
(baseline Highs), plus no shell pipelines for database dumps."""
import hashlib
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
from core import oauth_popup
from core.api import install_exception_handlers
from modules.appstore_manager import logic as store

OFFICIAL = "https://raw.githubusercontent.com/phuspeed/CoPanel-Appstore/main/packages/"


# ── OAuth popup callback (public page) ─────────────────────────────────────


XSS = "</script><script>alert(document.domain)</script><img src=x onerror=alert(1)>"


def test_oauth_page_never_reflects_markup():
    resp = oauth_popup.oauth_result_page({"type": "t", "ok": False, "error": XSS}, "Authorization failed.")
    body = resp.body.decode()
    assert "</script><script>" not in body
    assert "<img" not in body and "onerror=alert(1)>" not in body
    assert body.count("<script") == 1
    csp = resp.headers["content-security-policy"]
    assert "script-src 'nonce-" in csp and "default-src 'none'" in csp
    assert resp.headers["cache-control"] == "no-store"
    assert "window.location.origin" in body and "'*'" not in body and '"*"' not in body


def test_safe_error_code():
    assert oauth_popup.safe_error_code("access_denied") == "access_denied"
    assert oauth_popup.safe_error_code(XSS) == "oauth_error"
    assert oauth_popup.safe_error_code("") == "oauth_error"


def test_backup_oauth_callback_endpoint_is_escaped(monkeypatch):
    try:
        from modules.backup_manager import router as br
    except OSError:
        pytest.skip("backup_manager needs /opt/copanel/config (checked again in the VM retest)")

    app = FastAPI()
    app.include_router(br.router, prefix="/api/backup_manager")
    client = TestClient(app)
    r = client.get("/api/backup_manager/oauth/google/callback", params={"error": XSS})
    assert r.status_code in (200, 400)
    assert "</script><script>" not in r.text and "<img" not in r.text
    assert "nonce-" in r.headers["content-security-policy"]

    def boom(**_kw):
        raise RuntimeError(XSS)

    monkeypatch.setattr(br.GoogleOAuthService, "exchange_code", staticmethod(boom))
    r = client.get("/api/backup_manager/oauth/google/callback", params={"code": "c", "state": "s"})
    assert r.status_code == 500
    assert "</script><script>" not in r.text and "<img" not in r.text and "alert" not in r.text

    monkeypatch.setattr(br.GoogleOAuthService, "exchange_code", staticmethod(lambda **_k: {"remote_name": XSS}))
    r = client.get("/api/backup_manager/oauth/google/callback", params={"code": "c", "state": "s"})
    assert r.status_code == 200
    assert "</script><script>" not in r.text and "<img" not in r.text


# ── AppStore: catalog resolution and integrity ─────────────────────────────


def _entry(**kw):
    e = {"id": "speedtest", "version": "1.0.2", "download_url": OFFICIAL + "speedtest.v1.0.2.zip", "sha256": "c" * 64}
    e.update(kw)
    return e


def test_resolve_requires_sha256():
    with pytest.raises(store.PackageIntegrityError, match="SHA-256"):
        store.resolve_catalog_package("speedtest", [_entry(sha256="")])
    with pytest.raises(store.PackageIntegrityError):
        store.resolve_catalog_package("speedtest", [_entry(sha256="zz")])
    assert store.resolve_catalog_package("speedtest", [_entry()])["sha256"] == "c" * 64


@pytest.mark.parametrize(
    "url",
    [
        "http://raw.githubusercontent.com/phuspeed/CoPanel-Appstore/main/packages/x.zip",
        "https://evil.example/x.zip",
        "https://raw.githubusercontent.com/attacker/CoPanel-Appstore/main/x.zip",
        "https://raw.githubusercontent.com/phuspeed/CoPanel-Appstore/../../attacker/x.zip",
        "file:///etc/passwd",
        "https://user:pw@raw.githubusercontent.com/phuspeed/CoPanel-Appstore/main/x.zip",
    ],
)
def test_official_packages_must_come_from_official_repo(url):
    with pytest.raises(store.PackageIntegrityError):
        store.resolve_catalog_package("speedtest", [_entry(download_url=url)])


@pytest.mark.parametrize("url", ["https://127.0.0.1/x.zip", "https://localhost/x.zip", "http://example.com/x.zip"])
def test_community_urls_restricted(url):
    with pytest.raises(store.PackageIntegrityError):
        store.resolve_catalog_package("speedtest", [_entry(download_url=url, is_community=True)])


def test_unknown_or_invalid_ids_rejected():
    with pytest.raises(store.PackageIntegrityError):
        store.resolve_catalog_package("nothere", [_entry()])
    for bad in ("../etc", "Speedtest", "a b", "", None, "x" * 80):
        with pytest.raises(store.PackageIntegrityError):
            store.validate_pkg_id(bad)


@pytest.mark.parametrize(
    "deps",
    [{"system_packages": ["curl; rm -rf /"]}, {"system_packages": ["-o=APT::x"]}, {"pip_packages": ["--index-url=http://evil"]},
     {"pip_packages": ["pkg @ https://evil/x.whl"]}, {"pip_packages": ["a; b"]}],
)
def test_dependency_names_validated(deps):
    with pytest.raises(store.PackageIntegrityError):
        store.resolve_catalog_package("speedtest", [_entry(**deps)])


def test_valid_dependency_names_pass():
    pkg = store.resolve_catalog_package(
        "speedtest", [_entry(system_packages=["python3-dev", "libmagic1"], pip_packages=["requests>=2.0", "psutil==5.9.8"])]
    )
    assert pkg["system_packages"] == ["python3-dev", "libmagic1"]
    assert pkg["pip_packages"] == ["requests>=2.0", "psutil==5.9.8"]


def _zip(path, extra=None):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("backend/__init__.py", "")
        zf.writestr("backend/router.py", "router = None\n")
        for name, info_mode in (extra or []):
            zi = zipfile.ZipInfo(name)
            zi.external_attr = info_mode << 16
            zf.writestr(zi, "/etc/passwd" if info_mode & 0o170000 == 0o120000 else "x")
    return path


def test_download_rejects_checksum_mismatch(tmp_path):
    z = _zip(tmp_path / "p.zip")
    dest = tmp_path / "dl.zip"
    with pytest.raises(store.PackageIntegrityError, match="Checksum mismatch"):
        store.download_verified(z.as_uri(), "0" * 64, dest)
    assert not dest.exists()
    store.download_verified(z.as_uri(), hashlib.sha256(z.read_bytes()).hexdigest(), dest)
    assert dest.read_bytes() == z.read_bytes()


def test_tampered_package_not_installed(tmp_path, monkeypatch):
    home = tmp_path / "copanel"
    (home / "backend" / "modules").mkdir(parents=True)
    (home / "frontend" / "src" / "modules").mkdir(parents=True)
    monkeypatch.setattr(store, "get_copanel_home", lambda: home)
    z = _zip(tmp_path / "p.zip")
    store.BUILD_TASKS["demo"] = store._new_build_task()
    res = store._install_package_files(
        "demo", z.as_uri(), "1.0.0", frontend_install="none", task_key="demo",
        install_deps=False, run_frontend_build=False, sha256="1" * 64,
    )
    assert res["ok"] is False
    assert not (home / "backend" / "modules" / "demo").exists()
    assert any("Checksum mismatch" in line for line in store.BUILD_TASKS["demo"]["logs"])


@pytest.mark.parametrize(
    "extra",
    [[("../../evil.py", 0o100644)], [("/abs/evil.py", 0o100644)], [("backend/link", 0o120777)],
     [("backend/fifo", 0o010644)], [("backend/../../x", 0o100644)]],
)
def test_safe_extract_rejects_unsafe_members(tmp_path, extra):
    z = _zip(tmp_path / "p.zip", extra)
    out = tmp_path / "out"
    with pytest.raises(store.PackageIntegrityError):
        store.safe_extract_zip(z, out)
    assert not (tmp_path / "evil.py").exists()
    assert not (out / "backend" / "link").is_symlink()


def test_safe_extract_ok_and_strips_setuid(tmp_path):
    z = _zip(tmp_path / "p.zip", [("backend/run.sh", 0o104777)])
    out = tmp_path / "out"
    store.safe_extract_zip(z, out)
    assert (out / "backend" / "router.py").is_file()
    assert (out / "backend" / "run.sh").stat().st_mode & 0o7777 == 0o755


# ── AppStore router: superadmin only for code-changing actions ─────────────


@pytest.fixture
def appstore_client(monkeypatch):
    holder = {"user": {"id": 2, "username": "op", "role": "user", "permitted_modules": '["appstore_manager"]', "permitted_folders": "[]"}}
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: holder["user"])
    from modules.appstore_manager import router as sr

    calls = []
    monkeypatch.setattr(sr.AppStoreManager, "get_catalog", staticmethod(lambda: [_entry()]))
    monkeypatch.setattr(sr.AppStoreManager, "install_package", staticmethod(lambda *a, **k: calls.append((a, k)) or {"status": "started"}))
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(sr.router, prefix="/api/appstore_manager")
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"
    return client, holder, calls


@pytest.mark.parametrize(
    "method,path,kw",
    [
        ("post", "/api/appstore_manager/install", {"json": {"id": "speedtest"}}),
        ("post", "/api/appstore_manager/install-batch", {"json": {"packages": [{"id": "speedtest"}]}}),
        ("post", "/api/appstore_manager/uninstall", {"json": {"id": "speedtest"}}),
        ("post", "/api/appstore_manager/config", {"json": {"community_urls": []}}),
        ("get", "/api/appstore_manager/config", {}),
        ("post", "/api/appstore_manager/upload-install", {"files": {"file": ("x.zip", b"PK", "application/zip")}}),
        ("post", "/api/appstore_manager/upload_zip", {"files": {"file": ("x.zip", b"PK", "application/zip")}}),
    ],
)
def test_appstore_mutations_superadmin_only(appstore_client, method, path, kw):
    client, _holder, calls = appstore_client
    r = getattr(client, method)(path, **kw)
    assert r.status_code == 403, r.text
    assert calls == []


def test_install_ignores_client_supplied_url(appstore_client):
    client, holder, calls = appstore_client
    holder["user"] = {"id": 1, "username": "admin", "role": "superadmin"}
    r = client.post(
        "/api/appstore_manager/install",
        json={"id": "speedtest", "download_url": "https://evil.example/x.zip", "sha256": "d" * 64, "system_packages": ["evil"]},
    )
    assert r.status_code == 200, r.text
    (args, kwargs), = calls
    assert args[1] == OFFICIAL + "speedtest.v1.0.2.zip" and kwargs["sha256"] == "c" * 64 and args[3] == []
    r = client.post("/api/appstore_manager/install", json={"id": "not_in_catalog"})
    assert r.status_code == 400
    r = client.get("/api/appstore_manager/build-status/..%2F..%2Fetc")
    assert r.status_code in (400, 404)
    r = client.post("/api/appstore_manager/config", json={"community_urls": ["http://evil/packages.json"]})
    assert r.status_code == 400


# ── No shell pipelines ─────────────────────────────────────────────────────


def test_pipe_to_file_no_shell(tmp_path):
    from core import sysexec

    out = tmp_path / "o.gz"
    res = sysexec.pipe_to_file(["printf", "%s", "a;$(id)|b"], ["gzip", "-c"], str(out), timeout=30)
    assert res.returncode == 0
    import gzip

    assert gzip.decompress(out.read_bytes()) == b"a;$(id)|b"
    res = sysexec.pipe_to_file(["false"], ["gzip", "-c"], str(out), timeout=30)
    assert res.returncode != 0


def test_no_shell_true_in_backend():
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    hits = [
        str(p) for p in root.rglob("*.py")
        if "tests" not in p.parts and "venv" not in str(p) and re.search(r"shell\s*=\s*True", p.read_text(errors="ignore"))
    ]
    assert hits == []
