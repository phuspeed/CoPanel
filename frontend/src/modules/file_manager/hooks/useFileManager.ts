import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkEntry, ClipboardState, CreateType, FileItem, SortKey, ViewMode } from '../types';
import { getFileManagerTranslations } from '../i18n';
import { formatSize, getAuthHeader, joinPath, parentDir, sortFiles } from '../utils';
import { useAppShellContext } from '../../../core/hooks/useAppShellContext';
import { useIsWindowedModule } from '../../../core/shell/WindowViewportContext';

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
  const [viewMode, setViewMode] = useState<ViewMode>(() => (windowed ? 'grid' : 'list'));
  const [filterQuery, setFilterQuery] = useState('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);

  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [zipArchiveName, setZipArchiveName] = useState('');
  const [extractModalOpen, setExtractModalOpen] = useState(false);
  const [extractTargetDir, setExtractTargetDir] = useState('');
  const [chmodModalOpen, setChmodModalOpen] = useState(false);
  const [chmodValue, setChmodValue] = useState('755');

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarkBackendMissing, setBookmarkBackendMissing] = useState(false);

  const bookmarkPathSet = useMemo(() => new Set(bookmarks.map((b) => b.path)), [bookmarks]);

  const fetchPath = useCallback(async (path: string = '', recordHistory = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/file_manager/list${path ? `?path=${encodeURIComponent(path)}` : ''}`;
      const response = await fetch(url, { headers: getAuthHeader() });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to list directory');
      }
      const data = await response.json();
      const resolved = data.path || '';
      setCurrentPath(resolved);
      setFiles(data.files || []);
      setSelectedPaths([]);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPath('', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      alert(tr.bookmarksUpgradeHint);
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
        alert(tr.bookmarksUpgradeHint);
        return;
      }
      if (!res.ok) throw new Error('Failed to save bookmarks');
      setBookmarkBackendMissing(false);
      const data = (await res.json()) as { bookmarks?: BookmarkEntry[] };
      setBookmarks(data.bookmarks ?? next);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bookmarks save failed');
    }
  };

  const navigateTo = (path: string) => void fetchPath(path, true);

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
    navigateTo(parentDir(currentPath));
  };

  const handleOpenFolder = (path: string) => navigateTo(path);

  const handleOpenItem = (item: FileItem) => {
    if (item.is_dir) handleOpenFolder(item.path);
    else void handleEditFile(item);
  };

  const handleToggleSelect = (path: string, multi = false) => {
    setSelectedPaths((prev) => {
      if (multi) {
        return prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      }
      return prev.length === 1 && prev[0] === path ? [] : [path];
    });
  };

  const handleSelectAll = () => {
    setSelectedPaths((prev) =>
      prev.length === filteredFiles.length && filteredFiles.length > 0 ? [] : filteredFiles.map((f) => f.path),
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const handleEditFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/read?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Could not read file');
      }
      const data = await res.json();
      setEditingFile(item.path);
      setFileContent(data.content || '');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error reading file');
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      const res = await fetch('/api/file_manager/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ path: editingFile, content: fileContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save');
      }
      setEditingFile(null);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error saving file');
    }
  };

  const handleDownloadFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/download?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Download failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download error');
    }
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploadProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/file_manager/upload?path=${encodeURIComponent(currentPath)}`, true);
    Object.entries(getAuthHeader()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) void fetchPath(currentPath, false);
      else alert('Upload failed');
    };
    xhr.onerror = () => {
      setUploadProgress(null);
      alert('Upload network error');
    };
    xhr.send(formData);
    e.target.value = '';
  };

  const handleCreateItem = async () => {
    if (!newItemName || !createType) return;
    const itemPath = joinPath(currentPath.replace(/[\\/]+$/, ''), newItemName);
    try {
      const endpoint = createType === 'file' ? 'create-file' : 'create-dir';
      const res = await fetch(`/api/file_manager/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ path: itemPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Create failed');
      }
      setNewItemName('');
      setCreateType(null);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Create error');
    }
  };

  const handleRename = async () => {
    if (!renamingItem) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renamingItem.name) return;
    const normalizedPath = renamingItem.path.replace(/[\\/]+$/, '');
    const splitIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
    const parentPath = splitIndex >= 0 ? normalizedPath.slice(0, splitIndex) : '';
    const newPath = joinPath(parentPath, nextName);
    try {
      const res = await fetch('/api/file_manager/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ old_path: renamingItem.path, new_path: newPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Rename failed');
      }
      setRenamingItem(null);
      setRenameValue('');
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename error');
    }
  };

  const handleDelete = async (item?: FileItem) => {
    const pathsToDelete = item ? [item.path] : selectedPaths;
    if (pathsToDelete.length === 0) return;
    const label = pathsToDelete.length === 1 ? `"${item?.name || pathsToDelete[0]}"` : `${pathsToDelete.length} items`;
    if (!confirm(`Delete ${label}?`)) return;
    try {
      const res = await fetch('/api/file_manager/delete-multiple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ paths: pathsToDelete }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Delete failed');
      }
      setSelectedPaths([]);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete error');
    }
  };

  const handleCut = (item?: FileItem) => {
    const paths = item ? [item.path] : selectedPaths;
    if (!paths.length) return;
    setClipboard({ paths, action: 'cut' });
    setSelectedPaths([]);
  };

  const handleCopy = (item?: FileItem) => {
    const paths = item ? [item.path] : selectedPaths;
    if (!paths.length) return;
    setClipboard({ paths, action: 'copy' });
    setSelectedPaths([]);
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      const endpoint = clipboard.action === 'cut' ? 'move-multiple' : 'copy';
      const res = await fetch(`/api/file_manager/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ source_paths: clipboard.paths, target_dir: currentPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Paste failed');
      }
      setClipboard(null);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Paste error');
    }
  };

  const handleZip = async () => {
    if (!zipArchiveName || !selectedPaths.length) return;
    const parentPath = currentPath.replace(/[\\/]+$/, '');
    try {
      const res = await fetch('/api/file_manager/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ paths: selectedPaths, archive_path: `${parentPath}/${zipArchiveName}` }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Zip failed');
      }
      setZipModalOpen(false);
      setZipArchiveName('');
      setSelectedPaths([]);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Zip error');
    }
  };

  const handleExtract = async () => {
    const zipPath = selectedPaths[0] || files.find((f) => f.path.toLowerCase().endsWith('.zip'))?.path;
    if (!zipPath || !extractTargetDir) return;
    try {
      const res = await fetch('/api/file_manager/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ archive_path: zipPath, target_dir: extractTargetDir }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Extract failed');
      }
      setExtractModalOpen(false);
      setSelectedPaths([]);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Extract error');
    }
  };

  const handleChmod = async () => {
    if (!selectedPaths.length || !chmodValue) return;
    try {
      const res = await fetch('/api/file_manager/chmod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ paths: selectedPaths, mode: chmodValue }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'chmod failed');
      }
      setChmodModalOpen(false);
      setSelectedPaths([]);
      void fetchPath(currentPath, false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'chmod error');
    }
  };

  const toggleBookmarkForItem = async (item: FileItem) => {
    const exists = bookmarks.some((b) => b.path === item.path);
    let next: BookmarkEntry[];
    if (exists) next = bookmarks.filter((b) => b.path !== item.path);
    else {
      if (bookmarks.length >= 100) {
        alert(tr.bookmarksMaxError);
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
      alert(tr.bookmarksMaxError);
      return;
    }
    const parts = currentPath.replace(/[\\/]+$/, '').split(/[\\/]/);
    const base = parts.filter(Boolean).pop() || currentPath;
    await persistBookmarks([...bookmarks, { path: currentPath, is_dir: true, label: base }]);
  };

  const bookmarkSelection = async () => {
    if (!selectedPaths.length) return;
    let next = [...bookmarks];
    for (const p of selectedPaths) {
      const item = files.find((f) => f.path === p);
      if (!item || next.some((b) => b.path === item.path)) continue;
      if (next.length >= 100) {
        alert(tr.bookmarksMaxError);
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
    const dir = parentDir(b.path);
    await fetchPath(dir, true);
    const name = (b.label && b.label.trim()) || b.path.split(/[\\/]/).pop() || '';
    void handleEditFile({ path: b.path, name, is_dir: false, size: 0, modified: 0 });
  };

  const sortedFiles = useMemo(() => sortFiles(files, sortKey, sortAsc), [files, sortKey, sortAsc]);

  const filteredFiles = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return sortedFiles;
    return sortedFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [sortedFiles, filterQuery]);

  const selectedSize = useMemo(() => {
    let total = 0;
    for (const p of selectedPaths) {
      const item = files.find((f) => f.path === p);
      if (item && !item.is_dir) total += item.size;
    }
    return formatSize(total);
  }, [selectedPaths, files]);

  const canGoBack = historyIndexRef.current > 0;
  const canGoForward = historyIndexRef.current < historyRef.current.length - 1;
  void historyTick;

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
    viewMode,
    setViewMode,
    filterQuery,
    setFilterQuery,
    selectedPaths,
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
    uploadProgress,
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
    navigateTo,
    goBack,
    goForward,
    handleGoUp,
    handleOpenItem,
    handleToggleSelect,
    handleSelectAll,
    handleSort,
    handleEditFile,
    handleSaveFile,
    handleDownloadFile,
    handleUploadFile,
    handleCreateItem,
    handleRename,
    handleDelete,
    handleCut,
    handleCopy,
    handlePaste,
    handleZip,
    handleExtract,
    handleChmod,
    toggleBookmarkForItem,
    removeBookmarkByPath,
    bookmarkCurrentDirectory,
    bookmarkSelection,
    openBookmark,
    clearSelection: () => setSelectedPaths([]),
    refresh: () => void fetchPath(currentPath, false),
  };
}

export type FileManagerState = ReturnType<typeof useFileManager>;
