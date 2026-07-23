# CoPanel - Lightweight Linux VPS Management Panel

![Version](https://img.shields.io/badge/version-1.1.4-blue)
![Status](https://img.shields.io/badge/status-beta-yellow)
![License](https://img.shields.io/badge/license-MIT-green)

A lightweight, high-performance Linux VPS management panel with a **pluggable architecture**. Add new features by dropping a module folder—no core code changes required.

## Two UIs, one codebase

| Mode | How to enable | Experience |
|------|----------------|------------|
| **Classic (Web UI)** | Default in `install.sh`, or `--classic` | Sidebar + full-page modules |
| **Desktop** | `install.sh --desktop`, or toggle ON | Deepin-style desktop, dock, floating windows |

Both modes share the **same modules** and **same AppStore ZIPs**. Modules use `ModuleViewport` + optional `windowMode` in `config.ts` — classic ignores window fields.

**Module design guide:** [`frontend/DESKTOP_UI.md`](frontend/DESKTOP_UI.md) · **AppStore ZIPs:** [CoPanel-AppStore](https://github.com/phuspeed/CoPanel-AppStore)

## AI Agent Quick Navigation

- Start here first: `AGENT_START_HERE.md`
- Dual UI modules: `frontend/DESKTOP_UI.md`
- Backend logic map: `backend/ARCHITECTURE_AI.md`
- Frontend logic map: `frontend/ARCHITECTURE_AI.md`

## 🎯 Core Philosophy

**Pluggable Architecture**: Automatically detect and register new features (Backend APIs + Frontend UI) just by adding a folder into a specific directory.

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend** | FastAPI + Python 3.10+ | Async, type-safe API |
| **Frontend** | React (Vite) + TailwindCSS | Modern, responsive UI |
| **Real-time** | WebSockets + Xterm.js | Terminal emulation |
| **Data** | SQLite + Linux Filesystem | Metadata & direct control |
| **Auth** | JWT + Linux PAM | Secure authentication |
| **Deployment** | Nginx + Systemd | Production ready |

## 📂 Project Structure

```
/copanel
├── backend/
│   ├── main.py                      # FastAPI entry point
│   ├── core/
│   │   ├── __init__.py
│   │   ├── loader.py               # Dynamic module loader
│   │   └── security.py             # JWT & auth utilities
│   ├── modules/                     # 🔌 PLUGIN FOLDER
│   │   ├── system_monitor/         # Reference module 1
│   │   │   ├── __init__.py
│   │   │   ├── router.py           # Must export 'router'
│   │   │   └── logic.py
│   │   └── file_manager/           # Reference module 2 (create your own!)
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── registry.ts         # Dynamic module registry
│   │   │   ├── Layout.tsx          # Classic sidebar + desktop shell toggle
│   │   │   ├── shell/              # Desktop UI (windows, dock, desktop)
│   │   │   └── hooks/useAppShellContext.ts  # theme/lang for both UIs
│   │   ├── modules/                # 🔌 UI PLUGIN FOLDER
│   │   │   ├── system_monitor/
│   │   │   │   ├── index.tsx
│   │   │   │   └── config.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── scripts/
│   └── install.sh                  # One-click installation
│
├── config/
│   └── nginx.conf                  # Nginx template
│
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- **Linux** (Ubuntu 20.04+, CentOS 8+, Debian 11+)
- **Root** or sudo access
- **Python** 3.10+
- **Node.js** 18+

### Install (one script)

**`scripts/install.sh`** — unified installer on branch `main`. Choose UI at install time.

**Interactive** (local clone or SSH):

```bash
sudo bash scripts/install.sh
# Prompt: 1) Web UI (classic)  2) Desktop UI
```

**One-liner — Web UI (default when piped from curl):**

```bash
curl -fsSL https://copanel.io.vn/install.sh | sudo bash
```

Alternate (GitHub raw, no custom domain):

```bash
curl -fsSL https://raw.githubusercontent.com/phuspeed/CoPanel/main/scripts/install.sh | sudo bash
```

**One-liner — Desktop UI:**

```bash
curl -fsSL https://copanel.io.vn/install.sh | sudo bash -s -- --desktop
```

**Flags:** `--classic` / `--webui` · `--desktop` · `COPANEL_UI_TRACK=classic|desktop`

`install-desktop-ui.sh` remains as an alias for `--desktop` (backward compatible).

**Short URL on your domain** (e.g. `https://copanel.io.vn/install.sh`): nginx `proxy_pass` to GitHub raw — see [`website/nginx.copanel.io.vn.example.conf`](website/nginx.copanel.io.vn.example.conf).

**Upgrade existing `/opt/copanel`:**

```bash
cd /opt/copanel && sudo git pull origin main && sudo bash scripts/install.sh
```

**Fresh clone:**

```bash
sudo apt install -y git
sudo git clone --depth 1 https://github.com/phuspeed/CoPanel.git /opt/copanel
sudo bash /opt/copanel/scripts/install.sh
```

Docs: [`frontend/DESKTOP_UI.md`](frontend/DESKTOP_UI.md) · [`DESKTOP_UI_BRANCH.md`](DESKTOP_UI_BRANCH.md)

> Avoid `raw.githubusercontent.com` one-liners (rate limits). Use GitHub API URLs above or `git clone`.

The installer will:
- ✅ Install system dependencies
- ✅ Create Python virtual environment
- ✅ Install backend & frontend dependencies
- ✅ Build frontend assets
- ✅ Configure Nginx reverse proxy (port 8686)
- ✅ Set up Systemd service
- ✅ Start all services

### Access

- **Web UI**: http://localhost:8686
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## 🔌 Creating a New Module

### Backend Module (Python/FastAPI)

1. Create folder: `backend/modules/{your_module}/`
2. Create `router.py` and export a FastAPI router:

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/info")
async def get_info():
    return {"message": "Your module works!"}
```

3. Create `__init__.py` (empty is fine)
4. Restart service: `systemctl restart copanel`

The module loads automatically at `/api/{your_module}`!

### Frontend Module (React/TypeScript)

**Use the dual-UI pattern** so one module works in Classic and Desktop. Full guide: [`frontend/DESKTOP_UI.md`](frontend/DESKTOP_UI.md).

1. Create folder: `frontend/src/modules/{your_module}/`
2. Create `config.ts`:

```typescript
import YourComponent from './index';

export default {
  name: 'Your Module',
  icon: 'Grid',
  path: '/your-module',
  component: YourComponent,
  description: 'Your module description',
  // Optional — desktop shell only (classic ignores these)
  windowMode: true,
  defaultWindowSize: { width: 960, height: 640 },
  pinned: true,
};
```

3. Create `index.tsx`:

```typescript
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';

export default function YourModule() {
  const { theme, language } = useAppShellContext();
  return (
    <ModuleViewport constrained className="p-4 md:p-8">
      {/* content — no min-h-screen / 100vh */}
    </ModuleViewport>
  );
}
```

4. Rebuild: `npm run build` (in `frontend/`)

Module appears in sidebar (classic) and desktop grid (desktop mode).

### AppStore ZIP (same module layout)

Package `frontend/` + `backend/` per [CoPanel-AppStore](https://github.com/phuspeed/CoPanel-AppStore). ZIP modules **must** use `useAppShellContext` + `ModuleViewport` — one ZIP for both UIs.

**Where source lives:**

| Kind | Edit | `install.sh` ships it? |
|------|------|------------------------|
| **Core** (file_manager, panel_settings, …) | This repo — `backend/modules/` + `frontend/src/modules/` | Yes |
| **AppStore-only** (download_manager, module_redis, …) | [CoPanel-AppStore `packages_src/`](https://github.com/phuspeed/CoPanel-AppStore/blob/main/MODULE_SOURCES.md) | No — install from App Store |

`curl install.sh` clones **CoPanel only**; extension modules come from App Store ZIPs. Full policy: [MODULE_SOURCES.md](https://github.com/phuspeed/CoPanel-AppStore/blob/main/MODULE_SOURCES.md).

## 📊 System Monitor Module (Reference)

The included System Monitor module demonstrates the pluggable architecture:

### Backend API
- `GET /api/system_monitor/stats` - All system stats
- `GET /api/system_monitor/cpu` - CPU metrics
- `GET /api/system_monitor/memory` - Memory metrics
- `GET /api/system_monitor/disk` - Disk metrics
- `GET /api/system_monitor/network` - Network stats

### Frontend Dashboard
- Real-time CPU/Memory charts (Recharts)
- Disk usage visualization
- System information display
- Auto-updating every 3 seconds

## 🔒 Security Best Practices

- ✅ No `shell=True` in subprocess calls (prevents injection)
- ✅ Input sanitization on all user inputs
- ✅ JWT token-based authentication
- ✅ HTTPS ready (use with your certificate)
- ✅ CORS configured for development
- ✅ Systemd service runs as unprivileged user

## 📝 Service Management

```bash
# Start
systemctl start copanel

# Stop
systemctl stop copanel

# Restart
systemctl restart copanel

# View logs
journalctl -u copanel -f

# Check status
systemctl status copanel
```

## 🛠️ Development Mode

### Backend Development

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

API will be available at `http://localhost:8000`
Interactive docs at `http://localhost:8000/docs`

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server at `http://localhost:5173`
(Auto-proxies API calls to `http://localhost:8000`)

## 📦 Module Directory Scanning

### Backend Loader (`core/loader.py`)
- Scans `backend/modules/` directory
- Looks for `router.py` in each module folder
- Dynamically imports and registers routers
- Assigns URL prefix `/api/{module_name}`

### Frontend Registry (`core/registry.ts`)
- Uses Vite's `import.meta.glob` for static imports
- Scans `frontend/src/modules/*/config.ts`
- Registers routes and sidebar entries
- Auto-updates on rebuild

## 🎨 UI Features

- 🌙 Dark mode by default (Slate 950)
- 📱 Responsive design (Mobile-first)
- ⚡ Lucide React icons
- 🎨 Tailwind CSS styling
- 🧩 Recharts for data visualization

## 📈 Performance

- **Idle Memory**: < 100MB RAM
- **Startup Time**: < 5 seconds
- **API Response**: < 100ms (most endpoints)
- **Frontend Bundle**: Optimized with Vite

## 🐛 Troubleshooting

### Backend won't start
```bash
journalctl -u copanel -f
```

### Nginx connection refused
```bash
nginx -t
systemctl restart nginx
```

### Module not loading
```bash
# Check module structure
ls -la backend/modules/your_module/
# Ensure router.py exists
# Restart service
systemctl restart copanel
```

### Frontend not updating
```bash
cd frontend
npm run build
# Refresh browser cache (Ctrl+Shift+Delete)
```

## 📚 Directory Reference

| Path | Purpose |
|------|---------|
| `/opt/copanel` | Installation directory (production) |
| `backend/modules/` | Backend plugin directory |
| `frontend/src/modules/` | Frontend plugin directory |
| `/opt/copanel/venv/` | Python virtual environment |
| `/opt/copanel/frontend/dist/` | Built frontend assets |
| `/etc/systemd/system/copanel.service` | Systemd service file |
| `/etc/nginx/sites-available/copanel` | Nginx configuration |

## 🤝 Contributing

To contribute:
1. Fork the repository
2. Create a module in the appropriate `modules/` folder
3. Follow the module structure guidelines
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 🎓 Learning Resources

- **FastAPI Documentation**: https://fastapi.tiangolo.com
- **React Documentation**: https://react.dev
- **Vite Guide**: https://vitejs.dev
- **TailwindCSS**: https://tailwindcss.com
- **Recharts**: https://recharts.org

## 📞 Support

For issues, questions, or suggestions:
- GitHub Issues: Create an issue in the repository
- Documentation: Check the README in each module folder

---

**Built with ❤️ for Linux System Administrators**
