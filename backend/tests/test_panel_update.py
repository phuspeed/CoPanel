"""Panel self-update metadata (release URL vs VERSION)."""
from __future__ import annotations

from unittest.mock import patch

from core import panel_update


def test_release_url_for_version_uses_matching_tag():
    assert panel_update.release_url_for_version("1.1.9") == (
        "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.9"
    )
    assert panel_update.release_url_for_version("v1.1.9") == (
        "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.9"
    )


@patch("core.panel_update._fetch_remote_version", return_value=("1.1.9", None, None))
@patch("core.panel_update.read_local_version", return_value="1.1.8")
@patch("core.panel_update._fetch_release_by_tag")
def test_check_for_update_release_url_matches_remote_version(
    mock_release_by_tag, _mock_remote, _mock_local
):
    mock_release_by_tag.return_value = {
        "tag_name": "v1.1.9",
        "html_url": "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.9",
        "body": "Notes",
    }
    panel_update._CACHE.clear()
    panel_update._CACHE_AT = 0.0

    result = panel_update.check_for_update()

    assert result["remote_version"] == "1.1.9"
    assert result["release_url"] == "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.9"
    assert result["changelog"] == "Notes"
    mock_release_by_tag.assert_called_once_with("1.1.9")


@patch("core.panel_update._fetch_remote_version", return_value=("1.1.9", None, None))
@patch("core.panel_update.read_local_version", return_value="1.1.9")
@patch("core.panel_update._fetch_release_by_tag", return_value=None)
@patch("core.panel_update._http_get_json")
def test_check_for_update_does_not_use_stale_latest_release(
    mock_http_json, _mock_by_tag, _mock_remote, _mock_local
):
    mock_http_json.return_value = {
        "tag_name": "v1.1.4",
        "html_url": "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.4",
        "body": "old",
    }
    panel_update._CACHE.clear()
    panel_update._CACHE_AT = 0.0

    result = panel_update.check_for_update()

    assert result["release_url"] == "https://github.com/phuspeed/CoPanel/releases/tag/v1.1.9"
    assert result["changelog"] is None
