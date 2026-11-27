import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onClick: () => void;
}

interface Props {
  isDark: boolean;
  label: string;
  icon: ReactNode;
  items: DropdownItem[];
  /** Hide the text label below this breakpoint (icon-only). */
  compactLabel?: boolean;
  align?: 'left' | 'right';
  buttonClassName?: string;
  testId?: string;
}

/** Small dropdown used by the command bar (New, Upload, Sort, View, More). */
export default function DropdownMenu({ isDark, label, icon, items, compactLabel, align = 'left', buttonClassName, testId }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos(align === 'right' ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 4, left: Math.max(8, r.left) });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    const onScroll = () => setOpen(false);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={toggle}
        className={cn(buttonClassName, open && (isDark ? 'bg-slate-700' : 'bg-slate-100'))}
      >
        {icon}
        <span className={cn(compactLabel && 'hidden sm:inline')}>{label}</span>
        <Icons.ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          style={pos}
          className={cn(
            'fixed z-[70] min-w-[190px] overflow-hidden rounded-xl border py-1 shadow-xl',
            isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white',
          )}
        >
          {items.map((it) => (
            <div key={it.id}>
              {it.separatorBefore && <div className={cn('my-1 h-px', isDark ? 'bg-slate-800' : 'bg-slate-100')} />}
              <button
                type="button"
                role="menuitem"
                data-testid={testId ? `${testId}-${it.id}` : undefined}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                  it.danger
                    ? isDark
                      ? 'text-red-300 hover:bg-red-950/40'
                      : 'text-red-600 hover:bg-red-50'
                    : isDark
                      ? 'text-slate-200 hover:bg-slate-800'
                      : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-80">
                  {it.checked ? <Icons.Check className="h-3.5 w-3.5" /> : it.icon}
                </span>
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[0.625rem] font-mono opacity-50">{it.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
