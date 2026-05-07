/**
 * Dashboard 2.0 - widget-based composition. Each widget owns its own data
 * fetching and renders inside a uniform card. The grid is responsive and
 * widgets automatically reflow on small screens.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { moduleRegistry } from './registry';
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
    badge: 'Dashboard',
    title: 'Control your VPS in one place',
    subtitle: 'Monitor services, run daily actions, and jump into modules quickly from this unified workspace.',
    serverTime: 'Server time',
    quickActions: 'Quick actions',
    quickActionsHint: 'Common workflows',
    allApps: 'All apps',
    modules: 'modules',
    actions: {
      'site-wizard': { label: 'New Site', desc: 'Provision a website end-to-end' },
      web: { label: 'Web Manager', desc: 'Manage Nginx virtual hosts' },
      ssl: { label: 'SSL', desc: 'Issue or renew certificates' },
      db: { label: 'Databases', desc: 'Provision MySQL databases' },
      docker: { label: 'Docker', desc: 'Containers and compose stacks' },
      firewall: { label: 'Firewall', desc: 'Manage UFW and Fail2Ban' },
    },
  },
  vi: {
    badge: 'Tổng quan',
    title: 'Điều khiển VPS tại một nơi',
    subtitle: 'Theo dõi dịch vụ, chạy tác vụ hằng ngày và truy cập nhanh các module trong cùng một không gian làm việc.',
    serverTime: 'Thời gian máy chủ',
    quickActions: 'Thao tác nhanh',
    quickActionsHint: 'Luồng công việc thường dùng',
    allApps: 'Tất cả ứng dụng',
    modules: 'module',
    actions: {
      'site-wizard': { label: 'Tạo website', desc: 'Khởi tạo website trọn quy trình' },
      web: { label: 'Quản lý Web', desc: 'Quản lý virtual host Nginx' },
      ssl: { label: 'SSL', desc: 'Cấp mới hoặc gia hạn chứng chỉ' },
      db: { label: 'Cơ sở dữ liệu', desc: 'Tạo và quản lý CSDL MySQL' },
      docker: { label: 'Docker', desc: 'Container và compose stack' },
      firewall: { label: 'Tường lửa', desc: 'Quản lý UFW và Fail2Ban' },
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
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">{tr.badge}</p>
          <h1 className={`text-2xl md:text-3xl font-extrabold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            {tr.title}
          </h1>
          <p className={`text-xs mt-2 max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {tr.subtitle}
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-right min-w-[180px] ${
          isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{tr.serverTime}</p>
          <p className={`text-lg md:text-xl font-mono font-bold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            {new Intl.DateTimeFormat(locale, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: language === 'en',
            }).format(now)}
          </p>
          <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {new Intl.DateTimeFormat(locale, {
              weekday: 'short',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(now)}
          </p>
        </div>
      </header>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{tr.quickActions}</h2>
          <span className={`text-[10px] uppercase tracking-widest font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            {tr.quickActionsHint}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {QUICK_ACTIONS.map((q) => {
          const actionText = tr.actions[q.id as keyof typeof tr.actions];
          const Icon = (Icons as any)[q.icon] || Icons.Grid;
          return (
            <Link
              key={q.id}
              to={q.path}
              className={`group flex flex-col gap-2 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow ${
                isDark
                  ? 'bg-slate-900/60 border-slate-800 hover:border-blue-500/50'
                  : 'bg-white border-slate-200 hover:border-blue-400/50'
              }`}
            >
              <span className={`p-2 rounded-xl w-fit ${
                isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'
              }`}>
                <Icon className="w-4 h-4" />
              </span>
              <p className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{actionText.label}</p>
              <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{actionText.desc}</p>
            </Link>
          );
        })}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SystemHealthWidget />
        <ServiceStatusWidget />
        <SslExpiryWidget />
        <RecentTasksWidget />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{tr.allApps}</h2>
          <span className={`text-[10px] uppercase tracking-widest font-bold ${
            isDark ? 'text-slate-500' : 'text-slate-400'
          }`}>
            {modules.length} {tr.modules}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {modules.map((m) => {
            const Icon = (Icons as any)[m.icon] || Icons.Grid;
            return (
              <Link
                key={m.path}
                to={m.path}
                className={`group rounded-2xl border p-3 flex items-center gap-3 transition-colors ${
                  isDark
                    ? 'bg-slate-900/40 border-slate-800 hover:border-blue-500/50'
                    : 'bg-white border-slate-200 hover:border-blue-400/50'
                }`}
                title={m.description}
              >
                <span className={`p-2 rounded-xl ${
                  isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'
                }`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className={`text-xs font-semibold truncate ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
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
