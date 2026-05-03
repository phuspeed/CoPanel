/**
 * Backup and Sync Manager
 * Supports automated local directory backups, cron automation, and Google Drive Rclone configuration.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';



export default function BackupAndSyncDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const [config, setConfig] = useState<any>({
    source_dir: '',
    rclone_remote_name: 'gdrive',
    rclone_folder: 'CoPanel-Backups',
    google_drive_client_id: '',
    google_drive_client_secret: '',
    google_drive_refresh_token: '',
    cron_expression: '0 0 * * *',
    sync_rules: []
  });

  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [crons, setCrons] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);


  // For dynamic real-time rclone watcher rules
  const [localPath, setLocalPath] = useState<string>('');
  const [remotePath, setRemotePath] = useState<string>('');
  const [ruleType, setRuleType] = useState<'database' | 'static_files'>('static_files');

  const token = localStorage.getItem('copanel_token');

  // Multi-language translation tokens
  const t = {
    en: {
      title: 'Automated Backups & Real-time Sync',
      desc: 'Create secure system backups, set cron timers, and sync your data with Google Drive in real-time.',
      watcherStatus: 'Watcher Daemon Status',
      active: 'Active',
      inactive: 'Inactive',
      configsTitle: 'Backup Configurations',
      localPathLabel: 'Local Target Directory',
      localPathDesc: 'Directory on the server to automatically back up.',
      cronLabel: 'Cron Timing Pattern',
      cronDesc: 'Cron timing string syntax (e.g., 0 0 * * * for daily).',
      cloudTitle: 'Google Drive Rclone Cloud Backup',
      clientIdLabel: 'Google Client ID',
      clientSecretLabel: 'Google Client Secret',
      refreshTokenLabel: 'Google Refresh Token / Token JSON',
      saveConfigBtn: 'Save & Deploy Configuration',
      syncNowBtn: 'Manual Backup Now',
      watcherTitle: 'Real-time Watcher (Auto Sync Rules)',
      watcherDesc: 'Select target folders to monitor and immediately synchronize to Google Drive via Rclone.',
      watcherLocal: 'Local Folder Path',
      watcherRemote: 'Remote Rclone Destination',
      watcherMode: 'Optimization Mode (CPU/Disk)',
      modeStatic: 'Static Files & Images (--size-only)',
      modeDb: 'Databases/WAL Files (--metadata --inplace)',
      addWatcherBtn: 'Append Auto Sync Rule',
      noRules: 'No real-time Rclone auto-sync rules found.',
      cronTabTitle: 'Registered Crontab Backup Timers',
      cronTabDesc: 'These background timers execute the scheduled backup job automatically.',
      clearCrons: 'Clear Backup Crons',
      noCrons: 'No active backup crontab timers found.',
      filesTitle: 'Existing Backup Files on Disk',
      filesDesc: 'Locally generated system backups stored securely in /opt/copanel/backups.',
      noFiles: 'No local backups found.',
      oauthRedirectUri: 'Dynamic Authorized Redirect URI (Google Cloud)',
      oauthRedirectTip: 'Copy this URL and paste it into your Google Cloud Authorized Redirect URIs:',
      oauthBtn: 'Direct Login & Connect Google Drive'
    },
    vi: {
      title: 'Sao lưu & Đồng bộ Tự động',
      desc: 'Tạo bản sao lưu cục bộ, đặt lịch cron tự động và đồng bộ dữ liệu theo thời gian thực với Google Drive.',
      watcherStatus: 'Trạng thái Watcher Daemon',
      active: 'Bật',
      inactive: 'Tắt',
      configsTitle: 'Cấu hình Sao lưu',
      localPathLabel: 'Thư mục nguồn cần sao lưu',
      localPathDesc: 'Thư mục trên máy chủ cần nén và đồng bộ dữ liệu.',
      cronLabel: 'Cấu hình Lịch Cron',
      cronDesc: 'Cú pháp cron chuẩn (Ví dụ: 0 0 * * * để sao lưu mỗi ngày).',
      cloudTitle: 'Cấu hình Rclone Cloud Google Drive',
      clientIdLabel: 'Google Client ID',
      clientSecretLabel: 'Google Client Secret',
      refreshTokenLabel: 'Google Refresh Token / Chuỗi Token JSON',
      saveConfigBtn: 'Lưu & Khởi tạo cấu hình',
      syncNowBtn: 'Bắt đầu Sao lưu Ngay',
      watcherTitle: 'Real-time Watcher (Tự động đồng bộ)',
      watcherDesc: 'Theo dõi trực tiếp sự thay đổi tệp tin trong thư mục nguồn và đồng bộ ngay lập tức lên Google Drive.',
      watcherLocal: 'Đường dẫn thư mục nội bộ',
      watcherRemote: 'Đường dẫn đích (Google Drive)',
      watcherMode: 'Chế độ tối ưu hóa (CPU/Disk)',
      modeStatic: 'Tệp tĩnh & Hình ảnh (--size-only)',
      modeDb: 'Databases/WAL Tệp dữ liệu lớn (--inplace)',
      addWatcherBtn: 'Thêm Quy tắc đồng bộ mới',
      noRules: 'Không tìm thấy quy tắc đồng bộ thời gian thực nào.',
      cronTabTitle: 'Tiến trình Crontab đang hoạt động',
      cronTabDesc: 'Lịch trình sao lưu nền tự động thực thi trên VPS của bạn.',
      clearCrons: 'Xóa toàn bộ lịch Cron',
      noCrons: 'Không tìm thấy lịch cron sao lưu nào.',
      filesTitle: 'Các bản sao lưu có sẵn trên ổ đĩa',
      filesDesc: 'Tệp tin lưu trữ cục bộ tại đường dẫn /opt/copanel/backups.',
      noFiles: 'Không tìm thấy bản sao lưu nào.',
      oauthRedirectUri: 'Đường dẫn Callback URL OAUth',
      oauthRedirectTip: 'Sao chép đường dẫn này và dán vào phần Authorized Redirect URIs trong Google Cloud OAuth:',
      oauthBtn: 'Đăng nhập & Cấp quyền Google Drive'
    }
  };

  const tr = t[language || 'en'];

  const isIp = /^[0-9.]+$/.test(window.location.hostname);
  const redirectUri = isIp
    ? `http://${window.location.hostname}.nip.io:${window.location.port || '8686'}/backup-manager`
    : `${window.location.origin}/backup-manager`;

  // States for interactive cron time

  // Directory picker modal state
  const [dirPickerOpen, setDirPickerOpen] = useState<boolean>(false);
  const [currentPickPath, setCurrentPickPath] = useState<string>('');
  const [dirList, setDirList] = useState<any[]>([]);
  const [activePickerTarget, setActivePickerTarget] = useState<'source_dir' | 'local_path' | null>(null);

  // Connection status state
  const [connTesting, setConnTesting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'rclone' | 'scheduled' | 'realtime'>('rclone');

  const openDirectoryPicker = async (target: 'source_dir' | 'local_path', initialPath?: string) => {
    setActivePickerTarget(target);
    setDirPickerOpen(true);
    let p = initialPath || (config.source_dir || '/');
    if (!p || p === '') p = '/';
    await fetchDirs(p);
  };

  const fetchDirs = async (p: string) => {
    try {
      setCurrentPickPath(p);
      const res = await fetch(`/api/file_manager/list?path=${encodeURIComponent(p)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          // Filter only directories
          const dirsOnly = data.files.filter((f: any) => f.is_dir);
          setDirList(dirsOnly);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectDir = (p: string) => {
    if (activePickerTarget === 'source_dir') {
      setConfig({ ...config, source_dir: p });
    } else if (activePickerTarget === 'local_path') {
      setLocalPath(p);
    }
    setDirPickerOpen(false);
  };

  const goUpDir = () => {
    if (!currentPickPath || currentPickPath === '/') return;
    const parts = currentPickPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    fetchDirs(parentPath);
  };



  const handleTestConnection = async () => {
    setConnTesting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/test_connection', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setMsg({ text: data.message, isError: false });
      } else {
        setMsg({ text: data.message || 'Connection test failed', isError: true });
      }
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to trigger test connection', isError: true });
    } finally {
      setConnTesting(false);
    }
  };


  const fetchConfigAndCrons = async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const cr = await fetch('/api/backup_manager/config', { headers });
      if (cr.ok) {
        const d = await cr.json();
        if (d.data) setConfig(d.data);
      }

      const cronsRes = await fetch('/api/backup_manager/cronjobs', { headers });
      if (cronsRes.ok) {
        const d = await cronsRes.json();
        if (d.data) setCrons(d.data);
      }

      const backupsRes = await fetch('/api/backup_manager/backups', { headers });
      if (backupsRes.ok) {
        const d = await backupsRes.json();
        if (d.data) setBackups(d.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConfigAndCrons();

    // Catch query code parameter from Google redirect
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      handleExchangeCode(code);
    }
  }, []);

  const handleExchangeCode = async (authCode: string) => {
    setMsg({ text: language === 'vi' ? 'Đang trao đổi mã xác thực với Google...' : 'Exchanging authorization code with Google...', isError: false });
    try {
      const res = await fetch('/api/backup_manager/exchange-oauth-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          client_id: config.google_drive_client_id,
          client_secret: config.google_drive_client_secret,
          code: authCode,
          redirect_uri: redirectUri
        })
      });

      if (res.ok) {
        setMsg({ text: language === 'vi' ? '✓ Xác thực Google Drive và lưu cấu hình thành công!' : '✓ Google Drive authorized and configured successfully!', isError: false });
        window.history.replaceState({}, document.title, window.location.pathname);
        fetchConfigAndCrons();
      } else {
        const data = await res.json();
        setMsg({ text: data.detail || (language === 'vi' ? 'Không thể trao đổi mã token' : 'Failed to exchange token with Google.'), isError: true });
      }
    } catch {
      setMsg({ text: language === 'vi' ? 'Lỗi giao tiếp máy chủ' : 'Server communication error.', isError: true });
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setMsg({ text: language === 'vi' ? '✓ Cấu hình đã được lưu và kích hoạt!' : '✓ Configuration saved and successfully updated!', isError: false });
        fetchConfigAndCrons();
      } else {
        setMsg({ text: 'Failed to save configuration.', isError: true });
      }
    } catch {
      setMsg({ text: 'Failed to communicate with the backend.', isError: true });
    }
  };

  const handleAddRule = () => {
    if (!localPath || !remotePath) return;
    const rules = config.sync_rules ? [...config.sync_rules] : [];
    rules.push({ local_path: localPath, remote_path: remotePath, type: ruleType });
    setConfig({ ...config, sync_rules: rules });
    setLocalPath('');
    setRemotePath('');
  };

  const handleDeleteRule = (idx: number) => {
    const rules = config.sync_rules ? [...config.sync_rules] : [];
    rules.splice(idx, 1);
    setConfig({ ...config, sync_rules: rules });
  };

  // Multiple Backup Task Handlers
  const [taskSourceDir, setTaskSourceDir] = useState<string>('');
  const [taskRcloneFolder, setTaskRcloneFolder] = useState<string>('CoPanel-Backups');
  const [taskHour, setTaskHour] = useState<string>('0');
  const [taskMinute, setTaskMinute] = useState<string>('0');

  const handleAddTask = () => {
    if (!taskSourceDir || !taskRcloneFolder) return;
    const currentTasks = config.backup_tasks ? [...config.backup_tasks] : [];
    const newTask = {
      id: 'task_' + Math.random().toString(36).substr(2, 6),
      source_dir: taskSourceDir,
      rclone_folder: taskRcloneFolder,
      cron_expression: `${taskMinute} ${taskHour} * * *`
    };
    currentTasks.push(newTask);
    setConfig({ ...config, backup_tasks: currentTasks });
    setTaskSourceDir('');
    setTaskRcloneFolder('CoPanel-Backups');
    setTaskHour('0');
    setTaskMinute('0');
  };

  const handleDeleteTask = (idx: number) => {
    const currentTasks = config.backup_tasks ? [...config.backup_tasks] : [];
    currentTasks.splice(idx, 1);
    setConfig({ ...config, backup_tasks: currentTasks });
  };

  const handleRunTaskNow = async (id: string) => {
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/backup-task-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setMsg({ text: data.message, isError: false });
        fetchConfigAndCrons();
      } else {
        setMsg({ text: data.message || 'Backup execution failed.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error initiating manual backup task.', isError: true });
    }
  };

  const handleDeleteCrons = async () => {
    if (!window.confirm(language === 'vi' ? 'Bạn có chắc chắn muốn xóa toàn bộ lịch sao lưu?' : 'Clear all backup cron entries?')) return;
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/cronjobs/delete', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        setMsg({ text: language === 'vi' ? 'Đã xóa toàn bộ cronjobs.' : 'Cleared backup crons.', isError: false });
        fetchConfigAndCrons();
      }
    } catch {
      setMsg({ text: 'Error connecting to backend.', isError: true });
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!window.confirm(language === 'vi' ? `Bạn có chắc muốn xóa tệp tin ${filename}?` : `Delete backup file ${filename}?`)) return;
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/backups/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ filename })
      });
      if (res.ok) {
        setMsg({ text: language === 'vi' ? `Đã xóa bản sao lưu: ${filename}` : `Deleted backup file: ${filename}`, isError: false });
        fetchConfigAndCrons();
      } else {
        setMsg({ text: 'Failed to delete backup file.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    }
  };

  const handleDirectOAuth = () => {
    if (!config.google_drive_client_id) {
      setMsg({ text: language === 'vi' ? 'Vui lòng nhập Google Client ID trước khi xác thực.' : 'Please enter the Google Client ID before authorization.', isError: true });
      return;
    }
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(config.google_drive_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/drive&access_type=offline&prompt=consent`;
    window.location.href = oauthUrl;
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Dynamic Header Module Banner */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark
          ? 'bg-gradient-to-br from-indigo-600/10 via-slate-900 to-slate-950 border-slate-800'
          : 'bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
            isDark ? 'bg-gradient-to-r from-indigo-400 via-purple-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-indigo-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Cloud className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.title} <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-semibold tracking-wider">v1.1 - Premium Tabbed</span>
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className={`flex flex-col items-center md:items-end gap-1 text-center md:text-right p-4 rounded-xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] transition duration-200 ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{tr.watcherStatus}</span>
          <span className={`text-lg font-mono font-bold flex items-center gap-1.5 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            {tr.active}
          </span>
        </div>
      </div>

      {msg && (
        <div className={`p-4 border rounded-xl text-xs flex items-center gap-2 max-w-xl animate-fade-in ${
          msg.isError
            ? isDark ? 'bg-red-950/20 border-red-800/40 text-red-400' : 'bg-red-50 border-red-200 text-red-600'
            : isDark ? 'bg-indigo-950/20 border-indigo-800/40 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-600'
        }`}>
          {msg.isError ? <Icons.AlertTriangle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}

      {/* 3-Tab switcher */}
      <div className="flex border-b mb-6 select-none overflow-x-auto gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('rclone')}
          className={`flex items-center gap-2 px-6 py-3 text-xs font-bold transition duration-200 border-b-2 shrink-0 ${
            activeTab === 'rclone'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
        >
          <Icons.Globe className="w-4 h-4" />
          {language === 'vi' ? '1. Cấu hình Rclone' : '1. Rclone Setup'}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('scheduled')}
          className={`flex items-center gap-2 px-6 py-3 text-xs font-bold transition duration-200 border-b-2 shrink-0 ${
            activeTab === 'scheduled'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
        >
          <Icons.Calendar className="w-4 h-4" />
          {language === 'vi' ? '2. Sao lưu định kỳ (Local)' : '2. Scheduled Backups'}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('realtime')}
          className={`flex items-center gap-2 px-6 py-3 text-xs font-bold transition duration-200 border-b-2 shrink-0 ${
            activeTab === 'realtime'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/20'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
        >
          <Icons.Eye className="w-4 h-4" />
          {language === 'vi' ? '3. Đồng bộ thời gian thực' : '3. Real-time Sync'}
        </button>
      </div>

      <div>
        {activeTab === 'rclone' && (
          <form onSubmit={handleSaveConfig} className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 h-fit max-w-xl mx-auto ${
            isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              <Icons.Globe className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
              {tr.cloudTitle}
            </h3>

            <div className="space-y-4">
              <div className={`border p-4 rounded-xl space-y-3 ${isDark ? 'bg-indigo-950/20 border-indigo-900/30' : 'bg-indigo-50/40 border-indigo-100'}`}>
                <h5 className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                  <Icons.ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  {tr.oauthRedirectUri}
                </h5>
                <p className={`text-[10px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {tr.oauthRedirectTip}
                </p>
                <code className={`p-2 font-mono text-xs select-all block rounded-lg border text-center font-bold tracking-wide break-all ${
                  isDark ? 'bg-slate-950/80 border-slate-800 text-indigo-400' : 'bg-white border-slate-200 text-indigo-600'
                }`}>
                  {redirectUri}
                </code>

                <div className={`border-t pt-2 mt-2 space-y-1 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <span className={`text-[10px] font-bold uppercase tracking-wider block ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    💡 {language === 'vi' ? 'Hoặc Sử dụng Google Desktop App (Khuyên dùng khi dùng IP không có SSL)' : 'OR Use Google Desktop App (Recommended for IP addresses without SSL)'}:
                  </span>
                  <p className={`text-[10px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {language === 'vi'
                      ? 'Tại Google Cloud Console, chọn loại ứng dụng: Desktop App (Ứng dụng dành cho máy tính). Sau đó chạy lệnh bên dưới trên Terminal máy tính cá nhân của bạn để lấy token:'
                      : 'In Google Cloud Console, select Application Type: Desktop App. Then run the command below in your local terminal CLI to get your token:'}
                  </p>
                  <code className={`p-1.5 font-mono text-[10px] select-all block rounded border break-all ${
                    isDark ? 'bg-slate-950 border-slate-800 text-green-400' : 'bg-white border-slate-200 text-green-600'
                  }`}>
                    rclone authorize "drive" "{config.google_drive_client_id || 'YOUR_CLIENT_ID'}" "{config.google_drive_client_secret || 'YOUR_CLIENT_SECRET'}"
                  </code>
                </div>
              </div>

              <div className="space-y-1">
                <label className={`text-[11px] font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.clientIdLabel}</label>
                <input
                  type="text"
                  value={config.google_drive_client_id || ''}
                  onChange={(e) => setConfig({ ...config, google_drive_client_id: e.target.value })}
                  placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-all ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className={`text-[11px] font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.clientSecretLabel}</label>
                <input
                  type="password"
                  value={config.google_drive_client_secret || ''}
                  onChange={(e) => setConfig({ ...config, google_drive_client_secret: e.target.value })}
                  placeholder="Enter client secret"
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 font-mono transition-all ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className={`text-[11px] font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.refreshTokenLabel}</label>
                <textarea
                  value={config.google_drive_refresh_token || ''}
                  onChange={(e) => setConfig({ ...config, google_drive_refresh_token: e.target.value })}
                  placeholder="Directly authenticate using the quick login button above or paste rclone token JSON here"
                  rows={2}
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-all font-mono ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              {/* Fast OAuth direct authentication trigger */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDirectOAuth}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl font-bold text-xs transition-all shadow-md hover:shadow-indigo-500/20"
                >
                  <Icons.Chrome className="w-4 h-4" />
                  {tr.oauthBtn}
                </button>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={connTesting}
                  className={`px-4 py-3 border font-bold text-xs rounded-xl flex items-center gap-2 transition duration-200 shrink-0 ${
                    isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400' : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-indigo-600'
                  }`}
                >
                  {connTesting ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Globe className="w-4 h-4" />}
                  {language === 'vi' ? 'Kiểm tra kết nối' : 'Test Connection'}
                </button>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-bold text-xs transition-all shadow-md"
              >
                <Icons.Save className="w-4 h-4" />
                {language === 'vi' ? 'Lưu cấu hình Rclone' : 'Save Rclone Configuration'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'scheduled' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 transition duration-300 h-fit ${
              isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                <Icons.Plus className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                {language === 'vi' ? 'Tạo tác vụ sao lưu mới' : 'New Scheduled Backup Task'}
              </h3>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {language === 'vi' ? 'Thư mục nguồn cần sao lưu' : 'Local Directory to Back up'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={taskSourceDir}
                      onChange={(e) => setTaskSourceDir(e.target.value)}
                      placeholder="/var/www/html"
                      className={`flex-1 border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-all ${
                        isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => openDirectoryPicker('source_dir', taskSourceDir)}
                      className={`px-4 py-2 text-xs border rounded-xl flex items-center gap-1 hover:border-indigo-500 font-medium transition duration-200 ${
                        isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400' : 'bg-slate-100 border-slate-200 text-slate-700 hover:text-indigo-600'
                      }`}
                    >
                      <Icons.Folder className="w-4 h-4" />
                      {language === 'vi' ? 'Chọn' : 'Browse'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {language === 'vi' ? 'Thư mục đích trên Rclone (Cloud)' : 'Google Drive Remote Folder'}
                  </label>
                  <input
                    type="text"
                    value={taskRcloneFolder}
                    onChange={(e) => setTaskRcloneFolder(e.target.value)}
                    placeholder="CoPanel-Backups/site1"
                    className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 font-mono transition-all ${
                      isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                    }`}
                  />
                </div>

                <div className="space-y-1">
                  <label className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {language === 'vi' ? 'Lựa chọn thời gian chạy định kỳ' : 'Cron Timing Pattern'}
                  </label>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{language === 'vi' ? 'Giờ' : 'Hour'}:</span>
                      <select
                        value={taskHour}
                        onChange={(e) => setTaskHour(e.target.value)}
                        className={`border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 font-mono transition-all ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                        }`}
                      >
                        {Array.from({ length: 24 }).map((_, i) => (
                          <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{language === 'vi' ? 'Phút' : 'Minute'}:</span>
                      <select
                        value={taskMinute}
                        onChange={(e) => setTaskMinute(e.target.value)}
                        className={`border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 font-mono transition-all ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                        }`}
                      >
                        {Array.from({ length: 60 }).map((_, i) => (
                          <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap pt-2">
                  <button
                    type="button"
                    onClick={handleAddTask}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs transition-all shadow"
                  >
                    <Icons.Plus className="w-4 h-4" />
                    {language === 'vi' ? 'Thêm tác vụ' : 'Add Task'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    className={`px-5 py-3 border font-bold text-xs rounded-xl flex items-center gap-2 transition duration-200 ${
                      isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400' : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-indigo-600'
                    }`}
                  >
                    <Icons.Save className="w-4 h-4" />
                    {language === 'vi' ? 'Lưu' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            {/* List of active scheduled tasks */}
            <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 transition duration-300 h-fit ${
              isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                <Icons.List className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                {language === 'vi' ? 'Tác vụ sao lưu định kỳ' : 'Backup Tasks'}
              </h3>
              {config.backup_tasks && config.backup_tasks.length > 0 ? (
                <div className="space-y-3">
                  {config.backup_tasks.map((t: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 transition duration-200 ${
                        isDark ? 'bg-slate-950 border-slate-800/80 hover:border-slate-700' : 'bg-slate-50/50 border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1 flex-1 min-w-[200px]">
                        <div className={`text-xs font-bold font-mono break-all leading-tight ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {t.source_dir}
                        </div>
                        <div className={`text-[10px] leading-tight flex items-center gap-3 mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          <span className="flex items-center gap-1">
                            <Icons.Folder className="w-3.5 h-3.5" />
                            {t.rclone_folder}
                          </span>
                          <span className="flex items-center gap-1">
                            <Icons.Calendar className="w-3.5 h-3.5" />
                            {t.cron_expression}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRunTaskNow(t.id)}
                          className={`p-2 border rounded-xl transition ${
                            isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-indigo-400 hover:text-indigo-300' : 'bg-white hover:bg-indigo-50 border-slate-200 text-indigo-600 hover:text-indigo-700'
                          }`}
                          title={language === 'vi' ? 'Chạy backup ngay' : 'Trigger now'}
                        >
                          <Icons.Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(idx)}
                          className={`p-2 border rounded-xl transition ${
                            isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400 hover:text-red-300' : 'bg-white hover:bg-red-50 border-slate-200 text-red-600 hover:text-red-700'
                          }`}
                          title={language === 'vi' ? 'Xóa tác vụ' : 'Delete task'}
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-xs text-center border p-4 rounded-xl leading-relaxed ${isDark ? 'text-slate-500 border-slate-800/40 bg-slate-950/20' : 'text-slate-400 border-slate-100 bg-slate-50/50'}`}>
                  {language === 'vi' ? 'Chưa có tác vụ sao lưu nào được thiết lập.' : 'No scheduled backup tasks found.'}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'realtime' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 transition duration-300 h-fit ${
              isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                <Icons.Eye className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                {tr.watcherTitle}
              </h3>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.watcherDesc}</p>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {tr.watcherLocal}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={localPath}
                      onChange={(e) => setLocalPath(e.target.value)}
                      placeholder="e.g. /home/Docker/saleco"
                      className={`flex-1 border rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-all font-mono ${
                        isDark ? 'bg-slate-900/60 border-slate-800/60 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => openDirectoryPicker('local_path', localPath)}
                      className={`px-3 py-2 text-xs border rounded-xl flex items-center gap-1 hover:border-indigo-500 font-medium transition duration-200 ${
                        isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400' : 'bg-slate-100 border-slate-200 text-slate-700 hover:text-indigo-600'
                      }`}
                    >
                      <Icons.Folder className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {tr.watcherRemote}
                  </label>
                  <input
                    type="text"
                    value={remotePath}
                    onChange={(e) => setRemotePath(e.target.value)}
                    placeholder="e.g. gdrive:Backup_VPS/saleco"
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-all font-mono ${
                      isDark ? 'bg-slate-900/60 border-slate-800/60 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  />
                </div>

                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {tr.watcherMode}
                  </label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as any)}
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-all ${
                      isDark ? 'bg-slate-900/60 border-slate-800/60 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  >
                    <option value="static_files">{tr.modeStatic}</option>
                    <option value="database">{tr.modeDb}</option>
                  </select>
                </div>

                <div className="flex gap-2 flex-wrap pt-2">
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs transition-all shadow"
                  >
                    <Icons.Plus className="w-4 h-4" />
                    {tr.addWatcherBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    className={`px-5 py-3 border font-bold text-xs rounded-xl flex items-center gap-2 transition duration-200 ${
                      isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400' : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-indigo-600'
                    }`}
                  >
                    <Icons.Save className="w-4 h-4" />
                    {language === 'vi' ? 'Lưu' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            {/* List of active synchronization rules */}
            <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 transition duration-300 h-fit flex flex-col justify-between ${
              isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                <Icons.List className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                {language === 'vi' ? 'Danh sách quy tắc đồng bộ' : 'Sync Rules'}
              </h3>
              {config.sync_rules && config.sync_rules.length > 0 ? (
                <div className="space-y-3">
                  {config.sync_rules.map((r: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 transition duration-200 ${
                        isDark ? 'bg-slate-950 border-slate-800/80 hover:border-slate-700' : 'bg-slate-50/50 border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1 flex-1 min-w-[200px]">
                        <div className={`text-xs font-bold font-mono break-all leading-tight ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {r.local_path}
                        </div>
                        <div className={`text-[10px] leading-tight flex items-center gap-3 mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          <span className="flex items-center gap-1">
                            <Icons.Globe className="w-3.5 h-3.5" />
                            {r.remote_path}
                          </span>
                          <span className="flex items-center gap-1">
                            <Icons.Cpu className="w-3.5 h-3.5" />
                            {r.type === 'database' ? tr.modeDb : tr.modeStatic}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteRule(idx)}
                        className={`p-2 border rounded-xl transition shrink-0 ${
                          isDark ? 'bg-slate-800 hover:bg-red-950/40 border-slate-700 hover:border-red-900/40 text-red-400' : 'bg-white hover:bg-red-50 border-slate-200 hover:border-red-200 text-red-600'
                        }`}
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-xs text-center border p-4 rounded-xl leading-relaxed ${isDark ? 'text-slate-500 border-slate-800/40 bg-slate-950/20' : 'text-slate-400 border-slate-100 bg-slate-50/50'}`}>
                  {tr.noRules}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Background cron processes and Disk storage usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        {/* Active Backup Cron Jobs */}
        <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 flex flex-col transition-all duration-300 ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.Clock className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.cronTabTitle}
          </h3>
          <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.cronTabDesc}</p>
          {crons && crons.length > 0 ? (
            <div className="space-y-2 overflow-y-auto max-h-[200px] pr-1">
              {crons.map((cron, idx) => (
                <div key={idx} className={`p-3 border rounded-xl text-xs flex flex-col gap-1 ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60' : 'bg-slate-50 border-slate-100'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-mono font-bold px-2 py-0.5 border rounded-lg text-indigo-500 dark:text-indigo-300 ${
                      isDark ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'
                    }`}>
                      {cron.expression}
                    </span>
                    <button
                      onClick={handleDeleteCrons}
                      className={`text-[10px] px-2.5 py-1 rounded-lg font-bold border transition duration-150 ${
                        isDark ? 'bg-red-950/40 hover:bg-red-900/60 border-red-800/60 text-red-400' : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600'
                      }`}
                    >
                      {tr.clearCrons}
                    </button>
                  </div>
                  <div className={`font-mono text-[10px] break-all leading-tight mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    {cron.command}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-500 border-slate-800/40 bg-slate-950/20' : 'text-slate-400 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noCrons}
            </div>
          )}
        </div>

        {/* Local backup disk zip explorer */}
        <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4 flex flex-col transition-all duration-300 ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.FileText className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.filesTitle}
          </h3>
          <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.filesDesc}</p>
          {backups && backups.length > 0 ? (
            <div className="space-y-2 overflow-y-auto max-h-[200px] pr-1">
              {backups.map((backup, idx) => (
                <div key={idx} className={`p-3 border rounded-xl text-xs flex items-center justify-between gap-3 animate-fade-in ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60' : 'bg-slate-50 border-slate-100'
                }`}>
                  <div className="flex-1 min-w-0">
                    <div className={`flex items-center gap-1.5 font-mono font-bold break-all leading-snug text-indigo-500 dark:text-indigo-300`}>
                      <Icons.Archive className={`w-4 h-4 shrink-0 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} /> {backup.name}
                    </div>
                    <div className={`flex items-center gap-4 mt-1 text-[10px] font-semibold select-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      <span className="flex items-center gap-1">
                        <Icons.HardDrive className="w-3 h-3" /> {(backup.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      <span className="flex items-center gap-1">
                        <Icons.Calendar className="w-3 h-3" /> {new Date(backup.modified * 1000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteBackup(backup.name)}
                    className={`p-2 rounded-xl border transition shrink-0 ${
                      isDark ? 'bg-slate-900 hover:bg-red-950/60 border-slate-800 hover:border-red-900/60 text-red-400' : 'bg-white hover:bg-red-50 border-slate-200 hover:border-red-200 text-red-600'
                    }`}
                    title="Delete"
                  >
                    <Icons.Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-500 border-slate-800/40 bg-slate-950/20' : 'text-slate-400 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noFiles}
            </div>
          )}
        </div>
      </div>

      {/* Directory picker modal */}
      {dirPickerOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-lg p-6 rounded-2xl border shadow-2xl flex flex-col max-h-[85vh] transition duration-300 ${
            isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
          }`}>
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Icons.Folder className="w-5 h-5 text-indigo-500" />
                {language === 'vi' ? 'Chọn thư mục máy chủ' : 'Select Server Directory'}
              </h3>
              <button
                type="button"
                onClick={() => setDirPickerOpen(false)}
                className={`p-1.5 rounded-xl transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            {/* Breadcrumb / current path input */}
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={goUpDir}
                disabled={currentPickPath === '/'}
                className={`p-2 border rounded-xl transition ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 disabled:opacity-40' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 disabled:opacity-40'
                }`}
                title={language === 'vi' ? 'Lên cấp trên' : 'Go up one level'}
              >
                <Icons.ArrowUp className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={currentPickPath}
                onChange={(e) => setCurrentPickPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchDirs(currentPickPath);
                }}
                className={`flex-1 border rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500 transition duration-200 ${
                  isDark ? 'bg-slate-950 border-slate-800 text-indigo-400' : 'bg-slate-50 border-slate-200 text-indigo-600'
                }`}
              />
              <button
                type="button"
                onClick={() => fetchDirs(currentPickPath)}
                className={`p-2 border rounded-xl transition ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                <Icons.RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Directory items list */}
            <div className={`flex-1 overflow-y-auto border rounded-xl p-2 min-h-[250px] space-y-1 mb-4 select-none ${
              isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50/50 border-slate-200'
            }`}>
              {dirList.length > 0 ? (
                dirList.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    onClick={() => fetchDirs(item.path)}
                    className={`p-2.5 rounded-xl flex items-center justify-between text-xs cursor-pointer transition ${
                      isDark ? 'hover:bg-indigo-950/40 border border-transparent hover:border-indigo-800/60' : 'hover:bg-indigo-50 border border-transparent hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icons.Folder className="w-4 h-4 shrink-0 text-amber-500" />
                      <span className="font-medium break-all">{item.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectDir(item.path);
                      }}
                      className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition ${
                        isDark ? 'bg-slate-900 border-slate-800 hover:bg-indigo-600 hover:border-indigo-600 text-indigo-400 hover:text-white' : 'bg-white border-slate-200 hover:bg-indigo-600 hover:border-indigo-600 text-indigo-600 hover:text-white'
                      }`}
                    >
                      {language === 'vi' ? 'Chọn' : 'Select'}
                    </button>
                  </div>
                ))
              ) : (
                <div className={`p-4 text-xs text-center leading-relaxed ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                  {language === 'vi' ? 'Không có thư mục con nào.' : 'No subdirectories found.'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setDirPickerOpen(false)}
                className={`px-4 py-2 rounded-xl border text-xs font-bold transition ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {language === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => handleSelectDir(currentPickPath)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition shadow"
              >
                {language === 'vi' ? 'Chọn thư mục này' : 'Select current folder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
