import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

// --- Types ---
interface Profile {
  id: number;
  profile_name: string;
  source_type: 'folder' | 'mysql';
  source_path: string;
  remote_name: string;
  remote_path: string;
  cron_expression: string;
  is_active: number;
  realtime_sync: number;
  rclone_flags: string; // JSON string
}

export default function BackupManagerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  // --- States ---
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // System & rclone states
  const [systemFolders, setSystemFolders] = useState<{name: string, path: string}[]>([]);
  const [showRcloneConfig, setShowRcloneConfig] = useState(false);
  const [rcloneConfigContent, setRcloneConfigContent] = useState('');
  const [rcloneConfigPath, setRcloneConfigPath] = useState('');

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardTab, setWizardTab] = useState(1);
  const [form, setForm] = useState<Partial<Profile>>({
    profile_name: '', source_type: 'folder', source_path: '', remote_name: '', remote_path: '', cron_expression: '0 0 * * *', is_active: 1, realtime_sync: 0, rclone_flags: '{}'
  });

  // Flags parsed state for wizard
  const [flags, setFlags] = useState({ inplace: false, metadata: false, size_only: false, sync_deletions: true, transfers: 4 });

  // Stream state
  const [streamingProfile, setStreamingProfile] = useState<Profile | null>(null);
  const [streamProgress, setStreamProgress] = useState(-1);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const [streamDone, setStreamDone] = useState(false);

  // File Explorer state
  const [showExplorer, setShowExplorer] = useState(false);
  const [explorerPath, setExplorerPath] = useState('/');
  const [explorerItems, setExplorerItems] = useState<{name: string, path: string, type: string}[]>([]);

  const t = {
    en: {
      title: 'Professional Cloud Backup',
      desc: 'Zero-CLI backup manager. Automate cloud sync and real-time watching.',
      newProfile: 'Create Backup Profile',
      taskMonitor: 'Task Monitor Dashboard',
      runNow: 'Run Now',
      delete: 'Delete',
      close: 'Close',
      next: 'Next',
      back: 'Back',
      save: 'Save Profile',
      wizardSource: '1. Data Source',
      wizardDest: '2. Destination',
      wizardSchedule: '3. Schedule & Options',
      dbType: 'Database (MySQL/MariaDB)',
      folderType: 'Website Folder',
      browseBtn: 'Browse Server',
      remoteLabel: 'Cloud Remote',
      cronLabel: 'Cron Schedule Pattern',
      realtimeSync: 'Real-time Sync (Watchdog)',
      syncDeletions: 'Sync Deletions (rclone sync)',
      streamingTitle: 'Backup in Progress',
      noProfiles: 'No backup profiles found. Create one to get started.'
    },
    vi: {
      title: 'Quản trị Sao lưu Đám mây',
      desc: 'Công cụ quản lý sao lưu Zero-CLI. Tự động hóa đồng bộ đám mây và theo dõi thời gian thực.',
      newProfile: 'Tạo cấu hình mới',
      taskMonitor: 'Giám sát tiến trình (Task Monitor)',
      runNow: 'Chạy ngay',
      delete: 'Xoá',
      close: 'Đóng',
      next: 'Tiếp theo',
      back: 'Quay lại',
      save: 'Lưu Cấu hình',
      wizardSource: '1. Nguồn Dữ liệu',
      wizardDest: '2. Đích Lưu trữ',
      wizardSchedule: '3. Lịch & Tùy chọn',
      dbType: 'Cơ sở dữ liệu (MySQL)',
      folderType: 'Thư mục Website',
      browseBtn: 'Duyệt máy chủ',
      remoteLabel: 'Đám mây (Remote)',
      cronLabel: 'Chuỗi Lịch Cron',
      realtimeSync: 'Đồng bộ Thời gian thực (Watchdog)',
      syncDeletions: 'Đồng bộ xóa file (rclone sync)',
      streamingTitle: 'Đang tiến hành sao lưu...',
      noProfiles: 'Chưa có cấu hình nào. Hãy tạo một cấu hình mới.'
    }
  };
  const tr = t[language || 'en'];

  useEffect(() => {
    fetchProfiles();
    fetchRemotes();
    fetchSystemFolders();
  }, []);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/backup_manager/profiles', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setProfiles(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRemotes = async () => {
    try {
      const res = await fetch('/api/backup_manager/remotes', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setRemotes(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSystemFolders = async () => {
    try {
      const res = await fetch('/api/backup_manager/system-folders', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setSystemFolders(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRcloneConfig = async () => {
    try {
      const res = await fetch('/api/backup_manager/rclone-config', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) {
        setRcloneConfigContent(data.content || '');
        setRcloneConfigPath(data.path || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveRcloneConfig = async () => {
    try {
      const res = await fetch('/api/backup_manager/rclone-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: rcloneConfigContent })
      });
      if (res.ok) {
        setMsg({ text: 'Rclone configuration saved successfully!', isError: false });
        setShowRcloneConfig(false);
        fetchRemotes();
      } else {
        setMsg({ text: 'Failed to save rclone configuration', isError: true });
      }
    } catch (e) {
      setMsg({ text: 'Error saving rclone configuration', isError: true });
    }
  };

  const loadExplorer = async (path: string) => {
    try {
      const res = await fetch(`/api/backup_manager/explore?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) {
        setExplorerItems(data.data || []);
        setExplorerPath(data.current_path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateProfile = async () => {
    const payload = {
      ...form,
      rclone_flags: flags
    };
    try {
      const res = await fetch('/api/backup_manager/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setMsg({ text: 'Profile created successfully!', isError: false });
        setShowWizard(false);
        fetchProfiles();
      }
    } catch (e) {
      setMsg({ text: 'Failed to create profile', isError: true });
    }
  };

  const handleDeleteProfile = async (id: number) => {
    if (!window.confirm('Delete this backup profile?')) return;
    try {
      await fetch(`/api/backup_manager/profiles/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      fetchProfiles();
    } catch (e) {
      console.error(e);
    }
  };

  const runStream = (profile: Profile) => {
    setStreamingProfile(profile);
    setStreamProgress(0);
    setStreamLogs([]);
    setStreamDone(false);

    // Start SSE
    const es = new EventSource(`/api/backup_manager/stream_task/${profile.id}`);
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.msg) {
          setStreamLogs(prev => [...prev, data.msg]);
        }
        if (data.progress !== undefined) {
          setStreamProgress(data.progress);
        }
        if (data.done || data.error) {
          setStreamDone(true);
          es.close();
          if (data.error) setStreamLogs(prev => [...prev, `ERROR: ${data.error}`]);
        }
      } catch (e) {
        setStreamLogs(prev => [...prev, event.data]);
      }
    };
    
    es.onerror = () => {
      setStreamLogs(prev => [...prev, 'Connection lost.']);
      setStreamDone(true);
      es.close();
    };
  };

  // UI rendering functions
  const renderWizard = () => (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/40`}>
      <div className={`w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'}`}>
        
        {/* Wizard Header */}
        <div className={`p-5 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
          <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.newProfile}</h3>
          <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-red-500"><Icons.X className="w-5 h-5"/></button>
        </div>

        {/* Wizard Steps */}
        <div className="flex border-b select-none">
          {[1, 2, 3].map(step => (
            <div key={step} className={`flex-1 text-center py-3 text-xs font-bold transition-all ${
              wizardTab === step 
                ? (isDark ? 'bg-indigo-900/30 text-indigo-400 border-b-2 border-indigo-500' : 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600')
                : (isDark ? 'text-slate-500 border-b-2 border-transparent' : 'text-slate-400 border-b-2 border-transparent')
            }`}>
              {step === 1 ? tr.wizardSource : step === 2 ? tr.wizardDest : tr.wizardSchedule}
            </div>
          ))}
        </div>

        {/* Wizard Body */}
        <div className="p-6 md:p-8 space-y-6 flex-1 overflow-y-auto">
          {wizardTab === 1 && (
            <div className="space-y-5 animate-fade-in">
              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Profile Name</label>
                <input type="text" value={form.profile_name} onChange={e => setForm({...form, profile_name: e.target.value})} placeholder="e.g. Daily Website Backup" className={`w-full px-4 py-3 rounded-xl border text-sm focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => setForm({...form, source_type: 'folder'})} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition ${form.source_type === 'folder' ? 'border-indigo-500 bg-indigo-500/10' : (isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600')}`}>
                  <Icons.Folder className={`w-8 h-8 ${form.source_type === 'folder' ? 'text-indigo-500' : ''}`} />
                  <span className="text-xs font-bold">{tr.folderType}</span>
                </button>
                <button type="button" onClick={() => setForm({...form, source_type: 'mysql'})} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition ${form.source_type === 'mysql' ? 'border-indigo-500 bg-indigo-500/10' : (isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600')}`}>
                  <Icons.Database className={`w-8 h-8 ${form.source_type === 'mysql' ? 'text-indigo-500' : ''}`} />
                  <span className="text-xs font-bold">{tr.dbType}</span>
                </button>
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{form.source_type === 'folder' ? 'Source Directory Path' : 'MySQL Database Name'}</label>
                <div className="flex gap-2">
                  <input type="text" value={form.source_path} onChange={e => setForm({...form, source_path: e.target.value})} placeholder={form.source_type === 'folder' ? '/var/www/html' : 'database_name'} className={`flex-1 px-4 py-3 rounded-xl border text-sm font-mono focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
                  {form.source_type === 'folder' && (
                    <button type="button" onClick={() => { loadExplorer('/'); setShowExplorer(true); }} className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex flex-col justify-center">
                      <Icons.Search className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {wizardTab === 2 && (
            <div className="space-y-5 animate-fade-in">
              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.remoteLabel}</label>
                <select value={form.remote_name} onChange={e => setForm({...form, remote_name: e.target.value})} className={`w-full px-4 py-3 rounded-xl border text-sm focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>
                  <option value="">-- Select Remote --</option>
                  {remotes.map(r => <option key={r} value={r.replace(':', '')}>{r}</option>)}
                </select>
                {remotes.length === 0 && <p className="text-[10px] text-red-500 mt-1">No remotes found. Configure rclone via terminal first.</p>}
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Remote Directory Path</label>
                <input type="text" value={form.remote_path} onChange={e => setForm({...form, remote_path: e.target.value})} placeholder="e.g. Backups/MySite" className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
              </div>
            </div>
          )}

          {wizardTab === 3 && (
            <div className="space-y-5 animate-fade-in">
              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.cronLabel}</label>
                <input type="text" value={form.cron_expression} onChange={e => setForm({...form, cron_expression: e.target.value})} placeholder="0 2 * * *" className={`w-full px-4 py-3 rounded-xl border text-sm font-mono focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <label className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                  <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.realtimeSync}</span>
                  <input type="checkbox" checked={form.realtime_sync === 1} onChange={e => setForm({...form, realtime_sync: e.target.checked ? 1 : 0})} className="w-4 h-4 accent-indigo-600" />
                </label>
                
                <label className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                  <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.syncDeletions}</span>
                  <input type="checkbox" checked={flags.sync_deletions} onChange={e => setFlags({...flags, sync_deletions: e.target.checked})} className="w-4 h-4 accent-indigo-600" />
                </label>

                <label className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                  <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Optimize: --size-only (Fast)</span>
                  <input type="checkbox" checked={flags.size_only} onChange={e => setFlags({...flags, size_only: e.target.checked})} className="w-4 h-4 accent-indigo-600" />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer */}
        <div className={`p-5 border-t flex justify-between ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
          {wizardTab > 1 ? (
            <button type="button" onClick={() => setWizardTab(wizardTab - 1)} className={`px-4 py-2 text-xs font-bold rounded-xl border transition ${isDark ? 'border-slate-700 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-600'}`}>{tr.back}</button>
          ) : <div></div>}
          
          {wizardTab < 3 ? (
            <button type="button" onClick={() => setWizardTab(wizardTab + 1)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-sm">{tr.next}</button>
          ) : (
            <button type="button" onClick={handleCreateProfile} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-xl transition shadow-sm">{tr.save}</button>
          )}
        </div>
      </div>
    </div>
  );

  const renderStreamModal = () => {
    if (!streamingProfile) return null;
    return (
      <div className={`fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60`}>
        <div className={`w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'}`}>
          <div className={`p-4 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
            <h3 className={`font-bold text-sm flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Activity className="w-5 h-5 text-indigo-500 animate-pulse" />
              {tr.streamingTitle} - {streamingProfile.profile_name}
            </h3>
            {streamDone && <button onClick={() => setStreamingProfile(null)} className="text-slate-400 hover:text-red-500"><Icons.X className="w-5 h-5"/></button>}
          </div>
          
          <div className="p-6 space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold font-mono">
                <span className="text-indigo-500">Progress</span>
                <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{streamProgress >= 0 ? `${streamProgress}%` : 'Calculating...'}</span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300 relative" 
                  style={{ width: `${Math.max(streamProgress, 5)}%` }}
                >
                  {!streamDone && <div className="absolute inset-0 bg-white/20 animate-pulse"></div>}
                </div>
              </div>
            </div>

            {/* Terminal Stream */}
            <div className={`h-64 p-4 rounded-xl font-mono text-[10px] overflow-y-auto ${isDark ? 'bg-slate-950 text-green-400 border border-slate-800' : 'bg-slate-900 text-green-400 border border-slate-800'}`}>
              {streamLogs.map((log, i) => (
                <div key={i} className="mb-1 leading-relaxed break-all whitespace-pre-wrap">{log}</div>
              ))}
              {!streamDone && <div className="animate-pulse">_</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderExplorer = () => {
    if (!showExplorer) return null;
    return (
      <div className={`fixed inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40`}>
        <div className={`w-full max-w-2xl h-[70vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'}`}>
          <div className={`p-4 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
            <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.browseBtn}</h3>
            <button onClick={() => setShowExplorer(false)} className="text-slate-400 hover:text-red-500"><Icons.X className="w-5 h-5"/></button>
          </div>
          
          <div className={`p-3 border-b flex flex-wrap gap-1.5 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            {systemFolders.map(f => (
              <button 
                key={f.path} 
                onClick={() => loadExplorer(f.path)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition ${isDark ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300' : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-600'}`}
              >
                {f.name}
              </button>
            ))}
          </div>

          <div className={`p-3 flex items-center gap-2 text-xs font-mono border-b ${isDark ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
            <button onClick={() => {
               const parts = explorerPath.split('/').filter(Boolean);
               parts.pop();
               loadExplorer('/' + parts.join('/'));
            }} className="p-1 hover:bg-slate-500/20 rounded"><Icons.CornerLeftUp className="w-4 h-4"/></button>
            <span className="flex-1">{explorerPath}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {explorerItems.map(item => (
              <div 
                key={item.path} 
                onClick={() => {
                  if (item.type === 'folder') {
                    loadExplorer(item.path);
                  }
                }}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <div className="flex items-center gap-3">
                  {item.type === 'folder' ? <Icons.Folder className="w-5 h-5 text-yellow-500" /> : <Icons.File className="w-5 h-5 text-slate-400" />}
                  <span className="text-xs font-medium">{item.name}</span>
                </div>
                {item.type === 'folder' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setForm({...form, source_path: item.path}); setShowExplorer(false); }}
                    className="px-3 py-1 text-[10px] font-bold bg-indigo-600 text-white rounded hover:bg-indigo-500"
                  >
                    Select
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Header Banner */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-indigo-900/30 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-indigo-50/50 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
            isDark ? 'bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent' : 'bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent'
          }`}>
            <Icons.Cloud className={`w-8 h-8 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.desc}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button onClick={() => { fetchRcloneConfig(); setShowRcloneConfig(true); }} className="px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white font-bold text-sm rounded-xl shadow-lg flex items-center gap-2 transition">
            <Icons.Settings className="w-5 h-5" />
            Rclone Profiles
          </button>
          <button onClick={() => { setForm({profile_name: '', source_type: 'folder', source_path: '', remote_name: '', remote_path: '', cron_expression: '0 0 * * *', is_active: 1, realtime_sync: 0, rclone_flags: '{}'}); setWizardTab(1); setShowWizard(true); }} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition">
            <Icons.Plus className="w-5 h-5" />
            {tr.newProfile}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-4 border rounded-xl text-xs flex items-center gap-2 animate-fade-in ${msg.isError ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-green-500/10 border-green-500/30 text-green-500'}`}>
          {msg.isError ? <Icons.AlertTriangle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Profiles Dashboard */}
      <div className={`border p-6 rounded-2xl shadow-sm ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200'}`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 mb-6 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
          <Icons.LayoutDashboard className="w-5 h-5 text-indigo-500" />
          {tr.taskMonitor}
        </h3>

        {profiles.length === 0 ? (
          <div className={`p-10 text-center border-2 border-dashed rounded-xl ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
            <Icons.CloudOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">{tr.noProfiles}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {profiles.map(p => (
              <div key={p.id} className={`p-5 rounded-xl border relative overflow-hidden group ${isDark ? 'bg-slate-950/50 border-slate-800 hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300'}`}>
                {/* Status Indicator */}
                <div className={`absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rotate-45 ${p.is_active ? 'bg-green-500/20' : 'bg-slate-500/20'}`}></div>
                
                <div className="flex items-start justify-between mb-4 relative z-10">
                  <div className="space-y-1">
                    <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                      {p.source_type === 'mysql' ? <Icons.Database className="w-4 h-4 text-blue-500" /> : <Icons.Folder className="w-4 h-4 text-yellow-500" />}
                      {p.profile_name}
                    </h4>
                    <div className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {p.source_path} ➔ {p.remote_name}:{p.remote_path}
                    </div>
                  </div>
                  {p.realtime_sync === 1 && (
                    <span className="px-2 py-1 bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 rounded text-[10px] font-bold flex items-center gap-1">
                      <Icons.Eye className="w-3 h-3" /> Watch
                    </span>
                  )}
                </div>

                <div className={`flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider mb-5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  <span className="flex items-center gap-1.5"><Icons.Calendar className="w-3.5 h-3.5" /> {p.cron_expression || 'No Cron'}</span>
                </div>

                <div className="flex items-center gap-2 pt-4 border-t relative z-10 border-slate-200 dark:border-slate-800">
                  <button onClick={() => runStream(p)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition">
                    <Icons.Play className="w-3.5 h-3.5" /> {tr.runNow}
                  </button>
                  <button onClick={() => handleDeleteProfile(p.id)} className={`px-3 py-2 border rounded-lg text-xs font-bold transition flex items-center gap-2 ${isDark ? 'border-slate-700 text-red-400 hover:bg-slate-800' : 'border-slate-300 text-red-600 hover:bg-red-50'}`}>
                    <Icons.Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showWizard && renderWizard()}
      {showExplorer && renderExplorer()}
      {showRcloneConfig && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/40`}>
          <div className={`w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'}`}>
            <div className={`p-4 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="space-y-0.5">
                <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>Rclone Profiles Configuration</h3>
                <p className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{rcloneConfigPath}</p>
              </div>
              <button onClick={() => setShowRcloneConfig(false)} className="text-slate-400 hover:text-red-500"><Icons.X className="w-5 h-5"/></button>
            </div>

            <div className="p-6 space-y-4">
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Paste or modify the standard rclone INI config content. Each remote name defined in square brackets (e.g. <code>[my_remote]</code>) can be selected when creating a backup profile.</p>
              <textarea
                value={rcloneConfigContent}
                onChange={e => setRcloneConfigContent(e.target.value)}
                placeholder={"[my_gdrive]\ntype = drive\nscope = drive"}
                className={`w-full h-80 p-4 font-mono text-xs rounded-xl border focus:border-indigo-500 outline-none ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}
              />
            </div>

            <div className={`p-4 border-t flex justify-end gap-3 ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
              <button onClick={() => setShowRcloneConfig(false)} className={`px-4 py-2 text-xs font-bold rounded-xl border transition ${isDark ? 'border-slate-700 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-600'}`}>Close</button>
              <button onClick={saveRcloneConfig} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-sm transition">Save Changes</button>
            </div>
          </div>
        </div>
      )}
      {renderStreamModal()}
    </div>
  );
}
