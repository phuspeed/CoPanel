import { useCallback, useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

type Tab = 'settings' | 'ddns' | 'records' | 'tunnels';

interface Config {
  api_token_set: boolean;
  api_token_hint: string;
  account_id: string;
  account_name: string;
  cloudflared_installed: boolean;
  cloudflared_path: string;
  config_dir: string;
}

interface Zone {
  id: string;
  name: string;
  status: string;
  paused?: boolean;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
}

interface DdnsProfile {
  id: string;
  name: string;
  zone_id: string;
  zone_name: string;
  record_name: string;
  record_type: 'A' | 'AAAA';
  proxied: boolean;
  ttl: number;
  ip_source: 'public' | 'interface' | 'custom_url';
  interface_name: string;
  custom_ip_url: string;
  interval_minutes: number;
  enabled: boolean;
  last_ip?: string;
  last_run?: number;
  last_status?: string;
  last_error?: string;
}

interface Tunnel {
  id: string;
  name: string;
  status: string;
  local_configured?: boolean;
}

interface IngressRule {
  hostname: string;
  service: string;
  path: string;
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'];
const EMPTY_DDNS: Partial<DdnsProfile> = {
  name: '',
  record_name: '@',
  record_type: 'A',
  proxied: false,
  ttl: 1,
  ip_source: 'public',
  interface_name: 'eth0',
  custom_ip_url: '',
  interval_minutes: 5,
  enabled: true,
};

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function statusPill(status?: string) {
  const s = (status || '').toLowerCase();
  if (s === 'updated' || s === 'created') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (s === 'unchanged') return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  if (s === 'error') return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
}

export default function CloudflareDdns() {
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [accountId, setAccountId] = useState('');
  const [verifyInfo, setVerifyInfo] = useState<any>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [recordsZone, setRecordsZone] = useState<Zone | null>(null);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [recordDraft, setRecordDraft] = useState({ type: 'A', name: '@', content: '', ttl: 1, proxied: false });

  const [profiles, setProfiles] = useState<DdnsProfile[]>([]);
  const [ddnsDraft, setDdnsDraft] = useState<Partial<DdnsProfile>>(EMPTY_DDNS);
  const [ddnsZone, setDdnsZone] = useState<Zone | null>(null);

  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [tunnelName, setTunnelName] = useState('');
  const [activeTunnel, setActiveTunnel] = useState<Tunnel | null>(null);
  const [ingress, setIngress] = useState<IngressRule[]>([{ hostname: '', service: 'http://localhost:80', path: '' }]);
  const [tunnelStatus, setTunnelStatus] = useState<any>(null);

  const loadConfig = useCallback(async () => {
    const cfg = await api<Config>('/api/cloudflare_ddns/config');
    setConfig(cfg);
    setAccountId(cfg.account_id || '');
  }, []);

  const loadZones = useCallback(async () => {
    const list = await api<Zone[]>('/api/cloudflare_ddns/zones');
    setZones(list || []);
    return list || [];
  }, []);

  const loadProfiles = useCallback(async () => {
    const list = await api<DdnsProfile[]>('/api/cloudflare_ddns/ddns');
    setProfiles(list || []);
  }, []);

  const loadTunnels = useCallback(async () => {
    const [list, status] = await Promise.all([
      api<Tunnel[]>('/api/cloudflare_ddns/tunnels'),
      api('/api/cloudflare_ddns/tunnels/service/status'),
    ]);
    setTunnels(list || []);
    setTunnelStatus(status);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await loadConfig();
      if (config?.api_token_set || tab !== 'settings') {
        try {
          await loadZones();
        } catch {
          /* token may be missing */
        }
      }
      await loadProfiles();
      if (tab === 'tunnels') await loadTunnels();
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    }
  }, [config?.api_token_set, loadConfig, loadProfiles, loadTunnels, loadZones, tab]);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (tab === 'tunnels' && config?.api_token_set) {
      loadTunnels().catch((e) => setError(e?.message));
    }
  }, [tab, config?.api_token_set, loadTunnels]);

  async function saveToken() {
    setBusy(true);
    try {
      const cfg = await api<Config>('/api/cloudflare_ddns/config', {
        method: 'PUT',
        body: { api_token: tokenInput || undefined, account_id: accountId },
      });
      setConfig(cfg);
      setTokenInput('');
      setError(null);
      const verify = await api('/api/cloudflare_ddns/config/verify');
      setVerifyInfo(verify);
      await loadZones();
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyToken() {
    setBusy(true);
    try {
      const verify = await api('/api/cloudflare_ddns/config/verify');
      setVerifyInfo(verify);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Verify failed');
    } finally {
      setBusy(false);
    }
  }

  async function openRecordsZone(z: Zone) {
    setRecordsZone(z);
    try {
      const list = await api<DnsRecord[]>(`/api/cloudflare_ddns/zones/${z.id}/records`);
      setRecords(list || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load records');
    }
  }

  async function addRecord() {
    if (!recordsZone || !recordDraft.content.trim()) return;
    try {
      await api(`/api/cloudflare_ddns/zones/${recordsZone.id}/records`, {
        method: 'POST',
        body: recordDraft,
      });
      setRecordDraft({ ...recordDraft, content: '' });
      openRecordsZone(recordsZone);
    } catch (err: any) {
      setError(err?.message || 'Add record failed');
    }
  }

  async function deleteRecord(rid: string) {
    if (!recordsZone || !confirm('Delete this record?')) return;
    try {
      await api(`/api/cloudflare_ddns/zones/${recordsZone.id}/records/${rid}`, { method: 'DELETE' });
      openRecordsZone(recordsZone);
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  }

  async function createDdns() {
    if (!ddnsZone || !ddnsDraft.name?.trim()) return;
    try {
      await api('/api/cloudflare_ddns/ddns', {
        method: 'POST',
        body: {
          ...ddnsDraft,
          zone_id: ddnsZone.id,
          zone_name: ddnsZone.name,
        },
      });
      setDdnsDraft(EMPTY_DDNS);
      await loadProfiles();
    } catch (err: any) {
      setError(err?.message || 'Create DDNS failed');
    }
  }

  async function runDdns(id: string) {
    try {
      await api(`/api/cloudflare_ddns/ddns/${id}/run`, { method: 'POST' });
      await loadProfiles();
    } catch (err: any) {
      setError(err?.message || 'Run failed');
    }
  }

  async function toggleDdns(p: DdnsProfile) {
    try {
      await api(`/api/cloudflare_ddns/ddns/${p.id}`, {
        method: 'PUT',
        body: { enabled: !p.enabled },
      });
      await loadProfiles();
    } catch (err: any) {
      setError(err?.message || 'Update failed');
    }
  }

  async function deleteDdns(id: string) {
    if (!confirm('Delete this DDNS profile?')) return;
    try {
      await api(`/api/cloudflare_ddns/ddns/${id}`, { method: 'DELETE' });
      await loadProfiles();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  }

  async function createTunnel() {
    if (!tunnelName.trim()) return;
    try {
      await api('/api/cloudflare_ddns/tunnels', { method: 'POST', body: { name: tunnelName.trim() } });
      setTunnelName('');
      await loadTunnels();
    } catch (err: any) {
      setError(err?.message || 'Create tunnel failed');
    }
  }

  async function openTunnel(t: Tunnel) {
    setActiveTunnel(t);
    try {
      const cfg = await api<any>(`/api/cloudflare_ddns/tunnels/${t.id}/config`);
      setIngress(
        (cfg.ingress?.length ? cfg.ingress : [{ hostname: '', service: 'http://localhost:80', path: '' }]) as IngressRule[],
      );
    } catch {
      setIngress([{ hostname: '', service: 'http://localhost:80', path: '' }]);
    }
  }

  async function saveTunnelConfig() {
    if (!activeTunnel) return;
    try {
      await api(`/api/cloudflare_ddns/tunnels/${activeTunnel.id}/config`, {
        method: 'PUT',
        body: { tunnel_id: activeTunnel.id, tunnel_name: activeTunnel.name, ingress },
      });
      await loadTunnels();
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Save tunnel config failed');
    }
  }

  async function installTunnel() {
    if (!activeTunnel) return;
    try {
      const status = await api(`/api/cloudflare_ddns/tunnels/${activeTunnel.id}/install`, { method: 'POST' });
      setTunnelStatus(status);
    } catch (err: any) {
      setError(err?.message || 'Install service failed');
    }
  }

  async function deleteTunnel(id: string) {
    if (!confirm('Delete this tunnel from Cloudflare?')) return;
    try {
      await api(`/api/cloudflare_ddns/tunnels/${id}`, { method: 'DELETE' });
      if (activeTunnel?.id === id) setActiveTunnel(null);
      await loadTunnels();
    } catch (err: any) {
      setError(err?.message || 'Delete tunnel failed');
    }
  }

  const tabs: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
    { id: 'settings', label: 'API', icon: 'Key' },
    { id: 'ddns', label: 'DDNS', icon: 'RefreshCw' },
    { id: 'records', label: 'DNS Records', icon: 'Globe' },
    { id: 'tunnels', label: 'Tunnel', icon: 'Route' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-widest text-orange-500 font-bold">Network</p>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">Cloudflare DDNS</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-2xl">
          Cập nhật IP động lên Cloudflare DNS, quản lý bản ghi DNS, và cấu hình Cloudflare Tunnel (cloudflared).
          Cần API Token với quyền Zone:DNS:Edit và Account:Cloudflare Tunnel.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = Icons[t.icon] as React.ComponentType<{ className?: string }>;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                tab === t.id
                  ? 'bg-orange-500 text-white shadow'
                  : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'settings' && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4">
          <h2 className="text-sm font-bold">Cloudflare API Token</h2>
          <p className="text-xs text-slate-500">
            Tạo token tại{' '}
            <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="text-orange-500 underline">
              Cloudflare Dashboard
            </a>
            . Quyền: Zone → DNS → Edit, Account → Cloudflare Tunnel → Edit.
          </p>

          {config?.api_token_set && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Token đã lưu: <span className="font-mono">{config.api_token_hint}</span>
              {config.account_name && <> · Account: <strong>{config.account_name}</strong></>}
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-500">
              API Token {config?.api_token_set && '(để trống nếu không đổi)'}
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Cloudflare API Token"
                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Account ID (tùy chọn)
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Auto-detect khi verify"
                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={saveToken}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-bold disabled:opacity-50"
            >
              Lưu & Verify
            </button>
            <button
              onClick={verifyToken}
              disabled={busy || !config?.api_token_set}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold disabled:opacity-50"
            >
              Verify lại
            </button>
          </div>

          {verifyInfo?.valid && (
            <div className="text-xs text-slate-500 space-y-1">
              <p>Token hợp lệ · {verifyInfo.accounts?.length || 0} account(s)</p>
              <ul className="list-disc pl-4">
                {(verifyInfo.accounts || []).map((a: any) => (
                  <li key={a.id} className="font-mono">{a.name} ({a.id})</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === 'ddns' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3">
            <h2 className="text-sm font-bold">Thêm DDNS profile</h2>
            <div className="grid gap-2 md:grid-cols-4">
              <select
                value={ddnsZone?.id || ''}
                onChange={(e) => setDdnsZone(zones.find((z) => z.id === e.target.value) || null)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              >
                <option value="">Chọn zone</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
              <input
                value={ddnsDraft.name || ''}
                onChange={(e) => setDdnsDraft({ ...ddnsDraft, name: e.target.value })}
                placeholder="Tên profile"
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              />
              <input
                value={ddnsDraft.record_name || '@'}
                onChange={(e) => setDdnsDraft({ ...ddnsDraft, record_name: e.target.value })}
                placeholder="Record (@, home, …)"
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              />
              <select
                value={ddnsDraft.record_type || 'A'}
                onChange={(e) => setDdnsDraft({ ...ddnsDraft, record_type: e.target.value as 'A' | 'AAAA' })}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              >
                <option value="A">A</option>
                <option value="AAAA">AAAA</option>
              </select>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <select
                value={ddnsDraft.ip_source || 'public'}
                onChange={(e) => setDdnsDraft({ ...ddnsDraft, ip_source: e.target.value as DdnsProfile['ip_source'] })}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              >
                <option value="public">Public IP</option>
                <option value="interface">Network interface</option>
                <option value="custom_url">Custom URL</option>
              </select>
              {ddnsDraft.ip_source === 'interface' && (
                <input
                  value={ddnsDraft.interface_name || ''}
                  onChange={(e) => setDdnsDraft({ ...ddnsDraft, interface_name: e.target.value })}
                  placeholder="eth0"
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                />
              )}
              {ddnsDraft.ip_source === 'custom_url' && (
                <input
                  value={ddnsDraft.custom_ip_url || ''}
                  onChange={(e) => setDdnsDraft({ ...ddnsDraft, custom_ip_url: e.target.value })}
                  placeholder="https://…"
                  className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                />
              )}
              <input
                type="number"
                min={1}
                max={1440}
                value={ddnsDraft.interval_minutes || 5}
                onChange={(e) => setDdnsDraft({ ...ddnsDraft, interval_minutes: Number(e.target.value) })}
                placeholder="Interval (phút)"
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm px-2">
                <input
                  type="checkbox"
                  checked={!!ddnsDraft.proxied}
                  onChange={(e) => setDdnsDraft({ ...ddnsDraft, proxied: e.target.checked })}
                />
                Proxied (orange cloud)
              </label>
              <button onClick={createDdns} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4">
                Thêm
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5">
            <h2 className="text-sm font-bold mb-3">DDNS profiles ({profiles.length})</h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {profiles.map((p) => (
                <li key={p.id} className="py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{p.name}</span>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${statusPill(p.last_status)}`}>
                        {p.last_status || 'pending'}
                      </span>
                      {!p.enabled && (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">disabled</span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-slate-500 mt-1">
                      {p.record_name}.{p.zone_name} · {p.record_type} · {p.ip_source} · mỗi {p.interval_minutes}p
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      IP: {p.last_ip || '—'} · Lần chạy: {fmtTime(p.last_run)}
                      {p.last_error && <span className="text-red-500 ml-2">{p.last_error}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => runDdns(p.id)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="Chạy ngay">
                      <Icons.Play className="w-4 h-4 text-emerald-500" />
                    </button>
                    <button onClick={() => toggleDdns(p)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title={p.enabled ? 'Tắt' : 'Bật'}>
                      {p.enabled ? <Icons.Pause className="w-4 h-4" /> : <Icons.PlayCircle className="w-4 h-4" />}
                    </button>
                    <button onClick={() => deleteDdns(p.id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
                      <Icons.Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </li>
              ))}
              {profiles.length === 0 && <li className="py-4 text-xs text-slate-500">Chưa có profile DDNS.</li>}
            </ul>
          </section>
        </div>
      )}

      {tab === 'records' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
            <h2 className="text-sm font-bold mb-3">Zones</h2>
            <ul className="space-y-1">
              {zones.map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => openRecordsZone(z)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm ${
                      recordsZone?.id === z.id ? 'bg-orange-500/10 text-orange-600' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    {z.name}
                  </button>
                </li>
              ))}
              {zones.length === 0 && <li className="text-xs text-slate-500">Chưa load zones — cấu hình API token trước.</li>}
            </ul>
          </aside>

          <section className="md:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
            {!recordsZone ? (
              <p className="text-sm text-slate-500">Chọn zone để xem/sửa DNS records.</p>
            ) : (
              <div className="space-y-4">
                <h2 className="text-base font-bold">{recordsZone.name}</h2>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <select
                    value={recordDraft.type}
                    onChange={(e) => setRecordDraft({ ...recordDraft, type: e.target.value })}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                  >
                    {RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input
                    value={recordDraft.name}
                    onChange={(e) => setRecordDraft({ ...recordDraft, name: e.target.value })}
                    placeholder="name"
                    className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                  />
                  <input
                    value={recordDraft.content}
                    onChange={(e) => setRecordDraft({ ...recordDraft, content: e.target.value })}
                    placeholder="content"
                    className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                  />
                  <button onClick={addRecord} className="rounded-xl bg-emerald-600 text-white text-sm font-bold">Add</button>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {records.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2 text-sm gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 mr-2">{r.type}</span>
                        <span className="font-mono">{r.name}</span>
                        <span className="text-slate-400 mx-1">→</span>
                        <span className="font-mono break-all">{r.content}</span>
                        {r.proxied && <span className="ml-2 text-[10px] text-orange-500">proxied</span>}
                      </div>
                      <button onClick={() => deleteRecord(r.id)} className="shrink-0 text-slate-400 hover:text-red-500">
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                  {records.length === 0 && <li className="py-2 text-xs text-slate-500">Không có record.</li>}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'tunnels' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
              <h2 className="text-sm font-bold mb-2">cloudflared</h2>
              <p className="text-xs text-slate-500">
                {tunnelStatus?.installed ? (
                  <>Đã cài: <span className="font-mono">{tunnelStatus.cloudflared_path}</span></>
                ) : (
                  'Chưa cài cloudflared. Cài từ package Cloudflare trước khi dùng Tunnel.'
                )}
              </p>
              {tunnelStatus?.installed && (
                <p className="text-xs mt-1">
                  Service: <span className={tunnelStatus.active ? 'text-emerald-500' : 'text-slate-400'}>{tunnelStatus.message || 'unknown'}</span>
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
              <h2 className="text-sm font-bold mb-3">Tunnels</h2>
              <div className="flex gap-2 mb-3">
                <input
                  value={tunnelName}
                  onChange={(e) => setTunnelName(e.target.value)}
                  placeholder="my-tunnel"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                />
                <button onClick={createTunnel} className="px-3 py-2 rounded-xl bg-orange-500 text-white text-xs font-bold">+</button>
              </div>
              <ul className="space-y-1">
                {tunnels.map((t) => (
                  <li key={t.id} className="flex items-center gap-1">
                    <button
                      onClick={() => openTunnel(t)}
                      className={`flex-1 text-left px-3 py-2 rounded-xl text-sm ${
                        activeTunnel?.id === t.id ? 'bg-orange-500/10 text-orange-600' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="font-semibold">{t.name}</span>
                      <span className="block text-[10px] text-slate-400">{t.status}</span>
                    </button>
                    <button onClick={() => deleteTunnel(t.id)} className="p-2 text-slate-400 hover:text-red-500">
                      <Icons.Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
                {tunnels.length === 0 && <li className="text-xs text-slate-500">Chưa có tunnel.</li>}
              </ul>
            </section>
          </aside>

          <section className="md:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
            {!activeTunnel ? (
              <p className="text-sm text-slate-500">Chọn tunnel để cấu hình ingress rules.</p>
            ) : (
              <div className="space-y-4">
                <header className="flex items-center justify-between">
                  <h2 className="text-base font-bold">{activeTunnel.name}</h2>
                  <span className="text-[10px] font-mono text-slate-400">{activeTunnel.id}</span>
                </header>

                <div className="space-y-2">
                  {ingress.map((rule, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <input
                        value={rule.hostname}
                        onChange={(e) => {
                          const next = [...ingress];
                          next[idx] = { ...rule, hostname: e.target.value };
                          setIngress(next);
                        }}
                        placeholder="hostname (vd: app.example.com)"
                        className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                      />
                      <input
                        value={rule.service}
                        onChange={(e) => {
                          const next = [...ingress];
                          next[idx] = { ...rule, service: e.target.value };
                          setIngress(next);
                        }}
                        placeholder="http://localhost:80"
                        className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono"
                      />
                      <button
                        onClick={() => setIngress(ingress.filter((_, i) => i !== idx))}
                        className="text-red-500 text-sm"
                        disabled={ingress.length <= 1}
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setIngress([...ingress, { hostname: '', service: 'http://localhost:8080', path: '' }])}
                    className="text-xs text-orange-500 font-semibold"
                  >
                    + Thêm rule
                  </button>
                  <button
                    onClick={() => setIngress([...ingress, { hostname: '', service: 'http_status:404', path: '' }])}
                    className="text-xs text-slate-400 ml-3"
                  >
                    + Catch-all 404
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button onClick={saveTunnelConfig} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold">
                    Lưu config.yml
                  </button>
                  <button onClick={installTunnel} className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold">
                    Cài systemd service
                  </button>
                </div>

                <p className="text-xs text-slate-500">
                  Config lưu tại <span className="font-mono">{config?.config_dir}/config.yml</span>.
                  Sau khi lưu, chạy &quot;Cài systemd service&quot; để đăng ký cloudflared (Linux).
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
