/**
 * Desktop wallpaper surface — apps live in Start menu, not fixed icon grid.
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import DesktopStatusCorner from './DesktopStatusCorner';

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    welcome: 'Welcome',
    hint: 'Press Start or Ctrl+K to open apps',
  },
  vi: {
    welcome: 'Chào mừng',
    hint: 'Bấm Start hoặc Ctrl+K để mở ứng dụng',
  },
} as const;

interface Props {
  isDark: boolean;
  language: Lang;
  siteTitle: string;
  siteSubtitle?: string;
  logoDataUrl?: string | null;
}

export default function DesktopShell({
  isDark,
  language,
  siteTitle,
  siteSubtitle,
  logoDataUrl,
}: Props) {
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  const timeStr = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden',
        isDark
          ? 'bg-gradient-to-br from-slate-950 via-indigo-950/80 to-slate-900'
          : 'bg-gradient-to-br from-sky-100 via-indigo-50 to-slate-100',
      )}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl"
        aria-hidden
      />

      <DesktopStatusCorner isDark={isDark} language={language} />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-8 pt-12 text-center">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" className="mb-4 h-16 w-16 rounded-2xl object-cover shadow-lg ring-2 ring-white/20" />
        ) : (
          <div
            className={cn(
              'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg',
              isDark ? 'bg-blue-600/80' : 'bg-blue-500',
            )}
          >
            <Icons.Server className="h-8 w-8 text-white" />
          </div>
        )}
        <p className={cn('text-xs font-semibold uppercase tracking-widest', isDark ? 'text-slate-500' : 'text-slate-400')}>
          {tr.welcome}
        </p>
        <h1 className={cn('mt-1 text-2xl font-bold md:text-3xl', isDark ? 'text-white' : 'text-slate-900')}>
          {siteTitle}
        </h1>
        {siteSubtitle && (
          <p className={cn('mt-1 max-w-md text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>{siteSubtitle}</p>
        )}
        <p className={cn('mt-6 text-4xl font-light tabular-nums md:text-5xl', isDark ? 'text-slate-100' : 'text-slate-800')}>
          {timeStr}
        </p>
        <p className={cn('mt-1 text-sm capitalize', isDark ? 'text-slate-400' : 'text-slate-500')}>{dateStr}</p>
        <p className={cn('mt-8 text-[11px]', isDark ? 'text-slate-600' : 'text-slate-400')}>{tr.hint}</p>
      </div>
    </div>
  );
}
