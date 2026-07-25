# CoPanel TUI

Terminal control panel for [CoPanel](https://github.com/phuspeed/CoPanel) — a Textual sidecar that talks to the same JWT `/api/*` backend as Classic/Desktop web UI.

## UI direction

- **Home + Firewall / Cron / Docker**: k9s / lazygit style (lists, tables, keybindings)
- **System Monitor**: btop-lite (CPU / MEM / DISK / NET panels + process table)
- Does **not** replace Classic or Desktop web UI

## Requirements

- Python 3.11+
- A running CoPanel instance (nginx `:8686` or uvicorn `:8000`)

## Install

```bash
# from clone
cd copanel-tui
pip install -e .

# or with uv
uv pip install -e .
```

## Run

```bash
copanel-tui
# or
python -m copanel_tui
```

Optional env:

| Variable | Meaning |
|----------|---------|
| `COPANEL_URL` | Default base URL (e.g. `https://vps:8686`) |
| `COPANEL_USER` | Prefill username |
| `COPANEL_TOKEN_FILE` | Override token path (default `~/.config/copanel/tui_token.json`) |

## Auth

1. Login screen → `POST /api/auth/login`
2. Token stored under `~/.config/copanel/` (mode `0600`)
3. All calls send `Authorization: Bearer <jwt>`

## Modules (v0.1)

| Screen | API |
|--------|-----|
| Home | `GET /api/modules`, `GET /api/auth/me` |
| System Monitor | `GET /api/system_monitor/stats`, process signals |
| Firewall | UFW status / add / delete / enable / disable |
| Cron | list / pause / resume / delete jobs |
| Docker | list containers, start / stop / restart |

## Docs

- [docs/tui-api-surface.md](docs/tui-api-surface.md) — API paths used by this client

## License

MIT
