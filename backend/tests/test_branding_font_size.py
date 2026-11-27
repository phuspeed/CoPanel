"""Branding font_size preset is stored and returned on the public branding API."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

import modules.panel_settings.logic as logic


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "panel_settings.json"
    monkeypatch.setattr(logic, "STORE_PATH", path)
    monkeypatch.setattr(logic, "CONFIG_DIR", tmp_path)
    return path


def _branding(**overrides):
    body = {
        "site_title": "CoPanel",
        "site_subtitle": "Lightweight VPS Management",
        "favicon_data_url": None,
        "logo_data_url": None,
        "wallpapers": [],
        "selected_wallpaper_id": None,
    }
    body.update(overrides)
    return logic.update_branding(**body)


def test_public_branding_defaults_to_medium(store: Path):
    data = logic.get_public_branding()
    assert data["font_size"] == "md"


def test_legacy_store_without_font_size_defaults_md(store: Path):
    store.write_text(
        json.dumps({"branding": {"site_title": "Lab"}, "nginx_gate": {"enabled": False, "username": "copanel"}}),
        encoding="utf-8",
    )
    data = logic.get_public_branding()
    assert data["site_title"] == "Lab"
    assert data["font_size"] == "md"


@pytest.mark.parametrize("preset", ["sm", "md", "lg", "xl"])
def test_update_branding_accepts_presets(store: Path, preset: str):
    data = _branding(font_size=preset)
    assert data["font_size"] == preset
    assert json.loads(store.read_text())["branding"]["font_size"] == preset
    assert logic.get_public_branding()["font_size"] == preset


def test_unknown_font_size_rejected(store: Path):
    with pytest.raises(ValueError, match="Font size"):
        _branding(font_size="huge")


def test_omitted_font_size_keeps_existing(store: Path):
    _branding(font_size="xl")
    data = _branding()  # font_size omitted
    assert data["font_size"] == "xl"


def test_empty_font_size_normalizes_existing(store: Path):
    _branding(font_size="lg")
    data = _branding(font_size="")
    assert data["font_size"] == "lg"
