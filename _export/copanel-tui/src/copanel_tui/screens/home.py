from __future__ import annotations

from textual import on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Header, Input, Static

from ..api.client import ApiClient, ApiError
from ..modules_meta import IMPLEMENTED, MODULE_CATALOG


class HomeScreen(Screen):
    """Module picker — k9s/lazygit style list."""

    BINDINGS = [
        Binding("r", "refresh", "Refresh"),
        Binding("q", "logout", "Logout"),
        Binding("enter", "open_module", "Open", show=False),
        Binding("slash", "focus_filter", "Filter"),
    ]

    CSS = """
    HomeScreen #banner {
        dock: top;
        height: 3;
        padding: 0 1;
        background: $boost;
        color: $text;
    }
    HomeScreen #filter {
        dock: top;
        margin: 0 1;
    }
    HomeScreen DataTable {
        height: 1fr;
    }
    HomeScreen #status {
        dock: bottom;
        height: 1;
        padding: 0 1;
        color: $text-muted;
    }
    """

    def __init__(self, client: ApiClient, user: dict) -> None:
        super().__init__()
        self.client = client
        self.user = user
        self._rows: list[str] = []
        self._all_ids: list[str] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        uname = self.user.get("username") or "?"
        role = self.user.get("role") or ""
        yield Static(
            f" CoPanel TUI  ·  {self.client.base_url}  ·  {uname}"
            + (f" ({role})" if role else ""),
            id="banner",
        )
        yield Input(placeholder="Filter modules…  (/)", id="filter")
        table = DataTable(id="modules")
        table.cursor_type = "row"
        table.zebra_stripes = True
        yield table
        yield Static("Loading modules…", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#modules", DataTable)
        table.add_columns("Module", "ID", "Status", "Description")
        self.action_refresh()

    def action_focus_filter(self) -> None:
        self.query_one("#filter", Input).focus()

    def action_logout(self) -> None:
        self.app.logout()

    @on(Input.Changed, "#filter")
    def on_filter(self, event: Input.Changed) -> None:
        self._apply_filter(event.value)

    def action_refresh(self) -> None:
        self._load_modules()

    @work(exclusive=True, thread=True)
    def _load_modules(self) -> None:
        try:
            raw = self.client.modules()
            me = self.client.me()
        except ApiError as exc:
            self.app.call_from_thread(self._show_error, exc.message)
            return
        self.app.call_from_thread(self._populate, raw, me)

    def _show_error(self, msg: str) -> None:
        self.query_one("#status", Static).update(f"Error: {msg}")

    def _populate(self, raw, me: dict) -> None:
        if me:
            self.user = me if "username" in me else {**self.user, **me}
        # modules API returns dict {name: meta} or list
        ids: list[str] = []
        if isinstance(raw, dict):
            ids = sorted(raw.keys())
        elif isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict) and item.get("id"):
                    ids.append(str(item["id"]))
                elif isinstance(item, str):
                    ids.append(item)
            ids = sorted(set(ids))

        # Prefer catalog order for known modules, then extras
        ordered: list[str] = [m for m in MODULE_CATALOG if m in ids]
        ordered += [m for m in ids if m not in ordered]
        # Always show implemented ones even if discovery failed partially
        for m in IMPLEMENTED:
            if m not in ordered:
                ordered.append(m)

        self._all_ids = ordered
        self._apply_filter(self.query_one("#filter", Input).value)
        self.query_one("#status", Static).update(
            f"{len(ordered)} modules · Enter open · implemented: {', '.join(sorted(IMPLEMENTED))}"
        )

    def _apply_filter(self, q: str) -> None:
        table = self.query_one("#modules", DataTable)
        table.clear()
        self._rows = []
        qn = (q or "").strip().lower()
        for mid in self._all_ids:
            title, _icon, desc = MODULE_CATALOG.get(mid, (mid, "Box", ""))
            if qn and qn not in mid.lower() and qn not in title.lower() and qn not in desc.lower():
                continue
            status = "ready" if mid in IMPLEMENTED else "api only"
            table.add_row(title, mid, status, desc)
            self._rows.append(mid)

    def action_open_module(self) -> None:
        table = self.query_one("#modules", DataTable)
        if table.cursor_row is None or table.cursor_row < 0 or table.cursor_row >= len(self._rows):
            return
        mid = self._rows[table.cursor_row]
        self.app.open_module(mid)

    @on(DataTable.RowSelected, "#modules")
    def on_row_selected(self, event: DataTable.RowSelected) -> None:
        self.action_open_module()
