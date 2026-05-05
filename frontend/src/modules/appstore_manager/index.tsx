/**
 * AppStore Manager Dashboard
 * Displays available packages from GitHub, handles remote zip downloads and installation.
 */
import { useState, useEffect, type ComponentType } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

type UpdateStatus = 'not_installed' | 'up_to_date' | 'update_available' | 'ahead';

interface Package {
  id: string;
  name: string;
  description: string;
  version: string;
  remote_version?: string;
  icon: string;
  download_url: string;
  installed?: boolean;
  has_update?: boolean;
  local_version?: string;
  update_status?: UpdateStatus;
  is_core?: boolean;
  system_packages?: string[];
  changelog_en?: string;
  changelog_vi?: string;
  is_community?: boolean;
}

function formatApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((x: { msg?: string }) => x?.msg || JSON.stringify(x)).join('; ');
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    return String((detail as { msg: string }).msg);
  }
  return 'Request failed';
}

function pkgIdFromZipName(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.zip$/i, '');
  return base.split('-v')[0].split('_v')[0].split('.')[0].trim().toLowerCase() || 'custom_module';
}

const CARD_ACCENT: { dark: string; light: string }[] = [
  { dark: 'from-sky-500/25 to-indigo-600/30 ring-sky-500/20', light: 'from-sky-500 to-indigo-600 ring-sky-200/60' },
  { dark: 'from-emerald-500/25 to-teal-600/30 ring-emerald-500/20', light: 'from-emerald-500 to-teal-600 ring-emerald-200/60' },
  { dark: 'from-violet-500/25 to-fuchsia-600/30 ring-violet-500/20', light: 'from-violet-500 to-fuchsia-600 ring-violet-200/60' },
  { dark: 'from-amber-500/25 to-orange-600/30 ring-amber-500/20', light: 'from-amber-500 to-orange-600 ring-amber-200/60' },
  { dark: 'from-cyan-500/25 to-blue-600/30 ring-cyan-500/20', light: 'from-cyan-500 to-blue-600 ring-cyan-200/60' },
];

function accentForPackageId(id: string): { dark: string; light: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return CARD_ACCENT[Math.abs(h) % CARD_ACCENT.length];
}

function CatalogIcon({
  iconName,
  className,
}: {
  iconName?: string;
  className?: string;
}) {
  const map = Icons as unknown as Record<string, ComponentType<{ className?: string }>>;
  const Cmp = (iconName && map[iconName] ? map[iconName] : Icons.Package) as ComponentType<{ className?: string }>;
  return <Cmp className={className} />;
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
      btnUpdate: 'Update',
      btnUninstalling: 'Uninstalling...',
      subtitle: 'Discover extensions built for your panel',
      noApps: 'No applications currently found in AppStore.',
      statusNotInstalled: 'Not installed',
      statusUpToDate: 'Up to date',
      statusUpdateAvailable: 'Update available',
      statusAhead: 'Newer than catalog',
      versionOnServer: (v: string) => `Catalog: v${v}`,
      versionInstalled: (v: string) => `Installed: v${v}`,
      updateFlow: (from: string, to: string) => `v${from} → v${to}`,
      changelogForUpdate: 'Changes in this update',
      changelogReleaseNotes: 'Release notes',
      aheadOfCatalog: 'Installed build is newer than this catalog entry.',
      installedVsCatalog: (inst: string, cat: string) => `Installed v${inst} · catalog v${cat}`,
      communitySaved: 'Community catalog list saved.',
      communitySaveFailed: 'Could not save community AppStore URLs (check server permissions on config/).',
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
      btnUpdate: 'Cập nhật',
      btnUninstalling: 'Đang gỡ...',
      subtitle: 'Khám phá tiện ích mở rộng cho CoPanel',
      noApps: 'Không tìm thấy ứng dụng nào trong AppStore.',
      statusNotInstalled: 'Chưa cài',
      statusUpToDate: 'Đã mới nhất',
      statusUpdateAvailable: 'Có bản cập nhật',
      statusAhead: 'Mới hơn bản trên kho',
      versionOnServer: (v: string) => `Trên kho: v${v}`,
      versionInstalled: (v: string) => `Đang cài: v${v}`,
      updateFlow: (from: string, to: string) => `v${from} → v${to}`,
      changelogForUpdate: 'Nội dung bản cập nhật',
      changelogReleaseNotes: 'Ghi chú phát hành',
      aheadOfCatalog: 'Bản đã cài mới hơn mục trên kho (có thể từ ZIP hoặc bản dev).',
      installedVsCatalog: (inst: string, cat: string) => `Đã cài v${inst} · trên kho v${cat}`,
      communitySaved: 'Đã lưu danh sách AppStore cộng đồng.',
      communitySaveFailed: 'Không lưu được URL (kiểm tra quyền ghi thư mục config/ trên máy chủ).',
    }
  };

  const tr = t[language || 'en'];

  const selfModuleVersion = catalog.find((p) => p.id === 'appstore_manager')?.version;

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/appstore_manager/config', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const d = await res.json();
        setCommunityUrls(Array.isArray(d.community_urls) ? d.community_urls : []);
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
        setMsg(tr.communitySaved);
        await fetchConfig();
        fetchCatalog();
      } else {
        let detail = '';
        try {
          const errBody = await res.json();
          detail = formatApiDetail(errBody.detail);
        } catch {
          detail = res.statusText;
        }
        setMsg(`${tr.communitySaveFailed}${detail ? ` (${detail})` : ''}`);
      }
    } catch (err) {
      console.error(err);
      setMsg(tr.communitySaveFailed);
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

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!file.name.endsWith('.zip')) {
      alert(language === 'vi' ? 'Chỉ hỗ trợ tệp tin .zip!' : 'Only .zip files are supported!');
      return;
    }

    const pkgId = pkgIdFromZipName(file.name);
    setActivePkgId(pkgId);
    setBuildLogs([`Uploading and checking ZIP structure for ${file.name}...`]);
    setBuildStatus("running");
    setMsg(language === 'vi' ? 'Đang tải lên tệp zip...' : 'Uploading zip file...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('copanel_token');
      let res = await fetch('/api/appstore_manager/upload-install', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      if (res.status === 404) {
        const fd2 = new FormData();
        fd2.append('file', file);
        res = await fetch('/api/appstore_manager/upload_zip', {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          body: fd2
        });
      }
      const d = await res.json();
      if (res.ok) {
        setMsg(language === 'vi' ? `✓ Đang cài đặt ${file.name} từ tệp ZIP...` : `✓ Installing ${file.name} from uploaded ZIP...`);
        
        const interval = setInterval(async () => {
          try {
            const token = localStorage.getItem('copanel_token');
            const r = await fetch(`/api/appstore_manager/build-status/${pkgId}`, {
              headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (r.ok) {
              const b = await r.json();
              if (b.logs) setBuildLogs(b.logs);
              if (b.status === 'success' || b.status === 'failed') {
                setBuildStatus(b.status);
                clearInterval(interval);
                if (b.status === 'success') {
                  setMsg(`✓ ${file.name} installed and built successfully!`);
                  setTimeout(() => {
                    window.location.reload();
                  }, 2000);
                } else {
                  setMsg(`❌ Error building ${file.name}: ${b.error || 'Build failed.'}`);
                }
              }
            }
          } catch (err) {
            console.error(err);
          }
        }, 1500);
      } else {
        const errText = formatApiDetail(d.detail) || (language === 'vi' ? 'Cấu trúc file ZIP không hợp lệ.' : 'Invalid ZIP file structure.');
        setMsg(errText);
        setBuildStatus("failed");
        setBuildLogs(prev => [...prev, `❌ Error: ${errText}`]);
      }
    } catch {
      setMsg(tr.commError);
      setBuildStatus("failed");
    }
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

  useEffect(() => {
    if (isConfigOpen) {
      void fetchConfig();
    }
  }, [isConfigOpen]);

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
        setMsg(tr.installError(formatApiDetail(d.detail) || 'Extraction failed.'));
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
    <div className={`min-h-[calc(100vh-6rem)] p-4 md:p-8 max-w-7xl mx-auto space-y-6 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      {/* Hero */}
      <header
        className={`relative overflow-hidden rounded-3xl border shadow-lg ${
          isDark
            ? 'border-slate-800/80 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900'
            : 'border-slate-200/90 bg-gradient-to-br from-white via-slate-50/95 to-white'
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-0 opacity-40 ${isDark ? 'bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.35),transparent)]' : 'bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.18),transparent)]'}`}
        />
        <div className="relative flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4 md:gap-5">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg ring-2 md:h-16 md:w-16 ${
                isDark
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600 ring-blue-500/30'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 ring-blue-300/50'
              }`}
            >
              <Icons.ShoppingBag className="h-7 w-7 text-white md:h-8 md:w-8" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className={`text-2xl font-bold tracking-tight md:text-3xl ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {tr.title}
                </h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                    isDark ? 'bg-white/10 text-slate-200 ring-1 ring-white/10' : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80'
                  }`}
                >
                  v{selfModuleVersion ?? '…'}
                </span>
              </div>
              <p className={`max-w-xl text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.subtitle}</p>
              <p className={`max-w-2xl text-xs leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.desc}</p>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <button
              type="button"
              onClick={() => fetchCatalog()}
              disabled={loading}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isDark
                  ? 'border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                  : 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50'
              } ${loading ? 'opacity-60' : ''}`}
            >
              <Icons.RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {language === 'vi' ? 'Làm mới danh sách' : 'Refresh catalog'}
            </button>
            <button
              type="button"
              onClick={() => setIsConfigOpen(true)}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isDark
                  ? 'border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                  : 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50'
              }`}
            >
              <Icons.Store className="h-4 w-4" />
              {language === 'vi' ? 'Kho cộng đồng' : 'Community'}
            </button>
            <label
              className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isDark
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500'
                  : 'bg-blue-600 text-white shadow-md shadow-blue-600/25 hover:bg-blue-500'
              }`}
            >
              <Icons.FileArchive className="h-4 w-4" />
              {language === 'vi' ? 'Nhập từ ZIP' : 'Import ZIP'}
              <input type="file" accept=".zip" className="hidden" onChange={handleUploadZip} />
            </label>
          </div>
        </div>
        <div
          className={`flex flex-wrap items-center gap-3 border-t px-6 py-3 text-[11px] font-medium md:px-8 ${
            isDark ? 'border-slate-800/80 text-slate-500' : 'border-slate-100 text-slate-500'
          }`}
        >
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {tr.live}
          </span>
          <span className="hidden sm:inline opacity-60">·</span>
          <span>{tr.source}</span>
        </div>
      </header>

      {msg && (
        <div
          className={`flex max-w-2xl items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            isDark ? 'border-slate-700 bg-slate-900/60 text-slate-200' : 'border-slate-200 bg-white text-slate-700 shadow-sm'
          }`}
        >
          <Icons.Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <span className="leading-relaxed">{msg}</span>
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
        <div
          className={`flex flex-col items-center justify-center rounded-3xl border py-16 text-center ${
            isDark ? 'border-slate-800 bg-slate-900/40 text-slate-400' : 'border-slate-200 bg-white text-slate-500 shadow-sm'
          }`}
        >
          <div
            className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}
          >
            <Icons.LayoutGrid className="h-8 w-8 opacity-50" />
          </div>
          <p className="max-w-xs text-sm">{tr.noApps}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5">
          {catalog.map((pkg) => {
            const isInstalling = installingId === pkg.id;
            const accent = accentForPackageId(pkg.id);
            const showChangelog = !!(pkg.changelog_en || pkg.changelog_vi);
            return (
              <article
                key={pkg.id}
                className={`flex flex-col overflow-hidden rounded-3xl border transition-all duration-300 ${
                  isDark
                    ? 'border-slate-800/90 bg-slate-900/50 hover:border-slate-700 hover:shadow-xl hover:shadow-black/20'
                    : 'border-slate-200/90 bg-white shadow-sm hover:border-slate-300 hover:shadow-xl hover:shadow-slate-300/30'
                }`}
              >
                <div className="flex gap-4 p-5">
                  <div
                    className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-inner ring-2 ${
                      isDark ? accent.dark : accent.light
                    }`}
                  >
                    <CatalogIcon iconName={pkg.icon} className="h-7 w-7 text-white drop-shadow-md" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`truncate text-base font-semibold leading-snug ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        {pkg.name}
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`rounded-lg px-2 py-0.5 font-mono text-[10px] font-medium ${
                          isDark ? 'bg-slate-800 text-slate-400 ring-1 ring-slate-700' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
                        }`}
                      >
                        {tr.versionOnServer(pkg.remote_version || pkg.version)}
                      </span>
                      {pkg.installed && !!pkg.local_version && (
                        <span
                          className={`rounded-lg px-2 py-0.5 font-mono text-[10px] font-medium ${
                            isDark ? 'bg-blue-950/50 text-blue-300 ring-1 ring-blue-900/60' : 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                          }`}
                        >
                          {tr.versionInstalled(pkg.local_version)}
                        </span>
                      )}
                      {pkg.update_status && (
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                            pkg.update_status === 'update_available'
                              ? isDark
                                ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40'
                                : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                              : pkg.update_status === 'up_to_date'
                                ? isDark
                                  ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-600/30'
                                  : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                                : pkg.update_status === 'ahead'
                                  ? isDark
                                    ? 'bg-violet-500/10 text-violet-300 ring-1 ring-violet-600/30'
                                    : 'bg-violet-50 text-violet-800 ring-1 ring-violet-200'
                                  : isDark
                                    ? 'bg-slate-800 text-slate-400 ring-1 ring-slate-700'
                                    : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                          }`}
                        >
                          {pkg.update_status === 'not_installed' && tr.statusNotInstalled}
                          {pkg.update_status === 'up_to_date' && tr.statusUpToDate}
                          {pkg.update_status === 'update_available' && tr.statusUpdateAvailable}
                          {pkg.update_status === 'ahead' && tr.statusAhead}
                        </span>
                      )}
                      {pkg.is_core && (
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                            isDark ? 'bg-emerald-950/40 text-emerald-400 ring-1 ring-emerald-900/50' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                          }`}
                        >
                          {language === 'vi' ? 'Mặc định' : 'Core'}
                        </span>
                      )}
                      {pkg.is_community && (
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${
                            isDark ? 'bg-cyan-950/40 text-cyan-400 ring-1 ring-cyan-900/50' : 'bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200'
                          }`}
                        >
                          {language === 'vi' ? 'Cộng đồng' : 'Community'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className={`line-clamp-3 px-5 text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{pkg.description}</p>

                {showChangelog && (
                  <details
                    className={`mx-5 mt-3 rounded-2xl border text-left ${
                      pkg.update_status === 'update_available'
                        ? isDark
                          ? 'border-amber-700/40 bg-amber-950/20'
                          : 'border-amber-200 bg-amber-50/50'
                        : isDark
                          ? 'border-slate-700/80 bg-slate-950/40'
                          : 'border-slate-200 bg-slate-50/80'
                    }`}
                  >
                    <summary
                      className={`flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold marker:content-none [&::-webkit-details-marker]:hidden ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icons.ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        {tr.changelogReleaseNotes}
                      </span>
                      <span className="font-mono text-[10px] font-normal opacity-70">v{pkg.remote_version || pkg.version}</span>
                    </summary>
                    <div className={`space-y-2 border-t px-3 py-3 text-xs leading-relaxed ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'}`}>
                      {pkg.update_status === 'update_available' && pkg.local_version && (
                        <p className={`font-mono text-[11px] ${isDark ? 'text-amber-200/90' : 'text-amber-900'}`}>
                          {tr.updateFlow(pkg.local_version, pkg.remote_version || pkg.version)}
                        </p>
                      )}
                      {pkg.update_status === 'ahead' && pkg.local_version && (
                        <p className={`text-[11px] ${isDark ? 'text-violet-300/90' : 'text-violet-800'}`}>
                          {tr.installedVsCatalog(pkg.local_version, pkg.remote_version || pkg.version)} — {tr.aheadOfCatalog}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap italic">
                        {language === 'vi' ? pkg.changelog_vi || pkg.changelog_en : pkg.changelog_en || pkg.changelog_vi}
                      </p>
                    </div>
                  </details>
                )}

                {((pkg.system_packages && pkg.system_packages.length > 0) || requiredPackageMap[pkg.id]) && (
                  <div
                    className={`mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${
                      isDark ? 'bg-slate-950/50 text-slate-400' : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    <Icons.Server className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span>{language === 'vi' ? 'Hệ thống:' : 'Requires:'}</span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-mono font-semibold ${
                        isDark ? 'bg-slate-800 text-blue-300' : 'bg-white text-blue-700 ring-1 ring-slate-200'
                      }`}
                    >
                      {pkg.system_packages?.[0] || requiredPackageMap[pkg.id]?.name}
                    </span>
                  </div>
                )}

                <div className={`mt-auto flex flex-col gap-2 p-5 pt-4 ${isDark ? 'border-t border-slate-800/80' : 'border-t border-slate-100'}`}>
                  {!pkg.installed ? (
                    <button
                      type="button"
                      onClick={() => handleInstall(pkg)}
                      disabled={isInstalling || installingId !== null || uninstallingId !== null}
                      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-50 ${
                        isDark
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500'
                          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/20'
                      }`}
                    >
                      {isInstalling ? <Icons.Loader className="h-4 w-4 animate-spin" /> : <Icons.Download className="h-4 w-4" />}
                      {isInstalling ? tr.btnInstalling : tr.btnInstall}
                    </button>
                  ) : (
                    <>
                      {pkg.has_update && (
                        <button
                          type="button"
                          onClick={() => handleInstall(pkg)}
                          disabled={isInstalling || installingId !== null || uninstallingId !== null}
                          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-50 ${
                            isDark
                              ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500'
                              : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-amber-600/25'
                          }`}
                        >
                          {isInstalling ? <Icons.Loader className="h-4 w-4 animate-spin" /> : <Icons.ArrowUpCircle className="h-4 w-4" />}
                          {isInstalling ? tr.btnInstalling : tr.btnUpdate}
                        </button>
                      )}
                      {pkg.is_core ? (
                        <button
                          type="button"
                          onClick={() => handleInstall(pkg)}
                          disabled={isInstalling || installingId !== null || uninstallingId !== null}
                          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                            isDark
                              ? 'border border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                              : 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50'
                          }`}
                        >
                          {isInstalling && !pkg.has_update ? (
                            <Icons.Loader className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Icons.RotateCw className="h-3.5 w-3.5" />
                          )}
                          {isInstalling && !pkg.has_update ? tr.btnInstalling : tr.btnReinstall}
                        </button>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleInstall(pkg)}
                            disabled={isInstalling || installingId !== null || uninstallingId !== null}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                              isDark
                                ? 'border border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                                : 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50'
                            }`}
                          >
                            {isInstalling && !pkg.has_update ? (
                              <Icons.Loader className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Icons.RotateCw className="h-3.5 w-3.5" />
                            )}
                            {isInstalling && !pkg.has_update ? tr.btnInstalling : tr.btnReinstall}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUninstall(pkg)}
                            disabled={uninstallingId !== null || installingId !== null}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                              isDark
                                ? 'border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-950/50'
                                : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {uninstallingId === pkg.id ? (
                              <Icons.Loader className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Icons.Trash2 className="h-3.5 w-3.5" />
                            )}
                            {uninstallingId === pkg.id ? tr.btnUninstalling : tr.btnUninstall}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </article>
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