/**
 * Main Layout component with dynamic sidebar and access control.
 *
 * Phase 2 (Synology-style shell): adds the App Launcher overlay, Task
 * Center drawer, Notification Center drawer, and a global ToastLayer fed
 * by the platform event hub.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { moduleRegistry } from './registry';
import * as Icons from 'lucide-react';
import { cn } from '../lib/utils';
import AppLauncher from './shell/AppLauncher';
import NotificationCenter from './shell/NotificationCenter';
import TaskCenter from './shell/TaskCenter';
import ToastLayer from './shell/ToastLayer';
import DesktopShell from './shell/DesktopShell';
import { activeWallpaperDataUrl, type BrandingSettings } from './brandingTypes';
import Dock from './shell/Dock';
import StartMenu from './shell/StartMenu';
import UserMenu from './shell/UserMenu';
import {
  isLayoutViewportWide,
  isMobileDesktopSiteEnabled,
  setMobileDesktopSite,
  shouldOfferMobileDesktopSiteToggle,
} from './viewportDesktopSite';
import WindowLayer from './shell/WindowLayer';
import { moduleSupportsWindows, openModuleWindow } from './shell/openModuleWindow';
import { DOCK_HEIGHT } from './shell/windowTypes';
import { useDesktopKeyboard } from './shell/useDesktopKeyboard';
import { jobsApi, notificationsApi, PLATFORM_SSE_DEGRADED_EVENT, reconnectPlatformEvents, useInbox, useJobs, api } from './platform';
import { apiFetch } from './authHeaders';

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
  Trash2: Icons.Trash2,
  HardDrive: Icons.HardDrive,
};

export default function Layout({
  user,
  onLogout,
  branding,
}: {
  user?: any;
  onLogout?: () => void;
  branding?: BrandingSettings;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const location = useLocation();
  const navigate = useNavigate();
  const modules = moduleRegistry.getAll();
  const [installedPackages, setInstalledPackages] = useState<any[]>([]);

  // Theme & Language Global States
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('copanel_theme') as 'dark' | 'light') || 'light';
  });
  const [language, setLanguage] = useState<'en' | 'vi'>(() => {
    return (localStorage.getItem('copanel_lang') as 'en' | 'vi') || 'en';
  });

  const [desktopMode, setDesktopMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('copanel_desktop_ui');
    if (saved === '0') return false;
    if (saved === '1') return true;
    return isLayoutViewportWide();
  });
  const [viewportWide, setViewportWide] = useState(() => isLayoutViewportWide());

  // Modal states
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [oldPwdInput, setOldPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  // Shell overlays (App Launcher, Task Center, Notification Center)
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { running } = useJobs();
  const { unread } = useInbox();

  const [footerVersion, setFooterVersion] = useState<string>('…');
  const [panelUpdate, setPanelUpdate] = useState<{
    local_version: string;
    remote_version: string | null;
    update_available: boolean;
    changelog: string | null;
    release_url: string;
    fetch_error: string | null;
    fetch_error_kind?: 'rate_limit' | 'network' | 'unknown' | null;
  } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeRunning, setUpgradeRunning] = useState(false);
  const [upgradeLog, setUpgradeLog] = useState('');
  const [upgradeProgress, setUpgradeProgress] = useState(0);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const upgradeLogRef = useRef<HTMLPreElement>(null);
  const [lanIp, setLanIp] = useState<string | null>(null);
  const [serverHostname, setServerHostname] = useState<string | null>(null);

  const isDark = theme === 'dark';
  const siteTitle = branding?.site_title?.trim() || 'CoPanel';
  const wallpaperDataUrl = activeWallpaperDataUrl(branding);

  const t = {
    en: {
      dashboard: 'Dashboard',
      modules: 'Modules',
      installed: 'Installed',
      changePassword: 'Change Password',
      logout: 'Logout',
      settings: 'Settings',
      vpsManagement: 'VPS Management',
      oldPassword: 'Old Password',
      newPassword: 'New Password',
      update: 'Update',
      cancel: 'Cancel',
      language: 'English',
      themeTitle: isDark ? 'Switch to Light' : 'Switch to Dark',
      mobileDesktopSiteOn: 'Request desktop site',
      mobileDesktopSiteOff: 'Use mobile layout',
      mobileDesktopSiteShort: 'Desktop site',
      mobileDesktopSiteBanner: 'View full desktop layout',
      desktopUi: 'Desktop UI',
      upgradeAvailable: 'Update available',
      upgradeTitle: 'Upgrade CoPanel',
      upgradeIntro:
        'The installer pulls the latest code from GitHub, rebuilds the frontend, and restarts services. This may take several minutes.',
      startUpgrade: 'Start upgrade',
      close: 'Close',
      changelog: 'Release notes',
      liveLog: 'Installer output',
      progress: 'Progress',
      reloading: 'Reloading…',
      upgradeRunning: 'Installation running…',
      upgradeDone: 'Upgrade finished successfully. Reloading the page…',
      upgradeFailed: 'Upgrade reported an error. Review the log below.',
      streamEnded: 'Connection closed — the service may be restarting. Waiting until the panel is healthy again…',
      checkUpdateFailed: 'Could not reach GitHub to check for updates.',
      checkUpdateRateLimited: 'GitHub rate limit — update check will retry later.',
      upToDate: 'You are on the latest version.',
      viewReleases: 'View on GitHub',
      lanIp: 'LAN IP',
      hostname: 'Host',
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
        'web_browser': 'Web Browser',
        'web_manager': 'Web',
        'settings': 'System Settings',
      }
    },
    vi: {
      dashboard: 'Tổng quan',
      modules: 'Các Module',
      installed: 'Đã cài đặt',
      changePassword: 'Đổi mật khẩu',
      settings: 'Cài đặt',
      logout: 'Đăng xuất',
      vpsManagement: 'Quản lý VPS',
      oldPassword: 'Mật khẩu cũ',
      newPassword: 'Mật khẩu mới',
      update: 'Cập nhật',
      cancel: 'Hủy',
      language: 'Tiếng Việt',
      themeTitle: isDark ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối',
      mobileDesktopSiteOn: 'Yêu cầu trang web cho máy tính',
      mobileDesktopSiteOff: 'Dùng giao diện di động',
      mobileDesktopSiteShort: 'Máy tính',
      mobileDesktopSiteBanner: 'Xem giao diện máy tính đầy đủ',
      desktopUi: 'Giao diện Desktop',
      upgradeAvailable: 'Có bản cập nhật',
      upgradeTitle: 'Nâng cấp CoPanel',
      upgradeIntro:
        'Trình cài đặt sẽ kéo mã mới nhất từ GitHub, build lại frontend và khởi động lại dịch vụ. Quá trình có thể mất vài phút.',
      startUpgrade: 'Bắt đầu nâng cấp',
      close: 'Đóng',
      changelog: 'Nhật ký phiên bản',
      liveLog: 'Nhật ký cài đặt',
      progress: 'Tiến trình',
      reloading: 'Đang tải lại…',
      upgradeRunning: 'Đang chạy cài đặt…',
      upgradeDone: 'Nâng cấp thành công. Đang tải lại trang…',
      upgradeFailed: 'Nâng cấp báo lỗi. Xem nhật ký bên dưới.',
      streamEnded: 'Kết nối đã đóng — dịch vụ có thể đang khởi động lại. Đang chờ panel hoạt động trở lại…',
      checkUpdateFailed: 'Không kiểm tra được bản cập nhật từ GitHub.',
      checkUpdateRateLimited: 'GitHub giới hạn tần suất — sẽ thử lại sau.',
      upToDate: 'Bạn đang dùng phiên bản mới nhất.',
      viewReleases: 'Xem trên GitHub',
      lanIp: 'IP LAN',
      hostname: 'Máy chủ',
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
        'web_browser': 'Trình duyệt Web',
        'web_manager': 'Quản lý Web',
        'settings': 'Cài đặt hệ thống',
      }
    }
  };

  const tr = t[language];
  const siteSubtitle = branding?.site_subtitle?.trim() || tr.vpsManagement;
  const logoDataUrl = branding?.logo_data_url || null;

  const pollHealthUntilVersion = useCallback(
    (want: string) => {
      let n = 0;
      const iv = window.setInterval(async () => {
        n += 1;
        try {
          const h = await fetch('/health');
          const j = await h.json();
          if (j?.version && want && String(j.version) === want) {
            window.clearInterval(iv);
            setUpgradeProgress(100);
            setUpgradeSuccess(true);
            setUpgradeRunning(false);
            window.setTimeout(() => window.location.reload(), 1600);
          }
        } catch {
          /* ignore */
        }
        if (n >= 45) window.clearInterval(iv);
      }, 2000);
    },
    []
  );

  const runPanelUpgrade = useCallback(async () => {
    const token = localStorage.getItem('copanel_token');
    if (!token) return;
    setUpgradeRunning(true);
    setUpgradeSuccess(false);
    setUpgradeLog('');
    setUpgradeProgress(6);
    let buf = '';
    let sawExit = false;
    try {
      const res = await fetch('/api/platform/panel-update/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        setUpgradeLog(`HTTP ${res.status}\n${text}\n`);
        setUpgradeRunning(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setUpgradeRunning(false);
        return;
      }
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        buf += chunk;
        setUpgradeLog((prev) => prev + chunk);
        const lines = chunk.split('\n').length;
        setUpgradeProgress((p) => Math.min(90, p + lines * 0.35));
        const m = buf.match(/__COPANEL_EXIT__:(-?\d+)/);
        if (m) {
          sawExit = true;
          const code = parseInt(m[1], 10);
          setUpgradeRunning(false);
          if (code === 0) {
            setUpgradeProgress(100);
            setUpgradeSuccess(true);
            window.setTimeout(() => window.location.reload(), 2800);
          }
          break;
        }
      }
      if (!sawExit) {
        setUpgradeLog((prev) => `${prev}\n\n${tr.streamEnded}\n`);
        const want = panelUpdate?.remote_version;
        if (want) pollHealthUntilVersion(want);
        else window.setTimeout(() => window.location.reload(), 10000);
      }
    } catch (e) {
      setUpgradeLog((prev) => `${prev}\n${String(e)}`);
      setUpgradeRunning(false);
    }
  }, [panelUpdate?.remote_version, pollHealthUntilVersion, tr.streamEnded]);

  useEffect(() => {
    upgradeLogRef.current?.scrollTo({ top: upgradeLogRef.current.scrollHeight });
  }, [upgradeLog]);

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then((j) => setFooterVersion(j?.version ? String(j.version) : '…'))
      .catch(() => setFooterVersion('…'));
  }, []);

  useEffect(() => {
    if (user?.role !== 'superadmin') return;
    const check = () => {
      const token = localStorage.getItem('copanel_token');
      if (!token) return;
      fetch('/api/platform/panel-update/check', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((body) => {
          if (body?.status === 'success' && body.data) setPanelUpdate(body.data);
        })
        .catch(() => {});
    };
    check();
    const id = window.setInterval(check, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'superadmin') return;
    const loadNetworkSummary = () => {
      api<{ lan_ip: string | null; hostname: string }>('/api/panel_settings/network/summary')
        .then((data) => {
          setLanIp(data.lan_ip);
          setServerHostname(data.hostname);
        })
        .catch(() => {});
    };
    loadNetworkSummary();
    const id = window.setInterval(loadNetworkSummary, 60_000);
    return () => window.clearInterval(id);
  }, [user?.role]);

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
    localStorage.setItem('copanel_desktop_ui', desktopMode ? '1' : '0');
  }, [desktopMode]);

  useEffect(() => {
    if (localStorage.getItem('copanel_desktop_ui') != null) return;
    fetch('/ui-track.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ui_track?: string } | null) => {
        if (data?.ui_track === 'desktop') setDesktopMode(true);
        if (data?.ui_track === 'classic') setDesktopMode(false);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWide(isLayoutViewportWide());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleMobileDesktopSite = () => {
    setMobileDesktopSite(!isMobileDesktopSiteEnabled());
  };

  const showMobileDesktopSiteToggle = shouldOfferMobileDesktopSiteToggle();

  const useDesktopShell = desktopMode && viewportWide;
  const isDashboardHome = location.pathname === '/' || location.pathname === '/dashboard';
  const isWindowRoute = moduleSupportsWindows(location.pathname);

  useEffect(() => {
    if (!useDesktopShell) return;
    if (!moduleSupportsWindows(location.pathname)) return;
    openModuleWindow(location.pathname);
    navigate('/dashboard', { replace: true });
  }, [location.pathname, useDesktopShell, navigate]);

  const shellContext = { theme, setTheme, language, setLanguage };

  useDesktopKeyboard(useDesktopShell);

  useEffect(() => {
    if (!isLayoutViewportWide()) {
      setSidebarOpen(false);
    }
  }, [location.pathname, viewportWide]);

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

  // Fetch jobs / notifications when the authenticated session is known, and
  // reconnect SSE so live updates work after login (handlers may have
  // subscribed before `copanel_token` existed).
  const sessionKey = user?.id ?? user?.username;
  useEffect(() => {
    if (!sessionKey) return;
    jobsApi.refresh().catch(() => {});
    notificationsApi.refresh().catch(() => {});
    reconnectPlatformEvents();
  }, [sessionKey]);

  useEffect(() => {
    if (!sessionKey) return;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const onDegraded = () => {
      jobsApi.refresh().catch(() => {});
      notificationsApi.refresh().catch(() => {});
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          jobsApi.refresh().catch(() => {});
          notificationsApi.refresh().catch(() => {});
        }, 30000);
      }
    };
    window.addEventListener(PLATFORM_SSE_DEGRADED_EVENT, onDegraded);
    return () => {
      window.removeEventListener(PLATFORM_SSE_DEGRADED_EVENT, onDegraded);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [sessionKey]);

  // Global keyboard shortcut: Cmd/Ctrl+K opens the App Launcher
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLauncherOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setLauncherOpen(false);
        setTasksOpen(false);
        setNotificationsOpen(false);
        if (!upgradeRunning) setUpgradeOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const fetchInstalledPackages = () => {
      apiFetch('/api/package_manager/list')
        .then(async (r) => {
          if (r.ok) return r;
          const alt = await apiFetch('/api/package_manager/');
          if (alt.ok) return alt;
          const fallback = await apiFetch('/api/package_manager');
          return fallback;
        })
        .then(async (r) => {
          if (!r.ok) return null;
          const ct = r.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            return null;
          }
          return r.json();
        })
        .then((data) => {
          if (data && data.packages) {
            setInstalledPackages(data.packages.filter((p: any) => p.status !== 'not_installed'));
          }
        })
        .catch(() => { /* backend down during restart — ignore */ });
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
  const normalizePermitted = (): string[] => {
    if (!user) return ['all'];
    if (user.role === 'superadmin') return ['all'];
    try {
      const permitted = typeof user.permitted_modules === 'string'
        ? JSON.parse(user.permitted_modules)
        : user.permitted_modules;
      return Array.isArray(permitted) ? permitted.map((m: any) => String(m)) : [];
    } catch {
      return [];
    }
  };
  const permittedModules = normalizePermitted();
  const hasAllAccess = permittedModules.includes('all');
  const isSuperAdmin = user?.role === 'superadmin';

  const moduleAllowedForUser = (mod: { path: string; name: string }) => {
    if (hasAllAccess) return true;
    return permittedModules.includes(mod.name.toLowerCase().replace(/\s+/g, '_'));
  };

  const allowedModules = modules.filter((mod) => {
    if (mod.path === '/settings') return false;
    return moduleAllowedForUser(mod);
  });

  const desktopModules = modules.filter((mod) => {
    if (mod.path === '/settings') return isSuperAdmin;
    return moduleAllowedForUser(mod);
  });
  const allowedInstalledPackages = installedPackages.filter((pkg) => {
    if (hasAllAccess) return true;
    return permittedModules.includes(String(pkg.id));
  });

  return (
    <div className={`flex h-screen transition-colors duration-200 ${isDark ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900'
      }`}>
      {/* Mobile Overlay */}
      {sidebarOpen && !useDesktopShell && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm animate-fade-in"
        />
      )}

      {/* Sidebar — classic mode only */}
      {!useDesktopShell && (
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
              {logoDataUrl ? (
                <img src={logoDataUrl} alt={`${siteTitle} logo`} className="w-6 h-6 rounded object-cover shrink-0" />
              ) : (
                <Icons.Server className={`w-6 h-6 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              )}
              {siteTitle}
            </h1>
            <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {siteSubtitle}
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
                <div className={`px-4 py-2 text-xs font-semibold uppercase mt-6 mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'
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

            {/* Installed Dynamic Packages */}
            {allowedInstalledPackages.length > 0 && (
              <>
                <div className={`px-4 py-2 text-xs font-semibold uppercase mt-6 mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}>
                  {tr.installed} ({allowedInstalledPackages.length})
                </div>
                {allowedInstalledPackages.map((pkg) => (
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

          {user?.role === 'superadmin' && (
            <div className={`px-4 pb-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              {(lanIp || serverHostname) && (
                <div
                  className={`mb-2 px-4 py-2 rounded-lg text-xs font-mono ${
                    isDark ? 'bg-slate-800/80 text-slate-300' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {serverHostname && (
                    <p className="truncate">
                      <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>{tr.hostname}: </span>
                      {serverHostname}
                    </p>
                  )}
                  {lanIp && (
                    <p className="truncate mt-0.5">
                      <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>{tr.lanIp}: </span>
                      {lanIp}
                    </p>
                  )}
                </div>
              )}
              <Link
                to="/settings"
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                  isActive('/settings')
                    ? 'bg-blue-600 text-white font-bold'
                    : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                <Icons.Settings className="w-5 h-5" />
                <span>{tr.settings}</span>
              </Link>
            </div>
          )}

          {/* Footer */}
          <div className={`p-4 border-t text-xs ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
            <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <span className="font-mono">v{footerVersion}</span>
              {user?.role === 'superadmin' && panelUpdate?.update_available && (
                <button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  className={`font-bold underline-offset-2 hover:underline ${isDark ? 'text-amber-400' : 'text-amber-600'}`}
                >
                  · {tr.upgradeAvailable}
                </button>
              )}
            </p>
            {user?.role === 'superadmin' && panelUpdate?.fetch_error && (
              <p className={`mt-1 text-[10px] ${isDark ? 'text-amber-500/90' : 'text-amber-700'}`}>
                {panelUpdate.fetch_error_kind === 'rate_limit' ? tr.checkUpdateRateLimited : tr.checkUpdateFailed}
              </p>
            )}
          </div>
        </div>
      </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar — classic mode only */}
        {!useDesktopShell && (
        <header className={`px-6 py-4 flex items-center justify-between border-b transition-colors duration-200 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
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
                className={`p-2 rounded-xl border transition duration-150 ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-yellow-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                title={tr.themeTitle}
              >
                {isDark ? <Icons.Sun className="w-4 h-4" /> : <Icons.Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs transition duration-150 ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
              >
                <Icons.Globe className="w-3.5 h-3.5" />
                {language === 'en' ? 'EN' : 'VI'}
              </button>
              {showMobileDesktopSiteToggle && (
                <button
                  type="button"
                  onClick={toggleMobileDesktopSite}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border font-bold text-[11px] transition duration-150 ${
                    isMobileDesktopSiteEnabled()
                      ? isDark
                        ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                        : 'bg-sky-50 border-sky-300 text-sky-700'
                      : isDark
                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                  title={isMobileDesktopSiteEnabled() ? tr.mobileDesktopSiteOff : tr.mobileDesktopSiteOn}
                  aria-label={isMobileDesktopSiteEnabled() ? tr.mobileDesktopSiteOff : tr.mobileDesktopSiteOn}
                >
                  <Icons.MonitorSmartphone className="w-3.5 h-3.5 shrink-0" />
                  <span className="max-w-[5.5rem] truncate">
                    {isMobileDesktopSiteEnabled() ? tr.mobileDesktopSiteOff : tr.mobileDesktopSiteShort}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <ShellIconButton
              isDark={isDark}
              icon={<Icons.LayoutGrid className="w-4 h-4" />}
              title="App Launcher (Ctrl+K)"
              onClick={() => setLauncherOpen(true)}
            />
            {viewportWide && (
              <ShellIconButton
                isDark={isDark}
                icon={<Icons.Monitor className="w-4 h-4" />}
                title={tr.desktopUi}
                onClick={() => {
                  setDesktopMode(true);
                  navigate('/dashboard');
                }}
              />
            )}
            <ShellIconButton
              isDark={isDark}
              icon={<Icons.Activity className="w-4 h-4" />}
              title="Task Center"
              onClick={() => setTasksOpen(true)}
              badge={running > 0 ? running : undefined}
              badgeTone="blue"
            />
            <ShellIconButton
              isDark={isDark}
              icon={<Icons.Bell className="w-4 h-4" />}
              title="Notifications"
              onClick={() => setNotificationsOpen(true)}
              badge={unread > 0 ? unread : undefined}
              badgeTone="red"
            />
            <div className="flex flex-col text-right pl-1">
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
        )}

        {/* Panel upgrade (superadmin, GitHub main vs local VERSION) */}
        {upgradeOpen && user?.role === 'superadmin' && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-fade-in">
            <div
              className={`flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                }`}
            >
              <div className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <div>
                  <h3 className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{tr.upgradeTitle}</h3>
                  <p className={`mt-1 text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.upgradeIntro}</p>
                  {panelUpdate && (
                    <p className="mt-2 font-mono text-[11px] text-blue-400">
                      {panelUpdate.local_version}
                      {panelUpdate.remote_version ? ` → ${panelUpdate.remote_version}` : ''}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={upgradeRunning}
                  onClick={() => !upgradeRunning && setUpgradeOpen(false)}
                  className="shrink-0 text-slate-500 hover:text-slate-300 disabled:opacity-40"
                >
                  <Icons.X className="h-5 w-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {!panelUpdate?.update_available && !upgradeRunning && !upgradeLog && (
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.upToDate}</p>
                )}
                {panelUpdate?.changelog ? (
                  <div>
                    <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      {tr.changelog}
                    </div>
                    <pre
                      className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-[11px] leading-relaxed ${isDark ? 'border-slate-800 bg-slate-950/50 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                    >
                      {panelUpdate.changelog}
                    </pre>
                  </div>
                ) : null}
                {panelUpdate?.release_url && (
                  <a
                    href={panelUpdate.release_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-500 hover:text-blue-400"
                  >
                    {tr.viewReleases}
                    <Icons.ExternalLink className="h-3 w-3" />
                  </a>
                )}

                <div>
                  <div className={`mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    <span>{tr.progress}</span>
                    <span className="font-mono normal-case">{Math.round(upgradeProgress)}%</span>
                  </div>
                  <div className={`h-2 w-full overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-[width] duration-300 ease-out"
                      style={{ width: `${upgradeProgress}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.liveLog}</div>
                  <pre
                    ref={upgradeLogRef}
                    className={`max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border p-3 font-mono text-[10px] leading-snug ${isDark ? 'border-slate-800 bg-black/40 text-green-400/90' : 'border-slate-200 bg-slate-900 text-green-200'
                      }`}
                  >
                    {upgradeLog || (upgradeRunning ? tr.upgradeRunning : '—')}
                  </pre>
                </div>

                {upgradeSuccess && <p className="text-center text-xs font-bold text-emerald-500">{tr.upgradeDone}</p>}
                {!upgradeSuccess && upgradeLog && !upgradeRunning && /__COPANEL_EXIT__:(?!0)/.test(upgradeLog) && (
                  <p className="text-center text-xs font-bold text-red-400">{tr.upgradeFailed}</p>
                )}
              </div>

              <div className={`flex justify-end gap-2 border-t px-5 py-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button
                  type="button"
                  disabled={upgradeRunning}
                  onClick={() => setUpgradeOpen(false)}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    } disabled:opacity-50`}
                >
                  {tr.close}
                </button>
                <button
                  type="button"
                  disabled={upgradeRunning || upgradeSuccess || !panelUpdate?.update_available}
                  onClick={runPanelUpgrade}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-blue-500 disabled:opacity-50"
                >
                  {tr.startUpgrade}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Change Password Modal */}
        {changePwdOpen && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in select-none">
            <div className={`p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl relative border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
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
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all border ${isDark
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
                  className={`w-full rounded-xl px-3.5 py-2 text-xs focus:outline-none transition-all border ${isDark
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
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
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
        <main
          className={cn(
            'relative flex-1 overflow-auto transition-colors duration-200',
            isDark ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900',
            !useDesktopShell && 'pb-20 lg:pb-0',
            !useDesktopShell && showMobileDesktopSiteToggle && !isMobileDesktopSiteEnabled() && 'pb-28 lg:pb-0',
            useDesktopShell && 'overflow-hidden',
          )}
          style={useDesktopShell ? { paddingBottom: DOCK_HEIGHT } : undefined}
        >
          {useDesktopShell && (isDashboardHome || isWindowRoute) ? (
            <DesktopShell
              isDark={isDark}
              language={language}
              siteTitle={siteTitle}
              siteSubtitle={branding?.site_subtitle}
              logoDataUrl={logoDataUrl}
              wallpaperDataUrl={wallpaperDataUrl}
            />
          ) : (
            <Outlet context={shellContext} />
          )}
          {useDesktopShell && <WindowLayer shellContext={shellContext} isDark={isDark} />}
        </main>

        {/* Mobile: prominent desktop-site CTA above bottom nav */}
        {!useDesktopShell && showMobileDesktopSiteToggle && !isMobileDesktopSiteEnabled() && (
          <div
            className={cn(
              'fixed bottom-16 left-0 right-0 z-[51] lg:hidden border-t px-3 py-2',
              isDark ? 'border-slate-800 bg-slate-900/95' : 'border-slate-200 bg-white/95',
            )}
          >
            <button
              type="button"
              onClick={toggleMobileDesktopSite}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-sky-500"
            >
              <Icons.MonitorSmartphone className="h-4 w-4 shrink-0" />
              {tr.mobileDesktopSiteBanner}
            </button>
          </div>
        )}

        {/* Mobile Bottom Footer Menu — classic mode only */}
        {!useDesktopShell && (
        <div className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden flex justify-around items-center h-16 border-t backdrop-blur-md px-2 ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200 shadow-lg'
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
        )}
      </div>

      {useDesktopShell && (
        <Dock
          isDark={isDark}
          language={language}
          isSuperAdmin={isSuperAdmin}
          onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
          onToggleLanguage={() => setLanguage(language === 'en' ? 'vi' : 'en')}
          onOpenStartMenu={() => {
            setUserMenuOpen(false);
            setStartMenuOpen((v) => !v);
          }}
          startMenuOpen={startMenuOpen}
          onOpenTasks={() => setTasksOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onOpenUserMenu={() => {
            setStartMenuOpen(false);
            setUserMenuOpen((v) => !v);
          }}
          userMenuOpen={userMenuOpen}
          runningTasks={running}
          unreadNotifications={unread}
          username={user?.username}
          siteTitle={siteTitle}
          logoDataUrl={logoDataUrl}
        />
      )}

      {useDesktopShell && (
        <StartMenu
          open={startMenuOpen}
          onClose={() => setStartMenuOpen(false)}
          modules={desktopModules}
          getModuleName={getModuleName}
          isDark={isDark}
          language={language}
          siteTitle={siteTitle}
          logoDataUrl={logoDataUrl}
        />
      )}

      {useDesktopShell && (
        <UserMenu
          open={userMenuOpen}
          onClose={() => setUserMenuOpen(false)}
          user={user}
          isDark={isDark}
          language={language}
          serverHostname={serverHostname}
          lanIp={lanIp}
          onChangePassword={() => {
            setPwdMsg('');
            setChangePwdOpen(true);
          }}
          onLogout={onLogout}
          onSwitchClassic={() => {
            setDesktopMode(false);
            navigate('/dashboard');
          }}
          mobileDesktopSite={isMobileDesktopSiteEnabled()}
          showMobileDesktopSiteToggle={showMobileDesktopSiteToggle}
          onToggleMobileDesktopSite={toggleMobileDesktopSite}
        />
      )}

      <AppLauncher
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        theme={theme}
        desktopMode={useDesktopShell}
      />
      <TaskCenter open={tasksOpen} onClose={() => setTasksOpen(false)} />
      <NotificationCenter open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <ToastLayer />
    </div>
  );
}

interface ShellIconButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  title?: string;
  isDark: boolean;
  badge?: number;
  badgeTone?: 'blue' | 'red' | 'amber';
}

function ShellIconButton({ icon, onClick, title, isDark, badge, badgeTone = 'blue' }: ShellIconButtonProps) {
  const tone = badgeTone === 'red' ? 'bg-red-500' : badgeTone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <button
      title={title}
      onClick={onClick}
      className={`relative p-2 rounded-xl border transition duration-150 ${
        isDark
          ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
      }`}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span
          className={`absolute -top-1 -right-1 ${tone} text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}