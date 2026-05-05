# CoPanel Agent Quick Map

Purpose: give AI agents the minimum context to work correctly with low token cost.

## 1) Repo Mental Model

- App type: modular VPS/server panel (backend + frontend modules auto-discovered).
- Main runtime:
  - Backend API: `backend/main.py`
  - Frontend shell/router: `frontend/src/core/Layout.tsx`, `frontend/src/core/routes.tsx`
- Module rule:
  - Backend module: `backend/modules/<module_id>/router.py` exports `router`
  - Frontend module: `frontend/src/modules/<module_id>/config.ts` + `index.tsx`

## 2) Request/Data Flow

1. Browser sends request to `/api/...`.
2. FastAPI app in `backend/main.py` runs middleware + handlers.
3. Backend module router handles logic under `/api/<module_id>`.
4. Frontend subscribes to platform events via `/api/platform/events` (SSE).
5. Long-running tasks should run via `core/jobs.py` (Task Center).

## 3) Critical Core Contracts (must keep stable)

- API envelope and errors: `backend/core/api.py`
- Auth/RBAC dependencies: `backend/core/auth.py`
- Audit logging: `backend/core/audit.py`
- Jobs/task orchestration: `backend/core/jobs.py`
- SSE event bus: `backend/core/events.py`
- Notifications inbox: `backend/core/notifications.py`
- Platform module endpoints: `backend/modules/platform/router.py`

## 4) Frontend Platform Contracts

- Shared API/event/stores: `frontend/src/core/platform/`
- Shell overlays:
  - App launcher: `frontend/src/core/shell/AppLauncher.tsx`
  - Task center: `frontend/src/core/shell/TaskCenter.tsx`
  - Notification center: `frontend/src/core/shell/NotificationCenter.tsx`
  - Toasts: `frontend/src/core/shell/ToastLayer.tsx`
- Dashboard widget system: `frontend/src/core/widgets/`

## 5) Where To Implement Typical Requests

- New infra API: add or edit `backend/modules/<module>/router.py` (+ `logic.py` if needed)
- New UI page: `frontend/src/modules/<module>/index.tsx`
- New global behavior (auth, errors, jobs, events): `backend/core/*` and `frontend/src/core/platform/*`
- New cross-module shell UX: `frontend/src/core/Layout.tsx` and `frontend/src/core/shell/*`

## 6) Safe Change Order (recommended)

1. Define backend contract first (request/response/error shape).
2. Add/extend module logic.
3. Wire frontend UI to that contract.
4. Add/adjust Task Center/notifications if action is long-running.
5. Add tests for parser/contract logic.

## 7) Golden Rules For Agents

- Prefer extending existing module contracts over creating new ad-hoc endpoints.
- For long operations, do not block HTTP request; submit a job.
- Emit user-visible status via notifications/events.
- Keep routes backward compatible unless explicitly doing a breaking release.
- Keep docs concise and colocated with implementation.
