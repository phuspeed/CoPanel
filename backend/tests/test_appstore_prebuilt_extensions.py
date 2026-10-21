"""AppStore prebuilt extension bundles (no local Vite on no-AVX)."""
import json
import os
import zipfile
from pathlib import Path

import pytest

from modules.appstore_manager.logic import (
    NO_AVX_REBUILD_ERROR,
    _coerce_frontend_install_for_cpu,
    _extension_runtime_ready,
    _find_package_prebuilt_bundle_dir,
    _install_frontend_prebuilt,
    _is_prebuilt_extension_bundle_dir,
    _normalize_frontend_install,
    _prebuilt_panel_dist_ready,
    _restore_extensions_into_dist,
    _write_extensions_index,
    register_preserved_prebuilt_extensions,
)


@pytest.fixture
def panel_dist(tmp_path):
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (assets / "react-vendor.js").write_text("// react", encoding="utf-8")
    (assets / "react-dom-vendor.js").write_text("// rd", encoding="utf-8")
    (assets / "router-vendor.js").write_text("// rr", encoding="utf-8")
    (assets / "lucide-vendor.js").write_text("// luc", encoding="utf-8")
    (dist / "importmap.json").write_text(
        json.dumps({"imports": {"react": "/assets/react-vendor.js"}}),
        encoding="utf-8",
    )
    (dist / "index.html").write_text(
        '<html><head><script type="importmap">{"imports":{}}</script></head></html>',
        encoding="utf-8",
    )
    return dist


def test_prebuilt_panel_dist_ready(panel_dist):
    assert _prebuilt_panel_dist_ready(panel_dist) is True
    assert _extension_runtime_ready(panel_dist.parent) is True


def test_prebuilt_bundle_dir_detection(tmp_path):
    bundle = tmp_path / "frontend" / "dist"
    bundle.mkdir(parents=True)
    (bundle / "manifest.json").write_text('{"schema":1,"id":"demo","name":"Demo","path":"/demo"}')
    (bundle / "module.js").write_text("export default function Demo(){}", encoding="utf-8")
    assert _is_prebuilt_extension_bundle_dir(bundle) is True
    assert _find_package_prebuilt_bundle_dir(tmp_path) == bundle


def test_normalize_auto_detect_prebuilt(tmp_path):
    bundle = tmp_path / "frontend" / "dist"
    bundle.mkdir(parents=True)
    (bundle / "manifest.json").write_text('{"id":"x","name":"X","path":"/x"}')
    (bundle / "index.js").write_text("export default null", encoding="utf-8")
    mode = _normalize_frontend_install(None, tmp_path, auto_detect=True)
    assert mode == "prebuilt"


def test_no_avx_coerce_rebuild_to_prebuilt(tmp_path, monkeypatch):
    monkeypatch.setenv("COPANEL_FORCE_NO_AVX", "1")
    bundle = tmp_path / "frontend" / "dist"
    bundle.mkdir(parents=True)
    (bundle / "manifest.json").write_text('{"id":"m","name":"M","path":"/m"}')
    (bundle / "module.js").write_text("export default null", encoding="utf-8")
    (tmp_path / "frontend" / "src").mkdir(parents=True)
    assert _coerce_frontend_install_for_cpu("rebuild", tmp_path) == "prebuilt"


def test_no_avx_rebuild_without_prebuilt_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("COPANEL_FORCE_NO_AVX", "1")
    (tmp_path / "frontend" / "src").mkdir(parents=True)
    with pytest.raises(ValueError, match="no AVX"):
        _coerce_frontend_install_for_cpu("rebuild", tmp_path)


def test_install_prebuilt_registers_extension(panel_dist, tmp_path, monkeypatch):
    home = tmp_path
    monkeypatch.setattr("modules.appstore_manager.logic.get_copanel_home", lambda: home)
    frontend_dir = home / "frontend"
    frontend_dir.mkdir()
    shutil_copytree(panel_dist, frontend_dir / "dist")
    (home / "backend" / "modules" / "file_manager").mkdir(parents=True)

    bundle = tmp_path / "pkg" / "frontend" / "dist"
    bundle.mkdir(parents=True)
    manifest = {
        "schema": 1,
        "id": "file_manager",
        "name": "Files",
        "path": "/file-manager",
        "icon": "Folder",
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (bundle / "module.js").write_text("export default function X(){}", encoding="utf-8")

    logs = []
    _install_frontend_prebuilt("file_manager", bundle, frontend_dir, logs)

    ext_module = frontend_dir / "dist" / "extensions" / "file_manager" / "module.js"
    assert ext_module.is_file()
    index = json.loads((frontend_dir / "dist" / "extensions" / "index.json").read_text())
    assert any(e["id"] == "file_manager" for e in index["extensions"])
    registry = json.loads((home / "config" / "frontend_extensions.json").read_text())
    assert "file_manager" in registry


def shutil_copytree(src, dst):
    import shutil

    shutil.copytree(src, dst)


def test_register_preserved_prebuilt_from_module_tree(panel_dist, tmp_path, monkeypatch):
    monkeypatch.setenv("COPANEL_FORCE_NO_AVX", "1")
    home = tmp_path
    monkeypatch.setattr(
        "modules.appstore_manager.logic.get_copanel_home",
        lambda: home,
    )
    frontend = home / "frontend"
    shutil_copytree(panel_dist, frontend / "dist")

    mod = frontend / "src" / "modules" / "demo_mod"
    mod_dist = mod / "dist"
    mod_dist.mkdir(parents=True)
    (mod_dist / "manifest.json").write_text(
        json.dumps({"schema": 1, "id": "demo_mod", "name": "Demo", "path": "/demo-mod"}),
        encoding="utf-8",
    )
    (mod_dist / "module.js").write_text("export default function D(){}", encoding="utf-8")

    logs = []
    n = register_preserved_prebuilt_extensions(frontend, ["demo_mod"], logs)
    assert n >= 1
    assert (frontend / "dist" / "extensions" / "demo_mod" / "module.js").is_file()


def test_write_extensions_index_omits_missing_module_js(panel_dist, tmp_path, monkeypatch):
    home = tmp_path
    monkeypatch.setattr("modules.appstore_manager.logic.get_copanel_home", lambda: home)
    frontend_dir = home / "frontend"
    shutil_copytree(panel_dist, frontend_dir / "dist")

    registry_path = home / "config" / "frontend_extensions.json"
    registry_path.parent.mkdir(parents=True)
    registry_path.write_text(
        json.dumps(
            {
                "file_manager": {
                    "id": "file_manager",
                    "path": "/files",
                    "name": "Files",
                    "manifest_url": "/extensions/file_manager/manifest.json",
                    "module_url": "/extensions/file_manager/module.js",
                },
                "module_redis": {
                    "id": "module_redis",
                    "path": "/redis",
                    "name": "Redis",
                    "manifest_url": "/extensions/module_redis/manifest.json",
                    "module_url": "/extensions/module_redis/module.js",
                },
            }
        ),
        encoding="utf-8",
    )

    ext = frontend_dir / "dist" / "extensions" / "file_manager"
    ext.mkdir(parents=True)
    (ext / "module.js").write_text("export default null", encoding="utf-8")
    (home / "backend" / "modules" / "file_manager").mkdir(parents=True)

    orphan_art = home / "config" / "extension_artifacts" / "module_redis"
    orphan_art.mkdir(parents=True)
    (orphan_art / "manifest.json").write_text('{"id":"module_redis"}', encoding="utf-8")
    (orphan_art / "module.js").write_text("export default null", encoding="utf-8")

    _write_extensions_index(frontend_dir)
    index = json.loads((frontend_dir / "dist" / "extensions" / "index.json").read_text())
    ids = {e["id"] for e in index["extensions"]}
    assert ids == {"file_manager"}
    registry = json.loads(registry_path.read_text())
    assert "file_manager" in registry
    assert "module_redis" not in registry
    assert not orphan_art.exists()


def test_restore_extensions_prunes_orphan_without_backend(panel_dist, tmp_path, monkeypatch):
    home = tmp_path
    monkeypatch.setattr("modules.appstore_manager.logic.get_copanel_home", lambda: home)
    frontend_dir = home / "frontend"
    shutil_copytree(panel_dist, frontend_dir / "dist")

    (home / "backend" / "modules" / "file_manager").mkdir(parents=True)
    registry_path = home / "config" / "frontend_extensions.json"
    registry_path.parent.mkdir(parents=True)
    registry_path.write_text(
        json.dumps(
            {
                "file_manager": {"id": "file_manager", "name": "Files", "path": "/files"},
                "module_redis": {"id": "module_redis", "name": "Redis", "path": "/redis"},
            }
        ),
        encoding="utf-8",
    )

    def _seed_artifact(pkg_id: str) -> None:
        art = home / "config" / "extension_artifacts" / pkg_id
        art.mkdir(parents=True)
        (art / "manifest.json").write_text(json.dumps({"id": pkg_id}), encoding="utf-8")
        (art / "module.js").write_text("export default null", encoding="utf-8")

    _seed_artifact("file_manager")
    _seed_artifact("module_redis")

    logs: list[str] = []
    restored = _restore_extensions_into_dist(frontend_dir, logs)
    assert restored == 1
    assert (frontend_dir / "dist" / "extensions" / "file_manager" / "module.js").is_file()
    assert not (frontend_dir / "dist" / "extensions" / "module_redis").exists()
    assert not (home / "config" / "extension_artifacts" / "module_redis").exists()
    registry = json.loads(registry_path.read_text())
    assert "file_manager" in registry
    assert "module_redis" not in registry
    assert any("module_redis" in line and "backend module" in line for line in logs)
    assert any("Restored 1 AppStore extension" in line for line in logs)


def test_zip_layout_extracted_prebuilt(tmp_path):
    """ZIP with frontend/dist bundle is discoverable after extract."""
    root = tmp_path / "ziproot"
    bundle = root / "frontend" / "dist"
    bundle.mkdir(parents=True)
    (bundle / "manifest.json").write_text('{"id":"z","name":"Z","path":"/z"}')
    (bundle / "module.js").write_text("export default null", encoding="utf-8")
    zpath = tmp_path / "pkg.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        for p in root.rglob("*"):
            if p.is_file():
                zf.write(p, p.relative_to(root))
    extract = tmp_path / "extract"
    extract.mkdir()
    with zipfile.ZipFile(zpath, "r") as zf:
        zf.extractall(extract)
    assert _normalize_frontend_install("prebuilt", extract) == "prebuilt"
