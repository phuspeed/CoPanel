from __future__ import annotations

from textual import on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, DataTable, Footer, Header, Input, Label, Select, Static

from ..api.client import ApiClient, ApiError


class ConfirmModal(ModalScreen[bool]):
    def __init__(self, title: str, message: str) -> None:
        super().__init__()
        self._title = title
        self._message = message

    CSS = """
    ConfirmModal { align: center middle; }
    #box {
        width: 60; height: auto; border: round $error;
        background: $surface; padding: 1 2;
    }
    #actions { height: 3; align: right middle; }
    """

    def compose(self) -> ComposeResult:
        with Vertical(id="box"):
            yield Static(self._title, classes="title")
            yield Static(self._message)
            with Horizontal(id="actions"):
                yield Button("Cancel", id="cancel")
                yield Button("Confirm", variant="error", id="ok")

    @on(Button.Pressed, "#ok")
    def ok(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#cancel")
    def cancel(self) -> None:
        self.dismiss(False)


class FirewallScreen(Screen):
    BINDINGS = [
        Binding("escape", "go_home", "Home"),
        Binding("r", "refresh", "Refresh"),
        Binding("d", "delete_rule", "Delete"),
        Binding("e", "toggle", "Enable/Disable"),
    ]

    CSS = """
    FirewallScreen #banner {
        height: 3; padding: 0 1; background: $boost;
    }
    FirewallScreen #form {
        height: 3; padding: 0 1; layout: horizontal;
    }
    FirewallScreen #form Input, FirewallScreen #form Select {
        width: 1fr; margin-right: 1;
    }
    FirewallScreen DataTable { height: 1fr; }
    FirewallScreen #status {
        dock: bottom; height: 1; padding: 0 1; color: $text-muted;
    }
    """

    def __init__(self, client: ApiClient) -> None:
        super().__init__()
        self.client = client
        self._rules: list[dict] = []
        self._active = False

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static("Firewall · UFW", id="banner")
        with Horizontal(id="form"):
            yield Input(placeholder="port e.g. 80, 443/tcp", id="port")
            yield Select(
                [("ALLOW", "ALLOW"), ("DENY", "DENY")],
                value="ALLOW",
                id="action",
                allow_blank=False,
            )
            yield Input(placeholder="comment", id="comment")
            yield Button("Add", variant="primary", id="add")
        table = DataTable(id="rules")
        table.cursor_type = "row"
        table.zebra_stripes = True
        yield table
        yield Static("", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#rules", DataTable)
        table.add_columns("Port", "Action", "Comment")
        self.action_refresh()

    def action_go_home(self) -> None:
        self.app.pop_screen()

    def action_refresh(self) -> None:
        self._load()

    @work(exclusive=True, thread=True)
    def _load(self) -> None:
        try:
            data = self.client.firewall_status()
        except ApiError as exc:
            self.app.call_from_thread(self._err, exc.message)
            return
        self.app.call_from_thread(self._render, data)

    def _err(self, msg: str) -> None:
        self.query_one("#status", Static).update(f"Error: {msg}")

    def _render(self, data: dict) -> None:
        self._active = bool(data.get("active"))
        self._rules = list(data.get("rules") or [])
        table = self.query_one("#rules", DataTable)
        table.clear()
        for r in self._rules:
            table.add_row(str(r.get("port") or ""), str(r.get("action") or ""), str(r.get("comment") or ""))
        state = "ACTIVE" if self._active else "INACTIVE"
        self.query_one("#banner", Static).update(f"Firewall · UFW · {state}")
        self.query_one("#status", Static).update(
            f"{len(self._rules)} rules · e toggle · d delete · Esc home"
        )

    @on(Button.Pressed, "#add")
    def add_rule(self) -> None:
        port = self.query_one("#port", Input).value.strip()
        action = str(self.query_one("#action", Select).value or "ALLOW")
        comment = self.query_one("#comment", Input).value.strip()
        if not port:
            self.notify("Port required", severity="warning")
            return
        self._do_add(port, action, comment)

    @work(thread=True)
    def _do_add(self, port: str, action: str, comment: str) -> None:
        try:
            self.client.firewall_add(port, action, comment)
            self.app.notify_from_thread(f"Added {port}")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")

    def action_delete_rule(self) -> None:
        table = self.query_one("#rules", DataTable)
        if table.cursor_row is None or table.cursor_row >= len(self._rules):
            return
        rule = self._rules[table.cursor_row]
        port = str(rule.get("port") or "")
        if port in ("22", "22/tcp"):
            self.notify("Refusing to delete SSH rule from TUI", severity="error")
            return

        def done(ok: bool | None) -> None:
            if ok:
                self._do_delete(port, str(rule.get("action") or "ALLOW"))

        self.app.push_screen(ConfirmModal("Delete rule", f'Delete rule for "{port}"?'), done)

    @work(thread=True)
    def _do_delete(self, port: str, action: str) -> None:
        try:
            self.client.firewall_delete(port, action)
            self.app.notify_from_thread(f"Deleted {port}")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")

    def action_toggle(self) -> None:
        act = "disable" if self._active else "enable"

        def done(ok: bool | None) -> None:
            if ok:
                self._do_toggle(act)

        self.app.push_screen(ConfirmModal("Toggle UFW", f"{act.capitalize()} the firewall?"), done)

    @work(thread=True)
    def _do_toggle(self, act: str) -> None:
        try:
            if act == "enable":
                self.client.firewall_enable()
            else:
                self.client.firewall_disable()
            self.app.notify_from_thread(f"Firewall {act}d")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")
