import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileItem } from '../types';
import type { FileManagerTranslations } from '../i18n';

export interface FileContextMenuState {
  x: number;
  y: number;
  kind: 'item' | 'blank';
  item?: FileItem;
}

interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  menu: FileContextMenuState;
  isDark: boolean;
  tr: FileManagerTranslations;
  item?: FileItem;
  hasClipboard: boolean;
  bookmarksUiEnabled: boolean;
  bookmarked: boolean;
  selectionCount: number;
  hasZipSelection: boolean;
  onClose: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onRename: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onBookmarkToggle: () => void;
  onBookmarkSelection: () => void;
  onDeselect: () => void;
  onDelete: () => void;
  onZip: () => void;
  onExtract: () => void;
  onChmod: () => void;
  onCreateFile: () => void;
  onCreateDir: () => void;
  onRefresh: () => void;
}

function MenuRow({
  item,
  isDark,
  onSelect,
}: {
  item: MenuItem;
  isDark: boolean;
  onSelect: (item: MenuItem) => void;
}) {
  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={() => onSelect(item)}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition',
        item.disabled && 'cursor-not-allowed opacity-40',
        item.danger
          ? isDark
            ? 'text-red-300 hover:bg-red-950/40'
            : 'text-red-600 hover:bg-red-50'
          : isDark
            ? 'text-slate-200 hover:bg-slate-800'
            : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-80">{item.icon}</span>
      {item.label}
    </button>
  );
}

export default function FileContextMenu({
  menu,
  isDark,
  tr,
  item,
  hasClipboard,
  bookmarksUiEnabled,
  bookmarked,
  selectionCount,
  hasZipSelection,
  onClose,
  onOpen,
  onEdit,
  onDownload,
  onRename,
  onCut,
  onCopy,
  onPaste,
  onBookmarkToggle,
  onBookmarkSelection,
  onDeselect,
  onDelete,
  onZip,
  onExtract,
  onChmod,
  onCreateFile,
  onCreateDir,
  onRefresh,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    setPos({ x, y });
  }, [menu.x, menu.y, menu.kind]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const iconCls = 'h-3.5 w-3.5';

  const items: MenuItem[] =
    menu.kind === 'blank'
      ? [
          { id: 'new-file', label: tr.createFile, icon: <Icons.FilePlus className={iconCls} />, onClick: onCreateFile },
          { id: 'new-dir', label: tr.createDir, icon: <Icons.FolderPlus className={iconCls} />, onClick: onCreateDir },
          ...(hasClipboard
            ? [{ id: 'paste', label: tr.paste, icon: <Icons.ClipboardPaste className={iconCls} />, onClick: onPaste }]
            : []),
          { id: 'refresh', label: tr.refresh, icon: <Icons.RefreshCw className={iconCls} />, onClick: onRefresh },
        ]
      : [
          { id: 'open', label: tr.go, icon: <Icons.FolderOpen className={iconCls} />, onClick: onOpen },
          ...(!item?.is_dir
            ? [
                { id: 'edit', label: tr.editFile, icon: <Icons.FileEdit className={iconCls} />, onClick: onEdit },
                { id: 'download', label: tr.downloadFile, icon: <Icons.Download className={iconCls} />, onClick: onDownload },
              ]
            : []),
          { id: 'rename', label: tr.renameItem, icon: <Icons.PencilLine className={iconCls} />, onClick: onRename },
          { id: 'cut', label: tr.cut, icon: <Icons.Scissors className={iconCls} />, onClick: onCut },
          { id: 'copy', label: tr.copy, icon: <Icons.Copy className={iconCls} />, onClick: onCopy },
          ...(hasClipboard
            ? [{ id: 'paste', label: tr.paste, icon: <Icons.ClipboardPaste className={iconCls} />, onClick: onPaste }]
            : []),
          ...(bookmarksUiEnabled
            ? [
                {
                  id: 'bookmark',
                  label: bookmarked ? tr.removeBookmark : tr.addBookmark,
                  icon: <Icons.Bookmark className={cn(iconCls, bookmarked && 'fill-current')} />,
                  onClick: onBookmarkToggle,
                },
                ...(selectionCount > 0
                  ? [
                      {
                        id: 'bookmark-selection',
                        label: tr.bookmarkSelection,
                        icon: <Icons.BookmarkPlus className={iconCls} />,
                        onClick: onBookmarkSelection,
                      },
                    ]
                  : []),
              ]
            : []),
          ...(selectionCount > 0
            ? [
                { id: 'zip', label: tr.zipLabelShort, icon: <Icons.Archive className={iconCls} />, onClick: onZip },
                ...(hasZipSelection
                  ? [{ id: 'extract', label: tr.extractButton, icon: <Icons.PackageOpen className={iconCls} />, onClick: onExtract }]
                  : []),
                { id: 'chmod', label: tr.chmodLabelShort, icon: <Icons.Shield className={iconCls} />, onClick: onChmod },
              ]
            : []),
          ...(selectionCount > 0
            ? [{ id: 'deselect', label: tr.deselect, icon: <Icons.X className={iconCls} />, onClick: onDeselect }]
            : []),
          { id: 'delete', label: tr.deleteItem, icon: <Icons.Trash2 className={iconCls} />, onClick: onDelete, danger: true },
        ];

  const handleSelect = (row: MenuItem) => {
    if (row.disabled) return;
    onClose();
    row.onClick();
  };

  return (
    <>
      <button type="button" className="fixed inset-0 z-[60] cursor-default" aria-label={tr.cancel} onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        className={cn(
          'fixed z-[61] min-w-[196px] overflow-hidden rounded-xl border py-1 shadow-xl',
          isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white',
        )}
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((row, idx) => {
          const prev = items[idx - 1];
          const showSep = row.danger && prev && !prev.danger;
          return (
            <div key={row.id}>
              {showSep && <div className={cn('my-1 h-px', isDark ? 'bg-slate-800' : 'bg-slate-100')} />}
              <MenuRow item={row} isDark={isDark} onSelect={handleSelect} />
            </div>
          );
        })}
      </div>
    </>
  );
}
