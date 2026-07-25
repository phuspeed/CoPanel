from __future__ import annotations

import os

from textual import on
from textual.app import ComposeResult
from textual.containers import Vertical, Horizontal
from textual.screen import Screen
from textual.widgets import Button, Input, Label, Static, Header, Footer

from ..api.client import ApiClient, ApiError
from ..auth.store import TokenStore


class LoginScreen(Screen):
    """Server + credentials form."""

    BINDINGS = [
        ("escape", "app.quit", "Quit"),
    ]

    CSS = """
    LoginScreen {
        align: center middle;
    }
    #login-box {
        width: 64;
        max-width: 90%;
        height: auto;
        border: round $accent;
        padding: 1 2;
        background: $surface;
    }
    #login-title {
        text-align: center;
        text-style: bold;
        color: $accent;
        margin-bottom: 0;
    }
    #login-sub {
        text-align: center;
        color: $text-muted;
        margin-bottom: 1;
    }
    .row {
        height: 3;
        margin-bottom: 0;
    }
    .row Label {
        width: 12;
        padding-top: 1;
    }
    .row Input {
        width: 1fr;
    }
    #login-error {
        color: $error;
        margin: 1 0;
        height: auto;
        min-height: 1;
    }
    #login-actions {
        height: 3;
        align: center middle;
        margin-top: 1;
    }
    """

    def __init__(self, store: TokenStore) -> None:
        super().__init__()
        self.store = store

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        saved = self.store.load()
        default_url = os.environ.get("COPANEL_URL") or saved.get("base_url") or "http://127.0.0.1:8686"
        default_user = os.environ.get("COPANEL_USER") or saved.get("username") or ""
        with Vertical(id="login-box"):
            yield Static("CoPanel", id="login-title")
            yield Static("Terminal control panel", id="login-sub")
            with Horizontal(classes="row"):
                yield Label("Server")
                yield Input(value=default_url, placeholder="https://vps:8686", id="server")
            with Horizontal(classes="row"):
                yield Label("User")
                yield Input(value=default_user, placeholder="admin", id="username")
            with Horizontal(classes="row"):
                yield Label("Password")
                yield Input(password=True, placeholder="••••••••", id="password")
            with Horizontal(classes="row"):
                yield Label("TOTP")
                yield Input(placeholder="optional", id="totp")
            yield Static("", id="login-error")
            with Horizontal(id="login-actions"):
                yield Button("Sign in", variant="primary", id="btn-login")
        yield Footer()

    @on(Button.Pressed, "#btn-login")
    @on(Input.Submitted)
    def do_login(self, _event=None) -> None:
        err = self.query_one("#login-error", Static)
        err.update("")
        server = self.query_one("#server", Input).value.strip().rstrip("/")
        username = self.query_one("#username", Input).value.strip()
        password = self.query_one("#password", Input).value
        totp = self.query_one("#totp", Input).value.strip() or None
        if not server or not username or not password:
            err.update("Server, user, and password are required.")
            return
        client = ApiClient(server)
        try:
            body = client.login(username, password, totp)
            user = body.get("user") if isinstance(body.get("user"), dict) else {}
            token = body["access_token"]
            self.store.save(base_url=server, token=token, username=username)
            self.app.on_authenticated(client, user or {"username": username})
        except ApiError as exc:
            client.close()
            err.update(exc.message)
        except Exception as exc:
            client.close()
            err.update(str(exc))
