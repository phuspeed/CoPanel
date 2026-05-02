/**
 * Firewall - Dashboard Component
 * Premium ufw rules management dashboard.
 */
import { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';

interface RuleItem {
  port: string;
  action: string;
  comment: string;
}

export default function FirewallDashboard() {
  const [active, setActive] = useState<boolean>(false);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New rule form state
  const [port, setPort] = useState<string>('');
  const [action, setAction] = useState<string>('ALLOW');
  const [comment, setComment] = useState<string>('');

  const fetchFirewall = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('copanel_token');
      const response = await fetch('/api/firewall/status', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch firewall status');
      }
      const data = await response.json();
      if (data.error_message) {
        setError(data.error_message);
      }
      setActive(data.active || false);
      setRules(data.rules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFirewall();
  }, []);

  // ➕ Add Rule Action
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!port) return;
    try {
      const token = localStorage.getItem('copanel_token');
      const response = await fetch('/api/firewall/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ port, action, comment }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to add rule');
      }
      setPort('');
      setComment('');
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error adding firewall rule');
    }
  };

  // 🗑️ Delete Rule Action
  const handleDeleteRule = async (item: RuleItem) => {
    if (!confirm(`Are you sure you want to delete the rule for "${item.port}"?`)) return;
    try {
      const token = localStorage.getItem('copanel_token');
      const response = await fetch('/api/firewall/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ port: item.port, action: item.action }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to delete rule');
      }
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting rule');
    }
  };

  const handleToggleFirewall = async () => {
    const action = active ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${action} the firewall?`)) return;
    try {
      const token = localStorage.getItem('copanel_token');
      const response = await fetch(`/api/firewall/${action}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || `Failed to ${action} firewall`);
      }
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Error toggling firewall`);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Top Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent flex items-center gap-2">
            <Icons.Shield className="w-8 h-8 text-blue-400" />
            Firewall Rules
          </h1>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-xl">
            View, add, or delete system firewall rules (ufw) to secure your environment.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleFirewall}
            className={`flex items-center gap-2 text-xs font-bold px-3.5 py-2.5 rounded-xl border transition-all ${
              active
                ? 'bg-red-600/10 hover:bg-red-600/20 border-red-500/20 text-red-300'
                : 'bg-green-600/10 hover:bg-green-600/20 border-green-500/20 text-green-300'
            }`}
          >
            <Icons.Power className="w-3.5 h-3.5" />
            {active ? 'Disable Firewall' : 'Enable Firewall'}
          </button>
          <span
            className={`flex items-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl border transition-all ${
              active
                ? 'bg-green-600/10 border-green-500/20 text-green-300 shadow-lg shadow-green-500/5'
                : 'bg-slate-800/60 border-slate-700 text-slate-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            Status: {active ? 'Active' : 'Inactive'}
          </span>
          <button
            onClick={fetchFirewall}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-slate-300 transition-all border border-slate-700 shadow-lg"
            title="Refresh rules list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-amber-950/20 border border-amber-500/30 p-4 rounded-xl text-amber-300 text-xs flex items-center gap-2 max-w-2xl backdrop-blur-md">
          <Icons.AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 animate-pulse" />
          <span>{error}</span>
        </div>
      )}

      {/* Quick Add Form & Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 h-fit backdrop-blur-md space-y-4">
          <h2 className="text-sm font-bold flex items-center gap-2 text-slate-200">
            <Icons.Plus className="w-4 h-4 text-blue-400" />
            Add Firewall Rule
          </h2>
          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Port or Range
              </label>
              <input
                type="text"
                required
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none focus:border-blue-500 text-xs font-mono transition-all"
                placeholder="e.g. 80, 443/tcp, 22"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Action
              </label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none focus:border-blue-500 text-xs font-medium transition-all"
              >
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Comment
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none focus:border-blue-500 text-xs transition-all"
                placeholder="e.g. Web Traffic"
              />
            </div>

            <button
              type="submit"
              disabled={!port}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
            >
              Add Rule
            </button>
          </form>
        </div>

        {/* Rules Table */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden backdrop-blur-md flex flex-col h-full">
          {loading && rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 flex-1">
              <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
              <p className="text-slate-400 text-xs">Loading firewall rules...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800/60 text-slate-300 text-xs uppercase tracking-wider">
                    <th className="p-4 font-bold select-none">Port</th>
                    <th className="p-4 font-bold select-none">Action</th>
                    <th className="p-4 font-bold select-none">Comment</th>
                    <th className="p-4 font-bold text-center w-28 select-none">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30 text-sm">
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-12 text-center text-slate-400 text-xs select-none">
                        No firewall rules configured on this system.
                      </td>
                    </tr>
                  )}
                  {rules.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-all duration-200">
                      <td className="p-4 text-slate-200 font-mono font-bold text-xs select-all">
                        {item.port}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${
                            item.action.toUpperCase() === 'ALLOW'
                              ? 'bg-green-600/10 border-green-500/20 text-green-300'
                              : 'bg-red-600/10 border-red-500/20 text-red-300'
                          }`}
                        >
                          {item.action.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400 text-xs truncate max-w-xs">{item.comment || '—'}</td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteRule(item)}
                          disabled={item.port === '22/tcp' || item.port === '22'}
                          className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-red-400 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700/60 transition-all"
                          title="Delete Rule"
                        >
                          <Icons.Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
