/**
 * AppStore Manager Dashboard
 * Displays available packages from GitHub, handles remote zip downloads and installation.
 */
import { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface Package {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  download_url: string;
  installed?: boolean;
  has_update?: boolean;
  local_version?: string;
  is_core?: boolean;
  system_packages?: string[];
}

const requiredPackageMap: { [key: string]: { id: string; name: string } } = {
  'module_redis': { id: 'redis', name: 'Redis' },
  'module_cron': { id: 'memcached', name: 'Memcached' },
  'web_manager': { id: 'nginx', name: 'Nginx' },
  'database_manager': { id: 'mysql', name: 'MySQL / MariaDB' },
};

export default function AppStoreDashboard() {
  const [catalog, setCatalog] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [activePkgId, setActivePkgId] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);


  const [communityUrls, setCommunityUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const token = localStorage.getItem('copanel_token');

  const t = {
    en: {
      title: 'GitHub AppStore Catalog',
      desc: "Expand CoPanel by installing public modules from GitHub. Once downloaded, your panel's interface will automatically adapt at runtime.",
      source: 'AppStore Source',
      live: 'Live & Syncing',
      fetchError: 'Failed to fetch AppStore catalog from GitHub.',
      commError: 'Error communicating with the backend.',
      fetching: 'Fetching package catalog...',
      installing: (name: string) => `Installing ${name}...`,
      installSuccess: (name: string) => `✓ ${name} installed successfully! System is compiling frontend in background.`,
      installError: (err: string) => `Error installing package: ${err}`,
      btnInstall: 'Install Extension',
      btnInstalling: 'Installing...',
      btnUninstall: 'Uninstall',
      btnReinstall: 'Reinstall',
      btnUninstalling: 'Uninstalling...',
      noApps: 'No applications currently found in AppStore.'
    },
    vi: {
      title: 'Cửa hàng ứng dụng AppStore',
      desc: 'Mở rộng tính năng của CoPanel bằng cách cài đặt các module công khai từ GitHub. Giao diện panel sẽ tự động cập nhật khi ứng dụng được tải xuống.',
      source: 'Nguồn AppStore',
      live: 'Sẵn sàng & Đồng bộ',
      fetchError: 'Không thể tải danh sách ứng dụng từ GitHub.',
      commError: 'Có lỗi xảy ra khi kết nối với máy chủ.',
      fetching: 'Đang tải danh sách ứng dụng...',
      installing: (name: string) => `Đang cài đặt ${name}...`,
      installSuccess: (name: string) => `✓ Cài đặt ${name} thành công! Hệ thống đang biên dịch lại frontend trong nền.`,
      installError: (err: string) => `Lỗi khi cài đặt: ${err}`,
      btnInstall: 'Cài đặt Extension',
      btnInstalling: 'Đang cài đặt...',
      btnUninstall: 'Gỡ bỏ',
      btnReinstall: 'Cài lại',
      btnUninstalling: 'Đang gỡ...',
      noApps: 'Không tìm thấy ứng dụng nào trong AppStore.'
    }
  };

  const tr = t[language || 'en'];

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/appstore_manager/config', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const d = await res.json();
        if (d.community_urls) setCommunityUrls(d.community_urls);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveConfig = async (urls: string[]) => {
    try {
      const res = await fetch('/api/appstore_manager/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ community_urls: urls })
      });
      if (res.ok) {
        fetchCatalog();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddUrl = () => {
    if (!newUrl.trim() || !newUrl.startsWith('http')) return;
    if (communityUrls.includes(newUrl.trim())) return;
    const updated = [...communityUrls, newUrl.trim()];
    setCommunityUrls(updated);
    setNewUrl('');
    saveConfig(updated);
  };

  const handleRemoveUrl = (urlToRemove: string) => {
    const updated = communityUrls.filter(u => u !== urlToRemove);
    setCommunityUrls(updated);
    saveConfig(updated);
  };

  const fetchCatalog = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/appstore_manager/catalog', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const d = await res.json();
        if (d.data) setCatalog(d.data);
      } else {
        setMsg(tr.fetchError);
      }
    } catch {
      setMsg(tr.commError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchCatalog();
  }, [language]);

  const handleInstall = async (pkg: Package) => {
    setInstallingId(pkg.id);
    setActivePkgId(pkg.id);
    setBuildLogs(["Starting real-time build status tracking..."]);
    setBuildStatus("running");
    setMsg(tr.installing(pkg.name));
    try {
      const res = await fetch('/api/appstore_manager/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          id: pkg.id, 
          download_url: pkg.download_url, 
          version: pkg.version,
          system_packages: pkg.system_packages 
        })
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(tr.installSuccess(pkg.name));
        
        const interval = setInterval(async () => {
          try {
            const token = localStorage.getItem('copanel_token');
            const r = await fetch(`/api/appstore_manager/build-status/${pkg.id}`, {
              headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (r.ok) {
              const b = await r.json();
              if (b.logs) setBuildLogs(b.logs);
              if (b.status === 'success' || b.status === 'failed') {
                setBuildStatus(b.status);
                clearInterval(interval);
                if (b.status === 'success') {
                  setMsg(`✓ ${pkg.name} installed and built successfully!`);
                  setTimeout(() => {
                    window.location.reload();
                  }, 2000);
                } else {
                  setMsg(`❌ Error building ${pkg.name}: ${b.error || 'Build failed.'}`);
                }
              }
            }
          } catch (err) {
            console.error(err);
          }
        }, 1500);
      } else {
        setMsg(tr.installError(d.detail || 'Extraction failed.'));
        setBuildStatus("failed");
      }
    } catch {
      setMsg(tr.commError);
      setBuildStatus("failed");
    } finally {
      setInstallingId(null);
    }
  };

  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  const handleUninstall = async (pkg: Package) => {
    setUninstallingId(pkg.id);
    setMsg(`Uninstalling ${pkg.name}...`);
    try {
      const token = localStorage.getItem('copanel_token');
      const res = await fetch('/api/appstore_manager/uninstall', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id: pkg.id })
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(`✓ ${pkg.name} removed successfully! System is rebuilding frontend.`);
        fetchCatalog();
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setMsg(`❌ Error uninstalling: ${d.detail || 'Request failed.'}`);
      }
    } catch {
      setMsg(tr.commError);
    } finally {
      setUninstallingId(null);
    }
  };


  if (loading && catalog.length === 0) {
    return (
      <div className={`flex items-center justify-center h-64 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <div className="text-center">
          <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-xs text-slate-400">{tr.fetching}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl">
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
          isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-50/60 border-slate-200 shadow-sm'
        }`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{tr.source}</span>
          <span className={`text-base md:text-lg font-mono font-bold mb-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.live}</span>
          <button
            onClick={() => setIsConfigOpen(true)}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold text-xs transition-all duration-200 ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700 hover:border-slate-600' 
                : 'bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border-slate-200 hover:border-slate-300 shadow-sm'
            }`}
          >
            <Icons.Settings className="w-3.5 h-3.5" />
            {language === 'vi' ? 'Cộng đồng' : 'Community'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3.5 border rounded-xl text-xs flex items-center gap-2 max-w-xl animate-pulse backdrop-blur-md ${
          isDark ? 'bg-indigo-950/20 border-indigo-600/30 text-indigo-300' : 'bg-indigo-50 border-indigo-100 text-indigo-600'
        }`}>
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {activePkgId && buildLogs.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className={`w-full max-w-2xl border rounded-2xl shadow-2xl space-y-4 p-6 flex flex-col justify-between max-h-[85vh] transition-all duration-300 ${
            isDark ? 'bg-slate-900/95 border-slate-700/80 text-slate-100' : 'bg-white border-slate-200 text-slate-900 shadow-slate-500/10'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 select-none">
              <div className="flex items-center gap-2">
                <Icons.Terminal className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                <div>
                  <span className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    Build Logs & Progress
                  </span>
                  <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Real-time status tracking and installation logs
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-mono font-bold uppercase tracking-wide border flex items-center gap-1.5 ${
                  buildStatus === 'success'
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : buildStatus === 'failed'
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse'
                }`}>
                  {buildStatus === 'running' && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />}
                  {buildStatus || 'running'}
                </span>
                {(buildStatus === 'success' || buildStatus === 'failed') && (
                  <button
                    onClick={() => { setActivePkgId(null); setBuildLogs([]); }}
                    className={`p-1.5 rounded-lg border transition-all duration-200 ${
                      isDark ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800 border-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className={`font-mono text-xs p-4 rounded-xl flex-1 h-[45vh] overflow-y-auto space-y-1.5 border transition-all duration-200 ${
              isDark ? 'bg-slate-950/80 border-slate-800/80 text-slate-300' : 'bg-white border-slate-100 text-slate-700'
            }`}>
              {buildLogs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap break-all leading-relaxed flex items-start gap-1.5">
                  <span className={`text-[10px] shrink-0 font-bold opacity-30 select-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {log.startsWith('❌') || log.includes('Error') || log.includes('ERR') ? (
                    <span className="text-red-400 flex-1">{log}</span>
                  ) : log.startsWith('🎉') || log.startsWith('✓') || log.includes('success') ? (
                    <span className="text-emerald-400 font-bold flex-1">{log}</span>
                  ) : (
                    <span className="flex-1">{log}</span>
                  )}
                </div>
              ))}
            </div>

            {(buildStatus === 'success' || buildStatus === 'failed') && (
              <button
                onClick={() => { setActivePkgId(null); setBuildLogs([]); }}
                className={`w-full py-2.5 font-bold text-xs rounded-xl transition-all duration-200 border ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 hover:text-white' : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 shadow-sm'
                }`}
              >
                {language === 'vi' ? 'Đóng' : 'Close'}
              </button>
            )}
          </div>
        </div>
      )}


      {catalog.length === 0 ? (
        <div className={`p-12 text-center text-xs border rounded-2xl ${isDark ? 'border-slate-800 text-slate-400 bg-slate-900/20' : 'border-slate-200 text-slate-500 bg-white shadow-sm'}`}>
          {tr.noApps}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {catalog.map((pkg) => {
            const isInstalling = installingId === pkg.id;
            return (
              <div key={pkg.id} className={`p-6 rounded-2xl border backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 flex flex-col justify-between gap-4 ${
                isDark ? 'bg-slate-900/40 border-slate-800 hover:border-blue-500/30' : 'bg-white border-slate-200 hover:border-blue-500/30 shadow-sm'
              }`}>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 border rounded-xl ${isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600'}`}>
                      <Icons.Download className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className={`text-sm md:text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {pkg.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700/60' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                          {language === 'vi' ? 'Mới nhất: ' : 'Latest: '}v{pkg.version}
                        </span>
                        {pkg.installed && pkg.local_version && (
                          <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${isDark ? 'text-blue-300 bg-blue-900/30 border-blue-800' : 'text-blue-600 bg-blue-50 border-blue-200'}`}>
                            {language === 'vi' ? 'Đang cài: ' : 'Installed: '}v{pkg.local_version}
                          </span>
                        )}
                        {pkg.is_core && (
                          <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${isDark ? 'text-emerald-400 bg-emerald-950/20 border-emerald-800/40' : 'text-emerald-600 bg-emerald-50 border-emerald-200'}`}>
                            {language === 'vi' ? 'Mặc định' : 'Core'}
                          </span>
                        )}
                        {(pkg as any).is_community && (
                          <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${isDark ? 'text-cyan-400 bg-cyan-950/20 border-cyan-800/40' : 'text-cyan-600 bg-cyan-50 border-cyan-200'}`}>
                            {language === 'vi' ? 'Cộng đồng' : 'Community'}
                          </span>
                        )}
                        {pkg.has_update && (
                          <span className="text-[10px] px-2 py-0.5 rounded border font-mono bg-amber-500/10 text-amber-500 border-amber-500/30 animate-pulse font-bold">
                            {language === 'vi' ? 'Có bản cập nhật' : 'Update Available'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className={`text-xs line-clamp-2 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {pkg.description}
                  </p>
                  {((pkg.system_packages && pkg.system_packages.length > 0) || requiredPackageMap[pkg.id]) && (
                    <div className={`text-[10px] flex flex-wrap items-center gap-1.5 leading-relaxed pt-1.5 border-t ${isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-100'}`}>
                      <Icons.Settings className="w-3.5 h-3.5 shrink-0" />
                      <span>{language === 'vi' ? 'Yêu cầu dịch vụ hệ thống:' : 'Required system service:'}</span>
                      <span className={`px-1.5 py-0.5 rounded border font-mono font-bold ${isDark ? 'text-blue-300 bg-blue-900/30 border-blue-800' : 'text-blue-600 bg-blue-50 border-blue-200'}`}>
                        {pkg.system_packages?.[0] || requiredPackageMap[pkg.id]?.name}
                      </span>
                    </div>
                  )}
                </div>
                {pkg.installed ? (
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => handleInstall(pkg)}
                      disabled={isInstalling || installingId !== null || uninstallingId !== null}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg transition-all duration-200 ${
                        pkg.has_update
                          ? 'bg-amber-600 hover:bg-amber-500 hover:shadow-amber-500/20'
                          : 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/20'
                      }`}
                    >
                      {isInstalling ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.RotateCw className="w-4 h-4" />}
                      {isInstalling ? tr.btnInstalling : (pkg.has_update ? (language === 'vi' ? 'Cập nhật' : 'Update') : tr.btnReinstall)}
                    </button>
                    {!pkg.is_core && (
                      <button
                        onClick={() => handleUninstall(pkg)}
                        disabled={uninstallingId !== null || installingId !== null}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 border hover:bg-red-500/10 disabled:opacity-50 rounded-xl font-bold text-xs transition-all duration-200 ${
                          isDark ? 'text-red-400 border-red-500/30 bg-red-950/20' : 'text-red-600 border-red-200 bg-red-50/40 hover:bg-red-50'
                        }`}
                      >
                        {uninstallingId === pkg.id ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Trash2 className="w-4 h-4" />}
                        {uninstallingId === pkg.id ? tr.btnUninstalling : tr.btnUninstall}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => handleInstall(pkg)}
                    disabled={isInstalling || installingId !== null || uninstallingId !== null}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg hover:shadow-blue-500/20 transition-all duration-200"
                  >
                    {isInstalling ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Package className="w-4 h-4" />}
                    {isInstalling ? tr.btnInstalling : tr.btnInstall}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isConfigOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
          <div className={`w-full max-w-lg border rounded-2xl shadow-2xl space-y-4 p-6 flex flex-col justify-between max-h-[85vh] transition-all duration-300 ${
            isDark ? 'bg-slate-900/95 border-slate-700/80 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 select-none">
              <div className="flex items-center gap-2">
                <Icons.Globe className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                <div>
                  <span className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {language === 'vi' ? 'Quản lý AppStore Cộng đồng' : 'Manage Community AppStores'}
                  </span>
                  <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {language === 'vi' ? 'Thêm/xóa danh mục của bên thứ ba' : 'Add or remove third-party catalogs'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsConfigOpen(false)}
                className={`p-1.5 rounded-lg border transition-all duration-200 ${
                  isDark ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800 border-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-200'
                }`}
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 flex-1">
              <div className="space-y-2">
                <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {language === 'vi' ? 'Thêm URL packages.json mới:' : 'Add new packages.json URL:'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://github.com/..."
                    className={`flex-1 text-xs px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all duration-200 ${
                      isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  />
                  <button
                    onClick={handleAddUrl}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-white font-bold text-xs bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg transition-all duration-200`}
                  >
                    <Icons.Plus className="w-4 h-4" />
                    {language === 'vi' ? 'Thêm' : 'Add'}
                  </button>
                </div>
              </div>

              <div className="space-y-2 flex-1 h-[25vh] overflow-y-auto">
                <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {language === 'vi' ? 'Danh sách AppStore hiện tại:' : 'Current AppStore Catalogs:'}
                </label>
                {communityUrls.length === 0 ? (
                  <p className={`text-xs text-center py-4 italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {language === 'vi' ? 'Chưa có AppStore cộng đồng nào được thêm.' : 'No community AppStores added yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {communityUrls.map((url, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${
                          isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className={`text-xs font-mono break-all line-clamp-1 flex-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                          {url}
                        </span>
                        <button
                          onClick={() => handleRemoveUrl(url)}
                          className={`p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-500 transition-all duration-200`}
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setIsConfigOpen(false)}
              className={`w-full py-2.5 font-bold text-xs rounded-xl transition-all duration-200 border ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200' : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 shadow-sm'
              }`}
            >
              {language === 'vi' ? 'Đóng' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}