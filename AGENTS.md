# AGENTS.md

See `AGENT_START_HERE.md` for the repo mental model and `README.md` / `QUICKSTART.md`
for full setup and module docs. This file only captures durable, non-obvious
context for agents working in the Cursor Cloud environment.

## Cursor Cloud specific instructions

### Services

CoPanel is a modular Linux VPS management panel with two runtime services:

- Backend — FastAPI (`backend/main.py`), served by uvicorn on port `8000`. Modules
  under `backend/modules/*` are auto-discovered at `/api/<module_id>`.
- Frontend — React + Vite dev server on port `5173`. It proxies `/api/*` to the
  backend at `http://localhost:8000` (see `frontend/vite.config.ts`), so the backend
  must be running for the UI to work.

The update script provisions a Python venv at `backend/venv` and installs frontend
`node_modules`. Standard run/test/build commands live in `README.md`,
`QUICKSTART.md`, and `frontend/package.json`; the notes below only cover caveats.

### Running (development)

- Backend: from `backend/`, run `./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`.
- Frontend: from `frontend/`, run `npm run dev` (open http://localhost:5173).

### Login / first-run auth (non-obvious)

- On first backend start, `backend/core/user_model.py::init_db()` seeds a `admin`
  superadmin. Set `ADMIN_PASSWORD=<pw>` in the backend's environment before the
  first start to get a known password; otherwise a random 12-char password is
  generated and written to `config/admin_password.txt`.
- State persists in `config/copanel.db` (gitignored). Because this repo is not
  installed under `/opt/copanel`, the DB and password file live in the repo-root
  `config/` dir. To reset auth, stop the backend and delete `config/copanel.db`.
- A harmless `panel_settings startup hook: [Errno 13] Permission denied: '/opt/copanel'`
  warning is logged at startup (nginx-gate auto-repair runs only for real
  `/opt/copanel` installs); it does not affect the dev servers.

### Tests / typecheck / build (caveats)

- Backend tests: from `backend/`, run `./venv/bin/python -m pytest`. The FastAPI
  `TestClient` requires `httpx`, which is NOT in `requirements.txt`; the update
  script installs `httpx<0.28` (starlette 0.27's TestClient is incompatible with
  httpx >= 0.28) plus `pytest-asyncio`.
- Two `tests/test_docker_manager_router_backcompat.py` cases fail when the FULL
  suite runs but pass in isolation. This is a pre-existing test-ordering bug:
  `test_api_auth_gate.py` toggles the global `COPANEL_DISABLE_AUTH` flag in
  `core.auth` and leaks that state, so the docker tests then get 401s. Not an
  environment problem — run those tests alone to see them green.
- Frontend has no dedicated lint script; use `npx tsc --noEmit` for type-checking
  and `npm run build` (`tsc && vite build`) for the production build.
