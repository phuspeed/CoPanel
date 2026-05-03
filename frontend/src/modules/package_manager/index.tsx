/**
 * Premium Package Manager Component
 * Stunning, dynamic, and glassmorphic UI with direct highlighting.
 */
import { useEffect, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
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

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const selectedPackageId = searchParams.get('id');

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const t = {
    en: {
      title: 'Ubuntu Service & Packages',
      desc: 'Directly manage Ubuntu system services and dynamic CoPanel modules. Interact with your stack using Install, Restart, Stop, and Remove.',
      engine: 'System Engine',
      activeServices: 'Services Active',
      loadingPkg: 'Loading system packages...',
      categories: ['All', 'Web Server', 'Database', 'Database Tools', 'Security & System', 'Utilities'],
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
      noPackages: 'No packages found in this category.'
    },
    vi: {
      title: 'Dịch vụ & Gói Ubuntu',
      desc: 'Quản lý trực tiếp các dịch vụ hệ thống Ubuntu và các module CoPanel. Thao tác với cài đặt, khởi động lại, dừng hoặc gỡ bỏ.',
      engine: 'Động cơ hệ thống',
      activeServices: 'Dịch vụ hoạt động',
      loadingPkg: 'Đang tải danh sách dịch vụ...',
      categories: ['Tất cả', 'Web Server', 'Database', 'Database Tools', 'Security & System', 'Utilities'],
      focusedPackage: 'Đang xem thông tin chi tiết gói',
      showAll: 'Hiện tất cả gói',
      active: 'Đang chạy',
      stopped: 'Bị dừng',
      notInstalled: 'Chưa cài đặt',
      install: 'Cài đặt',
      stop: 'Dừng',
      restart: 'Khởi động lại',
      start: 'Bắt đầu',
      remove: 'Gỡ bỏ',
      noPackages: 'Không tìm thấy gói nào trong danh mục này.'
    }
  };

  const tr = t[language || 'en'];

  const categories = tr.categories;

  const fetchPackages = () => {
    setLoading(true);
    fetch('/api/package_manager')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.packages) {
          setPackages(data.packages);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load packages:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPackages();
    const interval = setInterval(fetchPackages, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (id: string, action: 'install' | 'restart' | 'stop' | 'remove') => {
    setActionLoading(`${id}-${action}`);
    try {
      const token = localStorage.getItem('copanel_token');
      const res = await fetch(`/api/package_manager/${id}/${action}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        fetchPackages();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
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

  // Convert categories dynamically for filtering
  const mapCatToEn = (cat: string) => {
    const idx = categories.indexOf(cat);
    if (idx !== -1) return t.en.categories[idx];
    return 'All';
  };

  const filteredPackages = selectedPackageId
    ? packages.filter((p) => p.id === selectedPackageId)
    : (selectedCategory === categories[0] || selectedCategory === 'All'
      ? packages
      : packages.filter((p) => p.category === mapCatToEn(selectedCategory)));

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className={`flex flex-col items-center md:items-end gap-1 text-right p-4 rounded-xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] ${
          isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{tr.engine}</span>
          <span className={`text-lg md:text-2xl font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            {packages.filter((p) => p.status === 'running').length} / {packages.length}
          </span>
          <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.activeServices}</span>
        </div>
      </div>

      {!selectedPackageId && (
        <div className={`flex flex-wrap items-center gap-2 border-b pb-1 select-none ${isDark ? 'border-slate-800/80' : 'border-slate-100'}`}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 md:px-4 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all rounded-t-lg border-b-2 duration-200 ${
                selectedCategory === cat
                  ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {selectedPackageId && (
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 text-xs px-3 py-2 border rounded-xl ${
            isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-600 bg-blue-50 border-blue-100'
          }`}>
            <Icons.Eye className="w-4 h-4" />
            {tr.focusedPackage}
          </div>
          <button
            onClick={() => window.history.replaceState(null, '', window.location.pathname)}
            className={`text-xs transition ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-800'}`}
          >
            {tr.showAll}
          </button>
        </div>
      )}

      {loading && packages.length === 0 ? (
        <div className={`flex flex-col items-center justify-center p-12 border rounded-xl ${isDark ? 'border-slate-800 bg-slate-900/20' : 'border-slate-200 bg-white'}`}>
          <Icons.Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-xs text-slate-400 mt-4">{tr.loadingPkg}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPackages.map((pkg) => (
            <div
              key={pkg.id}
              className={`group relative flex flex-col justify-between p-6 rounded-2xl border backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-0.5 ${
                pkg.id === selectedPackageId
                  ? 'border-blue-500 bg-blue-950/20 ring-1 ring-blue-500/40 shadow-xl'
                  : isDark ? 'border-slate-800 bg-slate-900/40 hover:border-blue-500/30' : 'bg-white border-slate-200 hover:border-blue-500/30 shadow-sm hover:bg-slate-50/20'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 border rounded-xl transition-all duration-300 ${isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600'}`}>
                      {getIcon(pkg.icon)}
                    </div>
                    <div>
                      <h4 className={`text-sm md:text-base font-bold transition-all ${isDark ? 'text-slate-200 group-hover:text-white' : 'text-slate-800 group-hover:text-slate-900'}`}>
                        {pkg.name}
                      </h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700/60' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                        {pkg.category}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[11px] px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium transition duration-200 ${
                    pkg.status === 'running'
                      ? 'bg-green-500/10 text-green-500 border-green-500/20'
                      : pkg.status === 'stopped'
                      ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      : isDark ? 'bg-slate-800/80 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      pkg.status === 'running'
                        ? 'bg-green-500 animate-pulse'
                        : pkg.status === 'stopped'
                        ? 'bg-amber-400'
                        : 'bg-slate-500'
                    }`}></span>
                    {pkg.status === 'running' ? tr.active : pkg.status === 'stopped' ? tr.stopped : tr.notInstalled}
                  </span>
                </div>

                <p className={`text-xs min-h-[38px] line-clamp-2 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {pkg.description}
                </p>
              </div>

              <div className={`mt-6 pt-4 border-t flex flex-wrap items-center gap-2 ${isDark ? 'border-slate-800/80' : 'border-slate-100'}`}>
                {pkg.status === 'not_installed' ? (
                  <button
                    onClick={() => handleAction(pkg.id, 'install')}
                    disabled={actionLoading !== null}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl transition-all shadow-lg hover:shadow-blue-500/20"
                  >
                    {actionLoading === `${pkg.id}-install` ? (
                      <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icons.Download className="w-3.5 h-3.5" />
                    )}
                    {tr.install}
                  </button>
                ) : (
                  <>
                    {pkg.status === 'running' ? (
                      <>
                        <button
                          onClick={() => handleAction(pkg.id, 'stop')}
                          disabled={actionLoading !== null}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition-all border ${
                            isDark ? 'text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border-slate-700' : 'text-slate-600 hover:bg-slate-100 bg-slate-50 border-slate-200'
                          }`}
                        >
                          {actionLoading === `${pkg.id}-stop` ? (
                            <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Icons.Square className="w-3.5 h-3.5" />
                          )}
                          {tr.stop}
                        </button>
                        <button
                          onClick={() => handleAction(pkg.id, 'restart')}
                          disabled={actionLoading !== null}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20"
                        >
                          {actionLoading === `${pkg.id}-restart` ? (
                            <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Icons.RotateCw className="w-3.5 h-3.5" />
                          )}
                          {tr.restart}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction(pkg.id, 'restart')}
                        disabled={actionLoading !== null}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-xl transition-all shadow-lg hover:shadow-green-500/20"
                      >
                        {actionLoading === `${pkg.id}-restart` ? (
                          <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Icons.Play className="w-3.5 h-3.5" />
                        )}
                        {tr.start}
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(pkg.id, 'remove')}
                      disabled={actionLoading !== null}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold border rounded-xl transition-all ${
                        isDark ? 'text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/40 border-red-900/40' : 'text-red-600 hover:bg-red-50 bg-red-50/50 border-red-100'
                      }`}
                    >
                      {actionLoading === `${pkg.id}-remove` ? (
                        <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                      )}
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
  );
}
