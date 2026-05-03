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
  Activity: Icons.Activity,
  BarChart3: Icons.BarChart3,
  BarChart: Icons.BarChart,
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
  Grid: Icons.Grid,
  Settings: Icons.Settings,
  Home: Icons.Home,
};

export default function Layout({ user, onLogout }: { user?: any; onLogout?: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const location = useLocation();
  const modules = moduleRegistry.getAll();
  const [installedPackages, setInstalledPackages] = useState<any[]>([]);

  // Theme & Language Global States
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('copanel_theme') as 'dark' | 'light') || 'light';
  });
  const [language, setLanguage] = useState<'en' | 'vi'>(() => {
    return (localStorage.getItem('copanel_lang') as 'en' | 'vi') || 'en';
  });

  // Modal states
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [oldPwdInput, setOldPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  const isDark = theme === 'dark';

  const t = {
    en: {
      dashboard: 'Dashboard',
      modules: 'Modules',
      installed: 'Installed',
      manageUsers: 'Manage Users',
      changePassword: 'Change Password',
      logout: 'Logout',
      vpsManagement: 'VPS Management',
      oldPassword: 'Old Password',
      newPassword: 'New Password',
      update: 'Update',
      cancel: 'Cancel',
      language: 'English',
      themeTitle: isDark ? 'Switch to Light' : 'Switch to Dark',
      modulesNames: {
        'appstore_manager': 'App Store',
        'app_store': 'App Store',
        'backup_manager': 'Backup',
        'docker_manager': 'Docker',
        'file_manager': 'Files',
        'firewall': 'Firewall',
        'package_manager': 'Packages',
        'ssl_manager': 'SSL',
        'system_monitor': 'Monitor',
        'terminal': 'Terminal',
        'users': 'Users',
        'web_manager': 'Web'
      }
    },
    vi: {
      dashboard: 'Tổng quan',
      modules: 'Các Module',
      installed: 'Đã cài đặt',
      manageUsers: 'Quản lý người dùng',
      changePassword: 'Đổi mật khẩu',
      logout: 'Đăng xuất',
      vpsManagement: 'Quản lý VPS',
      oldPassword: 'Mật khẩu cũ',
      newPassword: 'Mật khẩu mới',
      update: 'Cập nhật',
      cancel: 'Hủy',
      language: 'Tiếng Việt',
      themeTitle: isDark ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối',
      modulesNames: {
        'appstore_manager': 'Kho ứng dụng',
        'app_store': 'Kho ứng dụng',
        'backup_manager': 'Sao lưu',
        'docker_manager': 'Docker',
        'file_manager': 'Quản lý file',
        'firewall': 'Tường lửa',
        'package_manager': 'Cài đặt gói',
        'ssl_manager': 'Quản lý SSL',
        'system_monitor': 'Theo dõi hệ thống',
        'terminal': 'Dòng lệnh',
        'users': 'Người dùng',
        'web_manager': 'Quản lý Web'
      }
    }
  };

  const tr = t[language];

  useEffect(() => {
    localStorage.setItem('copanel_theme', theme);
    localStorage.setItem('copanel_lang', language);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme, language]);

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

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

  const getModuleName = (mod: any) => {
    const key = mod.name.toLowerCase().replace(/\s+/g, '_');
    return (tr as any).modulesNames?.[key] || mod.name;
  };

  const isActive = (path: string) => location.pathname === path;

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
    <div className={`flex h-screen transition-colors duration-200 ${
      isDark ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900'
    }`}>
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm animate-fade-in"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 border-r transition-transform duration-300 lg:static lg:translate-x-0',
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-md',
          sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className={`p-6 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Icons.Server className={`w-6 h-6 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              CoPanel
            </h1>
            <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {tr.vpsManagement}
            </p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-2">
            {/* Dashboard link */}
            <Link
              to="/"
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                isActive('/')
                  ? 'bg-blue-600 text-white font-bold'
                  : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'
              )}
            >
              <Icons.Home className="w-5 h-5" />
              <span>{tr.dashboard}</span>
            </Link>

            {/* Allowed Core Module links */}
            {allowedModules.length > 0 && (
              <>
                <div className={`px-4 py-2 text-xs font-semibold uppercase mt-6 mb-2 ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  {tr.modules} ({allowedModules.length})
                </div>
                {allowedModules.map((module) => (
                  <Link
                    key={module.path}
                    to={module.path}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                      isActive(module.path)
                        ? 'bg-blue-600 text-white font-bold'
                        : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'
                    )}
                    title={module.description}
                  >
                    {getIcon(module.icon)}
                    <span className="truncate">{getModuleName(module)}</span>
                  </Link>
                ))}
              </>
            )}

            {/* Manage Users (SuperAdmin only) */}
            {user && user.role === 'superadmin' && (
              <Link
                to="/users"
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mt-4',
                  isActive('/users')
                    ? 'bg-indigo-600 text-white font-bold'
                    : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                <Icons.Users className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                <span>{tr.manageUsers}</span>
              </Link>
            )}

            {/* Installed Dynamic Packages */}
            {installedPackages.length > 0 && (
              <>
                <div className={`px-4 py-2 text-xs font-semibold uppercase mt-6 mb-2 ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  {tr.installed} ({installedPackages.length})
                </div>
                {installedPackages.map((pkg) => (
                  <Link
                    key={pkg.id}
                    to={`/package-manager?id=${pkg.id}`}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                      location.search === `?id=${pkg.id}`
                        ? 'bg-blue-600 text-white font-bold'
                        : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'
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
          <div className={`p-4 border-t text-xs ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
            <p>v1.0.0</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className={`px-6 py-4 flex items-center justify-between border-b transition-colors duration-200 ${
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`p-2 rounded-lg lg:hidden ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
            >
              {sidebarOpen ? <Icons.X className="w-5 h-5" /> : <Icons.Menu className="w-5 h-5" />}
            </button>

            {/* Language & Theme switches in Layout Top bar */}
            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className={`p-2 rounded-xl border transition duration-150 ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-yellow-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                }`}
                title={tr.themeTitle}
              >
                {isDark ? <Icons.Sun className="w-4 h-4" /> : <Icons.Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs transition duration-150 ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <Icons.Globe className="w-3.5 h-3.5" />
                {language === 'en' ? 'EN' : 'VI'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col text-right">
              <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {user?.username || 'Guest'}
              </span>
              <button
                onClick={() => { setChangePwdOpen(!changePwdOpen); setPwdMsg(''); }}
                className="text-[10px] text-blue-400 hover:text-blue-300 underline text-right"
              >
                {tr.changePassword}
              </button>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 text-red-400 font-bold rounded-xl transition-all"
              >
                <Icons.LogOut className="w-3.5 h-3.5" />
                {tr.logout}
              </button>
            )}
          </div>
        </header>

        {/* Change Password Modal */}
        {changePwdOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in select-none">
            <div className={`p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl relative border ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{tr.changePassword}</h3>
                <button onClick={() => setChangePwdOpen(false)} className="text-slate-500 hover:text-slate-300">
                  <Icons.X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block">{tr.oldPassword}</label>
                <input
                  type="password"
                  value={oldPwdInput}
                  onChange={(e) => setOldPwdInput(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all border ${
                    isDark
                      ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 focus:border-blue-500 text-slate-100'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 focus:border-blue-500 text-slate-800'
                  }`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block">{tr.newPassword}</label>
                <input
                  type="password"
                  value={newPwdInput}
                  onChange={(e) => setNewPwdInput(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all border ${
                    isDark
                      ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 focus:border-blue-500 text-slate-100'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 focus:border-blue-500 text-slate-800'
                  }`}
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
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tr.cancel}
                </button>
                <button
                  onClick={handlePasswordChange}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all"
                >
                  {tr.update}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <main className={`flex-1 overflow-auto pb-20 lg:pb-0 transition-colors duration-200 ${
          isDark ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900'
        }`}>
          <Outlet context={{ theme, setTheme, language, setLanguage }} />
        </main>

        {/* Mobile Bottom Footer Menu */}
        <div className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden flex justify-around items-center h-16 border-t backdrop-blur-md px-2 ${
          isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200 shadow-lg'
        }`}>
          <Link
            to="/"
            className={cn(
              'flex flex-col items-center justify-center w-full h-full text-xs font-bold gap-1 transition duration-150',
              isActive('/')
                ? 'text-blue-500'
                : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icons.Home className="w-5 h-5" />
            <span className="text-[10px] truncate">{tr.dashboard}</span>
          </Link>
          <Link
            to="/web-manager"
            className={cn(
              'flex flex-col items-center justify-center w-full h-full text-xs font-bold gap-1 transition duration-150',
              isActive('/web-manager')
                ? 'text-blue-500'
                : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icons.Globe className="w-5 h-5" />
            <span className="text-[10px] truncate">{(tr as any).modulesNames?.['web_manager']}</span>
          </Link>
          <Link
            to="/file-manager"
            className={cn(
              'flex flex-col items-center justify-center w-full h-full text-xs font-bold gap-1 transition duration-150',
              isActive('/file-manager')
                ? 'text-blue-500'
                : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icons.Folder className="w-5 h-5" />
            <span className="text-[10px] truncate">{(tr as any).modulesNames?.['file_manager']}</span>
          </Link>
          <Link
            to="/terminal"
            className={cn(
              'flex flex-col items-center justify-center w-full h-full text-xs font-bold gap-1 transition duration-150',
              isActive('/terminal')
                ? 'text-blue-500'
                : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icons.Terminal className="w-5 h-5" />
            <span className="text-[10px] truncate">{(tr as any).modulesNames?.['terminal']}</span>
          </Link>
          <Link
            to="/system-monitor"
            className={cn(
              'flex flex-col items-center justify-center w-full h-full text-xs font-bold gap-1 transition duration-150',
              isActive('/system-monitor')
                ? 'text-blue-500'
                : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <Icons.Activity className="w-5 h-5" />
            <span className="text-[10px] truncate">{(tr as any).modulesNames?.['system_monitor']}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}