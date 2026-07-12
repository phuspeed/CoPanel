import { useCallback, useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface Props {
  isDark: boolean;
  selectedPath: string;
  onSelect: (path: string) => void;
  labels: {
    browse: string;
    selectFolder: string;
    loading: string;
    empty: string;
    parent: string;
  };
}

export default function FolderBrowser({ isDark, selectedPath, onSelect, labels }: Props) {
  const [currentPath, setCurrentPath] = useState(selectedPath || '/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('copanel_token') : null;

  const fetchDir = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const url = `/api/file_manager/list${path ? `?path=${encodeURIComponent(path)}` : ''}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = await res.json();
        const files = (data.files || []) as FileEntry[];
        setEntries(files.filter((f) => f.is_dir));
        if (data.path) setCurrentPath(data.path);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchDir(currentPath);
  }, [currentPath, fetchDir]);

  useEffect(() => {
    if (selectedPath && selectedPath !== currentPath) {
      setCurrentPath(selectedPath);
    }
  }, [selectedPath]);

  const parentPath = (() => {
    const parts = currentPath.replace(/\/$/, '').split('/');
    if (parts.length <= 1) return '/';
    parts.pop();
    return parts.join('/') || '/';
  })();

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden flex flex-col min-h-[12rem] max-h-56',
        isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2 border-b text-[11px] font-mono',
          isDark ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500',
        )}
      >
        <span className="truncate" title={currentPath}>
          {currentPath}
        </span>
        <button
          type="button"
          onClick={() => fetchDir(currentPath)}
          className={cn('shrink-0 p-1 rounded', isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100')}
          title={labels.browse}
        >
          <Icons.RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto text-xs">
        {currentPath !== '/' && (
          <button
            type="button"
            onClick={() => setCurrentPath(parentPath)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left border-b transition',
              isDark ? 'border-slate-800/60 hover:bg-slate-900/60 text-slate-300' : 'border-slate-100 hover:bg-slate-50 text-slate-700',
            )}
          >
            <Icons.ArrowUp className="w-3.5 h-3.5 shrink-0" />
            {labels.parent}
          </button>
        )}
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Icons.Loader2 className="w-4 h-4 animate-spin" />
            {labels.loading}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-slate-400">{labels.empty}</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setCurrentPath(entry.path)}
              onDoubleClick={() => onSelect(entry.path)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left border-b last:border-0 transition',
                selectedPath === entry.path
                  ? isDark
                    ? 'bg-blue-500/15 text-blue-200'
                    : 'bg-blue-50 text-blue-800'
                  : isDark
                    ? 'border-slate-800/40 hover:bg-slate-900/50 text-slate-300'
                    : 'border-slate-100 hover:bg-slate-50 text-slate-700',
              )}
            >
              <Icons.Folder className="w-4 h-4 shrink-0 text-amber-500" />
              <span className="truncate">{entry.name}</span>
            </button>
          ))
        )}
      </div>

      <div className={cn('border-t px-3 py-2', isDark ? 'border-slate-800' : 'border-slate-100')}>
        <button
          type="button"
          onClick={() => onSelect(currentPath)}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold py-2 transition"
        >
          {labels.selectFolder}
        </button>
      </div>
    </div>
  );
}
