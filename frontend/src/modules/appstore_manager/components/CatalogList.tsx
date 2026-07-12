import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AppStoreTranslations } from '../i18n';
import type { Package } from '../types';
import PackageRow from './PackageRow';

interface Props {
  packages: Package[];
  isDark: boolean;
  language: 'en' | 'vi';
  tr: AppStoreTranslations;
  installingId: string | null;
  uninstallingId: string | null;
  onInstall: (pkg: Package) => void;
  onUninstall: (pkg: Package) => void;
  onOpen?: (pkg: Package) => void;
  canOpenModule: (pkg: Package) => boolean;
  loading: boolean;
  actionsDisabled?: boolean;
}

export default function CatalogList({
  packages,
  isDark,
  language,
  tr,
  installingId,
  uninstallingId,
  onInstall,
  onUninstall,
  onOpen,
  canOpenModule,
  loading,
  actionsDisabled: actionsDisabledProp = false,
}: Props) {
  if (loading && packages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <div className="text-center">
          <Icons.Loader className="mx-auto mb-2 h-8 w-8 animate-spin text-blue-500" />
          <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.fetching}</p>
        </div>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <Icons.LayoutGrid className={cn('mb-3 h-10 w-10', isDark ? 'text-slate-600' : 'text-slate-300')} />
        <p className={cn('text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.noApps}</p>
      </div>
    );
  }

  const actionsDisabled = actionsDisabledProp || installingId !== null || uninstallingId !== null;

  return (
    <div className="space-y-2 p-4">
      {packages.map((pkg) => (
        <PackageRow
          key={pkg.id}
          pkg={pkg}
          isDark={isDark}
          language={language}
          tr={tr}
          isInstalling={installingId === pkg.id}
          isUninstalling={uninstallingId === pkg.id}
          actionsDisabled={actionsDisabled}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onOpen={onOpen}
          canOpen={canOpenModule(pkg)}
        />
      ))}
    </div>
  );
}
