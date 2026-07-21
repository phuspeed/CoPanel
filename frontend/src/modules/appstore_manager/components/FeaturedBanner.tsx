import * as Icons from 'lucide-react';
import { accentForPackageId } from '../../../core/appStoreAccent';
import { cn } from '../../../lib/utils';
import type { Package } from '../types';
import CatalogIcon from './CatalogIcon';

interface Props {
  packages: Package[];
  isDark: boolean;
  language: 'en' | 'vi';
  title: string;
  subtitle?: string;
}

/** Lightweight featured banners from hot/core catalog (presentational only). */
export default function FeaturedBanner({ packages, isDark, language, title, subtitle }: Props) {
  const featured = packages.slice(0, 4);
  if (featured.length === 0) return null;

  const [primary, ...rest] = featured;

  return (
    <div className="space-y-2 px-4 pt-3">
      {(title || subtitle) && (
        <div className="mb-1">
          {title && (
            <p className={cn('text-xs font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>
              {title}
            </p>
          )}
          {subtitle && <p className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-500')}>{subtitle}</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 overflow-hidden sm:grid-cols-3">
        <BannerCard pkg={primary} isDark={isDark} language={language} large />
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2 sm:grid-rows-2">
          {rest.slice(0, 3).map((pkg, i) => (
            <BannerCard key={pkg.id} pkg={pkg} isDark={isDark} language={language} large={i === 0 && rest.length === 1} />
          ))}
          {rest.length === 0 && (
            <div
              className={cn(
                'col-span-2 flex items-center justify-center rounded-xl border border-dashed text-xs',
                isDark ? 'border-slate-700 text-slate-600' : 'border-slate-200 text-slate-400',
              )}
            >
              <Icons.Sparkles className="mr-1.5 h-3.5 w-3.5" />
              CoPanel
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BannerCard({
  pkg,
  isDark,
  language,
  large,
}: {
  pkg: Package;
  isDark: boolean;
  language: 'en' | 'vi';
  large?: boolean;
}) {
  const accent = accentForPackageId(pkg.id);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border p-3',
        large ? 'min-h-[5.5rem]' : 'min-h-[4.25rem]',
        isDark ? 'border-slate-700/80 bg-slate-900/60' : 'border-slate-200 bg-gradient-to-br from-white to-slate-50',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br opacity-40 blur-2xl',
          isDark ? accent.dark : accent.light,
        )}
        aria-hidden
      />
      <div className="relative flex items-center gap-2.5">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br',
            isDark ? accent.dark : accent.light,
          )}
        >
          <CatalogIcon iconName={pkg.icon} className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className={cn('truncate text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-800')}>{pkg.name}</p>
          <p className={cn('line-clamp-1 text-[10px]', isDark ? 'text-slate-500' : 'text-slate-500')}>
            {pkg.description || (language === 'vi' ? 'Dịch vụ chính thức' : 'Official service')}
          </p>
        </div>
      </div>
    </div>
  );
}
