from copanel_tui.widgets.formatters import bar, format_bytes, format_uptime


def test_format_bytes() -> None:
    assert format_bytes(None) == "—"
    assert format_bytes(512) == "512B"
    assert format_bytes(2048).endswith("K")
    assert format_bytes(5 * 1024**3).endswith("G")


def test_bar() -> None:
    assert len(bar(0, 10)) == 10
    assert bar(100, 10) == "█" * 10
    assert "█" in bar(50, 10)


def test_uptime() -> None:
    assert format_uptime(0) == "0m"
    assert "h" in format_uptime(3700)
    assert "d" in format_uptime(90000)
