import * as Icons from 'lucide-react';
import { accentForPackageId } from '../../../core/appStoreAccent';
import { cn } from '../../../lib/utils';
import type { AppStoreTranslations } from '../i18n';
import type { Package } from '../types';
import { requiredPackageMap } from '../utils';
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
        'flex flex-col gap-3 rounded-2xl border p-4 transition-colors sm:flex-row sm:items-center',
        isDark ? 'border-slate-800/80 bg-slate-900/30 hover:border-slate-700' : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm',
      )}
    >
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-2',
          isDark ? accent.dark : accent.light,
        )}
      >
        <CatalogIcon iconName={pkg.icon} className="h-6 w-6 text-white drop-shadow" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn('truncate text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{pkg.name}</h3>
          {pkg.is_core && <Badge isDark={isDark} tone="emerald">{language === 'vi' ? 'Mặc định' : 'Core'}</Badge>}
          {pkg.is_community && <Badge isDark={isDark} tone="cyan">{language === 'vi' ? 'Cộng đồng' : 'Community'}</Badge>}
          {pkg.update_status && <StatusBadge pkg={pkg} isDark={isDark} tr={tr} />}
        </div>
        <p className={cn('line-clamp-2 text-xs leading-relaxed', isDark ? 'text-slate-400' : 'text-slate-600')}>{pkg.description}</p>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className={cn('font-mono', isDark ? 'text-slate-500' : 'text-slate-500')}>
            {tr.versionOnServer(pkg.remote_version || pkg.version)}
          </span>
          {pkg.installed && pkg.local_version && (
            <span className={cn('font-mono', isDark ? 'text-blue-400' : 'text-blue-600')}>
              · {tr.versionInstalled(pkg.local_version)}
            </span>
          )}
        </div>
        {((pkg.system_packages && pkg.system_packages.length > 0) || requiredPackageMap[pkg.id]) && (
          <p className={cn('flex items-center gap-1 text-[10px]', isDark ? 'text-slate-500' : 'text-slate-500')}>
            <Icons.Server className="h-3 w-3" />
            {pkg.system_packages?.[0] || requiredPackageMap[pkg.id]?.name}
          </p>
        )}
        {showChangelog && (
          <details className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>
            <summary className="cursor-pointer font-semibold">{tr.changelogReleaseNotes}</summary>
            <p className="mt-1 whitespace-pre-wrap italic">
              {language === 'vi' ? pkg.changelog_vi || pkg.changelog_en : pkg.changelog_en || pkg.changelog_vi}
            </p>
          </details>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-stretch">
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
  const base = 'inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-50';
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500',
    update: 'bg-amber-500 text-white hover:bg-amber-400',
    open: isDark ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
    secondary: isDark ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
    danger: isDark ? 'border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-950/50' : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn(base, variants[variant])}>
      {children}
    </button>
  );
}
