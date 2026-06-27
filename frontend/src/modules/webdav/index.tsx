import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

interface Config {
  bind_address: string;
  webdav_port: number;
  smb_port: number;
  share_path: string;
  share_name: string;
  webdav_enabled: boolean;
  smb_enabled: boolean;
  admin_username: string;
  local_ips: string[];
  is_linux: boolean;
  samba_installed: boolean;
  wsgidav_available: boolean;
  admin_password_file_present?: boolean;
  updated_at?: number;
}

interface ServiceInfo {
  enabled: boolean;
  running: boolean;
  url?: string;
  unc_path?: string;
  port: number;
  bind_address?: string;
  service?: { active?: boolean; state?: string; unit?: string };
  diagnostics?: {
    share_registered?: boolean;
    shares_registered?: string[];
    share_path?: string;
    path_entry_count?: number;
    testparm_ok?: boolean;
  };
}

interface Status {
  webdav: ServiceInfo;
  smb: ServiceInfo;
  share_path: string;
  share_name: string;
  admin_username: string;
  connection_hint: string;
}

export default function WebdavDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bindAddress, setBindAddress] = useState('0.0.0.0');
  const [webdavPort, setWebdavPort] = useState(8085);
  const [smbPort, setSmbPort] = useState(445);
  const [sharePath, setSharePath] = useState('/');
  const [shareName, setShareName] = useState('copanel');
  const [webdavEnabled, setWebdavEnabled] = useState(false);
  const [smbEnabled, setSmbEnabled] = useState(false);
  const [smbPassword, setSmbPassword] = useState('');

  const t = {
    en: {
      title: 'WebDAV & SMB',
      desc: 'Share files over WebDAV and SMB. Login with the same username/password as the panel root (superadmin) account.',
      settings: 'Settings',
      status: 'Status',
      bindAddress: 'Bind address',
      webdavPort: 'WebDAV port',
      smbPort: 'SMB port',
      sharePath: 'Share folder',
      shareName: 'Share name',
      enableWebdav: 'Enable WebDAV',
      enableSmb: 'Enable SMB',
      save: 'Save & apply',
      saving: 'Saving...',
      webdavUrl: 'WebDAV URL',
      smbPath: 'SMB path (Windows)',
      loginUser: 'Login user',
      loginHint: 'Password = same as panel root user password',
      running: 'Running',
      stopped: 'Stopped',
      enabled: 'Enabled',
      disabled: 'Disabled',
      start: 'Start',
      stop: 'Stop',
      restart: 'Restart',
      applySmb: 'Apply SMB config',
      syncPassword: 'Sync SMB password',
      serverIps: 'Server IPs',
      deps: 'Dependencies',
      sambaOk: 'Samba installed',
      sambaMissing: 'Samba not installed (apt install samba)',
      wsgidavOk: 'wsgidav ready',
      wsgidavMissing: 'wsgidav missing (pip install wsgidav)',
      linuxOnly: 'SMB requires Linux production host',
      saved: 'Configuration saved.',
      copy: 'Copy',
      smbPassword: 'Panel password (for SMB sync)',
      smbPasswordHint: 'Required once if the server has no stored admin password file. Must match your CoPanel login password.',
      smbPasswordRequired: 'Enter your panel superadmin password to enable or sync SMB.',
      smbWindowsHint: 'Windows: open Explorer → right-click This PC → Map network drive → Folder: \\\\IP\\copanel → check Connect using different credentials → user admin + panel password.',
      smbShares: 'Samba shares on server',
      smbNotRegistered: 'Share "copanel" not loaded — click Apply SMB config again.',
      smbPathEmpty: 'Share folder has few/no items — change Share folder (e.g. / or /var/www).',
    },
    vi: {
      title: 'WebDAV & SMB',
      desc: 'Chia sẻ file qua WebDAV và SMB. Đăng nhập bằng cùng tài khoản root (superadmin) của panel.',
      settings: 'Cấu hình',
      status: 'Trạng thái',
      bindAddress: 'Địa chỉ lắng nghe',
      webdavPort: 'Cổng WebDAV',
      smbPort: 'Cổng SMB',
      sharePath: 'Thư mục chia sẻ',
      shareName: 'Tên share',
      enableWebdav: 'Bật WebDAV',
      enableSmb: 'Bật SMB',
      save: 'Lưu & áp dụng',
      saving: 'Đang lưu...',
      webdavUrl: 'URL WebDAV',
      smbPath: 'Đường dẫn SMB (Windows)',
      loginUser: 'Tài khoản đăng nhập',
      loginHint: 'Mật khẩu = mật khẩu user root của panel',
      running: 'Đang chạy',
      stopped: 'Đã dừng',
      enabled: 'Đã bật',
      disabled: 'Đã tắt',
      start: 'Khởi động',
      stop: 'Dừng',
      restart: 'Khởi động lại',
      applySmb: 'Áp dụng cấu hình SMB',
      syncPassword: 'Đồng bộ mật khẩu SMB',
      serverIps: 'IP máy chủ',
      deps: 'Phụ thuộc',
      sambaOk: 'Đã cài Samba',
      sambaMissing: 'Chưa cài Samba (apt install samba)',
      wsgidavOk: 'wsgidav sẵn sàng',
      wsgidavMissing: 'Thiếu wsgidav (pip install wsgidav)',
      linuxOnly: 'SMB cần máy chủ Linux production',
      saved: 'Đã lưu cấu hình.',
      copy: 'Sao chép',
      smbPassword: 'Mật khẩu panel (đồng bộ SMB)',
      smbPasswordHint: 'Nhập một lần nếu server chưa có file mật khẩu admin. Phải trùng mật khẩu đăng nhập CoPanel.',
      smbPasswordRequired: 'Nhập mật khẩu superadmin panel để bật hoặc đồng bộ SMB.',
      smbWindowsHint: 'Windows: Explorer → Chuột phải This PC → Map network drive → \\\\IP\\copanel → chọn Connect using different credentials → user admin + mật khẩu panel.',
      smbShares: 'Share Samba trên server',
      smbNotRegistered: 'Share "copanel" chưa load — bấm Áp dụng cấu hình SMB lại.',
      smbPathEmpty: 'Thư mục share gần như trống — đổi Share folder (vd. / hoặc /var/www).',
    },
  }[language];

  const load = useCallback(async () => {
    const [cfg, st] = await Promise.all([
      api<Config>('/api/webdav/config'),
      api<Status>('/api/webdav/status'),
    ]);
    setConfig(cfg);
    setStatus(st);
    setBindAddress(cfg.bind_address);
    setWebdavPort(cfg.webdav_port);
    setSmbPort(cfg.smb_port);
    setSharePath(cfg.share_path);
    setShareName(cfg.share_name);
    setWebdavEnabled(cfg.webdav_enabled);
    setSmbEnabled(cfg.smb_enabled);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message || 'Failed to load'));
  }, [load]);

  const save = async () => {
    if (smbEnabled && !config?.admin_password_file_present && !smbPassword.trim()) {
      setError(t.smbPasswordRequired);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        bind_address: bindAddress,
        webdav_port: webdavPort,
        smb_port: smbPort,
        share_path: sharePath,
        share_name: shareName,
        webdav_enabled: webdavEnabled,
        smb_enabled: smbEnabled,
      };
      if (smbPassword.trim()) {
        body.smb_password = smbPassword;
      }
      await api('/api/webdav/config', { method: 'PUT', body });
      setMsg(t.saved);
      setSmbPassword('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const webdavAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/webdav/webdav/${action}`, { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const smbAction = async (action: 'start' | 'stop' | 'restart' | 'apply') => {
    if (action === 'apply' && !config?.admin_password_file_present && !smbPassword.trim()) {
      setError(t.smbPasswordRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = smbPassword.trim() ? { password: smbPassword } : {};
      await api(`/api/webdav/smb/${action}`, { method: 'POST', body });
      if (smbPassword.trim()) setSmbPassword('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const syncPassword = async () => {
    if (!config?.admin_password_file_present && !smbPassword.trim()) {
      setError(t.smbPasswordRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = smbPassword.trim() ? { password: smbPassword } : {};
      await api('/api/webdav/smb/sync-password', { method: 'POST', body });
      setSmbPassword('');
      setMsg(language === 'vi' ? 'Đã đồng bộ mật khẩu SMB.' : 'SMB password synced.');
    } catch (e: any) {
      setError(e.message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setMsg(language === 'vi' ? 'Đã sao chép.' : 'Copied.');
  };

  const card = `${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border rounded-xl p-5`;
  const input = `w-full px-3 py-2 rounded-lg border text-sm ${
    isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
  }`;
  const label = `block text-xs font-medium mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const btn = (primary = false) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${
      primary
        ? 'bg-blue-600 text-white hover:bg-blue-700'
        : isDark
          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`;

  const statusPill = (on: boolean) =>
    `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      on
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
    }`;

  if (!config || !status) {
    return (
      <div className={`p-6 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        <Icons.Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const sampleIp = config.local_ips[0] || 'YOUR_SERVER_IP';
  const webdavUrl = `http://${sampleIp}:${webdavPort}/${shareName}/`;
  const smbPath = `\\\\${sampleIp}\\${shareName}`;

  return (
    <div className={`p-4 md:p-6 space-y-6 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icons.FolderSync className="w-7 h-7 text-blue-500" />
          {t.title}
        </h1>
        <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.desc}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {msg}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className={card}>
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Icons.Settings className="w-4 h-4" />
            {t.settings}
          </h2>
          <div className="space-y-3">
            <div>
              <label className={label}>{t.bindAddress}</label>
              <input className={input} value={bindAddress} onChange={(e) => setBindAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>{t.webdavPort}</label>
                <input
                  className={input}
                  type="number"
                  value={webdavPort}
                  onChange={(e) => setWebdavPort(Number(e.target.value))}
                />
              </div>
              <div>
                <label className={label}>{t.smbPort}</label>
                <input
                  className={input}
                  type="number"
                  value={smbPort}
                  onChange={(e) => setSmbPort(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className={label}>{t.sharePath}</label>
              <input className={input} value={sharePath} onChange={(e) => setSharePath(e.target.value)} />
            </div>
            <div>
              <label className={label}>{t.shareName}</label>
              <input className={input} value={shareName} onChange={(e) => setShareName(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={webdavEnabled} onChange={(e) => setWebdavEnabled(e.target.checked)} />
              {t.enableWebdav}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={smbEnabled} onChange={(e) => setSmbEnabled(e.target.checked)} />
              {t.enableSmb}
            </label>
            {(smbEnabled || !config.admin_password_file_present) && (
              <div>
                <label className={label}>{t.smbPassword}</label>
                <input
                  className={input}
                  type="password"
                  value={smbPassword}
                  onChange={(e) => setSmbPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder={config.admin_username}
                />
                <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.smbPasswordHint}</p>
              </div>
            )}
            <button className={btn(true)} disabled={busy} onClick={save}>
              {busy ? t.saving : t.save}
            </button>
          </div>
        </div>

        <div className={card}>
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Icons.Activity className="w-4 h-4" />
            {t.status}
          </h2>
          <div className="space-y-4 text-sm">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">WebDAV</span>
                <span className={statusPill(status.webdav.running)}>{status.webdav.running ? t.running : t.stopped}</span>
              </div>
              <div className={`text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {status.webdav.enabled ? t.enabled : t.disabled}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn()} disabled={busy} onClick={() => webdavAction('start')}>{t.start}</button>
                <button className={btn()} disabled={busy} onClick={() => webdavAction('stop')}>{t.stop}</button>
                <button className={btn()} disabled={busy} onClick={() => webdavAction('restart')}>{t.restart}</button>
              </div>
            </div>

            <div className="border-t pt-4 border-slate-700/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">SMB</span>
                <span className={statusPill(!!status.smb.running)}>{status.smb.running ? t.running : t.stopped}</span>
              </div>
              <div className={`text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {status.smb.enabled ? t.enabled : t.disabled}
                {!config.is_linux && ` — ${t.linuxOnly}`}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn()} disabled={busy} onClick={() => smbAction('apply')}>{t.applySmb}</button>
                <button className={btn()} disabled={busy} onClick={() => smbAction('restart')}>{t.restart}</button>
                <button className={btn()} disabled={busy} onClick={syncPassword}>{t.syncPassword}</button>
              </div>
              {status.smb.diagnostics && (
                <div className={`mt-3 text-xs space-y-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <p>{t.smbShares}: {(status.smb.diagnostics.shares_registered || []).join(', ') || '—'}</p>
                  {!status.smb.diagnostics.share_registered && status.smb.enabled && (
                    <p className="text-amber-600 dark:text-amber-400">{t.smbNotRegistered}</p>
                  )}
                  {status.smb.diagnostics.path_entry_count !== undefined && status.smb.diagnostics.path_entry_count <= 1 && (
                    <p className="text-amber-600 dark:text-amber-400">
                      {t.smbPathEmpty} ({status.smb.diagnostics.share_path}, {status.smb.diagnostics.path_entry_count} items)
                    </p>
                  )}
                  <p>{t.smbWindowsHint}</p>
                </div>
              )}
            </div>

            <div className="border-t pt-4 border-slate-700/30 space-y-2">
              <div>
                <span className={label}>{t.loginUser}</span>
                <code className="text-sm font-mono">{status.admin_username}</code>
              </div>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.loginHint}</p>
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <h2 className="font-semibold mb-3">{t.serverIps}</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {config.local_ips.map((ip) => (
            <span key={ip} className="px-2 py-1 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300 text-sm font-mono">
              {ip}
            </span>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className={label}>{t.webdavUrl}</span>
            <div className="flex gap-2 items-center">
              <code className="flex-1 text-xs font-mono break-all p-2 rounded bg-slate-500/10">{webdavUrl}</code>
              <button className={btn()} onClick={() => copyText(webdavUrl)}>{t.copy}</button>
            </div>
          </div>
          <div>
            <span className={label}>{t.smbPath}</span>
            <div className="flex gap-2 items-center">
              <code className="flex-1 text-xs font-mono break-all p-2 rounded bg-slate-500/10">{smbPath}</code>
              <button className={btn()} onClick={() => copyText(smbPath)}>{t.copy}</button>
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <h2 className="font-semibold mb-3">{t.deps}</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            {config.wsgidav_available ? (
              <Icons.CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <Icons.AlertCircle className="w-4 h-4 text-amber-500" />
            )}
            {config.wsgidav_available ? t.wsgidavOk : t.wsgidavMissing}
          </li>
          <li className="flex items-center gap-2">
            {config.samba_installed ? (
              <Icons.CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <Icons.AlertCircle className="w-4 h-4 text-amber-500" />
            )}
            {config.samba_installed ? t.sambaOk : t.sambaMissing}
          </li>
        </ul>
      </div>
    </div>
  );
}
