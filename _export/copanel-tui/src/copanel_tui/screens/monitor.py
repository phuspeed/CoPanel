from __future__ import annotations

from textual import on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, DataTable, Footer, Header, Static

from ..api.client import ApiClient, ApiError
from ..widgets.formatters import bar, format_bytes, format_uptime


class ConfirmSignal(ModalScreen[bool]):
    def __init__(self, title: str, message: str) -> None:
        super().__init__()
        self._title = title
        self._message = message

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm"):
            yield Static(self._title, id="confirm-title")
            yield Static(self._message, id="confirm-msg")
            with Horizontal(id="confirm-actions"):
                yield Button("Cancel", id="cancel")
                yield Button("Confirm", variant="error", id="ok")

    @on(Button.Pressed, "#ok")
    def ok(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#cancel")
    def cancel(self) -> None:
        self.dismiss(False)


class MonitorScreen(Screen):
    """btop-lite system monitor."""

    BINDINGS = [
        Binding("escape", "go_home", "Home"),
        Binding("r", "refresh", "Refresh"),
        Binding("t", "signal_term", "SIGTERM"),
        Binding("k", "signal_kill", "SIGKILL"),
    ]

    CSS = """
    MonitorScreen #panels {
        height: 12;
        padding: 0 1;
    }
    MonitorScreen .panel {
        width: 1fr;
        height: 100%;
        border: round $accent;
        padding: 0 1;
        margin-right: 1;
    }
    MonitorScreen .panel:last-child {
        margin-right: 0;
    }
    MonitorScreen .panel-title {
        text-style: bold;
        color: $accent;
    }
    MonitorScreen #proc-wrap {
        height: 1fr;
        padding: 0 1 1 1;
    }
    MonitorScreen #proc-wrap DataTable {
        height: 1fr;
    }
    MonitorScreen #status {
        dock: bottom;
        height: 1;
        padding: 0 1;
        color: $text-muted;
    }
    #confirm {
        width: 60;
        height: auto;
        border: round $error;
        background: $surface;
        padding: 1 2;
    }
    #confirm-title { text-style: bold; margin-bottom: 1; }
    #confirm-actions { height: 3; align: right middle; }
    """

    def __init__(self, client: ApiClient) -> None:
        super().__init__()
        self.client = client
        self._pids: list[int] = []
        self._names: dict[int, str] = {}

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="panels"):
            with Vertical(classes="panel", id="cpu-panel"):
                yield Static("CPU", classes="panel-title")
                yield Static("—", id="cpu-body")
            with Vertical(classes="panel", id="mem-panel"):
                yield Static("MEM", classes="panel-title")
                yield Static("—", id="mem-body")
            with Vertical(classes="panel", id="disk-panel"):
                yield Static("DISK", classes="panel-title")
                yield Static("—", id="disk-body")
            with Vertical(classes="panel", id="net-panel"):
                yield Static("NET", classes="panel-title")
                yield Static("—", id="net-body")
        with Vertical(id="proc-wrap"):
            yield Static("Processes", classes="panel-title")
            table = DataTable(id="procs")
            table.cursor_type = "row"
            table.zebra_stripes = True
            yield table
        yield Static("Fetching stats…", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#procs", DataTable)
        table.add_columns("PID", "Name", "User", "CPU%", "MEM%", "RSS", "State")
        self.set_interval(3.0, self.action_refresh)
        self.action_refresh()

    def action_go_home(self) -> None:
        self.app.pop_screen()

    def action_refresh(self) -> None:
        self._fetch()

    @work(exclusive=True, thread=True)
    def _fetch(self) -> None:
        try:
            stats = self.client.monitor_stats()
        except ApiError as exc:
            self.app.call_from_thread(self._err, exc.message)
            return
        self.app.call_from_thread(self._render, stats)

    def _err(self, msg: str) -> None:
        self.query_one("#status", Static).update(f"Error: {msg}")

    def _render(self, stats: dict) -> None:
        cpu = stats.get("cpu") or {}
        mem = stats.get("memory") or {}
        disk = stats.get("disk") or {}
        net = stats.get("network") or {}
        system = stats.get("system") or {}
        procs = stats.get("top_processes") or []

        cpu_pct = float(cpu.get("percent") or 0)
        self.query_one("#cpu-body", Static).update(
            f"{bar(cpu_pct)} {cpu_pct:.1f}%\n"
            f"cores {cpu.get('count', '—')} · up {format_uptime(system.get('uptime_seconds'))}\n"
            f"{(system.get('cpu_model') or system.get('processor') or '')[:42]}"
        )

        mem_pct = float(mem.get("percent") or 0)
        self.query_one("#mem-body", Static).update(
            f"{bar(mem_pct)} {mem_pct:.1f}%\n"
            f"used {format_bytes(mem.get('used'))} / {format_bytes(mem.get('total'))}\n"
            f"avail {format_bytes(mem.get('available'))}"
        )

        parts = disk.get("partitions") or []
        agg = disk.get("aggregate") or {}
        if agg.get("total"):
            disk_pct = float(agg.get("percent") or 0)
            disk_line = f"{bar(disk_pct)} {disk_pct:.1f}%\n{format_bytes(agg.get('used'))} / {format_bytes(agg.get('total'))}"
        elif parts:
            p0 = max(parts, key=lambda p: p.get("percent") or 0)
            disk_pct = float(p0.get("percent") or 0)
            disk_line = f"{bar(disk_pct)} {disk_pct:.1f}%\n{p0.get('mountpoint', '/')}"
        else:
            disk_line = "no disk data"
        if parts:
            extra = "\n".join(
                f"{(p.get('mountpoint') or '?')[:12]} {bar(float(p.get('percent') or 0), 8)} {float(p.get('percent') or 0):.0f}%"
                for p in parts[:3]
            )
            disk_line = disk_line + "\n" + extra
        self.query_one("#disk-body", Static).update(disk_line)

        self.query_one("#net-body", Static).update(
            f"↓ {format_bytes(net.get('bytes_recv'))}\n"
            f"↑ {format_bytes(net.get('bytes_sent'))}\n"
            f"conn {net.get('connections', '—')}"
        )

        table = self.query_one("#procs", DataTable)
        table.clear()
        self._pids = []
        self._names = {}
        for p in procs[:40]:
            pid = int(p.get("pid") or 0)
            name = str(p.get("name") or "")
            self._pids.append(pid)
            self._names[pid] = name
            table.add_row(
                str(pid),
                name[:24],
                str(p.get("username") or "—")[:12],
                f"{float(p.get('cpu_percent') or 0):.1f}",
                f"{float(p.get('memory_percent') or 0):.1f}",
                format_bytes(p.get("rss")),
                str(p.get("status") or "—")[:8],
            )

        host = system.get("hostname") or ""
        self.query_one("#status", Static).update(
            f"{host} · {len(procs)} processes · t SIGTERM · k SIGKILL · Esc home"
        )

    def _selected_pid(self) -> tuple[int | None, str]:
        table = self.query_one("#procs", DataTable)
        if table.cursor_row is None or table.cursor_row < 0 or table.cursor_row >= len(self._pids):
            return None, ""
        pid = self._pids[table.cursor_row]
        return pid, self._names.get(pid, "")

    def action_signal_term(self) -> None:
        self._confirm_signal("term")

    def action_signal_kill(self) -> None:
        self._confirm_signal("kill")

    def _confirm_signal(self, signal: str) -> None:
        pid, name = self._selected_pid()
        if not pid:
            self.notify("Select a process first", severity="warning")
            return
        label = "SIGTERM" if signal == "term" else "SIGKILL"

        def done(ok: bool | None) -> None:
            if ok:
                self._send_signal(pid, signal)

        self.app.push_screen(
            ConfirmSignal(label, f"Send {label} to PID {pid} ({name})?"),
            done,
        )

    @work(thread=True)
    def _send_signal(self, pid: int, signal: str) -> None:
        try:
            self.client.process_signal(pid, signal)
            self.app.notify_from_thread(f"Signal {signal} → PID {pid}")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")
