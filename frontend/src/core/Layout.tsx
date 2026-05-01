/**
 * Main Layout component with dynamic sidebar
 */
import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { moduleRegistry } from './registry';
import * as Icons from 'lucide-react';
import { cn } from '../lib/utils';

interface IconProps {
  className?: string;
}

// Icon mapping
const iconMap: Record<string, React.ComponentType<IconProps>> = {
  // System Monitor
  Activity: Icons.Activity,
  BarChart3: Icons.BarChart3,
  BarChart: Icons.BarChart,
  
  // File Manager
  Folder: Icons.Folder,
  FileText: Icons.FileText,
  Upload: Icons.Upload,
  
  // Default
  Grid: Icons.Grid,
  Settings: Icons.Settings,
  Home: Icons.Home,
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const modules = moduleRegistry.getAll();

  const getIcon = (iconName: string) => {
    const IconComponent = iconMap[iconName] || Icons.Grid;
    return <IconComponent className="w-5 h-5" />;
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-slate-900 border-r border-slate-800 transition-transform duration-300 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-slate-800">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Icons.Server className="w-6 h-6 text-blue-400" />
              CoPanel
            </h1>
            <p className="text-xs text-slate-400 mt-1">VPS Management</p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-2">
            {/* Dashboard link */}
            <Link
              to="/"
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                isActive('/')
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              )}
            >
              <Icons.Home className="w-5 h-5" />
              <span>Dashboard</span>
            </Link>

            {/* Module links */}
            {modules.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase mt-6 mb-2">
                  Modules ({modules.length})
                </div>
                {modules.map((module) => (
                  <Link
                    key={module.path}
                    to={module.path}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                      isActive(module.path)
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    )}
                    title={module.description}
                  >
                    {getIcon(module.icon)}
                    <span className="truncate">{module.name}</span>
                  </Link>
                ))}
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-slate-800 text-xs text-slate-400">
            <p>v1.0.0</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-slate-800 rounded-lg lg:hidden"
          >
            {sidebarOpen ? (
              <Icons.X className="w-5 h-5" />
            ) : (
              <Icons.Menu className="w-5 h-5" />
            )}
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">Admin</span>
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              <Icons.User className="w-4 h-4" />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
