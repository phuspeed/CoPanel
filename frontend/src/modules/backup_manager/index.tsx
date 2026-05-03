/**
 * Backup and Sync Manager
 * Supports automated local directory backups, cron automation, and Google Drive Rclone configuration.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface SyncRule {
  local_path: string;
  remote_path: string;
  type: 'database' | 'static_files';
}

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

  const handleSetupCron = async () => {
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/cronjobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cron_expression: config.cron_expression })
      });
      if (res.ok) {
        setMsg({ text: language === 'vi' ? '✓ Đăng ký tiến trình Cron thành công!' : '✓ Successfully scheduled cron timer!', isError: false });
        fetchConfigAndCrons();
      } else {
        setMsg({ text: 'Failed to create crontab timer.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
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

  const handleBackupNow = async () => {
    setMsg({ text: language === 'vi' ? 'Đang tạo và đồng bộ sao lưu, vui lòng chờ...' : 'Backing up now, please wait...', isError: false });
    try {
      const res = await fetch('/api/backup_manager/backup-now', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: `✓ ${data.message}`, isError: false });
        fetchConfigAndCrons();
      } else {
        setMsg({ text: data.detail || 'Backup failed.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error invoking backup.', isError: true });
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
            {tr.title}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        {/* Backup configuration */}
        <form onSubmit={handleSaveConfig} className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 h-fit ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.Settings className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.configsTitle}
          </h3>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.localPathLabel}</label>
              <input
                type="text"
                value={config.source_dir || ''}
                onChange={(e) => setConfig({ ...config, source_dir: e.target.value })}
                placeholder="/var/www/html"
                required
                className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                }`}
              />
              <span className={`text-[10px] block leading-tight ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.localPathDesc}</span>
            </div>

            <div className="space-y-1">
              <label className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.cronLabel}</label>
              <input
                type="text"
                value={config.cron_expression || ''}
                onChange={(e) => setConfig({ ...config, cron_expression: e.target.value })}
                placeholder="0 0 * * *"
                className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-indigo-500 font-mono transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50/50 border-slate-200 text-slate-800'
                }`}
              />
              <span className={`text-[10px] block leading-tight ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.cronDesc}</span>
            </div>

            {/* Cloud Storage section */}
            <div className={`border-t pt-4 space-y-4 ${isDark ? 'border-slate-800/80' : 'border-slate-100'}`}>
              <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                <Icons.Globe className="w-3.5 h-3.5" /> {tr.cloudTitle}
              </h4>

              {/* Step 1: Callback URI */}
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
              <button
                type="button"
                onClick={handleDirectOAuth}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl font-bold text-xs transition-all shadow-md hover:shadow-indigo-500/20"
              >
                <Icons.Chrome className="w-4 h-4" />
                {tr.oauthBtn}
              </button>
            </div>
          </div>

          <div className={`flex flex-wrap items-center gap-2 pt-2 border-t ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
            <button
              type="submit"
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-lg ${
                isDark ? 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/20' : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              <Icons.Save className="w-3.5 h-3.5" /> {tr.saveConfigBtn}
            </button>
            <button
              type="button"
              onClick={handleBackupNow}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-lg ${
                isDark ? 'bg-green-600 hover:bg-green-500 hover:shadow-green-500/20' : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              <Icons.Zap className="w-3.5 h-3.5" /> {tr.syncNowBtn}
            </button>
          </div>
        </form>

        {/* Sync rules creator (Real-time Watcher) */}
        <div className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 h-fit flex flex-col justify-between ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <div className="space-y-4">
            <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              <Icons.Eye className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
              {tr.watcherTitle}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.watcherDesc}</p>

            <div className={`border p-4 rounded-xl space-y-3 transition duration-200 ${
              isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/50 border-slate-100'
            }`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.watcherLocal}</label>
                  <input
                    type="text"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="e.g. /home/Docker/saleco"
                    className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-all font-mono ${
                      isDark ? 'bg-slate-900/60 border-slate-800/60 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  />
                </div>
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.watcherRemote}</label>
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
              </div>

              <div className="space-y-1">
                <label className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.watcherMode}</label>
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

              <button
                type="button"
                onClick={handleAddRule}
                disabled={!localPath || !remotePath}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-lg disabled:opacity-40 ${
                  isDark ? 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/20' : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                <Icons.Plus className="w-3.5 h-3.5" /> {tr.addWatcherBtn}
              </button>
            </div>

            {/* Existing rules list */}
            {config.sync_rules && config.sync_rules.length > 0 ? (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {config.sync_rules.map((rule: SyncRule, idx: number) => (
                  <div key={idx} className={`flex items-center justify-between p-3 border rounded-xl text-xs gap-3 ${
                    isDark ? 'bg-slate-950/60 border-slate-800/60' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 font-mono font-bold break-all text-indigo-500 dark:text-indigo-300">
                        {rule.local_path}
                      </div>
                      <div className={`font-mono flex items-center gap-1 break-all ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                        <Icons.ArrowRight className="w-3 h-3 shrink-0" /> {rule.remote_path}
                      </div>
                      <span className={`text-[10px] font-semibold mt-1 block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {rule.type === 'database' ? 'DB/WAL Mode (--inplace)' : 'Static Mode (--size-only)'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(idx)}
                      className={`p-2 rounded-xl border transition shrink-0 ${
                        isDark ? 'bg-slate-900 hover:bg-red-950/60 border-slate-800 hover:border-red-900/60 text-red-400' : 'bg-white hover:bg-red-50 border-slate-200 hover:border-red-200 text-red-600'
                      }`}
                      title="Remove Rule"
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
                {tr.noRules}
              </div>
            )}
          </div>

          <div className={`flex flex-wrap items-center gap-2 pt-4 border-t ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
            <button
              type="button"
              onClick={handleSetupCron}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-lg ${
                isDark ? 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/20' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              <Icons.Clock className="w-3.5 h-3.5" /> {language === 'vi' ? 'Lên lịch Cron' : 'Register Cron'}
            </button>
            <button
              type="button"
              onClick={handleDeleteCrons}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 font-bold border rounded-xl transition-all ${
                isDark ? 'bg-red-950/40 hover:bg-red-900/40 border-red-900/40 text-red-400' : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600'
              }`}
            >
              <Icons.Trash2 className="w-3.5 h-3.5" /> {tr.clearCrons}
            </button>
          </div>
        </div>
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
    </div>
  );
}
