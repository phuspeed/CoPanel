import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AppStoreTranslations } from '../i18n';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
  onCommunity: () => void;
  onUploadZip: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpdateAll?: () => void;
  updateCount?: number;
  batchUpdating?: boolean;
  loading: boolean;
  isDark: boolean;
  tr: AppStoreTranslations;
  version?: string;
}

export default function AppStoreHeader({
  query,
  onQueryChange,
  onRefresh,
  onCommunity,
  onUploadZip,
  onUpdateAll,
  updateCount = 0,
  batchUpdating = false,
  loading,
  isDark,
  tr,
  version,
}: Props) {
  return (
    <header
      className={cn(
        'shrink-0 border-b px-4 py-3',
        isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white/80',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-[200px] sm:basis-auto">
          <Icons.Search className={cn('absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', isDark ? 'text-slate-500' : 'text-slate-400')} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={tr.searchPlaceholder}
            className={cn(
              'w-full rounded-full border py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40',
              isDark
                ? 'border-slate-700 bg-slate-800/80 text-slate-100 placeholder:text-slate-500'
                : 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400',
            )}
          />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold',
            isDark ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            loading && 'opacity-60',
          )}
        >
          <Icons.RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          <span className="hidden sm:inline">{tr.refresh}</span>
        </button>

        {updateCount > 0 && onUpdateAll && (
          <button
            type="button"
            onClick={onUpdateAll}
            disabled={batchUpdating || loading}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white',
              'bg-amber-500 hover:bg-amber-400',
              (batchUpdating || loading) && 'opacity-60',
            )}
          >
            {batchUpdating ? (
              <Icons.Loader className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icons.Download className="h-3.5 w-3.5" />
            )}
            {batchUpdating ? tr.btnUpdatingAll : `${tr.btnUpdateAll} (${updateCount})`}
          </button>
        )}

        <button
          type="button"
          onClick={onCommunity}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold',
            isDark ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          <Icons.Store className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tr.community}</span>
        </button>

        <label
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white',
            'bg-blue-600 hover:bg-blue-500',
          )}
        >
          <Icons.FileArchive className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tr.importZip}</span>
          <input type="file" accept=".zip" className="hidden" onChange={onUploadZip} />
        </label>

        {version && (
          <span className={cn('font-mono text-[10px]', isDark ? 'text-slate-500' : 'text-slate-400')}>v{version}</span>
        )}
      </div>
    </header>
  );
}
