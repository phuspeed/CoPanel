# Quick Start Guide

Get LVP-Panel up and running in minutes!

## 📋 Prerequisites

- **Linux** OS (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- **Python** 3.10 or higher
- **Node.js** 18 or higher
- **sudo** or root access
- **Internet connection** for package downloads

## ⚡ Installation (One Command)

```bash
sudo bash scripts/install.sh
```

This script will:
1. Install system dependencies (Python, Node.js, Nginx)
2. Create service user and directories
3. Set up Python virtual environment
4. Install Python dependencies
5. Build React frontend
6. Configure Nginx reverse proxy
7. Create and start Systemd service
8. Verify everything works

**Installation time**: ~5-10 minutes

## 🌐 Access

Open your browser and navigate to:

```
http://localhost:8686
```

You'll see the LVP-Panel dashboard with System Monitor module!

## 📊 What's Included

✅ **System Monitor** - Real-time CPU, Memory, Disk, Network stats
✅ **Dynamic Sidebar** - Auto-updates as new modules are added
✅ **API Documentation** - Interactive docs at `/api/docs`
✅ **Dark Theme** - Easy on the eyes
✅ **Responsive Design** - Works on mobile too

## 🔧 Service Management

```bash
# Start
systemctl start lvp-panel

# Stop
systemctl stop lvp-panel

# Restart (after changes)
systemctl restart lvp-panel

# View logs
journalctl -u lvp-panel -f

# Check status
systemctl status lvp-panel
```

## 🏗️ Project Directories

```
/opt/lvp-panel/              # Installation location
├── backend/
│   ├── main.py              # FastAPI server
│   ├── core/                # Core system
│   └── modules/             # 🔌 Add plugins here
├── frontend/
│   ├── src/
│   │   ├── core/            # Core UI system
│   │   └── modules/         # 🔌 Add UI plugins here
│   └── dist/                # Built assets
├── venv/                    # Python environment
└── scripts/
    └── install.sh
```

## 🔌 Adding Your First Module

### Backend

Create `backend/modules/hello_world/`:

```python
# router.py
from fastapi import APIRouter

router = APIRouter()

@router.get("/greet")
async def greet():
    return {"message": "Hello from Hello World module!"}
```

Add `__init__.py` (empty file)

### Frontend

Create `frontend/src/modules/hello_world/`:

```typescript
// config.ts
import HelloWorld from './index';

export default {
  name: 'Hello World',
  icon: 'Smile',
  path: '/hello-world',
  component: HelloWorld,
};
```

```typescript
// index.tsx
export default function HelloWorld() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Hello World!</h1>
      <p className="text-slate-400">This is my first LVP module!</p>
    </div>
  );
}
```

### Deploy

```bash
systemctl restart lvp-panel
```

Your module appears automatically in the sidebar! ✨

## 📚 API Usage

### Get All Stats

```bash
curl http://localhost:8000/api/system_monitor/stats
```

### Get CPU Info

```bash
curl http://localhost:8000/api/system_monitor/cpu
```

### Get Memory Info

```bash
curl http://localhost:8000/api/system_monitor/memory
```

### Get Disk Info

```bash
curl http://localhost:8000/api/system_monitor/disk
```

[View more API docs at http://localhost:8000/docs]

## 🛠️ Development Setup

### Backend Development

```bash
cd backend

# Create virtual environment (if not using installed version)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run with auto-reload
python -m uvicorn main:app --reload
```

Backend runs on `http://localhost:8000`

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend dev server on `http://localhost:5173`

Frontend automatically proxies API calls to `http://localhost:8000`

## 🚀 Deployment

### Build Production Frontend

```bash
cd frontend
npm run build
```

Built files go to `frontend/dist/`

### Restart Service

```bash
systemctl restart lvp-panel
```

Nginx automatically serves the latest build!

## 📖 Full Documentation

- **Main README**: [README.md](README.md)
- **Backend Guide**: [backend/README.md](backend/README.md)
- **Frontend Guide**: [frontend/README.md](frontend/README.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

## 🔍 Troubleshooting

### Service won't start

```bash
# Check logs
journalctl -u lvp-panel -n 50

# Check service status
systemctl status lvp-panel

# Try restart
systemctl restart lvp-panel
```

### Can't access web UI

```bash
# Check Nginx is running
systemctl status nginx

# Check if port 8686 is open
sudo netstat -tlnp | grep 8686

# Test backend
curl http://localhost:8000/health
```

### Module not appearing

```bash
# Check module structure
ls -la backend/modules/your_module/
ls -la frontend/src/modules/your_module/

# Rebuild frontend
cd frontend && npm run build

# Restart service
systemctl restart lvp-panel

# Hard refresh browser (Ctrl+Shift+Delete)
```

### Permission errors

```bash
# Check ownership
ls -la /opt/lvp-panel/

# Fix if needed
sudo chown -R lvpanel:lvpanel /opt/lvp-panel
```

## 💡 Tips

1. **Keep frontend rebuilt**: Changes to frontend modules require `npm run build`
2. **Backend auto-reloads**: Changes to Python code auto-reload in development
3. **Check API docs**: Visit `http://localhost:8000/docs` to explore API
4. **Watch logs**: `journalctl -u lvp-panel -f` helps debug issues
5. **Use dark mode**: Easier to see what's happening!

## 🎯 Next Steps

1. ✅ Installation complete - verify access at http://localhost:8686
2. 📖 Read the [Backend Guide](backend/README.md)
3. 🎨 Read the [Frontend Guide](frontend/README.md)
4. 🔌 Create your first custom module
5. 🚀 Deploy to production

## ❓ Need Help?

- Check logs: `journalctl -u lvp-panel -f`
- Review documentation in `/opt/lvp-panel/`
- Visit GitHub repository for issues
- Check installation script output for details

---

**Enjoy LVP-Panel! 🎉**
