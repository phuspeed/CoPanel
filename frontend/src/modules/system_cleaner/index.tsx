import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface JunkInfo {
  apt_cache_bytes: number;
  journal_bytes: number;
  old_logs_bytes: number;
  total_bytes: number;
}

interface DiskItem {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size_bytes: number;
}

export default function SystemCleanerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const [activeTab, setActiveTab] = useState<'junk' | 'disk' | 'large'>('junk');
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // Junk state
  const [junkInfo, setJunkInfo] = useState<JunkInfo | null>(null);
  const [junkLoading, setJunkLoading] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanLogs, setCleanLogs] = useState<string[]>([]);

  // Disk Tree state
  const [diskPath, setDiskPath] = useState('/');
  const [diskItems, setDiskItems] = useState<DiskItem[]>([]);
  const [diskLoading, setDiskLoading] = useState(false);
  const [pathInput, setPathInput] = useState('/');

  // Large Files state
  const [largeFiles, setLargeFiles] = useState<DiskItem[]>([]);
  const [largeLoading, setLargeLoading] = useState(false);

  const t = {
    en: {
      title: 'System Cleaner',
      desc: 'Free up disk space and analyze storage usage.',
      tabJunk: 'Junk Cleaner',
      tabDisk: 'Disk Analyzer',
      tabLarge: 'Large Files',
      aptCache: 'APT Cache',
      journalLogs: 'Systemd Journal',
      oldLogs: 'Rotated Logs',
      totalJunk: 'Total Junk Found',
      scanJunk: 'Scan Junk',
      cleanJunk: 'Clean All Junk',
      cleaning: 'Cleaning...',
      cleanSuccess: 'System cleaned successfully!',
      diskPathLabel: 'Directory Path',
      scanDisk: 'Analyze',
      fileName: 'Name',
      fileSize: 'Size',
      action: 'Action',
      deleteConfirm: 'Are you sure you want to delete this?',
      noItems: 'No items found in this directory.',
      scanLargeFiles: 'Scan Files > 50MB',
      scanning: 'Scanning...',
    },
    vi: {
      title: 'Dọn Dẹp Hệ Thống',
      desc: 'Giải phóng dung lượng ổ cứng và phân tích không gian lưu trữ.',
      tabJunk: 'Dọn Rác (Junk)',
      tabDisk: 'Phân Tích Ổ Đĩa',
      tabLarge: 'File Kích Thước Lớn',
      aptCache: 'Bộ Nhớ Tạm APT',
      journalLogs: 'Nhật Ký Systemd (Journal)',
      oldLogs: 'File Log Cũ Đã Nén',
      totalJunk: 'Tổng Dung Lượng Rác',
      scanJunk: 'Quét Rác',
      cleanJunk: 'Dọn Dẹp Ngay',
      cleaning: 'Đang dọn...',
      cleanSuccess: 'Dọn dẹp hệ thống thành công!',
      diskPathLabel: 'Đường Dẫn',
      scanDisk: 'Phân Tích',
      fileName: 'Tên',
      fileSize: 'Kích Thước',
      action: 'Hành Động',
      deleteConfirm: 'Bạn có chắc chắn muốn xoá vĩnh viễn mục này không?',
      noItems: 'Không có thư mục/file nào ở đây.',
      scanLargeFiles: 'Quét File > 50MB',
      scanning: 'Đang quét...',
    },
  };
  const tr = t[language || 'en'];

  const showMsg = useCallback((text: string, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 5000);
  }, []);

  const authHeaders = useCallback(
    () => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }),
    [token]
  );

  useEffect(() => {
    fetchJunk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'disk' && diskItems.length === 0) {
      fetchDiskTree('/');
    }
  }, [activeTab]);

  const fetchJunk = async () => {
    setJunkLoading(true);
    try {
      const res = await fetch('/api/system_cleaner/junk', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setJunkInfo(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setJunkLoading(false);
    }
  };

  const handleClean = async () => {
    if (!window.confirm('Clean system junk files? This is safe but cannot be undone.')) return;
    setCleanLoading(true);
    setCleanLogs([]);
    try {
      const res = await fetch('/api/system_cleaner/clean', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ categories: ['apt', 'journal', 'old_logs'] }),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(tr.cleanSuccess);
        setCleanLogs(data.data?.logs || []);
        fetchJunk();
      } else {
        showMsg(data.detail || 'Failed to clean', true);
      }
    } catch (e) {
      showMsg('Network error', true);
    } finally {
      setCleanLoading(false);
    }
  };

  const fetchDiskTree = async (path: string) => {
    setDiskLoading(true);
    try {
      const res = await fetch(`/api/system_cleaner/disk/tree?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setDiskItems(data.data.items || []);
        setDiskPath(data.data.path);
        setPathInput(data.data.path);
      } else {
        showMsg(data.detail || 'Failed to fetch tree', true);
      }
    } catch (e) {
      showMsg('Network error', true);
    } finally {
      setDiskLoading(false);
    }
  };

  const fetchLargeFiles = async () => {
    setLargeLoading(true);
    try {
      const res = await fetch('/api/system_cleaner/disk/large-files?min_size_mb=50', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setLargeFiles(data.data.items || []);
      } else {
        showMsg(data.detail || 'Failed to fetch large files', true);
      }
    } catch (e) {
      showMsg('Network error', true);
    } finally {
      setLargeLoading(false);
    }
  };

  const handleDelete = async (path: string, type: 'disk' | 'large') => {
    if (!window.confirm(tr.deleteConfirm + `\n\n${path}`)) return;
    try {
      const res = await fetch('/api/system_cleaner/disk/delete', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        showMsg('Deleted successfully');
        if (type === 'disk') fetchDiskTree(diskPath);
        if (type === 'large') fetchLargeFiles();
      } else {
        const data = await res.json();
        showMsg(data.detail || 'Failed to delete', true);
      }
    } catch (e) {
      showMsg('Network error', true);
    }
  };

  const fmtBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getParentPath = (path: string) => {
    if (path === '/') return '/';
    const parts = path.replace(/\/$/, '').split('/');
    parts.pop();
    return parts.join('/') || '/';
  };

  const card = `border p-6 rounded-2xl shadow-sm ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200'}`;
  const input = `px-4 py-2 rounded-xl border text-sm focus:border-indigo-500 outline-none transition ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all ${isDark ? 'bg-gradient-to-br from-teal-900/30 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-teal-50/50 via-white to-slate-50 border-slate-200'}`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${isDark ? 'bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent' : 'bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent'}`}>
            <Icons.Trash2 className={`w-8 h-8 ${isDark ? 'text-teal-400' : 'text-teal-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.desc}</p>
        </div>
      </div>

      {msg && (
        <div className={`p-4 border rounded-xl text-xs flex items-center gap-2 ${msg.isError ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-green-500/10 border-green-500/30 text-green-500'}`}>
          {msg.isError ? <Icons.AlertTriangle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-60 hover:opacity-100">
            <Icons.X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b select-none overflow-x-auto pb-px">
        {[
          { id: 'junk', label: tr.tabJunk, icon: Icons.Wind },
          { id: 'disk', label: tr.tabDisk, icon: Icons.PieChart },
          { id: 'large', label: tr.tabLarge, icon: Icons.Weight },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 text-sm font-bold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id
                ? isDark ? 'border-teal-500 text-teal-400 bg-teal-500/10' : 'border-teal-600 text-teal-700 bg-teal-50'
                : isDark ? 'border-transparent text-slate-500 hover:text-slate-300' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Junk Cleaner */}
      {activeTab === 'junk' && (
        <div className={`space-y-6 ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-lg font-bold flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              <Icons.Eraser className="w-5 h-5 text-teal-500" />
              {tr.totalJunk}: {junkInfo ? fmtBytes(junkInfo.total_bytes) : '...'}
            </h3>
            <button
              onClick={fetchJunk}
              disabled={junkLoading}
              className={`p-2 rounded-lg border transition ${isDark ? 'border-slate-700 hover:bg-slate-800 text-slate-400' : 'border-slate-300 hover:bg-slate-100 text-slate-600'}`}
            >
              <Icons.RefreshCw className={`w-4 h-4 ${junkLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: tr.aptCache, val: junkInfo?.apt_cache_bytes, icon: Icons.Package },
              { label: tr.journalLogs, val: junkInfo?.journal_bytes, icon: Icons.Database },
              { label: tr.oldLogs, val: junkInfo?.old_logs_bytes, icon: Icons.FileText },
            ].map((item, i) => (
              <div key={i} className={`p-4 rounded-xl border flex items-center gap-4 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`p-3 rounded-lg ${isDark ? 'bg-slate-800 text-teal-400' : 'bg-white shadow text-teal-600'}`}>
                  <item.icon className="w-6 h-6" />
                </div>
                <div>
                  <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{item.label}</div>
                  <div className={`text-lg font-mono font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                    {item.val !== undefined ? fmtBytes(item.val) : '...'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={handleClean}
              disabled={cleanLoading || !junkInfo || junkInfo.total_bytes === 0}
              className={`px-8 py-3 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition w-full sm:w-auto ${
                cleanLoading || !junkInfo || junkInfo.total_bytes === 0
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-teal-600 hover:bg-teal-500 shadow-teal-500/20'
              }`}
            >
              {cleanLoading ? <Icons.Loader2 className="w-5 h-5 animate-spin" /> : <Icons.Sparkles className="w-5 h-5" />}
              {cleanLoading ? tr.cleaning : tr.cleanJunk}
            </button>
            <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
              Safe to clean. Does not affect running apps or configurations.
            </p>
          </div>

          {cleanLogs.length > 0 && (
            <div className={`mt-4 p-4 rounded-xl font-mono text-[11px] leading-loose ${isDark ? 'bg-slate-950 text-green-400' : 'bg-slate-900 text-green-400'}`}>
              {cleanLogs.map((log, i) => <div key={i}>&gt; {log}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Disk Analyzer */}
      {activeTab === 'disk' && (
        <div className={`space-y-4 ${card}`}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchDiskTree(pathInput)}
              className={`${input} flex-1 font-mono`}
              placeholder={tr.diskPathLabel}
            />
            <button
              onClick={() => fetchDiskTree(pathInput)}
              disabled={diskLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl flex items-center gap-2 transition text-sm disabled:opacity-50"
            >
              <Icons.Search className={`w-4 h-4 ${diskLoading ? 'animate-pulse' : ''}`} />
              {tr.scanDisk}
            </button>
          </div>

          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono font-bold ${isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
            <button onClick={() => fetchDiskTree(getParentPath(diskPath))} className="p-1 hover:bg-slate-500/20 rounded text-indigo-500" title="Go Up">
              <Icons.CornerLeftUp className="w-4 h-4" />
            </button>
            <Icons.FolderOpen className="w-4 h-4 text-yellow-500 ml-1" />
            <span className="truncate">{diskPath}</span>
            {diskLoading && <Icons.Loader2 className="w-3.5 h-3.5 animate-spin ml-auto text-indigo-500" />}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className={`border-b text-xs uppercase tracking-wider ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
                  <th className="pb-3 px-2 font-bold">{tr.fileName}</th>
                  <th className="pb-3 px-2 font-bold w-48">{tr.fileSize}</th>
                  <th className="pb-3 px-2 font-bold text-right w-24">{tr.action}</th>
                </tr>
              </thead>
              <tbody>
                {diskItems.length === 0 && !diskLoading && (
                  <tr>
                    <td colSpan={3} className={`py-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      {tr.noItems}
                    </td>
                  </tr>
                )}
                {diskItems.map((item) => {
                  const maxBytes = diskItems.length > 0 ? diskItems[0].size_bytes : 1;
                  const pct = Math.max(1, (item.size_bytes / maxBytes) * 100);
                  return (
                    <tr key={item.path} className={`border-b last:border-0 transition ${isDark ? 'border-slate-800 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                      <td className="py-2.5 px-2">
                        <div
                          className={`flex items-center gap-3 ${item.type === 'folder' ? 'cursor-pointer hover:text-indigo-500' : ''}`}
                          onClick={() => item.type === 'folder' && fetchDiskTree(item.path)}
                        >
                          {item.type === 'folder' ? <Icons.Folder className="w-5 h-5 text-yellow-500 shrink-0" /> : <Icons.File className="w-5 h-5 text-slate-400 shrink-0" />}
                          <span className="font-semibold truncate max-w-xs md:max-w-md">{item.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs w-16 text-right ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{fmtBytes(item.size_bytes)}</span>
                          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          onClick={() => handleDelete(item.path, 'disk')}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded transition"
                          title="Delete"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Large Files */}
      {activeTab === 'large' && (
        <div className={`space-y-4 ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Top 100 Large Files (&gt;50MB)</h3>
            <button
              onClick={fetchLargeFiles}
              disabled={largeLoading}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl flex items-center gap-2 transition text-sm disabled:opacity-50"
            >
              <Icons.Search className={`w-4 h-4 ${largeLoading ? 'animate-pulse' : ''}`} />
              {tr.scanLargeFiles}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className={`border-b text-xs uppercase tracking-wider ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
                  <th className="pb-3 px-2 font-bold">{tr.fileName}</th>
                  <th className="pb-3 px-2 font-bold w-32">{tr.fileSize}</th>
                  <th className="pb-3 px-2 font-bold text-right w-24">{tr.action}</th>
                </tr>
              </thead>
              <tbody>
                {largeFiles.length === 0 && !largeLoading && (
                  <tr>
                    <td colSpan={3} className={`py-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      {tr.noItems}
                    </td>
                  </tr>
                )}
                {largeFiles.map((item) => (
                  <tr key={item.path} className={`border-b last:border-0 transition ${isDark ? 'border-slate-800 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold truncate max-w-sm">{item.name}</span>
                        <span className={`text-[10px] font-mono truncate max-w-sm ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{item.path}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`font-mono font-bold text-xs ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{fmtBytes(item.size_bytes)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        onClick={() => handleDelete(item.path, 'large')}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded transition"
                        title="Delete"
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
