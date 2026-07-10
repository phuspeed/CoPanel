# Desktop UI — merged into `main`

As of **2026**, Classic sidebar UI and Desktop shell (floating windows, dock) live on **one branch: `main`**.

| Before | Now |
|--------|-----|
| `main` = classic only | `main` = classic **+** desktop (toggle) |
| `DesktopUI` = separate beta branch | `DesktopUI` tracks `main` (optional; use `main`) |

## Install

**Classic (default)** — sidebar, full-page modules:

```bash
curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=main" | sudo bash
```

**Desktop UI** — same codebase, desktop track (`config/ui_track=desktop`, toggle ON):

```bash
curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install-desktop-ui.sh?ref=main" | sudo bash
```

Switch anytime in the panel: dock icon (desktop) or sidebar toggle (classic).  
`localStorage` key: `copanel_desktop_ui` = `1` | `0`.

## Module & AppStore docs

- **[frontend/DESKTOP_UI.md](frontend/DESKTOP_UI.md)** — dual UI module design (required for new modules)
- **[frontend/README.md](frontend/README.md)** — frontend dev quick start
- **[CoPanel-AppStore README](https://github.com/phuspeed/CoPanel-AppStore)** — ZIP packaging
