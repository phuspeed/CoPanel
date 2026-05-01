/**
 * Premium Package Manager Component
 * Stunning, dynamic, and glassmorphic UI with direct highlighting.
 */
import { useEffect, useState } from 'react';
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

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const selectedPackageId = searchParams.get('id');

  const categories = ['All', 'Web Server', 'Database & Caching', 'Security & System'];

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
      } else {
        console.error(`Failed to execute ${action} on ${id}`);
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
    };
    const IconComponent = iconMap[iconName] || Icons.Box;
    return <IconComponent className="w-6 h-6" />;
  };

  const filteredPackages = selectedPackageId
    ? packages.filter((p) => p.id === selectedPackageId)
    : (selectedCategory === 'All'
      ? packages
      : packages.filter((p) => p.category === selectedCategory));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Premium Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent">
            Ubuntu Service & Packages
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Directly manage Ubuntu system services and dynamic CoPanel modules.
            Interact with your stack using Install, Restart, Stop, and Remove.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">System Engine</span>
          <span className="text-2xl font-mono font-bold text-slate-100">
            {packages.filter((p) => p.status === 'running').length} / {packages.length}
          </span>
          <span className="text-xs text-slate-400">Services Active</span>
        </div>
      </div>

      {/* Categories Filter Tabs */}
      {!selectedPackageId && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all rounded-t-lg border-b-2 duration-200 ${
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
          <div className="flex items-center gap-2 text-blue-400 text-xs bg-blue-950/40 px-3 py-2 border border-blue-900/40 rounded-xl">
            <Icons.Eye className="w-4 h-4" />
            Showing focused package details
          </div>
          <button
            onClick={() => window.history.replaceState(null, '', window.location.pathname)}
            className="text-xs text-slate-400 hover:text-slate-200 transition"
          >
            Show All Packages
          </button>
        </div>
      )}

      {loading && packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border border-slate-800 rounded-xl bg-slate-900/20">
          <Icons.Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-sm text-slate-400 mt-4">Loading system packages...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPackages.map((pkg) => (
            <div
              key={pkg.id}
              className={`group relative flex flex-col justify-between bg-slate-900/60 border hover:border-blue-500/30 p-6 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-1 backdrop-blur-sm ${
                pkg.id === selectedPackageId ? 'border-blue-500 bg-blue-950/20 shadow-xl shadow-blue-500/5 ring-1 ring-blue-500/40' : 'border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-500 text-blue-400 transition-all duration-300">
                      {getIcon(pkg.icon)}
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-slate-200 group-hover:text-white transition-colors duration-300">
                        {pkg.name}
                      </h4>
                      <span className="text-xs text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/60">
                        {pkg.category}
                      </span>
                    </div>
                  </div>
                  {/* Glassmorphic Status Indicator */}
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium ${
                      pkg.status === 'running'
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : pkg.status === 'stopped'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-slate-800/80 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        pkg.status === 'running'
                          ? 'bg-green-400 animate-pulse'
                          : pkg.status === 'stopped'
                          ? 'bg-amber-400'
                          : 'bg-slate-500'
                      }`}
                    ></span>
                    {pkg.status === 'running' ? 'Active' : pkg.status === 'stopped' ? 'Stopped' : 'Not Installed'}
                  </span>
                </div>

                <p className="text-slate-400 text-xs min-h-[40px] line-clamp-2 leading-relaxed">
                  {pkg.description}
                </p>
              </div>

              {/* Action Buttons with Dynamic Loading Interactions */}
              <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                {pkg.status === 'not_installed' ? (
                  <button
                    onClick={() => handleAction(pkg.id, 'install')}
                    disabled={actionLoading !== null}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/50 rounded-xl transition-all shadow-lg hover:shadow-blue-500/20"
                  >
                    {actionLoading === `${pkg.id}-install` ? (
                      <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icons.Download className="w-3.5 h-3.5" />
                    )}
                    Cài đặt
                  </button>
                ) : (
                  <>
                    {pkg.status === 'running' ? (
                      <>
                        <button
                          onClick={() => handleAction(pkg.id, 'stop')}
                          disabled={actionLoading !== null}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-xl transition-all border border-slate-700"
                        >
                          {actionLoading === `${pkg.id}-stop` ? (
                            <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Icons.Square className="w-3.5 h-3.5" />
                          )}
                          Stop
                        </button>
                        <button
                          onClick={() => handleAction(pkg.id, 'restart')}
                          disabled={actionLoading !== null}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/50 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20"
                        >
                          {actionLoading === `${pkg.id}-restart` ? (
                            <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Icons.RotateCw className="w-3.5 h-3.5" />
                          )}
                          Restart
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction(pkg.id, 'restart')}
                        disabled={actionLoading !== null}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-500 disabled:bg-green-800/50 rounded-xl transition-all shadow-lg hover:shadow-green-500/20"
                      >
                        {actionLoading === `${pkg.id}-restart` ? (
                          <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Icons.Play className="w-3.5 h-3.5" />
                        )}
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(pkg.id, 'remove')}
                      disabled={actionLoading !== null}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/40 disabled:opacity-50 rounded-xl border border-red-900/40 transition-all"
                    >
                      {actionLoading === `${pkg.id}-remove` ? (
                        <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                      )}
                      Remove
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
