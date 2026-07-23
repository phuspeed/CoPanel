import { QUICK_PROMPTS, type Lang } from '../i18n';
import { COPY } from '../i18n';

export default function QuickPrompts({
  language,
  disabled,
  onPick,
}: {
  language: Lang;
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  const t = COPY[language];
  const prompts = QUICK_PROMPTS[language];

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.quickTitle}</div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-violet-400"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
