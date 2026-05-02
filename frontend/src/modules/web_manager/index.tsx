/**
 * Web Manager - Site Management Component
 * Premium Nginx sites-available/sites-enabled dashboard.
 */
import { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';

interface SiteItem {
  filename: string;
  domain: string;
  root: string;
  active: boolean;
  content: string;
}

export default function WebManagerDashboard() {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New site form state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [filename, setFilename] = useState<string>('');
  const [domain, setDomain] = useState<string>('');
  const [root, setRoot] = useState<string>('/var/www/html');
  const [port, setPort] = useState<number>(80);
  const [proxyPort, setProxyPort] = useState<number | ''>('');
  const [siteType, setSiteType] = useState<'static' | 'proxy'>('static');

  // Site Viewer state
  const [viewingSite, setViewingSite] = useState<SiteItem | null>(null);

  const fetchSites = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/web_manager/list');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch Nginx sites');
      }
      const data = await response.json();
      setSites(data.sites || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  // 🔄 Toggle Status (Enable/Disable)
  const handleToggleStatus = async (item: SiteItem) => {
    try {
      const response = await fetch('/api/web_manager/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.filename, active: !item.active }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to toggle status');
      }
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error toggling site status');
    }
  };

  // 🗑️ Delete Site
  const handleDeleteSite = async (item: SiteItem) => {
    if (!confirm(`Are you sure you want to completely delete "${item.filename}"?`)) return;
    try {
      const response = await fetch('/api/web_manager/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.filename }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to delete site');
      }
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting site');
    }
  };

  // ➕ Create Site Action
  const handleCreateSite = async () => {
    if (!filename || !domain) return;
    try {
      const response = await fetch('/api/web_manager/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          domain,
          root: siteType === 'static' ? root : '',
          port,
          proxy_port: siteType === 'proxy' ? (proxyPort || null) : null,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to create site');
      }
      // Reset form
      setFilename('');
      setDomain('');
      setRoot('/var/www/html');
      setPort(80);
      setProxyPort('');
      setShowCreateModal(false);
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating site');
    }
  };

  return (
    <div className="p-8">
      {/* Top Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Icons.Globe className="w-8 h-8 text-blue-400" />
            Web Manager
          </h1>
          <p className="text-slate-400">Manage Nginx configurations and available sites</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition"
          >
            <Icons.Plus className="w-4 h-4" /> Create New Site
          </button>
          <button
            onClick={fetchSites}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-2.5 rounded-lg text-slate-300 transition"
            title="Refresh sites list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Table / Loader */}
      {loading && sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400">Loading Nginx sites...</p>
        </div>
      ) : error ? (
        <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg">
          <p className="text-red-200">Error: {error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-800 text-slate-300 text-xs uppercase">
                    <th className="p-4 font-semibold">Filename</th>
                    <th className="p-4 font-semibold">Domain / Server Name</th>
                    <th className="p-4 font-semibold">Root Path</th>
                    <th className="p-4 font-semibold text-center">Status</th>
                    <th className="p-4 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30 text-sm">
                  {sites.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        No sites found in sites-available
                      </td>
                    </tr>
                  )}
                  {sites.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40 transition">
                      <td className="p-4 text-slate-200 font-medium">{item.filename}</td>
                      <td className="p-4 text-slate-300 font-mono text-xs">{item.domain}</td>
                      <td className="p-4 text-slate-400 font-mono text-xs truncate max-w-xs" title={item.root}>
                        {item.root}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className={`px-3 py-1 text-xs font-semibold rounded-full transition-all border select-none ${
                            item.active
                              ? 'bg-green-600/20 border-green-500/50 text-green-300'
                              : 'bg-slate-800/60 border-slate-700 text-slate-400'
                          }`}
                        >
                          {item.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setViewingSite(item)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-blue-400 transition"
                            title="View Configuration"
                          >
                            <Icons.Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSite(item)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-red-400 transition"
                            title="Delete Site"
                          >
                            <Icons.Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW SITE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-lg shadow-2xl">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-100">
              <Icons.Plus className="w-5 h-5 text-blue-400" /> Create Nginx Site
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-slate-400 text-xs font-semibold mb-2 block uppercase">
                  Service Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSiteType('static')}
                    className={`p-3 rounded-lg border font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                      siteType === 'static'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Icons.Globe className="w-4 h-4" /> Static Web Service
                  </button>
                  <button
                    onClick={() => setSiteType('proxy')}
                    className={`p-3 rounded-lg border font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                      siteType === 'proxy'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Icons.Shield className="w-4 h-4" /> Nginx Port Proxy (Reverse Proxy)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                  Configuration Filename
                </label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                  placeholder="e.g. example.com"
                />
              </div>

              <div>
                <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                  Domain Name (server_name)
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                  placeholder="e.g. example.com or localhost"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                    Port
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                  />
                </div>
                {siteType === 'static' ? (
                  <div>
                    <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                      Root Path
                    </label>
                    <input
                      type="text"
                      value={root}
                      onChange={(e) => setRoot(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                      Proxy Port
                    </label>
                    <input
                      type="number"
                      value={proxyPort}
                      onChange={(e) => setProxyPort(e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                      placeholder="e.g. 8000"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSite}
                disabled={!filename || !domain}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW NGINX CONFIG MODAL */}
      {viewingSite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-2xl h-[70vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100 truncate max-w-md">
                <Icons.Eye className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>Nginx Config: {viewingSite.filename}</span>
              </h3>
              <button
                onClick={() => setViewingSite(null)}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                &times;
              </button>
            </div>
            <pre className="flex-1 bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-200 font-mono text-sm overflow-auto">
              {viewingSite.content}
            </pre>
            <div className="flex items-center justify-end gap-3 mt-4 flex-shrink-0">
              <button
                onClick={() => setViewingSite(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
