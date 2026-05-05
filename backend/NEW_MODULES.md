# New core modules introduced by the upgrade roadmap

These modules ship in this branch and are ready to be packaged as
versioned zips when you decide to publish them to the AppStore.

| Module          | Backend path                                         | Frontend path                                        | Version |
|-----------------|------------------------------------------------------|------------------------------------------------------|---------|
| `platform`      | `backend/modules/platform/`                          | (no UI - exposes jobs/events/audit/notifications)    | 1.0.0   |
| `site_wizard`   | `backend/modules/site_wizard/`                       | `frontend/src/modules/site_wizard/`                  | 1.0.0   |
| `dns_manager`   | `backend/modules/dns_manager/`                       | `frontend/src/modules/dns_manager/`                  | 1.0.0   |
| `cron_manager`  | `backend/modules/cron_manager/`                      | `frontend/src/modules/cron_manager/`                 | 1.0.0   |

## Release flow (per skill `copanel-appstore-module-release`)

For each module above, when ready:

1. Confirm `version.txt` matches the intended semver.
2. Build the zip:
   ```bash
   python copanel-appstore/scripts/build_versioned_zip.py <module_id> 1.0.0
   ```
3. Add an entry to `copanel-appstore/packages.json` with the new
   `download_url` and changelog entries.
4. Push both repos (`copanel` source + `copanel-appstore` catalog) to
   their respective `main` branches.

## What changed in the existing modules

| Module             | Change                                                                 |
|--------------------|------------------------------------------------------------------------|
| `auth`             | uses `core.auth` for admin enforcement, every action is audited        |
| `database_manager` | unified multi-engine API (`/engines/{engine}/...`) covering Postgres   |
| `docker_manager`   | new `/compose/deploy` endpoint that runs through the job system        |
| `ssl_manager`      | new `/expiry` endpoint powering the SSL widget on the dashboard        |

## Cross-cutting platform additions

- `core/api.py` - standard envelope, exception handlers, `X-Request-Id` header
- `core/auth.py` - shared `require_user`, `require_admin`, `require_module`
- `core/audit.py` - SQLite audit log
- `core/jobs.py` - in-process async job manager + persistence
- `core/events.py` - SSE event bus
- `core/notifications.py` - persisted notification inbox
- `frontend/src/core/platform/` - matching frontend stores and SSE hub
- `frontend/src/core/shell/` - Synology-like shell (App Launcher, Task
  Center, Notification Center, Toast layer)
- `frontend/src/core/widgets/` - dashboard widgets

## Tests

```bash
cd copanel/backend
python -m pytest tests
```

Note: the legacy `system_monitor`, `package_manager`, and other modules do
not yet have unit tests; the new core primitives, DNS logic, and Site
Wizard validation do.
