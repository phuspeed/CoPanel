from __future__ import annotations

import os
from pathlib import Path

from textual.app import App
from textual.binding import Binding

from .api.client import ApiClient
from .auth.store import TokenStore
from .screens.cron import CronScreen
from .screens.docker import DockerScreen
from .screens.firewall import FirewallScreen
from .screens.home import HomeScreen
from .screens.login import LoginScreen
from .screens.monitor import MonitorScreen


class CoPanelApp(App):
    """CoPanel terminal control panel."""

    TITLE = "CoPanel TUI"
    CSS = """
    Screen {
        background: #0f172a;
    }
    Header {
        background: #1e293b;
    }
    Footer {
        background: #1e293b;
    }
    DataTable > .datatable--cursor {
        background: #1d4ed8;
        color: #f8fafc;
    }
    ConfirmModal, ConfirmSignal {
        align: center middle;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit", show=False),
    ]

    def __init__(self) -> None:
        super().__init__()
        token_path = os.environ.get("COPANEL_TOKEN_FILE")
        self.store = TokenStore(Path(token_path) if token_path else None)
        self.client: ApiClient | None = None
        self.user: dict = {}

    def on_mount(self) -> None:
        saved = self.store.load()
        token = saved.get("token")
        base = saved.get("base_url") or os.environ.get("COPANEL_URL")
        if token and base:
            client = ApiClient(str(base), token=str(token))
            try:
                user = client.me()
                self.on_authenticated(
                    client,
                    user if isinstance(user, dict) else {"username": saved.get("username")},
                )
                return
            except Exception:
                client.close()
                self.store.clear()
        self.push_screen(LoginScreen(self.store))

    def on_authenticated(self, client: ApiClient, user: dict) -> None:
        if self.client and self.client is not client:
            self.client.close()
        self.client = client
        self.user = user or {}
        home = HomeScreen(client, self.user)
        if not self.screen_stack:
            self.push_screen(home)
        else:
            while len(self.screen_stack) > 1:
                self.pop_screen()
            self.switch_screen(home)

    def logout(self) -> None:
        self.store.clear()
        if self.client:
            self.client.close()
            self.client = None
        self.user = {}
        login = LoginScreen(self.store)
        if not self.screen_stack:
            self.push_screen(login)
        else:
            while len(self.screen_stack) > 1:
                self.pop_screen()
            self.switch_screen(login)

    def open_module(self, module_id: str) -> None:
        if not self.client:
            return
        screens = {
            "system_monitor": MonitorScreen,
            "firewall": FirewallScreen,
            "cron_manager": CronScreen,
            "docker_manager": DockerScreen,
        }
        cls = screens.get(module_id)
        if not cls:
            self.notify(f"{module_id} not implemented in TUI v0.1 (API only)", severity="information")
            return
        self.push_screen(cls(self.client))

    def notify_from_thread(self, message: str, *, severity: str = "information") -> None:
        """Safe notify wrapper for @work(thread=True) workers."""
        self.call_from_thread(lambda: self.notify(message, severity=severity))

    def on_unmount(self) -> None:
        if self.client:
            self.client.close()
