/**
 * Compose tab — managed projects with full lifecycle actions + discover scan.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../../../lib/utils';
import * as Icons from 'lucide-react';
import ProjectEditorModal, { type ProjectRef } from './ProjectEditorModal';
import WindowModal from '../../../core/shell/WindowModal';

export interface ManagedProject {
  id: string;
  name: string;
  path: string;
  compose_file: string;
  source: string;
  status: string;
}

interface ComposeFile {
  path: string;
  filename: string;
  full_path: string;
}

interface Props {
  isDark: boolean;
  language: 'en' | 'vi';
  onRefreshContainers: () => void;
}

export default function ProjectManagerPanel({ isDark, language, onRefreshContainers }: Props) {
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [composeFiles, setComposeFiles] = useState<ComposeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [actionOutput, setActionOutput] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<ProjectRef | null>(null);
  const [logsProject, setLogsProject] = useState<ProjectRef | null>(null);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const tr = useMemo(
    () =>
      ({
        en: {
          managedTitle: 'Managed Projects',
          managedDesc: 'Projects created via Docker Manager — edit, deploy, stop, or view logs.',
          discoveredTitle: 'Discovered Compose',
          discoveredDesc: 'Scan the server for existing docker-compose files.',
          noProjects: 'No managed projects yet. Use + New Project on the Containers tab.',
          scanPlaceholder: 'e.g. /home/Docker',
          scanBtn: 'Scan',
          noCompose: 'No compose files found.',
          colName: 'Project',
          colPath: 'Path',
          colStatus: 'Status',
          colActions: 'Actions',
          statusRunning: 'Running',
          statusStopped: 'Stopped',
          statusPartial: 'Partial',
          statusUnknown: 'Unknown',
          edit: 'Edit',
          deploy: 'Deploy',
          down: 'Stop stack',
          restart: 'Restart',
          logs: 'Logs',
          downConfirm: 'Stop and remove containers for this stack?',
          composeColFile: 'Compose file',
          composeColPath: 'Directory',
          buildDeploy: 'Deploy',
        },
        vi: {
          managedTitle: 'Project quản lý',
          managedDesc: 'Project tạo qua Docker Manager — sửa, triển khai, dừng hoặc xem log.',
          discoveredTitle: 'Compose phát hiện',
          discoveredDesc: 'Quét máy chủ tìm tệp docker-compose có sẵn.',
          noProjects: 'Chưa có project. Dùng + Tạo Project trên tab Container.',
          scanPlaceholder: 'Ví dụ: /home/Docker',
          scanBtn: 'Quét',
          noCompose: 'Không tìm thấy tệp compose.',
          colName: 'Project',
          colPath: 'Đường dẫn',
          colStatus: 'Trạng thái',
          colActions: 'Hành động',
          statusRunning: 'Đang chạy',
          statusStopped: 'Đã dừng',
          statusPartial: 'Một phần',
          statusUnknown: 'Không rõ',
          edit: 'Sửa',
          deploy: 'Triển khai',
          down: 'Dừng stack',
          restart: 'Khởi động lại',
          logs: 'Logs',
          downConfirm: 'Dừng và gỡ container của stack này?',
          composeColFile: 'Tệp Compose',
          composeColPath: 'Thư mục',
          buildDeploy: 'Triển khai',
        },
      })[language],
    [language],
  );

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/docker_manager/projects/list');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchComposeFiles = useCallback(async (p?: string) => {
    setScanLoading(true);
    try {
      const url = p
        ? `/api/docker_manager/scan-compose?custom_path=${encodeURIComponent(p)}`
        : '/api/docker_manager/scan-compose';
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        setComposeFiles(d.compose_files || []);
      }
    } finally {
      setScanLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchComposeFiles();
  }, [fetchProjects, fetchComposeFiles, language]);

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      running: tr.statusRunning,
      stopped: tr.statusStopped,
      partial: tr.statusPartial,
      unknown: tr.statusUnknown,
    };
    return map[status] || status;
  };

  const statusClass = (status: string) => {
    if (status === 'running') return 'bg-green-500/10 border-green-500/20 text-green-500';
    if (status === 'stopped') return isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600';
    return 'bg-amber-500/10 border-amber-500/20 text-amber-500';
  };

  const runComposeAction = async (path: string, action: 'deploy' | 'down' | 'restart') => {
    setActionOutput(null);
    try {
      if (action === 'deploy') {
        const res = await fetch('/api/docker_manager/compose/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail?.message || 'Deploy failed');
        setActionOutput(`Deploy job started: ${data.job_id || 'ok'}`);
      } else {
        const endpoint = action === 'down' ? '/api/docker_manager/compose/down' : '/api/docker_manager/compose/restart';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        const data = await res.json();
        setActionOutput(data.message || data.output || data.error || JSON.stringify(data));
      }
      fetchProjects();
      onRefreshContainers();
    } catch (err) {
      setActionOutput(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleDown = (path: string) => {
    if (!confirm(tr.downConfirm)) return;
    runComposeAction(path, 'down');
  };

  const openLogs = async (project: ProjectRef) => {
    setLogsProject(project);
    setLogsContent('');
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/docker_manager/compose/logs?path=${encodeURIComponent(project.path)}&tail=200&timestamps=true`);
      const data = await res.json();
      setLogsContent(data.output || data.error || data.logs || 'No logs.');
    } catch {
      setLogsContent('Failed to load logs.');
    } finally {
      setLogsLoading(false);
    }
  };

  const card = cn('border rounded-2xl overflow-hidden', isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200 shadow-sm');

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className={cn('text-sm font-bold', isDark ? 'text-slate-200' : 'text-slate-800')}>{tr.managedTitle}</h3>
          <p className={cn('text-[11px] mt-0.5', isDark ? 'text-slate-500' : 'text-slate-500')}>{tr.managedDesc}</p>
        </div>
        <div className={card}>
          {loading && projects.length === 0 ? (
            <div className="flex justify-center py-12 text-slate-400 text-xs">
              <Icons.Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">{tr.noProjects}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={cn('text-[10px] uppercase tracking-wider', isDark ? 'bg-slate-950/60 text-slate-400' : 'bg-slate-50 text-slate-500')}>
                  <tr className={cn('border-b', isDark ? 'border-slate-800' : 'border-slate-100')}>
                    <th className="p-3 font-bold">{tr.colName}</th>
                    <th className="p-3 font-bold">{tr.colPath}</th>
                    <th className="p-3 font-bold">{tr.colStatus}</th>
                    <th className="p-3 font-bold text-center">{tr.colActions}</th>
                  </tr>
                </thead>
                <tbody className={cn('divide-y text-xs', isDark ? 'divide-slate-800/40' : 'divide-slate-100')}>
                  {projects.map((p) => (
                    <tr key={p.id} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/80'}>
                      <td className="p-3 font-bold">{p.name}</td>
                      <td className={cn('p-3 font-mono text-[11px] max-w-[14rem] truncate', isDark ? 'text-slate-400' : 'text-slate-500')} title={p.path}>
                        {p.path}
                      </td>
                      <td className="p-3">
                        <span className={cn('px-2 py-0.5 rounded-full border text-[10px] font-semibold', statusClass(p.status))}>
                          {statusLabel(p.status)}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <ActionBtn isDark={isDark} title={tr.edit} onClick={() => setEditProject({ id: p.id, name: p.name, path: p.path })} icon={Icons.Pencil} />
                          <ActionBtn isDark={isDark} title={tr.deploy} onClick={() => runComposeAction(p.path, 'deploy')} icon={Icons.Play} color="green" />
                          <ActionBtn isDark={isDark} title={tr.restart} onClick={() => runComposeAction(p.path, 'restart')} icon={Icons.RefreshCcw} color="blue" />
                          <ActionBtn isDark={isDark} title={tr.logs} onClick={() => openLogs({ id: p.id, name: p.name, path: p.path })} icon={Icons.FileText} />
                          <ActionBtn isDark={isDark} title={tr.down} onClick={() => handleDown(p.path)} icon={Icons.Square} color="amber" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h3 className={cn('text-sm font-bold flex items-center gap-2', isDark ? 'text-indigo-200' : 'text-indigo-700')}>
              <Icons.Search className="w-4 h-4" />
              {tr.discoveredTitle} ({composeFiles.length})
            </h3>
            <p className={cn('text-[11px] mt-0.5', isDark ? 'text-slate-500' : 'text-slate-500')}>{tr.discoveredDesc}</p>
          </div>
          <div className={cn('flex items-center gap-2 p-1.5 rounded-xl border', isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-white border-slate-200')}>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder={tr.scanPlaceholder}
              className={cn('bg-transparent text-xs px-2 w-full sm:w-48 font-mono focus:outline-none', isDark ? 'text-slate-200' : 'text-slate-800')}
            />
            <button
              onClick={() => fetchComposeFiles(customPath)}
              disabled={scanLoading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shrink-0 disabled:opacity-50"
            >
              {tr.scanBtn}
            </button>
          </div>
        </div>
        <div className={card}>
          {composeFiles.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">{tr.noCompose}</div>
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className={cn('sticky top-0 text-[10px] uppercase', isDark ? 'bg-slate-900/95 text-slate-400' : 'bg-slate-50 text-slate-500')}>
                  <tr className={cn('border-b', isDark ? 'border-slate-800' : 'border-slate-100')}>
                    <th className="px-3 py-2">{tr.composeColFile}</th>
                    <th className="px-3 py-2">{tr.composeColPath}</th>
                    <th className="px-3 py-2 text-right">{tr.colActions}</th>
                  </tr>
                </thead>
                <tbody className={cn('divide-y', isDark ? 'divide-slate-800/50' : 'divide-slate-100')}>
                  {composeFiles.map((file, idx) => (
                    <tr key={`${file.path}-${idx}`}>
                      <td className="px-3 py-2 font-bold">{file.filename}</td>
                      <td className={cn('px-3 py-2 font-mono text-[11px]', isDark ? 'text-slate-400' : 'text-slate-500')}>{file.path}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        <button
                          onClick={() => setEditProject({ id: file.filename, name: file.filename, path: file.path })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold"
                        >
                          <Icons.Pencil className="w-3 h-3" />
                          {tr.edit}
                        </button>
                        <button
                          onClick={() => runComposeAction(file.path, 'deploy')}
                          className="inline-flex items-center gap-1 bg-indigo-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold"
                        >
                          <Icons.Play className="w-3 h-3" />
                          {tr.buildDeploy}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {actionOutput && (
        <div
          className={cn(
            'p-3 border rounded-xl font-mono text-xs max-h-32 overflow-auto whitespace-pre-wrap flex justify-between gap-2',
            isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700',
          )}
        >
          <span>{actionOutput}</span>
          <button type="button" onClick={() => setActionOutput(null)} className="text-slate-500 shrink-0">
            ✕
          </button>
        </div>
      )}

      <ProjectEditorModal
        open={!!editProject}
        project={editProject}
        onClose={() => setEditProject(null)}
        onSaved={() => {
          fetchProjects();
          onRefreshContainers();
        }}
        isDark={isDark}
        language={language}
      />

      <WindowModal
        open={!!logsProject}
        onClose={() => setLogsProject(null)}
        title={logsProject ? `${tr.logs}: ${logsProject.name}` : tr.logs}
        maxWidth="2xl"
        className="max-w-2xl"
        closeOnBackdropClick={false}
      >
        <div className="p-4 max-h-[60vh] overflow-auto">
          {logsLoading ? (
            <div className="flex justify-center py-8 text-slate-400 text-xs">
              <Icons.Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <pre className={cn('font-mono text-xs whitespace-pre-wrap', isDark ? 'text-slate-300' : 'text-slate-800')}>{logsContent}</pre>
          )}
        </div>
      </WindowModal>
    </div>
  );
}

function ActionBtn({
  isDark,
  title,
  onClick,
  icon: Icon,
  color,
}: {
  isDark: boolean;
  title: string;
  onClick: () => void;
  icon: typeof Icons.Pencil;
  color?: 'green' | 'blue' | 'amber';
}) {
  const colorCls =
    color === 'green' ? 'text-green-500' : color === 'blue' ? 'text-blue-500' : color === 'amber' ? 'text-amber-500' : isDark ? 'text-slate-300' : 'text-slate-600';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn('p-1.5 rounded-lg border transition', isDark ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-slate-50 border-slate-200 hover:bg-slate-100', colorCls)}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
