import { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { listFolder } from '../hooks/useFileManager';
import { collectDropEntries, dropMode, hasInternalDrag, hasOsFiles, readInternalPaths } from '../dnd';
import { baseName, isSameOrInside, pathBreadcrumbs } from '../utils';
import type { UploadEntry } from '../types';

interface NodeState {
  children: string[] | null;
  loading: boolean;
  error?: boolean;
}

interface Props {
  isDark: boolean;
  title: string;
  currentPath: string;
  fsVersion: number;
  onNavigate: (path: string) => void;
  onTransfer: (paths: string[], targetDir: string, mode: 'move' | 'copy') => void;
  onUpload: (entries: UploadEntry[], targetDir: string) => void;
}

/**
 * Lazy folder tree backed by GET /api/file_manager/list. Children are loaded
 * on expand; ancestors of the current folder are revealed automatically.
 * Restricted users (403 on "/") get their current permitted folder as root.
 */
export default function FileTree({ isDark, title, currentPath, fsVersion, onNavigate, onTransfer, onUpload }: Props) {
  const [root, setRoot] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const load = useCallback(async (path: string, force = false): Promise<boolean> => {
    const existing = nodesRef.current[path];
    if (!force && existing && (existing.children || existing.loading)) return !existing.error;
    setNodes((prev) => ({ ...prev, [path]: { children: prev[path]?.children ?? null, loading: true } }));
    try {
      const items = await listFolder(path);
      const dirs = items
        .filter((f) => f.is_dir && !f.is_symlink)
        .map((f) => f.path)
        .sort((a, b) => baseName(a).localeCompare(baseName(b), undefined, { sensitivity: 'base' }));
      setNodes((prev) => ({ ...prev, [path]: { children: dirs, loading: false } }));
      return true;
    } catch {
      setNodes((prev) => ({ ...prev, [path]: { children: [], loading: false, error: true } }));
      return false;
    }
  }, []);

  // Pick the root once: "/" when listable, else the first folder we were given.
  useEffect(() => {
    if (root || !currentPath) return;
    void (async () => {
      const ok = await load('/');
      setRoot(ok ? '/' : currentPath);
      if (!ok) void load(currentPath, true);
    })();
  }, [root, currentPath, load]);

  // Reveal the current folder: expand every ancestor under the root.
  useEffect(() => {
    if (!root || !currentPath || !isSameOrInside(currentPath, root)) return;
    const chain = pathBreadcrumbs(currentPath)
      .map((c) => c.path)
      .filter((p) => isSameOrInside(p, root) && p !== currentPath);
    setExpanded((prev) => {
      const next = new Set(prev);
      chain.forEach((p) => next.add(p));
      return next;
    });
    chain.forEach((p) => void load(p));
  }, [root, currentPath, load]);

  // Something changed on disk: refresh loaded nodes around the current folder.
  useEffect(() => {
    if (!fsVersion) return;
    Object.keys(nodesRef.current).forEach((p) => {
      if (expanded.has(p) || p === root) void load(p, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsVersion]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        void load(path);
      }
      return next;
    });
  };

  const onDragOver = (e: React.DragEvent, path: string) => {
    if (!hasInternalDrag(e.dataTransfer) && !hasOsFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasOsFiles(e.dataTransfer) ? 'copy' : dropMode(e) === 'copy' ? 'copy' : 'move';
    setDropTarget(path);
  };

  const onDrop = async (e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (hasInternalDrag(e.dataTransfer)) {
      const paths = readInternalPaths(e.dataTransfer);
      if (paths.length) onTransfer(paths, path, dropMode(e));
    } else if (hasOsFiles(e.dataTransfer)) {
      const entries = await collectDropEntries(e.dataTransfer);
      if (entries.length) onUpload(entries, path);
    }
  };

  const renderNode = (path: string, depth: number) => {
    const state = nodes[path];
    const isOpen = expanded.has(path) || path === root;
    const active = path === currentPath;
    const label = path === '/' ? '/' : baseName(path) || path;
    const kids = state?.children;
    const leaf = kids !== null && kids !== undefined && kids.length === 0;
    return (
      <div key={path}>
        <div
          role="treeitem"
          aria-expanded={isOpen}
          aria-selected={active}
          data-fm-tree={path}
          className={cn(
            'group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-2 text-xs transition',
            active
              ? isDark
                ? 'bg-sky-500/15 font-semibold text-sky-200'
                : 'bg-blue-50 font-semibold text-blue-700'
              : isDark
                ? 'text-slate-300 hover:bg-slate-800/70'
                : 'text-slate-700 hover:bg-slate-100',
            dropTarget === path && (isDark ? 'ring-2 ring-sky-500' : 'ring-2 ring-blue-500'),
          )}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => onNavigate(path)}
          onDragOver={(e) => onDragOver(e, path)}
          onDragLeave={() => setDropTarget((t) => (t === path ? null : t))}
          onDrop={(e) => void onDrop(e, path)}
          title={path}
        >
          <button
            type="button"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded', leaf && 'invisible')}
            onClick={(e) => {
              e.stopPropagation();
              if (path !== root) toggle(path);
            }}
          >
            {state?.loading ? (
              <Icons.Loader className="h-3 w-3 animate-spin opacity-60" />
            ) : isOpen ? (
              <Icons.ChevronDown className="h-3 w-3 opacity-70" />
            ) : (
              <Icons.ChevronRight className="h-3 w-3 opacity-70" />
            )}
          </button>
          {isOpen ? (
            <Icons.FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-sky-400' : 'text-sky-500')} />
          ) : (
            <Icons.Folder className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-sky-400' : 'text-sky-500')} />
          )}
          <span className="truncate">{label}</span>
        </div>
        {isOpen && kids && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <section data-testid="fm-tree" role="tree" aria-label={title}>
      <p className={cn('mb-1.5 px-2 text-[0.625rem] font-bold uppercase tracking-widest', isDark ? 'text-slate-500' : 'text-slate-400')}>{title}</p>
      {root ? renderNode(root, 0) : <Icons.Loader className="mx-2 h-3.5 w-3.5 animate-spin opacity-60" />}
    </section>
  );
}
