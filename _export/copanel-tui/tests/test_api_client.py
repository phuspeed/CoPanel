from copanel_tui.api.client import ApiClient, ApiError
import httpx
import pytest


class _Transport(httpx.BaseTransport):
    def __init__(self, handler):
        self.handler = handler

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return self.handler(request)


def test_login_and_me() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/auth/login":
            return httpx.Response(
                200,
                json={"access_token": "tok", "user": {"username": "admin", "role": "admin"}},
            )
        if request.url.path == "/api/auth/me":
            assert request.headers.get("Authorization") == "Bearer tok"
            return httpx.Response(200, json={"status": "success", "data": {"user": {"username": "admin"}}})
        return httpx.Response(404, json={"detail": "no"})

    client = ApiClient("http://test")
    client._client = httpx.Client(transport=_Transport(handler))
    body = client.login("admin", "x")
    assert body["access_token"] == "tok"
    me = client.me()
    assert me["username"] == "admin"
    client.close()


def test_error_envelope() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": "error", "error": {"code": "X", "message": "nope"}},
        )

    client = ApiClient("http://test", token="t")
    client._client = httpx.Client(transport=_Transport(handler))
    with pytest.raises(ApiError) as ei:
        client.get("/api/x")
    assert ei.value.message == "nope"
    client.close()


def test_modules_dict() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"modules": {"firewall": {"route_count": 1}, "cron_manager": {}}, "count": 2},
        )

    client = ApiClient("http://test", token="t")
    client._client = httpx.Client(transport=_Transport(handler))
    mods = client.modules()
    assert "firewall" in mods
    client.close()
