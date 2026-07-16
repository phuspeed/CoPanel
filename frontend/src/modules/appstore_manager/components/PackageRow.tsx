import * as Icons from 'lucide-react';
import { accentForPackageId } from '../../../core/appStoreAccent';
import { cn } from '../../../lib/utils';
import type { AppStoreTranslations } from '../i18n';
import type { Package } from '../types';
import CatalogIcon from './CatalogIcon';

interface Props {
  pkg: Package;
  isDark: boolean;
  language: 'en' | 'vi';
  tr: AppStoreTranslations;
  isInstalling: boolean;
  isUninstalling: boolean;
  actionsDisabled: boolean;
  onInstall: (pkg: Package) => void;
  onUninstall: (pkg: Package) => void;
  onOpen?: (pkg: Package) => void;
  canOpen: boolean;
}

/** Marketplace-style package card (DevEcho grid) */
export default function PackageRow({
  pkg,
  isDark,
  language,
  tr,
  isInstalling,
  isUninstalling,
  actionsDisabled,
  onInstall,
  onUninstall,
  onOpen,
  canOpen,
}: Props) {
  const accent = accentForPackageId(pkg.id);
  const showChangelog = !!(pkg.changelog_en || pkg.changelog_vi);

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-3 rounded-xl border p-4 transition-colors',
        isDark
          ? 'border-slate-800/80 bg-slate-900/40 hover:border-slate-600'
          : 'border-slate-200 bg-white shadow-sm hover:border-slate-300',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1',
            isDark ? accent.dark : accent.light,
            isDark ? 'ring-white/10' : 'ring-black/5',
          )}
        >
          <CatalogIcon iconName={pkg.icon} className="h-5 w-5 text-white drop-shadow" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{pkg.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {pkg.is_core && <Badge isDark={isDark} tone="emerald">{language === 'vi' ? 'Mặc định' : 'Core'}</Badge>}
            {pkg.is_community && <Badge isDark={isDark} tone="cyan">{language === 'vi' ? 'Cộng đồng' : 'Community'}</Badge>}
            {pkg.update_status && <StatusBadge pkg={pkg} isDark={isDark} tr={tr} />}
          </div>
        </div>
      </div>

      <p className={cn('line-clamp-2 flex-1 text-xs leading-relaxed', isDark ? 'text-slate-400' : 'text-slate-600')}>
        {pkg.description}
      </p>

      <p className={cn('font-mono text-[10px]', isDark ? 'text-slate-500' : 'text-slate-500')}>
        {tr.versionOnServer(pkg.remote_version || pkg.version)}
        {pkg.installed && pkg.local_version && (
          <span className={isDark ? 'text-sky-400' : 'text-sky-600'}> · {tr.versionInstalled(pkg.local_version)}</span>
        )}
      </p>

      {showChangelog && (
        <details className={cn('text-[11px]', isDark ? 'text-slate-400' : 'text-slate-600')}>
          <summary className="cursor-pointer font-semibold">{tr.changelogReleaseNotes}</summary>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap italic">
            {language === 'vi' ? pkg.changelog_vi || pkg.changelog_en : pkg.changelog_en || pkg.changelog_vi}
          </p>
        </details>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {canOpen && pkg.installed && onOpen && (
          <ActionBtn variant="open" isDark={isDark} disabled={actionsDisabled} onClick={() => onOpen(pkg)}>
            <Icons.ExternalLink className="h-3.5 w-3.5" />
            {tr.btnOpen}
          </ActionBtn>
        )}
        {!pkg.installed ? (
          <ActionBtn variant="primary" isDark={isDark} disabled={actionsDisabled || isInstalling} onClick={() => onInstall(pkg)}>
            {isInstalling ? <Icons.Loader className="h-3.5 w-3.5 animate-spin" /> : <Icons.Download className="h-3.5 w-3.5" />}
            {isInstalling ? tr.btnInstalling : tr.btnInstall}
          </ActionBtn>
        ) : (
          <>
            {pkg.has_update && (
              <ActionBtn variant="update" isDark={isDark} disabled={actionsDisabled || isInstalling} onClick={() => onInstall(pkg)}>
                {isInstalling ? <Icons.Loader className="h-3.5 w-3.5 animate-spin" /> : <Icons.ArrowUpCircle className="h-3.5 w-3.5" />}
                {isInstalling ? tr.btnInstalling : tr.btnUpdate}
              </ActionBtn>
            )}
            {pkg.is_core ? (
              <ActionBtn variant="secondary" isDark={isDark} disabled={actionsDisabled || isInstalling} onClick={() => onInstall(pkg)}>
                <Icons.RotateCw className="h-3.5 w-3.5" />
                {isInstalling ? tr.btnInstalling : tr.btnReinstall}
              </ActionBtn>
            ) : (
              <>
                <ActionBtn variant="secondary" isDark={isDark} disabled={actionsDisabled || isInstalling} onClick={() => onInstall(pkg)}>
                  <Icons.RotateCw className="h-3.5 w-3.5" />
                  {isInstalling ? tr.btnInstalling : tr.btnReinstall}
                </ActionBtn>
                <ActionBtn variant="danger" isDark={isDark} disabled={actionsDisabled || isUninstalling} onClick={() => onUninstall(pkg)}>
                  {isUninstalling ? <Icons.Loader className="h-3.5 w-3.5 animate-spin" /> : <Icons.Trash2 className="h-3.5 w-3.5" />}
                  {isUninstalling ? tr.btnUninstalling : tr.btnUninstall}
                </ActionBtn>
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function Badge({ children, isDark, tone }: { children: React.ReactNode; isDark: boolean; tone: 'emerald' | 'cyan' }) {
  const cls =
    tone === 'emerald'
      ? isDark
        ? 'bg-emerald-950/40 text-emerald-400 ring-emerald-900/50'
        : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : isDark
        ? 'bg-cyan-950/40 text-cyan-400 ring-cyan-900/50'
        : 'bg-cyan-50 text-cyan-800 ring-cyan-200';
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', cls)}>{children}</span>;
}

function StatusBadge({ pkg, isDark, tr }: { pkg: Package; isDark: boolean; tr: AppStoreTranslations }) {
  const label =
    pkg.update_status === 'not_installed'
      ? tr.statusNotInstalled
      : pkg.update_status === 'up_to_date'
        ? tr.statusUpToDate
        : pkg.update_status === 'update_available'
          ? tr.statusUpdateAvailable
          : pkg.update_status === 'ahead'
            ? tr.statusAhead
            : null;
  if (!label) return null;
  return <Badge isDark={isDark} tone="cyan">{label}</Badge>;
}

function ActionBtn({
  children,
  onClick,
  disabled,
  isDark,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  isDark: boolean;
  variant: 'primary' | 'secondary' | 'danger' | 'update' | 'open';
}) {
  const base =
    'inline-flex flex-1 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition disabled:opacity-50';
  const variants = {
    primary: 'bg-sky-600 text-white hover:bg-sky-500',
    update: 'bg-amber-500 text-white hover:bg-amber-400',
    open: isDark
      ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
      : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
    secondary: isDark
      ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
      : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
    danger: isDark
      ? 'border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-950/50'
      : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn(base, variants[variant])}>
      {children}
    </button>
  );
}
