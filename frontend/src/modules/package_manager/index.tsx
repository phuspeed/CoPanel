/**
 * Package Manager — Desktop sidebar shell + Classic full-page (dual UI).
 */
import { useEffect, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';
import { useLocation } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface Package {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'not_installed' | 'running' | 'stopped';
  category: string;
}

export default function PackageManagerDashboard() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ msg: string; isError: boolean } | null>(null);
  const [mysqlCreds, setMysqlCreds] = useState<{ user: string; password: string; url?: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const selectedPackageId = searchParams.get('id');

  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const t = {
    en: {
      category: 'System',
      title: 'Ubuntu Service & Packages',
      subtitle: 'Manage Ubuntu system services and CoPanel modules — install, restart, stop, or remove.',
      engine: 'System Engine',
      activeServices: 'Services Active',
      loadingPkg: 'Loading system packages...',
      categories: ['All', 'Web Server', 'Database', 'Database Tools', 'Runtimes', 'DevOps', 'Security & System', 'Utilities'],
      focusedPackage: 'Showing focused package details',
      showAll: 'Show All Packages',
      active: 'Active',
      stopped: 'Stopped',
      notInstalled: 'Not Installed',
      install: 'Install',
      stop: 'Stop',
      restart: 'Restart',
      start: 'Start',
      remove: 'Remove',
      noPackages: 'No packages found in this category.',
      openPhpMyAdmin: 'Open phpMyAdmin',
      phpmyadminPath: 'Access path',
      confirmRemove: 'Remove this package? This may uninstall system software.',
      cancel: 'Cancel',
      confirmRemoveTitle: 'Confirm remove',
    },
    vi: {
      category: 'Hệ thống',
      title: 'Dịch vụ & Gói Ubuntu',
      subtitle: 'Quản lý dịch vụ Ubuntu và module CoPanel — cài, khởi động lại, dừng hoặc gỡ.',
      engine: 'Động cơ hệ thống',
      activeServices: 'Dịch vụ hoạt động',
      loadingPkg: 'Đang tải danh sách dịch vụ...',
      categories: ['Tất cả', 'Web Server', 'Database', 'Database Tools', 'Runtimes', 'DevOps', 'Security & System', 'Utilities'],
      focusedPackage: 'Đang xem chi tiết gói',
      showAll: 'Hiện tất cả gói',
      active: 'Đang chạy',
      stopped: 'Bị dừng',
      notInstalled: 'Chưa cài đặt',
      install: 'Cài đặt',
      stop: 'Dừng',
      restart: 'Khởi động lại',
      start: 'Bắt đầu',
      remove: 'Gỡ bỏ',
      noPackages: 'Không tìm thấy gói trong danh mục này.',
      openPhpMyAdmin: 'Mở phpMyAdmin',
      phpmyadminPath: 'Đường dẫn truy cập',
      confirmRemove: 'Gỡ gói này? Có thể gỡ phần mềm hệ thống.',
      cancel: 'Hủy',
      confirmRemoveTitle: 'Xác nhận gỡ',
    },
  };

  const tr = t[language || 'en'];
  const categories = tr.categories;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

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
    const interval = setInterval(fetchPackages, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAction = async (id: string, action: 'install' | 'restart' | 'stop' | 'remove' | 'start') => {
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
        const d = await res.json();
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
    };
    const IconComponent = iconMap[iconName] || Icons.Box;
    return <IconComponent className="w-5 h-5 md:w-6 md:h-6" />;
  };

  const mapCatToEn = (cat: string) => {
    const idx = categories.indexOf(cat);
    if (idx !== -1) return t.en.categories[idx];
    return 'All';
  };

  const filteredPackages = selectedPackageId
    ? packages.filter((p) => p.id === selectedPackageId)
    : selectedCategory === categories[0] || selectedCategory === 'All'
      ? packages
      : packages.filter((p) => p.category === mapCatToEn(selectedCategory));

  const actionBtnBase =
    'min-h-[44px] px-3 py-2.5 text-xs font-bold rounded-xl transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  const runningCount = packages.filter((p) => p.status === 'running').length;

  return (
    <ModuleViewport constrained>
      <div className={`flex flex-col h-full min-h-0 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <header
          className={`shrink-0 px-4 py-3 border-b flex items-center justify-between gap-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{tr.category}</p>
            <h1 className="text-lg font-semibold truncate">{tr.title}</h1>
            <p className={`text-xs mt-0.5 line-clamp-2 ${muted}`}>{tr.subtitle}</p>
          </div>
          <div
            className={`shrink-0 rounded-xl border p-3 text-right min-w-[140px] ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-white'}`}
          >
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
              {tr.engine}
            </span>
            <p className={`text-lg font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              {runningCount} / {packages.length}
            </p>
            <span className={`text-[10px] ${muted}`}>{tr.activeServices}</span>
          </div>
        </header>

        {actionMsg && (
          <div
            className={`shrink-0 mx-4 mt-2 rounded-xl border px-4 py-2 text-xs ${
              actionMsg.isError
                ? isDark
                  ? 'bg-red-950/30 border-red-900/40 text-red-300'
                  : 'bg-red-50 border-red-200 text-red-700'
                : isDark
                  ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            {actionMsg.msg}
          </div>
        )}

        {selectedPackageId && (
          <div className="shrink-0 mx-4 mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              className={`flex items-center gap-2 text-xs px-3 py-2.5 border rounded-xl min-h-[44px] ${
                isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-800 bg-blue-50 border-blue-200'
              }`}
            >
              <Icons.Eye className="w-4 h-4 shrink-0" />
              {tr.focusedPackage}
            </div>
            <button
              type="button"
              onClick={() => window.history.replaceState(null, '', window.location.pathname)}
              className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold border transition-colors ${btnSecondary}`}
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
              className={`h-full w-44 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}
            >
              <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {categories.map((cat) => {
                  const isActive = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`w-full text-left px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
                        isActive
                          ? isDark
                            ? 'bg-blue-600/25 text-blue-300'
                            : 'bg-blue-50 text-blue-700'
                          : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                      }`}
                    >
                      <span className="line-clamp-2">{cat}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          }
        >
          <main className="flex-1 min-h-0 overflow-y-auto p-4">
            {loading && packages.length === 0 ? (
              <div className={`flex flex-col items-center justify-center p-12 border rounded-xl ${panel}`}>
                <Icons.Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className={`text-xs mt-4 ${muted}`}>{tr.loadingPkg}</span>
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className={`rounded-2xl border p-8 text-center ${panel}`}>
                <Icons.Package className={`w-10 h-10 mx-auto mb-3 ${muted}`} />
                <p className={`text-sm ${muted}`}>{tr.noPackages}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`group relative flex flex-col justify-between p-4 sm:p-6 rounded-2xl border backdrop-blur-sm transition-all duration-300 hover:shadow-lg ${
                      pkg.id === selectedPackageId
                        ? isDark
                          ? 'border-blue-500 bg-blue-950/20 ring-1 ring-blue-500/40'
                          : 'border-blue-500 bg-blue-50/90 ring-2 ring-blue-200'
                        : isDark
                          ? 'border-slate-800 bg-slate-900/40 hover:border-blue-500/30'
                          : 'bg-white border-slate-200 hover:border-blue-400/60 shadow-sm'
                    }`}
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-3 border rounded-xl ${isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600'}`}
                          >
                            {getIcon(pkg.icon)}
                          </div>
                          <div>
                            <h4 className={`text-sm md:text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                              {pkg.name}
                            </h4>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded border ${isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700/60' : 'text-slate-500 bg-slate-100 border-slate-200'}`}
                            >
                              {pkg.category}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium ${
                            pkg.status === 'running'
                              ? 'bg-green-500/10 text-green-500 border-green-500/20'
                              : pkg.status === 'stopped'
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                : isDark
                                  ? 'bg-slate-800/80 text-slate-400 border-slate-700'
                                  : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              pkg.status === 'running'
                                ? 'bg-green-500 animate-pulse'
                                : pkg.status === 'stopped'
                                  ? 'bg-amber-400'
                                  : 'bg-slate-500'
                            }`}
                          />
                          {pkg.status === 'running' ? tr.active : pkg.status === 'stopped' ? tr.stopped : tr.notInstalled}
                        </span>
                      </div>

                      <p className={`text-xs min-h-[38px] line-clamp-2 leading-relaxed ${muted}`}>{pkg.description}</p>

                      {pkg.id === 'phpmyadmin' && pkg.status !== 'not_installed' && (
                        <div
                          className={`text-[11px] border rounded-xl px-2.5 py-2 ${isDark ? 'border-slate-700 bg-slate-800/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                        >
                          <div className="font-semibold">
                            {tr.phpmyadminPath}: `{mysqlCreds?.url || '/phpmyadmin/index.php'}`
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                `${window.location.protocol}//${window.location.hostname}${mysqlCreds?.url || '/phpmyadmin/index.php'}`,
                                '_blank'
                              )
                            }
                            className="mt-2 w-full sm:w-auto min-h-[44px] text-xs px-3 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white font-semibold border border-blue-800"
                          >
                            {tr.openPhpMyAdmin}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className={`mt-5 pt-4 border-t flex flex-col gap-2 sm:flex-row sm:flex-wrap ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                      {pkg.status === 'not_installed' ? (
                        <button
                          type="button"
                          onClick={() => handleAction(pkg.id, 'install')}
                          disabled={actionLoading !== null}
                          className={`${actionBtnBase} w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-blue-700 hover:bg-blue-600 border-blue-800`}
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
                                className={`${actionBtnBase} w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-slate-700 hover:bg-slate-600 border-slate-500`}
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
                                className={`${actionBtnBase} w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-indigo-700 hover:bg-indigo-600 border-indigo-800`}
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
                              className={`${actionBtnBase} w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-emerald-700 hover:bg-emerald-600 border-emerald-800`}
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
                            className={`${actionBtnBase} w-full sm:flex-1 flex items-center justify-center gap-1.5 text-white bg-red-600 hover:bg-red-700 border-red-700`}
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
          </main>
        </ModuleSidebarLayout>
      </div>

      <WindowModal
        open={removeConfirm !== null}
        onClose={() => setRemoveConfirm(null)}
        title={tr.confirmRemoveTitle}
        maxWidth="sm"
      >
        <p className={`text-sm mb-4 ${muted}`}>
          {tr.confirmRemove}
          {removeConfirm && (
            <>
              <br />
              <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{removeConfirm.name}</strong>
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setRemoveConfirm(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
            {tr.cancel}
          </button>
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={() => removeConfirm && handleAction(removeConfirm.id, 'remove')}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {tr.remove}
          </button>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
