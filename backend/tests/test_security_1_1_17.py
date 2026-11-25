"""1.1.17: nginx must be able to read htpasswd files without opening other secrets."""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path
from unittest.mock import patch

from core import nginx_htpasswd as ht
from modules.panel_settings import logic as panel_logic
from modules.web_manager import logic as wm_logic

INSTALL_SH = Path(__file__).resolve().parents[2] / "scripts" / "install.sh"


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_detect_nginx_user_reads_uncommented_directive(tmp_path, monkeypatch):
    conf = tmp_path / "nginx.conf"
    conf.write_text(
        "# user nobody;\n"
        "worker_processes auto;\n"
        "user www-data;\n",
        encoding="utf-8",
    )
    assert ht.detect_nginx_user(conf) == "www-data"

    conf.write_text("user nginx nginx;\n", encoding="utf-8")
    monkeypatch.setattr(ht, "_user_exists", lambda name: name == "nginx")
    assert ht.detect_nginx_user(conf) == "nginx"


def test_detect_nginx_user_falls_back_when_conf_user_missing(tmp_path, monkeypatch):
    conf = tmp_path / "nginx.conf"
    conf.write_text("user nosuchnginxuser;\n", encoding="utf-8")
    monkeypatch.setattr(ht, "_user_exists", lambda name: name in {"www-data", "nginx"})
    # Conf user does not exist; fallback order is www-data then nginx.
    assert ht.detect_nginx_user(conf) == "www-data"


def test_secure_htpasswd_file_sets_0640_and_chowns(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    path = cfg / "panel_access.htpasswd"
    path.write_text("copanel:$apr1$xxxx\n", encoding="utf-8")
    path.chmod(0o600)
    cfg.chmod(0o700)

    chowned = []
    monkeypatch.setattr(ht, "detect_nginx_user", lambda nginx_conf=None: "www-data")
    monkeypatch.setattr(
        ht.shutil,
        "chown",
        lambda p, user=None, group=None: chowned.append((str(p), user, group)),
    )

    ht.secure_htpasswd_file(path)
    assert _mode(path) == 0o640
    assert _mode(cfg) == 0o711
    assert chowned == [(str(path), "root", "www-data")]

    # Non-htpasswd paths are left alone.
    secret = cfg / "jwt_secret"
    secret.write_text("keep-me\n", encoding="utf-8")
    secret.chmod(0o600)
    ht.secure_htpasswd_file(secret)
    assert _mode(secret) == 0o600
    assert len(chowned) == 1


def test_repair_nginx_htpasswd_permissions_leaves_secrets_private(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    ssl = cfg / "ssl"
    web_auth = cfg / "web_auth"
    ssl.mkdir(parents=True)
    web_auth.mkdir()
    (cfg / "jwt_secret").write_text("supersecret\n", encoding="utf-8")
    (cfg / "copanel.db").write_text("", encoding="utf-8")
    (cfg / "panel_settings.json").write_text("{}\n", encoding="utf-8")
    (ssl / "panel.key").write_text("-----KEY-----\n", encoding="utf-8")
    panel_ht = cfg / "panel_access.htpasswd"
    panel_ht.write_text("admin:hash\n", encoding="utf-8")
    site_ht = web_auth / "example.com.htpasswd"
    site_ht.write_text("user:hash\n", encoding="utf-8")
    site_json = web_auth / "example.com.json"
    site_json.write_text('{"enabled": true}\n', encoding="utf-8")
    # Simulate a 1.1.16 lock-down.
    for path in (cfg, ssl, web_auth):
        path.chmod(0o700)
    for path in (cfg / "jwt_secret", cfg / "copanel.db", cfg / "panel_settings.json", ssl / "panel.key", panel_ht, site_ht, site_json):
        path.chmod(0o600)

    monkeypatch.setattr(ht, "detect_nginx_user", lambda nginx_conf=None: "www-data")
    monkeypatch.setattr(ht.shutil, "chown", lambda *a, **k: None)

    ht.repair_nginx_htpasswd_permissions(cfg)

    assert _mode(cfg) == 0o711
    assert _mode(web_auth) == 0o711
    assert _mode(ssl) == 0o700
    assert _mode(panel_ht) == 0o640
    assert _mode(site_ht) == 0o640
    assert _mode(cfg / "jwt_secret") == 0o600
    assert _mode(cfg / "copanel.db") == 0o600
    assert _mode(cfg / "panel_settings.json") == 0o600
    assert _mode(ssl / "panel.key") == 0o600
    assert _mode(site_json) == 0o600


def test_write_htpasswd_text_creates_dirs_and_sets_mode(tmp_path, monkeypatch):
    path = tmp_path / "config" / "web_auth" / "site.htpasswd"
    monkeypatch.setattr(ht, "detect_nginx_user", lambda nginx_conf=None: None)
    ht.write_htpasswd_text(path, "alice:hash\n")
    assert path.read_text(encoding="utf-8") == "alice:hash\n"
    assert _mode(path) == 0o640
    assert _mode(path.parent) == 0o711
    assert _mode(path.parent.parent) == 0o711


def test_panel_settings_writer_sets_htpasswd_mode(tmp_path, monkeypatch):
    path = tmp_path / "panel_access.htpasswd"
    monkeypatch.setattr(panel_logic, "HTPASSWD_PATH", path)
    monkeypatch.setattr(panel_logic, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(ht, "detect_nginx_user", lambda nginx_conf=None: "www-data")
    monkeypatch.setattr(ht.shutil, "chown", lambda *a, **k: None)
    out = panel_logic._write_nginx_htpasswd("copanel", "test-pass")
    assert Path(out) == path
    assert path.is_file()
    assert path.read_text(encoding="utf-8").startswith("copanel:$apr1$")
    assert _mode(path) == 0o640
    assert _mode(tmp_path) == 0o711


def test_web_manager_writer_sets_htpasswd_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("COPANEL_TEST_CONFIG_DIR", str(tmp_path))
    monkeypatch.setattr(ht, "detect_nginx_user", lambda nginx_conf=None: "www-data")
    monkeypatch.setattr(ht.shutil, "chown", lambda *a, **k: None)
    out = wm_logic.write_site_htpasswd("example.com", "alice", "secret")
    path = Path(out)
    assert path.name == "example.com.htpasswd"
    assert path.parent.name == "web_auth"
    assert _mode(path) == 0o640
    assert _mode(path.parent) == 0o711
    assert _mode(tmp_path) == 0o711
    wm_logic.save_site_auth_meta("example.com", "alice", enabled=True)
    meta = path.with_suffix(".json")
    assert meta.is_file()
    assert _mode(meta) == 0o600


def test_harden_install_exposes_htpasswd_but_keeps_secrets(tmp_path):
    home = tmp_path / "copanel"
    for sub in ("backend/data", "venv/bin", "scripts", "frontend/dist", "config/ssl", "config/web_auth", "backups", "logs", "stacks", ".git"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    (home / "backend" / "main.py").write_text("app = None\n", encoding="utf-8")
    secret = home / "config" / "jwt_secret"
    secret.write_text("supersecret\n", encoding="utf-8")
    secret.chmod(0o644)
    db_file = home / "config" / "copanel.db"
    db_file.write_text("", encoding="utf-8")
    db_file.chmod(0o644)
    settings = home / "config" / "panel_settings.json"
    settings.write_text("{}\n", encoding="utf-8")
    settings.chmod(0o644)
    key = home / "config" / "ssl" / "panel.key"
    key.write_text("-----KEY-----\n", encoding="utf-8")
    key.chmod(0o644)
    panel_ht = home / "config" / "panel_access.htpasswd"
    panel_ht.write_text("admin:hash\n", encoding="utf-8")
    panel_ht.chmod(0o600)
    site_ht = home / "config" / "web_auth" / "example.com.htpasswd"
    site_ht.write_text("user:hash\n", encoding="utf-8")
    site_ht.chmod(0o600)
    site_json = home / "config" / "web_auth" / "example.com.json"
    site_json.write_text('{"enabled": true, "username": "user"}\n', encoding="utf-8")
    site_json.chmod(0o644)
    (home / "config").chmod(0o700)
    (home / "config" / "web_auth").chmod(0o700)
    (home / "config" / "ssl").chmod(0o700)

    bindir = tmp_path / "bin"
    bindir.mkdir()
    chown_log = tmp_path / "chown.log"
    (bindir / "chown").write_text(
        f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {str(chown_log)!r}\nexit 0\n",
        encoding="utf-8",
    )
    (bindir / "chown").chmod(0o755)

    fake_conf = tmp_path / "nginx.conf"
    fake_conf.write_text("user www-data;\n", encoding="utf-8")

    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ.get('PATH', '')}",
        "CoPanel_HOME": str(home),
        "COPANEL_TEST_NGINX_CONF": str(fake_conf),
    }
    cmd = f'source "{INSTALL_SH}" && CoPanel_HOME="{home}" && copanel_harden_install_permissions'
    res = subprocess.run(["bash", "-c", cmd], env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr

    assert _mode(home / "config") == 0o711
    assert _mode(home / "config" / "web_auth") == 0o711
    assert _mode(home / "config" / "ssl") == 0o700
    assert _mode(secret) == 0o600
    assert _mode(db_file) == 0o600
    assert _mode(settings) == 0o600
    assert _mode(key) == 0o600
    assert _mode(site_json) == 0o600
    assert _mode(panel_ht) == 0o640
    assert _mode(site_ht) == 0o640
    logged = chown_log.read_text(encoding="utf-8")
    assert "root:www-data" in logged
    assert str(panel_ht) in logged
    assert str(site_ht) in logged
    # Secrets must not be handed to the nginx group.
    for secret_path in (secret, db_file, settings, key, site_json):
        assert f"root:www-data {secret_path}" not in logged


def test_install_sh_detects_nginx_user_from_conf(tmp_path):
    conf = tmp_path / "nginx.conf"
    conf.write_text("# user nobody;\nuser www-data www-data;\n", encoding="utf-8")
    env = {**os.environ, "COPANEL_TEST_NGINX_CONF": str(conf)}
    cmd = f'source "{INSTALL_SH}" && copanel_nginx_user'
    res = subprocess.run(["bash", "-c", cmd], env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert res.stdout.strip() == "www-data"
