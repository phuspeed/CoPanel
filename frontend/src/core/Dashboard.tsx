/**
 * Dashboard — compact ADM-style overview: health panels + quick actions grid.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { chromePanel } from './desktopChrome';
import { moduleRegistry } from './registry';
import { cn } from '../lib/utils';
import {
  RecentTasksWidget,
  ServiceStatusWidget,
  SslExpiryWidget,
  SystemHealthWidget,
} from './widgets';

type Lang = 'en' | 'vi';
type QuickAction = { id: string; icon: string; path: string };

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'site-wizard', icon: 'Wand2', path: '/site-wizard' },
  { id: 'web', icon: 'Globe', path: '/web-manager' },
  { id: 'ssl', icon: 'Shield', path: '/ssl-manager' },
  { id: 'db', icon: 'Database', path: '/database-manager' },
  { id: 'docker', icon: 'Box', path: '/docker-manager' },
  { id: 'firewall', icon: 'ShieldAlert', path: '/firewall' },
];

const DASHBOARD_I18N = {
  en: {
    badge: 'Overview',
    title: 'System Dashboard',
    subtitle: 'Health, services, and quick jumps into modules.',
    serverTime: 'Server time',
    quickActions: 'Quick actions',
    allApps: 'All apps',
    modules: 'modules',
    actions: {
      'site-wizard': { label: 'New Site', desc: 'Provision a website' },
      web: { label: 'Web', desc: 'Nginx virtual hosts' },
      ssl: { label: 'SSL', desc: 'Certificates' },
      db: { label: 'Databases', desc: 'MySQL' },
      docker: { label: 'Docker', desc: 'Containers' },
      firewall: { label: 'Firewall', desc: 'UFW / Fail2Ban' },
    },
  },
  vi: {
    badge: 'Tổng quan',
    title: 'Bảng điều khiển',
    subtitle: 'Sức khỏe hệ thống, dịch vụ và truy cập nhanh module.',
    serverTime: 'Thời gian máy chủ',
    quickActions: 'Thao tác nhanh',
    allApps: 'Tất cả ứng dụng',
    modules: 'module',
    actions: {
      'site-wizard': { label: 'Tạo website', desc: 'Khởi tạo website' },
      web: { label: 'Web', desc: 'Virtual host Nginx' },
      ssl: { label: 'SSL', desc: 'Chứng chỉ' },
      db: { label: 'CSDL', desc: 'MySQL' },
      docker: { label: 'Docker', desc: 'Container' },
      firewall: { label: 'Tường lửa', desc: 'UFW / Fail2Ban' },
    },
  },
} as const;

export default function Dashboard() {
  const modules = moduleRegistry.getAll();
  const [now, setNow] = useState(new Date());
  const ctx = useOutletContext<{ theme: 'dark' | 'light'; language: Lang }>() || ({} as any);
  const isDark = ctx.theme === 'dark';
  const language: Lang = ctx.language === 'vi' ? 'vi' : 'en';
  const tr = DASHBOARD_I18N[language];
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-sky-400' : 'text-sky-600')}>
            {tr.badge}
          </p>
          <h1 className={cn('truncate text-xl font-bold md:text-2xl', isDark ? 'text-slate-100' : 'text-slate-900')}>
            {tr.title}
          </h1>
          <p className={cn('mt-0.5 text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.subtitle}</p>
        </div>
        <div className={cn(chromePanel(isDark), 'shrink-0 px-4 py-2.5 text-right min-w-[160px]')}>
          <p className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-sky-400' : 'text-sky-600')}>
            {tr.serverTime}
          </p>
          <p className={cn('mt-0.5 font-mono text-lg font-bold', isDark ? 'text-slate-100' : 'text-slate-800')}>
            {new Intl.DateTimeFormat(locale, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: language === 'en',
            }).format(now)}
          </p>
          <p className={cn('text-[11px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
            {new Intl.DateTimeFormat(locale, {
              weekday: 'short',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(now)}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <SystemHealthWidget />
        <ServiceStatusWidget />
        <SslExpiryWidget />
        <RecentTasksWidget />
      </section>

      <section>
        <h2 className={cn('mb-2.5 text-sm font-bold', isDark ? 'text-slate-200' : 'text-slate-800')}>{tr.quickActions}</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {QUICK_ACTIONS.map((q) => {
            const actionText = tr.actions[q.id as keyof typeof tr.actions];
            const Icon = (Icons as any)[q.icon] || Icons.Grid;
            return (
              <Link
                key={q.id}
                to={q.path}
                className={cn(
                  chromePanel(isDark),
                  'group flex flex-col items-center gap-2 p-3 text-center transition hover:border-sky-400/50',
                )}
              >
                <span
                  className={cn(
                    'rounded-xl p-2',
                    isDark ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-50 text-sky-600',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <p className={cn('text-xs font-bold', isDark ? 'text-slate-100' : 'text-slate-800')}>{actionText.label}</p>
                <p className={cn('line-clamp-1 text-[10px]', isDark ? 'text-slate-400' : 'text-slate-500')}>{actionText.desc}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className={cn('text-sm font-bold', isDark ? 'text-slate-200' : 'text-slate-800')}>{tr.allApps}</h2>
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
            {modules.length} {tr.modules}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {modules.map((m) => {
            const Icon = (Icons as any)[m.icon] || Icons.Grid;
            return (
              <Link
                key={m.path}
                to={m.path}
                className={cn(
                  chromePanel(isDark),
                  'group flex items-center gap-2.5 p-2.5 transition hover:border-sky-400/50',
                )}
                title={m.description}
              >
                <span
                  className={cn(
                    'rounded-lg p-2',
                    isDark ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-50 text-sky-600',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn('truncate text-xs font-semibold', isDark ? 'text-slate-100' : 'text-slate-800')}>
                  {m.name}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
