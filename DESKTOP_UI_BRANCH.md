# Desktop UI — merged into `main`

Classic **Web UI** and **Desktop UI** ship together on branch **`main`**. One installer: **`scripts/install.sh`**.

| Before | Now |
|--------|-----|
| `install.sh` = classic only | `install.sh` = choose UI at install |
| `install-desktop-ui.sh` = separate flow | alias for `install.sh --desktop` |

## Install

**Interactive** (prompt 1 = Web UI, 2 = Desktop):

```bash
sudo bash scripts/install.sh
```

**One-liner — Web UI** (default for `curl | bash`):

```bash
curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=main" | sudo bash
```

**One-liner — Desktop UI:**

```bash
curl -fsSL -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/phuspeed/CoPanel/contents/scripts/install.sh?ref=main" \
  | sudo bash -s -- --desktop
```

**Flags:** `--classic` · `--desktop` · env `COPANEL_UI_TRACK=classic|desktop`

Switch anytime in the panel (dock / sidebar toggle).  
`config/ui_track` + `frontend/dist/ui-track.json` set the first-visit default.

## Module & AppStore docs

- **[frontend/DESKTOP_UI.md](frontend/DESKTOP_UI.md)** — dual UI module design
- **[frontend/README.md](frontend/README.md)** — frontend dev
- **[CoPanel-AppStore README](https://github.com/phuspeed/CoPanel-AppStore)** — ZIP packaging
