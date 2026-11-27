import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileManagerState } from '../hooks/useFileManager';
import DropdownMenu, { type DropdownItem } from './DropdownMenu';
import { isZipName } from '../utils';

/** Explorer-style command bar: New / Upload menus, clipboard + item actions, Sort / View, overflow. */
export default function FileCommandBar({ fm, onUploadPicker }: { fm: FileManagerState; onUploadPicker: (kind: 'files' | 'folder') => void }) {
  const {
    isDark,
    tr,
    selectedPaths,
    selectedItems,
    clipboard,
    viewMode,
    setViewMode,
    sortKey,
    sortAsc,
    setSortKey,
    setSortAsc,
  } = fm;
  const n = selectedPaths.length;
  const single = n === 1 ? selectedItems[0] : undefined;
  const hasZip = selectedItems.some((i) => !i.is_dir && isZipName(i.name));

  const btn = cn(
    'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35',
    isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100',
  );
  const primary = cn(
    'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition',
    isDark ? 'bg-sky-600/90 text-white hover:bg-sky-500' : 'bg-blue-600 text-white hover:bg-blue-500',
  );
  const sep = <span className={cn('mx-0.5 h-5 w-px shrink-0', isDark ? 'bg-slate-700' : 'bg-slate-200')} />;
  const ic = 'h-4 w-4';

  const newItems: DropdownItem[] = [
    { id: 'folder', label: tr.createDir, icon: <Icons.FolderPlus className="h-3.5 w-3.5" />, hint: 'Ctrl+Shift+N', onClick: () => fm.setCreateType('dir') },
    { id: 'file', label: tr.createFile, icon: <Icons.FilePlus className="h-3.5 w-3.5" />, onClick: () => fm.setCreateType('file') },
  ];
  const uploadItems: DropdownItem[] = [
    { id: 'files', label: tr.uploadFiles, icon: <Icons.FileUp className="h-3.5 w-3.5" />, onClick: () => onUploadPicker('files') },
    { id: 'folder', label: tr.uploadFolder, icon: <Icons.FolderUp className="h-3.5 w-3.5" />, onClick: () => onUploadPicker('folder') },
  ];
  const sortItems: DropdownItem[] = [
    { id: 'name', label: tr.name, checked: sortKey === 'name', onClick: () => setSortKey('name') },
    { id: 'size', label: tr.size, checked: sortKey === 'size', onClick: () => setSortKey('size') },
    { id: 'modified', label: tr.dateModified, checked: sortKey === 'modified', onClick: () => setSortKey('modified') },
    { id: 'asc', label: tr.ascending, checked: sortAsc, separatorBefore: true, onClick: () => setSortAsc(true) },
    { id: 'desc', label: tr.descending, checked: !sortAsc, onClick: () => setSortAsc(false) },
  ];
  const viewItems: DropdownItem[] = [
    { id: 'list', label: tr.listView, icon: <Icons.List className="h-3.5 w-3.5" />, checked: viewMode === 'list', onClick: () => setViewMode('list') },
    { id: 'grid', label: tr.gridView, icon: <Icons.LayoutGrid className="h-3.5 w-3.5" />, checked: viewMode === 'grid', onClick: () => setViewMode('grid') },
  ];
  const moreItems: DropdownItem[] = [
    { id: 'copy-path', label: tr.copyPath, icon: <Icons.Link className="h-3.5 w-3.5" />, onClick: () => void fm.copyPaths() },
    { id: 'zip', label: tr.zipTitle, icon: <Icons.Archive className="h-3.5 w-3.5" />, disabled: n === 0, onClick: fm.openZip },
    { id: 'extract', label: tr.extractTitle, icon: <Icons.PackageOpen className="h-3.5 w-3.5" />, disabled: !hasZip, onClick: fm.openExtract },
    { id: 'chmod', label: tr.chmodTitle, icon: <Icons.Shield className="h-3.5 w-3.5" />, disabled: n === 0, onClick: fm.openChmod },
    {
      id: 'bookmark',
      label: n > 0 ? tr.bookmarkSelection : tr.bookmarkFolder,
      icon: <Icons.Bookmark className="h-3.5 w-3.5" />,
      disabled: fm.bookmarkBackendMissing,
      onClick: () => void (n > 0 ? fm.bookmarkSelection() : fm.bookmarkCurrentDirectory()),
    },
    { id: 'select-all', label: tr.selectAllTitle, icon: <Icons.CheckSquare className="h-3.5 w-3.5" />, hint: 'Ctrl+A', separatorBefore: true, onClick: fm.selectAll },
    { id: 'deselect', label: tr.deselect, icon: <Icons.X className="h-3.5 w-3.5" />, disabled: n === 0, hint: 'Esc', onClick: fm.clearSelection },
  ];

  return (
    <div
      data-testid="fm-command-bar"
      className={cn(
        'flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]',
        isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-slate-50/80',
      )}
    >
      <DropdownMenu isDark={isDark} label={tr.newMenu} icon={<Icons.Plus className={ic} />} items={newItems} compactLabel buttonClassName={primary} testId="fm-new" />
      <DropdownMenu isDark={isDark} label={tr.uploadMenu} icon={<Icons.Upload className={ic} />} items={uploadItems} compactLabel buttonClassName={btn} testId="fm-upload" />
      {sep}
      <button type="button" className={btn} disabled={n === 0} onClick={() => fm.handleCut()} title={`${tr.cut} (Ctrl+X)`} data-testid="fm-cut">
        <Icons.Scissors className={ic} />
      </button>
      <button type="button" className={btn} disabled={n === 0} onClick={() => fm.handleCopy()} title={`${tr.copy} (Ctrl+C)`} data-testid="fm-copy">
        <Icons.Copy className={ic} />
      </button>
      <button type="button" className={btn} disabled={!clipboard} onClick={() => void fm.handlePaste()} title={`${tr.paste} (Ctrl+V)`} data-testid="fm-paste">
        <Icons.ClipboardPaste className={ic} />
        {clipboard && <span className="hidden md:inline">{tr.paste}</span>}
      </button>
      <button type="button" className={btn} disabled={!single} onClick={() => fm.startRename()} title={`${tr.renameItem} (F2)`} data-testid="fm-rename">
        <Icons.PencilLine className={ic} />
      </button>
      <button
        type="button"
        className={btn}
        disabled={!single || single.is_dir}
        onClick={() => single && void fm.handleDownloadFile(single)}
        title={tr.downloadFile}
        data-testid="fm-download"
      >
        <Icons.Download className={ic} />
      </button>
      <button
        type="button"
        className={cn(btn, n > 0 && (isDark ? 'text-red-300 hover:bg-red-950/40' : 'text-red-600 hover:bg-red-50'))}
        disabled={n === 0}
        onClick={() => void fm.handleDelete()}
        title={`${tr.deleteItem} (Del)`}
        data-testid="fm-delete"
      >
        <Icons.Trash2 className={ic} />
      </button>
      {sep}
      <DropdownMenu isDark={isDark} label={tr.more} icon={<Icons.MoreHorizontal className={ic} />} items={moreItems} compactLabel buttonClassName={btn} testId="fm-more" />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <DropdownMenu isDark={isDark} label={tr.sortMenu} icon={<Icons.ArrowUpDown className={ic} />} items={sortItems} compactLabel align="right" buttonClassName={btn} testId="fm-sort" />
        <DropdownMenu
          isDark={isDark}
          label={tr.viewMenu}
          icon={viewMode === 'grid' ? <Icons.LayoutGrid className={ic} /> : <Icons.List className={ic} />}
          items={viewItems}
          compactLabel
          align="right"
          buttonClassName={btn}
          testId="fm-view"
        />
      </div>
    </div>
  );
}
