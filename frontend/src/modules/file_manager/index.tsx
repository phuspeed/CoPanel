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

  // Cut/Copy (Move) state
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);

  // Fetch current path on load or path change
  const fetchPath = async (path: string = '') => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/file_manager/list${path ? `?path=${encodeURIComponent(path)}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to list directory');
      }
      const data = await response.json();
      setCurrentPath(data.path || '');
      setFiles(data.files || []);
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
    // Strip trailing slashes and split by path separator
    const norm = currentPath.replace(/[\\/]+$/, '');
    const parts = norm.split(/[\\/]/);
    parts.pop();
    const upPath = parts.join('/') || '/';
    fetchPath(upPath);
  };

  // 📝 Open File Editor
  const handleEditFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/file_manager/read?path=${encodeURIComponent(item.path)}`);
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

  // 🗑️ Delete Item
  const handleDelete = async (item: FileItem) => {
    if (!confirm(`Are you sure you want to delete "${item.name}"?`)) return;
    try {
      const res = await fetch('/api/file_manager/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Delete failed');
      }
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting item');
    }
  };

  // ✂️ Cut / Clipboard (Move)
  const handleCut = (item: FileItem) => {
    setClipboardPath(item.path);
  };

  // 📋 Paste
  const handlePaste = async () => {
    if (!clipboardPath) return;
    const baseName = clipboardPath.split(/[\\/]/).pop();
    const newPath = `${currentPath.replace(/[\\/]+$/, '')}/${baseName}`;
    try {
      const res = await fetch('/api/file_manager/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_path: clipboardPath, target_path: newPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Paste failed');
      }
      setClipboardPath(null);
      fetchPath(currentPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error moving item');
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
    <div className="p-8">
      {/* Top Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Icons.Folder className="w-8 h-8 text-blue-400" />
            File Manager
          </h1>
          <p className="text-slate-400">View and manage system files</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreateType('file')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition"
          >
            <Icons.FilePlus className="w-4 h-4" /> Create File
          </button>
          <button
            onClick={() => setCreateType('dir')}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition"
          >
            <Icons.FolderPlus className="w-4 h-4" /> Create Dir
          </button>
          <button
            onClick={() => fetchPath(currentPath)}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-2.5 rounded-lg text-slate-300 transition"
            title="Refresh current path"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Path Bar / Breadcrumbs */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6 flex flex-wrap md:flex-row items-center gap-2">
        <button
          onClick={handleGoUp}
          disabled={!currentPath || currentPath === '/' || currentPath.includes(':')}
          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-300 disabled:opacity-50 transition"
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
          className="flex-1 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-md text-slate-200 outline-none focus:border-blue-500 text-sm font-mono"
          placeholder="e.g. /var/www or C:\"
        />
        <button
          onClick={() => fetchPath(currentPath)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium text-sm transition"
        >
          Go
        </button>
        {clipboardPath && (
          <button
            onClick={handlePaste}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/30 border border-amber-500 hover:bg-amber-600/50 rounded-md text-amber-200 font-medium text-sm transition"
            title={`Paste ${clipboardPath}`}
          >
            <Icons.Clipboard className="w-4 h-4" /> Paste
          </button>
        )}
      </div>

      {/* Loader / Empty States */}
      {loading && files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400">Loading contents...</p>
        </div>
      ) : error ? (
        <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg mb-8">
          <p className="text-red-200">Error fetching files: {error}</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden select-none">
          {/* Table of items */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/50 border-b border-slate-800 text-slate-300 text-xs uppercase">
                  <th className="p-4 font-semibold">Name</th>
                  <th className="p-4 font-semibold w-28">Size</th>
                  <th className="p-4 font-semibold w-48">Date Modified</th>
                  <th className="p-4 font-semibold w-32 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30 text-sm">
                {files.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-400">
                      Folder is empty
                    </td>
                  </tr>
                )}
                {files.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition">
                    <td className="p-4">
                      {item.is_dir ? (
                        <button
                          onClick={() => handleOpenFolder(item.path)}
                          className="flex items-center gap-3 text-blue-400 hover:text-blue-300 font-medium transition"
                        >
                          <Icons.Folder className="w-5 h-5 flex-shrink-0 fill-blue-500/20" />
                          <span className="truncate max-w-sm">{item.name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 text-slate-200">
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
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {!item.is_dir && (
                          <button
                            onClick={() => handleEditFile(item)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-blue-400 transition"
                            title="Edit file"
                          >
                            <Icons.Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRenameValue(item.name);
                            setRenamingItem(item);
                          }}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition"
                          title="Rename item"
                        >
                          <Icons.Scissors className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleCut(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-amber-400 transition"
                          title="Cut / Move item"
                        >
                          <Icons.Scissors className="w-4 h-4 rotate-90" />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-red-400 transition"
                          title="Delete item"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALS */}

      {/* CREATE FILE / DIRECTORY MODAL */}
      {createType && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-100">
              {createType === 'file' ? (
                <>
                  <Icons.FilePlus className="w-5 h-5 text-blue-400" /> Create New File
                </>
              ) : (
                <>
                  <Icons.FolderPlus className="w-5 h-5 text-blue-400" /> Create New Directory
                </>
              )}
            </h3>
            <div className="mb-4">
              <label className="text-slate-400 text-xs font-semibold mb-2 block uppercase">
                Name
              </label>
              <input
                type="text"
                autoFocus
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateItem()}
                className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
                placeholder={`e.g. ${createType === 'file' ? 'config.txt' : 'new-folder'}`}
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setNewItemName('');
                  setCreateType(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateItem}
                disabled={!newItemName}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {renamingItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-100">
              <Icons.Edit3 className="w-5 h-5 text-blue-400" /> Rename Item
            </h3>
            <div className="mb-4">
              <label className="text-slate-400 text-xs font-semibold mb-2 block uppercase">
                New Name
              </label>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setRenameValue('');
                  setRenamingItem(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameValue || renameValue === renamingItem.name}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEXT EDITOR MODAL */}
      {editingFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100 truncate max-w-lg">
                <Icons.FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>Editing: {editingFile.split(/[\\/]/).pop()}</span>
              </h3>
              <button
                onClick={() => setEditingFile(null)}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                &times;
              </button>
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-200 outline-none focus:border-blue-500 font-mono text-sm resize-none"
              placeholder="File content..."
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-3 mt-4 flex-shrink-0">
              <button
                onClick={() => setEditingFile(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
