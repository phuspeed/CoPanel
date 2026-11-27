import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatDate, formatSize } from '../utils';
import type { FileManagerState } from '../hooks/useFileManager';
import type { ItemInteractions } from '../hooks/useItemInteractions';
import type { SortKey } from '../types';
import { FileIcon } from './FileIcon';

function SortHeader({ label, k, fm, className }: { label: string; k: SortKey; fm: FileManagerState; className?: string }) {
  const active = fm.sortKey === k;
  return (
    <th className={cn('px-2 py-1.5 font-semibold', className)}>
      <button
        type="button"
        onClick={() => fm.handleSort(k)}
        className={cn(
          'inline-flex items-center gap-1 text-[11px]',
          active ? (fm.isDark ? 'text-sky-300' : 'text-blue-600') : fm.isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800',
        )}
      >
        {label}
        <Icons.ChevronUp className={cn('h-3 w-3 transition', active ? (fm.sortAsc ? '' : 'rotate-180') : 'opacity-0')} />
      </button>
    </th>
  );
}

export default function FileListView({ fm, ix }: { fm: FileManagerState; ix: ItemInteractions }) {
  const { isDark, tr, files, selectedPaths, focusPath } = fm;
  const allSelected = selectedPaths.length === files.length && files.length > 0;

  return (
    <table className="w-full border-collapse text-left text-xs" data-testid="fm-list">
      <thead className={cn('sticky top-0 z-10 backdrop-blur', isDark ? 'bg-slate-950/90' : 'bg-white/95')}>
        <tr className={cn('border-b', isDark ? 'border-slate-800' : 'border-slate-200')}>
          <th className="w-8 py-1.5 pl-3 pr-1">
            <button type="button" aria-label={tr.selectAllTitle} onClick={fm.handleSelectAll} className="flex items-center">
              {allSelected ? <Icons.CheckSquare className="h-3.5 w-3.5 text-blue-500" /> : <Icons.Square className="h-3.5 w-3.5 opacity-40" />}
            </button>
          </th>
          <SortHeader label={tr.name} k="name" fm={fm} />
          <SortHeader label={tr.dateModified} k="modified" fm={fm} className="hidden w-40 md:table-cell" />
          <SortHeader label={tr.size} k="size" fm={fm} className="w-24 text-right" />
        </tr>
      </thead>
      <tbody>
        {files.map((item) => {
          const selected = selectedPaths.includes(item.path);
          const focused = focusPath === item.path;
          const drop = ix.dropTarget === item.path;
          return (
            <tr
              key={item.path}
              {...ix.bind(item)}
              aria-selected={selected}
              className={cn(
                'cursor-default transition-colors',
                selected
                  ? isDark
                    ? 'bg-sky-500/15'
                    : 'bg-blue-50'
                  : isDark
                    ? 'hover:bg-slate-800/40'
                    : 'hover:bg-slate-50',
                focused && (isDark ? 'outline outline-1 -outline-offset-1 outline-sky-500/60' : 'outline outline-1 -outline-offset-1 outline-blue-400'),
                drop && (isDark ? 'bg-sky-500/25 outline outline-2 -outline-offset-2 outline-sky-400' : 'bg-blue-100 outline outline-2 -outline-offset-2 outline-blue-500'),
                ix.isCut(item.path) && 'opacity-50',
              )}
            >
              <td className="py-1.5 pl-3 pr-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  aria-label={item.name}
                  onClick={() => fm.selectItem(item.path, { ctrl: true })}
                  className="flex items-center"
                >
                  {selected ? <Icons.CheckSquare className="h-3.5 w-3.5 text-blue-500" /> : <Icons.Square className="h-3.5 w-3.5 opacity-30" />}
                </button>
              </td>
              <td className="max-w-0 px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <FileIcon item={item} className="h-4 w-4" />
                  <span className={cn('truncate', item.is_dir ? 'font-semibold' : 'font-medium')} title={item.name}>
                    {item.name}
                  </span>
                </div>
              </td>
              <td className={cn('hidden px-2 py-1.5 md:table-cell', isDark ? 'text-slate-500' : 'text-slate-500')}>{formatDate(item.modified)}</td>
              <td className={cn('px-2 py-1.5 text-right font-mono tabular-nums', isDark ? 'text-slate-500' : 'text-slate-500')}>
                {item.is_dir ? '' : formatSize(item.size)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
