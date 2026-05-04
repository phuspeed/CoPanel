/**
 * Firewall & Fail2Ban - Dashboard Component
 * Premium security management dashboard.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface RuleItem {
  port: string;
  action: string;
  comment: string;
}

interface JailItem {
  name: string;
  banned_ips: string[];
  total_banned: number;
}

export default function FirewallDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  // Tabs
  const [activeTab, setActiveTab] = useState<'ufw' | 'fail2ban'>('ufw');

  // --- UFW State ---
  const [ufwActive, setUfwActive] = useState<boolean>(false);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [ufwLoading, setUfwLoading] = useState<boolean>(true);
  
  // New rule form
  const [port, setPort] = useState<string>('');
  const [action, setAction] = useState<string>('ALLOW');
  const [comment, setComment] = useState<string>('');

  // --- Fail2Ban State ---
  const [f2bInstalled, setF2bInstalled] = useState<boolean>(false);
  const [f2bActive, setF2bActive] = useState<boolean>(false);
  const [jails, setJails] = useState<JailItem[]>([]);
  const [f2bLoading, setF2bLoading] = useState<boolean>(true);
  const [f2bInstalling, setF2bInstalling] = useState<boolean>(false);

  // Common Error
  const [error, setError] = useState<string | null>(null);

  const t = {
    en: {
      title: 'System Security',
      desc: 'Manage UFW Firewall rules and Fail2Ban Intrusion Prevention System to secure your server.',
      addTitle: 'Add Firewall Rule',
      port: 'Port or Range',
      action: 'Action',
      comment: 'Comment',
      addBtn: 'Add Rule',
      status: 'Status',
      active: 'Active',
      inactive: 'Inactive',
      enable: 'Enable',
      disable: 'Disable',
      noRules: 'No firewall rules configured on this system.',
      loading: 'Loading data...',
      confirmDel: (p: string) => `Are you sure you want to delete the rule for "${p}"?`,
      confirmToggle: (act: string) => `Are you sure you want to ${act} the firewall?`,
      f2bNotInstalled: 'Fail2Ban is not installed on this server.',
      f2bInstallBtn: 'Install Fail2Ban Now',
      f2bInstalling: 'Installing Fail2Ban...',
      unban: 'Unban',
      noJails: 'No active jails found.',
      noBans: 'No IPs banned currently.',
      totalBanned: 'Total Banned'
    },
    vi: {
      title: 'Bảo mật Hệ thống',
      desc: 'Quản lý quy tắc Tường lửa UFW và Hệ thống chống xâm nhập Fail2Ban để bảo vệ máy chủ của bạn.',
      addTitle: 'Thêm quy tắc mới',
      port: 'Cổng hoặc dải cổng',
      action: 'Hành động',
      comment: 'Ghi chú',
      addBtn: 'Thêm quy tắc',
      status: 'Trạng thái',
      active: 'Đang hoạt động',
      inactive: 'Không hoạt động',
      enable: 'Bật',
      disable: 'Tắt',
      noRules: 'Không có quy tắc tường lửa nào trên hệ thống này.',
      loading: 'Đang tải dữ liệu...',
      confirmDel: (p: string) => `Bạn có chắc chắn muốn xóa quy tắc cho "${p}" không?`,
      confirmToggle: (act: string) => `Bạn có chắc chắn muốn ${act === 'enable' ? 'bật' : 'tắt'} tường lửa không?`,
      f2bNotInstalled: 'Fail2Ban chưa được cài đặt trên máy chủ này.',
      f2bInstallBtn: 'Cài đặt Fail2Ban Ngay',
      f2bInstalling: 'Đang cài đặt Fail2Ban...',
      unban: 'Mở khóa (Unban)',
      noJails: 'Không tìm thấy cấu hình Jail nào đang chạy.',
      noBans: 'Chưa có IP nào bị khóa.',
      totalBanned: 'Tổng số IP bị khóa'
    }
  };

  const tr = t[language || 'en'];

  useEffect(() => {
    if (activeTab === 'ufw') {
      fetchFirewall();
    } else {
      fetchFail2Ban();
    }
  }, [activeTab]);

  // ==========================================
  // UFW LOGIC
  // ==========================================
  const fetchFirewall = async () => {
    setUfwLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/firewall/status', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Failed to fetch firewall status');
      const data = await response.json();
      if (data.error_message) setError(data.error_message);
      setUfwActive(data.active || false);
      setRules(data.rules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUfwLoading(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!port) return;
    try {
      const response = await fetch('/api/firewall/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
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
      const response = await fetch('/api/firewall/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ port: item.port, action: item.action }),
      });
      if (!response.ok) throw new Error('Failed to delete rule');
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting rule');
    }
  };

  const handleToggleFirewall = async () => {
    const act = ufwActive ? 'disable' : 'enable';
    if (!confirm(tr.confirmToggle(act))) return;
    try {
      const response = await fetch(`/api/firewall/${act}`, { method: 'POST', headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Failed to ${act} firewall`);
      fetchFirewall();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Error toggling firewall`);
    }
  };

  // ==========================================
  // FAIL2BAN LOGIC
  // ==========================================
  const fetchFail2Ban = async () => {
    setF2bLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/firewall/fail2ban/status', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Failed to fetch Fail2Ban status');
      const data = await response.json();
      if (data.error_message) setError(data.error_message);
      setF2bInstalled(data.installed || false);
      setF2bActive(data.active || false);
      setJails(data.jails || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setF2bLoading(false);
    }
  };

  const handleInstallF2B = async () => {
    setF2bInstalling(true);
    try {
      const response = await fetch('/api/firewall/fail2ban/install', { method: 'POST', headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to install Fail2Ban');
      }
      fetchFail2Ban();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error installing Fail2Ban');
    } finally {
      setF2bInstalling(false);
    }
  };

  const handleUnban = async (jail: string, ip: string) => {
    if (!confirm(`Unban IP ${ip} from jail ${jail}?`)) return;
    try {
      const response = await fetch('/api/firewall/fail2ban/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jail, ip }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to unban IP');
      }
      fetchFail2Ban();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error unbanning IP');
    }
  };

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Top Header */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-indigo-900/30 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-indigo-50/50 via-white to-slate-50 border-slate-200 shadow-slate-100'
      }`}>
        <div className="space-y-2">
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent'
          }`}>
            <Icons.ShieldAlert className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.title}
          </h1>
          <p className={`text-xs md:text-sm leading-relaxed max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        
        {/* Custom Controls inside Header based on active tab */}
        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'ufw' && (
            <>
              <button
                onClick={handleToggleFirewall}
                className={`flex items-center gap-2 text-xs font-bold px-3.5 py-2.5 rounded-xl border transition-all ${
                  ufwActive ? 'bg-red-600/10 hover:bg-red-600/20 border-red-500/20 text-red-400' : 'bg-green-600/10 hover:bg-green-600/20 border-green-500/20 text-green-600'
                }`}
              >
                <Icons.Power className="w-3.5 h-3.5" />
                {ufwActive ? tr.disable : tr.enable}
              </button>
              <span className={`flex items-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl border transition-all ${
                ufwActive ? 'bg-green-600/10 border-green-500/20 text-green-500 shadow-lg shadow-green-500/5' : isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}>
                <span className={`w-2 h-2 rounded-full ${ufwActive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                {tr.status}: {ufwActive ? tr.active : tr.inactive}
              </span>
            </>
          )}

          {activeTab === 'fail2ban' && f2bInstalled && (
            <span className={`flex items-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl border transition-all ${
              f2bActive ? 'bg-green-600/10 border-green-500/20 text-green-500 shadow-lg shadow-green-500/5' : isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}>
              <span className={`w-2 h-2 rounded-full ${f2bActive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              Fail2Ban: {f2bActive ? tr.active : tr.inactive}
            </span>
          )}

          <button
            onClick={activeTab === 'ufw' ? fetchFirewall : fetchFail2Ban}
            className={`flex items-center p-3 rounded-xl transition-all border shadow-lg ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200/80 shadow-slate-100'
            }`}
            title="Refresh"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${(activeTab === 'ufw' ? ufwLoading : f2bLoading) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className={`flex items-center gap-2 border-b p-1 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        <button
          onClick={() => setActiveTab('ufw')}
          className={`flex items-center gap-2 px-6 py-3 rounded-t-xl text-sm font-bold transition-all ${
            activeTab === 'ufw'
              ? isDark ? 'bg-slate-800 text-blue-400 border-t border-x border-slate-700' : 'bg-white text-blue-600 border-t border-x border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]'
              : isDark ? 'text-slate-400 hover:bg-slate-900' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Icons.Shield className="w-4 h-4" /> UFW Firewall
        </button>
        <button
          onClick={() => setActiveTab('fail2ban')}
          className={`flex items-center gap-2 px-6 py-3 rounded-t-xl text-sm font-bold transition-all ${
            activeTab === 'fail2ban'
              ? isDark ? 'bg-slate-800 text-indigo-400 border-t border-x border-slate-700' : 'bg-white text-indigo-600 border-t border-x border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]'
              : isDark ? 'text-slate-400 hover:bg-slate-900' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Icons.Lock className="w-4 h-4" /> Fail2Ban IDS
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-amber-950/20 border border-amber-500/30 p-4 rounded-xl text-amber-300 text-xs flex items-center gap-2 max-w-2xl backdrop-blur-md">
          <Icons.AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 animate-pulse" />
          <span>{error}</span>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB: UFW FIREWALL */}
      {/* ========================================== */}
      {activeTab === 'ufw' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 animate-fade-in">
          {/* Add Rule Form */}
          <div className={`border rounded-2xl p-6 h-fit backdrop-blur-md space-y-4 ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
            <h2 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              <Icons.Plus className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              {tr.addTitle}
            </h2>
            <form onSubmit={handleAddRule} className="space-y-4">
              <div className="space-y-1">
                <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.port}</label>
                <input type="text" required value={port} onChange={(e) => setPort(e.target.value)} className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all ${isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`} placeholder="e.g. 80, 443/tcp, 22" />
              </div>
              <div className="space-y-1">
                <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.action}</label>
                <select value={action} onChange={(e) => setAction(e.target.value)} className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs font-medium transition-all ${isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                  <option value="ALLOW">ALLOW</option>
                  <option value="DENY">DENY</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={`text-[10px] font-bold tracking-wider uppercase block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.comment}</label>
                <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} className={`w-full border focus:border-blue-500 px-3.5 py-2 rounded-xl outline-none text-xs transition-all ${isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`} placeholder="e.g. Web Traffic" />
              </div>
              <button type="submit" disabled={!port} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20">
                {tr.addBtn}
              </button>
            </form>
          </div>

          {/* Rules Table */}
          <div className={`lg:col-span-2 border rounded-2xl overflow-hidden backdrop-blur-md flex flex-col h-full ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
            {ufwLoading && rules.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 flex-1">
                <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.loading}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse select-none">
                  <thead>
                    <tr className={`border-b text-xs uppercase tracking-wider ${isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                      <th className="p-4 font-bold select-none">{tr.port}</th>
                      <th className="p-4 font-bold select-none">{tr.action}</th>
                      <th className="p-4 font-bold select-none">{tr.comment}</th>
                      <th className="p-4 font-bold text-center w-28 select-none">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-100'}`}>
                    {rules.length === 0 && (
                      <tr><td colSpan={4} className={`p-12 text-center text-xs select-none ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.noRules}</td></tr>
                    )}
                    {rules.map((item, idx) => (
                      <tr key={idx} className={`transition-all duration-200 ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'}`}>
                        <td className={`p-4 font-mono font-bold text-xs select-all ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{item.port}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${item.action.toUpperCase() === 'ALLOW' ? 'bg-green-600/10 border-green-500/20 text-green-500' : 'bg-red-600/10 border-red-500/20 text-red-500'}`}>
                            {item.action.toUpperCase()}
                          </span>
                        </td>
                        <td className={`p-4 text-xs truncate max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{item.comment || '—'}</td>
                        <td className="p-4 text-center">
                          <button onClick={() => handleDeleteRule(item)} disabled={item.port === '22/tcp' || item.port === '22'} className={`p-2 rounded-xl text-red-500 disabled:opacity-40 disabled:cursor-not-allowed border transition-all ${isDark ? 'bg-slate-800/60 hover:bg-slate-700 border-slate-700/60' : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 hover:border-red-200'}`} title="Delete Rule">
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
      )}

      {/* ========================================== */}
      {/* TAB: FAIL2BAN */}
      {/* ========================================== */}
      {activeTab === 'fail2ban' && (
        <div className="animate-fade-in">
          {f2bLoading && jails.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Icons.Loader className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.loading}</p>
            </div>
          ) : !f2bInstalled ? (
            <div className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-300 bg-slate-50'}`}>
              <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6">
                <Icons.ShieldAlert className="w-10 h-10 text-indigo-500" />
              </div>
              <h3 className={`text-lg font-bold mb-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{tr.f2bNotInstalled}</h3>
              <p className={`text-sm mb-6 max-w-md text-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Fail2Ban monitors log files and bans IPs that show malicious signs (e.g. too many password failures). It is highly recommended to install it.</p>
              <button onClick={handleInstallF2B} disabled={f2bInstalling} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition disabled:opacity-70 disabled:cursor-wait">
                {f2bInstalling ? <Icons.Loader className="w-5 h-5 animate-spin" /> : <Icons.Download className="w-5 h-5" />}
                {f2bInstalling ? tr.f2bInstalling : tr.f2bInstallBtn}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {jails.length === 0 ? (
                <div className={`p-10 text-center border rounded-2xl ${isDark ? 'border-slate-800 bg-slate-900/30 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  {tr.noJails}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {jails.map(jail => (
                    <div key={jail.name} className={`flex flex-col border rounded-2xl p-5 backdrop-blur-md shadow-sm transition-all hover:shadow-md ${isDark ? 'bg-slate-900/40 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex items-center justify-between mb-4 border-b pb-3 border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <Icons.ShieldAlert className="w-5 h-5 text-indigo-500" />
                          <h3 className={`font-bold text-sm uppercase tracking-wide ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{jail.name}</h3>
                        </div>
                        <span className="px-2.5 py-1 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-full border border-red-500/20">
                          {jail.total_banned} {tr.totalBanned}
                        </span>
                      </div>
                      
                      <div className="flex-1">
                        {jail.banned_ips.length === 0 ? (
                          <div className={`text-xs text-center py-6 italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                            {tr.noBans}
                          </div>
                        ) : (
                          <ul className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                            {jail.banned_ips.map(ip => (
                              <li key={ip} className={`flex items-center justify-between p-2 rounded-lg border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                                <span className={`font-mono text-xs font-bold ${isDark ? 'text-red-400' : 'text-red-600'}`}>{ip}</span>
                                <button onClick={() => handleUnban(jail.name, ip)} className="px-3 py-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold rounded transition">
                                  {tr.unban}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
