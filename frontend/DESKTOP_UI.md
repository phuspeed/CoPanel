# CoPanel Desktop UI — Module Design Guide

> **Nhánh Git:** `DesktopUI` — giao diện desktop thử nghiệm, tách khỏi `main` (classic sidebar UI).  
> `main` = UI cũ ổn định · `DesktopUI` = desktop shell + window manager (beta).

## Cài đặt / chuyển sang Desktop UI

```bash
cd /opt/copanel   # hoặc thư mục clone của bạn
git fetch origin
git checkout DesktopUI
git pull origin DesktopUI

cd frontend
npm install
npm run build

# Restart backend nếu cần
sudo systemctl restart copanel
```

Clone mới trực tiếp nhánh Desktop UI:

```bash
git clone -b DesktopUI https://github.com/phuspeed/CoPanel.git copanel-desktop
```

Quay lại UI classic:

```bash
git checkout main
git pull origin main
cd frontend && npm run build
sudo systemctl restart copanel
```

---

Hướng dẫn thiết kế giao diện module chạy trong **cửa sổ nhúng** (desktop window) hoặc **classic full-page**.

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

## Pilot modules (tham chiếu)

| Module | windowMode | pinned | Ghi chú |
|--------|------------|--------|---------|
| File Manager | ✓ | ✓ | `ModuleViewport` |
| App Store | ✓ | ✓ | Deepin sidebar layout + `WindowModal` |

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
Chỉ khi `config.ts` trong ZIP có `windowMode: true` và frontend rebuild.

**Terminal / xterm resize?**  
Gọi `FitAddon.fit()` trong `ResizeObserver` trên container — Phase 4.

**Nhiều window cùng lúc?**  
Đặt `singleton: false` (hiếm khi cần).

**Deep link `/file-manager`?**  
Desktop mode: mở window + redirect `/dashboard`.
