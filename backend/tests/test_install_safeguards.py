"""Install script safeguards (rsync/tsc excludes) — static checks on scripts/install.sh."""
from __future__ import annotations

from pathlib import Path

INSTALL_SH = Path(__file__).resolve().parents[2] / "scripts" / "install.sh"
SYNC_TSC = Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "sync-tsc-excludes.mjs"


def test_rsync_preserves_frontend_dist_and_staging():
    text = INSTALL_SH.read_text(encoding="utf-8")
    fn_start = text.index("copanel_deploy_tree_rsync_excludes()")
    fn_end = text.index("copanel_rsync_with_module_preservation()", fn_start)
    block = text[fn_start:fn_end]
    for needle in (
        'frontend/dist/',
        'frontend/.build-staging/',
        'frontend/.dist-prev/',
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
