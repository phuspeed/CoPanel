import type { MouseEvent } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatDate, formatSize } from '../utils';
import type { FileItem, SortKey } from '../types';
import type { FileManagerTranslations } from '../i18n';
import FileActionsBar from './FileActionsBar';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  files: FileItem[];
  selectedPaths: string[];
  sortKey: SortKey;
  sortAsc: boolean;
  bookmarkPathSet: Set<string>;
  bookmarksUiEnabled: boolean;
  onSort: (key: SortKey) => void;
  onOpen: (item: FileItem) => void;
  onToggleSelect: (path: string, multi?: boolean) => void;
  onSelectAll: () => void;
  onEdit: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onBookmarkToggle: (item: FileItem) => void;
  onCut: (item: FileItem) => void;
  onCopy: (item: FileItem) => void;
  onDelete: (item: FileItem) => void;
  onItemContextMenu: (e: MouseEvent, item: FileItem) => void;
  onBlankContextMenu: (e: MouseEvent) => void;
}

function SortBtn({ label, active, asc, isDark, onClick }: { label: string; active: boolean; asc: boolean; isDark: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[10px]', active ? (isDark ? 'text-sky-400' : 'text-blue-600') : isDark ? 'text-slate-400 hover:text-sky-400' : 'text-slate-500 hover:text-blue-600')}>
      {label}
      <Icons.ChevronUp className={cn('h-3 w-3 transition', active ? (asc ? '' : 'rotate-180') : 'opacity-30')} />
    </button>
  );
}

export default function FileListView({
  isDark,
  tr,
  files,
  selectedPaths,
  sortKey,
  sortAsc,
  bookmarkPathSet,
  bookmarksUiEnabled,
  onSort,
  onOpen,
  onToggleSelect,
  onSelectAll,
  onEdit,
  onDownload,
  onRename,
  onBookmarkToggle,
  onCut,
  onCopy,
  onDelete,
  onItemContextMenu,
  onBlankContextMenu,
}: Props) {
  if (files.length === 0) {
    return (
      <div
        className={cn('flex h-full min-h-[200px] items-center justify-center text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}
        onContextMenu={onBlankContextMenu}
      >
        {tr.noFiles}
      </div>
    );
  }

  const actionTr = {
    editFile: tr.editFile,
    renameItem: tr.renameItem,
    cut: tr.cut,
    copy: tr.copy,
    deleteItem: tr.deleteItem,
    downloadFile: tr.downloadFile,
    addBookmark: tr.addBookmark,
    removeBookmark: tr.removeBookmark,
  };

  return (
    <div
      className="overflow-auto h-full min-h-full"
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest('[data-fm-item]')) onBlankContextMenu(e);
      }}
    >
      <table className="w-full text-left text-xs border-collapse">
        <thead className={cn('sticky top-0 z-10', isDark ? 'bg-slate-950/95 text-slate-400' : 'bg-slate-50 text-slate-500')}>
          <tr className="border-b border-inherit">
            <th className="w-10 p-2">
              <button type="button" onClick={onSelectAll} className="p-1 rounded hover:bg-black/5">
                {selectedPaths.length === files.length && files.length > 0 ? (
                  <Icons.CheckSquare className="h-4 w-4 text-blue-500" />
                ) : (
                  <Icons.Square className="h-4 w-4" />
                )}
              </button>
            </th>
            <th className="p-2"><SortBtn label={tr.name} active={sortKey === 'name'} asc={sortAsc} isDark={isDark} onClick={() => onSort('name')} /></th>
            <th className="p-2 w-24"><SortBtn label={tr.size} active={sortKey === 'size'} asc={sortAsc} isDark={isDark} onClick={() => onSort('size')} /></th>
            <th className="p-2 w-40 hidden sm:table-cell"><SortBtn label={tr.dateModified} active={sortKey === 'modified'} asc={sortAsc} isDark={isDark} onClick={() => onSort('modified')} /></th>
            <th className="p-2 text-center hidden lg:table-cell">{tr.actions}</th>
          </tr>
        </thead>
        <tbody className={cn('divide-y', isDark ? 'divide-slate-800/60' : 'divide-slate-100')}>
          {files.map((item) => {
            const selected = selectedPaths.includes(item.path);
            return (
              <tr
                key={item.path}
                data-fm-item
                onDoubleClick={() => onOpen(item)}
                onClick={(e) => onToggleSelect(item.path, e.ctrlKey || e.metaKey)}
                onContextMenu={(e) => onItemContextMenu(e, item)}
                className={cn(
                  'cursor-pointer transition',
                  selected
                    ? isDark
                      ? 'bg-blue-950/25'
                      : 'bg-blue-50'
                    : isDark
                      ? 'hover:bg-slate-800/30'
                      : 'hover:bg-slate-50',
                )}
              >
                <td className="p-2" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => onToggleSelect(item.path, true)}>
                    {selected ? <Icons.CheckSquare className="h-4 w-4 text-blue-500" /> : <Icons.Square className="h-4 w-4 text-slate-400" />}
                  </button>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-2 min-w-0 font-semibold">
                    {item.is_dir ? <Icons.Folder className="h-4 w-4 shrink-0 text-sky-400" /> : <Icons.File className="h-4 w-4 shrink-0 text-slate-400" />}
                    <span className="truncate">{item.name}</span>
                  </div>
                </td>
                <td className={cn('p-2 font-mono', isDark ? 'text-slate-500' : 'text-slate-400')}>{item.is_dir ? '—' : formatSize(item.size)}</td>
                <td className={cn('p-2 hidden sm:table-cell', isDark ? 'text-slate-500' : 'text-slate-400')}>{formatDate(item.modified)}</td>
                <td className="p-2 hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                  <FileActionsBar
                    item={item}
                    isDark={isDark}
                    compact
                    tr={actionTr}
                    bookmarked={bookmarkPathSet.has(item.path)}
                    bookmarksUiEnabled={bookmarksUiEnabled}
                    onEdit={() => onEdit(item)}
                    onDownload={() => onDownload(item)}
                    onRename={() => onRename(item)}
                    onBookmarkToggle={() => onBookmarkToggle(item)}
                    onCut={() => onCut(item)}
                    onCopy={() => onCopy(item)}
                    onDelete={() => onDelete(item)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
