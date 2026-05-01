# CoPanel Developer Reference Card

## Quick Reference for Module Development

### Module Folder Structure

```
backend/modules/{name}/
├── __init__.py          # Empty (just marks as Python package)
├── router.py            # REQUIRED - FastAPI router
└── logic.py             # Optional - business logic

frontend/src/modules/{name}/
├── config.ts            # REQUIRED - module config
└── index.tsx            # React component
```

## Backend Module Template

### router.py (REQUIRED)
```python
from fastapi import APIRouter, HTTPException

router = APIRouter()  # Must export 'router'!

@router.get("/status")
async def get_status():
    return {"status": "ok"}

@router.post("/action")
async def action(data: dict):
    try:
        # Your logic here
        return {"result": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Available at: `/api/{module_name}/{endpoint}`

## Frontend Module Template

### config.ts (REQUIRED)
```typescript
import MyComponent from './index';

export default {
  name: 'Display Name',      // Shows in sidebar
  icon: 'IconName',          // Lucide icon
  path: '/route-path',       // URL route
  component: MyComponent,    // React component
  description: 'Description', // Hover text (optional)
};
```

### index.tsx
```typescript
import { useState, useEffect } from 'react';

export default function MyModule() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    fetch('/api/my_module/status')
      .then(r => r.json())
      .then(d => setData(d.data))
      .catch(e => console.error(e));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">My Module</h1>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
```

## Common TailwindCSS Classes

```typescript
// Layout
<div className="p-8">                  // Padding
<div className="grid grid-cols-2 gap-4"> // Grid

// Colors
bg-slate-900    // Background dark
text-slate-50   // Text white
text-slate-400  // Text secondary

// Responsive
md:grid-cols-2  // 2 cols on medium screens
lg:grid-cols-4  // 4 cols on large screens

// Components
border border-slate-800 rounded-lg      // Card
hover:bg-slate-800                      // Hover effect
animate-spin                            // Loading spinner
```

## Common Lucide Icons

```typescript
import * as Icons from 'lucide-react';

<Icons.Home />          // Home
<Icons.Activity />      // Monitor/Activity
<Icons.BarChart3 />     // Charts
<Icons.HardDrive />     // Disk
<Icons.Zap />           // Lightning/Power
<Icons.Settings />      // Settings
<Icons.Menu />          // Menu
<Icons.X />             // Close
<Icons.Loader />        // Loading
<Icons.AlertCircle />   // Error
<Icons.CheckCircle />   // Success
```

## API Communication Patterns

### GET Request
```typescript
const response = await fetch('/api/module_name/endpoint');
const data = await response.json();
```

### POST Request
```typescript
const response = await fetch('/api/module_name/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ field: 'value' }),
});
const data = await response.json();
```

### Error Handling
```typescript
try {
  const res = await fetch('/api/...');
  if (!res.ok) throw new Error('Failed');
  const data = await res.json();
  setData(data.data);
} catch (error) {
  setError(error instanceof Error ? error.message : 'Unknown');
}
```

## Backend Patterns

### Using Business Logic
```python
# router.py
from .logic import MyLogic

@router.post("/process")
async def process(data: dict):
    result = MyLogic.process(data)
    return {"status": "success", "data": result}

# logic.py
class MyLogic:
    @staticmethod
    def process(data: dict) -> dict:
        # Your logic here
        return data
```

### Validation
```python
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    value: int

@router.post("/create")
async def create(item: Item):
    return {"created": item.dict()}
```

## Frontend Patterns

### Loading State
```typescript
if (loading) {
  return <Icons.Loader className="w-12 h-12 animate-spin" />;
}
```

### Error Display
```typescript
{error && (
  <div className="bg-red-900/20 border border-red-600 p-4 rounded">
    <p className="text-red-200">Error: {error}</p>
  </div>
)}
```

### Card Component
```typescript
<div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
  <h2 className="text-lg font-semibold mb-4">Title</h2>
  {/* Content */}
</div>
```

### Metric Card
```typescript
<div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-slate-400 text-sm">Label</p>
      <p className="text-3xl font-bold">123</p>
    </div>
    <Icons.BarChart3 className="w-8 h-8 text-blue-400" />
  </div>
</div>
```

## Recharts Example (Data Visualization)

```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  { time: '00:00', value: 10 },
  { time: '00:05', value: 20 },
];

<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    <CartesianGrid stroke="#334155" />
    <XAxis dataKey="time" stroke="#64748b" />
    <YAxis stroke="#64748b" />
    <Tooltip />
    <Line type="monotone" dataKey="value" stroke="#3b82f6" />
  </LineChart>
</ResponsiveContainer>
```

## Installation & Restart

```bash
# After creating a module, restart the service
systemctl restart copanel

# Watch logs for errors
journalctl -u copanel -f

# Check if module loaded
curl http://localhost:8000/api/modules
```

## Development Mode

### Backend
```bash
cd backend
source venv/bin/activate
python -m uvicorn main:app --reload
# Auto-reloads on file changes
# Visit: http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm run dev
# Hot reload on file changes
# Visit: http://localhost:5173
# Auto-proxies /api to http://localhost:8000
```

## File Structure Best Practices

1. **router.py** → Only routing logic
2. **logic.py** → Business logic separated
3. **models.py** → Data models (if needed)
4. **index.tsx** → Component only
5. **hooks/** → Custom React hooks (if many)
6. **utils/** → Utility functions

## Naming Conventions

- **Module folder**: `snake_case` (e.g., `file_manager`)
- **Component file**: `PascalCase.tsx` (e.g., `FileManager.tsx`)
- **Route path**: `kebab-case` (e.g., `/file-manager`)
- **Display name**: Title Case (e.g., `File Manager`)
- **Icon name**: PascalCase (e.g., `Folder`, `Upload`)

## Testing Your Module

```bash
# Backend API test
curl http://localhost:8000/api/your_module/endpoint

# Check if module appears in registry
curl http://localhost:8000/api/modules

# Check API docs
# http://localhost:8000/docs

# Frontend: Check browser console
# Module should appear in sidebar automatically
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Module not loading | Check router.py exports `router` |
| Module not in sidebar | Run `npm run build` after adding frontend files |
| API returns 404 | Restart service: `systemctl restart copanel` |
| CORS error | Check frontend proxy in vite.config.ts |
| TypeScript error | Run `npx tsc --noEmit` to check types |
| Styling issues | Hard refresh browser (Ctrl+Shift+Delete) |

## Quick Deploy Checklist

- [ ] router.py created with `router` export
- [ ] frontend config.ts has all required fields
- [ ] Module folder is in correct location
- [ ] No TypeScript/Python errors in console
- [ ] `systemctl restart copanel` executed
- [ ] Frontend rebuilt with `npm run build`
- [ ] Module appears in sidebar
- [ ] API responds at correct endpoint
- [ ] No console errors
- [ ] Dark theme compatible

---

**Happy Module Building! 🚀**
