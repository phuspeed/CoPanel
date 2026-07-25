# CoPanel TUI — API surface (v0.1)

Base URL: `http(s)://<host>:8686` (preferred) or `:8000`.

Envelope: many endpoints return `{ "status": "success", "data": ... }`. Some legacy routes return fields at the top level (`containers`, `access_token`, …). The client accepts both.

## Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | body `{username, password, totp_code?}` → `access_token` |
| GET | `/api/auth/me` | current user + role |

## Discovery

| Method | Path |
|--------|------|
| GET | `/api/modules` |

## System Monitor

| Method | Path |
|--------|------|
| GET | `/api/system_monitor/stats` |
| GET | `/api/system_monitor/process/{pid}` |
| POST | `/api/system_monitor/process/{pid}/signal` | body `{signal: "term"\|"kill"}` |

## Firewall

| Method | Path |
|--------|------|
| GET | `/api/firewall/status` |
| POST | `/api/firewall/enable` |
| POST | `/api/firewall/disable` |
| POST | `/api/firewall/add` | `{port, action, comment}` |
| POST | `/api/firewall/delete` | `{port, action}` |

## Cron

| Method | Path |
|--------|------|
| GET | `/api/cron_manager/jobs` |
| POST | `/api/cron_manager/jobs/{id}/state` | `{active: bool}` |
| DELETE | `/api/cron_manager/jobs/{id}` |

## Docker

| Method | Path |
|--------|------|
| GET | `/api/docker_manager/list` |
| POST | `/api/docker_manager/start` | `{container_id}` |
| POST | `/api/docker_manager/stop` | `{container_id}` |
| POST | `/api/docker_manager/restart` | `{container_id}` |

## Health

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | none |
