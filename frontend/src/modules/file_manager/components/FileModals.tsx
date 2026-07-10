import { cn } from '../../../lib/utils';
import WindowModal from '../../../core/shell/WindowModal';
import type { FileManagerState } from '../hooks/useFileManager';

export default function FileModals({ fm }: { fm: FileManagerState }) {
  const {
    isDark,
    tr,
    createType,
    setCreateType,
    newItemName,
    setNewItemName,
    handleCreateItem,
    renamingItem,
    setRenamingItem,
    renameValue,
    setRenameValue,
    handleRename,
    editingFile,
    setEditingFile,
    fileContent,
    setFileContent,
    handleSaveFile,
    zipModalOpen,
    setZipModalOpen,
    zipArchiveName,
    setZipArchiveName,
    handleZip,
    extractModalOpen,
    setExtractModalOpen,
    extractTargetDir,
    setExtractTargetDir,
    handleExtract,
    chmodModalOpen,
    setChmodModalOpen,
    chmodValue,
    setChmodValue,
    handleChmod,
  } = fm;

  const inputClass = cn(
    'w-full rounded-xl border px-3 py-2 text-xs font-mono outline-none focus:border-blue-500',
    isDark ? 'border-slate-700 bg-slate-950/60 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-800',
  );

  return (
    <>
      <WindowModal open={!!createType} onClose={() => { setCreateType(null); setNewItemName(''); }} title={createType === 'file' ? tr.createTitleFile : tr.createTitleDir} maxWidth="sm">
        <div className="space-y-3 p-4">
          <input autoFocus value={newItemName} onChange={(e) => setNewItemName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleCreateItem()} className={inputClass} placeholder={createType === 'file' ? 'config.txt' : 'new-folder'} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setCreateType(null); setNewItemName(''); }} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" disabled={!newItemName} onClick={() => void handleCreateItem()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{tr.createButton}</button>
          </div>
        </div>
      </WindowModal>

      <WindowModal open={!!renamingItem} onClose={() => { setRenamingItem(null); setRenameValue(''); }} title={tr.renameTitle} maxWidth="sm">
        <div className="space-y-3 p-4">
          <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleRename()} className={inputClass} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setRenamingItem(null); setRenameValue(''); }} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" disabled={!renameValue || renameValue === renamingItem?.name} onClick={() => void handleRename()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{tr.renameButton}</button>
          </div>
        </div>
      </WindowModal>

      <WindowModal open={!!editingFile} onClose={() => setEditingFile(null)} title={`${tr.editing} ${editingFile?.split(/[\\/]/).pop()}`} maxWidth="2xl" className="!max-w-3xl h-[min(80vh,520px)]">
        <div className="flex h-full min-h-[320px] flex-col p-4">
          <textarea value={fileContent} onChange={(e) => setFileContent(e.target.value)} className={cn(inputClass, 'flex-1 resize-none font-mono')} spellCheck={false} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditingFile(null)} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" onClick={() => void handleSaveFile()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">{tr.saveChanges}</button>
          </div>
        </div>
      </WindowModal>

      <WindowModal open={zipModalOpen} onClose={() => { setZipModalOpen(false); setZipArchiveName(''); }} title={tr.zipTitle} maxWidth="sm">
        <div className="space-y-3 p-4">
          <input autoFocus value={zipArchiveName} onChange={(e) => setZipArchiveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleZip()} className={inputClass} placeholder="archive.zip" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setZipModalOpen(false); setZipArchiveName(''); }} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" disabled={!zipArchiveName} onClick={() => void handleZip()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{tr.zipButton}</button>
          </div>
        </div>
      </WindowModal>

      <WindowModal open={extractModalOpen} onClose={() => { setExtractModalOpen(false); setExtractTargetDir(''); }} title={tr.extractTitle} maxWidth="sm">
        <div className="space-y-3 p-4">
          <input autoFocus value={extractTargetDir} onChange={(e) => setExtractTargetDir(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleExtract()} className={inputClass} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setExtractModalOpen(false); setExtractTargetDir(''); }} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" disabled={!extractTargetDir} onClick={() => void handleExtract()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{tr.extractButton}</button>
          </div>
        </div>
      </WindowModal>

      <WindowModal open={chmodModalOpen} onClose={() => { setChmodModalOpen(false); setChmodValue('755'); }} title={tr.chmodTitle} maxWidth="sm">
        <div className="space-y-3 p-4">
          <input autoFocus value={chmodValue} onChange={(e) => setChmodValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleChmod()} className={inputClass} placeholder="755" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setChmodModalOpen(false); setChmodValue('755'); }} className={cn('rounded-xl px-3 py-2 text-xs font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}>{tr.cancel}</button>
            <button type="button" disabled={!chmodValue} onClick={() => void handleChmod()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{tr.chmodButton}</button>
          </div>
        </div>
      </WindowModal>
    </>
  );
}
