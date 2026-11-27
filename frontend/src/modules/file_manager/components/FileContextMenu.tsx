import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileManagerState } from '../hooks/useFileManager';
import type { ContextMenuRequest } from '../hooks/useItemInteractions';
import { isTextLike, isZipName, previewKind } from '../utils';

interface Row {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
}

interface Props {
  fm: FileManagerState;
  menu: ContextMenuRequest;
  onClose: () => void;
  onUploadPicker: (kind: 'files' | 'folder') => void;
}

export default function FileContextMenu({ fm, menu, onClose, onUploadPicker }: Props) {
  const { isDark, tr, clipboard, selectedPaths, selectedItems, bookmarkPathSet, bookmarkBackendMissing } = fm;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const item = menu.item;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu.x, menu.y, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const ic = 'h-3.5 w-3.5';
  const multi = selectedPaths.length > 1;
  const rows: Row[] = [];

  if (!item) {
    rows.push(
      { id: 'new-dir', label: tr.createDir, icon: <Icons.FolderPlus className={ic} />, hint: 'Ctrl+Shift+N', onClick: () => fm.setCreateType('dir') },
      { id: 'new-file', label: tr.createFile, icon: <Icons.FilePlus className={ic} />, onClick: () => fm.setCreateType('file') },
      { id: 'upload-files', label: tr.uploadFiles, icon: <Icons.FileUp className={ic} />, sep: true, onClick: () => onUploadPicker('files') },
      { id: 'upload-folder', label: tr.uploadFolder, icon: <Icons.FolderUp className={ic} />, onClick: () => onUploadPicker('folder') },
      { id: 'paste', label: tr.paste, icon: <Icons.ClipboardPaste className={ic} />, hint: 'Ctrl+V', sep: true, disabled: !clipboard, onClick: () => void fm.handlePaste() },
      { id: 'copy-path', label: tr.copyPath, icon: <Icons.Link className={ic} />, onClick: () => void fm.copyPaths([fm.currentPath]) },
      { id: 'select-all', label: tr.selectAllTitle, icon: <Icons.CheckSquare className={ic} />, hint: 'Ctrl+A', sep: true, onClick: fm.selectAll },
      { id: 'refresh', label: tr.refresh, icon: <Icons.RefreshCw className={ic} />, hint: 'F5', onClick: fm.refresh },
    );
  } else {
    const kind = previewKind(item.name);
    if (!multi) {
      rows.push({
        id: 'open',
        label: tr.openItem,
        icon: item.is_dir ? <Icons.FolderOpen className={ic} /> : <Icons.ExternalLink className={ic} />,
        hint: 'Enter',
        onClick: () => fm.handleOpenItem(item),
      });
      if (!item.is_dir && kind) rows.push({ id: 'preview', label: tr.previewItem, icon: <Icons.Eye className={ic} />, onClick: () => fm.setPreviewPath(item.path) });
      if (!item.is_dir && (isTextLike(item.name) || !kind))
        rows.push({ id: 'edit', label: tr.editFile, icon: <Icons.FileEdit className={ic} />, onClick: () => void fm.handleEditFile(item) });
      if (!item.is_dir) rows.push({ id: 'download', label: tr.downloadFile, icon: <Icons.Download className={ic} />, onClick: () => void fm.handleDownloadFile(item) });
    }
    rows.push(
      { id: 'cut', label: tr.cut, icon: <Icons.Scissors className={ic} />, hint: 'Ctrl+X', sep: rows.length > 0, onClick: () => fm.handleCut(multi ? undefined : item) },
      { id: 'copy', label: tr.copy, icon: <Icons.Copy className={ic} />, hint: 'Ctrl+C', onClick: () => fm.handleCopy(multi ? undefined : item) },
    );
    if (clipboard && item.is_dir && !multi)
      rows.push({ id: 'paste-into', label: tr.paste, icon: <Icons.ClipboardPaste className={ic} />, onClick: () => void fm.handlePaste(item.path) });
    rows.push({ id: 'copy-path', label: tr.copyPath, icon: <Icons.Link className={ic} />, onClick: () => void fm.copyPaths(multi ? selectedPaths : [item.path]) });
    if (!multi) rows.push({ id: 'rename', label: tr.renameItem, icon: <Icons.PencilLine className={ic} />, hint: 'F2', onClick: () => fm.startRename(item) });
    rows.push({ id: 'zip', label: tr.zipLabelShort, icon: <Icons.Archive className={ic} />, sep: true, onClick: fm.openZip });
    if (selectedItems.some((i) => !i.is_dir && isZipName(i.name)))
      rows.push({ id: 'extract', label: tr.extractButton, icon: <Icons.PackageOpen className={ic} />, onClick: fm.openExtract });
    rows.push({ id: 'chmod', label: tr.chmodLabelShort, icon: <Icons.Shield className={ic} />, onClick: fm.openChmod });
    if (!bookmarkBackendMissing) {
      const marked = bookmarkPathSet.has(item.path);
      rows.push(
        multi
          ? { id: 'bookmark', label: tr.bookmarkSelection, icon: <Icons.BookmarkPlus className={ic} />, onClick: () => void fm.bookmarkSelection() }
          : {
              id: 'bookmark',
              label: marked ? tr.removeBookmark : tr.addBookmark,
              icon: <Icons.Bookmark className={cn(ic, marked && 'fill-current')} />,
              onClick: () => void fm.toggleBookmarkForItem(item),
            },
      );
    }
    rows.push({
      id: 'delete',
      label: multi ? `${tr.deleteItem} (${selectedPaths.length})` : tr.deleteItem,
      icon: <Icons.Trash2 className={ic} />,
      hint: 'Del',
      danger: true,
      sep: true,
      onClick: () => void fm.handleDelete(multi ? undefined : item),
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onMouseDown={onClose}
        onTouchStart={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        data-testid="fm-context-menu"
        className={cn(
          'fixed z-[61] max-h-[80vh] min-w-[210px] overflow-y-auto rounded-xl border py-1 shadow-2xl',
          isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white',
        )}
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {rows.map((row) => (
          <div key={row.id}>
            {row.sep && <div className={cn('my-1 h-px', isDark ? 'bg-slate-800' : 'bg-slate-100')} />}
            <button
              type="button"
              role="menuitem"
              data-testid={`fm-ctx-${row.id}`}
              disabled={row.disabled}
              onClick={() => {
                onClose();
                row.onClick();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                row.danger
                  ? isDark
                    ? 'text-red-300 hover:bg-red-950/40'
                    : 'text-red-600 hover:bg-red-50'
                  : isDark
                    ? 'text-slate-200 hover:bg-slate-800'
                    : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-80">{row.icon}</span>
              <span className="flex-1">{row.label}</span>
              {row.hint && <span className="hidden pl-4 font-mono text-[0.625rem] opacity-50 sm:inline">{row.hint}</span>}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
