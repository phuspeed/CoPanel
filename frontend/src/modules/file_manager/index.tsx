/**
 * File Manager - Complete Component
 * Premium file explorer with advanced editing and action capabilities.
 * Synchronized with the global Light/Dark theme and En/Vi languages.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export default function FileManagerDashboard() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Global Context synchronization fallback
  const context = useOutletContext<{
    theme: 'dark' | 'light';
    language: 'en' | 'vi';
    setTheme: (t: 'dark' | 'light') => void;
    setLanguage: (l: 'en' | 'vi') => void;
  }>();

  const [localTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('copanel_theme') as 'dark' | 'light') || 'light'
  );
  const [localLanguage] = useState<'en' | 'vi'>(
    (localStorage.getItem('copanel_lang') as 'en' | 'vi') || 'en'
  );

  const theme = context?.theme || localTheme;
  const language = context?.language || localLanguage;

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
    },
  };

  const tr = t[language];
  const isDark = theme === 'dark';

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
    if (!renamingItem || !renameValue) return;
    const parentPath = renamingItem.path.substring(0, renamingItem.path.lastIndexOf(renamingItem.name));
    const newPath = `${parentPath.replace(/[\\/]+$/, '')}/${renameValue}`;
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

  const containerStyle = isDark
    ? 'bg-slate-950 text-slate-100 min-h-screen'
    : 'bg-slate-50 text-slate-900 min-h-screen';

  return (
    <div className={`${containerStyle} p-8 max-w-7xl mx-auto space-y-8 select-none transition-colors duration-200`}>
      {/* Top Header */}
      <div className={`relative overflow-hidden p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 border transition-colors duration-200 ${
        isDark
          ? 'bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border-slate-800'
          : 'bg-gradient-to-br from-blue-50/60 via-slate-50 to-white border-slate-200'
      }`}>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className={`text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
              isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'text-slate-900'
            }`}>
              <Icons.Folder className={`w-8 h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              {tr.title}
            </h1>
          </div>
          <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-sm md:text-base leading-relaxed max-w-xl`}>
            {tr.description}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreateType('file')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition shadow-lg hover:shadow-blue-500/20 shrink-0"
          >
            <Icons.FilePlus className="w-4 h-4" /> {tr.createFile}
          </button>
          <button
            onClick={() => setCreateType('dir')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition shrink-0 ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            <Icons.FolderPlus className="w-4 h-4" /> {tr.createDir}
          </button>
          <label
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shrink-0 ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            <Icons.Upload className="w-4 h-4" /> Upload
            <input type="file" className="hidden" onChange={handleUploadFile} />
          </label>
          <button
            onClick={() => fetchPath(currentPath)}
            className={`flex items-center p-3 rounded-xl transition ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }`}
            title={tr.refresh}
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Path Bar & Paste Banner */}
      <div className="flex flex-col gap-4">
        <div className={`border rounded-2xl p-4 flex flex-wrap md:flex-row items-center gap-2 backdrop-blur-sm ${
          isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <button
            onClick={handleGoUp}
            disabled={!currentPath || currentPath === '/' || currentPath.includes(':')}
            className={`p-2 rounded-xl disabled:opacity-50 transition ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }`}
            title={tr.goUp}
          >
            <Icons.CornerUpLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-500 px-1 font-semibold select-none">/</span>
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchPath(currentPath)}
            className={`flex-1 px-4 py-2 rounded-xl outline-none text-xs font-mono transition-all ${
              isDark
                ? 'bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 text-slate-200'
                : 'bg-slate-50 border border-slate-200 focus:border-blue-500 text-slate-800'
            }`}
            placeholder="e.g. /home/user or C:\"
          />
          <button
            onClick={() => fetchPath(currentPath)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold text-xs transition shadow-lg hover:shadow-blue-500/20"
          >
            {tr.go}
          </button>
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
          <div className={`p-4 rounded-xl flex items-center justify-between gap-4 backdrop-blur-sm animate-fade-in shadow-xl select-none border ${
            isDark ? 'bg-amber-950/30 border-amber-800/40' : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center gap-2.5">
              <Icons.Clipboard className="w-5 h-5 text-amber-500 shrink-0" />
              <span className={`text-xs font-semibold leading-relaxed ${isDark ? 'text-amber-100' : 'text-amber-800'}`}>
                {clipboard.paths.length} {tr.itemsTo} {clipboard.action === 'cut' ? tr.cut : tr.copy}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePaste}
                className={`flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-lg transition shadow ${
                  isDark ? 'bg-amber-600/30 hover:bg-amber-500/40 text-amber-100 border border-amber-500/30' : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300'
                }`}
              >
                <Icons.Clipboard className="w-3.5 h-3.5" /> {tr.paste}
              </button>
              <button
                onClick={() => setClipboard(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150 ${
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
        <div className={`p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 animate-fade-in select-none border ${
          isDark ? 'bg-blue-950/40 border-blue-800/60' : 'bg-blue-50 border-blue-200 text-blue-900'
        }`}>
          <div className="flex items-center gap-2">
            <Icons.CheckSquare className="w-5 h-5 text-blue-500 shrink-0" />
            <span className={`text-xs font-semibold ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
              {selectedPaths.length} {tr.itemsSelected}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleCut()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition duration-150 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Scissors className="w-3.5 h-3.5" /> {tr.cut}
            </button>
            <button
              onClick={() => handleCopy()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition duration-150 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Copy className="w-3.5 h-3.5" /> {tr.copy}
            </button>
            <button
              onClick={() => {
                setZipArchiveName('archive.zip');
                setZipModalOpen(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition duration-150 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Archive className="w-3.5 h-3.5" /> Zip
            </button>
            {selectedPaths.length === 1 && selectedPaths[0].toLowerCase().endsWith('.zip') && (
              <button
                onClick={() => {
                  setExtractTargetDir(currentPath);
                  setExtractModalOpen(true);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition duration-150 ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                }`}
              >
                <Icons.FolderDown className="w-3.5 h-3.5" /> {tr.extractButton}
              </button>
            )}
            <button
              onClick={() => {
                setChmodValue('755');
                setChmodModalOpen(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition duration-150 ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
              }`}
            >
              <Icons.Lock className="w-3.5 h-3.5" /> Chmod
            </button>
            <button
              onClick={() => handleDelete()}
              className="flex items-center gap-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 hover:border-red-700 text-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150"
            >
              <Icons.Trash2 className="w-3.5 h-3.5" /> {tr.deleteItem}
            </button>
            <button
              onClick={() => setSelectedPaths([])}
              className={`text-xs px-2 font-bold transition ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
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
          {/* Table of items */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b text-xs uppercase tracking-wider select-none ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'
                }`}>
                  <th className="p-4 w-12 select-none">
                    <button
                      onClick={handleSelectAll}
                      className={`p-1 rounded-lg transition-all duration-150 ${
                        isDark ? 'hover:bg-slate-800/80 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                      }`}
                      title="Select/Deselect all"
                    >
                      {selectedPaths.length === files.length && files.length > 0 ? (
                        <Icons.CheckSquare className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Icons.Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-4 font-bold select-none">{tr.name}</th>
                  <th className="p-4 font-bold w-28 select-none">{tr.size}</th>
                  <th className="p-4 font-bold w-48 select-none">{tr.dateModified}</th>
                  <th className="p-4 font-bold w-48 text-center select-none">{tr.actions}</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-200'}`}>
                {files.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-slate-400 text-xs select-none">
                      {tr.noFiles}
                    </td>
                  </tr>
                )}
                {files.map((item, idx) => {
                  const isChecked = selectedPaths.includes(item.path);
                  return (
                    <tr
                      key={idx}
                      onClick={() => handleToggleSelect(item.path)}
                      className={`transition-all duration-200 cursor-pointer ${
                        isDark
                          ? `hover:bg-slate-800/20 ${isChecked ? 'bg-blue-900/20 hover:bg-blue-900/25' : ''}`
                          : `hover:bg-slate-100/50 ${isChecked ? 'bg-blue-50 hover:bg-blue-100/50' : ''}`
                      }`}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <button
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
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {!item.is_dir && (
                            <button
                              onClick={() => handleEditFile(item)}
                              className={`p-1.5 rounded-xl border transition-all ${
                                isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-blue-400 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-blue-600 border-slate-200'
                              }`}
                              title={tr.editFile}
                            >
                              <Icons.Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!item.is_dir && (
                            <button
                              onClick={() => handleDownloadFile(item)}
                              className={`p-1.5 rounded-xl border transition-all ${
                                isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-green-400 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-green-600 border-slate-200'
                              }`}
                              title="Download file"
                            >
                              <Icons.Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setRenameValue(item.name);
                              setRenamingItem(item);
                            }}
                            className={`p-1.5 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-slate-300 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                            }`}
                            title={tr.renameItem}
                          >
                            <Icons.Scissors className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleCut(item)}
                            className={`p-1.5 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-amber-400 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-amber-600 border-slate-200'
                            }`}
                            title={tr.cut}
                          >
                            <Icons.Scissors className="w-3.5 h-3.5 rotate-90" />
                          </button>
                          <button
                            onClick={() => handleCopy(item)}
                            className={`p-1.5 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-indigo-400 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-indigo-600 border-slate-200'
                            }`}
                            title={tr.copy}
                          >
                            <Icons.Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className={`p-1.5 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800/60 hover:bg-slate-700 text-red-400 border-slate-700/60' : 'bg-slate-100 hover:bg-slate-200 text-red-600 border-slate-200'
                            }`}
                            title={tr.deleteItem}
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5" />
                          </button>
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
              <Icons.Edit3 className="w-4 h-4 text-blue-400" /> {tr.renameTitle}
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in">
          <div className={`p-6 rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl space-y-4 border ${
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
  );
}
