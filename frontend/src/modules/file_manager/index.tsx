/**
 * File Manager - Complete Component
 * Premium file explorer with advanced editing and action capabilities.
 * Synchronized with the global Light/Dark theme and En/Vi languages.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import * as Icons from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

interface BookmarkEntry {
  path: string;
  is_dir: boolean;
  label?: string;
}

/** Per-row actions: distinct icons (rename ≠ cut) and larger tap targets when `touch` */
function FileActionsBar({
  item,
  isDark,
  touch,
  tr,
  bookmarked,
  bookmarksUiEnabled,
  onEdit,
  onDownload,
  onRename,
  onBookmarkToggle,
  onCut,
  onCopy,
  onDelete,
}: {
  item: FileItem;
  isDark: boolean;
  touch: boolean;
  bookmarked: boolean;
  /** False when server has no /bookmarks API (old module). Hides bookmark control. */
  bookmarksUiEnabled: boolean;
  tr: {
    editFile: string;
    renameItem: string;
    cut: string;
    copy: string;
    deleteItem: string;
    downloadFile: string;
    addBookmark: string;
    removeBookmark: string;
  };
  onEdit: () => void;
  onDownload: () => void;
  onRename: () => void;
  onBookmarkToggle: () => void;
  onCut: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const pad = touch ? 'min-h-[44px] min-w-[44px] p-2.5 justify-center' : 'p-1.5';
  const icon = touch ? 'w-5 h-5' : 'w-4 h-4';
  const shell = (extra: string) =>
    `${pad} rounded-xl border transition-all flex items-center gap-0 shrink-0 ${extra}`;

  return (
    <div className={`flex items-center justify-center gap-1.5 ${touch ? 'flex-wrap' : 'flex-wrap'}`}>
      {!item.is_dir && (
        <button
          type="button"
          onClick={onEdit}
          className={shell(
            isDark
              ? 'bg-slate-800/60 hover:bg-slate-700 text-blue-400 border-slate-700/60'
              : 'bg-slate-100 hover:bg-slate-200 text-blue-600 border-slate-200'
          )}
          title={tr.editFile}
          aria-label={tr.editFile}
        >
          <Icons.FileEdit className={icon} />
        </button>
      )}
      {!item.is_dir && (
        <button
          type="button"
          onClick={onDownload}
          className={shell(
            isDark
              ? 'bg-slate-800/60 hover:bg-slate-700 text-emerald-400 border-slate-700/60'
              : 'bg-slate-100 hover:bg-slate-200 text-emerald-600 border-slate-200'
          )}
          title={tr.downloadFile}
          aria-label={tr.downloadFile}
        >
          <Icons.Download className={icon} />
        </button>
      )}
      <button
        type="button"
        onClick={onRename}
        className={shell(
          isDark
            ? 'bg-slate-800/60 hover:bg-slate-700 text-violet-400 border-slate-700/60'
            : 'bg-slate-100 hover:bg-slate-200 text-violet-600 border-slate-200'
        )}
        title={tr.renameItem}
        aria-label={tr.renameItem}
      >
        <Icons.PencilLine className={icon} />
      </button>
      {bookmarksUiEnabled && (
        <button
          type="button"
          onClick={onBookmarkToggle}
          className={shell(
            bookmarked
              ? isDark
                ? 'bg-amber-950/50 hover:bg-amber-900/40 text-amber-300 border-amber-800/50'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
              : isDark
                ? 'bg-slate-800/60 hover:bg-slate-700 text-slate-400 border-slate-700/60'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
          )}
          title={bookmarked ? tr.removeBookmark : tr.addBookmark}
          aria-label={bookmarked ? tr.removeBookmark : tr.addBookmark}
        >
          <Icons.Bookmark className={`${icon} ${bookmarked ? 'fill-current' : ''}`} />
        </button>
      )}
      <button
        type="button"
        onClick={onCut}
        className={shell(
          isDark
            ? 'bg-slate-800/60 hover:bg-slate-700 text-amber-400 border-slate-700/60'
            : 'bg-slate-100 hover:bg-slate-200 text-amber-600 border-slate-200'
        )}
        title={tr.cut}
        aria-label={tr.cut}
      >
        <Icons.Scissors className={icon} />
      </button>
      <button
        type="button"
        onClick={onCopy}
        className={shell(
          isDark
            ? 'bg-slate-800/60 hover:bg-slate-700 text-indigo-400 border-slate-700/60'
            : 'bg-slate-100 hover:bg-slate-200 text-indigo-600 border-slate-200'
        )}
        title={tr.copy}
        aria-label={tr.copy}
      >
        <Icons.Copy className={icon} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className={shell(
          isDark
            ? 'bg-red-950/50 hover:bg-red-900/60 text-red-300 border-red-800/60'
            : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
        )}
        title={tr.deleteItem}
        aria-label={tr.deleteItem}
      >
        <Icons.Trash2 className={icon} />
      </button>
    </div>
  );
}

export default function FileManagerDashboard() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sort state: column + direction
  type SortKey = 'name' | 'size' | 'modified';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const { theme, language } = useAppShellContext();

  // Modals / Dialogs state
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [createType, setCreateType] = useState<'file' | 'dir' | null>(null);
  const [newItemName, setNewItemName] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [renamingItem, setRenamingItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // Multi-Selection Checkboxes & Clipboard
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<{ paths: string[]; action: 'cut' | 'copy' } | null>(null);

  // Additional action modals
  const [zipModalOpen, setZipModalOpen] = useState<boolean>(false);
  const [zipArchiveName, setZipArchiveName] = useState<string>('');
  const [extractModalOpen, setExtractModalOpen] = useState<boolean>(false);
  const [extractTargetDir, setExtractTargetDir] = useState<string>('');
  const [chmodModalOpen, setChmodModalOpen] = useState<boolean>(false);
  const [chmodValue, setChmodValue] = useState<string>('755');

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  /** True when GET/PUT /bookmarks returns 404 (old backend without bookmark routes). */
  const [bookmarkBackendMissing, setBookmarkBackendMissing] = useState(false);

  // Translation Dictionaries
  const t = {
    en: {
      title: 'File Explorer',
      description: 'View, modify, copy, move, zip, extract, delete, and manage permissions for files and folders with advanced multi-select capability.',
      createFile: 'Create File',
      createDir: 'Create Dir',
      refresh: 'Refresh current path',
      goUp: 'Go Up One Level',
      go: 'Go',
      paste: 'Paste',
      cancel: 'Cancel',
      deselect: 'Deselect',
      itemsSelected: 'items selected',
      itemsTo: 'items to',
      loading: 'Loading contents...',
      errorLoading: 'Error loading directory contents:',
      noFiles: 'No files or folders in this directory.',
      name: 'Name',
      size: 'Size',
      dateModified: 'Date Modified',
      actions: 'Actions',
      editFile: 'Edit file',
      renameItem: 'Rename item',
      cut: 'Cut / Move',
      copy: 'Copy item',
      deleteItem: 'Delete item',
      createTitleFile: 'Create New File',
      createTitleDir: 'Create New Directory',
      labelName: 'Name',
      createButton: 'Create',
      renameTitle: 'Rename Item',
      renameLabel: 'New Name',
      renameButton: 'Rename',
      editing: 'Editing:',
      saveChanges: 'Save Changes',
      zipTitle: 'Compress into ZIP',
      zipLabel: 'Archive File Name',
      zipButton: 'Compress',
      extractTitle: 'Extract ZIP Archive',
      extractLabel: 'Destination Path',
      extractButton: 'Extract',
      chmodTitle: 'Change Permissions (Chmod)',
      chmodLabel: 'Mode String',
      chmodButton: 'Apply',
      upload: 'Upload',
      downloadFile: 'Download file',
      selectAllTitle: 'Select or deselect all',
      zipLabelShort: 'Zip',
      chmodLabelShort: 'Chmod',
      bookmarksTitle: 'Bookmarks',
      bookmarksEmpty: 'Save folders or files you open often. Use the bookmark icon on each row or bookmark this folder.',
      bookmarkFolder: 'Bookmark folder',
      bookmarkFolderToggle: 'Remove folder bookmark',
      addBookmark: 'Add bookmark',
      removeBookmark: 'Remove bookmark',
      bookmarkSelection: 'Bookmark selected',
      bookmarksMaxError: 'Bookmark limit reached (100). Remove some before adding more.',
      bookmarksUpgradeHint:
        'The server is running an older File Manager without bookmark APIs. Install or update the File Manager module to v1.0.2 or newer from the App Store (or redeploy backend/router.py). Path bookmarks will stay unavailable until then.',
    },
    vi: {
      title: 'Quản lý File',
      description: 'Xem, sửa, sao chép, di chuyển, nén zip, giải nén, xóa và quản lý quyền của các file và thư mục với khả năng chọn nhiều file nâng cao.',
      createFile: 'Tạo File',
      createDir: 'Tạo Thư mục',
      refresh: 'Làm mới đường dẫn hiện tại',
      goUp: 'Lên một cấp',
      go: 'Đi',
      paste: 'Dán',
      cancel: 'Hủy',
      deselect: 'Bỏ chọn',
      itemsSelected: 'mục được chọn',
      itemsTo: 'mục để',
      loading: 'Đang tải nội dung...',
      errorLoading: 'Lỗi khi tải nội dung thư mục:',
      noFiles: 'Không có file hoặc thư mục nào trong thư mục này.',
      name: 'Tên',
      size: 'Kích thước',
      dateModified: 'Ngày sửa đổi',
      actions: 'Hành động',
      editFile: 'Sửa file',
      renameItem: 'Đổi tên',
      cut: 'Cắt / Di chuyển',
      copy: 'Sao chép',
      deleteItem: 'Xóa',
      createTitleFile: 'Tạo file mới',
      createTitleDir: 'Tạo thư mục mới',
      labelName: 'Tên',
      createButton: 'Tạo mới',
      renameTitle: 'Đổi tên mục',
      renameLabel: 'Tên mới',
      renameButton: 'Đổi tên',
      editing: 'Đang sửa:',
      saveChanges: 'Lưu thay đổi',
      zipTitle: 'Nén thành ZIP',
      zipLabel: 'Tên file ZIP',
      zipButton: 'Nén',
      extractTitle: 'Giải nén file ZIP',
      extractLabel: 'Đường dẫn đích',
      extractButton: 'Giải nén',
      chmodTitle: 'Thay đổi quyền (Chmod)',
      chmodLabel: 'Mã quyền (Mode)',
      chmodButton: 'Áp dụng',
      upload: 'Tải lên',
      downloadFile: 'Tải xuống file',
      selectAllTitle: 'Chọn / bỏ chọn tất cả',
      zipLabelShort: 'Nén ZIP',
      chmodLabelShort: 'Quyền',
      bookmarksTitle: 'Đánh dấu',
      bookmarksEmpty: 'Lưu thư mục hoặc file hay dùng. Dùng icon bookmark trên mỗi dòng hoặc đánh dấu thư mục hiện tại.',
      bookmarkFolder: 'Đánh dấu thư mục này',
      bookmarkFolderToggle: 'Bỏ đánh dấu thư mục',
      addBookmark: 'Thêm bookmark',
      removeBookmark: 'Xóa bookmark',
      bookmarkSelection: 'Bookmark các mục đã chọn',
      bookmarksMaxError: 'Đã đủ 100 bookmark. Xóa bớt trước khi thêm.',
      bookmarksUpgradeHint:
        'Máy chủ đang chạy File Manager cũ, chưa có API bookmark. Hãy cài hoặc cập nhật module File Manager lên ≥ v1.0.2 qua App Store (hoặc triển khai lại backend có router.py mới). Cho đến khi cập nhật, tính đánh dấu không dùng được.',
    },
  };

  const tr = t[language];
  const isDark = theme === 'dark';

  const joinPath = (parent: string, child: string) => {
    if (!parent || parent === '/') return `/${child}`;
    return `${parent.replace(/[\\/]+$/, '')}/${child}`;
  };

  const parentDir = (fullPath: string): string => {
    const norm = fullPath.replace(/[\\/]+$/, '');
    if (!norm) return '/';
    const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
    if (idx < 0) {
      if (/^[A-Za-z]:$/.test(norm)) return `${norm}\\`;
      return norm;
    }
    if (idx === 0) return '/';
    const candidate = norm.slice(0, idx);
    if (candidate.length === 2 && candidate[1] === ':') {
      return `${candidate}\\`;
    }
    return candidate || '/';
  };

  const bookmarkPathSet = useMemo(() => new Set(bookmarks.map((b) => b.path)), [bookmarks]);

  // Get token helper
  const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem('copanel_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  // Fetch current path on load or path change
  const fetchPath = async (path: string = '') => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/file_manager/list${path ? `?path=${encodeURIComponent(path)}` : ''}`;
      const response = await fetch(url, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to list directory');
      }
      const data = await response.json();
      setCurrentPath(data.path || '');
      setFiles(data.files || []);
      setSelectedPaths([]); // Clear selections upon navigation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPath();
  }, []);

  const loadBookmarks = async () => {
    try {
      const res = await fetch('/api/file_manager/bookmarks', {
        headers: getAuthHeader(),
      });
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
  };

  useEffect(() => {
    loadBookmarks();
  }, []);

  const persistBookmarks = async (next: BookmarkEntry[]) => {
    if (bookmarkBackendMissing) {
      alert(tr.bookmarksUpgradeHint);
      return;
    }
    try {
      const res = await fetch('/api/file_manager/bookmarks', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          bookmarks: next.map((b) => ({
            path: b.path,
            is_dir: b.is_dir,
            label: b.label ?? '',
          })),
        }),
      });
      if (res.status === 404) {
        setBookmarkBackendMissing(true);
        alert(tr.bookmarksUpgradeHint);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        const raw = data.detail || 'Failed to save bookmarks';
        if (
          res.status === 404 ||
          (typeof raw === 'string' && raw.toLowerCase().includes('not found'))
        ) {
          setBookmarkBackendMissing(true);
          alert(tr.bookmarksUpgradeHint);
          return;
        }
        throw new Error(typeof raw === 'string' ? raw : 'Failed to save bookmarks');
      }
      setBookmarkBackendMissing(false);
      const data = (await res.json()) as { bookmarks?: BookmarkEntry[] };
      setBookmarks(data.bookmarks ?? next);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bookmarks save failed');
    }
  };

  const toggleBookmarkForItem = async (item: FileItem) => {
    const exists = bookmarks.some((b) => b.path === item.path);
    let next: BookmarkEntry[];
    if (exists) {
      next = bookmarks.filter((b) => b.path !== item.path);
    } else {
      if (bookmarks.length >= 100) {
        alert(t[language].bookmarksMaxError);
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
    const exists = bookmarks.some((b) => b.path === currentPath);
    if (exists) {
      await persistBookmarks(bookmarks.filter((b) => b.path !== currentPath));
      return;
    }
    if (bookmarks.length >= 100) {
      alert(t[language].bookmarksMaxError);
      return;
    }
    const parts = currentPath.replace(/[\\/]+$/, '').split(/[\\/]/);
    const base = parts.filter(Boolean).pop() || currentPath;
    await persistBookmarks([...bookmarks, { path: currentPath, is_dir: true, label: base }]);
  };

  const bookmarkSelection = async () => {
    if (selectedPaths.length === 0) return;
    let next = [...bookmarks];
    for (const p of selectedPaths) {
      const item = files.find((f) => f.path === p);
      if (!item) continue;
      if (next.some((b) => b.path === item.path)) continue;
      if (next.length >= 100) {
        alert(t[language].bookmarksMaxError);
        return;
      }
      next.push({ path: item.path, is_dir: item.is_dir, label: item.name });
    }
    if (next.length === bookmarks.length) return;
    await persistBookmarks(next);
  };

  const openBookmark = async (b: BookmarkEntry) => {
    if (b.is_dir) {
      fetchPath(b.path);
      return;
    }
    const dir = parentDir(b.path);
    await fetchPath(dir);
    const name = (b.label && b.label.trim()) || b.path.split(/[\\/]/).pop() || '';
    void handleEditFile({
      path: b.path,
      name,
      is_dir: false,
      size: 0,
      modified: 0,
    });
  };

  // Handlers for file management actions
  const handleOpenFolder = (path: string) => {
    fetchPath(path);
  };

  const handleGoUp = () => {
    if (!currentPath) return;
    const norm = currentPath.replace(/[\\/]+$/, '');
    const parts = norm.split(/[\\/]/);
    parts.pop();
    const upPath = parts.join('/') || '/';
    fetchPath(upPath);
  };

  // Checkbox management
  const handleToggleSelect = (path: string) => {
    if (selectedPaths.includes(path)) {
      setSelectedPaths(selectedPaths.filter((p) => p !== path));
    } else {
      setSelectedPaths([...selectedPaths, path]);
    }
  };

  const handleSelectAll = () => {
    if (selectedPaths.length === files.length && files.length > 0) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(files.map((f) => f.path));
    }
  };

  // 📝 Open File Editor
  const handleEditFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/read?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader()
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

  // 📝 Save File Content
  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      const res = await fetch('/api/file_manager/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({ path: editingFile, content: fileContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save changes');
      }
      setEditingFile(null);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error saving file');
    }
  };

  // 📥 Download File
  const handleDownloadFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/download?path=${encodeURIComponent(item.path)}`, {
        headers: getAuthHeader()
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Could not download file');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error downloading file');
    }
  };

  // 📤 Upload File
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/file_manager/upload?path=${encodeURIComponent(currentPath)}`, true);

    const headers = getAuthHeader();
    Object.keys(headers).forEach((key) => {
      xhr.setRequestHeader(key, headers[key]);
    });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        fetchPath(currentPath);
      } else {
        let errMessage = 'Upload failed';
        try {
          const data = JSON.parse(xhr.responseText);
          errMessage = data.detail || errMessage;
        } catch {}
        alert(errMessage);
      }
    };

    xhr.onerror = () => {
      setUploadProgress(null);
      alert('Network error occurred while uploading file');
    };

    xhr.send(formData);
  };

  // ➕ Create Item
  const handleCreateItem = async () => {
    if (!newItemName) return;
    const itemPath = `${currentPath.replace(/[\\/]+$/, '')}/${newItemName}`;
    try {
      const endpoint = createType === 'file' ? 'create-file' : 'create-dir';
      const res = await fetch(`/api/file_manager/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({ path: itemPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Action failed');
      }
      setNewItemName('');
      setCreateType(null);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating item');
    }
  };

  // ✏️ Rename Item
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
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({ old_path: renamingItem.path, new_path: newPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Rename failed');
      }
      setRenamingItem(null);
      setRenameValue('');
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error renaming item');
    }
  };

  // 🗑️ Delete Item (Single or Multiple)
  const handleDelete = async (item?: FileItem) => {
    const pathsToDelete = item ? [item.path] : selectedPaths;
    if (pathsToDelete.length === 0) return;
    const itemLabel = pathsToDelete.length === 1 ? `"${item?.name || pathsToDelete[0]}"` : `${pathsToDelete.length} items`;
    if (!confirm(`Are you sure you want to delete ${itemLabel}?`)) return;

    try {
      const res = await fetch('/api/file_manager/delete-multiple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({ paths: pathsToDelete }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Delete failed');
      }
      setSelectedPaths([]);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting item');
    }
  };

  // Clipboard Actions (Cut / Copy)
  const handleCut = (item?: FileItem) => {
    const paths = item ? [item.path] : selectedPaths;
    if (paths.length === 0) return;
    setClipboard({ paths, action: 'cut' });
    setSelectedPaths([]);
  };

  const handleCopy = (item?: FileItem) => {
    const paths = item ? [item.path] : selectedPaths;
    if (paths.length === 0) return;
    setClipboard({ paths, action: 'copy' });
    setSelectedPaths([]);
  };

  // 📋 Paste (Multi or Single items)
  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      const endpoint = clipboard.action === 'cut' ? 'move-multiple' : 'copy';
      const res = await fetch(`/api/file_manager/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          source_paths: clipboard.paths,
          target_dir: currentPath
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Paste failed');
      }
      setClipboard(null);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error executing paste');
    }
  };

  // 🗜️ Zip action handler
  const handleZip = async () => {
    if (!zipArchiveName || selectedPaths.length === 0) return;
    const parentPath = currentPath.replace(/[\\/]+$/, '');
    const archiveFullPath = `${parentPath}/${zipArchiveName}`;
    try {
      const res = await fetch('/api/file_manager/zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          paths: selectedPaths,
          archive_path: archiveFullPath
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Zip compression failed');
      }
      setZipModalOpen(false);
      setZipArchiveName('');
      setSelectedPaths([]);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error compressing files');
    }
  };

  // 📂 Extract action handler
  const handleExtract = async () => {
    const zipPath = selectedPaths[0] || (files.find((f) => f.path.toLowerCase().endsWith('.zip'))?.path);
    if (!zipPath || !extractTargetDir) return;
    try {
      const res = await fetch('/api/file_manager/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          archive_path: zipPath,
          target_dir: extractTargetDir
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Extraction failed');
      }
      setExtractModalOpen(false);
      setSelectedPaths([]);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error extracting file');
    }
  };

  // 🛡️ Chmod action handler
  const handleChmod = async () => {
    if (selectedPaths.length === 0 || !chmodValue) return;
    try {
      const res = await fetch('/api/file_manager/chmod', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          paths: selectedPaths,
          mode: chmodValue
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Permissions change failed');
      }
      setChmodModalOpen(false);
      setSelectedPaths([]);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error updating permissions');
    }
  };

  // Toggle sort column / direction
  const handleSort = (key: 'name' | 'size' | 'modified') => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // Sorted file list: folders always first, then sorted by chosen column
  const sortedFiles = useMemo(() => {
    const dirs = files.filter((f) => f.is_dir);
    const regular = files.filter((f) => !f.is_dir);
    const compare = (a: FileItem, b: FileItem): number => {
      let result = 0;
      if (sortKey === 'name') {
        result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortKey === 'size') {
        result = a.size - b.size;
      } else if (sortKey === 'modified') {
        result = a.modified - b.modified;
      }
      return sortAsc ? result : -result;
    };
    return [...dirs.sort(compare), ...regular.sort(compare)];
  }, [files, sortKey, sortAsc]);

  // Format File Size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format Date String
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const containerStyle = isDark ? 'text-slate-100' : 'text-slate-900';

  return (
    <ModuleViewport constrained className={`p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-8 select-none transition-colors duration-200 pb-8`}>
    <div className={containerStyle}>
      {/* Top Header */}
      <div className={`relative overflow-hidden p-4 sm:p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 sm:gap-6 border transition-colors duration-200 ${
        isDark
          ? 'bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border-slate-800'
          : 'bg-gradient-to-br from-blue-50/60 via-slate-50 to-white border-slate-200'
      }`}>
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <h1 className={`text-xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2 min-w-0 ${
              isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'text-slate-900'
            }`}>
              <Icons.Folder className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              <span className="truncate">{tr.title}</span>
            </h1>
          </div>
          <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-xs sm:text-sm md:text-base leading-relaxed max-w-xl line-clamp-4 sm:line-clamp-none`}>
            {tr.description}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 w-full lg:w-auto lg:max-w-none">
          <button
            type="button"
            onClick={() => setCreateType('file')}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 sm:px-4 py-3 sm:py-2.5 rounded-xl font-bold text-xs transition shadow-lg hover:shadow-blue-500/20 min-h-[44px] sm:min-h-0"
          >
            <Icons.FilePlus className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.createFile}</span>
          </button>
          <button
            type="button"
            onClick={() => setCreateType('dir')}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-3 sm:py-2.5 rounded-xl font-bold text-xs transition min-h-[44px] sm:min-h-0 ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            <Icons.FolderPlus className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.createDir}</span>
          </button>
          <label
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-3 sm:py-2.5 rounded-xl font-bold text-xs transition cursor-pointer min-h-[44px] sm:min-h-0 col-span-2 sm:col-span-1 sm:flex-initial ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            <Icons.Upload className="w-4 h-4 shrink-0" /> {tr.upload}
            <input type="file" className="hidden" onChange={handleUploadFile} />
          </label>
          <button
            type="button"
            onClick={() => fetchPath(currentPath)}
            className={`flex items-center justify-center p-3 rounded-xl transition min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-self-center sm:justify-self-auto ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }`}
            title={tr.refresh}
            aria-label={tr.refresh}
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Path Bar & Paste Banner */}
      <div className="flex flex-col gap-4">
        <div className={`border rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 backdrop-blur-sm ${
          isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleGoUp}
              disabled={!currentPath || currentPath === '/' || currentPath.includes(':')}
              className={`p-2.5 sm:p-2 rounded-xl disabled:opacity-50 transition min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
              }`}
              title={tr.goUp}
              aria-label={tr.goUp}
            >
              <Icons.CornerUpLeft className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
            <span className="text-slate-500 px-1 font-semibold select-none hidden sm:inline">/</span>
          </div>
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchPath(currentPath)}
            className={`w-full sm:flex-1 min-w-0 px-4 py-3 sm:py-2 rounded-xl outline-none text-xs font-mono transition-all ${
              isDark
                ? 'bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 text-slate-200'
                : 'bg-slate-50 border border-slate-200 focus:border-blue-500 text-slate-800'
            }`}
            placeholder="e.g. /home/user or C:\"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => fetchPath(currentPath)}
            className="px-4 py-3 sm:py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-xl text-white font-bold text-xs transition shadow-lg hover:shadow-blue-500/20 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
          >
            {tr.go}
          </button>
        </div>

        <div
          className={`rounded-2xl border p-3 sm:p-4 backdrop-blur-sm ${
            isDark ? 'bg-slate-900/30 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
          }`}
        >
          {bookmarkBackendMissing && (
            <div
              className={`mb-3 flex gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
                isDark
                  ? 'border-amber-800/50 bg-amber-950/25 text-amber-100'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              }`}
              role="status"
            >
              <Icons.AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" aria-hidden />
              <p>{tr.bookmarksUpgradeHint}</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Icons.Bookmark className={`w-5 h-5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {tr.bookmarksTitle}
              </span>
            </div>
            <button
              type="button"
              disabled={!currentPath || bookmarkBackendMissing}
              onClick={() => void bookmarkCurrentDirectory()}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition border min-h-[44px] sm:min-h-0 disabled:opacity-40 ${
                currentPath && bookmarkPathSet.has(currentPath)
                  ? isDark
                    ? 'bg-amber-950/40 border-amber-800/50 text-amber-200 hover:bg-amber-900/30'
                    : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                  : isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-slate-100 border-slate-200 text-slate-800 hover:bg-slate-200'
              }`}
            >
              <Icons.Bookmark className={`w-4 h-4 ${currentPath && bookmarkPathSet.has(currentPath) ? 'fill-current' : ''}`} />
              {currentPath && bookmarkPathSet.has(currentPath) ? tr.bookmarkFolderToggle : tr.bookmarkFolder}
            </button>
          </div>
          {bookmarkBackendMissing ? null : bookmarks.length === 0 ? (
            <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.bookmarksEmpty}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bookmarks.map((b) => (
                <div
                  key={b.path}
                  className={`inline-flex items-center gap-1 max-w-full rounded-xl border px-2 py-1.5 text-xs font-medium ${
                    isDark ? 'border-slate-700 bg-slate-950/40 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openBookmark(b)}
                    className={`flex items-center gap-1.5 min-w-0 text-left font-semibold transition ${
                      isDark ? 'hover:text-amber-300 text-slate-100' : 'hover:text-amber-700 text-slate-800'
                    }`}
                    title={b.path}
                  >
                    {b.is_dir ? (
                      <Icons.Folder className="w-4 h-4 shrink-0 text-blue-400" />
                    ) : (
                      <Icons.File className="w-4 h-4 shrink-0 text-slate-400" />
                    )}
                    <span className="truncate max-w-[200px] sm:max-w-xs">
                      {(b.label && b.label.trim()) || b.path.split(/[\\/]/).pop() || b.path}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeBookmarkByPath(b.path)}
                    className={`shrink-0 rounded-lg p-1.5 transition ${
                      isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-200 text-slate-500'
                    }`}
                    title={tr.removeBookmark}
                    aria-label={tr.removeBookmark}
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {uploadProgress !== null && (
          <div className={`p-4 rounded-xl flex flex-col gap-2 backdrop-blur-sm shadow-xl select-none border animate-pulse ${
            isDark ? 'bg-blue-950/30 border-blue-800/60' : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}>
            <div className="flex justify-between text-xs font-semibold">
              <span className={isDark ? 'text-blue-300' : 'text-blue-800'}>Uploading file...</span>
              <span className={isDark ? 'text-blue-300' : 'text-blue-800'}>{uploadProgress}%</span>
            </div>
            <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div className="bg-blue-600 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        )}

        {clipboard && (
          <div className={`p-3 sm:p-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 backdrop-blur-sm animate-fade-in shadow-xl select-none border ${
            isDark ? 'bg-amber-950/30 border-amber-800/40' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              {clipboard.action === 'cut' ? (
                <Icons.Scissors className="w-6 h-6 text-amber-500 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
              ) : (
                <Icons.Copy className="w-6 h-6 text-amber-500 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
              )}
              <span className={`text-xs font-semibold leading-relaxed ${isDark ? 'text-amber-100' : 'text-amber-800'}`}>
                {clipboard.paths.length} {tr.itemsTo} {clipboard.action === 'cut' ? tr.cut : tr.copy}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handlePaste}
                className={`flex items-center justify-center gap-2 px-4 py-3 sm:py-1.5 font-bold rounded-lg transition shadow min-h-[44px] sm:min-h-0 ${
                  isDark ? 'bg-amber-600/30 hover:bg-amber-500/40 text-amber-100 border border-amber-500/30' : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300'
                }`}
              >
                <Icons.ClipboardPaste className="w-5 h-5 sm:w-3.5 sm:h-3.5 shrink-0" /> {tr.paste}
              </button>
              <button
                type="button"
                onClick={() => setClipboard(null)}
                className={`px-4 py-3 sm:py-1.5 rounded-lg text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
                }`}
              >
                {tr.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Multi Selection Actions Toolbar */}
      {selectedPaths.length > 0 && (
        <div className={`p-3 sm:p-4 rounded-xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-fade-in select-none border ${
          isDark ? 'bg-blue-950/40 border-blue-800/60' : 'bg-blue-50 border-blue-200 text-blue-900'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            <Icons.CheckSquare className="w-5 h-5 text-blue-500 shrink-0" />
            <span className={`text-xs font-semibold truncate ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
              {selectedPaths.length} {tr.itemsSelected}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleCut()}
              className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-amber-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-amber-800 border-slate-300'
              }`}
            >
              <Icons.Scissors className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.cut}</span>
            </button>
            <button
              type="button"
              onClick={() => handleCopy()}
              className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-indigo-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-indigo-800 border-slate-300'
              }`}
            >
              <Icons.Copy className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.copy}</span>
            </button>
            {!bookmarkBackendMissing && (
              <button
                type="button"
                onClick={() => void bookmarkSelection()}
                className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                  isDark
                    ? 'bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 border-amber-800/50'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                }`}
              >
                <Icons.Bookmark className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.bookmarkSelection}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setZipArchiveName('archive.zip');
                setZipModalOpen(true);
              }}
              className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Archive className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.zipLabelShort}</span>
            </button>
            {selectedPaths.length === 1 && selectedPaths[0].toLowerCase().endsWith('.zip') && (
              <button
                type="button"
                onClick={() => {
                  setExtractTargetDir(currentPath);
                  setExtractModalOpen(true);
                }}
                className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 col-span-2 sm:col-span-1 ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                }`}
              >
                <Icons.FolderDown className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.extractButton}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setChmodValue('755');
                setChmodModalOpen(true);
              }}
              className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Lock className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.chmodLabelShort}</span>
            </button>
            <button
              type="button"
              onClick={() => handleDelete()}
              className={`flex items-center justify-center gap-2 px-3 py-3 sm:py-1.5 rounded-lg border text-xs font-bold transition duration-150 min-h-[44px] sm:min-h-0 col-span-2 sm:col-span-1 ${
                isDark
                  ? 'bg-red-950/40 hover:bg-red-900/60 border-red-800/60 text-red-200'
                  : 'bg-red-100 hover:bg-red-200 border-red-300 text-red-800'
              }`}
            >
              <Icons.Trash2 className="w-4 h-4 shrink-0" /> <span className="truncate">{tr.deleteItem}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaths([])}
              className={`col-span-2 sm:col-span-1 text-xs py-2 sm:py-0 font-bold transition min-h-[44px] sm:min-h-0 flex items-center justify-center sm:justify-start sm:px-2 ${
                isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tr.deselect}
            </button>
          </div>
        </div>
      )}

      {/* Loader / Empty States */}
      {loading && files.length === 0 ? (
        <div className={`flex flex-col items-center justify-center h-64 border rounded-2xl ${
          isDark ? 'border-slate-800/60 bg-slate-900/30' : 'border-slate-200 bg-white shadow-sm'
        }`}>
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-xs`}>{tr.loading}</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/30 border border-red-500/20 p-4 rounded-xl text-red-400 text-xs flex items-center gap-2 max-w-2xl animate-fade-in">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>{tr.errorLoading} {error}</span>
        </div>
      ) : (
        <div className={`border rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl transition-colors duration-200 ${
          isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          {/* Mobile: card list */}
          <div className={`md:hidden divide-y ${isDark ? 'divide-slate-800/50' : 'divide-slate-200'}`}>
            {files.length > 0 && (
              <div
                className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
                  isDark ? 'bg-slate-950/40' : 'bg-slate-50'
                }`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                  {tr.name}
                </span>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition min-h-[40px] ${
                    isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                  title={tr.selectAllTitle}
                >
                  {selectedPaths.length === files.length && files.length > 0 ? (
                    <Icons.CheckSquare className="w-5 h-5 text-blue-500" />
                  ) : (
                    <Icons.Square className="w-5 h-5" />
                  )}
                  <span className="hidden min-[400px]:inline">{tr.selectAllTitle}</span>
                </button>
              </div>
            )}
            {sortedFiles.length === 0 ? (
              <div className={`p-10 text-center text-xs select-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {tr.noFiles}
              </div>
            ) : (
              sortedFiles.map((item, idx) => {
                const isChecked = selectedPaths.includes(item.path);
                return (
                  <div
                    key={item.path || idx}
                    className={`transition-colors ${
                      isDark
                        ? isChecked
                          ? 'bg-blue-900/25'
                          : ''
                        : isChecked
                          ? 'bg-blue-50'
                          : ''
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleToggleSelect(item.path)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleSelect(item.path);
                        }
                      }}
                      className={`flex items-start gap-2 p-3 cursor-pointer active:opacity-90 ${
                        isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-100/80'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(item.path);
                        }}
                        className={`shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition ${
                          isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-200 text-slate-500'
                        }`}
                        aria-pressed={isChecked}
                      >
                        {isChecked ? (
                          <Icons.CheckSquare className="w-5 h-5 text-blue-500" />
                        ) : (
                          <Icons.Square className="w-5 h-5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0 pt-0.5">
                        {item.is_dir ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFolder(item.path);
                            }}
                            className={`flex items-center gap-2 text-left font-bold text-sm w-full min-w-0 select-none ${
                              isDark ? 'text-blue-400 active:text-blue-300' : 'text-blue-600 active:text-blue-500'
                            }`}
                          >
                            <Icons.Folder
                              className={`w-6 h-6 shrink-0 ${isDark ? 'fill-blue-500/20 text-blue-400' : 'fill-blue-100 text-blue-600'}`}
                            />
                            <span className="truncate">{item.name}</span>
                          </button>
                        ) : (
                          <div className={`flex items-center gap-2 text-sm font-medium min-w-0 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                            <Icons.File className="w-6 h-6 shrink-0 text-slate-500" />
                            <span className="truncate">{item.name}</span>
                          </div>
                        )}
                        <p className={`mt-1 text-[11px] font-mono leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                          {item.is_dir ? '—' : formatSize(item.size)}
                          <span className="mx-1 opacity-50">·</span>
                          {item.modified > 0 ? formatDate(item.modified) : '—'}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`px-3 pb-3 pt-0 ${isDark ? 'border-slate-800/40' : 'border-slate-100'} border-t border-opacity-100`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FileActionsBar
                        item={item}
                        isDark={isDark}
                        touch
                        bookmarked={bookmarkPathSet.has(item.path)}
                        bookmarksUiEnabled={!bookmarkBackendMissing}
                        tr={{
                          editFile: tr.editFile,
                          renameItem: tr.renameItem,
                          cut: tr.cut,
                          copy: tr.copy,
                          deleteItem: tr.deleteItem,
                          downloadFile: tr.downloadFile,
                          addBookmark: tr.addBookmark,
                          removeBookmark: tr.removeBookmark,
                        }}
                        onEdit={() => handleEditFile(item)}
                        onDownload={() => handleDownloadFile(item)}
                        onRename={() => {
                          setRenameValue(item.name);
                          setRenamingItem(item);
                        }}
                        onBookmarkToggle={() => void toggleBookmarkForItem(item)}
                        onCut={() => handleCut(item)}
                        onCopy={() => handleCopy(item)}
                        onDelete={() => handleDelete(item)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b text-xs uppercase tracking-wider select-none ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'
                }`}>
                  <th className="p-4 w-12 select-none">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className={`p-1 rounded-lg transition-all duration-150 ${
                        isDark ? 'hover:bg-slate-800/80 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                      }`}
                      title={tr.selectAllTitle}
                    >
                      {selectedPaths.length === files.length && files.length > 0 ? (
                        <Icons.CheckSquare className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Icons.Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  {/* Sortable: Name */}
                  <th className="p-4 font-bold select-none">
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider transition-colors ${
                        sortKey === 'name'
                          ? isDark ? 'text-blue-400' : 'text-blue-600'
                          : isDark ? 'text-slate-300 hover:text-blue-400' : 'text-slate-600 hover:text-blue-600'
                      }`}
                    >
                      {tr.name}
                      <span className={`transition-transform duration-150 ${
                        sortKey === 'name' ? (sortAsc ? 'rotate-0' : 'rotate-180') : 'opacity-30'
                      }`}>
                        <Icons.ChevronUp className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  </th>
                  {/* Sortable: Size */}
                  <th className="p-4 font-bold w-28 select-none">
                    <button
                      type="button"
                      onClick={() => handleSort('size')}
                      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider transition-colors ${
                        sortKey === 'size'
                          ? isDark ? 'text-blue-400' : 'text-blue-600'
                          : isDark ? 'text-slate-300 hover:text-blue-400' : 'text-slate-600 hover:text-blue-600'
                      }`}
                    >
                      {tr.size}
                      <span className={`transition-transform duration-150 ${
                        sortKey === 'size' ? (sortAsc ? 'rotate-0' : 'rotate-180') : 'opacity-30'
                      }`}>
                        <Icons.ChevronUp className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  </th>
                  {/* Sortable: Date Modified */}
                  <th className="p-4 font-bold w-48 select-none">
                    <button
                      type="button"
                      onClick={() => handleSort('modified')}
                      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider transition-colors ${
                        sortKey === 'modified'
                          ? isDark ? 'text-blue-400' : 'text-blue-600'
                          : isDark ? 'text-slate-300 hover:text-blue-400' : 'text-slate-600 hover:text-blue-600'
                      }`}
                    >
                      {tr.dateModified}
                      <span className={`transition-transform duration-150 ${
                        sortKey === 'modified' ? (sortAsc ? 'rotate-0' : 'rotate-180') : 'opacity-30'
                      }`}>
                        <Icons.ChevronUp className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  </th>
                  <th className="p-4 font-bold min-w-[220px] text-center select-none">{tr.actions}</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-200'}`}>
                {sortedFiles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-slate-400 text-xs select-none">
                      {tr.noFiles}
                    </td>
                  </tr>
                )}
                {sortedFiles.map((item, idx) => {
                  const isChecked = selectedPaths.includes(item.path);
                  return (
                    <tr
                      key={item.path || idx}
                      onClick={() => handleToggleSelect(item.path)}
                      className={`transition-all duration-200 cursor-pointer ${
                        isDark
                          ? `hover:bg-slate-800/20 ${isChecked ? 'bg-blue-900/20 hover:bg-blue-900/25' : ''}`
                          : `hover:bg-slate-100/50 ${isChecked ? 'bg-blue-50 hover:bg-blue-100/50' : ''}`
                      }`}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleToggleSelect(item.path)}
                          className={`p-1 rounded-lg transition-all duration-150 ${
                            isDark ? 'hover:bg-slate-800/80 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {isChecked ? (
                            <Icons.CheckSquare className="w-4 h-4 text-blue-500" />
                          ) : (
                            <Icons.Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-4">
                        {item.is_dir ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFolder(item.path);
                            }}
                            className={`flex items-center gap-3 font-bold transition-all text-xs select-none ${
                              isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'
                            }`}
                          >
                            <Icons.Folder className={`w-5 h-5 flex-shrink-0 ${isDark ? 'fill-blue-500/20 text-blue-400' : 'fill-blue-100 text-blue-600'}`} />
                            <span className="truncate max-w-sm">{item.name}</span>
                          </button>
                        ) : (
                          <div className={`flex items-center gap-3 text-xs font-medium ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                            <Icons.File className="w-5 h-5 flex-shrink-0 text-slate-500" />
                            <span className="truncate max-w-sm">{item.name}</span>
                          </div>
                        )}
                      </td>
                      <td className={`p-4 font-mono text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {item.is_dir ? '—' : formatSize(item.size)}
                      </td>
                      <td className={`p-4 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {item.modified > 0 ? formatDate(item.modified) : '—'}
                      </td>
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <FileActionsBar
                            item={item}
                            isDark={isDark}
                            touch={false}
                            bookmarked={bookmarkPathSet.has(item.path)}
                            bookmarksUiEnabled={!bookmarkBackendMissing}
                            tr={{
                              editFile: tr.editFile,
                              renameItem: tr.renameItem,
                              cut: tr.cut,
                              copy: tr.copy,
                              deleteItem: tr.deleteItem,
                              downloadFile: tr.downloadFile,
                              addBookmark: tr.addBookmark,
                              removeBookmark: tr.removeBookmark,
                            }}
                            onEdit={() => handleEditFile(item)}
                            onDownload={() => handleDownloadFile(item)}
                            onRename={() => {
                              setRenameValue(item.name);
                              setRenamingItem(item);
                            }}
                            onBookmarkToggle={() => void toggleBookmarkForItem(item)}
                            onCut={() => handleCut(item)}
                            onCopy={() => handleCopy(item)}
                            onDelete={() => handleDelete(item)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE FILE / DIRECTORY MODAL */}
      {createType && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {createType === 'file' ? (
                <>
                  <Icons.FilePlus className="w-4 h-4 text-blue-400" /> {tr.createTitleFile}
                </>
              ) : (
                <>
                  <Icons.FolderPlus className="w-4 h-4 text-blue-400" /> {tr.createTitleDir}
                </>
              )}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                {tr.labelName}
              </label>
              <input
                type="text"
                autoFocus
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateItem()}
                className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all border ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
                }`}
                placeholder={`e.g. ${createType === 'file' ? 'config.txt' : 'new-folder'}`}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setNewItemName('');
                  setCreateType(null);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleCreateItem}
                disabled={!newItemName}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.createButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {renamingItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              <Icons.PencilLine className="w-4 h-4 text-violet-400" /> {tr.renameTitle}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                {tr.renameLabel}
              </label>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all border ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
                }`}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setRenameValue('');
                  setRenamingItem(null);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleRename}
                disabled={!renameValue || renameValue === renamingItem.name}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.renameButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEXT EDITOR MODAL */}
      {editingFile && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[110] p-0 sm:p-4 animate-fade-in">
          <div className={`p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl w-full max-w-3xl h-[92dvh] sm:h-[80vh] max-h-[100dvh] flex flex-col shadow-2xl space-y-3 sm:space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className={`text-sm font-bold flex items-center gap-2 truncate max-w-lg ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                <Icons.FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>{tr.editing} {editingFile.split(/[\\/]/).pop()}</span>
              </h3>
              <button
                onClick={() => setEditingFile(null)}
                className={`${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'} transition`}
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className={`flex-1 p-4 rounded-xl outline-none font-mono text-xs resize-none transition-all border ${
                isDark
                  ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                  : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
              }`}
              placeholder="File content..."
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-2 flex-shrink-0 pt-2">
              <button
                onClick={() => setEditingFile(null)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleSaveFile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.saveChanges}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZIP MODAL */}
      {zipModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              <Icons.Archive className="w-4 h-4 text-blue-400" /> {tr.zipTitle}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                {tr.zipLabel}
              </label>
              <input
                type="text"
                autoFocus
                value={zipArchiveName}
                onChange={(e) => setZipArchiveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleZip()}
                className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all border ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
                }`}
                placeholder="e.g. backup.zip"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setZipArchiveName('');
                  setZipModalOpen(false);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleZip}
                disabled={!zipArchiveName}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.zipButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXTRACT MODAL */}
      {extractModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              <Icons.FolderDown className="w-4 h-4 text-blue-400" /> {tr.extractTitle}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                {tr.extractLabel}
              </label>
              <input
                type="text"
                autoFocus
                value={extractTargetDir}
                onChange={(e) => setExtractTargetDir(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all border ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
                }`}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setExtractTargetDir('');
                  setExtractModalOpen(false);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleExtract}
                disabled={!extractTargetDir}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.extractButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHMOD MODAL */}
      {chmodModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4 border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              <Icons.Lock className="w-4 h-4 text-blue-400" /> {tr.chmodTitle}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                {tr.chmodLabel}
              </label>
              <input
                type="text"
                autoFocus
                value={chmodValue}
                onChange={(e) => setChmodValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChmod()}
                className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs font-mono transition-all border ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800/80 focus:border-blue-500 text-slate-200'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-500 text-slate-800'
                }`}
                placeholder="e.g. 755 or 644"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setChmodValue('');
                  setChmodModalOpen(false);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleChmod}
                disabled={!chmodValue}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                {tr.chmodButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ModuleViewport>
  );
}
