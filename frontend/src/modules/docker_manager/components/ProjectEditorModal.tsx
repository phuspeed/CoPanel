/**
 * Edit project compose YAML and .env after creation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import WindowModal from '../../../core/shell/WindowModal';
import { cn } from '../../../lib/utils';
import * as Icons from 'lucide-react';
import { apiFetch } from '../../../core/authHeaders';

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
}

interface Props {
  open: boolean;
  project: ProjectRef | null;
  onClose: () => void;
  onSaved: () => void;
  isDark: boolean;
  language: 'en' | 'vi';
}

type EditorTab = 'compose' | 'env';

export default function ProjectEditorModal({ open, project, onClose, onSaved, isDark, language }: Props) {
  const [tab, setTab] = useState<EditorTab>('compose');
  const [composeContent, setComposeContent] = useState('');
  const [envContent, setEnvContent] = useState('');
  const [envExists, setEnvExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'Edit Project',
          compose: 'Compose YAML',
          env: 'Environment (.env)',
          envHint: 'Variables referenced by docker-compose. Save writes .env in the project folder.',
          validate: 'Validate',
          save: 'Save',
          saving: 'Saving...',
          validateOk: 'Compose is valid.',
          saved: 'Saved successfully.',
          loadFail: 'Failed to load project files.',
        },
        vi: {
          title: 'Sửa Project',
          compose: 'Compose YAML',
          env: 'Biến môi trường (.env)',
          envHint: 'Biến dùng trong docker-compose. Lưu sẽ ghi tệp .env trong thư mục project.',
          validate: 'Kiểm tra',
          save: 'Lưu',
          saving: 'Đang lưu...',
          validateOk: 'Compose hợp lệ.',
          saved: 'Đã lưu thành công.',
          loadFail: 'Không tải được tệp project.',
        },
      })[language],
    [language],
  );

  const load = useCallback(async () => {
    if (!project?.path) return;
    setLoading(true);
    setMsg(null);
    try {
      const [composeRes, envRes] = await Promise.all([
        apiFetch(`/api/docker_manager/projects/compose?path=${encodeURIComponent(project.path)}`),
        apiFetch(`/api/docker_manager/projects/env?path=${encodeURIComponent(project.path)}`),
      ]);
      if (!composeRes.ok) throw new Error(tr.loadFail);
      const composeData = await composeRes.json();
      setComposeContent(composeData.data?.content || '');
      if (envRes.ok) {
        const envData = await envRes.json();
        setEnvContent(envData.data?.content || '');
        setEnvExists(!!envData.data?.exists);
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : tr.loadFail, ok: false });
    } finally {
      setLoading(false);
    }
  }, [project?.path, tr.loadFail]);

  useEffect(() => {
    if (open && project) {
      setTab('compose');
      load();
    }
  }, [open, project, load]);

  const validateCompose = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch('/api/docker_manager/projects/validate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compose_content: composeContent }),
      });
      const data = await res.json();
      if (data.status === 'success' && data.data?.status === 'success') {
        setMsg({ text: tr.validateOk, ok: true });
      } else {
        setMsg({ text: data.data?.error || data.data?.output || 'Invalid', ok: false });
      }
    } catch {
      setMsg({ text: 'Validation failed', ok: false });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!project?.path) return;
    setSaving(true);
    setMsg(null);
    try {
      if (tab === 'compose') {
        const res = await apiFetch('/api/docker_manager/projects/compose', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: project.path, compose_content: composeContent }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail?.message || data?.detail || 'Save failed');
      } else {
        const res = await apiFetch('/api/docker_manager/projects/env', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: project.path, content: envContent }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail?.message || data?.detail || 'Save failed');
        setEnvExists(true);
      }
      setMsg({ text: tr.saved, ok: true });
      onSaved();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error', ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <WindowModal
      open={open}
      onClose={onClose}
      title={project ? `${tr.title}: ${project.name}` : tr.title}
      maxWidth="2xl"
      className="max-w-2xl"
      closeOnBackdropClick={false}
    >
      <div className="flex flex-col gap-3 p-4 max-h-[75vh]">
        <div className="flex gap-2">
          {(['compose', 'env'] as EditorTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[11px] font-bold border transition',
                tab === t ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
              )}
            >
              {t === 'compose' ? tr.compose : tr.env}
            </button>
          ))}
        </div>

        {msg && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
              msg.ok ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400' : 'border-red-500/30 bg-red-950/20 text-red-400',
            )}
          >
            {msg.ok ? <Icons.CheckCircle2 className="w-4 h-4" /> : <Icons.AlertCircle className="w-4 h-4" />}
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs">
            <Icons.Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : tab === 'compose' ? (
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <div className="flex justify-end">
              <button type="button" onClick={validateCompose} disabled={saving} className="text-[11px] font-bold text-blue-500">
                {tr.validate}
              </button>
            </div>
            <textarea
              value={composeContent}
              onChange={(e) => setComposeContent(e.target.value)}
              className={cn(
                'flex-1 min-h-[16rem] w-full rounded-xl border px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900',
              )}
            />
          </div>
        ) : (
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <p className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
              {tr.envHint}
              {!envExists && ' (.env.example loaded as starting point)'}
            </p>
            <textarea
              value={envContent}
              onChange={(e) => setEnvContent(e.target.value)}
              placeholder="KEY=value"
              className={cn(
                'flex-1 min-h-[16rem] w-full rounded-xl border px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900',
              )}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/30">
          <button
            type="button"
            onClick={onClose}
            className={cn('px-4 py-2 rounded-xl text-xs font-bold', isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600')}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50"
          >
            {saving && <Icons.Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? tr.saving : tr.save}
          </button>
        </div>
      </div>
    </WindowModal>
  );
}
