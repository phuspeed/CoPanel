import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

type Tab = 'ssh' | 'root' | 'gate' | 'totp';

interface Settings {
  ssh_port: number;
  panel_port: number;
  nginx_gate: { enabled: boolean; username: string; configured: boolean };
  totp: { enabled: boolean; username: string };
  is_linux: boolean;
}

export default function PanelSettings() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const [tab, setTab] = useState<Tab>('ssh');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sshPort, setSshPort] = useState(22);
  const [sshConfirm, setSshConfirm] = useState(false);
  const [rootPass, setRootPass] = useState('');
  const [rootPass2, setRootPass2] = useState('');
  const [gateEnabled, setGateEnabled] = useState(false);
  const [gateUser, setGateUser] = useState('copanel');
  const [gatePass, setGatePass] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState('');
  const [disablePass, setDisablePass] = useState('');

  const t = {
    en: {
      title: 'Settings',
      desc: 'System and panel security configuration.',
      ssh: 'SSH Port',
      root: 'Root Password',
      gate: 'Panel access gate',
      totp: 'Two-factor (2FA)',
      sshPort: 'SSH port',
      sshHint: 'Changing SSH port may lock you out. Keep current session open and test before closing.',
      sshConfirm: 'I understand — apply port change',
      applySsh: 'Apply SSH port',
      rootHint: 'Changes Linux system root password (not panel admin).',
      newRootPass: 'New root password',
      confirmRootPass: 'Confirm password',
      applyRoot: 'Change root password',
      gateHint: 'Nginx HTTP Basic Auth on port 8686 (built-in, no Apache). Separate from panel login.',
      gateUser: 'Gate username',
      gatePass: 'Gate password',
      enableGate: 'Enable access gate',
      disableGate: 'Disable access gate',
      saveGate: 'Save gate settings',
      totpHint: 'Scan QR with Google Authenticator or Microsoft Authenticator.',
      setupTotp: 'Generate QR code',
      enableTotp: 'Enable 2FA',
      disableTotp: 'Disable 2FA',
      totpCode: '6-digit code',
      panelPass: 'Panel password',
      saved: 'Saved.',
      linuxOnly: 'Linux server only.',
    },
    vi: {
      title: 'Cài đặt',
      desc: 'Cấu hình bảo mật hệ thống và panel.',
      ssh: 'Cổng SSH',
      root: 'Mật khẩu Root',
      gate: 'Bảo vệ truy cập panel',
      totp: 'Xác thực 2 lớp (2FA)',
      sshPort: 'Cổng SSH',
      sshHint: 'Đổi cổng SSH có thể khóa SSH. Giữ phiên hiện tại; thử cổng mới trước khi đóng.',
      sshConfirm: 'Tôi hiểu — áp dụng đổi cổng',
      applySsh: 'Áp dụng cổng SSH',
      rootHint: 'Đổi mật khẩu root Linux (không phải admin panel).',
      newRootPass: 'Mật khẩu root mới',
      confirmRootPass: 'Xác nhận mật khẩu',
      applyRoot: 'Đổi mật khẩu root',
      gateHint: 'Nginx HTTP Basic Auth cổng 8686 (tích hợp sẵn, không cần Apache). Khác login panel.',
      gateUser: 'Tài khoản gate',
      gatePass: 'Mật khẩu gate',
      enableGate: 'Bật gate truy cập',
      disableGate: 'Tắt gate truy cập',
      saveGate: 'Lưu gate',
      totpHint: 'Quét QR bằng Google Authenticator hoặc Microsoft Authenticator.',
      setupTotp: 'Tạo mã QR',
      enableTotp: 'Bật 2FA',
      disableTotp: 'Tắt 2FA',
      totpCode: 'Mã 6 số',
      panelPass: 'Mật khẩu panel',
      saved: 'Đã lưu.',
      linuxOnly: 'Chỉ trên Linux.',
    },
  }[language];

  const load = useCallback(async () => {
    const data = await api<Settings>('/api/panel_settings/');
    setSettings(data);
    setSshPort(data.ssh_port);
    setGateEnabled(data.nginx_gate.enabled);
    setGateUser(data.nginx_gate.username || 'copanel');
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const card = `${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border rounded-xl p-5`;
  const input = `w-full px-3 py-2 rounded-lg border text-sm ${
    isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
  }`;
  const label = `block text-xs font-medium mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const tabBtn = (id: Tab) =>
    `px-3 py-2 rounded-lg text-sm font-medium ${
      tab === id
        ? 'bg-blue-600 text-white'
        : isDark
          ? 'text-slate-300 hover:bg-slate-800'
          : 'text-slate-600 hover:bg-slate-100'
    }`;

  const applySsh = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/ssh/port', {
        method: 'PUT',
        body: { port: sshPort, confirm: sshConfirm },
      });
      setMsg(t.saved);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const applyRoot = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/root-password', {
        method: 'POST',
        body: { new_password: rootPass, confirm_password: rootPass2 },
      });
      setRootPass('');
      setRootPass2('');
      setMsg(t.saved);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveGate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/nginx-gate', {
        method: 'PUT',
        body: {
          enabled: gateEnabled,
          username: gateUser,
          password: gatePass || undefined,
        },
      });
      setGatePass('');
      setMsg(t.saved);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setupTotp = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ qr_png_base64: string; secret: string }>('/api/panel_settings/totp/setup', {
        method: 'POST',
      });
      setTotpQr(data.qr_png_base64);
      setTotpSecret(data.secret);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const enableTotp = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/totp/enable', { method: 'POST', body: { code: totpCode } });
      setTotpCode('');
      setTotpQr(null);
      setMsg(t.saved);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disableTotp = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/totp/disable', {
        method: 'POST',
        body: { password: disablePass, code: totpCode },
      });
      setTotpCode('');
      setDisablePass('');
      setMsg(t.saved);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className={`p-6 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        <Icons.Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`p-4 md:p-6 space-y-6 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icons.Settings className="w-7 h-7 text-blue-500" />
          {t.title}
        </h1>
        <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.desc}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['ssh', 'root', 'gate', 'totp'] as Tab[]).map((id) => (
          <button key={id} type="button" className={tabBtn(id)} onClick={() => setTab(id)}>
            {t[id]}
          </button>
        ))}
      </div>

      {!settings.is_linux && (
        <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{t.linuxOnly}</p>
      )}

      {tab === 'ssh' && (
        <div className={card}>
          <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.sshHint}</p>
          <label className={label}>{t.sshPort}</label>
          <input className={input} type="number" value={sshPort} onChange={(e) => setSshPort(Number(e.target.value))} />
          <label className="flex items-center gap-2 mt-4 text-sm">
            <input type="checkbox" checked={sshConfirm} onChange={(e) => setSshConfirm(e.target.checked)} />
            {t.sshConfirm}
          </label>
          <button
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            disabled={busy || !settings.is_linux}
            onClick={applySsh}
          >
            {t.applySsh}
          </button>
        </div>
      )}

      {tab === 'root' && (
        <div className={card}>
          <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.rootHint}</p>
          <label className={label}>{t.newRootPass}</label>
          <input className={input} type="password" value={rootPass} onChange={(e) => setRootPass(e.target.value)} />
          <label className={`${label} mt-3`}>{t.confirmRootPass}</label>
          <input className={input} type="password" value={rootPass2} onChange={(e) => setRootPass2(e.target.value)} />
          <button
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            disabled={busy || !settings.is_linux}
            onClick={applyRoot}
          >
            {t.applyRoot}
          </button>
        </div>
      )}

      {tab === 'gate' && (
        <div className={card}>
          <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {t.gateHint} — port <strong>{settings.panel_port}</strong>
          </p>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={gateEnabled} onChange={(e) => setGateEnabled(e.target.checked)} />
            {gateEnabled ? t.enableGate : t.disableGate}
          </label>
          <label className={label}>{t.gateUser}</label>
          <input className={input} value={gateUser} onChange={(e) => setGateUser(e.target.value)} />
          <label className={`${label} mt-3`}>{t.gatePass}</label>
          <input className={input} type="password" value={gatePass} onChange={(e) => setGatePass(e.target.value)} />
          <button
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            disabled={busy || !settings.is_linux}
            onClick={saveGate}
          >
            {t.saveGate}
          </button>
        </div>
      )}

      {tab === 'totp' && (
        <div className={card}>
          <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.totpHint}</p>
          <p className="text-sm mb-2">
            User: <code>{settings.totp.username}</code> — 2FA:{' '}
            <strong>{settings.totp.enabled ? 'ON' : 'OFF'}</strong>
          </p>
          {!settings.totp.enabled && (
            <>
              <button
                className="px-4 py-2 rounded-lg bg-slate-600 text-white text-sm mb-4 disabled:opacity-50"
                disabled={busy}
                onClick={setupTotp}
              >
                {t.setupTotp}
              </button>
              {totpQr && (
                <img
                  src={`data:image/png;base64,${totpQr}`}
                  alt="2FA QR"
                  className="w-48 h-48 mb-3 border rounded-lg"
                />
              )}
              {totpSecret && (
                <p className="text-xs font-mono mb-3 break-all">{totpSecret}</p>
              )}
              <label className={label}>{t.totpCode}</label>
              <input className={input} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
              <button
                className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                disabled={busy}
                onClick={enableTotp}
              >
                {t.enableTotp}
              </button>
            </>
          )}
          {settings.totp.enabled && (
            <>
              <label className={label}>{t.panelPass}</label>
              <input className={input} type="password" value={disablePass} onChange={(e) => setDisablePass(e.target.value)} />
              <label className={`${label} mt-3`}>{t.totpCode}</label>
              <input className={input} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
              <button
                className="mt-4 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
                disabled={busy}
                onClick={disableTotp}
              >
                {t.disableTotp}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
