import { useCallback, useEffect, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import SettingsSidebar, { type SettingsTab } from './components/SettingsSidebar';
import UsersPanel from './components/UsersPanel';
import DateTimePanel from './components/DateTimePanel';
import WallpaperGallery from './components/WallpaperGallery';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';
import {
  MAX_WALLPAPERS,
  newWallpaperId,
  normalizeBranding,
  notifyBrandingUpdated,
  readImageFileAsDataUrl,
  type WallpaperItem,
} from '../../core/brandingTypes';

type Tab = SettingsTab;

interface BrandingSettings {
  site_title: string;
  site_subtitle: string;
  favicon_data_url: string | null;
  logo_data_url: string | null;
  wallpapers: WallpaperItem[];
  selected_wallpaper_id: string | null;
}

interface Settings {
  ssh_port: number;
  panel_port: number;
  nginx_gate: { enabled: boolean; username: string; configured: boolean; needs_repair?: boolean };
  totp: { enabled: boolean; username: string };
  branding: BrandingSettings;
  is_linux: boolean;
}

interface NetworkIface {
  name: string;
  netplan_key?: string | null;
  mac: string | null;
  state: string;
  ipv4: string[];
  ipv4_prefix: (number | null)[];
  ipv6: string[];
  gateway: string | null;
  dns: string[];
  method: string;
  connection: string | null;
  mtu: number | null;
  speed_mbps: number | null;
  backend: string;
}

interface NetworkPayload {
  summary: {
    hostname: string;
    lan_ip: string | null;
    primary_interface: string | null;
    gateway: string | null;
    dns: string[];
  };
  interfaces: NetworkIface[];
  nmcli_available: boolean;
  netplan_available: boolean;
}

export default function PanelSettings() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';

  const [tab, setTab] = useState<Tab>('datetime');
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
  const [siteTitle, setSiteTitle] = useState('CoPanel');
  const [siteSubtitle, setSiteSubtitle] = useState('Lightweight VPS Management');
  const [faviconDataUrl, setFaviconDataUrl] = useState<string | null>(null);
  const [faviconName, setFaviconName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoName, setLogoName] = useState('');
  const [wallpapers, setWallpapers] = useState<WallpaperItem[]>([]);
  const [selectedWallpaperId, setSelectedWallpaperId] = useState<string | null>(null);
  const [wallpaperUploading, setWallpaperUploading] = useState(false);

  const [network, setNetwork] = useState<NetworkPayload | null>(null);
  const [netLoading, setNetLoading] = useState(false);
  const [editIface, setEditIface] = useState<string | null>(null);
  const [netMethod, setNetMethod] = useState<'dhcp' | 'static'>('dhcp');
  const [netAddress, setNetAddress] = useState('');
  const [netPrefix, setNetPrefix] = useState(24);
  const [netGateway, setNetGateway] = useState('');
  const [netDns, setNetDns] = useState('');
  const [netConfirm, setNetConfirm] = useState(false);

  const t = {
    en: {
      title: 'Settings',
      desc: 'System time, users, security, network, and branding.',
      datetime: 'Date & time',
      users: 'Users',
      ssh: 'SSH Port',
      root: 'Root Password',
      gate: 'Panel access gate',
      totp: 'Two-factor (2FA)',
      branding: 'Branding',
      sshPort: 'SSH port',
      sshHint: 'Changing SSH port may lock you out. Keep current session open and test before closing.',
      sshConfirm: 'I understand — apply port change',
      applySsh: 'Apply SSH port',
      rootHint: 'Changes Linux system root password (not panel admin).',
      newRootPass: 'New root password',
      confirmRootPass: 'Confirm password',
      applyRoot: 'Change root password',
      gateHint: 'HTTP password for the web UI only (location /). API uses JWT — no repeated browser prompts.',
      gateUser: 'Gate username',
      gatePass: 'Gate password',
      enableGate: 'Enable access gate',
      disableGate: 'Disable access gate',
      saveGate: 'Save gate settings',
      gateRepair: 'Gate already enabled? Save again with empty password to fix API prompt loop.',
      repairNginx: 'Repair nginx layout',
      repairHint: 'Auth is at server level — /api/ gets 401. Auto-fix runs on copanel restart after git pull, or click Repair.',
      totpHint: 'Scan QR with Google Authenticator or Microsoft Authenticator.',
      setupTotp: 'Generate QR code',
      enableTotp: 'Enable 2FA',
      disableTotp: 'Disable 2FA',
      totpCode: '6-digit code',
      panelPass: 'Panel password',
      saved: 'Saved.',
      linuxOnly: 'Linux server only.',
      network: 'Network',
      networkDesc: 'LAN IP, interfaces, gateway, and static/DHCP configuration.',
      lanIp: 'LAN IP',
      hostname: 'Hostname',
      gateway: 'Gateway',
      dns: 'DNS',
      ifaceCards: 'Network interfaces',
      mac: 'MAC',
      state: 'State',
      method: 'Mode',
      ipv4: 'IPv4',
      ipv6: 'IPv6',
      mtu: 'MTU',
      speed: 'Speed',
      up: 'Up',
      down: 'Down',
      dhcp: 'DHCP',
      static: 'Static',
      unknown: 'Unknown',
      configure: 'Configure',
      cancelEdit: 'Cancel',
      netHint: 'Wrong IP or gateway can disconnect SSH. Keep this session open and test before closing.',
      netConfirm: 'I understand — apply network change',
      applyNet: 'Apply network settings',
      address: 'IPv4 address',
      prefix: 'Prefix (CIDR)',
      refreshNet: 'Refresh',
      noIfaces: 'No physical interfaces detected.',
      backend: 'Backend',
      primaryIface: 'Primary interface',
      netplanRename: 'Netplan file uses «{old}» — will write as «{name}» on apply',
      brandingDesc: 'Customize browser tab title, favicon, logo, and desktop wallpaper.',
      siteTitle: 'Site title',
      siteTitleHint: 'Shown in browser tab, login page, and sidebar header.',
      siteSubtitle: 'Site subtitle',
      siteSubtitleHint: 'Shown below title in login page and sidebar header.',
      favicon: 'Favicon',
      faviconHint: 'Recommended: square PNG, SVG, or ICO. Max 256 KB.',
      faviconCurrent: 'Current favicon preview',
      faviconUpload: 'Choose favicon',
      faviconRemove: 'Remove favicon',
      logo: 'Logo',
      logoHint: 'Shown in login page and sidebar. Recommended: square PNG or SVG. Max 1 MB.',
      logoCurrent: 'Current logo preview',
      logoUpload: 'Choose logo',
      logoRemove: 'Remove logo',
      saveBranding: 'Save branding',
    },
    vi: {
      title: 'Cài đặt',
      desc: 'Giờ hệ thống, người dùng, bảo mật, mạng và nhận diện.',
      datetime: 'Ngày & giờ',
      users: 'Người dùng',
      ssh: 'Cổng SSH',
      root: 'Mật khẩu Root',
      gate: 'Bảo vệ truy cập panel',
      totp: 'Xác thực 2 lớp (2FA)',
      branding: 'Nhận diện',
      sshPort: 'Cổng SSH',
      sshHint: 'Đổi cổng SSH có thể khóa SSH. Giữ phiên hiện tại; thử cổng mới trước khi đóng.',
      sshConfirm: 'Tôi hiểu — áp dụng đổi cổng',
      applySsh: 'Áp dụng cổng SSH',
      rootHint: 'Đổi mật khẩu root Linux (không phải admin panel).',
      newRootPass: 'Mật khẩu root mới',
      confirmRootPass: 'Xác nhận mật khẩu',
      applyRoot: 'Đổi mật khẩu root',
      gateHint: 'Mật khẩu HTTP chỉ cho giao diện web (location /). API dùng JWT — không hỏi passwd liên tục.',
      gateUser: 'Tài khoản gate',
      gatePass: 'Mật khẩu gate',
      enableGate: 'Bật gate truy cập',
      disableGate: 'Tắt gate truy cập',
      saveGate: 'Lưu gate',
      gateRepair: 'Gate đang bật? Lưu lại (để trống mật khẩu) để sửa lỗi hỏi passwd liên tục trên API.',
      repairNginx: 'Sửa cấu hình nginx',
      repairHint: 'Auth ở cấp server — /api/ bị 401. Tự sửa khi restart copanel sau git pull, hoặc bấm Sửa.',
      totpHint: 'Quét QR bằng Google Authenticator hoặc Microsoft Authenticator.',
      setupTotp: 'Tạo mã QR',
      enableTotp: 'Bật 2FA',
      disableTotp: 'Tắt 2FA',
      totpCode: 'Mã 6 số',
      panelPass: 'Mật khẩu panel',
      saved: 'Đã lưu.',
      linuxOnly: 'Chỉ trên Linux.',
      network: 'Mạng',
      networkDesc: 'IP LAN, card mạng, gateway và cấu hình DHCP/tĩnh.',
      lanIp: 'IP LAN',
      hostname: 'Hostname',
      gateway: 'Gateway',
      dns: 'DNS',
      ifaceCards: 'Card mạng',
      mac: 'MAC',
      state: 'Trạng thái',
      method: 'Chế độ',
      ipv4: 'IPv4',
      ipv6: 'IPv6',
      mtu: 'MTU',
      speed: 'Tốc độ',
      up: 'Bật',
      down: 'Tắt',
      dhcp: 'DHCP',
      static: 'Tĩnh',
      unknown: 'Không rõ',
      configure: 'Cấu hình',
      cancelEdit: 'Hủy',
      netHint: 'Sai IP/gateway có thể mất SSH. Giữ phiên hiện tại; thử kết nối mới trước khi đóng.',
      netConfirm: 'Tôi hiểu — áp dụng đổi mạng',
      applyNet: 'Áp dụng cấu hình mạng',
      address: 'Địa chỉ IPv4',
      prefix: 'Prefix (CIDR)',
      refreshNet: 'Làm mới',
      noIfaces: 'Không phát hiện card mạng vật lý.',
      backend: 'Backend',
      primaryIface: 'Card mạng chính',
      netplanRename: 'Netplan đang dùng «{old}» — khi áp dụng sẽ ghi thành «{name}»',
      brandingDesc: 'Tùy chỉnh tiêu đề tab, favicon, logo và hình nền desktop.',
      siteTitle: 'Tiêu đề site',
      siteTitleHint: 'Hiện ở tab trình duyệt, trang đăng nhập và tiêu đề sidebar.',
      siteSubtitle: 'Dòng phụ',
      siteSubtitleHint: 'Hiện dưới tiêu đề ở trang đăng nhập và đầu sidebar.',
      favicon: 'Favicon',
      faviconHint: 'Khuyên dùng: PNG vuông, SVG hoặc ICO. Tối đa 256 KB.',
      faviconCurrent: 'Xem trước favicon hiện tại',
      faviconUpload: 'Chọn favicon',
      faviconRemove: 'Xóa favicon',
      logo: 'Logo',
      logoHint: 'Hiện ở trang đăng nhập và sidebar. Khuyên dùng: PNG vuông hoặc SVG. Tối đa 1 MB.',
      logoCurrent: 'Xem trước logo hiện tại',
      logoUpload: 'Chọn logo',
      logoRemove: 'Xóa logo',
      saveBranding: 'Lưu nhận diện',
    },
  }[language];

  const load = useCallback(async () => {
    const data = await api<Settings>('/api/panel_settings/');
    setSettings(data);
    setSshPort(data.ssh_port);
    setGateEnabled(data.nginx_gate.enabled);
    setGateUser(data.nginx_gate.username || 'copanel');
    setSiteTitle(data.branding?.site_title || 'CoPanel');
    setSiteSubtitle(data.branding?.site_subtitle || 'Lightweight VPS Management');
    setFaviconDataUrl(data.branding?.favicon_data_url || null);
    setLogoDataUrl(data.branding?.logo_data_url || null);
    const normalized = normalizeBranding(data.branding);
    setWallpapers(normalized.wallpapers);
    setSelectedWallpaperId(normalized.selected_wallpaper_id);
    setFaviconName('');
    setLogoName('');
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const loadNetwork = useCallback(async () => {
    setNetLoading(true);
    try {
      const data = await api<NetworkPayload>('/api/panel_settings/network');
      setNetwork(data);
    } finally {
      setNetLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'network') {
      loadNetwork().catch((e) => setError(e.message));
    }
  }, [tab, loadNetwork]);

  const openNetEdit = (iface: NetworkIface) => {
    setEditIface(iface.name);
    setNetMethod(iface.method === 'dhcp' ? 'dhcp' : 'static');
    setNetAddress(iface.ipv4[0] || '');
    setNetPrefix(iface.ipv4_prefix[0] || 24);
    setNetGateway(iface.gateway || '');
    setNetDns((iface.dns || []).join(', '));
    setNetConfirm(false);
  };

  const applyNetwork = async () => {
    if (!editIface) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/panel_settings/network/${encodeURIComponent(editIface)}`, {
        method: 'PUT',
        body: {
          method: netMethod,
          address: netMethod === 'static' ? netAddress : undefined,
          prefix: netMethod === 'static' ? netPrefix : undefined,
          gateway: netMethod === 'static' ? netGateway || undefined : undefined,
          dns: netMethod === 'static' && netDns.trim()
            ? netDns.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
            : undefined,
          confirm: netConfirm,
        },
      });
      setMsg(t.saved);
      setEditIface(null);
      await loadNetwork();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onPickFavicon = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Favicon must be an image file.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read favicon file.'));
      reader.readAsDataURL(file);
    });
    setFaviconDataUrl(dataUrl);
    setFaviconName(file.name);
    setError(null);
  };

  const onPickLogo = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Logo must be an image file.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read logo file.'));
      reader.readAsDataURL(file);
    });
    setLogoDataUrl(dataUrl);
    setLogoName(file.name);
    setError(null);
  };

  const WALLPAPER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024;

  const onUploadWallpapers = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = MAX_WALLPAPERS - wallpapers.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_WALLPAPERS} wallpapers allowed.`);
      return;
    }

    setWallpaperUploading(true);
    setError(null);
    const added: WallpaperItem[] = [];
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        if (!WALLPAPER_MIME.has(file.type)) {
          setError('Wallpaper must be PNG, JPEG, GIF, or WebP.');
          continue;
        }
        if (file.size > MAX_WALLPAPER_BYTES) {
          setError('Each wallpaper must be 2 MB or smaller.');
          continue;
        }
        const data_url = await readImageFileAsDataUrl(file);
        added.push({ id: newWallpaperId(), label: file.name, data_url });
      }
      if (added.length) {
        setWallpapers((prev) => [...prev, ...added]);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to read wallpaper image.');
    } finally {
      setWallpaperUploading(false);
    }
  };

  const onRemoveWallpaper = (id: string) => {
    setWallpapers((prev) => prev.filter((w) => w.id !== id));
    setSelectedWallpaperId((prev) => (prev === id ? null : prev));
  };

  const card = `${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border rounded-xl p-5`;
  const input = `w-full px-3 py-2 rounded-lg border text-sm ${
    isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
  }`;
  const label = `block text-xs font-medium mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;

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

  const repairGate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/panel_settings/nginx-gate/repair', { method: 'POST' });
      setMsg(t.saved);
      await load();
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

  const saveBranding = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<BrandingSettings>('/api/panel_settings/branding', {
        method: 'PUT',
        body: {
          site_title: siteTitle,
          site_subtitle: siteSubtitle,
          favicon_data_url: faviconDataUrl,
          logo_data_url: logoDataUrl,
          wallpapers,
          selected_wallpaper_id: selectedWallpaperId,
        },
      });
      const normalized = normalizeBranding(data);
      setSiteTitle(normalized.site_title);
      setSiteSubtitle(normalized.site_subtitle);
      setFaviconDataUrl(normalized.favicon_data_url);
      setLogoDataUrl(normalized.logo_data_url);
      setWallpapers(normalized.wallpapers);
      setSelectedWallpaperId(normalized.selected_wallpaper_id);
      notifyBrandingUpdated(normalized);
      setFaviconName('');
      setLogoName('');
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
    <ModuleViewport className="flex min-h-0 flex-col">
      <ModuleSidebarLayout
        isDark={isDark}
        mobileTitle={t.title}
        className={isDark ? 'text-slate-100' : 'text-slate-900'}
        sidebar={
          <SettingsSidebar
            tab={tab}
            onTab={setTab}
            isDark={isDark}
            labels={{
              datetime: t.datetime,
              users: t.users,
              ssh: t.ssh,
              root: t.root,
              gate: t.gate,
              totp: t.totp,
              network: t.network,
              branding: t.branding,
            }}
            title={t.title}
            subtitle={t.desc}
          />
        }
      >
        <main className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
          {error && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
          {msg && (
            <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300">
              {msg}
            </div>
          )}

          {!settings.is_linux && tab !== 'users' && tab !== 'branding' && (
            <p className={`mb-4 text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{t.linuxOnly}</p>
          )}

      {tab === 'datetime' && (
        <DateTimePanel
          isDark={isDark}
          language={language}
          isLinux={settings.is_linux}
          card={card}
          input={input}
          label={label}
          onError={setError}
          onSaved={setMsg}
        />
      )}

      {tab === 'users' && (
        <UsersPanel
          isDark={isDark}
          language={language}
          card={card}
          input={input}
          label={label}
        />
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
          <p className={`text-xs mb-3 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.gateRepair}</p>
          {settings.nginx_gate.needs_repair && (
            <div className={`mb-3 p-3 rounded-lg border text-sm ${isDark ? 'bg-amber-950/30 border-amber-900 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              <p className="mb-2">{t.repairHint}</p>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium disabled:opacity-50"
                disabled={busy}
                onClick={repairGate}
              >
                {t.repairNginx}
              </button>
            </div>
          )}
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

      {tab === 'network' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.networkDesc}</p>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg text-sm border ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}
              disabled={netLoading}
              onClick={() => loadNetwork().catch((e) => setError(e.message))}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icons.RefreshCw className={`w-3.5 h-3.5 ${netLoading ? 'animate-spin' : ''}`} />
                {t.refreshNet}
              </span>
            </button>
          </div>

          {network?.summary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              {[
                { icon: Icons.Wifi, label: t.lanIp, value: network.summary.lan_ip || '—' },
                { icon: Icons.Network, label: t.primaryIface, value: network.summary.primary_interface || '—' },
                { icon: Icons.Server, label: t.hostname, value: network.summary.hostname || '—' },
                { icon: Icons.Router, label: t.gateway, value: network.summary.gateway || '—' },
                { icon: Icons.Globe, label: t.dns, value: network.summary.dns?.join(', ') || '—' },
              ].map((item) => (
                <div key={item.label} className={card}>
                  <div className="flex items-center gap-2 mb-2">
                    <item.icon className="w-4 h-4 text-blue-500" />
                    <span className={`text-xs font-medium uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {item.label}
                    </span>
                  </div>
                  <p className="font-mono text-sm break-all">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold mb-3">{t.ifaceCards}</h2>
            {netLoading && !network && (
              <Icons.Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            )}
            {network && network.interfaces.length === 0 && (
              <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.noIfaces}</p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {network?.interfaces.map((iface) => (
                <div key={iface.name} className={card}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        <Icons.Network className="w-4 h-4 text-emerald-500" />
                        {iface.name}
                      </h3>
                      <p className={`text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                        {iface.connection || iface.backend}
                        {iface.netplan_key && iface.netplan_key !== iface.name && (
                          <span className="block text-amber-500 mt-0.5">
                            {t.netplanRename.replace('{old}', iface.netplan_key).replace('{name}', iface.name)}
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        iface.state === 'up'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-slate-500/15 text-slate-400'
                      }`}
                    >
                      {iface.state === 'up' ? t.up : t.down}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <dt className={label}>{t.mac}</dt>
                      <dd className="font-mono text-xs">{iface.mac || '—'}</dd>
                    </div>
                    <div>
                      <dt className={label}>{t.method}</dt>
                      <dd>
                        {iface.method === 'dhcp' ? t.dhcp : iface.method === 'static' ? t.static : t.unknown}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className={label}>{t.ipv4}</dt>
                      <dd className="font-mono text-xs">
                        {iface.ipv4.length
                          ? iface.ipv4.map((ip, i) => (
                              <span key={ip}>
                                {ip}
                                {iface.ipv4_prefix[i] ? `/${iface.ipv4_prefix[i]}` : ''}
                                {i < iface.ipv4.length - 1 ? ', ' : ''}
                              </span>
                            ))
                          : '—'}
                      </dd>
                    </div>
                    {iface.ipv6.length > 0 && (
                      <div className="col-span-2">
                        <dt className={label}>{t.ipv6}</dt>
                        <dd className="font-mono text-xs break-all">{iface.ipv6.join(', ')}</dd>
                      </div>
                    )}
                    <div>
                      <dt className={label}>{t.mtu}</dt>
                      <dd>{iface.mtu ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className={label}>{t.speed}</dt>
                      <dd>{iface.speed_mbps ? `${iface.speed_mbps} Mbps` : '—'}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="mt-4 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
                    disabled={busy || !settings.is_linux}
                    onClick={() => openNetEdit(iface)}
                  >
                    {t.configure}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {editIface && (
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">
                  {t.configure}: <code>{editIface}</code>
                </h3>
                <button
                  type="button"
                  className={`text-xs ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
                  onClick={() => setEditIface(null)}
                >
                  {t.cancelEdit}
                </button>
              </div>
              <p className={`text-sm mb-4 ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{t.netHint}</p>
              <div className="flex flex-wrap gap-3 mb-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={netMethod === 'dhcp'}
                    onChange={() => setNetMethod('dhcp')}
                  />
                  {t.dhcp}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={netMethod === 'static'}
                    onChange={() => setNetMethod('static')}
                  />
                  {t.static}
                </label>
              </div>
              {netMethod === 'static' && (
                <>
                  <label className={label}>{t.address}</label>
                  <input className={input} value={netAddress} onChange={(e) => setNetAddress(e.target.value)} placeholder="192.168.1.100" />
                  <label className={`${label} mt-3`}>{t.prefix}</label>
                  <input className={input} type="number" min={1} max={32} value={netPrefix} onChange={(e) => setNetPrefix(Number(e.target.value))} />
                  <label className={`${label} mt-3`}>{t.gateway}</label>
                  <input className={input} value={netGateway} onChange={(e) => setNetGateway(e.target.value)} placeholder="192.168.1.1" />
                  <label className={`${label} mt-3`}>{t.dns}</label>
                  <input className={input} value={netDns} onChange={(e) => setNetDns(e.target.value)} placeholder="8.8.8.8, 1.1.1.1" />
                </>
              )}
              <label className="flex items-center gap-2 mt-4 text-sm">
                <input type="checkbox" checked={netConfirm} onChange={(e) => setNetConfirm(e.target.checked)} />
                {t.netConfirm}
              </label>
              <button
                className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                disabled={busy || !settings.is_linux || !netConfirm}
                onClick={applyNetwork}
              >
                {t.applyNet}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'branding' && (
        <div className={card}>
          <p className={`text-sm mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.brandingDesc}</p>

          <label className={label}>{t.siteTitle}</label>
          <input
            className={input}
            value={siteTitle}
            maxLength={80}
            onChange={(e) => setSiteTitle(e.target.value)}
            placeholder="CoPanel"
          />
          <p className={`mt-1 text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.siteTitleHint}</p>

          <label className={`${label} mt-4`}>{t.siteSubtitle}</label>
          <input
            className={input}
            value={siteSubtitle}
            maxLength={120}
            onChange={(e) => setSiteSubtitle(e.target.value)}
            placeholder="Lightweight VPS Management"
          />
          <p className={`mt-1 text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.siteSubtitleHint}</p>

          <label className={`${label} mt-4`}>{t.favicon}</label>
          <div className="flex items-center gap-3 flex-wrap">
            <label
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Icons.ImagePlus className="w-4 h-4" />
              {t.faviconUpload}
              <input
                type="file"
                accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => onPickFavicon(e.target.files?.[0] || null).catch((err) => setError(err.message))}
              />
            </label>
            <button
              type="button"
              className={`px-3 py-2 rounded-lg border text-sm ${
                isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'
              }`}
              onClick={() => {
                setFaviconDataUrl(null);
                setFaviconName('');
              }}
            >
              {t.faviconRemove}
            </button>
            {faviconName && (
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{faviconName}</span>
            )}
          </div>
          <p className={`mt-1 text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.faviconHint}</p>

          <div className={`mt-4 rounded-lg border p-3 ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.faviconCurrent}</p>
            <div className="flex items-center gap-3">
              {faviconDataUrl ? (
                <img src={faviconDataUrl} alt="Favicon preview" className="w-8 h-8 rounded" />
              ) : (
                <div className={`w-8 h-8 rounded flex items-center justify-center ${isDark ? 'bg-slate-800' : 'bg-white border border-slate-200'}`}>
                  <Icons.Server className="w-4 h-4 text-blue-500" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{siteTitle || 'CoPanel'}</p>
                <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                  {siteSubtitle || 'browser tab preview'}
                </p>
              </div>
            </div>
          </div>

          <label className={`${label} mt-4`}>{t.logo}</label>
          <div className="flex items-center gap-3 flex-wrap">
            <label
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Icons.Image className="w-4 h-4" />
              {t.logoUpload}
              <input
                type="file"
                accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => onPickLogo(e.target.files?.[0] || null).catch((err) => setError(err.message))}
              />
            </label>
            <button
              type="button"
              className={`px-3 py-2 rounded-lg border text-sm ${
                isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'
              }`}
              onClick={() => {
                setLogoDataUrl(null);
                setLogoName('');
              }}
            >
              {t.logoRemove}
            </button>
            {logoName && (
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{logoName}</span>
            )}
          </div>
          <p className={`mt-1 text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.logoHint}</p>

          <div className={`mt-4 rounded-lg border p-3 ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.logoCurrent}</p>
            <div className="flex items-center gap-3">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="Logo preview" className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isDark ? 'bg-slate-800' : 'bg-white border border-slate-200'}`}>
                  <Icons.Server className="w-6 h-6 text-blue-500" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{siteTitle || 'CoPanel'}</p>
                <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                  {siteSubtitle || 'Lightweight VPS Management'}
                </p>
              </div>
            </div>
          </div>

          <WallpaperGallery
            isDark={isDark}
            language={language}
            wallpapers={wallpapers}
            selectedId={selectedWallpaperId}
            onSelect={setSelectedWallpaperId}
            onRemove={onRemoveWallpaper}
            onUpload={onUploadWallpapers}
            uploading={wallpaperUploading}
          />

          <button
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            disabled={busy || !siteTitle.trim()}
            onClick={saveBranding}
          >
            {t.saveBranding}
          </button>
        </div>
      )}
        </main>
      </ModuleSidebarLayout>
    </ModuleViewport>
  );
}
