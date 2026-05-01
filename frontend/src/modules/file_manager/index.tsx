/**
 * File Manager - Complete Component
 * Premium file explorer with advanced editing and action capabilities.
 */
import { useState, useEffect } from 'react';
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

  // Modals / Dialogs state
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [createType, setCreateType] = useState<'file' | 'dir' | null>(null);
  const [newItemName, setNewItemName] = useState<string>('');
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Top Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent flex items-center gap-2">
            <Icons.Folder className="w-8 h-8 text-blue-400" />
            File Explorer
          </h1>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-xl">
            View, modify, copy, move, zip, extract, delete, and manage permissions for files and folders with advanced multi-select capability.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreateType('file')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition shadow-lg hover:shadow-blue-500/20"
          >
            <Icons.FilePlus className="w-4 h-4" /> Create File
          </button>
          <button
            onClick={() => setCreateType('dir')}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs transition"
          >
            <Icons.FolderPlus className="w-4 h-4" /> Create Dir
          </button>
          <button
            onClick={() => fetchPath(currentPath)}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-slate-300 transition"
            title="Refresh current path"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Path Bar & Paste Banner */}
      <div className="flex flex-col gap-4">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-wrap md:flex-row items-center gap-2 backdrop-blur-sm">
          <button
            onClick={handleGoUp}
            disabled={!currentPath || currentPath === '/' || currentPath.includes(':')}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 disabled:opacity-50 transition"
            title="Go Up One Level"
          >
            <Icons.CornerUpLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-500 px-1 font-semibold select-none">/</span>
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchPath(currentPath)}
            className="flex-1 bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-4 py-2 rounded-xl text-slate-200 outline-none focus:border-blue-500 text-xs font-mono transition-all"
            placeholder="e.g. /home/user or C:\"
          />
          <button
            onClick={() => fetchPath(currentPath)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold text-xs transition shadow-lg hover:shadow-blue-500/20"
          >
            Go
          </button>
        </div>

        {clipboard && (
          <div className="bg-amber-950/30 border border-amber-800/40 p-4 rounded-xl flex items-center justify-between gap-4 backdrop-blur-sm animate-fade-in shadow-xl select-none">
            <div className="flex items-center gap-2.5">
              <Icons.Clipboard className="w-5 h-5 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-100 leading-relaxed">
                {clipboard.paths.length} items to {clipboard.action}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePaste}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/30 hover:bg-amber-500/40 text-amber-100 font-bold rounded-lg border border-amber-500/30 transition shadow"
              >
                <Icons.Clipboard className="w-3.5 h-3.5" /> Paste
              </button>
              <button
                onClick={() => setClipboard(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition duration-150"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Multi Selection Actions Toolbar */}
      {selectedPaths.length > 0 && (
        <div className="bg-blue-950/40 border border-blue-800/60 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 animate-fade-in select-none">
          <div className="flex items-center gap-2">
            <Icons.CheckSquare className="w-5 h-5 text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-blue-200">
              {selectedPaths.length} items selected
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleCut()}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold transition duration-150"
            >
              <Icons.Scissors className="w-3.5 h-3.5" /> Cut
            </button>
            <button
              onClick={() => handleCopy()}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold transition duration-150"
            >
              <Icons.Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button
              onClick={() => {
                setZipArchiveName('archive.zip');
                setZipModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold transition duration-150"
            >
              <Icons.Archive className="w-3.5 h-3.5" /> Zip
            </button>
            {selectedPaths.length === 1 && selectedPaths[0].toLowerCase().endsWith('.zip') && (
              <button
                onClick={() => {
                  setExtractTargetDir(currentPath);
                  setExtractModalOpen(true);
                }}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold transition duration-150"
              >
                <Icons.FolderDown className="w-3.5 h-3.5" /> Extract
              </button>
            )}
            <button
              onClick={() => {
                setChmodValue('755');
                setChmodModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-bold transition duration-150"
            >
              <Icons.Lock className="w-3.5 h-3.5" /> Chmod
            </button>
            <button
              onClick={() => handleDelete()}
              className="flex items-center gap-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 hover:border-red-700 text-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-150"
            >
              <Icons.Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button
              onClick={() => setSelectedPaths([])}
              className="text-slate-400 hover:text-slate-200 text-xs px-2 font-bold"
            >
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* Loader / Empty States */}
      {loading && files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border border-slate-800/60 rounded-2xl bg-slate-900/30">
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400 text-xs">Loading contents...</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/30 border border-red-500/20 p-4 rounded-xl text-red-400 text-xs flex items-center gap-2 max-w-2xl animate-fade-in">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>Error loading directory contents: {error}</span>
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
          {/* Table of items */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800/60 text-slate-300 text-xs uppercase tracking-wider select-none">
                  <th className="p-4 w-12 select-none">
                    <button
                      onClick={handleSelectAll}
                      className="p-1 hover:bg-slate-800/80 rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-150"
                      title="Select/Deselect all"
                    >
                      {selectedPaths.length === files.length && files.length > 0 ? (
                        <Icons.CheckSquare className="w-4 h-4 text-blue-400" />
                      ) : (
                        <Icons.Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-4 font-bold select-none">Name</th>
                  <th className="p-4 font-bold w-28 select-none">Size</th>
                  <th className="p-4 font-bold w-48 select-none">Date Modified</th>
                  <th className="p-4 font-bold w-48 text-center select-none">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30 text-sm">
                {files.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-slate-400 text-xs select-none">
                      No files or folders in this directory.
                    </td>
                  </tr>
                )}
                {files.map((item, idx) => {
                  const isChecked = selectedPaths.includes(item.path);
                  return (
                    <tr
                      key={idx}
                      onClick={() => handleToggleSelect(item.path)}
                      className={`hover:bg-slate-800/20 transition-all duration-200 cursor-pointer ${
                        isChecked ? 'bg-blue-900/20 hover:bg-blue-900/25' : ''
                      }`}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleToggleSelect(item.path)}
                          className="p-1 hover:bg-slate-800/80 rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-150"
                        >
                          {isChecked ? (
                            <Icons.CheckSquare className="w-4 h-4 text-blue-400" />
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
                            className="flex items-center gap-3 text-blue-400 hover:text-blue-300 font-bold transition-all text-xs select-none"
                          >
                            <Icons.Folder className="w-5 h-5 flex-shrink-0 fill-blue-500/20" />
                            <span className="truncate max-w-sm">{item.name}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-3 text-slate-200 text-xs font-medium">
                            <Icons.File className="w-5 h-5 flex-shrink-0 text-slate-500" />
                            <span className="truncate max-w-sm">{item.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-400 font-mono text-xs">
                        {item.is_dir ? '—' : formatSize(item.size)}
                      </td>
                      <td className="p-4 text-slate-400 text-xs">
                        {item.modified > 0 ? formatDate(item.modified) : '—'}
                      </td>
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {!item.is_dir && (
                            <button
                              onClick={() => handleEditFile(item)}
                              className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-blue-400 border border-slate-700/60 transition-all"
                              title="Edit file"
                            >
                              <Icons.Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setRenameValue(item.name);
                              setRenamingItem(item);
                            }}
                            className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-slate-300 border border-slate-700/60 transition-all"
                            title="Rename item"
                          >
                            <Icons.Scissors className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleCut(item)}
                            className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-amber-400 border border-slate-700/60 transition-all"
                            title="Cut / Move"
                          >
                            <Icons.Scissors className="w-3.5 h-3.5 rotate-90" />
                          </button>
                          <button
                            onClick={() => handleCopy(item)}
                            className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-indigo-400 border border-slate-700/60 transition-all"
                            title="Copy item"
                          >
                            <Icons.Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-red-400 border border-slate-700/60 transition-all"
                            title="Delete item"
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
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100">
              {createType === 'file' ? (
                <>
                  <Icons.FilePlus className="w-4 h-4 text-blue-400" /> Create New File
                </>
              ) : (
                <>
                  <Icons.FolderPlus className="w-4 h-4 text-blue-400" /> Create New Directory
                </>
              )}
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Name
              </label>
              <input
                type="text"
                autoFocus
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateItem()}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none text-xs font-mono transition-all"
                placeholder={`e.g. ${createType === 'file' ? 'config.txt' : 'new-folder'}`}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setNewItemName('');
                  setCreateType(null);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateItem}
                disabled={!newItemName}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {renamingItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100">
              <Icons.Edit3 className="w-4 h-4 text-blue-400" /> Rename Item
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                New Name
              </label>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none text-xs font-mono transition-all"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setRenameValue('');
                  setRenamingItem(null);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameValue || renameValue === renamingItem.name}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEXT EDITOR MODAL */}
      {editingFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100 truncate max-w-lg">
                <Icons.FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>Editing: {editingFile.split(/[\\/]/).pop()}</span>
              </h3>
              <button
                onClick={() => setEditingFile(null)}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="flex-1 bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl text-slate-200 outline-none focus:border-blue-500 font-mono text-xs resize-none transition-all"
              placeholder="File content..."
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-2 flex-shrink-0 pt-2">
              <button
                onClick={() => setEditingFile(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZIP MODAL */}
      {zipModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100">
              <Icons.Archive className="w-4 h-4 text-blue-400" /> Compress into ZIP
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Archive File Name
              </label>
              <input
                type="text"
                autoFocus
                value={zipArchiveName}
                onChange={(e) => setZipArchiveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleZip()}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none text-xs font-mono transition-all"
                placeholder="e.g. backup.zip"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setZipArchiveName('');
                  setZipModalOpen(false);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleZip}
                disabled={!zipArchiveName}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Compress
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXTRACT MODAL */}
      {extractModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100">
              <Icons.FolderDown className="w-4 h-4 text-blue-400" /> Extract ZIP Archive
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Destination Path
              </label>
              <input
                type="text"
                autoFocus
                value={extractTargetDir}
                onChange={(e) => setExtractTargetDir(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none text-xs font-mono transition-all"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setExtractTargetDir('');
                  setExtractModalOpen(false);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleExtract}
                disabled={!extractTargetDir}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Extract
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHMOD MODAL */}
      {chmodModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100">
              <Icons.Lock className="w-4 h-4 text-blue-400" /> Change Permissions (Chmod)
            </h3>
            <div className="space-y-1">
              <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block">
                Mode String
              </label>
              <input
                type="text"
                autoFocus
                value={chmodValue}
                onChange={(e) => setChmodValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChmod()}
                className="w-full bg-slate-950/60 border border-slate-800/80 focus:border-blue-500 px-3.5 py-2 rounded-xl text-slate-200 outline-none text-xs font-mono transition-all"
                placeholder="e.g. 755 or 644"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setChmodValue('');
                  setChmodModalOpen(false);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleChmod}
                disabled={!chmodValue}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-lg hover:shadow-blue-500/20"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
