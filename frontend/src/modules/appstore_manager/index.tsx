/**
 * AppStore Manager Dashboard
 * Displays available packages from GitHub, handles remote zip downloads and installation.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface Package {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  download_url: string;
}

export default function AppStoreDashboard() {
  const [catalog, setCatalog] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

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
      noApps: 'Không tìm thấy ứng dụng nào trong AppStore.'
    }
  };

  const tr = t[language || 'en'];

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
    fetchCatalog();
  }, [language]);

  const handleInstall = async (pkg: Package) => {
    setInstallingId(pkg.id);
    setMsg(tr.installing(pkg.name));
    try {
      const res = await fetch('/api/appstore_manager/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id: pkg.id, download_url: pkg.download_url })
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(tr.installSuccess(pkg.name));
      } else {
        setMsg(tr.installError(d.detail || 'Extraction failed.'));
      }
    } catch {
      setMsg(tr.commError);
    } finally {
      setInstallingId(null);
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
          <span className={`text-base md:text-lg font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.live}</span>
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
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700/60' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                        {pkg.version}
                      </span>
                    </div>
                  </div>
                  <p className={`text-xs line-clamp-2 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {pkg.description}
                  </p>
                </div>
                <button
                  onClick={() => handleInstall(pkg)}
                  disabled={isInstalling || installingId !== null}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg hover:shadow-blue-500/20 transition-all duration-200"
                >
                  {isInstalling ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Package className="w-4 h-4" />}
                  {isInstalling ? tr.btnInstalling : tr.btnInstall}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}