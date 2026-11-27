import { cn } from '../../../lib/utils';
import { formatSize } from '../utils';
import type { FileManagerState } from '../hooks/useFileManager';
import type { ItemInteractions } from '../hooks/useItemInteractions';
import { FileThumb } from './FileIcon';

export default function FileGridView({ fm, ix }: { fm: FileManagerState; ix: ItemInteractions }) {
  const { isDark, files, selectedPaths, focusPath } = fm;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5 p-2" data-testid="fm-grid">
      {files.map((item) => {
        const selected = selectedPaths.includes(item.path);
        const focused = focusPath === item.path;
        const drop = ix.dropTarget === item.path;
        return (
          <div
            key={item.path}
            {...ix.bind(item)}
            aria-selected={selected}
            title={item.name}
            className={cn(
              'flex cursor-default flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors',
              selected
                ? isDark
                  ? 'border-sky-500/50 bg-sky-500/15'
                  : 'border-blue-300 bg-blue-50'
                : isDark
                  ? 'border-transparent hover:bg-slate-800/50'
                  : 'border-transparent hover:bg-slate-100/80',
              focused && !selected && (isDark ? 'border-sky-500/40' : 'border-blue-300'),
              drop && (isDark ? 'border-sky-400 bg-sky-500/25' : 'border-blue-500 bg-blue-100'),
              ix.isCut(item.path) && 'opacity-50',
            )}
          >
            <FileThumb item={item} iconClass="h-10 w-10" />
            <span className={cn('line-clamp-2 w-full break-all text-[0.6875rem] font-medium leading-tight', isDark ? 'text-slate-200' : 'text-slate-800')}>
              {item.name}
            </span>
            {!item.is_dir && <span className={cn('text-[0.5625rem] font-mono', isDark ? 'text-slate-500' : 'text-slate-400')}>{formatSize(item.size)}</span>}
          </div>
        );
      })}
    </div>
  );
}
