import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../../core/platform';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';

interface ConfigState {
  base_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  model: string;
  enabled: boolean;
  max_tool_rounds: number;
}

export default function SettingsDrawer({
  open,
  language,
  onClose,
}: {
  open: boolean;
  language: Lang;
  onClose: () => void;
}) {
  const t = COPY[language];
  const [cfg, setCfg] = useState<ConfigState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setMsg('');
    setErr('');
    setApiKey('');
    (async () => {
      try {
        const data = await api<ConfigState>('/api/coagent/config');
        setCfg(data);
        setBaseUrl(data.base_url || '');
        setModel(data.model || '');
        setEnabled(!!data.enabled);
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    })();
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const body: Record<string, unknown> = {
        base_url: baseUrl,
        model,
        enabled,
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const data = await api<ConfigState>('/api/coagent/config', { method: 'POST', body });
      setCfg(data);
      setApiKey('');
      setMsg(t.saved);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/30 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
            <Icons.Settings className="h-4 w-4" />
            {t.settings}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{t.baseUrl}</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              placeholder="https://api.domain.com/v1"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{t.apiKey}</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              placeholder={cfg?.api_key_masked || 'sk-...'}
            />
            <span className="text-xs text-slate-500">
              {cfg?.api_key_set ? t.apiKeySet : t.apiKeyMissing} — {t.apiKeyHint}
            </span>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{t.model}</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              placeholder="gpt-4o-mini"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t.enabled}
          </label>
          {msg && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{msg}</div>}
          {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
          >
            {t.close}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {saving ? <Icons.Loader2 className="h-4 w-4 animate-spin" /> : <Icons.Save className="h-4 w-4" />}
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
