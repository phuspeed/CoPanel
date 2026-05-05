# Frontend Architecture (AI-Optimized)

Read this before changing frontend behavior.

## App Shell

- Route entry: `src/core/routes.tsx`
- Main shell: `src/core/Layout.tsx`
- Module registry: `src/core/registry.ts`
- Dashboard: `src/core/Dashboard.tsx`

## Module Contract

- Each module must provide:
  - `src/modules/<module_id>/config.ts`
  - `src/modules/<module_id>/index.tsx`
- `config.ts` fields: `name`, `icon`, `path`, `component`, `description?`

## Platform Layer (cross-module state)

- Folder: `src/core/platform/`
- Responsibilities:
  - API wrapper (`api.ts`)
  - SSE event hub (`events.ts`)
  - jobs store (`jobsStore.ts`)
  - notifications store (`notificationsStore.ts`)
  - tiny state primitive (`store.ts`)

## Shell Overlays

- `shell/AppLauncher.tsx`: app-centric launcher
- `shell/TaskCenter.tsx`: global long-running task view
- `shell/NotificationCenter.tsx`: inbox
- `shell/ToastLayer.tsx`: transient feedback

## Dashboard Widgets

- Base frame: `widgets/Widget.tsx`
- Core widgets:
  - system health
  - service status
  - SSL expiry
  - recent tasks

## Standard UI Flow For Long Actions

1. Call backend action endpoint.
2. Receive `job_id`.
3. Show progress in Task Center (store + SSE).
4. Show completion/failure via notifications/toasts.

## Avoid

- Local polling loops duplicated in each module for the same global data.
- Module-specific error schema parsing when `platform/api.ts` can handle it.
- Hard `window.location.reload()` for state refresh unless unavoidable.
