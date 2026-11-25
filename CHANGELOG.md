# Changelog

All notable changes to CoPanel are documented in this file.

## Unreleased

### English

**CoPanel 1.1.17: nginx can read Basic Auth htpasswd files after 1.1.16 lock-down**

- **Regression fix.** 1.1.16 set `config/` to `0700 root:root`, so nginx workers (`www-data` on Debian/Ubuntu, `nginx` on RHEL) could not open `config/panel_access.htpasswd` or `config/web_auth/*.htpasswd`. A panel or site with Basic Auth enabled returned HTTP 500 after upgrade.
- Paths are unchanged so existing vhosts keep working: `config/` and `config/web_auth/` are now `0711 root:root` (traverse by exact path, no directory listing). `panel_access.htpasswd` and `web_auth/*.htpasswd` are `0640 root:<nginx-user>`.
- `jwt_secret`, SQLite DBs, `panel_settings.json` and site auth JSON, and `config/ssl/` (`0700`) stay root-only.
- The nginx worker user is detected from the uncommented `user` directive in `nginx.conf`, then `www-data`, then `nginx`.
- `scripts/install.sh` repairs these permissions on upgrade. The backend (`panel_settings`, `web_manager`) applies the same mode/owner whenever it writes an htpasswd file, and again at service startup so already-upgraded 1.1.16 installs recover on first 1.1.17 start.

**CoPanel 1.1.16: security hardening (root-owned install tree, service & PHP/PM2 validation, download SHA-256)**

- **Install tree ownership (`scripts/install.sh`).** Fixed privilege escalation where `/opt/copanel` (backend, venv, scripts, frontend, config) was `chown -R copanel:copanel` while `copanel.service` runs as `User=root`.
  - `copanel_harden_install_permissions` keeps `/opt/copanel`, `backend`, `venv`, `scripts`, `frontend`, `.git`, `backups`, `logs`, `stacks`, and `/var/lib/copanel` owned by `root:root` with `go-w` on runtime/code and `0700`/`0600` on `config/` secrets and SQLite DBs.
  - Runs as a repair step on upgrades (including after frontend build/extraction) and runs `init_db()` directly as `root`.
  - Newly created `copanel` user uses a `nologin` shell and `-M`; prebuilt tar extraction uses `--no-same-owner`.
- **Web service control (`web_manager`).** `POST /api/web_manager/web_services/{service_id}/{action}` now allowlists `nginx`, `apache2`, and `litespeed`, maps to fixed package and systemd unit names, allowlists `install`/`start`/`stop`/`restart`, and executes via `core.sysexec` with `--` for `systemctl`.
- **PHP version and module validation (`web_manager`).** `toggle_php_module`, `get_enabled_modules`, `get_php_ini`, `save_php_ini`, and `install_php_extensions` enforce `PHP_SUPPORTED_VERSIONS`. `toggle_php_module` validates module names against `^[a-zA-Z0-9_.-]{1,64}$` and rejects leading `-`.
- **PM2 process control (`system_monitor`).** `POST /api/system_monitor/pm2/{action}/{name_or_id}` now requires superadmin (`require_admin`), allowlists actions, validates `name_or_id` (`^[a-zA-Z0-9_.-]{1,128}$`, no leading `-`), verifies the target exists in `pm2 jlist`, passes `--` to `pm2`, and writes an audit entry.
- **Download integrity.** `install_adminer` (`web_manager`) and `copanel_download_prebuilt_frontend` (`scripts/install.sh`) verify SHA-256 checksums (HTTPS-only, fail closed).

**CoPanel 1.1.15: security hardening (signed updates, AppStore integrity, symlink-safe file operations)**

- **Panel Update installs only signed releases.** The updater used to run whatever was on GitHub `main`.
  - It now reads the latest GitHub release and downloads its manifest (`copanel-release.json`: tag + exact commit).
  - It verifies the manifest signature with `ssh-keygen -Y verify` against the release key that ships with the installed panel (`scripts/release/allowed_signers`).
  - It fetches the tag, checks that the tag points to the signed commit, and runs that commit's `install.sh` with `COPANEL_GIT_REF`/`COPANEL_EXPECT_COMMIT`.
  - Any failure stops the update before anything changes, and the panel keeps running.
  - "Update available" now compares against the latest release, not `main`.
  - The install one-liner also installs the latest signed release. A bad signature is refused. If GitHub's API cannot be reached, it falls back to `main` with a warning.
  - `COPANEL_GIT_BRANCH=<branch|tag>` still installs exactly that ref.
  - Release tooling: `scripts/release/make_release.sh` and `docs/RELEASING.md`. Each release carries `CoPanel-<ver>.zip`, the signed manifest and `SHA256SUMS`.
- **AppStore installs are verified (`appstore_manager` 1.0.41).**
  - The server resolves the package by id from the catalog it fetched itself. Download URL, checksum and dependencies sent by the browser are ignored.
  - Official packages must come from the official AppStore repository over https.
  - Every package needs a SHA-256 in `packages.json`, and a mismatch is refused.
  - Archives are extracted safely: no `..`, absolute paths, symlinks or device files, with size limits.
  - apt/yum/pip dependency names are validated and run without a shell.
  - Installing, updating, removing, uploading and source settings are superadmin-only. Community catalog URLs must be https.
- **OAuth popup XSS fixed (`backup_manager` 1.2.16; AppStore `cloud_sync`, `download_manager`).**
  - The public callback page never reflects request text.
  - The payload is escaped JSON, with a nonce CSP and `no-store`/`no-referrer` headers.
  - `postMessage` goes only to the panel's own origin, and the panel checks `event.origin`.
  - Errors are reduced to short codes and exceptions go to the log.
- **File operations for restricted users no longer follow symlinks (`file_manager` 1.0.16, `web_manager` 1.3.3, `platform`).**
  - Every create, write, read, copy, move, delete, zip, extract, chmod, upload and download inside a restricted user's folders walks the path with `O_NOFOLLOW` and works on pinned directory descriptors.
  - Copy keeps symlinks as links, never as copies of what they point to.
  - New files get the home owner with `fchown` at creation. Ownership is changed only on root-owned, single-link items, so a symlink or hard-link swap cannot hand root files to a local account.
  - On an older core these endpoints refuse restricted users (503) instead of falling back to unsafe calls.
- **Folders and the folder picker.**
  - An empty or invalid folder list now means no access (it used to mean all of `/home`).
  - The folder picker requires a module that uses it.
  - Missing home folders are created at login, never by a GET request.
- **Stream tickets.**
  - At most 20 open tickets per user, and 60 per minute (429 above that). One user can no longer evict another user's tickets.
  - Logout revokes the user's tickets.
  - Open event streams and terminal sessions are re-checked every 30 s and closed after logout or a password change.
- **No login token in URLs from AppStore modules.**
  - `web_browser` 1.0.9 WebSocket and `cloud_sync` 1.1.8 log stream use single-use tickets.
  - `audio_station` 0.3.11 `<audio>`/`<img>` URLs use path-scoped media tokens (`POST /api/auth/media-token`, 2 h, valid only for `/api/audio_station/stream` or `/cover`).
  - `cloud_sync` no longer returns OAuth tokens to the browser.
- **Logs.**
  - uvicorn runs with `--no-access-log`.
  - nginx masks the whole query string (every parameter, and the Referer's query) in the access log.
- **Panel Update robustness.**
  - The launcher and the runner share an exclusive lock. A double click gets 409 without touching the running update's log or state.
  - The state directory must be root-owned and `0700`, or the update refuses to start.
- **apt recovery.**
  - `*.copanel-bak` sources from older installs are restored only once (marker in `/var/lib/copanel`).
  - Only sources CoPanel itself disabled are retried.
  - A repository's release-info change is accepted only for that source and only for the fields that changed (`--allow-releaseinfo-change-<field>`).
  - `git safe.directory` is limited to `/opt/copanel` (a `*` entry is removed).
- **No `shell=True` left in the backend.** Database dumps use a no-shell `mysqldump | gzip` pipe. Fail2Ban installs through the package helper.
- Core module versions: `file_manager` 1.0.16, `web_manager` 1.3.3, `terminal` 1.0.9, `backup_manager` 1.2.16, `database_manager` 1.1.1, `firewall` 1.0.9, `appstore_manager` 1.0.41.
- **AppStore modules need CoPanel 1.1.15 for some features.** `cloud_sync` streams and `audio_station` playback need CoPanel 1.1.15. Older cores reject their old URL tokens anyway.

**CoPanel 1.1.14: Panel Update survives the service restart, apt recovery fixed, version and update in the Desktop UI**

- **Panel Update from the web no longer dies half way.** `POST /api/platform/panel-update/run` used to run `install.sh` as a child of the API process and stream its output over one long HTTP request. Through nginx (`proxy_read_timeout 300s`) or Cloudflare Tunnel (~100 s idle), a long silent step such as `vite build` closed that request; the browser showed "network error", the output pipe was closed and the installer was killed (and, running inside `copanel.service`, it also skipped the service stop and died with the service). Also, run as `/opt/copanel/scripts/install.sh`, the installer took its "local source" path and never ran `git pull`, so the version stayed old.
  - The update now runs in its own systemd transient unit (`systemd-run --unit=copanel-update --collect`, no shell), outside the `copanel.service` cgroup. A small runner stages the newest `install.sh` from `origin/main` into `/var/lib/copanel-update/` and runs it from there, so it takes the git-update path and `git reset` cannot rewrite the script it is reading. Output goes to `/var/lib/copanel-update/update.log`, status and exit code to `state.json`.
  - New `GET /api/platform/panel-update/status?offset=` (superadmin) returns the status (`idle`, `starting`, `running`, `success`, `failed`, `interrupted`) and the log from a byte offset. The upgrade dialog polls it, shows "Restarting the CoPanel service…" while the API is down, keeps retrying, and reloads once `/health` reports the new version. Reloading the page during an update reattaches to it. A second start while one runs gets 409.
- **apt recovery only disables the source that fails.** The recovery matched every source named anywhere in the `apt-get update` output (including "Hit:" lines), so one failing PPA disabled all sources, `ubuntu.sources` included. It now looks only at error lines (`E:`, `Err:`, `W: Failed to fetch`), never disables distro sources (`ubuntu.sources`, `debian.sources`, Ubuntu/Debian mirrors), and first accepts a repository's release-info change (`--allow-releaseinfo-change`, e.g. the ondrej PPA's Label changing to "(deprecated)"). Sources moved aside as `*.copanel-bak` by earlier installs are restored at the start of the next install; only a source that still fails is disabled again.
- **Low-RAM hosts use the committed frontend bundle.** On hosts with ≤ 2 GB RAM (`COPANEL_LOW_MEM_MB`) the installer uses `frontend/prebuilt/dist.tar.gz` instead of running Vite when the bundle is at least as new as the frontend sources in git and no AppStore module needs a Vite build. `COPANEL_FORCE_FRONTEND_BUILD=1` builds anyway. CPUs without AVX are unchanged (always prebuilt).

- The Desktop UI taskbar shows the installed version as a small badge in the system tray (next to the clock). When a newer version is on GitHub it turns amber with an arrow, and its tooltip names the new version. For the superadmin, clicking it opens the same "Upgrade CoPanel" dialog as the Classic sidebar footer: installed → new version, release notes, GitHub link, progress bar, installer log, Close / Start upgrade.
- The dialog sits above app windows and below the dock. Classic and Desktop now share one dialog component and one update check (`usePanelUpdate`); Classic behaviour is unchanged.

**CoPanel 1.1.13: core modules on CPUs without AVX, dialogs inside app windows, restricted-user audit**

- **Terminal (`terminal` 1.0.8).** The AppStore's `terminal` 1.0.7 zip carried older code than the panel (it still used `?access_token=` on `/api/terminal/ws` and had no mobile layout), so it would break the terminal on panels 1.1.10+. The panel's terminal is now 1.0.8 and the AppStore zip is rebuilt from it.
- **AppStore on CPUs without AVX (`appstore_manager` 1.0.40).** The panel always uses its own built-in UI for core modules (an AppStore UI bundle for a core module id is ignored), so a core-module zip no longer fails with "This CPU has no AVX…". On a no-AVX host it installs the backend only and logs that the UI comes with Panel Settings → Update. Core modules are recognised from the catalog's `is_core` flag, or, if missing, because the module is tracked in the panel's git checkout. Hosts with AVX keep the normal rebuild. Other (non-core) packages still need a prebuilt/extension bundle on no-AVX CPUs, as before. Core modules should be updated with Panel Update; the AppStore entry is only a backend refresh.
- **Dialogs in AppStore apps.** AppStore apps bundle their own copy of the window modal, which could not see the desktop window and opened behind it. The panel modal now finds the enclosing app window through the DOM and opens inside it; dialogs from already-installed apps that still open on the page body are lifted above windows (below the dock and start menu). No AppStore app reinstall is needed.
- **Restricted users.**
  - File Manager extract (`file_manager` 1.0.15): extracted files and folders get the home folder's owner, like upload/create.
  - Web Manager (`web_manager` 1.3.2): for non-superadmin users, a new site's document root must be inside their permitted folders (403 outside); a new document root gets the home owner.
  - Users panel: Package Manager system packages (Nginx, Node.js & npm, Zip & Unzip, …) are no longer offered as grantable modules. They have no panel UI or API, so granting them did nothing.
  - Not changed, admin-only by design: Docker Manager/Docker Engine (docker access is root-equivalent), SSL Manager and Web Manager's raw vhost editing, PHP, services and phpMyAdmin settings (server-wide). Grant these only to administrators.

**Fixed: restricted users can write in their own folders (CoPanel 1.1.12, `file_manager` 1.0.14, `platform` 1.0.3, `auth` 1.0.3)**

- Creating or editing a non-superadmin user now creates each missing permitted folder (e.g. `/home/phutv`, mode 0750). Before, the panel never created it: File Manager showed an empty folder, and creating a file or uploading into it failed. File Manager and the folder picker also create a missing permitted folder on first open.
- A created home is owned by the system account of the same name when that account exists and its home is this folder (no system users are created). Files and folders a restricted user creates, uploads, copies or zips in a folder owned by a non-root account get that owner; root-owned folders stay root-owned.
- File Manager shows the server's error message (e.g. access denied, folder missing) instead of a generic "Create failed" / "Upload failed".
- Access rules are unchanged: full read/write inside permitted folders, including the folder itself; 403 outside; upload/symlink protections from 1.0.13 kept.

**Security: File Manager upload stays in the target folder (`file_manager` 1.0.13)**

- Upload kept the client-supplied file name as-is, so a name with directory parts or an absolute path could be written outside the chosen folder and outside a user's permitted folders. Upload now keeps only the base name, rejects empty, `.`, `..` and NUL names with 400, and re-checks the final path with `check_safe_path` (symlinks resolved) before writing. A symlink in the folder that points outside the user's permitted folders is refused with 403.
- Copy and move-multiple re-check the final destination the same way.
- All `/api/file_manager/*` endpoints now require the `file_manager` module grant (`require_module`), not only a valid login. Superadmin is unchanged.
- New directory-only folder picker for other modules (CoPanel **1.1.11**, `platform` 1.0.2, `docker_manager` 1.0.19): `GET /api/platform/folder-picker?path=` lists sub-folders (no files) and `POST /api/platform/folder-picker/create-dir` creates one folder. Any logged-in user may use it, limited to their permitted folders (403 outside). Docker Manager's project folder picker uses it, so it works for users who have Docker Manager but not File Manager; outside their folders it falls back to their first permitted folder.

**File Manager: type a path (`file_manager` 1.0.12)**

- The path bar is editable. Click the pencil icon, empty space in the bar, or double-click it to get a text box pre-filled with the current folder. Enter opens the path, Esc or clicking away cancels. Absolute paths (`/var/www`) and paths relative to the current folder (`logs`, `../www`) work; duplicate/trailing slashes and `.`/`..` are normalized. `~` is not expanded.
- A missing folder, a file, or a folder you may not open shows an error toast and keeps the current folder. `GET /api/file_manager/list` takes `must_exist=1` for this (404 for a missing path, 403 for an unreadable one); without it the old empty-listing behaviour is unchanged. Access rules are the same: non-superadmin users are still confined to their permitted folders.

**Security: no JWTs in URLs**

- EventSource / WebSocket endpoints (`/api/platform/events`, `/api/backup_manager/stream_task/*`, `/api/terminal/ws`) no longer accept the 24h JWT as `?access_token=`/`?token=`. The SPA calls `POST /api/auth/stream-ticket` (Bearer) and connects with `?ticket=`, an opaque single-use value valid for 60 seconds and bound to the user's `token_version`.
- The installer nginx site logs with `log_format copanel_redacted`, which replaces `access_token`, `token` and `ticket` query values with `REDACTED`.

**Fixed / Improved (`site_wizard` 1.2.0, `web_manager` 1.3.1, `database_manager` 1.1.0, `ssl_manager` 1.1.4, `appstore_manager` 1.0.39)**

- Web 1-click runs package installs, downloads, and certbot off the API event loop, so the panel stays usable while a site is provisioning. The installer nginx `/api/` location now allows 300s proxy read/send timeouts.
- PHP extensions use real package names (`php{ver}-mysql` on apt, `php-mysqlnd` on Alma/RHEL). The wizard uses the distro PHP (`auto`) and fails with the missing version instead of pointing nginx at a different PHP-FPM socket.
- Creating a database or user on Linux fails when the `mysql` client is missing. Site users are unique per domain (no 14-character prefix collision) and an existing user that already owns another database is not given a new password.
- A failed wizard rolls back the vhost, database, and document root it created in that run. Downloads use a per-job temp directory and a checksum. Jobs left `running` after a service restart are marked failed (`Interrupted: CoPanel restarted while job was running`).
- Alma/RHEL nginx sites go in `conf.d`, and the PHP-FPM socket is `/run/php-fpm/www.sock` only when `php -v` matches. SSL is off unless the user asks for it, and Let’s Encrypt is skipped when DNS does not point at this server. Site files are chowned to the PHP-FPM user. Commands do not call `sudo` when the panel is already root.
- The wizard UI shows job errors and a warning when polling loses contact. App Store waits up to 10 minutes before restarting `copanel` if a job is still running.

**Fixed**

- phpMyAdmin on port 8686 no longer returns 502 when the panel is opened through a Cloudflare Tunnel. Package Manager installs PHP-FPM with phpMyAdmin (the apt package alone often leaves only Apache's mod_php, so nginx had no FastCGI socket). The panel nginx site uses that one live socket instead of a `max_fails=1` list of missing sockets, and gives phpMyAdmin the forwarded HTTPS scheme. Direct `http://HOST:8686/phpmyadmin/` stays plain HTTP. (`package_manager` **1.0.7**, `web_manager` **1.3.1**)
- `install.sh` on a CPU without AVX installs `frontend/prebuilt/dist.tar.gz` and does not run Vite. Native esbuild and esbuild-wasm both segfault on that CPU (`Segmentation fault`, including `runtime/asm_wasm.s`). The panel that worked before the HTTPS upgrade already had a compiled `dist`; the upgrade was deleting it and compiling on the NUC.

**Security**

- Port 8686 is plain HTTP again. The self-signed HTTPS listener, the loopback `127.0.0.1:8687` tunnel origin, and the `/<token>/` entrance are removed because Cloudflare Tunnel could not complete a TLS handshake to the panel (`502 Bad Gateway`). Upgrade rewrites nginx to `listen 8686` and deletes a leftover token file. Open `http://<lan-ip>:8686/`. Tunnel origin: `http://<lan-ip>:8686` or `http://localhost:8686`. (`panel_settings` **1.1.4**)

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

- CoPanel 1.1.17 (bảo mật):
  - **Sửa hồi quy Basic Auth sau 1.1.16.** Bản 1.1.16 khoá `config/` ở `0700 root:root`, nên worker nginx (`www-data` / `nginx` trên RHEL) không đọc được `panel_access.htpasswd` và `config/web_auth/*.htpasswd`. Panel hoặc website đang bật Basic Auth sẽ trả HTTP 500 sau khi nâng cấp.
  - Giữ nguyên đường dẫn (vhost cũ không cần viết lại): `config/` và `config/web_auth/` là `0711 root:root` (đi theo đúng đường dẫn, không liệt kê được thư mục). File htpasswd là `0640 root:<user-nginx>`.
  - `jwt_secret`, cơ sở dữ liệu SQLite, JSON cấu hình, và `config/ssl/` (`0700`) vẫn chỉ root đọc được.
  - Tự nhận diện user nginx từ `nginx.conf`, rồi `www-data`, rồi `nginx`.
  - `scripts/install.sh` tự sửa quyền khi nâng cấp. Backend gán đúng quyền mỗi lần ghi htpasswd, và sửa lại lúc khởi động dịch vụ để máy đã lên 1.1.16 phục hồi khi chạy 1.1.17 lần đầu.
- CoPanel 1.1.16 (bảo mật):
  - **Quyền sở hữu thư mục cài đặt (`scripts/install.sh`)**: sửa lỗi leo quyền từ user `copanel` lên `root` do `/opt/copanel` trước đây thuộc `copanel:copanel` trong khi `copanel.service` chạy `User=root`. Giờ `root:root` sở hữu `/opt/copanel` (backend, venv, scripts, frontend, `.git`, `config`, dữ liệu/log), bỏ quyền ghi nhóm/khác, khoá `config/` ở `0700`/`0600` và tự động sửa lại khi nâng cấp từ bản cũ.
  - **Điều khiển dịch vụ web (`web_manager`)**: `POST /api/web_manager/web_services/{service_id}/{action}` chỉ cho phép `nginx`, `apache2`, `litespeed` và các hành động hợp lệ, ánh xạ tên gói/unit cố định, chạy qua `core.sysexec` và truyền `--` cho `systemctl`.
  - **Kiểm tra phiên bản & module PHP (`web_manager`)**: ép buộc `PHP_SUPPORTED_VERSIONS` cho `module_toggle`, `modules/{version}`, `php_ini` và `install_php_extensions`; tên module phải khớp `^[a-zA-Z0-9_.-]{1,64}$` và không bắt đầu bằng `-`.
  - **Quản lý PM2 (`system_monitor`)**: `POST /api/system_monitor/pm2/{action}/{name_or_id}` yêu cầu quyền superadmin (`require_admin`), kiểm tra hành động và tên/ID hợp lệ, đối chiếu đúng tiến trình đang có trong `pm2 jlist`, truyền `--` cho `pm2` và ghi nhật ký kiểm toán.
  - **Kiểm tra SHA-256 khi tải xuống**: xác minh SHA-256 cho Adminer 4.8.1 và gói frontend build sẵn khi tải từ GitHub release.
- CoPanel 1.1.15 (bảo mật):
  - **Cập nhật panel chỉ cài bản phát hành đã ký.**
    - Trình cập nhật đọc release mới nhất trên GitHub và kiểm tra chữ ký của manifest (`ssh-keygen -Y verify`, khoá công khai đi kèm panel).
    - Nó kiểm tra tag trỏ đúng commit đã ký rồi mới chạy `install.sh` của commit đó.
    - Có lỗi là dừng, không thay đổi gì.
    - Lệnh cài một dòng cũng cài release đã ký. Chữ ký sai thì từ chối cài.
  - **AppStore**:
    - Gói được lấy theo id từ danh mục phía server và phải có SHA-256 khớp.
    - Chỉ tải từ kho chính thức qua https.
    - Giải nén an toàn và không dùng shell.
    - Cài, gỡ, tải lên chỉ dành cho superadmin.
  - **Sửa XSS ở trang OAuth popup** (backup_manager, cloud_sync, download_manager).
  - **Thao tác file của người dùng bị giới hạn không còn đi theo symlink**:
    - Mở từng thành phần đường dẫn bằng `O_NOFOLLOW`.
    - `fchown` ngay lúc tạo.
    - Sao chép giữ nguyên symlink.
  - **Thư mục và trình chọn thư mục**:
    - Danh sách thư mục rỗng nghĩa là không có quyền.
    - Trình chọn thư mục cần module phù hợp.
    - Thư mục home được tạo khi đăng nhập, không tạo từ GET.
  - **Stream ticket**:
    - Tối đa 20 ticket/người dùng, 60 ticket/phút.
    - Đăng xuất là thu hồi.
    - Stream đang mở được kiểm tra lại mỗi 30 giây.
  - **Module AppStore không còn đưa JWT lên URL**: web_browser và cloud_sync dùng ticket, audio_station dùng media token theo đường dẫn.
  - **Log**:
    - uvicorn tắt access log.
    - nginx che toàn bộ query string.
  - **Cập nhật panel**:
    - Có khoá độc quyền: bấm hai lần sẽ nhận 409.
    - Thư mục trạng thái phải là `0700` thuộc root.
  - **apt**:
    - Khôi phục `*.copanel-bak` chỉ một lần.
    - Chỉ thử lại nguồn do CoPanel tắt.
    - Chấp nhận thay đổi release-info theo từng nguồn, từng trường.
    - `safe.directory` chỉ cho `/opt/copanel`.
  - Backend không còn `shell=True`.
- CoPanel 1.1.14: Cập nhật panel từ web không còn bị chết giữa chừng. Trước đây install.sh chạy như tiến trình con của API và đẩy log qua một request HTTP dài; khi `vite build` im lặng lâu, nginx/Cloudflare Tunnel cắt request ("network error") và installer bị kill; ngoài ra chạy từ `/opt/copanel/scripts/install.sh` thì không `git pull` nên version vẫn cũ. Giờ bản cập nhật chạy trong unit systemd riêng (`systemd-run --unit=copanel-update`), lấy install.sh mới nhất từ `origin/main`, ghi log vào `/var/lib/copanel-update/update.log`; giao diện hỏi trạng thái qua `GET /api/platform/panel-update/status`, hiện "Đang khởi động lại dịch vụ…" khi API tạm tắt và tự tải lại khi lên bản mới.
- Khôi phục apt chỉ tắt nguồn thực sự lỗi (chỉ đọc dòng lỗi), không bao giờ tắt `ubuntu.sources`/`debian.sources`, chấp nhận thay đổi Label của PPA (`--allow-releaseinfo-change`), và tự khôi phục các file `*.copanel-bak` do bản cũ tạo ra.
- Máy RAM ≤ 2 GB dùng frontend build sẵn (`frontend/prebuilt/dist.tar.gz`) thay vì chạy Vite khi bản build sẵn khớp mã nguồn; `COPANEL_FORCE_FRONTEND_BUILD=1` để vẫn build.
- CoPanel 1.1.14: Thanh taskbar giao diện Desktop hiện phiên bản đang cài (nhãn nhỏ cạnh đồng hồ). Khi GitHub có bản mới, nhãn chuyển màu vàng có mũi tên; superadmin bấm vào sẽ mở đúng hộp thoại "Nâng cấp CoPanel" như giao diện Classic (phiên bản cũ → mới, nhật ký phiên bản, link GitHub, tiến trình, nhật ký cài đặt, Đóng / Bắt đầu nâng cấp). Hộp thoại nằm trên các cửa sổ ứng dụng, dưới thanh dock.

- CoPanel 1.1.13: Terminal lên 1.0.8 (bản 1.0.7 trên AppStore là code cũ hơn, dùng `?access_token=` nên sẽ làm hỏng terminal); zip AppStore được build lại từ panel.
- AppStore trên CPU không có AVX (`appstore_manager` 1.0.40): module lõi (terminal, file_manager, docker_manager…) không còn báo lỗi "no AVX"; chỉ cài phần backend, giao diện đi kèm Panel Update (panel luôn dùng giao diện có sẵn cho module lõi). Module lõi nên cập nhật bằng Panel Update.
- Hộp thoại của ứng dụng AppStore giờ mở bên trong cửa sổ ứng dụng thay vì nằm phía sau; ứng dụng đã cài không cần cài lại.
- User bị giới hạn: giải nén trong File Manager (1.0.15) giao quyền sở hữu cho chủ thư mục home; Web Manager (1.3.2) chỉ cho tạo site có thư mục gốc nằm trong thư mục được cấp (ngoài ra 403). Trang Users không còn liệt kê gói hệ thống (Nginx, Node.js & npm, Zip & Unzip) như module để cấp quyền. Docker, SSL Manager và các phần cấu hình server của Web Manager chỉ nên cấp cho admin.

- User bị giới hạn giờ tạo/sửa/xoá/tải lên được trong thư mục của mình (CoPanel 1.1.12). Panel tự tạo thư mục được cấp (vd `/home/phutv`) khi tạo/sửa user hoặc lần đầu mở File Manager; nếu có tài khoản Linux cùng tên có home là thư mục đó thì giao quyền sở hữu cho tài khoản đó. File Manager hiện đúng thông báo lỗi từ server thay vì "Create failed". Ngoài thư mục được cấp vẫn bị chặn (403).
- Bảo mật File Manager (1.0.13): upload chỉ giữ tên file, chặn tên rỗng, `.`, `..`, ký tự NUL, và kiểm tra lại đường dẫn cuối (kể cả symlink) trước khi ghi, nên không ghi được ra ngoài thư mục đích hay thư mục được cấp. Copy/di chuyển nhiều file cũng kiểm tra lại đích. Mọi API File Manager giờ cần quyền module `file_manager`, không chỉ cần đăng nhập.
- Chọn thư mục (CoPanel 1.1.11): Docker Manager dùng API chọn thư mục riêng, chỉ liệt kê thư mục (không có file) và tạo thư mục mới. User có quyền ở thư mục nào thì chọn được thư mục trong đó, không cần quyền File Manager.
- File Manager: gõ được đường dẫn trên thanh địa chỉ (bấm biểu tượng bút chì, chỗ trống trên thanh, hoặc nhấp đúp). Enter để mở, Esc/bấm ra ngoài để huỷ. Hỗ trợ đường dẫn tuyệt đối và tương đối với thư mục hiện tại. Đường dẫn không tồn tại hoặc không có quyền sẽ báo lỗi và giữ nguyên thư mục hiện tại.
- phpMyAdmin qua Cloudflare Tunnel không còn 502. Cài PHP-FPM cùng phpMyAdmin, nginx trỏ một socket đang chạy, và nhận scheme HTTPS từ tunnel. Mở trực tiếp `http://HOST:8686/phpmyadmin/` vẫn là HTTP.
- Máy không có AVX (Intel NUC) không còn chạy Vite lúc cài. Installer giải nén frontend đã build sẵn, vì esbuild native và WASM đều bị segfault trên CPU này.
- Web 1-click không còn làm đơ panel: cài gói chạy ngoài event loop, lỗi apt/PHP/MySQL hiện rõ trên UI. PHP đúng gói distro, không giả lập database khi thiếu mysql, không đụng mật khẩu DB site khác. Cài lại cùng domain an toàn. SSL mặc định tắt và bỏ qua khi DNS chưa trỏ về máy. Alma/RHEL dùng `conf.d` và socket php-fpm đúng. Job dở sau khi restart được đánh dấu lỗi.
- Cổng 8686 trở lại HTTP thường. Gỡ HTTPS tự ký, origin loopback `127.0.0.1:8687` và đường dẫn `/<token>/` vì Cloudflare Tunnel bị 502 khi bắt tay TLS với panel. Nâng cấp ghi lại nginx `listen 8686`. Mở `http://<ip-lan>:8686/`. Origin tunnel: `http://<ip-lan>:8686` hoặc `http://localhost:8686`.
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
