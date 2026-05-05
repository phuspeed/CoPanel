/**
 * SSL expiry widget - surfaces certificates that expire within 30 days,
 * driven by the new ``/api/ssl_manager/expiry`` endpoint.
 */
import { useEffect, useState } from 'react';
import { api } from '../platform';
import Widget from './Widget';

interface CertRow {
  domain: string;
  active: boolean;
  type: string;
  expiry: string;
  days_left: number;
  expiring_soon: boolean;
}

export default function SslExpiryWidget() {
  const [rows, setRows] = useState<CertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<{ data: CertRow[] }>('/api/ssl_manager/expiry?days=30', { raw: true })
      .then((res) => {
        if (active) setRows(res.data || []);
      })
      .catch((err) => active && setError(err?.message || 'Cannot reach ssl_manager'));
    return () => {
      active = false;
    };
  }, []);

  const expiring = (rows || []).filter((r) => r.expiring_soon);
  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (expiring.some((r) => r.days_left <= 7)) status = 'error';
  else if (expiring.length > 0) status = 'warn';

  return (
    <Widget title="SSL Certificates" icon="Shield" status={status} loading={!rows && !error}>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : !rows?.length ? (
        <p className="text-xs text-slate-500">No certificates tracked yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map((r) => (
            <li key={r.domain} className="flex items-center justify-between text-xs">
              <span className="truncate text-slate-700 dark:text-slate-200">{r.domain}</span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  r.days_left < 0
                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    : r.days_left <= 7
                      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      : r.days_left <= 30
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                }`}
              >
                {r.days_left < 0 ? 'unknown' : `${r.days_left}d`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
