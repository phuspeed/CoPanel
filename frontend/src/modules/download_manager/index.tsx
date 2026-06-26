/**
 * Download Manager — Synology Download Station–style UI.
 * Three-pane: sidebar filters | task table + toolbar | detail pane.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

type FilterKey = 'all' | 'downloading' | 'completed' | 'active' | 'inactive' | 'stopped';
type SettingsTab = 'general' | 'location' | 'file-hosting' | 'google' | 'aria2';
type DetailTab = 'general' | 'transfer';

interface Task {
  id: string;
  name: string;
  source_url: string;
  source_type: string;
  destination: string;
  status: string;
  total_bytes: number;
  downloaded_bytes: number;
  download_speed: number;
  upload_speed: number;
  progress: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  created_by?: string;
}

interface Settings {
  temp_folder: string;
  destination_folder: string;
  max_concurrent: number;
  max_download_speed_kbps: number;
  max_upload_speed_kbps: number;
  watched_folder: string;
  watched_auto_delete: boolean;
  google_api_key_set?: boolean;
  google_service_account_set?: boolean;
  google_oauth_connected?: boolean;
  aria2_available?: boolean;
  aria2_rpc_host?: string;
  aria2_rpc_port?: number;
  aria2_rpc_secret_set?: boolean;
}

interface EngineStatus {
  aria2_available: boolean;
  version: string;
  message: string;
}

interface OAuthStatus {
  configured: boolean;
  connected: boolean;
  accounts: { account_name: string; expiry?: string; updated_at?: string }[];
}

interface HostingProfile {
  id: string;
  name: string;
  type: 'curl' | 'api';
  url_patterns: string[];
  enabled: boolean;
  curl_template: string;
  api_config?: {
    resolve_url: string;
    method: string;
    headers: Record<string, string>;
    body_template: string;
    download_url_field: string;
    filename_field?: string;
  };
  accounts?: HostingAccount[];
}

interface HostingAccount {
  id: string;
  label: string;
  username: string;
  api_key_set?: boolean;
  cookie_set?: boolean;
  is_default: boolean;
}

interface FolderBrowse {
  current: string;
  parent: string | null;
  entries: { name: string; path: string; type: string }[];
  volumes: { label: string; path: string }[];
}

const FILTERS: { key: FilterKey; icon: keyof typeof Icons }[] = [
  { key: 'all', icon: 'List' },
  { key: 'downloading', icon: 'Download' },
  { key: 'completed', icon: 'CheckCircle2' },
  { key: 'active', icon: 'Activity' },
  { key: 'inactive', icon: 'PauseCircle' },
  { key: 'stopped', icon: 'Square' },
];

function fmtBytes(n: number): string {
  if (!n || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function fmtSpeed(bps: number): string {
  if (!bps) return '—';
  return `${fmtBytes(bps)}/s`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-500';
    case 'downloading':
    case 'connecting':
      return 'text-blue-500';
    case 'paused':
    case 'stopped':
      return 'text-amber-500';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-slate-500';
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <Icons.CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === 'downloading' || status === 'connecting')
    return <Icons.Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
  if (status === 'paused' || status === 'stopped') return <Icons.PauseCircle className="w-4 h-4 text-amber-500" />;
  if (status === 'error') return <Icons.AlertCircle className="w-4 h-4 text-red-500" />;
  return <Icons.Clock className="w-4 h-4 text-slate-400" />;
}

export default function DownloadManager() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const t = useMemo(
    () =>
      language === 'vi'
        ? {
            title: 'Download Manager',
            subtitle: 'Direct link, Google Drive, file hosting tùy chỉnh',
            search: 'Từ khóa hoặc URL',
            addUrl: 'Thêm URL',
            pause: 'Tạm dừng',
            resume: 'Tiếp tục',
            stop: 'Dừng',
            delete: 'Xóa',
            clearCompleted: 'Xóa hoàn tất',
            settings: 'Cài đặt',
            noTasks: 'Chưa có tác vụ tải.',
            colName: 'Tên tệp',
            colSize: 'Kích thước',
            colDownloaded: 'Đã tải',
            colProgress: 'Tiến độ',
            colSpeed: 'Tốc độ tải',
            colStatus: 'Trạng thái',
            colDest: 'Đích',
            tabGeneral: 'Chung',
            tabTransfer: 'Truyền tải',
            filterAll: 'Tất cả',
            filterDownloading: 'Đang tải',
            filterCompleted: 'Hoàn tất',
            filterActive: 'Đang hoạt động',
            filterInactive: 'Không hoạt động',
            filterStopped: 'Đã dừng',
            tempFolder: 'Thư mục tạm',
            destFolder: 'Thư mục đích',
            maxConcurrent: 'Tải đồng thời tối đa',
            watchedFolder: 'Thư mục theo dõi torrent/NZB',
            watchedAutoDelete: 'Xóa file torrent sau khi nạp',
            googleApiKey: 'Google API Key (folder listing)',
            fileHosting: 'File Hosting',
            addHosting: 'Thêm hosting',
            curlTemplate: 'Mẫu curl',
            apiResolve: 'API resolve URL',
            urlPatterns: 'Mẫu URL (mỗi dòng một pattern)',
            save: 'Lưu',
            cancel: 'Hủy',
            add: 'Thêm',
            urlPlaceholder: 'https://... hoặc link Google Drive',
            selectFolder: 'Chọn',
            accounts: 'Tài khoản',
            addAccount: 'Thêm tài khoản',
            uploadTorrent: 'Tải lên .torrent',
            aria2Status: 'aria2',
            speedDown: 'Tốc độ tải tối đa (KB/s, 0=không giới hạn)',
            speedUp: 'Tốc độ upload tối đa (KB/s, 0=không giới hạn)',
            googleOAuth: 'Google OAuth',
            connectGoogle: 'Kết nối Google Drive',
            oauthClientId: 'OAuth Client ID',
            oauthClientSecret: 'OAuth Client Secret',
            oauthRedirect: 'Redirect URI',
            aria2Rpc: 'aria2 RPC',
            aria2Host: 'RPC host',
            aria2Port: 'RPC port',
            aria2Secret: 'RPC secret',
            manageAccounts: 'Quản lý tài khoản',
            accountLabel: 'Nhãn',
            accountUser: 'Tên đăng nhập',
            accountPass: 'Mật khẩu',
            accountApiKey: 'API key',
            accountCookie: 'Cookie',
          }
        : {
            title: 'Download Manager',
            subtitle: 'Direct links, Google Drive, custom file hosting',
            search: 'Keyword or URL',
            addUrl: 'Add URL',
            pause: 'Pause',
            resume: 'Resume',
            stop: 'Stop',
            delete: 'Delete',
            clearCompleted: 'Clear completed',
            settings: 'Settings',
            noTasks: 'No download tasks yet.',
            colName: 'File name',
            colSize: 'File size',
            colDownloaded: 'Downloaded',
            colProgress: 'Progress',
            colSpeed: 'Download speed',
            colStatus: 'Status',
            colDest: 'Destination',
            tabGeneral: 'General',
            tabTransfer: 'Transfer',
            filterAll: 'All Downloads',
            filterDownloading: 'Downloading',
            filterCompleted: 'Completed',
            filterActive: 'Active',
            filterInactive: 'Inactive',
            filterStopped: 'Stopped',
            tempFolder: 'Temporary location',
            destFolder: 'Default destination',
            maxConcurrent: 'Max concurrent downloads',
            watchedFolder: 'Torrent/NZB watched folder',
            watchedAutoDelete: 'Delete loaded torrent/NZB files',
            googleApiKey: 'Google API Key (folder listing)',
            fileHosting: 'File Hosting',
            addHosting: 'Add hosting',
            curlTemplate: 'curl template',
            apiResolve: 'API resolve URL',
            urlPatterns: 'URL patterns (one per line)',
            save: 'Save',
            cancel: 'Cancel',
            add: 'Add',
            urlPlaceholder: 'https://... or Google Drive link',
            selectFolder: 'Browse',
            accounts: 'Accounts',
            addAccount: 'Add account',
            uploadTorrent: 'Upload .torrent',
            aria2Status: 'aria2',
            speedDown: 'Max download (KB/s, 0=unlimited)',
            speedUp: 'Max upload (KB/s, 0=unlimited)',
            googleOAuth: 'Google OAuth',
            connectGoogle: 'Connect Google Drive',
            oauthClientId: 'OAuth Client ID',
            oauthClientSecret: 'OAuth Client Secret',
            oauthRedirect: 'Redirect URI',
            aria2Rpc: 'aria2 RPC',
            aria2Host: 'RPC host',
            aria2Port: 'RPC port',
            aria2Secret: 'RPC secret',
            manageAccounts: 'Manage accounts',
            accountLabel: 'Label',
            accountUser: 'Username',
            accountPass: 'Password',
            accountApiKey: 'API key',
            accountCookie: 'Cookie',
          },
    [language],
  );

  const filterLabels: Record<FilterKey, string> = {
    all: t.filterAll,
    downloading: t.filterDownloading,
    completed: t.filterCompleted,
    active: t.filterActive,
    inactive: t.filterInactive,
    stopped: t.filterStopped,
  };

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('general');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [detected, setDetected] = useState<{ source_type: string; file_hosting_name?: string } | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Partial<Settings & { google_api_key?: string }>>({});
  const [hosting, setHosting] = useState<HostingProfile[]>([]);
  const [hostingDraft, setHostingDraft] = useState<Partial<HostingProfile> | null>(null);
  const [accountDraft, setAccountDraft] = useState<{ profileId: string; account?: HostingAccount; label: string; username: string; password: string; api_key: string; cookie: string } | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthRedirect, setOauthRedirect] = useState(`${typeof window !== 'undefined' ? window.location.origin : ''}/api/download_manager/oauth/google/callback`);
  const torrentInputRef = useRef<HTMLInputElement>(null);
  const [folderBrowse, setFolderBrowse] = useState<FolderBrowse | null>(null);
  const [folderTarget, setFolderTarget] = useState<'temp_folder' | 'destination_folder' | 'watched_folder' | null>(null);

  const selected = tasks.find((x) => x.id === selectedId) || null;

  const loadTasks = useCallback(async () => {
    try {
      const data = await api<Task[]>(`/api/download_manager/tasks?filter=${filter}&search=${encodeURIComponent(search)}`);
      setTasks(data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const loadSettings = useCallback(async () => {
    const [s, h, eng, oauth] = await Promise.all([
      api<Settings>('/api/download_manager/settings'),
      api<HostingProfile[]>('/api/download_manager/file-hosting'),
      api<EngineStatus>('/api/download_manager/engine/status'),
      api<OAuthStatus>('/api/download_manager/oauth/google/status'),
    ]);
    setSettings(s);
    setSettingsDraft(s);
    setHosting(h || []);
    setEngineStatus(eng);
    setOauthStatus(oauth);
  }, []);

  useEffect(() => {
    loadTasks();
    api<EngineStatus>('/api/download_manager/engine/status').then(setEngineStatus).catch(() => {});
    const iv = setInterval(() => {
      loadTasks();
      api<EngineStatus>('/api/download_manager/engine/status').then(setEngineStatus).catch(() => {});
    }, 3000);
    return () => clearInterval(iv);
  }, [loadTasks]);

  useEffect(() => {
    function onOAuthMessage(ev: MessageEvent) {
      if (!ev.data || ev.data.type !== 'copanel_dm_google_oauth') return;
      if (ev.data.ok) {
        loadSettings();
        setError(null);
      } else {
        setError(ev.data.error || 'Google OAuth failed');
      }
    }
    window.addEventListener('message', onOAuthMessage);
    return () => window.removeEventListener('message', onOAuthMessage);
  }, [loadSettings]);

  useEffect(() => {
    if (addUrl.length > 8) {
      api<{ source_type: string; file_hosting_name?: string }>('/api/download_manager/detect-url', {
        method: 'POST',
        body: { url: addUrl },
      })
        .then(setDetected)
        .catch(() => setDetected(null));
    } else {
      setDetected(null);
    }
  }, [addUrl]);

  async function handleAddTask() {
    if (!addUrl.trim()) return;
    setError(null);
    try {
      await api('/api/download_manager/tasks', { method: 'POST', body: { url: addUrl.trim() } });
      setAddUrl('');
      setAddOpen(false);
      loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function taskAction(action: 'pause' | 'resume' | 'stop') {
    if (!selectedId) return;
    try {
      await api(`/api/download_manager/tasks/${selectedId}/${action}`, { method: 'POST' });
      loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteSelected() {
    if (!selectedId) return;
    try {
      await api(`/api/download_manager/tasks/${selectedId}`, { method: 'DELETE' });
      setSelectedId(null);
      loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function clearCompleted() {
    try {
      await api('/api/download_manager/tasks/completed', { method: 'DELETE' });
      loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveSettings() {
    try {
      await api('/api/download_manager/settings', { method: 'PUT', body: settingsDraft });
      await loadSettings();
      setSettingsOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function openFolderPicker(target: typeof folderTarget) {
    setFolderTarget(target);
    const path =
      target === 'temp_folder'
        ? settingsDraft.temp_folder
        : target === 'destination_folder'
          ? settingsDraft.destination_folder
          : settingsDraft.watched_folder;
    const data = await api<FolderBrowse>(`/api/download_manager/folders/browse?path=${encodeURIComponent(path || '')}`);
    setFolderBrowse(data);
  }

  async function browseTo(path: string) {
    const data = await api<FolderBrowse>(`/api/download_manager/folders/browse?path=${encodeURIComponent(path)}`);
    setFolderBrowse(data);
  }

  function pickFolder(path: string) {
    if (!folderTarget) return;
    setSettingsDraft((d) => ({ ...d, [folderTarget]: path }));
    setFolderBrowse(null);
    setFolderTarget(null);
  }

  async function handleTorrentUpload(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const token = localStorage.getItem('copanel_token');
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/download_manager/tasks/upload-torrent', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok || body.status === 'error') {
        throw new Error(body.error?.message || 'Upload failed');
      }
      loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function startGoogleOAuth() {
    try {
      const result = await api<{ auth_url: string }>('/api/download_manager/oauth/google/start', {
        method: 'POST',
        body: {
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
          redirect_uri: oauthRedirect,
        },
      });
      window.open(result.auth_url, 'copanel_google_oauth', 'width=520,height=720');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveAccount() {
    if (!accountDraft?.profileId || !accountDraft.label.trim()) return;
    const payload = {
      label: accountDraft.label,
      username: accountDraft.username,
      password: accountDraft.password,
      api_key: accountDraft.api_key,
      cookie: accountDraft.cookie,
    };
    try {
      if (accountDraft.account?.id) {
        await api(`/api/download_manager/file-hosting/${accountDraft.profileId}/accounts/${accountDraft.account.id}`, {
          method: 'PUT',
          body: payload,
        });
      } else {
        await api(`/api/download_manager/file-hosting/${accountDraft.profileId}/accounts`, {
          method: 'POST',
          body: payload,
        });
      }
      setAccountDraft(null);
      await loadSettings();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveHosting() {
    if (!hostingDraft?.name) return;
    const payload = {
      ...hostingDraft,
      url_patterns: (hostingDraft.url_patterns as unknown as string) // if string from textarea
        ? String(hostingDraft.url_patterns).split('\n').map((s) => s.trim()).filter(Boolean)
        : hostingDraft.url_patterns || [],
    };
    try {
      if (hostingDraft.id) {
        await api(`/api/download_manager/file-hosting/${hostingDraft.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/api/download_manager/file-hosting', { method: 'POST', body: payload });
      }
      setHostingDraft(null);
      await loadSettings();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const panel = isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const btn = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div className={`flex flex-col h-[calc(100vh-4rem)] ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className={`text-sm ${muted}`}>{t.subtitle}</p>
        </div>
        {engineStatus && (
          <div className={`text-xs px-2 py-1 rounded border ${engineStatus.aria2_available ? 'border-emerald-500/40 text-emerald-500' : 'border-amber-500/40 text-amber-500'}`}>
            {t.aria2Status}: {engineStatus.aria2_available ? `v${engineStatus.version || '?'}` : engineStatus.message}
          </div>
        )}
      </div>
      <input
        ref={torrentInputRef}
        type="file"
        accept=".torrent"
        className="hidden"
        onChange={(e) => {
          handleTorrentUpload(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-red-500/10 text-red-500 text-sm flex justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <Icons.X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`w-52 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="p-2">
            <input
              className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-300'}`}
              placeholder={t.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <nav className="flex-1 overflow-y-auto px-1">
            {FILTERS.map(({ key, icon }) => {
              const Icon = Icons[icon] as React.ComponentType<{ className?: string }>;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded mb-0.5 ${
                    filter === key
                      ? isDark
                        ? 'bg-blue-600/30 text-blue-300'
                        : 'bg-blue-50 text-blue-700'
                      : `hover:${isDark ? 'bg-slate-800' : 'bg-slate-100'}`
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {filterLabels[key]}
                </button>
              );
            })}
          </nav>
          <div className={`p-2 border-t ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={() => {
                loadSettings();
                setSettingsOpen(true);
              }}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border ${btn}`}
            >
              <Icons.Settings className="w-4 h-4" />
              {t.settings}
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className={`flex items-center gap-1 px-2 py-1.5 border-b flex-wrap ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
            <button type="button" onClick={() => setAddOpen(true)} className={`p-2 rounded border ${btn}`} title={t.addUrl}>
              <Icons.Plus className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setAddOpen(true)} className={`p-2 rounded border ${btn}`} title={t.addUrl}>
              <Icons.Globe className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => torrentInputRef.current?.click()} className={`p-2 rounded border ${btn}`} title={t.uploadTorrent}>
              <Icons.FileUp className="w-4 h-4" />
            </button>
            <div className={`w-px h-6 mx-1 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />
            <button type="button" disabled={!selectedId} onClick={() => taskAction('resume')} className={`p-2 rounded border ${btn} disabled:opacity-40`}>
              <Icons.Play className="w-4 h-4" />
            </button>
            <button type="button" disabled={!selectedId} onClick={() => taskAction('pause')} className={`p-2 rounded border ${btn} disabled:opacity-40`}>
              <Icons.Pause className="w-4 h-4" />
            </button>
            <button type="button" disabled={!selectedId} onClick={() => taskAction('stop')} className={`p-2 rounded border ${btn} disabled:opacity-40`}>
              <Icons.Square className="w-4 h-4" />
            </button>
            <div className={`w-px h-6 mx-1 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />
            <button type="button" disabled={!selectedId} onClick={deleteSelected} className={`p-2 rounded border ${btn} disabled:opacity-40`}>
              <Icons.Trash2 className="w-4 h-4" />
            </button>
            <button type="button" onClick={clearCompleted} className={`p-2 rounded border ${btn}`}>
              <Icons.Eraser className="w-4 h-4" />
            </button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto min-h-0">
            {loading && tasks.length === 0 ? (
              <div className={`p-8 text-center ${muted}`}>
                <Icons.Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              </div>
            ) : tasks.length === 0 ? (
              <div className={`p-8 text-center ${muted}`}>{t.noTasks}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className={`sticky top-0 ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <tr>
                    <th className="w-8 p-2" />
                    <th className="text-left p-2 font-medium">{t.colName}</th>
                    <th className="text-right p-2 font-medium w-24">{t.colSize}</th>
                    <th className="text-right p-2 font-medium w-24">{t.colDownloaded}</th>
                    <th className="text-left p-2 font-medium w-36">{t.colProgress}</th>
                    <th className="text-right p-2 font-medium w-28">{t.colSpeed}</th>
                    <th className="text-left p-2 font-medium w-28">{t.colStatus}</th>
                    <th className="text-left p-2 font-medium">{t.colDest}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      className={`cursor-pointer border-b ${
                        selectedId === task.id
                          ? isDark
                            ? 'bg-blue-900/30'
                            : 'bg-blue-50'
                          : isDark
                            ? 'border-slate-800 hover:bg-slate-800/50'
                            : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <td className="p-2">
                        <StatusIcon status={task.status} />
                      </td>
                      <td className="p-2 truncate max-w-xs" title={task.name}>
                        {task.name}
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtBytes(task.total_bytes)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtBytes(task.downloaded_bytes)}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className={`flex-1 h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}>
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, task.progress || 0)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums w-12 text-right">{(task.progress || 0).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums text-xs">{fmtSpeed(task.download_speed)}</td>
                      <td className={`p-2 capitalize text-xs ${statusColor(task.status)}`}>{task.status}</td>
                      <td className={`p-2 truncate max-w-[10rem] text-xs ${muted}`} title={task.destination}>
                        {task.destination}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail pane */}
          {selected && (
            <div className={`h-44 shrink-0 border-t ${isDark ? 'border-slate-700 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex gap-4 px-4 pt-2 border-b border-transparent">
                {(
                  [
                    { key: 'general' as DetailTab, label: t.tabGeneral },
                    { key: 'transfer' as DetailTab, label: t.tabTransfer },
                  ]
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailTab(key)}
                    className={`pb-2 text-sm border-b-2 ${
                      detailTab === key
                        ? 'border-blue-500 text-blue-500'
                        : `border-transparent ${muted}`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm overflow-y-auto max-h-32">
                {detailTab === 'general' ? (
                  <>
                    <DetailRow label={t.colName} value={selected.name} />
                    <DetailRow label={t.colDest} value={selected.destination} />
                    <DetailRow label={t.colSize} value={fmtBytes(selected.total_bytes)} />
                    <DetailRow label="URL" value={selected.source_url} mono />
                    <DetailRow label="Type" value={selected.source_type} />
                    <DetailRow label="User" value={selected.created_by || '—'} />
                    <DetailRow label="Created" value={selected.created_at} />
                    {selected.error_message && <DetailRow label="Error" value={selected.error_message} error />}
                  </>
                ) : (
                  <>
                    <DetailRow label={t.colDownloaded} value={fmtBytes(selected.downloaded_bytes)} />
                    <DetailRow label={t.colSpeed} value={fmtSpeed(selected.download_speed)} />
                    <DetailRow label="Upload" value={fmtSpeed(selected.upload_speed)} />
                    <DetailRow label={t.colProgress} value={`${(selected.progress || 0).toFixed(1)}%`} />
                    <DetailRow label={t.colStatus} value={selected.status} />
                    <DetailRow label="Completed" value={selected.completed_at || '—'} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add URL modal */}
      {addOpen && (
        <Modal title={t.addUrl} onClose={() => setAddOpen(false)} isDark={isDark}>
          <input
            className={`w-full px-3 py-2 rounded border mb-2 ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-300'}`}
            placeholder={t.urlPlaceholder}
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
          />
          {detected && (
            <p className={`text-xs mb-3 ${muted}`}>
              Detected: <span className="font-medium">{detected.source_type}</span>
              {detected.file_hosting_name ? ` → ${detected.file_hosting_name}` : ''}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddOpen(false)} className={`px-4 py-2 rounded border ${btn}`}>
              {t.cancel}
            </button>
            <button type="button" onClick={handleAddTask} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
              {t.add}
            </button>
          </div>
        </Modal>
      )}

      {/* Settings modal */}
      {settingsOpen && settings && (
        <Modal title={t.settings} onClose={() => setSettingsOpen(false)} isDark={isDark} wide>
          <div className="flex gap-4 min-h-[360px]">
            <div className={`w-44 shrink-0 border-r pr-3 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
              {(['general', 'location', 'file-hosting', 'google', 'aria2'] as SettingsTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSettingsTab(tab)}
                  className={`block w-full text-left px-2 py-1.5 text-sm rounded mb-1 ${
                    settingsTab === tab ? 'bg-blue-600/20 text-blue-400' : muted
                  }`}
                >
                  {tab === 'general'
                    ? t.tabGeneral
                    : tab === 'location'
                      ? t.destFolder
                      : tab === 'file-hosting'
                        ? t.fileHosting
                        : tab === 'google'
                          ? t.googleOAuth
                          : t.aria2Rpc}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto pr-2">
              {settingsTab === 'general' && (
                <div className="space-y-4">
                  <Field label={t.tempFolder}>
                    <div className="flex gap-2">
                      <input
                        className={`flex-1 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        value={settingsDraft.temp_folder || ''}
                        onChange={(e) => setSettingsDraft((d) => ({ ...d, temp_folder: e.target.value }))}
                      />
                      <button type="button" onClick={() => openFolderPicker('temp_folder')} className={`px-3 py-1.5 text-sm rounded border ${btn}`}>
                        {t.selectFolder}
                      </button>
                    </div>
                  </Field>
                  <Field label={t.maxConcurrent}>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className={`w-24 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                      value={settingsDraft.max_concurrent ?? 3}
                      onChange={(e) => setSettingsDraft((d) => ({ ...d, max_concurrent: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label={t.speedDown}>
                    <input
                      type="number"
                      min={0}
                      className={`w-32 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                      value={settingsDraft.max_download_speed_kbps ?? 0}
                      onChange={(e) => setSettingsDraft((d) => ({ ...d, max_download_speed_kbps: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label={t.speedUp}>
                    <input
                      type="number"
                      min={0}
                      className={`w-32 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                      value={settingsDraft.max_upload_speed_kbps ?? 0}
                      onChange={(e) => setSettingsDraft((d) => ({ ...d, max_upload_speed_kbps: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label={t.googleApiKey}>
                    <input
                      type="password"
                      placeholder={settings.google_api_key_set ? '••••••••' : ''}
                      className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                      onChange={(e) => setSettingsDraft((d) => ({ ...d, google_api_key: e.target.value }))}
                    />
                  </Field>
                </div>
              )}
              {settingsTab === 'location' && (
                <div className="space-y-4">
                  <Field label={t.destFolder}>
                    <div className="flex gap-2">
                      <input
                        className={`flex-1 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        value={settingsDraft.destination_folder || ''}
                        onChange={(e) => setSettingsDraft((d) => ({ ...d, destination_folder: e.target.value }))}
                      />
                      <button type="button" onClick={() => openFolderPicker('destination_folder')} className={`px-3 py-1.5 text-sm rounded border ${btn}`}>
                        {t.selectFolder}
                      </button>
                    </div>
                  </Field>
                  <Field label={t.watchedFolder}>
                    <div className="flex gap-2">
                      <input
                        className={`flex-1 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        value={settingsDraft.watched_folder || ''}
                        onChange={(e) => setSettingsDraft((d) => ({ ...d, watched_folder: e.target.value }))}
                      />
                      <button type="button" onClick={() => openFolderPicker('watched_folder')} className={`px-3 py-1.5 text-sm rounded border ${btn}`}>
                        {t.selectFolder}
                      </button>
                    </div>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!settingsDraft.watched_auto_delete}
                      onChange={(e) => setSettingsDraft((d) => ({ ...d, watched_auto_delete: e.target.checked }))}
                    />
                    {t.watchedAutoDelete}
                  </label>
                </div>
              )}
              {settingsTab === 'file-hosting' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() =>
                      setHostingDraft({
                        name: '',
                        type: 'curl',
                        url_patterns: [],
                        enabled: true,
                        curl_template: "curl -L -o '{OUT}' -b '{COOKIE}' '{URL}'",
                      })
                    }
                    className="text-sm text-blue-500 hover:underline flex items-center gap-1"
                  >
                    <Icons.Plus className="w-4 h-4" /> {t.addHosting}
                  </button>
                  {hosting.map((p) => (
                    <div key={p.id} className={`p-3 rounded border ${panel}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className={`text-xs ${muted}`}>
                            {p.type} · {p.url_patterns.join(', ')}
                          </div>
                        </div>
                        <button type="button" onClick={() => setHostingDraft(p)} className="text-xs text-blue-500">
                          Edit
                        </button>
                      </div>
                      {(p.accounts?.length || 0) > 0 && (
                        <div className={`mt-2 text-xs ${muted}`}>
                          {t.accounts}: {p.accounts!.map((a) => a.label).join(', ')}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setAccountDraft({
                            profileId: p.id,
                            label: '',
                            username: '',
                            password: '',
                            api_key: '',
                            cookie: '',
                          })
                        }
                        className="mt-2 text-xs text-blue-500 hover:underline"
                      >
                        + {t.addAccount}
                      </button>
                    </div>
                  ))}
                  {accountDraft && (
                    <div className={`mt-4 p-4 rounded border space-y-2 ${panel}`}>
                      <div className="text-sm font-medium">{t.manageAccounts}</div>
                      <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} placeholder={t.accountLabel} value={accountDraft.label} onChange={(e) => setAccountDraft((d) => d && { ...d, label: e.target.value })} />
                      <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} placeholder={t.accountUser} value={accountDraft.username} onChange={(e) => setAccountDraft((d) => d && { ...d, username: e.target.value })} />
                      <input type="password" className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} placeholder={t.accountPass} value={accountDraft.password} onChange={(e) => setAccountDraft((d) => d && { ...d, password: e.target.value })} />
                      <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} placeholder={t.accountApiKey} value={accountDraft.api_key} onChange={(e) => setAccountDraft((d) => d && { ...d, api_key: e.target.value })} />
                      <textarea className={`w-full px-2 py-1.5 text-sm rounded border h-16 ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} placeholder={t.accountCookie} value={accountDraft.cookie} onChange={(e) => setAccountDraft((d) => d && { ...d, cookie: e.target.value })} />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setAccountDraft(null)} className={`px-3 py-1.5 text-sm rounded border ${btn}`}>{t.cancel}</button>
                        <button type="button" onClick={saveAccount} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white">{t.save}</button>
                      </div>
                    </div>
                  )}
                  {hostingDraft && (
                    <div className={`mt-4 p-4 rounded border space-y-3 ${panel}`}>
                      <input
                        className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        placeholder="Name (e.g. MEGA.nz)"
                        value={hostingDraft.name || ''}
                        onChange={(e) => setHostingDraft((d) => ({ ...d!, name: e.target.value }))}
                      />
                      <select
                        className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        value={hostingDraft.type || 'curl'}
                        onChange={(e) => setHostingDraft((d) => ({ ...d!, type: e.target.value as 'curl' | 'api' }))}
                      >
                        <option value="curl">curl template</option>
                        <option value="api">API resolve</option>
                      </select>
                      <textarea
                        className={`w-full px-2 py-1.5 text-sm rounded border h-20 ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                        placeholder={t.urlPatterns}
                        value={Array.isArray(hostingDraft.url_patterns) ? hostingDraft.url_patterns.join('\n') : ''}
                        onChange={(e) =>
                          setHostingDraft((d) => ({
                            ...d!,
                            url_patterns: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                          }))
                        }
                      />
                      {hostingDraft.type === 'curl' ? (
                        <textarea
                          className={`w-full px-2 py-1.5 text-sm font-mono text-xs rounded border h-24 ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                          placeholder={t.curlTemplate}
                          value={hostingDraft.curl_template || ''}
                          onChange={(e) => setHostingDraft((d) => ({ ...d!, curl_template: e.target.value }))}
                        />
                      ) : (
                        <input
                          className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`}
                          placeholder={t.apiResolve}
                          value={hostingDraft.api_config?.resolve_url || ''}
                          onChange={(e) =>
                            setHostingDraft((d) => ({
                              ...d!,
                              api_config: { ...(d?.api_config || { method: 'POST', headers: {}, body_template: '', download_url_field: 'direct_link' }), resolve_url: e.target.value },
                            }))
                          }
                        />
                      )}
                      <p className={`text-xs ${muted}`}>
                        Placeholders: {'{URL}'} {'{OUT}'} {'{USER}'} {'{PASS}'} {'{API_KEY}'} {'{COOKIE}'}
                      </p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setHostingDraft(null)} className={`px-3 py-1.5 text-sm rounded border ${btn}`}>
                          {t.cancel}
                        </button>
                        <button type="button" onClick={saveHosting} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white">
                          {t.save}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {settingsTab === 'google' && (
                <div className="space-y-4">
                  <p className={`text-sm ${muted}`}>
                    {oauthStatus?.connected || settings.google_oauth_connected
                      ? '✓ Google Drive connected'
                      : 'Connect Google account for private files and folder listing without API key.'}
                  </p>
                  <Field label={t.oauthClientId}>
                    <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} />
                  </Field>
                  <Field label={t.oauthClientSecret}>
                    <input type="password" className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} />
                  </Field>
                  <Field label={t.oauthRedirect}>
                    <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} value={oauthRedirect} onChange={(e) => setOauthRedirect(e.target.value)} />
                  </Field>
                  <button type="button" onClick={startGoogleOAuth} className="px-4 py-2 rounded bg-blue-600 text-white text-sm">
                    {t.connectGoogle}
                  </button>
                </div>
              )}
              {settingsTab === 'aria2' && (
                <div className="space-y-4">
                  <p className={`text-sm ${muted}`}>
                    Install aria2c and run with RPC enabled, e.g.{' '}
                    <code className="text-xs">aria2c --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all</code>
                  </p>
                  <Field label={t.aria2Host}>
                    <input className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} value={settingsDraft.aria2_rpc_host || '127.0.0.1'} onChange={(e) => setSettingsDraft((d) => ({ ...d, aria2_rpc_host: e.target.value }))} />
                  </Field>
                  <Field label={t.aria2Port}>
                    <input type="number" className={`w-32 px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} value={settingsDraft.aria2_rpc_port ?? 6800} onChange={(e) => setSettingsDraft((d) => ({ ...d, aria2_rpc_port: Number(e.target.value) }))} />
                  </Field>
                  <Field label={t.aria2Secret}>
                    <input type="password" placeholder={settings.aria2_rpc_secret_set ? '••••••••' : ''} className={`w-full px-2 py-1.5 text-sm rounded border ${isDark ? 'bg-slate-800 border-slate-600' : ''}`} onChange={(e) => setSettingsDraft((d) => ({ ...d, aria2_rpc_secret: e.target.value }))} />
                  </Field>
                </div>
              )}
            </div>
          </div>
          {settingsTab !== 'file-hosting' && (
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-700/30">
              <button type="button" onClick={() => setSettingsOpen(false)} className={`px-4 py-2 rounded border ${btn}`}>
                {t.cancel}
              </button>
              <button type="button" onClick={saveSettings} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
                {t.save}
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* Folder picker */}
      {folderBrowse && (
        <Modal title={t.selectFolder} onClose={() => { setFolderBrowse(null); setFolderTarget(null); }} isDark={isDark}>
          <div className={`text-xs mb-2 font-mono ${muted}`}>{folderBrowse.current}</div>
          {folderBrowse.parent && (
            <button type="button" onClick={() => browseTo(folderBrowse.parent!)} className="text-sm text-blue-500 mb-2 flex items-center gap-1">
              <Icons.ArrowUp className="w-4 h-4" /> ..
            </button>
          )}
          <div className="max-h-48 overflow-y-auto border rounded mb-3">
            {folderBrowse.entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => browseTo(e.path)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-blue-500/10`}
              >
                <Icons.Folder className="w-4 h-4 text-amber-500" />
                {e.name}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => pickFolder(folderBrowse.current)} className="w-full py-2 rounded bg-blue-600 text-white text-sm">
            {t.selectFolder}: {folderBrowse.current}
          </button>
        </Modal>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, error }: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 shrink-0 w-24">{label}:</span>
      <span className={`truncate ${mono ? 'font-mono text-xs' : ''} ${error ? 'text-red-500' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-blue-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  isDark,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  isDark: boolean;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`rounded-lg shadow-xl border max-h-[90vh] overflow-y-auto ${
          wide ? 'w-full max-w-3xl' : 'w-full max-w-md'
        } ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose}>
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
