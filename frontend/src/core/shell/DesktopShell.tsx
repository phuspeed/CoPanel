/**
 * Desktop wallpaper surface — soft gradient home + clock (launcher-style).
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { chromeWallpaper } from '../desktopChrome';
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
  wallpaperDataUrl?: string | null;
}

export default function DesktopShell({
  isDark,
  language,
  siteTitle,
  siteSubtitle,
  logoDataUrl,
  wallpaperDataUrl,
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
        !wallpaperDataUrl && (isDark ? chromeWallpaper.dark : chromeWallpaper.light),
      )}
      style={
        wallpaperDataUrl
          ? {
              backgroundImage: `url(${wallpaperDataUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0',
          wallpaperDataUrl
            ? isDark
              ? 'bg-slate-950/55'
              : 'bg-white/35'
            : 'opacity-40',
        )}
        style={
          wallpaperDataUrl
            ? undefined
            : {
                backgroundImage: isDark
                  ? 'radial-gradient(ellipse 80% 50% at 50% 20%, rgba(34,211,238,0.12), transparent)'
                  : 'radial-gradient(ellipse 70% 45% at 50% 25%, rgba(255,255,255,0.55), transparent)',
              }
        }
        aria-hidden
      />

      <DesktopStatusCorner isDark={isDark} language={language} />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-8 pt-12 text-center">
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt=""
            className="mb-5 h-[4.5rem] w-[4.5rem] rounded-2xl object-cover shadow-lg ring-2 ring-white/30"
          />
        ) : (
          <div
            className={cn(
              'mb-5 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl shadow-lg',
              isDark
                ? 'bg-gradient-to-br from-sky-600 to-cyan-700 ring-2 ring-white/10'
                : 'bg-gradient-to-br from-[#d4c4b0] to-[#c4b8a8] ring-2 ring-white/50',
            )}
          >
            <Icons.Server className={cn('h-9 w-9', isDark ? 'text-white' : 'text-slate-700')} />
          </div>
        )}
        <p
          className={cn(
            'text-[11px] font-semibold uppercase tracking-[0.2em]',
            isDark ? 'text-slate-500' : 'text-slate-500/80',
          )}
        >
          {tr.welcome}
        </p>
        <h1 className={cn('mt-1.5 text-2xl font-bold md:text-3xl', isDark ? 'text-white' : 'text-slate-800')}>
          {siteTitle}
        </h1>
        {siteSubtitle && (
          <p className={cn('mt-1 max-w-md text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>{siteSubtitle}</p>
        )}
        <p
          className={cn(
            'mt-8 text-5xl font-extralight tabular-nums tracking-tight md:text-6xl',
            isDark ? 'text-slate-100' : 'text-slate-700',
          )}
        >
          {timeStr}
        </p>
        <p className={cn('mt-2 text-sm capitalize', isDark ? 'text-slate-400' : 'text-slate-500')}>{dateStr}</p>
        <p className={cn('mt-10 text-[11px]', isDark ? 'text-slate-600' : 'text-slate-400')}>{tr.hint}</p>
      </div>
    </div>
  );
}
