# Changelog

All notable changes to CoPanel are documented in this file.

## Unreleased

### English

**Fixed / Improved (`site_wizard` 1.2.0, `web_manager` 1.3.0, `database_manager` 1.1.0, `ssl_manager` 1.1.4, `appstore_manager` 1.0.39)**

- Web 1-click runs package installs, downloads, and certbot off the API event loop, so the panel stays usable while a site is provisioning. The installer nginx `/api/` location now allows 300s proxy read/send timeouts.
- PHP extensions use real package names (`php{ver}-mysql` on apt, `php-mysqlnd` on Alma/RHEL). The wizard uses the distro PHP (`auto`) and fails with the missing version instead of pointing nginx at a different PHP-FPM socket.
- Creating a database or user on Linux fails when the `mysql` client is missing. Site users are unique per domain (no 14-character prefix collision) and an existing user that already owns another database is not given a new password.
- A failed wizard rolls back the vhost, database, and document root it created in that run. Downloads use a per-job temp directory and a checksum. Jobs left `running` after a service restart are marked failed (`Interrupted: CoPanel restarted while job was running`).
- Alma/RHEL nginx sites go in `conf.d`, and the PHP-FPM socket is `/run/php-fpm/www.sock` only when `php -v` matches. SSL is off unless the user asks for it, and Let’s Encrypt is skipped when DNS does not point at this server. Site files are chowned to the PHP-FPM user. Commands do not call `sudo` when the panel is already root.
- The wizard UI shows job errors and a warning when polling loses contact. App Store waits up to 10 minutes before restarting `copanel` if a job is still running.

**Security**

- JWT signing no longer falls back to a hard-coded secret. The installer writes a random secret to `/opt/copanel/config/jwt_secret` (mode 0600) and loads it with systemd `EnvironmentFile=-/opt/copanel/config/copanel.env`. Reinstall keeps the existing secret. A missing secret is created on first process start. Password changes and `POST /api/auth/logout` bump `token_version`, so older tokens stop working.
- The API process binds to `127.0.0.1:8000` in the systemd unit. `install.sh` no longer opens port 8000, and a reinstall removes a leftover UFW or firewalld allow rule for `8000/tcp`.
- phpMyAdmin credential save no longer builds a shell command. The MySQL user and password are checked, SQL is passed on stdin, and the credentials file is mode 0600. `GET /api/web_manager/phpmyadmin` and `GET /api/package_manager/credentials/mysql` return `has_password` and do not return the password. (`package_manager` **1.0.6**)
- Database user, host, and schema names are allow-listed before they are placed in SQL. Passwords are sent to `mysql` / `psql` on stdin. (`database_manager` **1.0.9**)
- Custom SSL install and certificate renewal reject domains that are not a real hostname, so a domain cannot escape `/etc/nginx/ssl`. The private key is written mode 0600. (`ssl_manager` **1.1.3**)
- New sites reject a document root or server name that could break out of the nginx config. Document roots must sit under `/var/www` or `/home` (override with `COPANEL_ALLOWED_WEB_ROOTS`). Site Wizard uses the same checks. (`web_manager` **1.2.5**, `site_wizard` **1.1.7**)
- Login is limited to 10 failures per IP and per username in 15 minutes (`429`). No new dependencies. (`auth` **1.0.2**)
- `config/admin_password.txt` is no longer tracked. It is listed in `.gitignore`.

**Fixed / Improved (`docker_manager` 1.0.15)**

- Containers list switches to compact cards when the module/window is narrow; click a container (card or table row) to open a status detail modal (CPU/RAM/network, inspect, actions).
- Long Docker/Compose work (deploy, build, stop, restart, list, scan) no longer blocks the FastAPI event loop — UI stays responsive while tasks run.
- Deploy / stop / restart / build compose stacks and container start/stop/restart/remove run as background jobs with progress in Task Center.
- Containers tab shows live CPU, memory, and network I/O (polled via `GET /stats`).
- Container and compose logs support larger tails, manual refresh, and auto-refresh.
- Project list status uses a single `docker ps` instead of N× `compose ps`.

### Tiếng Việt (tóm tắt)

- Web 1-click không còn làm đơ panel: cài gói chạy ngoài event loop, lỗi apt/PHP/MySQL hiện rõ trên UI. PHP đúng gói distro, không giả lập database khi thiếu mysql, không đụng mật khẩu DB site khác. Cài lại cùng domain an toàn. SSL mặc định tắt và bỏ qua khi DNS chưa trỏ về máy. Alma/RHEL dùng `conf.d` và socket php-fpm đúng. Job dở sau khi restart được đánh dấu lỗi.
- JWT không còn secret mặc định công khai; file secret giữ lại khi cài lại. Đổi mật khẩu hoặc đăng xuất làm token cũ hết hiệu lực.
- API chỉ nghe `127.0.0.1:8000`; cài lại sẽ gỡ rule firewall cổng 8000.
- phpMyAdmin không chạy lệnh qua shell và không trả mật khẩu ở GET. Tên database/user được kiểm tra trước khi đưa vào SQL.
- Chặn domain và document root nguy hiểm (SSL, tạo site). Giới hạn đăng nhập sai (429).
- Danh sách container dạng thẻ khi thu gọn cửa sổ; bấm vào container để xem trạng thái chi tiết.
- Build / deploy / stop / restart không còn làm đơ giao diện CoPanel; có tiến trình job rõ ràng.
- Hiển thị CPU, RAM, network của container; log chi tiết hơn (làm mới / tự làm mới).

## [1.1.4] — 2026-07-23

### English

**Fixed / Improved (UI)**

- App Store Desktop window: catalog scrolls again (`min-h-0` flex chain + featured/categories in the scroll pane); `appstore_manager` **1.0.37**.
- Dock: Packages and App Store no longer share the same icon (`Boxes` vs `ShoppingBag`); `package_manager` **1.0.5**, `appstore_manager` **1.0.36**.
- Package Manager: dedicated **PM2** package (npm global install/lifecycle), dual-UI polish (search, status filters, mobile drawer); `package_manager` **1.0.4+**.
- Docs: `frontend/DESKTOP_UI.md` — required Desktop window scrolling rules for future modules.
- Site Wizard / Web Manager: nginx 502 after WordPress 1-click (PHP-FPM socket detection).
- Dock: audio playback badges no longer force a horizontal taskbar scrollbar.

**Docs / housekeeping**

- README version badges synced to **1.1.4** (were stuck on 1.1.0).

### Tiếng Việt (tóm tắt)

- App Store cửa sổ Desktop cuộn được danh sách app; icon Packages / App Store trên dock khác nhau.
- Package Manager thêm PM2; tài liệu quy tắc scroll Desktop UI.
- Badge phiên bản README cập nhật đúng 1.1.4.

[1.1.4]: https://github.com/phuspeed/CoPanel/releases/tag/v1.1.4

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
