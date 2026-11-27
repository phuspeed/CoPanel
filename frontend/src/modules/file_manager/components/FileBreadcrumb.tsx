import { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pathBreadcrumbs } from '../utils';
import type { FileManagerTranslations } from '../i18n';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  currentPath: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  /** Navigate to typed text; resolves true on success. */
  onNavigateTyped?: (input: string) => Promise<boolean>;
  /** Bump to switch into the editable path field (Ctrl+L). */
  editSignal?: number;
  /** Drop handlers so crumbs act as move/copy targets. */
  onCrumbDragOver?: (e: React.DragEvent, path: string) => boolean;
  onCrumbDrop?: (e: React.DragEvent, path: string) => void;
}

export default function FileBreadcrumb({ isDark, tr, currentPath, canGoBack, canGoForward, onBack, onForward, onUp, onRefresh, onNavigate, onNavigateTyped, editSignal, onCrumbDragOver, onCrumbDrop }: Props) {
  const crumbs = pathBreadcrumbs(currentPath);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [dropPath, setDropPath] = useState<string | null>(null);

  const startEditing = () => {
    if (!onNavigateTyped) return;
    setDraft(currentPath || '/');
    setEditing(true);
  };
  const cancelEditing = () => {
    if (submittingRef.current) return;
    setEditing(false);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (editSignal && onNavigateTyped) {
      setDraft(currentPath || '/');
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal]);

  // Leave edit mode when the folder changes from elsewhere (sidebar, back, …).
  useEffect(() => {
    if (!submittingRef.current) setEditing(false);
  }, [currentPath]);

  const submit = async () => {
    if (!onNavigateTyped || submittingRef.current) return;
    const value = draft.trim();
    if (!value) {
      setEditing(false);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    let ok = false;
    try {
      ok = await onNavigateTyped(value);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (ok) {
      setEditing(false);
    } else if (inputRef.current) {
      // Stay in the current folder; keep the text so it can be corrected.
      inputRef.current.focus();
      inputRef.current.select();
    }
  };

  const btn = cn(
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-30',
    isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100',
  );

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-1">
      <button type="button" className={btn} onClick={onBack} disabled={!canGoBack} title={`${tr.back} (Alt+←)`}>
        <Icons.ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" className={cn(btn, 'hidden sm:flex')} onClick={onForward} disabled={!canGoForward} title={`${tr.forward} (Alt+→)`}>
        <Icons.ChevronRight className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={onUp} title={`${tr.up} (Alt+↑)`}>
        <Icons.ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={cn(btn, 'hidden sm:flex')} onClick={onRefresh} title={`${tr.refresh} (F5)`}>
        <Icons.RefreshCw className="h-4 w-4" />
      </button>
      {editing ? (
        <form
          className="ml-1 flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelEditing();
              }
            }}
            onBlur={cancelEditing}
            readOnly={submitting}
            aria-busy={submitting}
            spellCheck={false}
            autoComplete="off"
            aria-label={tr.editPath}
            title={tr.pathInputHint}
            placeholder={tr.pathInputHint}
            className={cn(
              'h-8 w-full min-w-0 rounded-lg border px-2 text-xs font-mono outline-none ring-2',
              isDark
                ? 'border-sky-600 bg-slate-950/70 text-slate-100 ring-sky-500/30 placeholder:text-slate-600'
                : 'border-blue-500 bg-white text-slate-800 ring-blue-500/20 placeholder:text-slate-400',
            )}
          />
        </form>
      ) : (
      <div
        className={cn(
          'ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border px-2 py-1 text-xs font-mono',
          onNavigateTyped && 'cursor-text',
          isDark ? 'border-slate-700 bg-slate-950/50 text-slate-300' : 'border-slate-200 bg-white text-slate-700',
        )}
        title={onNavigateTyped ? tr.editPath : undefined}
        onClick={(e) => {
          // Clicking empty space (not a crumb button) switches to text input.
          if (e.target === e.currentTarget) startEditing();
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          startEditing();
        }}
      >
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center shrink-0">
            {i > 0 && crumbs[i - 1].path !== '/' && <span className={cn('mx-1', isDark ? 'text-slate-600' : 'text-slate-300')}>/</span>}
            <button
              type="button"
              data-fm-crumb={c.path}
              onClick={() => onNavigate(c.path)}
              onDragOver={(e) => {
                if (onCrumbDragOver?.(e, c.path)) setDropPath(c.path);
              }}
              onDragLeave={() => setDropPath((d) => (d === c.path ? null : d))}
              onDrop={(e) => {
                setDropPath(null);
                onCrumbDrop?.(e, c.path);
              }}
              className={cn(
                'rounded px-1 py-0.5 transition hover:underline',
                dropPath === c.path && (isDark ? 'bg-sky-500/20 ring-1 ring-sky-500' : 'bg-blue-50 ring-1 ring-blue-500'),
                i === crumbs.length - 1
                  ? isDark
                    ? 'text-sky-300 font-bold'
                    : 'text-blue-600 font-bold'
                  : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {c.label}
            </button>
          </span>
        ))}
        {onNavigateTyped && (
          <button
            type="button"
            onClick={startEditing}
            title={tr.editPath}
            aria-label={tr.editPath}
            className={cn(
              'ml-auto shrink-0 rounded p-1 transition',
              isDark ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <Icons.Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      )}
    </div>
  );
}
