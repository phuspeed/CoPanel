/**
 * Web service status widget - lists Nginx / Apache / OpenLiteSpeed install
 * and running state from ``web_manager``.
 */
import { useEffect, useState } from 'react';
import { api } from '../platform';
import Widget from './Widget';

interface Service {
  id: string;
  name: string;
  installed: boolean;
  status: string;
}

export default function ServiceStatusWidget() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const data = await api<{ services: Service[] }>('/api/web_manager/web_services', { raw: true });
        if (active) {
          setServices(data.services || []);
          setError(null);
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Cannot reach web_manager');
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const installed = services?.filter((s) => s.installed) || [];
  const running = installed.filter((s) => s.status === 'running').length;
  const total = installed.length;
  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (total === 0) status = 'warn';
  else if (running < total) status = 'warn';

  return (
    <Widget title="Web Services" icon="Globe" status={status} loading={!services && !error}>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : !services?.length ? (
        <p className="text-xs text-slate-500">No web service detected. Install one from the Web module.</p>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between text-xs p-2 rounded-lg border border-slate-100 dark:border-slate-800/60"
            >
              <span className="font-semibold text-slate-700 dark:text-slate-200">{s.name}</span>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  s.status === 'running'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : s.installed
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {s.installed ? s.status : 'not installed'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
