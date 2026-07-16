/**
 * OS-style user account flyout — change password, profile, logout.
 */
import { useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { DOCK_HEIGHT } from './windowTypes';

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    account: 'Account',
    role: 'Role',
    superadmin: 'Superadmin',
    user: 'User',
    changePassword: 'Change password',
    classicUi: 'Switch to Classic UI',
    mobileDesktopSiteOn: 'Request desktop site',
    mobileDesktopSiteOff: 'Use mobile layout',
    logout: 'Sign out',
    server: 'Server',
  },
  vi: {
    account: 'Tài khoản',
    role: 'Vai trò',
    superadmin: 'Quản trị viên',
    user: 'Người dùng',
    changePassword: 'Đổi mật khẩu',
    classicUi: 'Chuyển giao diện Classic',
    mobileDesktopSiteOn: 'Yêu cầu trang web cho máy tính',
    mobileDesktopSiteOff: 'Dùng giao diện di động',
    logout: 'Đăng xuất',
    server: 'Máy chủ',
  },
} as const;

interface UserInfo {
  username?: string;
  role?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user?: UserInfo;
  isDark: boolean;
  language: Lang;
  serverHostname?: string | null;
  lanIp?: string | null;
  onChangePassword: () => void;
  onLogout?: () => void;
  onSwitchClassic: () => void;
  mobileDesktopSite?: boolean;
  showMobileDesktopSiteToggle?: boolean;
  onToggleMobileDesktopSite?: () => void;
}

export default function UserMenu({
  open,
  onClose,
  user,
  isDark,
  language,
  serverHostname,
  lanIp,
  onChangePassword,
  onLogout,
  onSwitchClassic,
  mobileDesktopSite = false,
  showMobileDesktopSiteToggle = false,
  onToggleMobileDesktopSite,
}: Props) {
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  const roleLabel = user?.role === 'superadmin' ? tr.superadmin : tr.user;
  const initial = (user?.username || '?').charAt(0).toUpperCase();

  const MenuRow = ({
    icon: Icon,
    label,
    onClick,
    danger,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors',
        danger
          ? isDark
            ? 'text-red-400 hover:bg-red-950/40'
            : 'text-red-600 hover:bg-red-50'
          : isDark
            ? 'text-slate-200 hover:bg-slate-800'
            : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      {label}
    </button>
  );

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed right-3 z-[130] w-72 overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl',
        isDark ? 'border-slate-700/80 bg-slate-900/95' : 'border-slate-200 bg-white/95',
      )}
      style={{ bottom: DOCK_HEIGHT + 8 }}
    >
      <div
        className={cn(
          'border-b px-4 py-4',
          isDark ? 'border-slate-800 bg-gradient-to-br from-blue-950/40 to-slate-900' : 'border-slate-100 bg-gradient-to-br from-blue-50 to-white',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white',
              isDark ? 'bg-blue-600' : 'bg-blue-500',
            )}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-sm font-bold', isDark ? 'text-white' : 'text-slate-900')}>
              {user?.username || 'Guest'}
            </p>
            <p className={cn('text-[10px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
              {tr.role}: {roleLabel}
            </p>
          </div>
        </div>
        {(serverHostname || lanIp) && (
          <div className={cn('mt-3 space-y-0.5 text-[10px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
            {serverHostname && (
              <p className="flex items-center gap-1.5 truncate">
                <Icons.Server className="h-3 w-3 shrink-0" />
                {serverHostname}
              </p>
            )}
            {lanIp && (
              <p className="flex items-center gap-1.5 truncate">
                <Icons.Wifi className="h-3 w-3 shrink-0" />
                {lanIp}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="p-2">
        <MenuRow icon={Icons.KeyRound} label={tr.changePassword} onClick={onChangePassword} />
        {showMobileDesktopSiteToggle && onToggleMobileDesktopSite && (
          <MenuRow
            icon={Icons.MonitorSmartphone}
            label={mobileDesktopSite ? tr.mobileDesktopSiteOff : tr.mobileDesktopSiteOn}
            onClick={onToggleMobileDesktopSite}
          />
        )}
        <MenuRow icon={Icons.PanelLeft} label={tr.classicUi} onClick={onSwitchClassic} />
        {onLogout && <MenuRow icon={Icons.LogOut} label={tr.logout} onClick={onLogout} danger />}
      </div>
    </div>
  );
}
