# Backend Setup Guide

## Quick Start

### Requirements
- Python 3.10+
- pip / venv

### Development Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server
python -m uvicorn main:app --reload
```

Server runs on `http://localhost:8000`

### API Documentation

Interactive API docs available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Project Structure

```
backend/
├── main.py                  # FastAPI entry point
├── core/
│   ├── loader.py           # Dynamic module loader
│   └── security.py         # JWT utilities
├── modules/                # Plugin modules
│   └── system_monitor/     # Example module
│       ├── router.py       # FastAPI router (required)
│       ├── logic.py        # Business logic
│       └── __init__.py
└── requirements.txt
```

## Module Development

### Creating a New Module

1. Create folder: `modules/{module_name}/`

2. Create `router.py`:

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/endpoint")
async def your_endpoint():
    """Endpoint description."""
    return {"data": "value"}

@router.post("/create")
async def create_item(data: dict):
    """Create something."""
    return {"status": "created", "data": data}
```

3. Create `__init__.py` (can be empty)

4. Create `logic.py` for business logic:

```python
class YourLogic:
    @staticmethod
    def process_data(data):
        # Your logic here
        return data
```

5. Restart the application:

```bash
# In production
systemctl restart copanel

# In development, the --reload flag restarts automatically
```

The module is automatically available at `/api/{module_name}`

## Core Components

### ModuleLoader (`core/loader.py`)

Automatically discovers and loads modules:

```python
from core.loader import ModuleLoader

loader = ModuleLoader(Path("modules"))
loader.load_modules(app)
```

Features:
- Scans `modules/` directory
- Imports `router.py` from each module
- Registers routers with FastAPI
- Assigns prefix `/api/{module_name}`

### Security (`core/security.py`)

JWT token management:

```python
from core.security import create_access_token, verify_token

# Create token
token = create_access_token({"sub": "username"})

# Verify token
payload = verify_token(token)
```

## API Endpoints

### Core Endpoints

- `GET /health` - Health check
- `GET /api` - API root
- `GET /api/modules` - List loaded modules

### System Monitor (Example)

- `GET /api/system_monitor/stats` - All stats
- `GET /api/system_monitor/cpu` - CPU info
- `GET /api/system_monitor/memory` - Memory info
- `GET /api/system_monitor/disk` - Disk info
- `GET /api/system_monitor/network` - Network stats

## Environment Variables

Create `.env` file:

```bash
# JWT Secret (change in production!)
JWT_SECRET_KEY="your-secret-key-here"

# Server
BACKEND_PORT=8000
HOST=0.0.0.0

# Database
DATABASE_URL="sqlite:///./copanel.db"

# Logging
LOG_LEVEL="INFO"
```

## Testing

```bash
# Install test dependencies
pip install pytest pytest-asyncio

# Run tests
pytest

# With coverage
pytest --cov=. tests/
```

## Production Deployment

### Using Systemd

Service file: `/etc/systemd/system/copanel.service`

```bash
systemctl start copanel
systemctl status copanel
journalctl -u copanel -f
```

### Using Docker (Optional)

```dockerfile
FROM python:3.10

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Performance Tips

1. **Use async/await** for I/O operations
2. **Cache expensive operations** (e.g., system stats)
3. **Use background tasks** for long operations
4. **Monitor memory usage** of modules
5. **Rate limit** public endpoints

## Troubleshooting

### Module not loading

```bash
# Check module structure
ls -la modules/your_module/
# Must have: __init__.py and router.py

# Check for import errors
python -c "from modules.your_module import router"

# View logs
python -m uvicorn main:app --reload
```

### Permission errors

```bash
# Check directory permissions
ls -la modules/

# Check ownership
ps aux | grep uvicorn
```

### Port already in use

```bash
# Find process on port 8000
lsof -i :8000

# Kill process
kill -9 <PID>
```

## Dependencies

Key packages:
- **fastapi**: Web framework
- **uvicorn**: ASGI server
- **psutil**: System monitoring
- **python-jose**: JWT tokens
- **passlib**: Password hashing
- **pydantic**: Data validation

## Security Checklist

- ✅ Use HTTPS in production
- ✅ Change JWT secret key
- ✅ Validate all inputs
- ✅ Never use `shell=True`
- ✅ Sanitize command arguments
- ✅ Implement rate limiting
- ✅ Add CSRF protection
- ✅ Regular dependency updates

## Logging

```python
import logging

logger = logging.getLogger(__name__)

logger.info("Informational message")
logger.warning("Warning message")
logger.error("Error message")
```

View logs:

```bash
# In production
journalctl -u copanel -f

# In development
# Check console output
```

---

For more information, see the main [README.md](../README.md)
