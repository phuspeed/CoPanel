/**
 * Notification Center drawer - opens from the top bar bell icon. Shows the
 * persisted inbox and lets the user mark items as read.
 */
import { useEffect } from 'react';
import * as Icons from 'lucide-react';
import { Level, notificationsApi, useInbox } from '../platform';

interface Props {
  open: boolean;
  onClose: () => void;
}

const LEVEL_COLOR: Record<Level, string> = {
  info: 'text-blue-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
};

const ICON: Record<Level, any> = {
  info: Icons.Info,
  success: Icons.CheckCircle2,
  warning: Icons.AlertTriangle,
  error: Icons.XCircle,
};

export default function NotificationCenter({ open, onClose }: Props) {
  const { inbox, unread } = useInbox();

  useEffect(() => {
    if (open) {
      notificationsApi.refresh().catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex" onClick={onClose}>
      <div className="flex-1 bg-black/30 backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] max-w-full h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Notifications</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{unread} unread</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => notificationsApi.markAllRead()}
              className="text-[11px] font-bold text-blue-500 hover:text-blue-400"
            >
              Mark all read
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {inbox.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              <Icons.Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {inbox.map((n) => {
                const Icon = ICON[n.level as Level] || Icons.Info;
                const tint = LEVEL_COLOR[n.level as Level] || LEVEL_COLOR.info;
                const unreadFlag = n.read === 0 || n.read === false;
                return (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors ${
                      unreadFlag ? 'bg-blue-50/40 dark:bg-blue-500/5' : ''
                    } hover:bg-slate-50 dark:hover:bg-slate-800/50`}
                    onClick={() => unreadFlag && notificationsApi.markRead([n.id])}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 ${tint}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{n.title}</p>
                      {n.body && (
                        <p className="text-xs mt-0.5 text-slate-600 dark:text-slate-400 whitespace-pre-line line-clamp-3">{n.body}</p>
                      )}
                      <p className="text-[10px] uppercase tracking-wider mt-1 text-slate-400">
                        {n.module || 'system'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
