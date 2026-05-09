/**
 * Rsync Manager — ZERO-CLI oriented: compatibility check + rsync over SSH.
 * Optional AppStore module (not core). SQL/Docker orchestration is out of scope for v1.
 */
import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

type Lang = 'en' | 'vi';

type CompItem = {
  id: string;
  severity: 'ok' | 'warn' | 'block';
  message: string;
  source?: string;
  target?: string;
};

function authHeader(): Record<string, string> {
  const t = localStorage.getItem('copanel_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string }; detail?: string }).error?.message ||
      (body as { detail?: string }).detail ||
      res.statusText;
    throw new Error(msg);
  }
  const env = body as { status?: string; data?: T; error?: { message?: string } };
  if (env.status === 'error' && env.error?.message) throw new Error(env.error.message);
  if (env.data === undefined) throw new Error('Invalid API response');
  return env.data as T;
}

const TEXT: Record<
  Lang,
  {
    title: string;
    subtitle: string;
    sshTitle: string;
    host: string;
    port: string;
    user: string;
    identity: string;
    identityHint: string;
    check: string;
    checking: string;
    pathsTitle: string;
    localPath: string;
    remotePath: string;
    excludes: string;
    excludesHint: string;
    presetCopanel: string;
    estimateGb: string;
    estimateHint: string;
    dryRun: string;
    runSync: string;
    running: string;
    resultTitle: string;
    noResult: string;
    tableItem: string;
    source: string;
    target: string;
    canProceed: string;
    cannotProceed: string;
    warnDocker: string;
    sqlNote: string;
  }
> = {
  en: {
    title: 'Rsync Manager',
    subtitle:
      'Verify source vs target Linux compatibility, then sync directories over SSH with rsync. CoPanel + web file migration helper — rebuild Docker on the new VPS yourself. Dump/restore SQL separately.',
    sshTitle: 'Target SSH',
    host: 'Host / IP',
    port: 'Port',
    user: 'User',
    identity: 'Identity file (on this server)',
    identityHint: 'Optional. Path to private key the panel user can read, e.g. /root/.ssh/id_rsa',
    check: 'Run compatibility check',
    checking: 'Checking…',
    pathsTitle: 'Paths & sync',
    localPath: 'Local source path',
    remotePath: 'Remote absolute path',
    excludes: 'Exclude patterns (one per line)',
    excludesHint: 'rsync --exclude patterns, relative to source',
    presetCopanel: 'Apply CoPanel preset',
    estimateGb: 'Estimated size (GB, optional)',
    estimateHint: 'Used to compare free space on target root (rough check)',
    dryRun: 'Dry run',
    runSync: 'Run real sync',
    running: 'Running rsync…',
    resultTitle: 'Last output (tail)',
    noResult: 'No output yet.',
    tableItem: 'Check',
    source: 'Source',
    target: 'Target',
    canProceed: 'Ready to sync (no blocking issues)',
    cannotProceed: 'Blocked — fix items in red before syncing',
    warnDocker: 'Docker containers are not migrated; rebuild stacks on the new server.',
    sqlNote: 'Databases: use Database Manager or mysqldump on the old server and restore on the new one — not automated here.',
  },
  vi: {
    title: 'Rsync Manager',
    subtitle:
      'Kiểm tra tương thích hai máy Linux, sau đó đồng bộ thư mục qua SSH (rsync). Hỗ trợ chuyển file CoPanel/web — Docker cần dựng lại trên VPS mới. SQL cần dump/restore riêng.',
    sshTitle: 'SSH máy đích',
    host: 'Host / IP',
    port: 'Cổng',
    user: 'User',
    identity: 'File khóa (trên máy panel)',
    identityHint: 'Tùy chọn. Đường dẫn private key user panel đọc được, vd: /root/.ssh/id_rsa',
    check: 'Kiểm tra tương thích',
    checking: 'Đang kiểm tra…',
    pathsTitle: 'Đường dẫn & đồng bộ',
    localPath: 'Đường dẫn nguồn (local)',
    remotePath: 'Đường dẫn đích (tuyệt đối trên máy mới)',
    excludes: 'Mẫu loại trừ (mỗi dòng một mẫu)',
    excludesHint: 'Tham số --exclude của rsync, tương đối thư mục nguồn',
    presetCopanel: 'Áp preset CoPanel',
    estimateGb: 'Dung lượng ước tính (GB, tùy chọn)',
    estimateHint: 'So sánh sơ bộ với dung lượng trống ở / trên máy đích',
    dryRun: 'Chạy thử (dry-run)',
    runSync: 'Chạy đồng bộ thật',
    running: 'Đang chạy rsync…',
    resultTitle: 'Kết quả gần nhất (cuối log)',
    noResult: 'Chưa có kết quả.',
    tableItem: 'Mục',
    source: 'Nguồn',
    target: 'Đích',
    canProceed: 'Có thể đồng bộ (không có lỗi chặn)',
    cannotProceed: 'Bị chặn — sửa các mục đỏ trước khi sync',
    warnDocker: 'Docker không được chuyển bởi module này; hãy dựng lại stack trên máy mới.',
    sqlNote: 'Cơ sở dữ liệu: dùng Database Manager hoặc mysqldump trên máy cũ và import trên máy mới — chưa tự động ở đây.',
  },
};

export default function RsyncManager() {
  const ctx = useOutletContext<{ language?: string; theme?: string } | null>();
  const lang: Lang = ctx?.language === 'vi' ? 'vi' : 'en';
  const isDark = ctx?.theme === 'dark';
  const tr = TEXT[lang];

  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('root');
  const [identityFile, setIdentityFile] = useState('');

  const [localPath, setLocalPath] = useState('/opt/copanel');
  const [remotePath, setRemotePath] = useState('/opt/copanel');
  const [excludes, setExcludes] = useState('');
  const [estimateGb, setEstimateGb] = useState('');

  const [items, setItems] = useState<CompItem[] | null>(null);
  const [canProceed, setCanProceed] = useState<boolean | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shell = isDark
    ? 'border-slate-800 bg-slate-900/60 text-slate-100'
    : 'border-slate-200 bg-white text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';

  const loadPreset = useCallback(async () => {
    try {
      const data = await apiJson<{ copanel: { excludes: string[] } }>('/api/rsync_manager/presets');
      setExcludes((data.copanel?.excludes || []).join('\n'));
    } catch {
      setExcludes(['venv/', '**/__pycache__/', '*.pyc', '.git/', 'frontend/node_modules/'].join('\n'));
    }
  }, []);

  useEffect(() => {
    void loadPreset();
  }, [loadPreset]);

  const runCompatibility = async () => {
    setError(null);
    setCheckLoading(true);
    setItems(null);
    setCanProceed(null);
    try {
      const est = parseFloat(estimateGb.replace(',', '.')) || 0;
      const estimated_bytes = Math.max(0, Math.floor(est * 1024 ** 3));
      const data = await apiJson<{ items: CompItem[]; can_proceed: boolean }>('/api/rsync_manager/compatibility', {
        method: 'POST',
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10) || 22,
          user: user.trim(),
          identity_file: identityFile.trim() || null,
          estimated_bytes,
        }),
      });
      setItems(data.items || []);
      setCanProceed(!!data.can_proceed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setCheckLoading(false);
    }
  };

  const runSync = async () => {
    setError(null);
    setSyncLoading(true);
    setOutput('');
    try {
      const data = await apiJson<{ ok: boolean; exit_code: number; stdout_tail: string; stderr_tail: string }>(
        '/api/rsync_manager/sync',
        {
          method: 'POST',
          body: JSON.stringify({
            host: host.trim(),
            port: parseInt(port, 10) || 22,
            user: user.trim(),
            identity_file: identityFile.trim() || null,
            local_path: localPath.trim(),
            remote_path: remotePath.trim(),
            excludes: excludes.split('\n').map((l) => l.trim()).filter(Boolean),
            dry_run: dryRun,
          }),
        }
      );
      const blob = [data.stdout_tail, data.stderr_tail].filter(Boolean).join('\n---\n');
      setOutput(blob || `(exit ${data.exit_code})`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSyncLoading(false);
    }
  };

  const sevStyle = (s: string) => {
    if (s === 'block') return isDark ? 'text-red-400' : 'text-red-600';
    if (s === 'warn') return isDark ? 'text-amber-400' : 'text-amber-700';
    return isDark ? 'text-emerald-400' : 'text-emerald-700';
  };

  return (
    <div className={`p-4 md:p-8 max-w-5xl mx-auto space-y-6 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-extrabold flex items-center gap-2">
          <Icons.RefreshCw className={`w-8 h-8 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} />
          {tr.title}
        </h1>
        <p className={`text-sm max-w-3xl leading-relaxed ${muted}`}>{tr.subtitle}</p>
        <p className={`text-xs ${muted}`}>{tr.warnDocker}</p>
        <p className={`text-xs ${muted}`}>{tr.sqlNote}</p>
      </header>

      {error && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            isDark ? 'border-red-800 bg-red-950/40 text-red-300' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {error}
        </div>
      )}

      <section className={`rounded-2xl border p-4 md:p-6 space-y-4 ${shell}`}>
        <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          <Icons.Server className="w-4 h-4" />
          {tr.sshTitle}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className={`text-xs font-bold ${muted}`}>{tr.host}</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
                isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}
              placeholder="203.0.113.10"
            />
          </label>
          <label className="space-y-1">
            <span className={`text-xs font-bold ${muted}`}>{tr.port}</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
                isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className={`text-xs font-bold ${muted}`}>{tr.user}</span>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
                isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className={`text-xs font-bold ${muted}`}>{tr.identity}</span>
            <input
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
                isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}
              placeholder="/root/.ssh/id_rsa"
            />
            <span className={`text-[10px] ${muted}`}>{tr.identityHint}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runCompatibility()}
            disabled={checkLoading || !host.trim()}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${
              isDark ? 'bg-sky-600 hover:bg-sky-500' : 'bg-sky-600 hover:bg-sky-500'
            }`}
          >
            {checkLoading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.ShieldCheck className="w-4 h-4" />}
            {checkLoading ? tr.checking : tr.check}
          </button>
          {canProceed !== null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                canProceed
                  ? isDark
                    ? 'bg-emerald-950/50 text-emerald-300'
                    : 'bg-emerald-100 text-emerald-800'
                  : isDark
                    ? 'bg-red-950/50 text-red-300'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              {canProceed ? <Icons.Check className="w-3.5 h-3.5" /> : <Icons.X className="w-3.5 h-3.5" />}
              {canProceed ? tr.canProceed : tr.cannotProceed}
            </span>
          )}
        </div>

        {items && items.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-700/30">
            <table className="w-full text-xs">
              <thead>
                <tr className={isDark ? 'bg-slate-950/80' : 'bg-slate-100'}>
                  <th className="text-left p-2">{tr.tableItem}</th>
                  <th className="text-left p-2">{tr.source}</th>
                  <th className="text-left p-2">{tr.target}</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-slate-700/20">
                    <td className="p-2 align-top">
                      <span className="font-mono font-bold">{it.id}</span>
                      <div className={`mt-1 ${muted}`}>{it.message}</div>
                    </td>
                    <td className="p-2 font-mono align-top break-all">{it.source || '—'}</td>
                    <td className="p-2 font-mono align-top break-all">{it.target || '—'}</td>
                    <td className={`p-2 font-bold align-top ${sevStyle(it.severity)}`}>{it.severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 md:p-6 space-y-4 ${shell}`}>
        <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          <Icons.FolderSync className="w-4 h-4" />
          {tr.pathsTitle}
        </h2>
        <label className="space-y-1 block">
          <span className={`text-xs font-bold ${muted}`}>{tr.localPath}</span>
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
              isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
          />
        </label>
        <label className="space-y-1 block">
          <span className={`text-xs font-bold ${muted}`}>{tr.remotePath}</span>
          <input
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
              isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
          />
        </label>
        <label className="space-y-1 block">
          <span className={`text-xs font-bold ${muted}`}>{tr.excludes}</span>
          <textarea
            value={excludes}
            onChange={(e) => setExcludes(e.target.value)}
            rows={6}
            spellCheck={false}
            className={`w-full rounded-xl border px-3 py-2 text-xs font-mono ${
              isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
          />
          <span className={`text-[10px] ${muted}`}>{tr.excludesHint}</span>
        </label>
        <button
          type="button"
          onClick={() => void loadPreset()}
          className={`text-xs font-bold underline ${isDark ? 'text-sky-400' : 'text-sky-700'}`}
        >
          {tr.presetCopanel}
        </button>
        <label className="space-y-1 block max-w-xs">
          <span className={`text-xs font-bold ${muted}`}>{tr.estimateGb}</span>
          <input
            value={estimateGb}
            onChange={(e) => setEstimateGb(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${
              isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
            }`}
            placeholder="20"
          />
          <span className={`text-[10px] ${muted}`}>{tr.estimateHint}</span>
        </label>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded" />
            {tr.dryRun}
          </label>
          <button
            type="button"
            onClick={() => void runSync()}
            disabled={syncLoading || !host.trim() || (!dryRun && canProceed !== true)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${
              dryRun ? (isDark ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-600') : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {syncLoading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Play className="w-4 h-4" />}
            {syncLoading ? tr.running : dryRun ? tr.dryRun : tr.runSync}
          </button>
        </div>
        {canProceed === false && (
          <p className={`text-xs ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>{tr.cannotProceed}</p>
        )}

        <div>
          <h3 className={`text-xs font-bold uppercase mb-2 ${muted}`}>{tr.resultTitle}</h3>
          <pre
            className={`rounded-xl border p-3 text-[11px] font-mono overflow-auto max-h-80 whitespace-pre-wrap ${
              isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            {output || tr.noResult}
          </pre>
        </div>
      </section>
    </div>
  );
}
