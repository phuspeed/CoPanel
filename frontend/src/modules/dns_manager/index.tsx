/**
 * Minimal DNS Manager UI - list zones, view records, add/delete records.
 * Matches the Synology-like design system: rounded cards, soft shadows,
 * status pills.
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

interface Record {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number | null;
}

interface Zone {
  id: string;
  domain: string;
  backend: string;
  records: Record[];
  updated_at: number;
}

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

export default function DnsManager() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [active, setActive] = useState<Zone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState('');
  const [recordDraft, setRecordDraft] = useState({ type: 'A', name: '@', value: '', ttl: 300, priority: '' });

  const refresh = async () => {
    try {
      const list = await api<Zone[]>('/api/dns_manager/zones');
      setZones(list || []);
      if (active) {
        const updated = (list || []).find((z) => z.id === active.id);
        setActive(updated || null);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load zones');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  async function createZone() {
    if (!newZone.trim()) return;
    try {
      await api('/api/dns_manager/zones', { method: 'POST', body: { domain: newZone.trim().toLowerCase() } });
      setNewZone('');
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to create zone');
    }
  }

  async function dropZone(id: string) {
    if (!confirm('Delete this zone?')) return;
    try {
      await api(`/api/dns_manager/zones/${id}`, { method: 'DELETE' });
      setActive((z) => (z?.id === id ? null : z));
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete zone');
    }
  }

  async function addRecord() {
    if (!active) return;
    try {
      await api(`/api/dns_manager/zones/${active.id}/records`, {
        method: 'POST',
        body: {
          type: recordDraft.type,
          name: recordDraft.name || '@',
          value: recordDraft.value,
          ttl: Number(recordDraft.ttl) || 300,
          priority: recordDraft.priority ? Number(recordDraft.priority) : undefined,
        },
      });
      setRecordDraft({ ...recordDraft, value: '' });
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to add record');
    }
  }

  async function dropRecord(rid: string) {
    if (!active) return;
    if (!confirm('Delete this record?')) return;
    try {
      await api(`/api/dns_manager/zones/${active.id}/records/${rid}`, { method: 'DELETE' });
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete record');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">Network</p>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">DNS Manager</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-xl">
          Author DNS zones inside CoPanel. Default backend stores zones in the panel; switch to BIND when
          your server is running it.
        </p>
      </header>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
          <h2 className="text-sm font-bold mb-3">Zones</h2>
          <div className="flex items-center gap-2 mb-3">
            <input
              value={newZone}
              onChange={(e) => setNewZone(e.target.value)}
              placeholder="example.com"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
            <button onClick={createZone} className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
              Add
            </button>
          </div>
          <ul className="space-y-1.5">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setActive(z)}
                  className={`flex-1 text-left px-3 py-2 rounded-xl text-sm ${
                    active?.id === z.id ? 'bg-blue-500/10 text-blue-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <span className="font-semibold">{z.domain}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">{z.backend}</span>
                </button>
                <button onClick={() => dropZone(z.id)} className="text-slate-400 hover:text-red-500">
                  <Icons.Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
            {zones.length === 0 && <li className="text-xs text-slate-500">No zones yet.</li>}
          </ul>
        </aside>

        <section className="md:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
          {!active ? (
            <p className="text-sm text-slate-500">Select a zone on the left to edit its records.</p>
          ) : (
            <div className="space-y-4">
              <header className="flex items-center justify-between">
                <h2 className="text-base font-bold">{active.domain}</h2>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {active.backend}
                </span>
              </header>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <select
                  value={recordDraft.type}
                  onChange={(e) => setRecordDraft({ ...recordDraft, type: e.target.value })}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                >
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <input
                  value={recordDraft.name}
                  onChange={(e) => setRecordDraft({ ...recordDraft, name: e.target.value })}
                  placeholder="name"
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                />
                <input
                  value={recordDraft.value}
                  onChange={(e) => setRecordDraft({ ...recordDraft, value: e.target.value })}
                  placeholder="value"
                  className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  value={recordDraft.ttl}
                  onChange={(e) => setRecordDraft({ ...recordDraft, ttl: Number(e.target.value) })}
                  placeholder="TTL"
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
                />
                <button onClick={addRecord} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
                  Add
                </button>
              </div>

              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {active.records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300 mr-2">
                        {r.type}
                      </span>
                      <span className="font-mono text-slate-700 dark:text-slate-200">{r.name}</span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="font-mono">{r.value}</span>
                      <span className="text-[11px] text-slate-400 ml-2">TTL {r.ttl}</span>
                    </div>
                    <button onClick={() => dropRecord(r.id)} className="text-slate-400 hover:text-red-500">
                      <Icons.Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
                {active.records.length === 0 && <li className="py-2 text-xs text-slate-500">No records.</li>}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
