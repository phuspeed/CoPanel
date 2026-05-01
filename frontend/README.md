# Frontend Setup Guide

## Quick Start

### Requirements
- Node.js 18+
- npm 9+ (or yarn/pnpm)

### Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Dev server runs on `http://localhost:5173`

### Building for Production

```bash
# Build optimized bundle
npm run build

# Preview production build locally
npm run preview
```

Built assets go to `dist/` folder

## Project Structure

```
frontend/
├── src/
│   ├── core/
│   │   ├── registry.ts     # Dynamic module registry
│   │   ├── Layout.tsx      # Main layout component
│   │   └── routes.tsx      # Router configuration
│   ├── modules/            # Plugin modules
│   │   └── system_monitor/
│   │       ├── index.tsx   # Component
│   │       └── config.ts   # Config (auto-loaded)
│   ├── lib/
│   │   └── utils.ts        # Helper utilities
│   ├── App.tsx             # App entry point
│   ├── main.tsx            # React DOM render
│   └── index.css           # Global styles
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── index.html
```

## Module Development

### Creating a New Module

1. Create folder: `src/modules/{module_name}/`

2. Create `config.ts`:

```typescript
import YourComponent from './index';

export default {
  // Required
  name: 'Your Module Name',        // Display name
  path: '/your-module',             // Route path
  component: YourComponent,         // React component
  
  // Optional
  icon: 'BarChart3',                // Lucide icon name
  description: 'Module description',
};
```

3. Create `index.tsx`:

```typescript
export default function YourModule() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Your Module</h1>
      <p>Module content here</p>
    </div>
  );
}
```

The module appears automatically:
- In the sidebar
- In the router
- Ready to access!

### Module Best Practices

1. **Use hooks** for state management:

```typescript
import { useState, useEffect } from 'react';

export default function MyModule() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    // Fetch data
    fetch('/api/my_module/data')
      .then(r => r.json())
      .then(d => setData(d.data));
  }, []);
  
  return <div>{/* Render data */}</div>;
}
```

2. **Fetch API data** from backend:

```typescript
// Backend module must have router at /api/module_name/
const response = await fetch('/api/system_monitor/stats');
const result = await response.json();
```

3. **Use Tailwind CSS** for styling:

```typescript
<div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
  <h2 className="text-lg font-semibold mb-4">Title</h2>
</div>
```

4. **Use Lucide icons**:

```typescript
import * as Icons from 'lucide-react';

<Icons.Home className="w-5 h-5" />
<Icons.Settings className="w-5 h-5" />
```

## Core Systems

### Module Registry (`core/registry.ts`)

Automatically discovers modules using Vite glob imports:

```typescript
// Scans: src/modules/*/config.ts
const modules = moduleRegistry.getAll();
const module = moduleRegistry.getByName('System Monitor');
const exists = moduleRegistry.exists('system_monitor');
```

**Interfaces**:

```typescript
interface ModuleConfig {
  name: string;                           // Display name
  icon: string;                           // Lucide icon
  path: string;                           // Route path
  component: React.ComponentType<any>;    // React component
  description?: string;                   // Optional description
}
```

### Layout (`core/Layout.tsx`)

Main layout with:
- Responsive sidebar
- Dynamic module navigation
- Top header bar
- Content area with Outlet

Features:
- Mobile-responsive
- Dark mode by default
- Auto-updating sidebar
- Active route highlighting

### Router (`core/routes.tsx`)

Dynamic routing using React Router:
- Auto-generates routes from registry
- Handles 404 fallback
- Layout wrapper
- Navigation support

## Styling

### Tailwind CSS

Global configuration in `tailwind.config.js`:

```typescript
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { /* ... */ },
  plugins: [],
}
```

### CSS Classes

Common patterns:

```typescript
// Dark background
<div className="bg-slate-900 text-slate-50">

// Cards
<div className="bg-slate-900 border border-slate-800 rounded-lg p-6">

// Text styles
<h1 className="text-3xl font-bold">Title</h1>
<p className="text-sm text-slate-400">Description</p>

// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

// Flex layouts
<div className="flex items-center justify-between gap-4">
```

## Icon Reference

Common Lucide icons used:

```typescript
import * as Icons from 'lucide-react';

<Icons.Home />           // Home
<Icons.Settings />       // Settings
<Icons.Menu />           // Menu toggle
<Icons.Activity />       // Activity
<Icons.BarChart />       // Chart
<Icons.HardDrive />      // Disk
<Icons.Zap />            // Power/Processes
<Icons.Cpu />            // CPU
<Icons.Loader />         // Loading spinner
<Icons.AlertCircle />    // Error
<Icons.CheckCircle />    // Success
```

[View all Lucide icons](https://lucide.dev)

## Charts with Recharts

Example line chart:

```typescript
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { time: '00:00', cpu: 20, memory: 30 },
  { time: '00:05', cpu: 25, memory: 35 },
];

<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    <CartesianGrid stroke="#334155" />
    <XAxis dataKey="time" stroke="#64748b" />
    <YAxis stroke="#64748b" />
    <Tooltip />
    <Line type="monotone" dataKey="cpu" stroke="#3b82f6" />
    <Line type="monotone" dataKey="memory" stroke="#ef4444" />
  </LineChart>
</ResponsiveContainer>
```

[Recharts Documentation](https://recharts.org)

## API Communication

### Fetch from backend:

```typescript
// GET request
const response = await fetch('/api/module_name/endpoint');
const data = await response.json();

// POST request
const response = await fetch('/api/module_name/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ /* data */ }),
});

// With error handling
try {
  const res = await fetch('/api/...');
  if (!res.ok) throw new Error('API error');
  const data = await res.json();
} catch (error) {
  console.error(error);
}
```

### In development

API requests are proxied to `http://localhost:8000` (see `vite.config.ts`)

## Performance Tips

1. **Code splitting**: Modules load dynamically
2. **Image optimization**: Use appropriate formats
3. **Lazy loading**: React.lazy() for routes
4. **Memoization**: useMemo, useCallback for expensive ops
5. **State management**: Keep state local when possible

## Troubleshooting

### Module not appearing

```bash
# Check module structure
ls -la src/modules/your_module/
# Must have: config.ts and index.tsx

# Rebuild frontend
npm run build

# Hard refresh browser (Ctrl+Shift+Delete)
```

### API calls fail

```bash
# Check backend is running
curl http://localhost:8000/health

# Check proxy config
cat vite.config.ts
# Should proxy /api to http://localhost:8000
```

### Styles not loading

```bash
# Rebuild Tailwind
npm run build

# Check tailwind.config.js includes your files
cat tailwind.config.js
```

### TypeScript errors

```bash
# Check TypeScript config
npx tsc --noEmit

# Install missing types
npm install --save-dev @types/react @types/react-dom
```

## Building for Production

```bash
# Build optimized bundle
npm run build

# Check bundle size
ls -lh dist/

# Preview
npm run preview
```

Output goes to `dist/` folder, ready to serve with Nginx.

## Dependencies

Key packages:
- **react**: UI library
- **react-router-dom**: Client-side routing
- **vite**: Build tool & dev server
- **tailwindcss**: CSS framework
- **recharts**: Chart library
- **lucide-react**: Icon library
- **typescript**: Type safety

## Development Tips

### Hot Module Replacement (HMR)

Vite provides HMR out of the box:
- Change code → Browser updates instantly
- No manual refresh needed

### Component Debugging

```typescript
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    console.log('Component mounted');
    return () => console.log('Component unmounted');
  }, []);
  
  return <div>Component</div>;
}
```

### Browser DevTools

- React DevTools extension
- Redux DevTools (if using Redux)
- Network tab for API debugging

---

For more information, see the main [README.md](../README.md)
