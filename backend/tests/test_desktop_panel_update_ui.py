"""Desktop shell shows the panel version and opens the same upgrade dialog as Classic."""
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src" / "core"


def _read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def test_single_upgrade_dialog_component():
    layout = _read("Layout.tsx")
    # One dialog instance, shared by both shells (not inside a classic-only block).
    assert layout.count("<PanelUpgradeModal") == 1
    assert "panel-update/run" not in layout and "panel-update/check" not in layout
    hook = _read("hooks/usePanelUpdate.ts")
    assert "/api/platform/panel-update/check" in hook
    assert "/api/platform/panel-update/run" in hook


def test_dialog_keeps_classic_contents_and_layering():
    modal = _read("shell/PanelUpgradeModal.tsx")
    for label in ("upgradeTitle", "changelog", "viewReleases", "progress", "liveLog", "close", "startUpgrade"):
        assert f"labels.{label}" in modal
    assert "remote_version" in modal and "release_url" in modal
    # Above desktop windows (z-[100]), below the dock (z-[120]).
    assert "z-[110]" in modal


def test_dock_version_badge_opens_shared_dialog():
    layout = _read("Layout.tsx")
    dock = _read("shell/Dock.tsx")
    assert "panelVersion={panelUpdate.version}" in layout
    assert "onOpenPanelUpdate={isSuperAdmin ? panelUpdate.openModal : undefined}" in layout
    assert "onClick={onOpenPanelUpdate}" in dock
    assert "v{panelVersion}" in dock
    # Classic footer still opens the same dialog.
    assert "onClick={panelUpdate.openModal}" in layout
