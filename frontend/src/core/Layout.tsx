/**
 * Main Layout component with dynamic sidebar and access control
 */
import { useState, useEffect } from 'react';
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

  Globe: Icons.Globe,
  Zap: Icons.Zap,
  Database: Icons.Database,
  Cpu: Icons.Cpu,
  Shield: Icons.Shield,
  Lock: Icons.Lock,
  ShieldAlert: Icons.ShieldAlert,
  Box: Icons.Box,
  Package: Icons.Package,
  Server: Icons.Server,
  Users: Icons.Users,

  // Default
  Grid: Icons.Grid,
  Settings: Icons.Settings,
  Home: Icons.Home,
};

export default function Layout({ user, onLogout }: { user?: any; onLogout?: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const modules = moduleRegistry.getAll();
  const [installedPackages, setInstalledPackages] = useState<any[]>([]);
  
  // Change password modal state
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [oldPwdInput, setOldPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  const handlePasswordChange = async () => {
    if (!oldPwdInput || !newPwdInput) {
      setPwdMsg('Please enter both old and new passwords.');
      return;
    }
    const token = localStorage.getItem('copanel_token');
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ old_password: oldPwdInput, new_password: newPwdInput })
      });
      if (r.ok) {
        setPwdMsg('Password updated successfully.');
        setOldPwdInput('');
        setNewPwdInput('');
        setTimeout(() => setChangePwdOpen(false), 1500);
      } else {
        const d = await r.json();
        setPwdMsg(d.detail || 'Failed to change password.');
      }
    } catch {
      setPwdMsg('Network error.');
    }
  };

  useEffect(() => {
    const fetchInstalledPackages = () => {
      fetch('/api/package_manager')
        .then((r) => r.json())
        .then((data) => {
          if (data && data.packages) {
            setInstalledPackages(data.packages.filter((p: any) => p.status !== 'not_installed'));
          }
        })
        .catch((err) => console.error('Error fetching packages in Layout:', err));
    };

    fetchInstalledPackages();
    const interval = setInterval(fetchInstalledPackages, 5000);
    return () => clearInterval(interval);
  }, []);

  const getIcon = (iconName: string) => {
    const IconComponent = iconMap[iconName] || Icons.Grid;
    return <IconComponent className="w-5 h-5" />;
  };

  const isActive = (path: string) => location.pathname === path;

  // Enforce module restrictions in sidebar
  const allowedModules = modules.filter((mod) => {
    if (!user || user.role === 'superadmin') return true;
    try {
      const permitted = typeof user.permitted_modules === 'string'
        ? JSON.parse(user.permitted_modules)
        : user.permitted_modules;
      if (Array.isArray(permitted) && permitted.includes('all')) return true;
      if (Array.isArray(permitted)) {
        return permitted.includes(mod.name.toLowerCase().replace(/\s+/g, '_'));
      }
    } catch {
      return false;
    }
    return false;
  });

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

            {/* Allowed Core Module links */}
            {allowedModules.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase mt-6 mb-2">
                  Modules ({allowedModules.length})
                </div>
                {allowedModules.map((module) => (
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

            {/* Only SuperAdmins can view dynamic user manager */}
            {user && user.role === 'superadmin' && (
              <Link
                to="/users"
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mt-4',
                  isActive('/users')
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                )}
              >
                <Icons.Users className="w-5 h-5 text-indigo-400" />
                <span>Manage Users</span>
              </Link>
            )}

            {/* Installed Dynamic Packages */}
            {installedPackages.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase mt-6 mb-2">
                  Installed ({installedPackages.length})
                </div>
                {installedPackages.map((pkg) => (
                  <Link
                    key={pkg.id}
                    to="/package-manager"
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                      'text-slate-300 hover:bg-slate-800'
                    )}
                    title={pkg.description}
                  >
                    {getIcon(pkg.icon)}
                    <span className="truncate">{pkg.name}</span>
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
            <div className="flex flex-col text-right">
              <span className="text-sm font-bold text-slate-100">{user?.username || 'Guest'}</span>
              <button
                onClick={() => { setChangePwdOpen(!changePwdOpen); setPwdMsg(''); }}
                className="text-[10px] text-blue-400 hover:text-blue-300 underline text-right"
              >
                Change Password
              </button>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 text-red-400 font-bold rounded-xl transition-all"
              >
                <Icons.LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
            )}
          </div>
        </header>

        {/* Change Password Modal Popup Overlay */}
        {changePwdOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl relative">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">Change Password</h3>
                <button onClick={() => setChangePwdOpen(false)} className="text-slate-500 hover:text-slate-300">
                  <Icons.X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block">Old Password</label>
                <input
                  type="password"
                  value={oldPwdInput}
                  onChange={(e) => setOldPwdInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950/60 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block">New Password</label>
                <input
                  type="password"
                  value={newPwdInput}
                  onChange={(e) => setNewPwdInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950/60 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none transition-all"
                />
              </div>
              {pwdMsg && (
                <div className="text-[11px] font-bold text-indigo-400 bg-indigo-950/30 p-2 rounded-xl border border-indigo-900/40">
                  {pwdMsg}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setChangePwdOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePasswordChange}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}