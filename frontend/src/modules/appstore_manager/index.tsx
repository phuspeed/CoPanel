/**
 * AppStore Manager Dashboard
 * Displays available packages from GitHub, handles remote zip downloads and installation.
 */
import { useState, useEffect } from 'react';
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

  const token = localStorage.getItem('copanel_token');

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
        setMsg('Failed to fetch AppStore catalog from GitHub.');
      }
    } catch {
      setMsg('Error communicating with the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleInstall = async (pkg: Package) => {
    setInstallingId(pkg.id);
    setMsg(`Installing ${pkg.name}...`);
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
        setMsg(`✓ ${pkg.name} installed successfully! System is compiling frontend in background.`);
      } else {
        setMsg(`Error installing package: ${d.detail || 'Extraction failed.'}`);
      }
    } catch {
      setMsg('Failed to communicate with backend.');
    } finally {
      setInstallingId(null);
    }
  };

  if (loading && catalog.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-50 select-none">
        <div className="text-center">
          <Icons.Loader className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-500" />
          <p className="text-slate-400 text-sm">Fetching package catalog...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Premium Ambient Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent">
            GitHub AppStore Catalog
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Expand CoPanel by installing public modules from GitHub. Once downloaded, your panel's interface will automatically adapt at runtime.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">AppStore Source</span>
          <span className="text-2xl font-mono font-bold text-slate-100">Live & Syncing</span>
        </div>
      </div>

      {msg && (
        <div className="p-3.5 bg-blue-900/20 border border-blue-600/30 rounded-xl text-blue-300 text-xs flex items-center gap-2 max-w-xl animate-pulse">
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {/* Package grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {catalog.map((pkg) => (
          <div key={pkg.id} className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm hover:border-blue-500/30 transition-all flex flex-col justify-between gap-5 hover:shadow-xl hover:shadow-blue-500/5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
                  <Icons.Package className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-slate-800 text-slate-400 bg-slate-950/60 uppercase tracking-wider">
                  v{pkg.version}
                </span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-200 tracking-tight">{pkg.name}</h3>
                <p className="text-slate-400 text-xs leading-relaxed line-clamp-3">{pkg.description}</p>
              </div>
            </div>

            <button
              onClick={() => handleInstall(pkg)}
              disabled={installingId !== null}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-blue-500/20 focus:outline-none"
            >
              {installingId === pkg.id ? (
                <>
                  <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> Installing...
                </>
              ) : (
                <>
                  <Icons.Download className="w-3.5 h-3.5" /> Install Extension
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
