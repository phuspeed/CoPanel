/**
 * Package Manager — Desktop sidebar shell + Classic full-page + mobile (dual UI).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import { useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';

interface Package {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'not_installed' | 'running' | 'stopped';
  category: string;
}

type StatusFilter = 'all' | 'running' | 'stopped' | 'not_installed';

export default function PackageManagerDashboard() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ msg: string; isError: boolean } | null>(null);
  const [mysqlCreds, setMysqlCreds] = useState<{ user: string; password: string; url?: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const selectedPackageId = searchParams.get('id');

  const { theme, language } = useAppShellContext();
  const isWindowed = useIsWindowedModule();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const t = {
    en: {
      category: 'System',
      title: 'Packages',
      subtitle: 'Install and control Ubuntu services and tools.',
      engine: 'Active',
      activeServices: 'services',
      loadingPkg: 'Loading packages…',
      categories: ['All', 'Web Server', 'Database', 'Database Tools', 'Runtimes', 'DevOps', 'Security & System', 'Utilities'],
      focusedPackage: 'Focused package',
      showAll: 'Show all',
      active: 'Active',
      stopped: 'Stopped',
      notInstalled: 'Not installed',
      install: 'Install',
      stop: 'Stop',
      restart: 'Restart',
      start: 'Start',
      remove: 'Remove',
      noPackages: 'No packages match this filter.',
      openPhpMyAdmin: 'Open phpMyAdmin',
      phpmyadminPath: 'Path',
      confirmRemove: 'Remove this package? System software may be uninstalled.',
      cancel: 'Cancel',
      confirmRemoveTitle: 'Confirm remove',
      searchPlaceholder: 'Search packages…',
      refresh: 'Refresh',
      filterAll: 'All',
      filterRunning: 'Running',
      filterStopped: 'Stopped',
      filterMissing: 'Missing',
      pm2Hint: 'Requires Node.js/npm. Manage running apps in System Monitor → PM2.',
      nodeMissing: 'Install Node.js first, then install PM2.',
    },
    vi: {
      category: 'Hệ thống',
      title: 'Gói & Dịch vụ',
      subtitle: 'Cài đặt và điều khiển dịch vụ Ubuntu và công cụ.',
      engine: 'Đang chạy',
      activeServices: 'dịch vụ',
      loadingPkg: 'Đang tải gói…',
      categories: ['Tất cả', 'Web Server', 'Database', 'Database Tools', 'Runtimes', 'DevOps', 'Security & System', 'Utilities'],
      focusedPackage: 'Đang xem gói',
      showAll: 'Hiện tất cả',
      active: 'Đang chạy',
      stopped: 'Đã dừng',
      notInstalled: 'Chưa cài',
      install: 'Cài đặt',
      stop: 'Dừng',
      restart: 'Khởi động lại',
      start: 'Bắt đầu',
      remove: 'Gỡ',
      noPackages: 'Không có gói khớp bộ lọc.',
      openPhpMyAdmin: 'Mở phpMyAdmin',
      phpmyadminPath: 'Đường dẫn',
      confirmRemove: 'Gỡ gói này? Có thể gỡ phần mềm hệ thống.',
      cancel: 'Hủy',
      confirmRemoveTitle: 'Xác nhận gỡ',
      searchPlaceholder: 'Tìm gói…',
      refresh: 'Làm mới',
      filterAll: 'Tất cả',
      filterRunning: 'Chạy',
      filterStopped: 'Dừng',
      filterMissing: 'Chưa cài',
      pm2Hint: 'Cần Node.js/npm. Quản lý app tại System Monitor → PM2.',
      nodeMissing: 'Cài Node.js trước, rồi mới cài PM2.',
    },
  };

  const tr = t[language || 'en'];
  const categories = tr.categories;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';
  const inputCls = isDark
    ? 'bg-slate-950/50 border-slate-700 text-slate-100 placeholder:text-slate-500'
    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400';

  const fetchPackages = () => {
    setLoading(true);
    fetch('/api/package_manager/list', { headers: authHeaders })
      .then((r) => {
        if (!r.ok) return fetch('/api/package_manager/', { headers: authHeaders });
        return r;
      })
      .then((r) => {
        if (!r.ok) return fetch('/api/package_manager', { headers: authHeaders });
        return r;
      })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.packages) setPackages(data.packages);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load packages:', err);
        setLoading(false);
      });
  };

  const fetchMysqlCreds = async () => {
    try {
      const res = await fetch('/api/package_manager/credentials/mysql', { headers: authHeaders });
      if (res.ok) {
        const d = await res.json();
        if (d) setMysqlCreds({ user: d.user || '', password: d.password || '', url: d.url || '/phpmyadmin/index.php' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchPackages();
    fetchMysqlCreds();
    const interval = setInterval(fetchPackages, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!actionMsg) return;
    const tmr = setTimeout(() => setActionMsg(null), 5000);
    return () => clearTimeout(tmr);
  }, [actionMsg]);

  const handleAction = async (id: string, action: 'install' | 'restart' | 'stop' | 'remove' | 'start') => {
    if (id === 'pm2' && action === 'install') {
      const nodeOk = packages.some((p) => p.id === 'nodejs' && p.status !== 'not_installed');
      if (!nodeOk) {
        setActionMsg({ msg: tr.nodeMissing, isError: true });
        return;
      }
    }
    setActionLoading(`${id}-${action}`);
    setActionMsg(null);
    const apiAction = action === 'start' ? 'restart' : action;
    try {
      const res = await fetch(`/api/package_manager/${id}/${apiAction}`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        setActionMsg({ msg: `${id}: ${action} success`, isError: false });
        fetchPackages();
        if (id === 'phpmyadmin') fetchMysqlCreds();
      } else {
        const d = await res.json().catch(() => ({}));
        setActionMsg({ msg: d.detail || `${id}: ${action} failed`, isError: true });
      }
    } catch (err) {
      console.error(err);
      setActionMsg({ msg: `${id}: ${action} failed`, isError: true });
    } finally {
      setActionLoading(null);
      if (action === 'remove') setRemoveConfirm(null);
    }
  };

  const getIcon = (iconName: string) => {
    const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
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
      Layout: Icons.Layout,
      Cloud: Icons.Cloud,
      Code: Icons.Code,
      Coffee: Icons.Coffee,
      GitBranch: Icons.GitBranch,
      Activity: Icons.Activity,
      Archive: Icons.Archive,
      Wifi: Icons.Wifi,
      Key: Icons.Key,
      Share2: Icons.Share2,
      Wind: Icons.Wind,
      Layers: Icons.Layers,
      Terminal: Icons.Terminal,
    };
    const IconComponent = iconMap[iconName] || Icons.Box;
    return <IconComponent className="w-5 h-5" />;
  };

  const mapCatToEn = (cat: string) => {
    const idx = categories.indexOf(cat);
    if (idx !== -1) return t.en.categories[idx];
    return 'All';
  };

  const filteredPackages = useMemo(() => {
    let list = packages;
    if (selectedPackageId) {
      list = list.filter((p) => p.id === selectedPackageId);
    } else if (selectedCategory !== categories[0] && selectedCategory !== 'All') {
      list = list.filter((p) => p.category === mapCatToEn(selectedCategory));
    }
    if (statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages, selectedPackageId, selectedCategory, statusFilter, search, categories]);

  const actionBtnBase =
    'min-h-[40px] sm:min-h-[44px] px-3 py-2 text-xs font-bold rounded-xl transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  const runningCount = packages.filter((p) => p.status === 'running').length;
  const nodeInstalled = packages.some((p) => p.id === 'nodejs' && p.status !== 'not_installed');

  const statusChips: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: tr.filterAll },
    { id: 'running', label: tr.filterRunning },
    { id: 'stopped', label: tr.filterStopped },
    { id: 'not_installed', label: tr.filterMissing },
  ];

  return (
    <ModuleViewport constrained>
      <div className={cn('flex flex-col h-full min-h-0', isDark ? 'text-slate-100' : 'text-slate-900')}>
        <header
          className={cn(
            'shrink-0 border-b flex items-start sm:items-center justify-between gap-3',
            isWindowed ? 'px-3 py-2.5' : 'px-4 py-3',
            isDark ? 'border-slate-700' : 'border-slate-200',
          )}
        >
          <div className="min-w-0 flex-1">
            {!isWindowed && (
              <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{tr.category}</p>
            )}
            <h1 className={cn('font-semibold truncate', isWindowed ? 'text-base' : 'text-lg')}>{tr.title}</h1>
            <p className={cn('text-xs mt-0.5 line-clamp-1 sm:line-clamp-2', muted)}>{tr.subtitle}</p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchPackages()}
              className={cn('min-h-[40px] min-w-[40px] p-2 rounded-lg border', btnSecondary)}
              title={tr.refresh}
              aria-label={tr.refresh}
            >
              <Icons.RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <div
              className={cn(
                'rounded-xl border text-right hidden sm:block',
                isWindowed ? 'px-2.5 py-1.5 min-w-[88px]' : 'p-2.5 min-w-[120px]',
                isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-white',
              )}
            >
              <span className={cn('text-[10px] font-bold uppercase tracking-widest', isDark ? 'text-blue-400' : 'text-blue-600')}>
                {tr.engine}
              </span>
              <p className={cn('font-mono font-bold leading-tight', isWindowed ? 'text-sm' : 'text-lg', isDark ? 'text-slate-100' : 'text-slate-800')}>
                {runningCount}/{packages.length || 0}
              </p>
              {!isWindowed && <span className={cn('text-[10px]', muted)}>{tr.activeServices}</span>}
            </div>
          </div>
        </header>

        {actionMsg && (
          <div
            className={cn(
              'shrink-0 mx-3 sm:mx-4 mt-2 rounded-xl border px-3 py-2 text-xs',
              actionMsg.isError
                ? isDark
                  ? 'bg-red-950/30 border-red-900/40 text-red-300'
                  : 'bg-red-50 border-red-200 text-red-700'
                : isDark
                  ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700',
            )}
          >
            {actionMsg.msg}
          </div>
        )}

        {selectedPackageId && (
          <div className="shrink-0 mx-3 sm:mx-4 mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              className={cn(
                'flex items-center gap-2 text-xs px-3 py-2 border rounded-xl min-h-[40px]',
                isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-800 bg-blue-50 border-blue-200',
              )}
            >
              <Icons.Eye className="w-4 h-4 shrink-0" />
              {tr.focusedPackage}
            </div>
            <button
              type="button"
              onClick={() => window.history.replaceState(null, '', window.location.pathname)}
              className={cn('min-h-[40px] px-3 rounded-lg text-xs font-semibold border transition-colors', btnSecondary)}
            >
              {tr.showAll}
            </button>
          </div>
        )}

        <ModuleSidebarLayout
          isDark={isDark}
          mobileTitle={tr.title}
          sidebar={
            <aside
              className={cn(
                'h-full w-44 sm:w-48 shrink-0 border-r flex flex-col',
                isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50',
              )}
            >
              <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {categories.map((cat) => {
                  const isActive = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat);
                        setStatusFilter('all');
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2.5 min-h-[40px] text-[11px] font-bold uppercase tracking-wider rounded-lg transition',
                        isActive
                          ? isDark
                            ? 'bg-blue-600/25 text-blue-300'
                            : 'bg-blue-50 text-blue-700'
                          : cn(muted, isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'),
                      )}
                    >
                      <span className="line-clamp-2">{cat}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          }
        >
          <main className="flex-1 min-h-0 overflow-y-auto">
            <div className={cn('sticky top-0 z-10 border-b backdrop-blur-sm', isDark ? 'bg-slate-950/85 border-slate-800' : 'bg-white/90 border-slate-200')}>
              <div className="p-3 sm:p-4 flex flex-col gap-2.5">
                <div className="relative">
                  <Icons.Search className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none', muted)} />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={tr.searchPlaceholder}
                    className={cn('w-full min-h-[40px] pl-9 pr-3 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-blue-500/40', inputCls)}
                  />
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 scrollbar-none">
                  {statusChips.map((chip) => {
                    const active = statusFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setStatusFilter(chip.id)}
                        className={cn(
                          'shrink-0 min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors',
                          active
                            ? isDark
                              ? 'bg-blue-600/30 text-blue-200 border-blue-500/40'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                            : btnSecondary,
                        )}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-4">
              {loading && packages.length === 0 ? (
                <div className={cn('flex flex-col items-center justify-center p-10 border rounded-xl', panel)}>
                  <Icons.Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <span className={cn('text-xs mt-4', muted)}>{tr.loadingPkg}</span>
                </div>
              ) : filteredPackages.length === 0 ? (
                <div className={cn('rounded-2xl border p-8 text-center', panel)}>
                  <Icons.Package className={cn('w-10 h-10 mx-auto mb-3', muted)} />
                  <p className={cn('text-sm', muted)}>{tr.noPackages}</p>
                </div>
              ) : (
                <div
                  className={cn(
                    'grid gap-3 sm:gap-4',
                    isWindowed ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
                  )}
                >
                  {filteredPackages.map((pkg) => (
                    <div
                      key={pkg.id}
                      className={cn(
                        'group relative flex flex-col justify-between p-3.5 sm:p-5 rounded-2xl border transition-all duration-200',
                        pkg.id === selectedPackageId
                          ? isDark
                            ? 'border-blue-500 bg-blue-950/20 ring-1 ring-blue-500/40'
                            : 'border-blue-500 bg-blue-50/90 ring-2 ring-blue-200'
                          : isDark
                            ? 'border-slate-800 bg-slate-900/40 hover:border-blue-500/30'
                            : 'bg-white border-slate-200 hover:border-blue-400/60 shadow-sm',
                      )}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={cn(
                                'p-2.5 border rounded-xl shrink-0',
                                isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600',
                              )}
                            >
                              {getIcon(pkg.icon)}
                            </div>
                            <div className="min-w-0">
                              <h4 className={cn('text-sm font-bold truncate', isDark ? 'text-slate-200' : 'text-slate-800')}>
                                {pkg.name}
                              </h4>
                              <span
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded border inline-block mt-0.5',
                                  isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700/60' : 'text-slate-500 bg-slate-100 border-slate-200',
                                )}
                              >
                                {pkg.category}
                              </span>
                            </div>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 text-[10px] sm:text-[11px] px-2 py-1 rounded-full border flex items-center gap-1.5 font-medium',
                              pkg.status === 'running'
                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                : pkg.status === 'stopped'
                                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                  : isDark
                                    ? 'bg-slate-800/80 text-slate-400 border-slate-700'
                                    : 'bg-slate-100 text-slate-500 border-slate-200',
                            )}
                          >
                            <span
                              className={cn(
                                'w-1.5 h-1.5 rounded-full',
                                pkg.status === 'running'
                                  ? 'bg-green-500 animate-pulse'
                                  : pkg.status === 'stopped'
                                    ? 'bg-amber-400'
                                    : 'bg-slate-500',
                              )}
                            />
                            <span className="hidden sm:inline">
                              {pkg.status === 'running' ? tr.active : pkg.status === 'stopped' ? tr.stopped : tr.notInstalled}
                            </span>
                          </span>
                        </div>

                        <p className={cn('text-xs leading-relaxed line-clamp-2', muted)}>{pkg.description}</p>

                        {pkg.id === 'pm2' && (
                          <p
                            className={cn(
                              'text-[11px] rounded-lg border px-2.5 py-2',
                              !nodeInstalled && pkg.status === 'not_installed'
                                ? isDark
                                  ? 'border-amber-800/50 bg-amber-950/30 text-amber-300'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                                : isDark
                                  ? 'border-slate-700 bg-slate-800/40 text-slate-300'
                                  : 'border-slate-200 bg-slate-50 text-slate-600',
                            )}
                          >
                            {!nodeInstalled && pkg.status === 'not_installed' ? tr.nodeMissing : tr.pm2Hint}
                          </p>
                        )}

                        {pkg.id === 'phpmyadmin' && pkg.status !== 'not_installed' && (
                          <div
                            className={cn(
                              'text-[11px] border rounded-xl px-2.5 py-2',
                              isDark ? 'border-slate-700 bg-slate-800/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-700',
                            )}
                          >
                            <div className="font-semibold truncate">
                              {tr.phpmyadminPath}: `{mysqlCreds?.url || '/phpmyadmin/index.php'}`
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                window.open(
                                  `${window.location.protocol}//${window.location.hostname}${mysqlCreds?.url || '/phpmyadmin/index.php'}`,
                                  '_blank',
                                )
                              }
                              className="mt-2 w-full min-h-[40px] text-xs px-3 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white font-semibold border border-blue-800"
                            >
                              {tr.openPhpMyAdmin}
                            </button>
                          </div>
                        )}
                      </div>

                      <div
                        className={cn(
                          'mt-4 pt-3 border-t grid grid-cols-1 sm:flex sm:flex-wrap gap-2',
                          isDark ? 'border-slate-800/80' : 'border-slate-200',
                        )}
                      >
                        {pkg.status === 'not_installed' ? (
                          <button
                            type="button"
                            onClick={() => handleAction(pkg.id, 'install')}
                            disabled={actionLoading !== null || (pkg.id === 'pm2' && !nodeInstalled)}
                            className={cn(
                              actionBtnBase,
                              'w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-blue-700 hover:bg-blue-600 border-blue-800',
                            )}
                          >
                            {actionLoading === `${pkg.id}-install` ? (
                              <Icons.Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            ) : (
                              <Icons.Download className="w-4 h-4 shrink-0" />
                            )}
                            {tr.install}
                          </button>
                        ) : (
                          <>
                            {pkg.status === 'running' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAction(pkg.id, 'stop')}
                                  disabled={actionLoading !== null}
                                  className={cn(
                                    actionBtnBase,
                                    'w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-slate-700 hover:bg-slate-600 border-slate-500',
                                  )}
                                >
                                  {actionLoading === `${pkg.id}-stop` ? (
                                    <Icons.Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                  ) : (
                                    <Icons.Square className="w-4 h-4 shrink-0" />
                                  )}
                                  {tr.stop}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAction(pkg.id, 'restart')}
                                  disabled={actionLoading !== null}
                                  className={cn(
                                    actionBtnBase,
                                    'w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-indigo-700 hover:bg-indigo-600 border-indigo-800',
                                  )}
                                >
                                  {actionLoading === `${pkg.id}-restart` ? (
                                    <Icons.Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                  ) : (
                                    <Icons.RotateCw className="w-4 h-4 shrink-0" />
                                  )}
                                  {tr.restart}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAction(pkg.id, 'start')}
                                disabled={actionLoading !== null}
                                className={cn(
                                  actionBtnBase,
                                  'w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-emerald-700 hover:bg-emerald-600 border-emerald-800',
                                )}
                              >
                                {actionLoading === `${pkg.id}-restart` ? (
                                  <Icons.Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                ) : (
                                  <Icons.Play className="w-4 h-4 shrink-0" />
                                )}
                                {tr.start}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setRemoveConfirm({ id: pkg.id, name: pkg.name })}
                              disabled={actionLoading !== null}
                              className={cn(
                                actionBtnBase,
                                'w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-red-600 hover:bg-red-700 border-red-700',
                              )}
                            >
                              <Icons.Trash2 className="w-4 h-4 shrink-0" />
                              {tr.remove}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </ModuleSidebarLayout>
      </div>

      <WindowModal
        open={removeConfirm !== null}
        onClose={() => setRemoveConfirm(null)}
        title={tr.confirmRemoveTitle}
        maxWidth="sm"
      >
        <p className={cn('text-sm mb-4', muted)}>
          {tr.confirmRemove}
          {removeConfirm && (
            <>
              <br />
              <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{removeConfirm.name}</strong>
            </>
          )}
        </p>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button
            type="button"
            onClick={() => setRemoveConfirm(null)}
            className={cn('min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold border', btnSecondary)}
          >
            {tr.cancel}
          </button>
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={() => removeConfirm && handleAction(removeConfirm.id, 'remove')}
            className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {tr.remove}
          </button>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
