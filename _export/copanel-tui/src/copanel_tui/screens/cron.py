from __future__ import annotations

from textual import on, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, DataTable, Footer, Header, Static

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
            yield Static(self._title)
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


class CronScreen(Screen):
    BINDINGS = [
        Binding("escape", "go_home", "Home"),
        Binding("r", "refresh", "Refresh"),
        Binding("p", "toggle_pause", "Pause/Start"),
        Binding("d", "delete_job", "Delete"),
    ]

    CSS = """
    CronScreen #banner { height: 3; padding: 0 1; background: $boost; }
    CronScreen DataTable { height: 1fr; }
    CronScreen #status { dock: bottom; height: 1; padding: 0 1; color: $text-muted; }
    """

    def __init__(self, client: ApiClient) -> None:
        super().__init__()
        self.client = client
        self._jobs: list[dict] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static("Cron Manager", id="banner")
        table = DataTable(id="jobs")
        table.cursor_type = "row"
        table.zebra_stripes = True
        yield table
        yield Static("", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#jobs", DataTable)
        table.add_columns("Schedule", "Command", "Managed", "Active")
        self.action_refresh()

    def action_go_home(self) -> None:
        self.app.pop_screen()

    def action_refresh(self) -> None:
        self._load()

    @work(exclusive=True, thread=True)
    def _load(self) -> None:
        try:
            jobs = self.client.cron_jobs()
        except ApiError as exc:
            self.app.call_from_thread(self._err, exc.message)
            return
        self.app.call_from_thread(self._render, jobs)

    def _err(self, msg: str) -> None:
        self.query_one("#status", Static).update(f"Error: {msg}")

    def _render(self, jobs: list[dict]) -> None:
        self._jobs = jobs
        table = self.query_one("#jobs", DataTable)
        table.clear()
        for j in jobs:
            sched = f"{j.get('minute')} {j.get('hour')} {j.get('day')} {j.get('month')} {j.get('weekday')}"
            table.add_row(
                sched,
                str(j.get("command") or "")[:60],
                "yes" if j.get("managed") else "manual",
                "on" if j.get("is_active", True) else "off",
            )
        self.query_one("#status", Static).update(
            f"{len(jobs)} jobs · p pause/start · d delete · Esc home"
        )

    def _selected(self) -> dict | None:
        table = self.query_one("#jobs", DataTable)
        if table.cursor_row is None or table.cursor_row >= len(self._jobs):
            return None
        return self._jobs[table.cursor_row]

    def action_toggle_pause(self) -> None:
        job = self._selected()
        if not job or not job.get("managed") or not job.get("id"):
            self.notify("Select a managed job", severity="warning")
            return
        active = not bool(job.get("is_active", True))
        self._set_active(str(job["id"]), active)

    @work(thread=True)
    def _set_active(self, job_id: str, active: bool) -> None:
        try:
            self.client.cron_set_active(job_id, active)
            self.app.notify_from_thread("started" if active else "paused")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")

    def action_delete_job(self) -> None:
        job = self._selected()
        if not job or not job.get("managed") or not job.get("id"):
            self.notify("Select a managed job", severity="warning")
            return
        jid = str(job["id"])

        def done(ok: bool | None) -> None:
            if ok:
                self._delete(jid)

        self.app.push_screen(ConfirmModal("Delete job", "Remove this cron job?"), done)

    @work(thread=True)
    def _delete(self, job_id: str) -> None:
        try:
            self.client.cron_delete(job_id)
            self.app.notify_from_thread("Deleted")
            self.app.call_from_thread(self.action_refresh)
        except ApiError as exc:
            self.app.notify_from_thread(exc.message, severity="error")
