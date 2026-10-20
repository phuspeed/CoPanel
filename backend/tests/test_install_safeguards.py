"""Install script safeguards (rsync/tsc excludes) — static checks on scripts/install.sh."""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _noavx_build():
    path = Path(__file__).resolve().parents[1] / "core" / "noavx_build.py"
    spec = importlib.util.spec_from_file_location("copanel_noavx_build", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod

INSTALL_SH = Path(__file__).resolve().parents[2] / "scripts" / "install.sh"
SYNC_TSC = Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "sync-tsc-excludes.mjs"
VITE_CONFIG = Path(__file__).resolve().parents[2] / "frontend" / "vite.config.ts"


def test_rsync_preserves_frontend_dist_and_staging():
    text = INSTALL_SH.read_text(encoding="utf-8")
    fn_start = text.index("copanel_deploy_tree_rsync_excludes()")
    fn_end = text.index("copanel_rsync_with_module_preservation()", fn_start)
    block = text[fn_start:fn_end]
    for needle in (
        "frontend/dist/",
        "frontend/.build-staging/",
        "frontend/.dist-prev/",
    ):
        assert needle in block, f"missing rsync exclude {needle!r} in deploy tree preserves"


def test_tar_fallback_preserves_frontend_dist_and_staging():
    text = INSTALL_SH.read_text(encoding="utf-8")
    fn_start = text.index("copanel_tar_copy_with_module_preservation()")
    fn_end = text.index("setup_user_and_dirs()", fn_start)
    block = text[fn_start:fn_end]
    for needle in (
        "./frontend/dist",
        "./frontend/.build-staging",
        "./frontend/.dist-prev",
    ):
        assert needle in block, f"missing tar exclude {needle!r}"


def test_git_clean_preserves_frontend_dist_and_staging():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert "--exclude=frontend/dist" in text
    assert "--exclude=frontend/.build-staging" in text
    assert "--exclude=frontend/.dist-prev" in text


def test_sync_tsc_honors_repo_dir_and_skip_marker():
    text = SYNC_TSC.read_text(encoding="utf-8")
    assert "COPANEL_REPO_DIR" in text
    assert "COPANEL_EXTRA_FRONTEND_MODULES" in text
    assert ".copanel-skip-tsc" in text


def test_install_exports_copanel_extra_frontend_modules():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert "COPANEL_EXTRA_FRONTEND_MODULES" in text
    assert "COPANEL_REPO_DIR" in text
    assert "copanel_frontend_preserved_module_ids" in text


def test_noavx_prebuilt_merge_after_extra_modules():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert "copanel_noavx_merge_prebuilt_with_extra_modules" in text
    block_start = text.index("setup_frontend()")
    block = text[block_start : block_start + 2500]
    assert "copanel_use_prebuilt_frontend" in block
    assert "copanel_noavx_merge_prebuilt_with_extra_modules" in block


def test_install_never_cats_admin_password_in_summary():
    text = INSTALL_SH.read_text(encoding="utf-8")
    summary_start = text.index("print_summary()")
    summary_end = text.index("main()", summary_start)
    block = text[summary_start:summary_end]
    assert "cat \"${CoPanel_HOME}/config/admin_password.txt\"" not in block
    assert "copanel_admin_password_summary_line" in block


def test_install_health_check_retries():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert "copanel_wait_for_health_url" in text
    verify_start = text.index("verify_installation()")
    verify_end = text.index("print_summary()", verify_start)
    block = text[verify_start:verify_end]
    assert "60" in block


def test_install_noavx_node_heap_and_vite_env():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert "copanel_noavx_node_heap_mb" in text
    assert "COPANEL_NOAVX=1" in text
    assert "copanel_noavx_vite_env" in text


def test_vite_config_noavx_conservative_build():
    text = VITE_CONFIG.read_text(encoding="utf-8")
    assert "COPANEL_NOAVX" in text
    assert "conservativeBuild" in text
    assert "minify: conservativeBuild ? false" in text


def test_noavx_node_heap_scales_with_ram():
    nb = _noavx_build()
    assert nb.node_heap_mb_for_noavx(7700) == 3080
    assert nb.node_heap_mb_for_noavx(1024) == 1536
    assert nb.node_heap_mb_for_noavx(16384) == 4096
    assert nb.node_heap_mb_for_noavx(0) == 3072


def test_wasm_render_failure_detection():
    nb = _noavx_build()
    assert nb.is_wasm_render_failure(139, "")
    assert nb.is_wasm_render_failure(0, "fatal error: too many writes on closed pipe")
    assert not nb.is_wasm_render_failure(0, "build complete")
