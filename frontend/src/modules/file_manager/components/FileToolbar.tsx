import { useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileManagerState } from '../hooks/useFileManager';
import FileBreadcrumb from './FileBreadcrumb';

interface Props {
  fm: FileManagerState;
  /** Bumped by Ctrl+L. */
  editPathSignal: number;
  /** Bumped by Ctrl+F or "/". */
  focusFilterSignal: number;
  onCrumbDragOver: (e: React.DragEvent, path: string) => boolean;
  onCrumbDrop: (e: React.DragEvent, path: string) => void;
}

/** Address row: history + up, editable breadcrumb path, filter box. */
export default function FileToolbar({ fm, editPathSignal, focusFilterSignal, onCrumbDragOver, onCrumbDrop }: Props) {
  const { isDark, tr, currentPath, canGoBack, canGoForward, filterQuery, setFilterQuery } = fm;
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusFilterSignal) {
      filterRef.current?.focus();
      filterRef.current?.select();
    }
  }, [focusFilterSignal]);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5 sm:flex-nowrap',
        isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white/90',
      )}
    >
      <FileBreadcrumb
        isDark={isDark}
        tr={tr}
        currentPath={currentPath}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={fm.goBack}
        onForward={fm.goForward}
        onUp={fm.handleGoUp}
        onRefresh={fm.refresh}
        onNavigate={fm.navigateTo}
        onNavigateTyped={fm.navigateToTyped}
        editSignal={editPathSignal}
        onCrumbDragOver={onCrumbDragOver}
        onCrumbDrop={onCrumbDrop}
      />
      <div
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 sm:w-56 sm:shrink-0',
          isDark ? 'border-slate-700 bg-slate-950/50' : 'border-slate-200 bg-slate-50',
        )}
      >
        <Icons.Search className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-slate-500' : 'text-slate-400')} />
        <input
          ref={filterRef}
          data-testid="fm-filter"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setFilterQuery('');
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={tr.searchPlaceholder}
          className={cn('w-full bg-transparent text-xs outline-none', isDark ? 'text-slate-200 placeholder:text-slate-600' : 'text-slate-800 placeholder:text-slate-400')}
        />
        {filterQuery && (
          <button type="button" aria-label={tr.cancel} onClick={() => setFilterQuery('')} className="opacity-60 hover:opacity-100">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
