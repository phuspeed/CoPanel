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

const QUICK_ACTIONS = [
  { id: 'site-wizard', label: 'New Site', desc: 'Provision a website end-to-end', icon: 'Wand2', path: '/site-wizard' },
  { id: 'web', label: 'Web Manager', desc: 'Manage Nginx vhosts', icon: 'Globe', path: '/web-manager' },
  { id: 'ssl', label: 'SSL', desc: 'Issue or renew certificates', icon: 'Shield', path: '/ssl-manager' },
  { id: 'db', label: 'Databases', desc: 'Provision MySQL databases', icon: 'Database', path: '/database-manager' },
  { id: 'docker', label: 'Docker', desc: 'Containers & compose', icon: 'Box', path: '/docker-manager' },
  { id: 'firewall', label: 'Firewall', desc: 'Manage UFW & Fail2Ban', icon: 'ShieldAlert', path: '/firewall' },
];

export default function Dashboard() {
  const modules = moduleRegistry.getAll();
  const [now, setNow] = useState(new Date());
  const ctx = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>() || ({} as any);
  const isDark = ctx.theme === 'dark';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">Dashboard</p>
          <h1 className={`text-2xl md:text-3xl font-extrabold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            Welcome back
          </h1>
          <p className={`text-xs mt-2 max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Manage every layer of your VPS - hosting, databases, containers, and security - from one
            unified, modern panel.
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-right min-w-[180px] ${
          isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">Server time</p>
          <p className={`text-lg md:text-xl font-mono font-bold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            {now.toLocaleTimeString()}
          </p>
          <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {now.toLocaleDateString()}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {QUICK_ACTIONS.map((q) => {
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
              <p className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{q.label}</p>
              <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{q.desc}</p>
            </Link>
          );
        })}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SystemHealthWidget />
        <ServiceStatusWidget />
        <SslExpiryWidget />
        <RecentTasksWidget />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>All Apps</h2>
          <span className={`text-[10px] uppercase tracking-widest font-bold ${
            isDark ? 'text-slate-500' : 'text-slate-400'
          }`}>
            {modules.length} modules
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
