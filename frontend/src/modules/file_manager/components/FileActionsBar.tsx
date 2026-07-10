import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileItem } from '../types';
import type { FileManagerTranslations } from '../i18n';

interface Props {
  item: FileItem;
  isDark: boolean;
  compact?: boolean;
  tr: Pick<
    FileManagerTranslations,
    'editFile' | 'renameItem' | 'cut' | 'copy' | 'deleteItem' | 'downloadFile' | 'addBookmark' | 'removeBookmark'
  >;
  bookmarked: boolean;
  bookmarksUiEnabled: boolean;
  onEdit: () => void;
  onDownload: () => void;
  onRename: () => void;
  onBookmarkToggle: () => void;
  onCut: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export default function FileActionsBar({
  item,
  isDark,
  compact,
  tr,
  bookmarked,
  bookmarksUiEnabled,
  onEdit,
  onDownload,
  onRename,
  onBookmarkToggle,
  onCut,
  onCopy,
  onDelete,
}: Props) {
  const pad = compact ? 'p-1' : 'p-1.5';
  const icon = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const shell = (extra: string) =>
    cn(pad, 'rounded-lg border transition flex items-center shrink-0', extra);

  return (
    <div className="flex items-center gap-1">
      {!item.is_dir && (
        <>
          <button type="button" onClick={onEdit} className={shell(isDark ? 'border-slate-700 text-blue-400 hover:bg-slate-800' : 'border-slate-200 text-blue-600 hover:bg-slate-100')} title={tr.editFile}>
            <Icons.FileEdit className={icon} />
          </button>
          <button type="button" onClick={onDownload} className={shell(isDark ? 'border-slate-700 text-emerald-400 hover:bg-slate-800' : 'border-slate-200 text-emerald-600 hover:bg-slate-100')} title={tr.downloadFile}>
            <Icons.Download className={icon} />
          </button>
        </>
      )}
      <button type="button" onClick={onRename} className={shell(isDark ? 'border-slate-700 text-violet-400 hover:bg-slate-800' : 'border-slate-200 text-violet-600 hover:bg-slate-100')} title={tr.renameItem}>
        <Icons.PencilLine className={icon} />
      </button>
      {bookmarksUiEnabled && (
        <button type="button" onClick={onBookmarkToggle} className={shell(bookmarked ? (isDark ? 'border-amber-700 text-amber-300 bg-amber-950/30' : 'border-amber-300 text-amber-700 bg-amber-50') : isDark ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-100')} title={bookmarked ? tr.removeBookmark : tr.addBookmark}>
          <Icons.Bookmark className={cn(icon, bookmarked && 'fill-current')} />
        </button>
      )}
      <button type="button" onClick={onCut} className={shell(isDark ? 'border-slate-700 text-amber-300 hover:bg-slate-800' : 'border-slate-200 text-amber-700 hover:bg-slate-100')} title={tr.cut}>
        <Icons.Scissors className={icon} />
      </button>
      <button type="button" onClick={onCopy} className={shell(isDark ? 'border-slate-700 text-indigo-300 hover:bg-slate-800' : 'border-slate-200 text-indigo-600 hover:bg-slate-100')} title={tr.copy}>
        <Icons.Copy className={icon} />
      </button>
      <button type="button" onClick={onDelete} className={shell(isDark ? 'border-red-900/60 text-red-300 hover:bg-red-950/40' : 'border-red-200 text-red-600 hover:bg-red-50')} title={tr.deleteItem}>
        <Icons.Trash2 className={icon} />
      </button>
    </div>
  );
}
