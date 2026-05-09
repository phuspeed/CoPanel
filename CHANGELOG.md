# Changelog

All notable changes to CoPanel are documented in this file.

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
