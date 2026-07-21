/**
 * DNS Manager — Desktop sidebar shell + Classic full-page (dual UI).
 */
import { useEffect, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';
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

type ConfirmKind = 'zone' | 'record';

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const COPY = {
  en: {
    category: 'Network',
    title: 'DNS Manager',
    subtitle: 'Author DNS zones inside CoPanel. Default backend stores zones locally; switch to BIND when your server runs it.',
    zones: 'Zones',
    addZone: 'Add zone',
    zonePlaceholder: 'example.com',
    noZones: 'No zones yet.',
    selectZone: 'Select a zone on the left to edit its records.',
    records: 'Records',
    name: 'Name',
    value: 'Value',
    ttl: 'TTL',
    addRecord: 'Add record',
    noRecords: 'No records.',
    confirmDeleteZone: 'Delete this zone and all its records?',
    confirmDeleteRecord: 'Delete this DNS record?',
    cancel: 'Cancel',
    delete: 'Delete',
    refresh: 'Refresh',
    loadFailed: 'Failed to load zones',
    createZoneFailed: 'Failed to create zone',
    deleteZoneFailed: 'Failed to delete zone',
    addRecordFailed: 'Failed to add record',
    deleteRecordFailed: 'Failed to delete record',
  },
  vi: {
    category: 'Mạng',
    title: 'Quản lý DNS',
    subtitle: 'Tạo vùng DNS trong CoPanel. Backend mặc định lưu cục bộ; chuyển sang BIND khi máy chủ đang chạy BIND.',
    zones: 'Vùng (Zones)',
    addZone: 'Thêm vùng',
    zonePlaceholder: 'example.com',
    noZones: 'Chưa có vùng nào.',
    selectZone: 'Chọn vùng bên trái để chỉnh sửa bản ghi.',
    records: 'Bản ghi',
    name: 'Tên',
    value: 'Giá trị',
    ttl: 'TTL',
    addRecord: 'Thêm bản ghi',
    noRecords: 'Chưa có bản ghi.',
    confirmDeleteZone: 'Xóa vùng này và tất cả bản ghi?',
    confirmDeleteRecord: 'Xóa bản ghi DNS này?',
    cancel: 'Hủy',
    delete: 'Xóa',
    refresh: 'Làm mới',
    loadFailed: 'Không thể tải danh sách vùng',
    createZoneFailed: 'Không thể tạo vùng',
    deleteZoneFailed: 'Không thể xóa vùng',
    addRecordFailed: 'Không thể thêm bản ghi',
    deleteRecordFailed: 'Không thể xóa bản ghi',
  },
};

export default function DnsManager() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const t = COPY[language === 'vi' ? 'vi' : 'en'];

  const [zones, setZones] = useState<Zone[]>([]);
  const [active, setActive] = useState<Zone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState('');
  const [recordDraft, setRecordDraft] = useState({ type: 'A', name: '@', value: '', ttl: 300, priority: '' });
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputCls = isDark
    ? 'bg-slate-950/40 border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  const refresh = async () => {
    try {
      const list = await api<Zone[]>('/api/dns_manager/zones');
      setZones(list || []);
      if (active) {
        const updated = (list || []).find((z) => z.id === active.id);
        setActive(updated || null);
      }
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.loadFailed;
      setError(msg);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createZone() {
    if (!newZone.trim()) return;
    setBusy(true);
    try {
      await api('/api/dns_manager/zones', { method: 'POST', body: { domain: newZone.trim().toLowerCase() } });
      setNewZone('');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.createZoneFailed);
    } finally {
      setBusy(false);
    }
  }

  async function dropZone(id: string) {
    setBusy(true);
    try {
      await api(`/api/dns_manager/zones/${id}`, { method: 'DELETE' });
      setActive((z) => (z?.id === id ? null : z));
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.deleteZoneFailed);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function addRecord() {
    if (!active) return;
    setBusy(true);
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
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.addRecordFailed);
    } finally {
      setBusy(false);
    }
  }

  async function dropRecord(rid: string) {
    if (!active) return;
    setBusy(true);
    try {
      await api(`/api/dns_manager/zones/${active.id}/records/${rid}`, { method: 'DELETE' });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.deleteRecordFailed);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const confirmMessage =
    confirm?.kind === 'zone' ? t.confirmDeleteZone : confirm?.kind === 'record' ? t.confirmDeleteRecord : '';

  return (
    <ModuleViewport constrained>
      <div className={`flex flex-col h-full min-h-0 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <header
          className={`shrink-0 px-4 py-3 border-b flex items-center justify-between gap-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{t.category}</p>
            <h1 className="text-lg font-semibold truncate">{t.title}</h1>
            <p className={`text-xs mt-0.5 line-clamp-2 ${muted}`}>{t.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={busy}
            className={`shrink-0 p-2 rounded-lg border ${btnSecondary}`}
            title={t.refresh}
          >
            <Icons.RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {error && (
          <div className="shrink-0 mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm text-red-600 dark:text-red-300 flex justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        )}

        <ModuleSidebarLayout
          isDark={isDark}
          mobileTitle={t.title}
          sidebar={
          <aside
            className={`h-full w-52 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}
          >
            <div className="shrink-0 p-3 border-b border-inherit space-y-2">
              <p className={`text-[10px] font-bold uppercase tracking-wider ${muted}`}>{t.zones}</p>
              <div className="flex gap-1.5">
                <input
                  value={newZone}
                  onChange={(e) => setNewZone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createZone()}
                  placeholder={t.zonePlaceholder}
                  className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-xs ${inputCls}`}
                />
                <button
                  type="button"
                  onClick={createZone}
                  disabled={busy || !newZone.trim()}
                  className="shrink-0 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50"
                >
                  <Icons.Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {zones.map((z) => {
                const isActive = active?.id === z.id;
                return (
                  <div key={z.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActive(z)}
                      className={`flex-1 min-w-0 text-left px-3 py-2 text-sm rounded-lg transition ${
                        isActive
                          ? isDark
                            ? 'bg-blue-600/25 text-blue-300 font-semibold'
                            : 'bg-blue-50 text-blue-700 font-semibold'
                          : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                      }`}
                    >
                      <span className="block font-semibold truncate">{z.domain}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">{z.backend}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm({ kind: 'zone', id: z.id })}
                      className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 rounded-lg"
                    >
                      <Icons.Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {zones.length === 0 && <p className={`px-2 py-4 text-xs ${muted}`}>{t.noZones}</p>}
            </nav>
          </aside>
          }
        >
          <main className="flex-1 min-h-0 overflow-y-auto p-4">
            {!active ? (
              <div className={`rounded-2xl border p-8 text-center ${panel}`}>
                <Icons.Network className={`w-10 h-10 mx-auto mb-3 ${muted}`} />
                <p className={`text-sm ${muted}`}>{t.selectZone}</p>
              </div>
            ) : (
              <section className={`rounded-2xl border p-4 space-y-4 ${panel}`}>
                <header className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold">{active.domain}</h2>
                    <p className={`text-xs ${muted}`}>{t.records}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {active.backend}
                  </span>
                </header>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <select
                    value={recordDraft.type}
                    onChange={(e) => setRecordDraft({ ...recordDraft, type: e.target.value })}
                    className={`rounded-xl border px-3 py-2 text-sm ${inputCls}`}
                  >
                    {TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <input
                    value={recordDraft.name}
                    onChange={(e) => setRecordDraft({ ...recordDraft, name: e.target.value })}
                    placeholder={t.name}
                    className={`rounded-xl border px-3 py-2 text-sm ${inputCls}`}
                  />
                  <input
                    value={recordDraft.value}
                    onChange={(e) => setRecordDraft({ ...recordDraft, value: e.target.value })}
                    placeholder={t.value}
                    className={`md:col-span-2 rounded-xl border px-3 py-2 text-sm ${inputCls}`}
                  />
                  <input
                    type="number"
                    value={recordDraft.ttl}
                    onChange={(e) => setRecordDraft({ ...recordDraft, ttl: Number(e.target.value) })}
                    placeholder={t.ttl}
                    className={`rounded-xl border px-3 py-2 text-sm ${inputCls}`}
                  />
                  <button
                    type="button"
                    onClick={addRecord}
                    disabled={busy || !recordDraft.value.trim()}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {t.addRecord}
                  </button>
                </div>

                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {active.records.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2 text-sm gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300 mr-2">
                          {r.type}
                        </span>
                        <span className="font-mono text-slate-700 dark:text-slate-200">{r.name}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="font-mono break-all">{r.value}</span>
                        <span className={`text-[11px] ml-2 ${muted}`}>
                          {t.ttl} {r.ttl}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: 'record', id: r.id })}
                        className="shrink-0 text-slate-400 hover:text-red-500"
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                  {active.records.length === 0 && <li className={`py-2 text-xs ${muted}`}>{t.noRecords}</li>}
                </ul>
              </section>
            )}
          </main>
        </ModuleSidebarLayout>
      </div>

      <WindowModal open={confirm !== null} onClose={() => setConfirm(null)} title={t.delete} maxWidth="sm">
        <p className={`text-sm mb-4 ${muted}`}>{confirmMessage}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
            {t.cancel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm) return;
              if (confirm.kind === 'zone') dropZone(confirm.id);
              else dropRecord(confirm.id);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {t.delete}
          </button>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
