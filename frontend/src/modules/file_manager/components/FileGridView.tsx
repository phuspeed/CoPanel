import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { fileIconKind, formatDate, formatSize } from '../utils';
import type { FileItem } from '../types';
import type { FileManagerTranslations } from '../i18n';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  files: FileItem[];
  selectedPaths: string[];
  onOpen: (item: FileItem) => void;
  onToggleSelect: (path: string, multi?: boolean) => void;
}

function GridIcon({ kind, isDark }: { kind: ReturnType<typeof fileIconKind>; isDark: boolean }) {
  if (kind === 'folder') return <Icons.Folder className={cn('h-10 w-10', isDark ? 'text-sky-400 fill-sky-500/15' : 'text-sky-600 fill-sky-100')} />;
  if (kind === 'archive') return <Icons.Archive className={cn('h-10 w-10', isDark ? 'text-amber-400' : 'text-amber-600')} />;
  if (kind === 'image') return <Icons.Image className={cn('h-10 w-10', isDark ? 'text-pink-400' : 'text-pink-600')} />;
  if (kind === 'code') return <Icons.FileCode className={cn('h-10 w-10', isDark ? 'text-violet-400' : 'text-violet-600')} />;
  return <Icons.File className={cn('h-10 w-10', isDark ? 'text-slate-400' : 'text-slate-500')} />;
}

export default function FileGridView({ isDark, tr, files, selectedPaths, onOpen, onToggleSelect }: Props) {
  if (files.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
        {tr.noFiles}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2 p-3">
      {files.map((item) => {
        const selected = selectedPaths.includes(item.path);
        return (
          <button
            key={item.path}
            type="button"
            onClick={(e) => onToggleSelect(item.path, e.ctrlKey || e.metaKey)}
            onDoubleClick={() => onOpen(item)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition select-none',
              selected
                ? isDark
                  ? 'border-blue-500/60 bg-blue-950/30 ring-1 ring-blue-500/40'
                  : 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                : isDark
                  ? 'border-transparent hover:border-slate-700 hover:bg-slate-800/40'
                  : 'border-transparent hover:border-slate-200 hover:bg-slate-50',
            )}
          >
            <GridIcon kind={fileIconKind(item.name, item.is_dir)} isDark={isDark} />
            <span className={cn('w-full truncate text-[11px] font-medium leading-tight', isDark ? 'text-slate-200' : 'text-slate-800')}>
              {item.name}
            </span>
            {!item.is_dir && (
              <span className={cn('text-[9px] font-mono', isDark ? 'text-slate-500' : 'text-slate-400')}>{formatSize(item.size)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
