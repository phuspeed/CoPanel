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
      const response = await fetch('/api/firewall/status');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch firewall status');
      }
      const data = await response.json();
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
      const response = await fetch('/api/firewall/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch('/api/firewall/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <div className="p-8">
      {/* Top Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Icons.Shield className="w-8 h-8 text-blue-400" />
            Firewall Manager
          </h1>
          <p className="text-slate-400">View and manage system firewall rules (ufw)</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border ${
              active
                ? 'bg-green-600/20 border-green-500/50 text-green-300'
                : 'bg-red-600/20 border-red-500/50 text-red-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            Status: {active ? 'Active' : 'Inactive'}
          </span>
          <button
            onClick={fetchFirewall}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-2.5 rounded-lg text-slate-300 transition"
            title="Refresh rules list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quick Add Form & Error Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 h-fit">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-100">
            <Icons.Plus className="w-5 h-5 text-blue-400" /> Quick Add Rule
          </h2>
          <form onSubmit={handleAddRule} className="space-y-4">
            <div>
              <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                Port or Range
              </label>
              <input
                type="text"
                required
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                placeholder="e.g. 80, 443/tcp, 22"
              />
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                Action
              </label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 text-sm font-medium"
              >
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 text-xs font-semibold mb-1 block uppercase">
                Comment
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 text-sm"
                placeholder="e.g. Web Traffic"
              />
            </div>

            <button
              type="submit"
              disabled={!port}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
            >
              Add Rule
            </button>
          </form>
        </div>

        {/* Rules Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col h-full">
          {loading && rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 flex-1">
              <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
              <p className="text-slate-400">Loading firewall rules...</p>
            </div>
          ) : error ? (
            <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg m-6">
              <p className="text-red-200">Error fetching rules: {error}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-800 text-slate-300 text-xs uppercase">
                    <th className="p-4 font-semibold">Port</th>
                    <th className="p-4 font-semibold">Action</th>
                    <th className="p-4 font-semibold">Comment</th>
                    <th className="p-4 font-semibold text-center w-28">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30 text-sm">
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400">
                        No rules found
                      </td>
                    </tr>
                  )}
                  {rules.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40 transition">
                      <td className="p-4 text-slate-200 font-mono font-medium">{item.port}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded-full select-none ${
                            item.action.toUpperCase() === 'ALLOW'
                              ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                              : 'bg-red-600/20 text-red-400 border border-red-500/30'
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
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          title="Delete Rule"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
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
