import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import WindowModal from '../../../core/shell/WindowModal';
import type { FileManagerState } from '../hooks/useFileManager';

/** "Items already exist" prompt: Replace / Skip / Keep both (rename) / Cancel. */
export default function ConflictDialog({ fm }: { fm: FileManagerState }) {
  const { isDark, tr, conflict, resolveConflict } = fm;
  if (!conflict) return null;
  const shown = conflict.names.slice(0, 6);
  const more = conflict.names.length - shown.length;
  const choice = cn(
    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
    isDark ? 'border-slate-700 hover:border-sky-500/60 hover:bg-slate-800/60' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/60',
  );
  return (
    <WindowModal open onClose={() => resolveConflict(null)} title={tr.conflictTitle} maxWidth="md">
      <div className="space-y-3 p-4 text-xs" data-testid="fm-conflict">
        <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>{tr.conflictBody(conflict.names.length, conflict.targetDir)}</p>
        <ul className={cn('space-y-0.5 rounded-lg border px-3 py-2 font-mono text-[0.6875rem]', isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-100 bg-slate-50')}>
          {shown.map((n) => (
            <li key={n} className="truncate">
              {n}
            </li>
          ))}
          {more > 0 && <li className="opacity-60">+{more}</li>}
        </ul>
        <div className="space-y-2">
          <button type="button" autoFocus className={choice} onClick={() => resolveConflict('rename')} data-testid="fm-conflict-rename">
            <Icons.CopyPlus className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-semibold">{tr.conflictRename}</span>
          </button>
          <button type="button" className={choice} onClick={() => resolveConflict('skip')} data-testid="fm-conflict-skip">
            <Icons.SkipForward className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span className="font-semibold">{tr.conflictSkip}</span>
          </button>
          <button type="button" className={choice} onClick={() => resolveConflict('overwrite')} data-testid="fm-conflict-overwrite">
            <Icons.Replace className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <span className="block font-semibold">{tr.conflictOverwrite}</span>
              <span className="block text-[0.625rem] opacity-60">{tr.conflictFolderNote}</span>
            </span>
          </button>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => resolveConflict(null)}
            data-testid="fm-conflict-cancel"
            className={cn('rounded-xl px-3 py-2 font-bold', isDark ? 'bg-slate-800' : 'bg-slate-100')}
          >
            {tr.cancel}
          </button>
        </div>
      </div>
    </WindowModal>
  );
}
