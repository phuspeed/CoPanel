# Changelog

All notable changes to CoPanel are documented in this file.

## [1.1.3] — 2026-07-21

### English

**Fixed / Improved**

- Classic mobile layout: module sidebars use a collapsible drawer instead of a fixed 200px column (App Store, Files, Settings, Web, SSL, Docker, Backup, Site Wizard, System Monitor, Database, Cleaner, Package Manager, Firewall, Cron, DNS, Terminal snippets overlay).
- Branding wallpaper gallery updates the Desktop shell immediately after save (no manual refresh).
- App Store featured cards stack on narrow screens to avoid horizontal clipping.

**AppStore (non-core) packages**

- Mobile drawer sidebars: `audio_station` 0.3.8, `download_manager` 0.2.15, `storage_manager` 1.6.2, `cloudflare_ddns` 1.0.12, `cloud_sync` 1.1.6.

### Tiếng Việt (tóm tắt)

- Mobile classic: sidebar module dạng drawer; Terminal snippets overlay; cập nhật hình nền không cần F5.
- ZIP AppStore non-core đã bump phiên bản kèm drawer tương tự.

[1.1.3]: https://github.com/phuspeed/CoPanel/releases/tag/v1.1.3

## [1.1.2] — 2026-07-21

### English

**Fixed**

- Frontend calls that hit the new API auth gate without a Bearer token (401):
  - `Layout` package_manager polling
  - `UsersPanel` `/api/modules` + package list
  - All `docker_manager` UI fetches (list/start/stop/compose/projects/…)
- Added shared `frontend/src/core/authHeaders.ts` (`apiFetch` / `getAuthHeaders`).

### Tiếng Việt (tóm tắt)

- Sửa 401 trên Package Manager (Layout) và Docker Manager: frontend gửi JWT sau khi bật auth gate ở 1.1.1.

[1.1.2]: https://github.com/phuspeed/CoPanel/releases/tag/v1.1.2

## [1.1.1] — 2026-07-19

### English

**Security**

- Global JWT gate for `/api/*` (except login, public branding, OAuth callback) so DevTools / unauthenticated callers cannot invoke panel APIs.
- Enforce `require_module` on previously open routers: docker, web, database, SSL, firewall, backup, package, and appstore managers.
- Authenticate terminal WebSocket before accept; SPA passes `access_token` query param.
- Desktop shell waits for `/api/auth/me` before rendering (blocks fake `localStorage` session flash).

**Added / Changed (since 1.1.0)**

- Desktop UI / NAS-style module layouts and mobile “request desktop site” viewport toggle.
- Backup manager EventSource streams include `access_token` for SSE under the auth gate.
- Regression tests: `backend/tests/test_api_auth_gate.py`.

### Tiếng Việt (tóm tắt)

- Vá lỗ hổng bypass login: middleware JWT toàn cục + `require_module` cho các API trước đây mở; Terminal WS bắt buộc token.
- SPA xác minh session trước khi hiện desktop.
- Gồm các cải tiến Desktop UI / mobile kể từ 1.1.0.

[1.1.1]: https://github.com/phuspeed/CoPanel/releases/tag/v1.1.1

## [1.1.0] — 2026-05-09

### English

**Added**

- Root `VERSION` file: single semver source for the panel, compared against `main` on GitHub.
- `backend/core/panel_update.py`: compare local install vs remote `VERSION`; optional release notes from GitHub Releases API.
- Superadmin APIs: `GET /api/platform/panel-update/check`, `POST /api/platform/panel-update/run` (streams `scripts/install.sh` stdout for in-panel upgrades).
- Frontend `Layout`: upgrade modal with release notes, progress bar, live installer log, health polling / reload after success.
- `install.sh`: resolves displayed version from `VERSION`, `/opt/copanel/VERSION`, or git tags; skips terminal `clear` when `COPANEL_NONINTERACTIVE=1` (streamed upgrades).

**Changed**

- `main.py`: FastAPI `version` and `/health` read semver from the `VERSION` file (with fallbacks).

**Operations**

- Self-upgrade expects a standard Linux deployment under `/opt/copanel` with `scripts/install.sh` (default installer uses `User=root` for the `copanel` service).

### Tiếng Việt (tóm tắt)

- Thêm file `VERSION` ở root để đồng bộ phiên bản với nhánh `main` trên GitHub.
- Kiểm tra cập nhật và nâng cấp trong panel (superadmin): modal, log trực tiếp từ `install.sh`, thanh tiến trình, tự tải lại trang khi xong.
- `install.sh` tự nhận diện phiên bản từ file `VERSION`, thư mục cài đặt, hoặc git; banner/tóm tắt cài đặt không còn semver cố định.

[1.1.0]: https://github.com/phuspeed/CoPanel/releases/tag/v1.1.0
