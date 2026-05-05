import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

// --- Types ---
interface RemoteInfo {
  name: string;
  type: string;
}

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
  rclone_flags: string;
}

interface RcloneFlags {
  inplace: boolean;
  metadata: boolean;
  size_only: boolean;
  sync_deletions: boolean;
  transfers: number;
}

interface OAuthStatusItem {
  remote_name: string;
  provider: string;
  expiry?: string;
  updated_at?: string;
}

// Map rclone type -> display label + color class
const REMOTE_TYPE_META: Record<string, { label: string; color: string }> = {
  drive:      { label: 'Google Drive',  color: 'text-blue-400' },
  s3:         { label: 'S3 / Wasabi',   color: 'text-orange-400' },
  b2:         { label: 'Backblaze B2',  color: 'text-red-400' },
  dropbox:    { label: 'Dropbox',       color: 'text-sky-400' },
  onedrive:   { label: 'OneDrive',      color: 'text-blue-500' },
  sftp:       { label: 'SFTP',          color: 'text-green-400' },
  ftp:        { label: 'FTP',           color: 'text-green-500' },
  swift:      { label: 'Swift / OVH',   color: 'text-purple-400' },
  azureblob:  { label: 'Azure Blob',    color: 'text-blue-600' },
  mega:       { label: 'Mega',          color: 'text-red-500' },
  box:        { label: 'Box',           color: 'text-blue-400' },
  pcloud:     { label: 'pCloud',        color: 'text-teal-400' },
};

function getRemoteMeta(type: string) {
  return REMOTE_TYPE_META[type?.toLowerCase()] ?? { label: type || 'Unknown', color: 'text-slate-400' };
}

// --- Main component ---
export default function BackupManagerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [remotesConfigPath, setRemotesConfigPath] = useState('');
  const [remotesLoading, setRemotesLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // System & rclone config states
  const [systemFolders, setSystemFolders] = useState<{ name: string; path: string }[]>([]);
  const [showRcloneConfig, setShowRcloneConfig] = useState(false);
  const [rcloneConfigPath, setRcloneConfigPath] = useState('');
  const [oauthForm, setOauthForm] = useState({
    remote_name: '',
    client_id: '',
    client_secret: '',
    redirect_uri: `${window.location.origin}/api/backup_manager/oauth/google/callback`,
  });
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState('');
  const [oauthStatusList, setOauthStatusList] = useState<OAuthStatusItem[]>([]);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardTab, setWizardTab] = useState(1);
  const [wizardError, setWizardError] = useState('');
  const [form, setForm] = useState<Partial<Profile>>({
    profile_name: '',
    source_type: 'folder',
    source_path: '',
    remote_name: '',
    remote_path: '',
    cron_expression: '0 0 * * *',
    is_active: 1,
    realtime_sync: 0,
    rclone_flags: '{}',
  });
  const [flags, setFlags] = useState<RcloneFlags>({
    inplace: false,
    metadata: false,
    size_only: false,
    sync_deletions: true,
    transfers: 4,
  });

  // Stream state
  const [streamingProfile, setStreamingProfile] = useState<Profile | null>(null);
  const [streamProgress, setStreamProgress] = useState(-1);
  const [streamStats, setStreamStats] = useState<Record<string, any> | null>(null);
  const [streamLogs, setStreamLogs] = useState<{ text: string; isError: boolean }[]>([]);
  const [streamDone, setStreamDone] = useState(false);
  const streamLogsRef = useRef<HTMLDivElement>(null);

  // File Explorer state
  const [showExplorer, setShowExplorer] = useState(false);
  const [explorerPath, setExplorerPath] = useState('/');
  const [explorerItems, setExplorerItems] = useState<{ name: string; path: string; type: string }[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);

  const t = {
    en: {
      title: 'Professional Cloud Backup',
      desc: 'Zero-CLI backup manager powered by rclone. Automate cloud sync and real-time watching.',
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
      folderType: 'Website / Folder',
      browseBtn: 'Browse Server',
      remoteLabel: 'Cloud Remote (rclone)',
      cronLabel: 'Cron Schedule',
      realtimeSync: 'Real-time Sync (Watchdog)',
      syncDeletions: 'Sync Deletions (rclone sync)',
      streamingTitle: 'Backup in Progress',
      noProfiles: 'No backup profiles yet. Create one to get started.',
      noRemotes: 'No rclone remotes detected.',
      noRemotesHint: 'Click "Rclone Profiles" above to add a remote, or run rclone config on the server.',
      refreshRemotes: 'Refresh Remotes',
      profileName: 'Profile Name',
      sourcePath: 'Source Directory Path',
      dbName: 'MySQL Database Name',
      remotePath: 'Remote Directory Path',
      configFile: 'Detected config file',
      cloudSetup: 'Cloud Remote Setup',
      oauthClientId: 'Google OAuth Client ID',
      oauthClientSecret: 'Google OAuth Client Secret',
      oauthRedirectUri: 'Authorized Redirect URI',
      oauthRemoteName: 'Remote Name',
      startGoogleOAuth: 'Connect Google Drive',
    },
    vi: {
      title: 'Quản trị Sao lưu Đám mây',
      desc: 'Công cụ quản lý sao lưu Zero-CLI với rclone. Tự động hóa đồng bộ đám mây và theo dõi thời gian thực.',
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
      remoteLabel: 'Đám mây (rclone Remote)',
      cronLabel: 'Lịch Cron',
      realtimeSync: 'Đồng bộ Thời gian thực (Watchdog)',
      syncDeletions: 'Đồng bộ xóa file (rclone sync)',
      streamingTitle: 'Đang tiến hành sao lưu...',
      noProfiles: 'Chưa có cấu hình nào. Hãy tạo một cấu hình mới.',
      noRemotes: 'Không tìm thấy rclone remote nào.',
      noRemotesHint: 'Nhấn "Rclone Profiles" ở trên để thêm remote, hoặc chạy rclone config trên server.',
      refreshRemotes: 'Làm mới danh sách',
      profileName: 'Tên cấu hình',
      sourcePath: 'Đường dẫn thư mục nguồn',
      dbName: 'Tên cơ sở dữ liệu MySQL',
      remotePath: 'Đường dẫn trên Remote',
      configFile: 'File cấu hình phát hiện',
      cloudSetup: 'Cloud Remote Setup',
      oauthClientId: 'Google OAuth Client ID',
      oauthClientSecret: 'Google OAuth Client Secret',
      oauthRedirectUri: 'Authorized Redirect URI',
      oauthRemoteName: 'Remote Name',
      startGoogleOAuth: 'Connect Google Drive',
    },
  };
  const tr = t[language || 'en'];

  const showMsg = useCallback((text: string, isError = false) => {
    setMsg({ text, isError });
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setMsg(null), 6000);
  }, []);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  useEffect(() => {
    fetchProfiles();
    fetchRemotes();
    fetchSystemFolders();
    return () => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'copanel_google_oauth') return;
      if (data.ok && data.remote_name) {
        setOauthStatus(`Authorization completed for ${data.remote_name}`);
        fetchOAuthStatus(data.remote_name);
        showMsg(`Google Drive connected for remote ${data.remote_name}`);
      } else {
        showMsg(data.error || 'Google OAuth failed', true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [showMsg]);

  useEffect(() => {
    if (showRcloneConfig) {
      fetchOAuthStatusList();
    }
  }, [showRcloneConfig]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (streamLogsRef.current) {
      streamLogsRef.current.scrollTop = streamLogsRef.current.scrollHeight;
    }
  }, [streamLogs]);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/backup_manager/profiles', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setProfiles(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRemotes = async () => {
    setRemotesLoading(true);
    try {
      const res = await fetch('/api/backup_manager/remotes', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setRemotes(data.data || []);
        setRemotesConfigPath(data.config_path || '');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRemotesLoading(false);
    }
  };

  const fetchSystemFolders = async () => {
    try {
      const res = await fetch('/api/backup_manager/system-folders', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setSystemFolders(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRcloneConfig = async () => {
    try {
      const res = await fetch('/api/backup_manager/rclone-config', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setRcloneConfigPath(data.path || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchOAuthStatus = async (remoteName: string) => {
    if (!remoteName) return;
    try {
      const res = await fetch(`/api/backup_manager/oauth/google/status?remote_name=${encodeURIComponent(remoteName)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok && data?.data?.connected) {
        setOauthStatus(`Connected: ${remoteName}`);
        await fetch('/api/backup_manager/remotes/google', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ remote_name: remoteName }),
        });
        fetchRemotes();
        fetchOAuthStatusList();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchOAuthStatusList = async () => {
    try {
      const res = await fetch('/api/backup_manager/oauth/google/status', {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setOauthStatusList(Array.isArray(data?.data) ? data.data : []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startGoogleOAuth = async () => {
    if (!oauthForm.remote_name || !oauthForm.client_id || !oauthForm.client_secret || !oauthForm.redirect_uri) {
      showMsg('Please fill all Google OAuth fields', true);
      return;
    }
    setOauthLoading(true);
    setOauthStatus('');
    try {
      const res = await fetch('/api/backup_manager/oauth/google/start', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(oauthForm),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.detail || 'Failed to start Google OAuth', true);
        return;
      }
      const authUrl = data?.data?.auth_url;
      if (!authUrl) {
        showMsg('Google OAuth URL was not returned by server', true);
        return;
      }
      window.open(authUrl, '_blank', 'noopener,noreferrer,width=640,height=760');
      setOauthStatus('OAuth window opened. Complete consent to finish setup.');
    } catch (e) {
      showMsg('Failed to start Google OAuth', true);
    } finally {
      setOauthLoading(false);
    }
  };

  const formatDateTime = (value?: string) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const getExpiryVisualState = (value?: string): 'normal' | 'warning' | 'expired' => {
    if (!value) return 'normal';
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) return 'normal';
    const diffMs = expiry.getTime() - Date.now();
    if (diffMs <= 0) return 'expired';
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (diffMs < threeDaysMs) return 'warning';
    return 'normal';
  };

  const loadExplorer = async (path: string) => {
    setExplorerLoading(true);
    try {
      const res = await fetch(`/api/backup_manager/explore?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setExplorerItems(data.data || []);
        setExplorerPath(data.current_path || path);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setExplorerLoading(false);
    }
  };

  const validateWizardStep = (): string => {
    if (wizardTab === 1) {
      if (!form.profile_name?.trim()) return 'Please enter a profile name.';
      if (!form.source_path?.trim()) return form.source_type === 'folder' ? 'Please enter the source directory path.' : 'Please enter the database name.';
    }
    if (wizardTab === 2) {
      if (!form.remote_name) return 'Please select a cloud remote.';
    }
    return '';
  };

  const handleNextStep = () => {
    const err = validateWizardStep();
    if (err) { setWizardError(err); return; }
    setWizardError('');
    setWizardTab(wizardTab + 1);
  };

  const handleCreateProfile = async () => {
    const err = validateWizardStep();
    if (err) { setWizardError(err); return; }
    const payload = { ...form, rclone_flags: flags };
    try {
      const res = await fetch('/api/backup_manager/profiles', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('Profile created successfully!');
        setShowWizard(false);
        fetchProfiles();
      } else {
        showMsg(data.detail || 'Failed to create profile', true);
      }
    } catch (e) {
      showMsg('Failed to create profile', true);
    }
  };

  const handleDeleteProfile = async (id: number) => {
    if (!window.confirm('Delete this backup profile?')) return;
    try {
      await fetch(`/api/backup_manager/profiles/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      fetchProfiles();
    } catch (e) {
      console.error(e);
    }
  };

  const runStream = (profile: Profile) => {
    setStreamingProfile(profile);
    setStreamProgress(-1);
    setStreamStats(null);
    setStreamLogs([]);
    setStreamDone(false);

    const es = new EventSource(`/api/backup_manager/stream_task/${profile.id}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.msg) {
          setStreamLogs((prev) => [...prev, { text: data.msg, isError: false }]);
        }
        if (data.error) {
          setStreamLogs((prev) => [...prev, { text: `ERROR: ${data.error}`, isError: true }]);
        }
        if (data.stats) {
          setStreamStats(data.stats);
        }
        if (data.progress !== undefined) {
          setStreamProgress(data.progress);
        }
        if (data.done || data.error) {
          setStreamDone(true);
          es.close();
        }
      } catch {
        setStreamLogs((prev) => [...prev, { text: event.data, isError: false }]);
      }
    };

    es.onerror = () => {
      setStreamLogs((prev) => [...prev, { text: 'Connection lost.', isError: true }]);
      setStreamDone(true);
      es.close();
    };
  };

  // ---- UI Helpers ----
  const input = `w-full px-4 py-3 rounded-xl border text-sm focus:border-indigo-500 outline-none transition ${
    isDark ? 'bg-slate-950 border-slate-800 text-slate-200 placeholder-slate-600' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'
  }`;
  const card = `border p-6 rounded-2xl shadow-sm ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200'}`;
  const modalBox = `w-full rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'}`;
  const modalHeader = `p-4 flex items-center justify-between border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`;
  const modalFooter = `p-4 border-t flex justify-end gap-3 ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`;

  // ---- Remote select option renderer ----
  const renderRemoteOption = (r: RemoteInfo) => {
    const meta = getRemoteMeta(r.type);
    return (
      <option key={r.name} value={r.name}>
        {r.name} ({meta.label})
      </option>
    );
  };

  // ---- Wizard ----
  const renderWizard = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/40">
      <div className={`${modalBox} max-w-2xl`}>
        <div className={modalHeader}>
          <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.newProfile}</h3>
          <button onClick={() => setShowWizard(false)} className="text-slate-400 hover:text-red-500">
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps tab bar */}
        <div className="flex border-b select-none">
          {[1, 2, 3].map((step) => (
            <div
              key={step}
              className={`flex-1 text-center py-3 text-xs font-bold transition-all cursor-default ${
                wizardTab === step
                  ? isDark
                    ? 'bg-indigo-900/30 text-indigo-400 border-b-2 border-indigo-500'
                    : 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600'
                  : wizardTab > step
                  ? isDark
                    ? 'text-green-400 border-b-2 border-green-600/40'
                    : 'text-green-600 border-b-2 border-green-300'
                  : isDark
                  ? 'text-slate-600 border-b-2 border-transparent'
                  : 'text-slate-400 border-b-2 border-transparent'
              }`}
            >
              {step < wizardTab ? (
                <span className="inline-flex items-center gap-1">
                  <Icons.CheckCircle className="w-3.5 h-3.5" />
                  {step === 1 ? tr.wizardSource : step === 2 ? tr.wizardDest : tr.wizardSchedule}
                </span>
              ) : (
                <>{step === 1 ? tr.wizardSource : step === 2 ? tr.wizardDest : tr.wizardSchedule}</>
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          {wizardError && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-medium">
              <Icons.AlertCircle className="w-4 h-4 shrink-0" />
              {wizardError}
            </div>
          )}

          {/* Step 1: Source */}
          {wizardTab === 1 && (
            <div className="space-y-5">
              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.profileName}</label>
                <input
                  type="text"
                  value={form.profile_name}
                  onChange={(e) => setForm({ ...form, profile_name: e.target.value })}
                  placeholder="e.g. Daily Website Backup"
                  className={input}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {(['folder', 'mysql'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, source_type: type })}
                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition ${
                      form.source_type === type
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : isDark
                        ? 'border-slate-800 text-slate-400 hover:border-slate-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {type === 'folder' ? (
                      <Icons.Folder className={`w-8 h-8 ${form.source_type === 'folder' ? 'text-indigo-500' : ''}`} />
                    ) : (
                      <Icons.Database className={`w-8 h-8 ${form.source_type === 'mysql' ? 'text-indigo-500' : ''}`} />
                    )}
                    <span className="text-xs font-bold">{type === 'folder' ? tr.folderType : tr.dbType}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {form.source_type === 'folder' ? tr.sourcePath : tr.dbName}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.source_path}
                    onChange={(e) => setForm({ ...form, source_path: e.target.value })}
                    placeholder={form.source_type === 'folder' ? '/var/www/html' : 'my_database'}
                    className={`${input} flex-1 font-mono`}
                  />
                  {form.source_type === 'folder' && (
                    <button
                      type="button"
                      onClick={() => { loadExplorer('/'); setShowExplorer(true); }}
                      title={tr.browseBtn}
                      className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center"
                    >
                      <Icons.FolderSearch className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Destination */}
          {wizardTab === 2 && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.remoteLabel}</label>
                  <button
                    type="button"
                    onClick={fetchRemotes}
                    className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition ${
                      isDark ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <Icons.RefreshCw className={`w-3 h-3 ${remotesLoading ? 'animate-spin' : ''}`} />
                    {tr.refreshRemotes}
                  </button>
                </div>

                {remotes.length > 0 ? (
                  <>
                    <select
                      value={form.remote_name}
                      onChange={(e) => setForm({ ...form, remote_name: e.target.value })}
                      className={input}
                    >
                      <option value="">-- Select Remote --</option>
                      {remotes.map(renderRemoteOption)}
                    </select>

                    {/* Selected remote type badge */}
                    {form.remote_name && (() => {
                      const selected = remotes.find((r) => r.name === form.remote_name);
                      if (!selected) return null;
                      const meta = getRemoteMeta(selected.type);
                      return (
                        <div className={`flex items-center gap-2 mt-1 text-xs ${meta.color}`}>
                          <Icons.Cloud className="w-3.5 h-3.5" />
                          <span className="font-semibold">{meta.label}</span>
                          <span className={`font-mono text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>type: {selected.type}</span>
                        </div>
                      );
                    })()}

                    {/* Detected config path info */}
                    {remotesConfigPath && (
                      <p className={`text-[10px] font-mono mt-1 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                        {tr.configFile}: {remotesConfigPath}
                      </p>
                    )}
                  </>
                ) : (
                  <div className={`p-4 rounded-xl border-2 border-dashed space-y-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <p className={`text-xs font-semibold flex items-center gap-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                      <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
                      {tr.noRemotes}
                    </p>
                    <p className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.noRemotesHint}</p>
                    <button
                      type="button"
                      onClick={() => { fetchRcloneConfig(); setShowRcloneConfig(true); }}
                      className="mt-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition"
                    >
                      Open Rclone Profiles
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.remotePath}</label>
                <input
                  type="text"
                  value={form.remote_path}
                  onChange={(e) => setForm({ ...form, remote_path: e.target.value })}
                  placeholder="e.g. Backups/MySite"
                  className={`${input} font-mono`}
                />
              </div>
            </div>
          )}

          {/* Step 3: Schedule */}
          {wizardTab === 3 && (
            <div className="space-y-5">
              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.cronLabel}</label>
                <input
                  type="text"
                  value={form.cron_expression}
                  onChange={(e) => setForm({ ...form, cron_expression: e.target.value })}
                  placeholder="0 2 * * *"
                  className={`${input} font-mono`}
                />
                <p className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                  Tip: <code>0 2 * * *</code> = daily at 2:00 AM · <code>0 */6 * * *</code> = every 6 hours
                </p>
              </div>

              <div className={`space-y-3 pt-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                {[
                  { key: 'realtime_sync' as const, label: tr.realtimeSync, isFormKey: true },
                ].map(({ key, label, isFormKey }) => (
                  <label
                    key={key}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${isDark ? 'border-slate-800 bg-slate-950/50 hover:border-slate-700' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                  >
                    <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</span>
                    <input
                      type="checkbox"
                      checked={form[key] === 1}
                      onChange={(e) => setForm({ ...form, [key]: e.target.checked ? 1 : 0 })}
                      className="w-4 h-4 accent-indigo-600"
                    />
                  </label>
                ))}

                {[
                  { key: 'sync_deletions' as const, label: tr.syncDeletions },
                  { key: 'size_only' as const, label: 'Optimize: --size-only (faster, skip checksum)' },
                  { key: 'metadata' as const, label: 'Preserve metadata (--metadata)' },
                ].map(({ key, label }) => (
                  <label
                    key={key}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer ${isDark ? 'border-slate-800 bg-slate-950/50 hover:border-slate-700' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                  >
                    <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</span>
                    <input
                      type="checkbox"
                      checked={flags[key]}
                      onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
                      className="w-4 h-4 accent-indigo-600"
                    />
                  </label>
                ))}

                <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                  <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Parallel transfers</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={flags.transfers}
                    onChange={(e) => setFlags({ ...flags, transfers: Math.max(1, parseInt(e.target.value) || 4) })}
                    className={`w-16 px-2 py-1 rounded-lg border text-xs font-mono text-center outline-none focus:border-indigo-500 ${isDark ? 'bg-slate-950 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-5 border-t flex justify-between ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
          {wizardTab > 1 ? (
            <button
              type="button"
              onClick={() => { setWizardError(''); setWizardTab(wizardTab - 1); }}
              className={`px-4 py-2 text-xs font-bold rounded-xl border transition ${isDark ? 'border-slate-700 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-600'}`}
            >
              {tr.back}
            </button>
          ) : (
            <div />
          )}
          {wizardTab < 3 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              {tr.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateProfile}
              className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              {tr.save}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ---- Stream modal ----
  const renderStreamModal = () => {
    if (!streamingProfile) return null;
    const progressPct = streamProgress >= 0 ? streamProgress : 0;
    const isIndeterminate = streamProgress < 0;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60">
        <div className={`${modalBox} max-w-3xl`}>
          <div className={modalHeader}>
            <h3 className={`font-bold text-sm flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Activity className={`w-5 h-5 text-indigo-500 ${!streamDone ? 'animate-pulse' : ''}`} />
              {tr.streamingTitle} — {streamingProfile.profile_name}
            </h3>
            {streamDone && (
              <button onClick={() => setStreamingProfile(null)} className="text-slate-400 hover:text-red-500">
                <Icons.X className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="p-6 space-y-4">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold font-mono">
                <span className="text-indigo-500">Progress</span>
                <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                  {isIndeterminate && !streamDone ? 'Starting...' : `${progressPct}%`}
                </span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div
                  className={`h-full transition-all duration-500 relative ${streamDone && streamProgress === 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                  style={{ width: `${isIndeterminate ? 100 : Math.max(progressPct, 2)}%` }}
                >
                  {!streamDone && (
                    <div className={`absolute inset-0 ${isIndeterminate ? 'bg-white/30 animate-[pulse_1s_ease-in-out_infinite]' : 'bg-white/20 animate-pulse'}`} />
                  )}
                </div>
              </div>
            </div>

            {/* Stats row */}
            {streamStats && (
              <div className={`grid grid-cols-3 gap-3 text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {[
                  { label: 'Transferred', val: fmtBytes(streamStats.bytes ?? 0) },
                  { label: 'Files', val: String(streamStats.transfers ?? 0) },
                  { label: 'Checks', val: String(streamStats.checks ?? 0) },
                ].map(({ label, val }) => (
                  <div key={label} className={`p-2 rounded-lg text-center border ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className={`text-[9px] uppercase tracking-widest mb-1 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{label}</div>
                    <div className="font-bold">{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Terminal log */}
            <div
              ref={streamLogsRef}
              className={`h-56 p-4 rounded-xl font-mono text-[10px] overflow-y-auto scroll-smooth ${isDark ? 'bg-slate-950 text-green-400 border border-slate-800' : 'bg-slate-900 text-green-400 border border-slate-800'}`}
            >
              {streamLogs.map((log, i) => (
                <div key={i} className={`mb-0.5 leading-relaxed break-all whitespace-pre-wrap ${log.isError ? 'text-red-400' : ''}`}>
                  {log.text}
                </div>
              ))}
              {!streamDone && <div className="animate-pulse text-green-600">▌</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- File Explorer ----
  const renderExplorer = () => {
    if (!showExplorer) return null;
    const parentPath = (() => {
      const parts = explorerPath.replace(/\\/g, '/').split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/') || '/';
    })();

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40">
        <div className={`${modalBox} max-w-2xl h-[75vh]`}>
          <div className={modalHeader}>
            <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.browseBtn}</h3>
            <button onClick={() => setShowExplorer(false)} className="text-slate-400 hover:text-red-500">
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          {/* Shortcut buttons */}
          <div className={`p-3 border-b flex flex-wrap gap-1.5 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            {systemFolders.map((f) => (
              <button
                key={f.path}
                onClick={() => loadExplorer(f.path)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition ${isDark ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300' : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-600'}`}
              >
                {f.name}
              </button>
            ))}
          </div>

          {/* Path + up button */}
          <div className={`p-3 flex items-center gap-2 text-xs font-mono border-b ${isDark ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
            <button onClick={() => loadExplorer(parentPath)} className="p-1 hover:bg-slate-500/20 rounded" title="Up">
              <Icons.CornerLeftUp className="w-4 h-4" />
            </button>
            <span className="flex-1 truncate">{explorerPath}</span>
            {explorerLoading && <Icons.Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {explorerItems.length === 0 && !explorerLoading && (
              <p className={`text-center text-xs py-8 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>Empty directory</p>
            )}
            {explorerItems.map((item) => (
              <div
                key={item.path}
                onClick={() => item.type === 'folder' && loadExplorer(item.path)}
                className={`flex items-center justify-between p-2.5 rounded-lg transition ${
                  item.type === 'folder' ? 'cursor-pointer' : 'opacity-60 cursor-default'
                } ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.type === 'folder' ? (
                    <Icons.Folder className="w-5 h-5 text-yellow-500 shrink-0" />
                  ) : (
                    <Icons.File className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate">{item.name}</span>
                </div>
                {item.type === 'folder' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setForm({ ...form, source_path: item.path });
                      setShowExplorer(false);
                    }}
                    className="px-3 py-1 text-[10px] font-bold bg-indigo-600 text-white rounded hover:bg-indigo-500 shrink-0 ml-2"
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

  // ---- Main render ----
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Header */}
      <div
        className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all ${
          isDark
            ? 'bg-gradient-to-br from-indigo-900/30 via-slate-900 to-slate-950 border-slate-800'
            : 'bg-gradient-to-br from-indigo-50/50 via-white to-slate-50 border-slate-200'
        }`}
      >
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2
            className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
              isDark
                ? 'bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent'
            }`}
          >
            <Icons.Cloud className={`w-8 h-8 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.desc}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={() => { fetchRcloneConfig(); setShowRcloneConfig(true); }}
            className="px-5 py-3 bg-slate-600 hover:bg-slate-500 text-white font-bold text-sm rounded-xl shadow-lg flex items-center gap-2 transition"
          >
            <Icons.Settings className="w-5 h-5" />
            Cloud Setup
          </button>
          <button
            onClick={() => {
              setForm({ profile_name: '', source_type: 'folder', source_path: '', remote_name: '', remote_path: '', cron_expression: '0 0 * * *', is_active: 1, realtime_sync: 0, rclone_flags: '{}' });
              setFlags({ inplace: false, metadata: false, size_only: false, sync_deletions: true, transfers: 4 });
              setWizardTab(1);
              setWizardError('');
              setShowWizard(true);
            }}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition"
          >
            <Icons.Plus className="w-5 h-5" />
            {tr.newProfile}
          </button>
        </div>
      </div>

      {/* Toast message */}
      {msg && (
        <div
          className={`p-4 border rounded-xl text-xs flex items-center gap-2 ${
            msg.isError
              ? 'bg-red-500/10 border-red-500/30 text-red-500'
              : 'bg-green-500/10 border-green-500/30 text-green-500'
          }`}
        >
          {msg.isError ? <Icons.AlertTriangle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-60 hover:opacity-100">
            <Icons.X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Profiles grid */}
      <div className={card}>
        <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 mb-6 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
          <Icons.LayoutDashboard className="w-5 h-5 text-indigo-500" />
          {tr.taskMonitor}
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
            {profiles.length}
          </span>
        </h3>

        {profiles.length === 0 ? (
          <div className={`p-10 text-center border-2 border-dashed rounded-xl ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
            <Icons.CloudOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">{tr.noProfiles}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {profiles.map((p) => {
              const remoteInfo = remotes.find((r) => r.name === p.remote_name);
              const remoteMeta = remoteInfo ? getRemoteMeta(remoteInfo.type) : null;

              return (
                <div
                  key={p.id}
                  className={`p-5 rounded-xl border relative overflow-hidden group ${
                    isDark ? 'bg-slate-950/50 border-slate-800 hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className={`absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rotate-45 ${p.is_active ? 'bg-green-500/20' : 'bg-slate-500/20'}`} />

                  <div className="flex items-start justify-between mb-3 relative z-10">
                    <div className="space-y-1 min-w-0 flex-1 mr-3">
                      <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                        {p.source_type === 'mysql' ? (
                          <Icons.Database className="w-4 h-4 text-blue-500 shrink-0" />
                        ) : (
                          <Icons.Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                        )}
                        <span className="truncate">{p.profile_name}</span>
                      </h4>
                      <div className={`text-[11px] font-mono truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        <span className="text-indigo-400">{p.source_path}</span>
                        <span className="mx-1">→</span>
                        <span className={remoteMeta?.color ?? 'text-slate-400'}>
                          {p.remote_name}:{p.remote_path}
                        </span>
                      </div>
                      {remoteMeta && (
                        <div className={`text-[10px] font-semibold ${remoteMeta.color}`}>
                          {remoteMeta.label}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {p.realtime_sync === 1 && (
                        <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 rounded text-[10px] font-bold flex items-center gap-1">
                          <Icons.Eye className="w-3 h-3" /> Watch
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.is_active ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className={`flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    <span className="flex items-center gap-1.5">
                      <Icons.Calendar className="w-3.5 h-3.5" />
                      {p.cron_expression || 'No cron'}
                    </span>
                  </div>

                  <div className={`flex items-center gap-2 pt-4 border-t relative z-10 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <button
                      onClick={() => runStream(p)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition"
                    >
                      <Icons.Play className="w-3.5 h-3.5" /> {tr.runNow}
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(p.id)}
                      className={`px-3 py-2 border rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${isDark ? 'border-slate-700 text-red-400 hover:bg-red-500/10' : 'border-slate-300 text-red-600 hover:bg-red-50'}`}
                    >
                      <Icons.Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showWizard && renderWizard()}
      {showExplorer && renderExplorer()}
      {renderStreamModal()}

      {/* Cloud Remote Setup Modal */}
      {showRcloneConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/40">
          <div className={`${modalBox} max-w-2xl`}>
            <div className={modalHeader}>
              <div className="space-y-0.5">
                <h3 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.cloudSetup}</h3>
                <p className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{remotesConfigPath || rcloneConfigPath}</p>
              </div>
              <button onClick={() => setShowRcloneConfig(false)} className="text-slate-400 hover:text-red-500">
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Zero-CLI mode: enter Google OAuth app information and complete consent.
                The backend will exchange token and update `rclone.conf` automatically.
              </p>
              <div className="space-y-3">
                <input
                  value={oauthForm.remote_name}
                  onChange={(e) => setOauthForm({ ...oauthForm, remote_name: e.target.value })}
                  placeholder={tr.oauthRemoteName}
                  className={input}
                />
                <input
                  value={oauthForm.client_id}
                  onChange={(e) => setOauthForm({ ...oauthForm, client_id: e.target.value })}
                  placeholder={tr.oauthClientId}
                  className={input}
                />
                <input
                  type="password"
                  value={oauthForm.client_secret}
                  onChange={(e) => setOauthForm({ ...oauthForm, client_secret: e.target.value })}
                  placeholder={tr.oauthClientSecret}
                  className={input}
                />
                <input
                  value={oauthForm.redirect_uri}
                  onChange={(e) => setOauthForm({ ...oauthForm, redirect_uri: e.target.value })}
                  placeholder={tr.oauthRedirectUri}
                  className={input}
                />
                {oauthStatus && (
                  <p className={`text-xs ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>{oauthStatus}</p>
                )}
              </div>

              <div className={`mt-2 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    OAuth Status
                  </p>
                  <button
                    type="button"
                    onClick={fetchOAuthStatusList}
                    className={`text-[10px] px-2 py-1 rounded-lg border font-bold transition ${isDark ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-300 text-slate-600 hover:bg-white'}`}
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-56 overflow-auto">
                  {oauthStatusList.length === 0 ? (
                    <p className={`px-4 py-3 text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>No OAuth remotes connected yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                        <tr>
                          <th className="text-left px-4 py-2">Remote</th>
                          <th className="text-left px-4 py-2">Connected</th>
                          <th className="text-left px-4 py-2">Updated At</th>
                          <th className="text-left px-4 py-2">Expiry</th>
                        </tr>
                      </thead>
                      <tbody className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {oauthStatusList.map((item) => {
                          const expiryState = getExpiryVisualState(item.expiry);
                          const expiryClass =
                            expiryState === 'expired'
                              ? 'text-red-500 font-semibold'
                              : expiryState === 'warning'
                              ? 'text-amber-500 font-semibold'
                              : '';
                          const expiryLabel =
                            expiryState === 'expired'
                              ? 'Expired'
                              : expiryState === 'warning'
                              ? 'Expiring soon'
                              : '';
                          return (
                            <tr key={item.remote_name} className={isDark ? 'border-t border-slate-800' : 'border-t border-slate-200'}>
                              <td className="px-4 py-2 font-mono">{item.remote_name}</td>
                              <td className="px-4 py-2">
                                <span className="text-green-500 font-semibold">Yes</span>
                              </td>
                              <td className="px-4 py-2">{formatDateTime(item.updated_at)}</td>
                              <td className={`px-4 py-2 ${expiryClass}`}>
                                {formatDateTime(item.expiry)}
                                {expiryLabel ? <span className="ml-2 text-[10px]">({expiryLabel})</span> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div className={modalFooter}>
              <button
                onClick={() => setShowRcloneConfig(false)}
                className={`px-4 py-2 text-xs font-bold rounded-xl border transition ${isDark ? 'border-slate-700 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-600'}`}
              >
                Cancel
              </button>
              <button
                onClick={startGoogleOAuth}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-sm transition"
              >
                {oauthLoading ? 'Starting...' : tr.startGoogleOAuth}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
