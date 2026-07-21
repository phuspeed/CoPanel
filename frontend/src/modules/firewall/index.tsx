/**
 * Firewall & Fail2Ban — Desktop sidebar shell + Classic full-page (dual UI).
 */
import { useState, useEffect } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import WindowModal from '../../core/shell/WindowModal';
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

type Tab = 'ufw' | 'fail2ban';
type ConfirmKind = 'deleteRule' | 'toggleUfw' | 'unban';

function normalizeFail2BanJails(data: {
  jails?: unknown;
  banned?: Array<{ ip?: string; jail?: string }>;
}): JailItem[] {
  const bannedFlat = Array.isArray(data.banned) ? data.banned : [];
  const raw = data.jails;

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'banned_ips' in (raw[0] as object)) {
    return (raw as Array<Partial<JailItem> & { name?: string }>).map((j) => {
      const ips = Array.isArray(j.banned_ips) ? j.banned_ips : [];
      return {
        name: String(j.name ?? ''),
        banned_ips: ips,
        total_banned: typeof j.total_banned === 'number' ? j.total_banned : ips.length,
      };
    });
  }

  const names: string[] = Array.isArray(raw)
    ? raw.map((j) => (typeof j === 'string' ? j : String((j as { name?: string })?.name ?? ''))).filter(Boolean)
    : [];

  return names.map((name) => {
    const banned_ips = bannedFlat.filter((b) => b && b.jail === name && b.ip).map((b) => String(b.ip));
    return { name, banned_ips, total_banned: banned_ips.length };
  });
}

export default function FirewallDashboard() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const [activeTab, setActiveTab] = useState<Tab>('ufw');
  const [ufwActive, setUfwActive] = useState(false);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [ufwLoading, setUfwLoading] = useState(true);
  const [port, setPort] = useState('');
  const [action, setAction] = useState('ALLOW');
  const [comment, setComment] = useState('');
  const [f2bInstalled, setF2bInstalled] = useState(false);
  const [f2bActive, setF2bActive] = useState(false);
  const [jails, setJails] = useState<JailItem[]>([]);
  const [f2bLoading, setF2bLoading] = useState(true);
  const [f2bInstalling, setF2bInstalling] = useState(false);
  const [f2bEnabling, setF2bEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'deleteRule'; rule: RuleItem }
    | { kind: 'toggleUfw' }
    | { kind: 'unban'; jail: string; ip: string }
    | null
  >(null);

  const t = {
    en: {
      category: 'Security',
      title: 'System Security',
      subtitle: 'Manage UFW firewall rules and Fail2Ban intrusion prevention.',
      tabUfw: 'UFW Firewall',
      tabF2b: 'Fail2Ban IDS',
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
      noRules: 'No firewall rules configured.',
      loading: 'Loading…',
      confirmDel: (p: string) => `Delete the rule for "${p}"?`,
      confirmToggle: (act: string) => `${act === 'enable' ? 'Enable' : 'Disable'} the firewall?`,
      confirmUnban: (ip: string, jail: string) => `Unban IP ${ip} from jail ${jail}?`,
      f2bNotInstalled: 'Fail2Ban is not installed.',
      f2bInstallBtn: 'Install Fail2Ban',
      f2bEnableBtn: 'Enable Fail2Ban',
      f2bInstalling: 'Installing…',
      f2bEnabling: 'Enabling…',
      f2bInstallDesc: 'Fail2Ban monitors logs and bans malicious IPs. Highly recommended.',
      unban: 'Unban',
      noJails: 'No active jails found.',
      noBans: 'No IPs banned.',
      totalBanned: 'banned',
      cancel: 'Cancel',
      confirm: 'Confirm',
      delete: 'Delete',
    },
    vi: {
      category: 'Bảo mật',
      title: 'Bảo mật Hệ thống',
      subtitle: 'Quản lý UFW và Fail2Ban.',
      tabUfw: 'UFW Firewall',
      tabF2b: 'Fail2Ban IDS',
      addTitle: 'Thêm quy tắc',
      port: 'Cổng hoặc dải',
      action: 'Hành động',
      comment: 'Ghi chú',
      addBtn: 'Thêm',
      status: 'Trạng thái',
      active: 'Hoạt động',
      inactive: 'Không hoạt động',
      enable: 'Bật',
      disable: 'Tắt',
      noRules: 'Chưa có quy tắc tường lửa.',
      loading: 'Đang tải…',
      confirmDel: (p: string) => `Xóa quy tắc "${p}"?`,
      confirmToggle: (act: string) => `${act === 'enable' ? 'Bật' : 'Tắt'} tường lửa?`,
      confirmUnban: (ip: string, jail: string) => `Mở khóa IP ${ip} khỏi jail ${jail}?`,
      f2bNotInstalled: 'Fail2Ban chưa được cài.',
      f2bInstallBtn: 'Cài Fail2Ban',
      f2bEnableBtn: 'Bật Fail2Ban',
      f2bInstalling: 'Đang cài…',
      f2bEnabling: 'Đang bật…',
      f2bInstallDesc: 'Fail2Ban giám sát log và khóa IP độc hại. Nên cài đặt.',
      unban: 'Unban',
      noJails: 'Không có jail nào.',
      noBans: 'Chưa có IP bị khóa.',
      totalBanned: 'bị khóa',
      cancel: 'Hủy',
      confirm: 'Xác nhận',
      delete: 'Xóa',
    },
  };

  const tr = t[language || 'en'];
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const inputCls = isDark
    ? 'bg-slate-950/60 border-slate-800 text-slate-200'
    : 'bg-slate-50 border-slate-200 text-slate-800';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  const authHdr: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    if (activeTab === 'ufw') fetchFirewall();
    else fetchFail2Ban();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchFirewall = async () => {
    setUfwLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/firewall/status', { headers: authHdr });
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
        headers: { 'Content-Type': 'application/json', ...authHdr },
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
      setError(err instanceof Error ? err.message : 'Error adding rule');
    }
  };

  const handleDeleteRule = async (item: RuleItem) => {
    try {
      const response = await fetch('/api/firewall/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({ port: item.port, action: item.action }),
      });
      if (!response.ok) throw new Error('Failed to delete rule');
      fetchFirewall();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting rule');
    } finally {
      setConfirm(null);
    }
  };

  const handleToggleFirewall = async () => {
    const act = ufwActive ? 'disable' : 'enable';
    try {
      const response = await fetch(`/api/firewall/${act}`, { method: 'POST', headers: authHdr });
      if (!response.ok) throw new Error(`Failed to ${act} firewall`);
      fetchFirewall();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error toggling firewall');
    } finally {
      setConfirm(null);
    }
  };

  const fetchFail2Ban = async () => {
    setF2bLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/firewall/fail2ban/status', { headers: authHdr });
      if (!response.ok) throw new Error('Failed to fetch Fail2Ban status');
      const data = await response.json();
      if (data.error_message) setError(data.error_message);
      setF2bInstalled(data.installed || false);
      setF2bActive(data.active || false);
      setJails(normalizeFail2BanJails(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setF2bLoading(false);
    }
  };

  const handleInstallF2B = async () => {
    setF2bInstalling(true);
    try {
      const response = await fetch('/api/firewall/fail2ban/install', { method: 'POST', headers: authHdr });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to install Fail2Ban');
      }
      fetchFail2Ban();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error installing Fail2Ban');
    } finally {
      setF2bInstalling(false);
    }
  };

  const handleEnableF2B = async () => {
    setF2bEnabling(true);
    try {
      const response = await fetch('/api/firewall/fail2ban/enable', { method: 'POST', headers: authHdr });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to enable Fail2Ban');
      }
      fetchFail2Ban();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error enabling Fail2Ban');
    } finally {
      setF2bEnabling(false);
    }
  };

  const handleUnban = async (jail: string, ip: string) => {
    try {
      const response = await fetch('/api/firewall/fail2ban/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({ jail, ip }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to unban IP');
      }
      fetchFail2Ban();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error unbanning IP');
    } finally {
      setConfirm(null);
    }
  };

  const confirmMessage =
    confirm?.kind === 'deleteRule'
      ? tr.confirmDel(confirm.rule.port)
      : confirm?.kind === 'toggleUfw'
        ? tr.confirmToggle(ufwActive ? 'disable' : 'enable')
        : confirm?.kind === 'unban'
          ? tr.confirmUnban(confirm.ip, confirm.jail)
          : '';

  const tabs: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
    { id: 'ufw', label: tr.tabUfw, icon: 'Shield' },
    { id: 'fail2ban', label: tr.tabF2b, icon: 'Lock' },
  ];

  return (
    <ModuleViewport constrained>
      <div className={`flex flex-col h-full min-h-0 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <header
          className={`shrink-0 px-4 py-3 border-b flex items-center justify-between gap-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-indigo-500 font-bold">{tr.category}</p>
            <h1 className="text-lg font-semibold truncate flex items-center gap-2">
              <Icons.ShieldAlert className="w-5 h-5 text-indigo-500 shrink-0" />
              {tr.title}
            </h1>
            <p className={`text-xs mt-0.5 line-clamp-2 ${muted}`}>{tr.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {activeTab === 'ufw' && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirm({ kind: 'toggleUfw' })}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border ${
                    ufwActive
                      ? 'bg-red-600/10 border-red-500/20 text-red-400'
                      : 'bg-green-600/10 border-green-500/20 text-green-600'
                  }`}
                >
                  {ufwActive ? tr.disable : tr.enable}
                </button>
                <span
                  className={`text-xs font-bold px-3 py-2 rounded-xl border flex items-center gap-1.5 ${
                    ufwActive
                      ? 'bg-green-600/10 border-green-500/20 text-green-500'
                      : isDark
                        ? 'bg-slate-800 border-slate-700 text-slate-400'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${ufwActive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                  {ufwActive ? tr.active : tr.inactive}
                </span>
              </>
            )}
            {activeTab === 'fail2ban' && f2bInstalled && (
              <>
                {!f2bActive && (
                  <button
                    type="button"
                    onClick={handleEnableF2B}
                    disabled={f2bEnabling}
                    className="text-xs font-bold px-3 py-2 rounded-xl border bg-indigo-600/10 border-indigo-500/20 text-indigo-600 disabled:opacity-70"
                  >
                    {f2bEnabling ? tr.f2bEnabling : tr.f2bEnableBtn}
                  </button>
                )}
                <span
                  className={`text-xs font-bold px-3 py-2 rounded-xl border flex items-center gap-1.5 ${
                    f2bActive
                      ? 'bg-green-600/10 border-green-500/20 text-green-500'
                      : isDark
                        ? 'bg-slate-800 border-slate-700 text-slate-400'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  Fail2Ban: {f2bActive ? tr.active : tr.inactive}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => (activeTab === 'ufw' ? fetchFirewall() : fetchFail2Ban())}
              className={`p-2 rounded-lg border ${btnSecondary}`}
            >
              <Icons.RefreshCw className={`w-4 h-4 ${(activeTab === 'ufw' ? ufwLoading : f2bLoading) ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {error && (
          <div className="shrink-0 mx-4 mt-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
            <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-auto">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          <aside
            className={`w-44 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}
          >
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {tabs.map((item) => {
                const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition ${
                      activeTab === item.id
                        ? isDark
                          ? 'bg-indigo-600/25 text-indigo-300 font-semibold'
                          : 'bg-indigo-50 text-indigo-700 font-semibold'
                        : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="flex-1 min-h-0 overflow-y-auto p-4">
            {activeTab === 'ufw' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className={`border rounded-2xl p-4 h-fit space-y-4 ${panel}`}>
                  <h2 className="text-sm font-bold flex items-center gap-2">
                    <Icons.Plus className="w-4 h-4 text-blue-500" />
                    {tr.addTitle}
                  </h2>
                  <form onSubmit={handleAddRule} className="space-y-3">
                    <input
                      type="text"
                      required
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="80, 443/tcp, 22"
                      className={`w-full border px-3 py-2 rounded-xl text-xs font-mono ${inputCls}`}
                    />
                    <select value={action} onChange={(e) => setAction(e.target.value)} className={`w-full border px-3 py-2 rounded-xl text-xs ${inputCls}`}>
                      <option value="ALLOW">ALLOW</option>
                      <option value="DENY">DENY</option>
                    </select>
                    <input
                      type="text"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={tr.comment}
                      className={`w-full border px-3 py-2 rounded-xl text-xs ${inputCls}`}
                    />
                    <button type="submit" disabled={!port} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                      {tr.addBtn}
                    </button>
                  </form>
                </div>

                <div className={`lg:col-span-2 border rounded-2xl overflow-hidden ${panel}`}>
                  {ufwLoading && rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48">
                      <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                      <p className={`text-xs ${muted}`}>{tr.loading}</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className={`border-b text-xs uppercase ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
                            <th className="p-3">{tr.port}</th>
                            <th className="p-3">{tr.action}</th>
                            <th className="p-3">{tr.comment}</th>
                            <th className="p-3 w-16" />
                          </tr>
                        </thead>
                        <tbody>
                          {rules.length === 0 && (
                            <tr>
                              <td colSpan={4} className={`p-8 text-center text-xs ${muted}`}>
                                {tr.noRules}
                              </td>
                            </tr>
                          )}
                          {rules.map((item, idx) => (
                            <tr key={idx} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                              <td className="p-3 font-mono text-xs">{item.port}</td>
                              <td className="p-3">
                                <span
                                  className={`px-2 py-0.5 text-xs rounded-full border ${
                                    item.action.toUpperCase() === 'ALLOW'
                                      ? 'bg-green-600/10 border-green-500/20 text-green-500'
                                      : 'bg-red-600/10 border-red-500/20 text-red-500'
                                  }`}
                                >
                                  {item.action.toUpperCase()}
                                </span>
                              </td>
                              <td className={`p-3 text-xs truncate max-w-xs ${muted}`}>{item.comment || '—'}</td>
                              <td className="p-3">
                                <button
                                  type="button"
                                  onClick={() => setConfirm({ kind: 'deleteRule', rule: item })}
                                  disabled={item.port === '22/tcp' || item.port === '22'}
                                  className="p-1.5 text-red-500 disabled:opacity-40"
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
            )}

            {activeTab === 'fail2ban' && (
              <>
                {f2bLoading && jails.length === 0 && !error ? (
                  <div className="flex flex-col items-center justify-center h-48">
                    <Icons.Loader className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                    <p className={`text-xs ${muted}`}>{tr.loading}</p>
                  </div>
                ) : !f2bInstalled ? (
                  <div className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl ${isDark ? 'border-slate-800' : 'border-slate-300'}`}>
                    <Icons.ShieldAlert className="w-10 h-10 text-indigo-500 mb-4" />
                    <h3 className="text-lg font-bold mb-2">{tr.f2bNotInstalled}</h3>
                    <p className={`text-sm mb-6 max-w-md text-center ${muted}`}>{tr.f2bInstallDesc}</p>
                    <button
                      type="button"
                      onClick={handleInstallF2B}
                      disabled={f2bInstalling}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl flex items-center gap-2 disabled:opacity-70"
                    >
                      {f2bInstalling ? <Icons.Loader className="w-5 h-5 animate-spin" /> : <Icons.Download className="w-5 h-5" />}
                      {f2bInstalling ? tr.f2bInstalling : tr.f2bInstallBtn}
                    </button>
                  </div>
                ) : jails.length === 0 ? (
                  <div className={`p-10 text-center border rounded-2xl ${panel} ${muted}`}>{tr.noJails}</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {jails.map((jail) => (
                      <div key={jail.name} className={`border rounded-2xl p-4 ${panel}`}>
                        <div className="flex items-center justify-between mb-3 border-b pb-2 border-inherit">
                          <div className="flex items-center gap-2">
                            <Icons.ShieldAlert className="w-4 h-4 text-indigo-500" />
                            <h3 className="font-bold text-sm uppercase">{jail.name}</h3>
                          </div>
                          <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-full">
                            {jail.total_banned} {tr.totalBanned}
                          </span>
                        </div>
                        {(jail.banned_ips ?? []).length === 0 ? (
                          <p className={`text-xs text-center py-4 italic ${muted}`}>{tr.noBans}</p>
                        ) : (
                          <ul className="space-y-2 max-h-48 overflow-y-auto">
                            {(jail.banned_ips ?? []).map((ip) => (
                              <li
                                key={ip}
                                className={`flex items-center justify-between p-2 rounded-lg border text-xs ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}
                              >
                                <span className="font-mono font-bold text-red-500">{ip}</span>
                                <button
                                  type="button"
                                  onClick={() => setConfirm({ kind: 'unban', jail: jail.name, ip })}
                                  className="px-2 py-1 text-indigo-500 font-bold"
                                >
                                  {tr.unban}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      <WindowModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'deleteRule' ? tr.delete : tr.confirm}
        maxWidth="sm"
      >
        <p className={`text-sm mb-4 ${muted}`}>{confirmMessage}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
            {tr.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm) return;
              if (confirm.kind === 'deleteRule') handleDeleteRule(confirm.rule);
              else if (confirm.kind === 'toggleUfw') handleToggleFirewall();
              else if (confirm.kind === 'unban') handleUnban(confirm.jail, confirm.ip);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white"
          >
            {tr.confirm}
          </button>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
