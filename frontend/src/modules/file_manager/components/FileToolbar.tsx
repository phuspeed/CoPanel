import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { ViewMode } from '../types';
import type { FileManagerTranslations } from '../i18n';
import FileBreadcrumb from './FileBreadcrumb';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  currentPath: string;
  canGoBack: boolean;
  canGoForward: boolean;
  viewMode: ViewMode;
  filterQuery: string;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onViewMode: (mode: ViewMode) => void;
  onFilterQuery: (q: string) => void;
  onCreateFile: () => void;
  onCreateDir: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function FileToolbar({
  isDark,
  tr,
  currentPath,
  canGoBack,
  canGoForward,
  viewMode,
  filterQuery,
  onBack,
  onForward,
  onUp,
  onRefresh,
  onNavigate,
  onViewMode,
  onFilterQuery,
  onCreateFile,
  onCreateDir,
  onUpload,
}: Props) {
  const toolBtn = cn(
    'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
    isDark ? 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  );
  const iconBtn = cn(
    'flex h-8 w-8 items-center justify-center rounded-lg border transition',
    isDark ? 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
  );

  return (
    <div className={cn('shrink-0 border-b px-3 py-2 space-y-2', isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white/90')}>
      <div className="flex flex-wrap items-center gap-2">
        <FileBreadcrumb
          isDark={isDark}
          tr={tr}
          currentPath={currentPath}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
          onUp={onUp}
          onRefresh={onRefresh}
          onNavigate={onNavigate}
        />
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className={cn(iconBtn, viewMode === 'grid' && 'border-blue-500 text-blue-500')} onClick={() => onViewMode('grid')} title={tr.gridView}>
            <Icons.LayoutGrid className="h-4 w-4" />
          </button>
          <button type="button" className={cn(iconBtn, viewMode === 'list' && 'border-blue-500 text-blue-500')} onClick={() => onViewMode('list')} title={tr.listView}>
            <Icons.List className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn('flex flex-1 min-w-[140px] items-center gap-2 rounded-lg border px-2.5 h-8', isDark ? 'border-slate-700 bg-slate-950/50' : 'border-slate-200 bg-slate-50')}>
          <Icons.Search className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-slate-500' : 'text-slate-400')} />
          <input
            value={filterQuery}
            onChange={(e) => onFilterQuery(e.target.value)}
            placeholder={tr.searchPlaceholder}
            className={cn('w-full bg-transparent text-xs outline-none', isDark ? 'text-slate-200 placeholder:text-slate-600' : 'text-slate-800 placeholder:text-slate-400')}
          />
        </div>
        <button type="button" className={toolBtn} onClick={onCreateFile}>
          <Icons.FilePlus className="h-3.5 w-3.5" /> {tr.createFile}
        </button>
        <button type="button" className={toolBtn} onClick={onCreateDir}>
          <Icons.FolderPlus className="h-3.5 w-3.5" /> {tr.createDir}
        </button>
        <label className={cn(toolBtn, 'cursor-pointer')}>
          <Icons.Upload className="h-3.5 w-3.5" /> {tr.upload}
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
    </div>
  );
}
