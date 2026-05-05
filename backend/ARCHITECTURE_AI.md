# Backend Architecture (AI-Optimized)

This file is intentionally compact. Read this before editing backend code.

## Entry + Lifecycle

- Entry file: `backend/main.py`
- Startup:
  - init middleware (`request_context_middleware`)
  - install exception handlers (`install_exception_handlers`)
  - start job workers (`core/jobs.py`)
  - load module routers dynamically (`core/loader.py`)

## Core Layers

- `core/api.py`
  - canonical success/error envelope
  - global exception mapping
  - request id + response time headers
- `core/auth.py`
  - `require_user`, `require_admin`, `require_module(module_id)`
- `core/audit.py`
  - SQLite audit table + query helpers
- `core/jobs.py`
  - async queue + worker pool + persistence
  - states: queued/running/success/failed/cancelled
- `core/events.py`
  - in-process pub/sub + SSE stream formatter
- `core/notifications.py`
  - persisted notification inbox + unread count

## Module System Contract

- Loader scans `backend/modules/*/router.py`.
- Mounted path is always `/api/<module_id>`.
- Router must export `router` (`APIRouter`).

## High-Value Modules

- `modules/platform/router.py`: jobs/events/notifications/audit/metrics APIs
- `modules/site_wizard/`: end-to-end hosting provisioning flow
- `modules/web_manager/`: web stack/site lifecycle
- `modules/database_manager/`: MySQL + Postgres engine routes
- `modules/docker_manager/`: container + compose operations
- `modules/dns_manager/`, `modules/cron_manager/`: ecosystem modules

## Patterns To Reuse

- Validation failure -> raise `ApiError("VALIDATION_ERROR", ...)`
- Permission checks -> `Depends(require_module("<module_id>"))`
- Long action -> `jobs.submit(...)` + return job_id
- Important mutation -> `record_audit(...)`
- User status update -> `notifications.notify(...)`

## Avoid

- Blocking long shell/process work in request thread.
- Inconsistent response schema per endpoint.
- New auth parsers inside modules (use `core/auth.py` only).
