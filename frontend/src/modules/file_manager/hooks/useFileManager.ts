import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookmarkEntry,
  ClipboardState,
  ConflictPolicy,
  ConflictRequest,
  CreateType,
  FileItem,
  SortKey,
  UploadEntry,
  UploadTask,
  ViewMode,
} from '../types';
import { getFileManagerTranslations } from '../i18n';
import {
  apiErrorMessage,
  baseName,
  copyText,
  formatSize,
  getAuthHeader,
  isSameOrInside,
  isTextLike,
  isZipName,
  joinPath,
  newId,
  parentDir,
  previewKind,
  resolveTypedPath,
  sortFiles,
} from '../utils';
import { toast } from '../../../core/platform';
import { useAppShellContext } from '../../../core/hooks/useAppShellContext';
import { useIsWindowedModule } from '../../../core/shell/WindowViewportContext';

/** Text files above this size ask before opening in the editor. */
const EDITOR_SOFT_LIMIT = 2 * 1024 * 1024;

interface PendingConflict extends ConflictRequest {
  resolve: (policy: ConflictPolicy | null) => void;
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
  return data;
}

/** List a folder (used for conflict checks and the folder tree). */
export async function listFolder(path: string): Promise<FileItem[]> {
  const res = await fetch(`/api/file_manager/list?path=${encodeURIComponent(path)}&must_exist=1`, {
    headers: getAuthHeader(),
  });
  let data: { files?: FileItem[] } = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error(apiErrorMessage(data, `List failed (${res.status})`));
  return data.files || [];
}

export function useFileManager() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const lang = language === 'vi' ? 'vi' : 'en';
  const tr = getFileManagerTranslations(lang);
  const windowed = useIsWindowedModule();

  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('copanel_fm_view');
    if (saved === 'grid' || saved === 'list') return saved;
    return windowed ? 'grid' : 'list';
  });
  const [filterQuery, setFilterQuery] = useState('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);
  /** Bumped after any change on disk so the folder tree can refresh. */
  const [fsVersion, setFsVersion] = useState(0);

  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [zipArchiveName, setZipArchiveName] = useState('');
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractTargetDir, setExtractTargetDir] = useState('');
  const [chmodModalOpen, setChmodModalOpen] = useState(false);
  const [chmodValue, setChmodValue] = useState('755');

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarkBackendMissing, setBookmarkBackendMissing] = useState(false);

  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const bookmarkPathSet = useMemo(() => new Set(bookmarks.map((b) => b.path)), [bookmarks]);
  const currentPathRef = useRef('');
  currentPathRef.current = currentPath;

  const setViewMode = useCallback((m: ViewMode) => {
    setViewModeState(m);
    try {
      localStorage.setItem('copanel_fm_view', m);
    } catch {
      /* ignore */
    }
  }, []);

  const applyListing = useCallback((data: { path?: string; files?: FileItem[] }, recordHistory: boolean) => {
    const resolved = data.path || '';
    const changedDir = resolved !== currentPathRef.current;
    setCurrentPath(resolved);
    setFiles(data.files || []);
    if (changedDir) {
      setSelectedPaths([]);
      anchorRef.current = null;
      setFocusPath(null);
      setFilterQuery('');
    } else {
      const names = new Set((data.files || []).map((f) => f.path));
      setSelectedPaths((prev) => prev.filter((p) => names.has(p)));
    }
    if (recordHistory) {
      const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
      if (trimmed[trimmed.length - 1] !== resolved) {
        historyRef.current = [...trimmed, resolved];
        historyIndexRef.current = historyRef.current.length - 1;
        setHistoryTick((t) => t + 1);
      }
    } else if (historyRef.current.length === 0) {
      historyRef.current = [resolved];
      historyIndexRef.current = 0;
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const fetchPath = useCallback(
    async (path: string = '', recordHistory = false) => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/file_manager/list${path ? `?path=${encodeURIComponent(path)}` : ''}`;
        const response = await fetch(url, { headers: getAuthHeader() });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(apiErrorMessage(data, 'Failed to list directory'));
        }
        const data = await response.json();
        applyListing(data, recordHistory);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [applyListing],
  );

  const reload = useCallback(() => {
    setFsVersion((v) => v + 1);
    return fetchPath(currentPathRef.current, false);
  }, [fetchPath]);

  const navigateToTyped = useCallback(
    async (input: string): Promise<boolean> => {
      const target = resolveTypedPath(input, currentPath);
      if (!target) return false;
      setLoading(true);
      try {
        const url = `/api/file_manager/list?path=${encodeURIComponent(target)}&must_exist=1`;
        const response = await fetch(url, { headers: getAuthHeader() });
        let data: { path?: string; files?: FileItem[]; detail?: unknown; is_dir?: boolean } = {};
        try {
          data = await response.json();
        } catch {
          /* non-JSON error body */
        }
        if (!response.ok || data.is_dir === false) {
          const title =
            response.status === 404 || data.is_dir === false
              ? tr.pathNotFound
              : response.status === 403
                ? tr.pathAccessDenied
                : tr.pathOpenFailed;
          const detail = apiErrorMessage(data, '');
          toast(title, { level: 'error', body: detail ? `${target} — ${detail}` : target, module: 'file_manager' });
          return false;
        }
        setError(null);
        applyListing(data, true);
        return true;
      } catch (err) {
        toast(tr.pathOpenFailed, {
          level: 'error',
          body: `${target} — ${err instanceof Error ? err.message : 'Unknown error'}`,
          module: 'file_manager',
        });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [applyListing, currentPath, tr],
  );

  useEffect(() => {
    void fetchPath('', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyError = useCallback(
    (err: unknown, fallback?: string) => {
      toast(fallback || tr.actionFailed, {
        level: 'error',
        body: err instanceof Error ? err.message : String(err ?? ''),
        module: 'file_manager',
      });
    },
    [tr],
  );

  // ---- bookmarks -----------------------------------------------------------

  const loadBookmarks = useCallback(async () => {
    try {
      const res = await fetch('/api/file_manager/bookmarks', { headers: getAuthHeader() });
      if (res.status === 404) {
        setBookmarkBackendMissing(true);
        setBookmarks([]);
        return;
      }
      if (!res.ok) return;
      setBookmarkBackendMissing(false);
      const data = (await res.json()) as { bookmarks?: BookmarkEntry[] };
      setBookmarks(data.bookmarks || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const persistBookmarks = async (next: BookmarkEntry[]) => {
    if (bookmarkBackendMissing) {
      notifyError(new Error(tr.bookmarksUpgradeHint));
      return;
    }
    try {
      const res = await fetch('/api/file_manager/bookmarks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          bookmarks: next.map((b) => ({ path: b.path, is_dir: b.is_dir, label: b.label ?? '' })),
        }),
      });
      if (res.status === 404) {
        setBookmarkBackendMissing(true);
        notifyError(new Error(tr.bookmarksUpgradeHint));
        return;
      }
      if (!res.ok) throw new Error('Failed to save bookmarks');
      setBookmarkBackendMissing(false);
      const data = (await res.json()) as { bookmarks?: BookmarkEntry[] };
      setBookmarks(data.bookmarks ?? next);
    } catch (err) {
      notifyError(err);
    }
  };

  // ---- navigation ----------------------------------------------------------

  const navigateTo = useCallback((path: string) => void fetchPath(path, true), [fetchPath]);

  const goBack = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const path = historyRef.current[historyIndexRef.current] ?? '';
    setHistoryTick((t) => t + 1);
    void fetchPath(path, false);
  };

  const goForward = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const path = historyRef.current[historyIndexRef.current] ?? '';
    setHistoryTick((t) => t + 1);
    void fetchPath(path, false);
  };

  const handleGoUp = () => {
    if (!currentPath) return;
    const up = parentDir(currentPath);
    if (up === currentPath) return;
    navigateTo(up);
  };

  // ---- derived lists -------------------------------------------------------

  const sortedFiles = useMemo(() => sortFiles(files, sortKey, sortAsc), [files, sortKey, sortAsc]);

  const filteredFiles = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return sortedFiles;
    return sortedFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [sortedFiles, filterQuery]);

  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  const selectedItems = useMemo(
    () => selectedPaths.map((p) => fileByPath.get(p)).filter((f): f is FileItem => !!f),
    [selectedPaths, fileByPath],
  );

  const selectedSize = useMemo(() => {
    let total = 0;
    for (const item of selectedItems) if (!item.is_dir) total += item.size;
    return formatSize(total);
  }, [selectedItems]);

  // ---- selection -----------------------------------------------------------

  /** Click selection: plain = single, Ctrl/Cmd = toggle, Shift = range from the anchor. */
  const selectItem = useCallback(
    (path: string, opts: { ctrl?: boolean; shift?: boolean } = {}) => {
      const order = filteredFiles.map((f) => f.path);
      if (opts.shift && anchorRef.current && order.includes(anchorRef.current)) {
        const a = order.indexOf(anchorRef.current);
        const b = order.indexOf(path);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = order.slice(lo, hi + 1);
        setSelectedPaths((prev) => (opts.ctrl ? Array.from(new Set([...prev, ...range])) : range));
      } else if (opts.ctrl) {
        setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
        anchorRef.current = path;
      } else {
        setSelectedPaths([path]);
        anchorRef.current = path;
      }
      setFocusPath(path);
    },
    [filteredFiles],
  );

  /** Back-compat: checkbox-style toggle. */
  const handleToggleSelect = (path: string, multi = false) => selectItem(path, { ctrl: multi });

  const handleSelectAll = () => {
    setSelectedPaths((prev) =>
      prev.length === filteredFiles.length && filteredFiles.length > 0 ? [] : filteredFiles.map((f) => f.path),
    );
  };

  const selectAll = () => setSelectedPaths(filteredFiles.map((f) => f.path));

  /** Keyboard focus move (arrows / Home / End); Shift extends the selection. */
  const moveFocus = (delta: number | 'home' | 'end', extend = false) => {
    const order = filteredFiles.map((f) => f.path);
    if (!order.length) return;
    const cur = focusPath && order.includes(focusPath) ? order.indexOf(focusPath) : -1;
    let next: number;
    if (delta === 'home') next = 0;
    else if (delta === 'end') next = order.length - 1;
    else next = cur < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, cur + delta));
    selectItem(order[next], { shift: extend });
  };

  /** Type-to-select: jump to the first name starting with the typed prefix. */
  const selectByPrefix = (prefix: string) => {
    const q = prefix.toLowerCase();
    const hit = filteredFiles.find((f) => f.name.toLowerCase().startsWith(q));
    if (hit) selectItem(hit.path);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // ---- editor / preview / open ------------------------------------------------

  const handleEditFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/read?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(apiErrorMessage(data, 'Could not read file'));
      }
      const data = await res.json();
      setEditingFile(item.path);
      setFileContent(data.content || '');
    } catch (err) {
      notifyError(err);
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      await postJson('/api/file_manager/write', { path: editingFile, content: fileContent });
      setEditingFile(null);
      void reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const handleDownloadFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/download?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(apiErrorMessage(data, 'Download failed'));
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notifyError(err);
    }
  };

  /** Open: folder → navigate, media → preview, text → editor, zip → extract, else offer download. */
  const handleOpenItem = (item: FileItem) => {
    if (item.is_dir) {
      navigateTo(item.path);
      return;
    }
    if (previewKind(item.name)) {
      setPreviewPath(item.path);
      return;
    }
    if (isTextLike(item.name)) {
      if (item.size > EDITOR_SOFT_LIMIT && !confirm(tr.largeTextConfirm(formatSize(item.size)))) return;
      void handleEditFile(item);
      return;
    }
    if (isZipName(item.name)) {
      setSelectedPaths([item.path]);
      setExtractTargetDir(currentPath);
      setExtractModalOpen(true);
      return;
    }
    if (confirm(tr.noPreviewDownload(item.name))) void handleDownloadFile(item);
  };

  const previewItems = useMemo(() => filteredFiles.filter((f) => !f.is_dir && previewKind(f.name)), [filteredFiles]);

  // ---- conflict dialog ---------------------------------------------------------

  const askConflict = useCallback(
    (req: ConflictRequest) =>
      new Promise<ConflictPolicy | null>((resolve) => {
        setConflict({ ...req, resolve });
      }),
    [],
  );

  const resolveConflict = (policy: ConflictPolicy | null) => {
    if (!conflict) return;
    conflict.resolve(policy);
    setConflict(null);
  };

  // ---- copy / move (clipboard + drag-drop) --------------------------------

  const transferItems = useCallback(
    async (paths: string[], targetDir: string, mode: 'move' | 'copy'): Promise<boolean> => {
      if (!paths.length || !targetDir) return false;
      for (const p of paths) {
        const item = fileByPath.get(p);
        const mayBeDir = item ? item.is_dir : true;
        if (mayBeDir && isSameOrInside(targetDir, p) && !(mode === 'copy' && parentDir(p) === targetDir)) {
          toast(tr.cannotIntoSelf, { level: 'error', module: 'file_manager' });
          return false;
        }
      }
      const sources = mode === 'move' ? paths.filter((p) => parentDir(p) !== targetDir) : paths;
      if (!sources.length) return false;
      const allSameDir = mode === 'copy' && sources.every((p) => parentDir(p) === targetDir);
      let policy: ConflictPolicy = 'rename';
      if (!allSameDir) {
        let existing: Set<string>;
        try {
          existing = new Set((await listFolder(targetDir)).map((f) => f.name));
        } catch (err) {
          notifyError(err);
          return false;
        }
        const clashes = sources.map((p) => baseName(p)).filter((n) => existing.has(n));
        if (clashes.length) {
          const choice = await askConflict({ kind: mode, names: clashes, targetDir });
          if (!choice) return false;
          policy = choice;
        } else {
          policy = 'rename'; // race-safe: never silently replace
        }
      }
      try {
        const endpoint = mode === 'move' ? 'move-multiple' : 'copy';
        const data = await postJson(`/api/file_manager/${endpoint}`, {
          source_paths: sources,
          target_dir: targetDir,
          on_conflict: policy,
        });
        const done = ((mode === 'move' ? data.moved : data.copied) as unknown[] | undefined)?.length ?? sources.length;
        const skipped = (data.skipped as unknown[] | undefined)?.length ?? 0;
        toast(mode === 'move' ? tr.movedCount(done) : tr.copiedCount(done), {
          level: 'success',
          body: skipped ? tr.skippedCount(skipped) : targetDir,
          module: 'file_manager',
        });
        void reload();
        return true;
      } catch (err) {
        notifyError(err);
        void reload();
        return false;
      }
    },
    [askConflict, fileByPath, notifyError, reload, tr],
  );

  const handleCut = (item?: FileItem) => {
    const paths = item && !selectedPaths.includes(item.path) ? [item.path] : selectedPaths;
    if (!paths.length) return;
    setClipboard({ paths, action: 'cut' });
  };

  const handleCopy = (item?: FileItem) => {
    const paths = item && !selectedPaths.includes(item.path) ? [item.path] : selectedPaths;
    if (!paths.length) return;
    setClipboard({ paths, action: 'copy' });
  };

  const handlePaste = async (targetDir?: string) => {
    if (!clipboard) return;
    const ok = await transferItems(clipboard.paths, targetDir || currentPath, clipboard.action === 'cut' ? 'move' : 'copy');
    if (ok && clipboard.action === 'cut') setClipboard(null);
  };

  const copyPaths = async (paths?: string[]) => {
    const list = paths && paths.length ? paths : selectedPaths.length ? selectedPaths : [currentPath];
    const ok = await copyText(list.join('\n'));
    toast(ok ? tr.pathCopied : tr.copyFailed, {
      level: ok ? 'success' : 'error',
      body: list.length === 1 ? list[0] : tr.itemsCount(list.length),
      module: 'file_manager',
    });
  };

  // ---- upload queue ----------------------------------------------------------

  const xhrsRef = useRef(new Map<string, XMLHttpRequest>());
  const runningRef = useRef(false);
  const uploadsRef = useRef<UploadTask[]>([]);
  uploadsRef.current = uploads;

  const patchTask = (id: string, patch: Partial<UploadTask>) =>
    setUploads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const uploadOne = (task: UploadTask) =>
    new Promise<'done' | 'skipped'>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', task.file, task.file.name);
      const params = new URLSearchParams({ path: task.destDir, on_conflict: task.policy });
      if (task.relPath) params.set('relative_path', task.relPath);
      const xhr = new XMLHttpRequest();
      xhrsRef.current.set(task.id, xhr);
      xhr.open('POST', `/api/file_manager/upload?${params.toString()}`, true);
      Object.entries(getAuthHeader()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) patchTask(task.id, { loaded: ev.loaded });
      };
      xhr.onload = () => {
        xhrsRef.current.delete(task.id);
        let body: { status?: string } | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body?.status === 'skipped' ? 'skipped' : 'done');
        else reject(new Error(apiErrorMessage(body, `Upload failed (${xhr.status})`)));
      };
      xhr.onerror = () => {
        xhrsRef.current.delete(task.id);
        reject(new Error('Upload network error'));
      };
      xhr.onabort = () => {
        xhrsRef.current.delete(task.id);
        reject(new Error('canceled'));
      };
      xhr.send(formData);
    });

  const pumpUploads = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = uploadsRef.current.find((t) => t.status === 'queued');
        if (!next) break;
        patchTask(next.id, { status: 'uploading', loaded: 0 });
        uploadsRef.current = uploadsRef.current.map((t) => (t.id === next.id ? { ...t, status: 'uploading' } : t));
        try {
          const result = await uploadOne(next);
          patchTask(next.id, { status: result, loaded: next.file.size });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload error';
          patchTask(next.id, msg === 'canceled' ? { status: 'canceled' } : { status: 'error', error: msg });
        }
        uploadsRef.current = uploadsRef.current.map((t) => (t.id === next.id ? { ...t, status: 'done' } : t));
      }
    } finally {
      runningRef.current = false;
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    if (!runningRef.current && uploads.some((t) => t.status === 'queued')) void pumpUploads();
  }, [uploads, pumpUploads]);

  /** Queue files (and folder trees) for upload into destDir, asking once about clashes. */
  const enqueueUploads = useCallback(
    async (entries: UploadEntry[], destDir?: string) => {
      const dir = destDir || currentPathRef.current;
      const list = entries.filter((e) => e.file);
      if (!list.length || !dir) return;
      const topNames = new Set(list.map((e) => (e.relPath ? e.relPath.split('/')[0] : e.file.name)));
      let existing = new Set<string>();
      try {
        existing = new Set((await listFolder(dir)).map((f) => f.name));
      } catch (err) {
        notifyError(err);
        return;
      }
      const clashes = Array.from(topNames).filter((n) => existing.has(n));
      let policy: ConflictPolicy = 'rename';
      if (clashes.length) {
        const choice = await askConflict({ kind: 'upload', names: clashes, targetDir: dir });
        if (!choice) return;
        policy = choice;
      }
      const tasks: UploadTask[] = list.map((e) => ({
        id: newId(),
        file: e.file,
        relPath: e.relPath,
        destDir: dir,
        policy,
        loaded: 0,
        status: 'queued',
      }));
      setUploads((prev) => [...prev, ...tasks]);
    },
    [askConflict, notifyError],
  );

  const handleUploadFiles = useCallback(
    (fileList: FileList | File[], destDir?: string) =>
      enqueueUploads(Array.from(fileList).map((file) => ({ file })), destDir),
    [enqueueUploads],
  );

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list?.length) void handleUploadFiles(Array.from(list));
    e.target.value = '';
  };

  const handleUploadFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list?.length) {
      const entries = Array.from(list).map((file) => ({
        file,
        relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
      }));
      void enqueueUploads(entries);
    }
    e.target.value = '';
  };

  const cancelUpload = (id: string) => {
    const xhr = xhrsRef.current.get(id);
    if (xhr) xhr.abort();
    else setUploads((prev) => prev.map((t) => (t.id === id && t.status === 'queued' ? { ...t, status: 'canceled' } : t)));
  };

  const retryUpload = (id: string) =>
    setUploads((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'queued', loaded: 0, error: undefined } : t)));

  const clearFinishedUploads = () =>
    setUploads((prev) => prev.filter((t) => t.status === 'queued' || t.status === 'uploading'));

  // ---- create / rename / delete / zip / chmod ----------------------------------

  const handleCreateItem = async () => {
    if (!newItemName || !createType) return;
    const itemPath = joinPath(currentPath.replace(/[\\/]+$/, ''), newItemName);
    try {
      const endpoint = createType === 'file' ? 'create-file' : 'create-dir';
      await postJson(`/api/file_manager/${endpoint}`, { path: itemPath });
      setNewItemName('');
      setCreateType(null);
      await reload();
      setSelectedPaths([itemPath]);
      anchorRef.current = itemPath;
      setFocusPath(itemPath);
    } catch (err) {
      notifyError(err);
    }
  };

  const startRename = (item?: FileItem) => {
    const target = item || selectedItems[0];
    if (!target) return;
    setRenameValue(target.name);
    setRenamingItem(target);
  };

  const handleRename = async () => {
    if (!renamingItem) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renamingItem.name) {
      setRenamingItem(null);
      return;
    }
    const newPath = joinPath(parentDir(renamingItem.path), nextName);
    try {
      await postJson('/api/file_manager/rename', { old_path: renamingItem.path, new_path: newPath });
      setRenamingItem(null);
      setRenameValue('');
      await reload();
      setSelectedPaths([newPath]);
      anchorRef.current = newPath;
      setFocusPath(newPath);
    } catch (err) {
      notifyError(err);
    }
  };

  const handleDelete = async (item?: FileItem) => {
    const pathsToDelete = item && !selectedPaths.includes(item.path) ? [item.path] : selectedPaths;
    if (pathsToDelete.length === 0) return;
    const label = pathsToDelete.length === 1 ? `"${baseName(pathsToDelete[0])}"` : tr.itemsCount(pathsToDelete.length);
    if (!confirm(tr.confirmDelete(label))) return;
    try {
      await postJson('/api/file_manager/delete-multiple', { paths: pathsToDelete });
      setSelectedPaths([]);
      void reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const openZip = () => {
    if (!selectedPaths.length) return;
    const first = selectedItems[0];
    const base = selectedPaths.length === 1 && first ? first.name.replace(/\.[^.]+$/, '') || first.name : 'archive';
    setZipArchiveName(`${base}.zip`);
    setZipModalOpen(true);
  };

  const handleZip = async () => {
    if (!zipArchiveName || !selectedPaths.length) return;
    try {
      await postJson('/api/file_manager/zip', {
        paths: selectedPaths,
        archive_path: joinPath(currentPath.replace(/[\\/]+$/, ''), zipArchiveName),
      });
      setZipModalOpen(false);
      setZipArchiveName('');
      void reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const openExtract = () => {
    setExtractTargetDir(currentPath);
    setExtractModalOpen(true);
  };

  const handleExtract = async () => {
    const zipPath = selectedPaths.find((p) => isZipName(p)) || files.find((f) => isZipName(f.name))?.path;
    if (!zipPath || !extractTargetDir) return;
    try {
      await postJson('/api/file_manager/extract', { archive_path: zipPath, target_dir: extractTargetDir });
      setExtractModalOpen(false);
      void reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const openChmod = () => {
    if (!selectedPaths.length) return;
    setChmodValue(selectedItems.every((i) => i.is_dir) ? '755' : '644');
    setChmodModalOpen(true);
  };

  const handleChmod = async () => {
    if (!selectedPaths.length || !chmodValue) return;
    try {
      await postJson('/api/file_manager/chmod', { paths: selectedPaths, mode: chmodValue });
      setChmodModalOpen(false);
      toast('chmod ' + chmodValue, { level: 'success', body: tr.itemsCount(selectedPaths.length), module: 'file_manager' });
      void reload();
    } catch (err) {
      notifyError(err);
    }
  };

  // ---- bookmarks actions ---------------------------------------------------------

  const toggleBookmarkForItem = async (item: FileItem) => {
    const exists = bookmarks.some((b) => b.path === item.path);
    let next: BookmarkEntry[];
    if (exists) next = bookmarks.filter((b) => b.path !== item.path);
    else {
      if (bookmarks.length >= 100) {
        notifyError(new Error(tr.bookmarksMaxError));
        return;
      }
      next = [...bookmarks, { path: item.path, is_dir: item.is_dir, label: item.name }];
    }
    await persistBookmarks(next);
  };

  const removeBookmarkByPath = async (pathKey: string) => {
    await persistBookmarks(bookmarks.filter((b) => b.path !== pathKey));
  };

  const bookmarkCurrentDirectory = async () => {
    if (!currentPath) return;
    if (bookmarks.some((b) => b.path === currentPath)) {
      await persistBookmarks(bookmarks.filter((b) => b.path !== currentPath));
      return;
    }
    if (bookmarks.length >= 100) {
      notifyError(new Error(tr.bookmarksMaxError));
      return;
    }
    const base = baseName(currentPath) || currentPath;
    await persistBookmarks([...bookmarks, { path: currentPath, is_dir: true, label: base }]);
  };

  const bookmarkSelection = async () => {
    if (!selectedPaths.length) return;
    const next = [...bookmarks];
    for (const item of selectedItems) {
      if (next.some((b) => b.path === item.path)) continue;
      if (next.length >= 100) {
        notifyError(new Error(tr.bookmarksMaxError));
        return;
      }
      next.push({ path: item.path, is_dir: item.is_dir, label: item.name });
    }
    if (next.length !== bookmarks.length) await persistBookmarks(next);
  };

  const openBookmark = async (b: BookmarkEntry) => {
    if (b.is_dir) {
      navigateTo(b.path);
      return;
    }
    await fetchPath(parentDir(b.path), true);
    const name = (b.label && b.label.trim()) || baseName(b.path);
    handleOpenItem({ path: b.path, name: baseName(b.path) || name, is_dir: false, size: 0, modified: 0 });
  };

  const canGoBack = historyIndexRef.current > 0;
  const canGoForward = historyIndexRef.current < historyRef.current.length - 1;
  void historyTick;

  const anyModalOpen =
    !!editingFile || !!createType || !!renamingItem || zipModalOpen || extractModalOpen || chmodModalOpen || !!conflict || !!previewPath;

  return {
    isDark,
    tr,
    windowed,
    currentPath,
    setCurrentPath,
    files: filteredFiles,
    allFilesCount: files.length,
    loading,
    error,
    sortKey,
    sortAsc,
    setSortKey,
    setSortAsc,
    viewMode,
    setViewMode,
    filterQuery,
    setFilterQuery,
    selectedPaths,
    setSelectedPaths,
    selectedItems,
    focusPath,
    clipboard,
    setClipboard,
    editingFile,
    setEditingFile,
    fileContent,
    setFileContent,
    createType,
    setCreateType,
    newItemName,
    setNewItemName,
    renamingItem,
    setRenamingItem,
    renameValue,
    setRenameValue,
    zipModalOpen,
    setZipModalOpen,
    zipArchiveName,
    setZipArchiveName,
    extractModalOpen,
    setExtractModalOpen,
    extractTargetDir,
    setExtractTargetDir,
    chmodModalOpen,
    setChmodModalOpen,
    chmodValue,
    setChmodValue,
    bookmarks,
    bookmarkBackendMissing,
    bookmarkPathSet,
    canGoBack,
    canGoForward,
    selectedSize,
    fsVersion,
    conflict,
    resolveConflict,
    uploads,
    cancelUpload,
    retryUpload,
    clearFinishedUploads,
    previewPath,
    setPreviewPath,
    previewItems,
    anyModalOpen,
    navigateTo,
    navigateToTyped,
    goBack,
    goForward,
    handleGoUp,
    handleOpenItem,
    selectItem,
    handleToggleSelect,
    handleSelectAll,
    selectAll,
    moveFocus,
    selectByPrefix,
    handleSort,
    handleEditFile,
    handleSaveFile,
    handleDownloadFile,
    handleUploadFile,
    handleUploadFolderInput,
    handleUploadFiles,
    enqueueUploads,
    handleCreateItem,
    startRename,
    handleRename,
    handleDelete,
    handleCut,
    handleCopy,
    handlePaste,
    transferItems,
    copyPaths,
    openZip,
    handleZip,
    openExtract,
    handleExtract,
    openChmod,
    handleChmod,
    toggleBookmarkForItem,
    removeBookmarkByPath,
    bookmarkCurrentDirectory,
    bookmarkSelection,
    openBookmark,
    clearSelection: () => setSelectedPaths([]),
    refresh: () => void reload(),
  };
}

export type FileManagerState = ReturnType<typeof useFileManager>;
