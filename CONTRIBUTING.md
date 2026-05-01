# Contributing to CoPanel

## Adding Your Own Module

CoPanel's pluggable architecture makes it easy to add new features without modifying core code!

## Backend Module Template

### 1. Create Module Directory

```bash
mkdir -p backend/modules/my_feature
```

### 2. Create `router.py` (Required)

```python
"""
My Feature Module - Router
Handles all API endpoints for my feature
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any

router = APIRouter()

@router.get("/status")
async def get_status() -> Dict[str, Any]:
    """Get feature status."""
    return {
        "status": "operational",
        "feature": "my_feature"
    }

@router.get("/data")
async def get_data() -> Dict[str, Any]:
    """Get feature data."""
    try:
        # Your logic here
        data = {"example": "data"}
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/action")
async def perform_action(payload: dict) -> Dict[str, Any]:
    """Perform an action."""
    # Validate and process payload
    if not payload:
        raise HTTPException(status_code=400, detail="Invalid payload")
    
    # Execute action
    result = {"message": "Action completed"}
    return {"status": "success", "data": result}
```

### 3. Create `logic.py` (Business Logic)

```python
"""
My Feature Module - Business Logic
Core functionality isolated from API layer
"""

class MyFeatureLogic:
    """Handle my feature operations."""
    
    @staticmethod
    def process_data(input_data: dict) -> dict:
        """Process input data."""
        # Your business logic here
        return {"processed": True, **input_data}
    
    @staticmethod
    def validate_input(data: dict) -> bool:
        """Validate input data."""
        required_fields = ["field1", "field2"]
        return all(field in data for field in required_fields)
```

Update `router.py` to use:

```python
from .logic import MyFeatureLogic

@router.post("/process")
async def process(payload: dict):
    if not MyFeatureLogic.validate_input(payload):
        raise HTTPException(status_code=400, detail="Invalid input")
    
    result = MyFeatureLogic.process_data(payload)
    return {"status": "success", "data": result}
```

### 4. Create `__init__.py` (Can be empty)

```python
"""My Feature Module"""
```

### 5. API Endpoints Auto-Register

Your module is **automatically** available at:
- `GET /api/my_feature/status`
- `GET /api/my_feature/data`
- `POST /api/my_feature/action`
- `POST /api/my_feature/process`

No configuration needed!

## Frontend Module Template

### 1. Create Module Directory

```bash
mkdir -p frontend/src/modules/my_feature
```

### 2. Create `config.ts` (Required)

```typescript
/**
 * My Feature Module - Configuration
 * Automatically discovered and loaded by the module registry
 */
import MyFeatureComponent from './index';

export default {
  name: 'My Feature',              // Display name in sidebar
  icon: 'Zap',                      // Lucide icon name
  path: '/my-feature',              // URL route
  description: 'My awesome feature', // Hover tooltip
  component: MyFeatureComponent,    // React component
};
```

### 3. Create `index.tsx` (Component)

```typescript
/**
 * My Feature Component
 * Renders the feature UI
 */
import { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';

interface FeatureData {
  status: string;
  [key: string]: any;
}

export default function MyFeature() {
  const [data, setData] = useState<FeatureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/my_feature/status');
        if (!response.ok) throw new Error('Failed to fetch');
        
        const result = await response.json();
        setData(result.data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Optional: Refresh every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Icons.Loader className="w-12 h-12 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg">
          <p className="text-red-200">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">My Feature</h1>
      
      {/* Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm mb-2">Status</p>
            <p className="text-3xl font-bold">{data?.status}</p>
          </div>
          <Icons.CheckCircle className="w-12 h-12 text-green-400" />
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <pre className="bg-slate-800 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

### 4. Module Auto-Registers

Your module automatically:
- ✅ Appears in the sidebar with icon
- ✅ Gets a route at `/my-feature`
- ✅ Shows tooltip on hover
- ✅ Updates sidebar on rebuild

## Module Structure Example

After creating both backend and frontend modules:

```
backend/modules/my_feature/
├── __init__.py
├── router.py      ← API routes
├── logic.py       ← Business logic
└── models.py      ← (Optional) Data models

frontend/src/modules/my_feature/
├── index.tsx      ← React component
└── config.ts      ← Module configuration
```

## Styling Guidelines

Use TailwindCSS classes for consistent UI:

```typescript
// Dark background (site default)
<div className="bg-slate-900 text-slate-50">

// Cards
<div className="bg-slate-900 border border-slate-800 rounded-lg p-6">

// Headings
<h1 className="text-3xl font-bold">
<h2 className="text-lg font-semibold">

// Text colors
<p className="text-slate-400">  {/* Secondary */}
<p className="text-red-400">    {/* Error */}
<p className="text-green-400">  {/* Success */}

// Buttons
<button className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">

// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

// Loading/Error states
<Icons.Loader className="w-12 h-12 animate-spin" />
<Icons.AlertCircle className="w-12 h-12 text-red-400" />
<Icons.CheckCircle className="w-12 h-12 text-green-400" />
```

## API Communication Best Practices

### Error Handling

```typescript
try {
  const response = await fetch('/api/my_feature/data');
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'API Error');
  }
  
  const data = await response.json();
  setData(data.data);
} catch (error) {
  setError(error instanceof Error ? error.message : 'Unknown error');
}
```

### POST Requests

```typescript
const response = await fetch('/api/my_feature/action', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    field1: value1,
    field2: value2,
  }),
});

const result = await response.json();
```

### Authentication (When Implemented)

```typescript
const token = localStorage.getItem('jwt_token');
const response = await fetch('/api/my_feature/protected', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

## Testing Your Module

### Backend Testing

```bash
cd backend
source venv/bin/activate

# Test your router
python -c "from modules.my_feature import router; print(router.routes)"

# Test with curl
curl http://localhost:8000/api/my_feature/status
```

### Frontend Testing

```bash
cd frontend

# Check module loads
npm run build
# Look for "my_feature" in console output

# Open browser
# Sidebar should show "My Feature"
# Navigate to /my-feature
```

## Module Checklist

Before submitting your module:

- [ ] Backend `router.py` exports `router` variable
- [ ] Backend API responds with valid JSON
- [ ] Frontend `config.ts` exports default object
- [ ] Frontend component renders without errors
- [ ] Sidebar icon exists (Lucide icon name)
- [ ] All API errors handled gracefully
- [ ] Module works offline or with error display
- [ ] UI follows dark theme (Slate 900/800)
- [ ] Responsive design tested on mobile
- [ ] No console errors or warnings
- [ ] Documentation included (comments)

## Module Examples

### File Manager Module

Would scan directories, upload/download files:

```
backend/modules/file_manager/
├── router.py          → list, upload, download, delete
└── logic.py           → file operations with security checks

frontend/src/modules/file_manager/
├── index.tsx          → file browser UI with dropzone
└── config.ts
```

### Terminal Module

Would provide SSH/terminal access:

```
backend/modules/terminal/
├── router.py          → WebSocket endpoint
└── logic.py           → process management

frontend/src/modules/terminal/
├── index.tsx          → Xterm.js integration
└── config.ts
```

### Settings Module

Would manage system configuration:

```
backend/modules/settings/
├── router.py          → get/update settings
└── logic.py           → config file management

frontend/src/modules/settings/
├── index.tsx          → settings form
└── config.ts
```

## Deployment

### Production Build

```bash
# Backend: Automatic with systemd

# Frontend: Rebuild included in install.sh
cd frontend
npm run build

# Restart service
systemctl restart copanel
```

### Hot Reload During Development

```bash
# Backend automatically reloads with --reload flag
# Frontend hot reload with Vite dev server
npm run dev
```

## Support

- **Documentation**: See main [README.md](../README.md)
- **Backend Guide**: [backend/README.md](../backend/README.md)
- **Frontend Guide**: [frontend/README.md](../frontend/README.md)
- **Issues**: Report bugs or request features

## License

All modules inherit CoPanel's MIT License. Ensure your code is compatible.

---

Happy coding! 🚀
