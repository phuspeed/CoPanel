from __future__ import annotations

from typing import Any

import httpx


class ApiError(Exception):
    def __init__(self, message: str, *, status: int = 0, code: str = "ERROR", details: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details


class ApiClient:
    """HTTP client for CoPanel JWT APIs."""

    def __init__(self, base_url: str, token: str | None = None, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._client = httpx.Client(timeout=timeout, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    def set_token(self, token: str | None) -> None:
        self.token = token

    def _headers(self) -> dict[str, str]:
        h = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def request(self, method: str, path: str, *, json_body: Any = None, raw: bool = False) -> Any:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        try:
            res = self._client.request(method, url, headers=self._headers(), json=json_body)
        except httpx.HTTPError as exc:
            raise ApiError(f"Network error: {exc}", status=0, code="NETWORK") from exc

        body: Any = None
        text = res.text
        if text:
            try:
                body = res.json()
            except Exception:
                body = {"detail": text}

        if res.status_code >= 400:
            detail = None
            if isinstance(body, dict):
                detail = body.get("detail") or (body.get("error") or {}).get("message")
                if isinstance(detail, list):
                    detail = "; ".join(
                        str(x.get("msg") if isinstance(x, dict) else x) for x in detail
                    )
            raise ApiError(str(detail or f"HTTP {res.status_code}"), status=res.status_code, details=body)

        if raw:
            return body

        if isinstance(body, dict):
            status = body.get("status")
            if status == "error":
                err = body.get("error") or {}
                raise ApiError(
                    str(err.get("message") or "API error"),
                    status=res.status_code,
                    code=str(err.get("code") or "ERROR"),
                    details=err,
                )
            if "data" in body and status in (None, "success"):
                return body["data"]
            if status == "success":
                # success without data — return full body minus status
                out = {k: v for k, v in body.items() if k != "status"}
                return out if out else body
        return body

    def get(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw)

    def post(self, path: str, json_body: Any = None, **kw: Any) -> Any:
        return self.request("POST", path, json_body=json_body, **kw)

    def delete(self, path: str, **kw: Any) -> Any:
        return self.request("DELETE", path, **kw)

    # --- Auth ---

    def login(self, username: str, password: str, totp_code: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"username": username, "password": password}
        if totp_code:
            payload["totp_code"] = totp_code
        body = self.request("POST", "/api/auth/login", json_body=payload, raw=True)
        if not isinstance(body, dict):
            raise ApiError("Invalid login response")
        token = body.get("access_token")
        if not token:
            err = (body.get("error") or {}).get("message") or body.get("detail") or "Login failed"
            raise ApiError(str(err), status=401)
        self.token = str(token)
        return body

    def me(self) -> dict[str, Any]:
        data = self.get("/api/auth/me")
        if isinstance(data, dict) and "user" in data:
            return data["user"] if isinstance(data["user"], dict) else data
        return data if isinstance(data, dict) else {}

    def modules(self) -> dict[str, Any] | list[Any]:
        body = self.request("GET", "/api/modules", raw=True)
        if isinstance(body, dict):
            if isinstance(body.get("modules"), dict):
                return body["modules"]
            if isinstance(body.get("modules"), list):
                return body["modules"]
            if isinstance(body.get("data"), (dict, list)):
                return body["data"]
        if isinstance(body, list):
            return body
        return {}

    def health(self) -> Any:
        return self.request("GET", "/health", raw=True)

    # --- Monitor ---

    def monitor_stats(self) -> dict[str, Any]:
        data = self.get("/api/system_monitor/stats")
        return data if isinstance(data, dict) else {}

    def process_signal(self, pid: int, signal: str) -> Any:
        return self.post(f"/api/system_monitor/process/{pid}/signal", {"signal": signal})

    # --- Firewall ---

    def firewall_status(self) -> dict[str, Any]:
        data = self.get("/api/firewall/status")
        return data if isinstance(data, dict) else {}

    def firewall_enable(self) -> Any:
        return self.post("/api/firewall/enable")

    def firewall_disable(self) -> Any:
        return self.post("/api/firewall/disable")

    def firewall_add(self, port: str, action: str = "ALLOW", comment: str = "") -> Any:
        return self.post("/api/firewall/add", {"port": port, "action": action, "comment": comment})

    def firewall_delete(self, port: str, action: str) -> Any:
        return self.post("/api/firewall/delete", {"port": port, "action": action})

    # --- Cron ---

    def cron_jobs(self) -> list[dict[str, Any]]:
        data = self.get("/api/cron_manager/jobs")
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("jobs"), list):
            return data["jobs"]
        return []

    def cron_set_active(self, job_id: str, active: bool) -> Any:
        return self.post(f"/api/cron_manager/jobs/{job_id}/state", {"active": active})

    def cron_delete(self, job_id: str) -> Any:
        return self.delete(f"/api/cron_manager/jobs/{job_id}")

    # --- Docker ---

    def docker_list(self) -> list[dict[str, Any]]:
        body = self.request("GET", "/api/docker_manager/list", raw=True)
        if isinstance(body, dict):
            containers = body.get("containers") or body.get("data")
            if isinstance(containers, list):
                return containers
        if isinstance(body, list):
            return body
        return []

    def docker_action(self, action: str, container_id: str) -> Any:
        return self.post(f"/api/docker_manager/{action}", {"container_id": container_id})
