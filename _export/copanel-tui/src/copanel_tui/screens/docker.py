from __future__ import annotations

from textual import work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Header, Static

from ..api.client import ApiClient, ApiError


class DockerScreen(Screen):
    BINDINGS = [
        Binding("escape", "go_home", "Home"),
        Binding("r", "refresh", "Refresh"),
        Binding("s", "start", "Start"),
        Binding("x", "stop", "Stop"),
        Binding("R", "restart", "Restart"),
    ]

    CSS = """
    DockerScreen #banner { height: 3; padding: 0 1; background: $boost; }
    DockerScreen DataTable { height: 1fr; }
    DockerScreen #status { dock: bottom; height: 1; padding: 0 1; color: $text-muted; }
    """

    def __init__(self, client: ApiClient) -> None:
        super().__init__()
        self.client = client
        self._rows: list[dict] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static("Docker · containers", id="banner")
        table = DataTable(id="containers")
        table.cursor_type = "row"
        table.zebra_stripes = True
        yield table
        yield Static("", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#containers", DataTable)
        table.add_columns("ID", "Name", "Image", "Status", "Ports")
        self.action_refresh()

    def action_go_home(self) -> None:
        self.app.pop_screen()

    def action_refresh(self) -> None:
        self._load()

    @work(exclusive=True, thread=True)
    def _load(self) -> None:
        try:
            containers = self.client.docker_list()
        except ApiError as exc:
            self.app.call_from_thread(self._err, exc.message)
            return
        self.app.call_from_thread(self._render, containers)

    def _err(self, msg: str) -> None:
        self.query_one("#status", Static).update(f"Error: {msg}")

    def _render(self, containers: list[dict]) -> None:
        self._rows = containers
        table = self.query_one("#containers", DataTable)
        table.clear()
        for c in containers:
            cid = str(c.get("Id") or c.get("id") or "")[:12]
            names = c.get("Names") or c.get("names") or c.get("name") or ""
            if isinstance(names, list):
                name = ",".join(str(n).lstrip("/") for n in names)
            else:
                name = str(names).lstrip("/")
            image = str(c.get("Image") or c.get("image") or "")[:32]
            status = str(c.get("Status") or c.get("status") or c.get("State") or "")[:24]
            ports = c.get("Ports") or c.get("ports") or ""
            if isinstance(ports, list):
                ports = ",".join(
                    f"{p.get('PublicPort', '')}->{p.get('PrivatePort', '')}"
                    for p in ports
                    if isinstance(p, dict)
                )[:28]
            else:
                ports = str(ports)[:28]
            table.add_row(cid, name[:28], image, status, ports)
        self.query_one("#status", Static).update(
            f"{len(containers)} containers · s start · x stop · R restart · Esc home"
        )

    def _selected_id(self) -> str | None:
        table = self.query_one("#containers", DataTable)
        if table.cursor_row is None or table.cursor_row >= len(self._rows):
            return None
        c = self._rows[table.cursor_row]
        return str(c.get("Id") or c.get("id") or "") or None

    def action_start(self) -> None:
        self._act("start")

    def action_stop(self) -> None:
        self._act("stop")

    def action_restart(self) -> None:
        self._act("restart")

    def _act(self, action: str) -> None:
        cid = self._selected_id()
        if not cid:
            self.notify("Select a container", severity="warning")
            return
        self._run_action(action, cid)

    @work(thread=True)
    def _run_action(self, action: str, cid: str) -> None:
        try:
            self.client.docker_action(action, cid)
            self.app.notify_from_thread(f"{action} {cid[:12]}")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")
