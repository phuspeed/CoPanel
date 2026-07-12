# CoPanel — Dual UI Module Guide (Classic + Desktop)

> **Unified codebase on `main`:** Classic sidebar and Desktop shell (dock, floating windows) ship together. Toggle in the panel or set `COPANEL_UI_TRACK=desktop` at install. **One AppStore ZIP works for both UIs.**

| Doc | Audience |
|-----|----------|
| This file | Module authors — frontend dual-UI pattern |
| [README.md](../README.md) | Install & overview |
| [CoPanel-AppStore](https://github.com/phuspeed/CoPanel-AppStore) | ZIP packaging & `packages.json` |

## Install / enable Desktop UI

```bash
# Desktop track (unified install.sh)
sudo bash scripts/install.sh --desktop

# Or one-liner
curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=main" \
  | sudo bash -s -- --desktop
```

Web UI (classic): `install.sh` or `install.sh --classic`.  
Toggle anytime in panel · `localStorage` `copanel_desktop_ui` = `1`|`0`.

---

## Kiến trúc tổng quan

```
DesktopShell (wallpaper + icons)
    └── WindowLayer
            └── AppWindow (title bar, drag, resize)
                    └── WindowViewportBody  ← scroll container
                            └── ModuleViewport
                                    └── Your module (index.tsx)
```

| Lớp | File | Vai trò |
|-----|------|---------|
| Window manager | `core/shell/windowStore.ts` | open/close/focus/snap/persist |
| Window chrome | `core/shell/AppWindow.tsx` | drag, resize, traffic lights |
| Viewport context | `core/shell/WindowViewportContext.tsx` | ref cho modal trong window |
| Module wrapper | `core/shell/ModuleViewport.tsx` | `h-full` vs `min-h-screen` |
| Modal scoped | `core/shell/WindowModal.tsx` | overlay trong window, không phủ desktop |
| Shell context | `core/hooks/useAppShellContext.ts` | theme + language (Outlet hoặc window) |

Module **không** mount qua React Router `<Outlet />` khi mở window — mount trực tiếp trong `WindowLayer`. Dùng `useAppShellContext()`, **không** dùng `useOutletContext()` trực tiếp.

---

## Bật window mode cho module

`src/modules/<id>/config.ts`:

```typescript
import YourComponent from './index';

export default {
  name: 'My Module',
  icon: 'Box',                    // lucide icon name
  path: '/my-module',
  description: 'Short description',
  component: YourComponent,

  // Desktop UI (optional — classic full-page if omitted)
  windowMode: true,
  defaultWindowSize: { width: 960, height: 640 },
  minWindowSize: { width: 480, height: 320 },  // reserved
  singleton: true,    // one instance per path (default true)
  pinned: true,       // show on dock quick-launch
};
```

| Field | Mặc định | Ý nghĩa |
|-------|----------|---------|
| `windowMode` | `false` | Mở popup thay vì navigate full-page (desktop mode) |
| `defaultWindowSize` | 960×640 | Kích thước lần đầu (hoặc restore từ localStorage) |
| `singleton` | `true` | Click lại → focus window cũ |
| `pinned` | `false` | Icon trên dock |

**Lưu layout:** `localStorage` key `copanel_window_layout_v1` — vị trí/size/maximize/snap theo `modulePath`.

---

## Template module mới

```tsx
// src/modules/my_module/index.tsx
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import WindowModal from '../../core/shell/WindowModal';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';

export default function MyModule() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const isWindowed = useIsWindowedModule();

  return (
    <ModuleViewport className="flex min-h-0 flex-col">
      {/* Root: h-full chain — KHÔNG min-h-screen / 100vh trong window mode */}
      <header className="shrink-0 border-b px-4 py-3">...</header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Nội dung chính scroll ở đây */}
      </main>
    </ModuleViewport>
  );
}
```

---

## Quy tắc layout (quan trọng)

### DO

- Bọc root bằng `<ModuleViewport>` — tự chọn `h-full min-h-0` (window) hoặc `min-h-screen` (classic).
- Flex column: `flex flex-col h-full` → header `shrink-0` → body `flex-1 min-h-0 overflow-y-auto`.
- Dùng `useAppShellContext()` cho theme/language.
- Modal/dialog: `<WindowModal open={...}>` — overlay nằm trong cửa sổ.
- Tables/lists: scroll trong body, không scroll cả page.

### DON'T

- `min-h-screen`, `h-screen`, `100vh` — vượt khung window, double scroll.
- `fixed inset-0` cho modal — che desktop + dock; dùng `WindowModal`.
- Giả định sidebar CoPanel hiển thị — desktop mode ẩn sidebar.
- `useOutletContext()` — không có khi chạy window.

### Z-index tham chiếu

| Lớp | z-index |
|-----|---------|
| Desktop / wallpaper | 0 |
| App windows | 100+ |
| Modal trong window (`WindowModal`) | 80 (trong viewport) |
| App Launcher | 210 |
| Task / Notification drawer | 200 |
| Toast | 9999 |

---

## WindowModal

```tsx
<WindowModal
  open={dialogOpen}
  onClose={() => setDialogOpen(false)}
  title="Confirm"
  maxWidth="lg"   // sm | md | lg | xl | 2xl
>
  <div className="p-4">...</div>
</WindowModal>
```

- **Window mode:** portal vào `.module-window-viewport` — chỉ phủ module.
- **Classic mode:** portal `document.body` — full viewport (như cũ).

---

## Keyboard (desktop mode)

| Phím | Hành động |
|------|-----------|
| `Ctrl/Cmd+K` | App Launcher |
| `Alt+Tab` | Chuyển focus window |
| `Alt+Shift+Tab` | Chuyển ngược |
| `Ctrl+W` | Đóng window đang focus |
| `Alt+←` | Snap trái 50% |
| `Alt+→` | Snap phải 50% |
| `Alt+↓` | Bỏ snap / restore bounds |
| Double-click title bar | Maximize / restore |
| Kéo sát mép trái/phải | Snap |

Không kích hoạt khi focus trong `input` / `textarea`.

---

## Classic vs Desktop

| | Classic | Desktop |
|---|---------|---------|
| Bật | `<1024px` hoặc toggle dock | `≥1024px` mặc định |
| Navigation | Sidebar + route | Icon desktop + window |
| `windowMode` module route | Full page OK | Redirect → desktop + open window |
| Mobile | Luôn classic | — |

Toggle: dock (icon panel) hoặc Monitor trên top bar classic.  
`localStorage`: `copanel_desktop_ui` = `1` | `0`.

---

## Mở module từ code

```typescript
import { openModuleWindow } from '../../core/shell/openModuleWindow';

openModuleWindow('/file-manager');  // no-op if windowMode false
```

App Store nút **Open** dùng pattern này cho package đã cài.

---

## Desktop UI status (2026-07-10)

Legend:

| Grade | Meaning |
|-------|---------|
| **A — Full window** | `windowMode` + `ModuleViewport` + `useAppShellContext` + `WindowModal` (modals) |
| **B — Desktop-ready** | `ModuleViewport` + `useAppShellContext`; classic full-page in desktop until `windowMode` added |
| **C — Viewport only** | `ModuleViewport` but `dark:` Tailwind (theme may break inside desktop window) — **Wave A backlog** |

### Core modules (`copanel/frontend/src/modules/`)

| Module | Grade | `windowMode` | Notes |
|--------|-------|--------------|-------|
| `panel_settings` | **A** | ✓ | Windows Settings sidebar |
| `file_manager` | **A** | ✓ | `WindowModal` |
| `appstore_manager` | **A** | ✓ | Deepin layout |
| `cron_manager` | **A** | ✓ | Wave A — `dark` wrapper |
| `dns_manager` | **A** | ✓ | Wave A |
| `database_manager` | **A** | ✓ | Wave A |
| `site_wizard` | **A** | ✓ | Desktop sidebar + 1-click install (WordPress/LEMP) |
| `firewall` | **A** | ✓ | Wave B config |
| `web_manager` | **A** | ✓ | `WindowModal` site create + config; PHP Manager embedded tab |
| `backup_manager` | **A** | ✓ | `WindowModal` wizard/stream/explorer/oauth |
| `system_monitor` | **A** | ✓ | `WindowModal` signal + process detail |
| `terminal` | **A** | ✓ | |
| `system_monitor` | **A** | ✓ | modals backlog |
| `system_cleaner` | **A** | ✓ | |
| `ssl_manager` | **A** | ✓ | Desktop sidebar; auto-renew cron + per-domain renew |
| `package_manager` | **A** | ✓ | |
| `docker_manager` | **A** | ✓ | `WindowModal` logs |
| `backup_manager` | **A** | ✓ | |
| `users` | **A** | ✓ | admin only |

**`curl install.sh`** ships all core modules at grades above. Grade **B/C** = usable on Desktop (sidebar / full workspace); chưa có floating window riêng.

### AppStore-only (`packages_src/` — Wave C, 2026-07-10)

| Module | Grade | `windowMode` | Notes |
|--------|-------|--------------|-------|
| `download_manager` | **A** | ✓ | `WindowModal` |
| `audio_station` | **A** | ✓ | `WindowModal` |
| `storage_manager` | **A** | ✓ | `PartitionWizard` + `WindowModal` |
| `cloudflare_ddns` | **A** | ✓ | `dark` wrapper + scroll |
| `web_browser` | **A** | ✓ | flex viewport (AppStore-only, **not** core) |
| `webdav` | **A** | ✓ | config + viewport |
| `clamav` | **A** | ✓ | config + viewport |
| `module_redis` | **A** | ✓ | extension fast-path ZIP |

> **`web_browser`** nằm trong App Store (`packages_src/`), **không** có trong `install.sh`. User ví dụ firewall / cron / web_manager = **core**; web_browser = extension.

### Roadmap

| Wave | Scope | Status |
|------|-------|--------|
| Pilot | `file_manager`, `appstore_manager`, `panel_settings` | Done |
| **C** | All `packages_src` catalog modules | Done |
| **A** | Core `cron_manager`, `dns_manager`, `database_manager`, `site_wizard` | Done |
| **B** | All core `windowMode` in `config.ts` | Done |
| **B2** | `WindowModal` for remaining `fixed inset` (web_manager, backup_manager, system_monitor) | Done |

---

## Pilot modules (tham chiếu nhanh)

| Module | windowMode | pinned | Ghi chú |
|--------|------------|--------|---------|
| Settings (`panel_settings`) | ✓ | ✓ | Windows Settings sidebar |
| File Manager | ✓ | ✓ | reference implementation |
| App Store | ✓ | ✓ | Deepin sidebar |
| Wave C AppStore modules | ✓ | | see table above |

---

## Checklist trước merge

- [ ] `config.ts` có `windowMode` + `defaultWindowSize` nếu cần window
- [ ] Root = `ModuleViewport`, không `min-h-screen`
- [ ] `useAppShellContext()` thay `useOutletContext()`
- [ ] Modals dùng `WindowModal`
- [ ] Scroll chỉ ở vùng nội dung (`flex-1 overflow-y-auto`)
- [ ] Test desktop: open, drag, snap, Alt+Tab, Ctrl+W, resize
- [ ] Test classic: route `/your-module` vẫn OK
- [ ] Test mobile `<1024px`: full-page, không window

---

## Mở rộng shell (cho core dev)

| Task | File |
|------|------|
| Thêm snap mode | `windowStore.snapWindow`, `AppWindow` |
| Persist layout | `windowPersistence.ts` |
| Keyboard | `useDesktopKeyboard.ts`, wire trong `Layout.tsx` |
| Dock pinned | `pinned` trong `config.ts` → `Dock.tsx` |

---

## FAQ

**Module mới cài từ AppStore có window mode không?**  
Chỉ khi `config.ts` trong ZIP có `windowMode: true`. Classic vẫn chạy full-page.

**Một ZIP cho cả Classic và Desktop?**  
**Có.** Dùng `useAppShellContext` + `ModuleViewport`. Classic bỏ qua `windowMode`.

**Terminal / xterm resize?**  
`FitAddon.fit()` trong `ResizeObserver` trên container terminal.

**Nhiều window cùng lúc?**  
`singleton: false` (hiếm).

**Deep link `/file-manager`?**  
Desktop mode: mở window + redirect `/dashboard`.

---

## AppStore ZIP — dual UI checklist

Mọi module đóng gói qua [CoPanel-AppStore](https://github.com/phuspeed/CoPanel-AppStore) **phải** tuân layout sau để chạy song song Classic + Desktop.

### ZIP layout

```
my_module.v1.0.0.zip
├── backend/
│   ├── router.py          # exports router
│   ├── logic.py           # optional
│   └── version.txt
└── frontend/
    ├── config.ts
    └── index.tsx
```

### `config.ts` (required + optional desktop)

```typescript
import MyModule from './index';

export default {
  name: 'My Module',
  icon: 'Box',
  path: '/my-module',
  component: MyModule,
  description: '...',
  // Optional — desktop only (classic ignores)
  windowMode: true,
  defaultWindowSize: { width: 960, height: 640 },
  singleton: true,
  pinned: false,
};
```

### `index.tsx` (required pattern)

```typescript
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';

export default function MyModule() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';

  return (
    <ModuleViewport constrained className="p-4 md:p-8 space-y-6">
      {/* NO min-h-screen, NO 100vh, NO fixed fullscreen modals — use WindowModal */}
    </ModuleViewport>
  );
}
```

### Build & publish

```bash
# In copanel-appstore (sibling copanel/ tree)
cd scripts
python build_versioned_zip.py <module_id> <semver>
# → packages/<module_id>.v<semver>.zip
# Update packages.json version + download_url, push copanel-appstore main
```

Source: `packages_src/<id>/` (AppStore-only) or `copanel/**/modules/<id>/` (core modules).

### After install (panel)

AppStore copies ZIP → `frontend/src/modules/<id>/` → `npm run build:appstore`.  
No separate Desktop ZIP. No branch-specific catalog.

### Pre-release checklist

- [ ] `useAppShellContext()` — not `useOutletContext()`
- [ ] Root wrapped in `<ModuleViewport>`
- [ ] Modals use `<WindowModal>` if module has dialogs
- [ ] Test **Classic**: `/your-path` full-page
- [ ] Test **Desktop**: toggle ON, open from grid; if `windowMode`, opens in window
- [ ] Bump `version.txt` + `packages.json` + push ZIP
