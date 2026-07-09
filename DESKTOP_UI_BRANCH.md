# Desktop UI branch (`DesktopUI`)

CoPanel ships two frontend experiences on **separate Git branches**:

| Branch | UI | Status |
|--------|-----|--------|
| **`main`** | Classic sidebar + full-page modules | Default, stable |
| **`DesktopUI`** | Deepin/DSM-style desktop, floating windows, dock | Experimental beta |

## Who should use `DesktopUI`?

- You want a desktop-like panel (icons, dock, app windows).
- You are OK with beta UX and occasional breaking changes.
- You test on desktop viewport (≥1024px); mobile falls back to classic layout.

Stay on **`main`** if you need the current production UI unchanged.

## Install / switch

### Existing install at `/opt/copanel`

```bash
cd /opt/copanel
git fetch origin
git checkout DesktopUI
git pull origin DesktopUI

cd frontend
npm ci || npm install
npm run build

sudo systemctl restart copanel
# reload browser (Ctrl+Shift+R)
```

### Fresh clone

```bash
git clone -b DesktopUI https://github.com/phuspeed/CoPanel.git
cd CoPanel
# follow README install (install.sh) from this branch
```

### Back to classic UI

```bash
cd /opt/copanel
git checkout main
git pull origin main
cd frontend && npm run build
sudo systemctl restart copanel
```

## What is included (DesktopUI)

- Desktop shell: wallpaper grid, search, dock
- Window manager: drag, resize, snap, Alt+Tab, Ctrl+W
- Window-mode pilots: **File Manager**, **App Store**
- Module guide: [`frontend/DESKTOP_UI.md`](frontend/DESKTOP_UI.md)

## Merging to `main`

Not planned until Desktop UI is stable and opt-in migration is documented. Track issues/feedback on the `DesktopUI` branch.
