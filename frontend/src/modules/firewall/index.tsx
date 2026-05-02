/**
 * Firewall - Dashboard Component
 * Premium ufw rules management dashboard.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
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

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  // New rule form state
  const [port, setPort] = useState<string>('');
  const [action, setAction] = useState<string>('ALLOW');
  const [comment, setComment] = useState<string>('');

  const t = {
    en: {
      title: 'Firewall Rules',
      desc: 'View, add, or delete system firewall rules (ufw) to secure your environment.',
      addTitle: 'Add Firewall Rule',
      port: 'Port or Range',
      action: 'Action',
      comment: 'Comment',
      addBtn: 'Add Rule',
      status: 'Status',
      active: 'Active',
      inactive: 'Inactive',
      enable: 'Enable Firewall',
      disable: 'Disable Firewall',
      noRules: 'No firewall rules configured on this system.',
      loading: 'Loading firewall rules...',
      confirmDel: (p: string) => `Are you sure you want to delete the rule for "${p}"?`,
      confirmToggle: (act: string) => `Are you sure you want to ${act} the firewall?`
    },
    vi: {
      title: 'Tường lửa hệ thống',
      desc: 'Xem, thêm hoặc xóa các quy tắc tường lửa (ufw) để bảo mật môi trường của bạn.',
      addTitle: 'Thêm quy tắc mới',
      port: 'Cổng hoặc dải cổng',
      action: 'Hành động',
      comment: 'Ghi chú',
      addBtn: 'Thêm quy tắc',
      status: 'Trạng thái',
      active: 'Đang hoạt động',
      inactive: 'Không hoạt động',
      enable: 'Bật tường lửa',
      disable: 'Tắt tường lửa',
      noRules: 'Không có quy tắc tường lửa nào trên hệ thống này.',
      loading: 'Đang tải quy tắc tường lửa...',
      confirmDel: (p: string) => `Bạn có chắc chắn muốn xóa quy tắc cho "${p}" không?`,
      confirmToggle: (act: string) => `Bạn có chắc chắn muốn ${act === 'enable' ? 'bật' : 'tắt'} tường lửa không?`
    }
  };

  const tr = t[language || 'en'];

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

  const handleDeleteRule = async (item: RuleItem) => {
    if (!confirm(tr.confirmDel(item.port))) return;
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
    const act = active ? 'disable' : 'enable';
    if (!confirm(tr.confirmToggle(act))) return;
    try {
      const token = localStorage.getItem('copanel_token');
      const response = await fetch(`/api/firewall/${act}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || `Failed to ${act} firewall`);
      }
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Error toggling firewall`);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Top Header */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200 shadow-slate-100'
      }`}>
        <div className="space-y-2">
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Shield className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h1>
          <p className={`text-xs md:text-sm leading-relaxed max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleToggleFirewall}
            className={`flex items-center gap-2 text-xs font-bold px-3.5 py-2.5 rounded-xl border transition-all ${
              active
                ? 'bg-red-600/10 hover:bg-red-600/20 border-red-500/20 text-red-400'
                : 'bg-green-600/10 hover:bg-green-600/20 border-green-500/20 text-green-600'
            }`}
          >
            <Icons.Power className="w-3.5 h-3.5" />
            {active ? tr.disable : tr.enable}
          </button>
          <span
            className={`flex items-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl border transition-all ${
              active
                ? 'bg-green-600/10 border-green-500/20 text-green-500 shadow-lg shadow-green-500/5'
                : isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {tr.status}: {active ? tr.active : tr.inactive}
          </span>
          <button
            onClick={fetchFirewall}
            className={`flex items-center p-3 rounded-xl transition-all border shadow-lg ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200/80 shadow-slate-100'
            }`}
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <div className={`border rounded-2xl p-6 h-fit backdrop-blur-md space-y-4 ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
          <h2 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.Plus className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.addTitle}
          </h2>
          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="space-y-1">
              <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {tr.port}
              </label>
              <input
                type="text"
                required
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all ${
                  isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
                placeholder="e.g. 80, 443/tcp, 22"
              />
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {tr.action}
              </label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs font-medium transition-all ${
                  isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <option value="ALLOW">ALLOW</option>
                <option value="DENY">DENY</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {tr.comment}
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs transition-all ${
                  isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
                placeholder="e.g. Web Traffic"
              />
            </div>

            <button
              type="submit"
              disabled={!port}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
            >
              {tr.addBtn}
            </button>
          </form>
        </div>

        {/* Rules Table */}
        <div className={`lg:col-span-2 border rounded-2xl overflow-hidden backdrop-blur-md flex flex-col h-full ${
          isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          {loading && rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 flex-1">
              <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.loading}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className={`border-b text-xs uppercase tracking-wider ${
                    isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'
                  }`}>
                    <th className="p-4 font-bold select-none">{tr.port}</th>
                    <th className="p-4 font-bold select-none">{tr.action}</th>
                    <th className="p-4 font-bold select-none">{tr.comment}</th>
                    <th className="p-4 font-bold text-center w-28 select-none">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-100'}`}>
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={4} className={`p-12 text-center text-xs select-none ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {tr.noRules}
                      </td>
                    </tr>
                  )}
                  {rules.map((item, idx) => (
                    <tr key={idx} className={`transition-all duration-200 ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'}`}>
                      <td className={`p-4 font-mono font-bold text-xs select-all ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {item.port}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${
                            item.action.toUpperCase() === 'ALLOW'
                              ? 'bg-green-600/10 border-green-500/20 text-green-500'
                              : 'bg-red-600/10 border-red-500/20 text-red-500'
                          }`}
                        >
                          {item.action.toUpperCase()}
                        </span>
                      </td>
                      <td className={`p-4 text-xs truncate max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{item.comment || '—'}</td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDeleteRule(item)}
                          disabled={item.port === '22/tcp' || item.port === '22'}
                          className={`p-2 rounded-xl text-red-500 disabled:opacity-40 disabled:cursor-not-allowed border transition-all ${
                            isDark ? 'bg-slate-800/60 hover:bg-slate-700 border-slate-700/60' : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 hover:border-red-200'
                          }`}
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
