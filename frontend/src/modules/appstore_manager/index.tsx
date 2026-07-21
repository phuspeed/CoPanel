/**
 * AppStore Manager — Deepin-style store layout in desktop window (Phase 2).
 */
import { useEffect, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import { moduleRegistry } from '../../core/registry';
import { moduleSupportsWindows, openModuleWindow } from '../../core/shell/openModuleWindow';
import { cn } from '../../lib/utils';
import AppStoreHeader from './components/AppStoreHeader';
import AppStoreSidebar from './components/AppStoreSidebar';
import BuildProgressModal from './components/BuildProgressModal';
import CatalogList from './components/CatalogList';
import CategoryFilter from './components/CategoryFilter';
import CommunityConfigModal from './components/CommunityConfigModal';
import FeaturedBanner from './components/FeaturedBanner';
import { getAppStoreTranslations } from './i18n';
import type { Package, PackageCategory, StoreNav } from './types';
import {
  BATCH_UPDATE_TASK_ID,
  categoryForPackage,
  filterPackagesByNav,
  formatApiDetail,
  modulePathFromPackageId,
  pkgIdFromZipName,
} from './utils';
import { chromeContentBg } from '../../core/desktopChrome';

export default function AppStoreDashboard() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const lang = language === 'vi' ? 'vi' : 'en';
  const tr = getAppStoreTranslations(lang);

  const [catalog, setCatalog] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [activePkgId, setActivePkgId] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [buildProgress, setBuildProgress] = useState<number>(0);
  const [showBuildLogs, setShowBuildLogs] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [restartReason, setRestartReason] = useState<string | null>(null);
  const [restartUi, setRestartUi] = useState<'idle' | 'submitting' | 'waiting'>('idle');

  const [communityUrls, setCommunityUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const [nav, setNav] = useState<StoreNav>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PackageCategory | 'all'>('all');
  const [categoriesOpen, setCategoriesOpen] = useState(true);

  const token = localStorage.getItem('copanel_token');
  const selfModuleVersion = catalog.find((p) => p.id === 'appstore_manager')?.version;

  const resetBuildModal = () => {
    setActivePkgId(null);
    setBuildLogs([]);
    setBuildProgress(0);
    setRestartRequired(false);
    setRestartReason(null);
    setRestartUi('idle');
  };

  const handleBuildPollResult = (
    b: {
      status?: string;
      logs?: string[];
      progress?: number;
      error?: string;
      restart_required?: boolean;
      restart_scheduled?: boolean;
      restart_reason?: string | null;
    },
    successLabel: string,
    extensionInstall?: boolean,
  ) => {
    if (b.logs) setBuildLogs(b.logs);
    if (typeof b.progress === 'number') setBuildProgress(b.progress);
    if (b.status !== 'success' && b.status !== 'failed') return false;

    setBuildStatus(b.status);
    if (b.status === 'success') {
      fetchCatalog();
      if (b.restart_scheduled) {
        setRestartUi('waiting');
        setMsg(tr.restartAutoInProgress(successLabel));
        void (async () => {
          const back = await waitForCopanelHealth();
          if (back) {
            setMsg(tr.restartScheduled);
            window.setTimeout(() => window.location.reload(), 800);
          } else {
            setRestartUi('idle');
            setRestartRequired(true);
            setRestartReason(b.restart_reason ?? 'hot_reload_failed');
            setMsg(tr.restartTimedOut);
          }
        })();
      } else if (b.restart_required) {
        setRestartRequired(true);
        setRestartReason(b.restart_reason ?? null);
        setMsg(tr.installSuccessNeedsRestart(successLabel));
      } else {
        setMsg(
          extensionInstall
            ? tr.installSuccessExtension(successLabel)
            : tr.installSuccessBuilt(successLabel),
        );
        setTimeout(() => window.location.reload(), 1200);
      }
    } else {
      setMsg(`❌ Error building ${successLabel}: ${b.error || 'Build failed.'}`);
    }
    return true;
  };

  const waitForCopanelHealth = async (): Promise<boolean> => {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* restarting */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return false;
  };

  const handleRestartCopanel = async () => {
    setRestartUi('submitting');
    setMsg(null);
    try {
      const res = await fetch('/api/appstore_manager/restart-copanel', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setRestartUi('idle');
        setMsg(tr.restartFailed(formatApiDetail(body.detail) || 'Request failed'));
        return;
      }
      setRestartUi('waiting');
      const back = await waitForCopanelHealth();
      if (back) {
        setMsg(tr.restartScheduled);
        window.setTimeout(() => window.location.reload(), 800);
      } else {
        setRestartUi('idle');
        setMsg(tr.restartTimedOut);
      }
    } catch {
      setRestartUi('idle');
      setMsg(tr.commError);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/appstore_manager/config', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const d = await res.json();
        setCommunityUrls(Array.isArray(d.community_urls) ? d.community_urls : []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveConfig = async (urls: string[]) => {
    try {
      const res = await fetch('/api/appstore_manager/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ community_urls: urls }),
      });
      if (res.ok) {
        setMsg(tr.communitySaved);
        await fetchConfig();
        fetchCatalog();
      } else {
        let detail = '';
        try {
          const errBody = await res.json();
          detail = formatApiDetail(errBody.detail);
        } catch {
          detail = res.statusText;
        }
        setMsg(`${tr.communitySaveFailed}${detail ? ` (${detail})` : ''}`);
      }
    } catch (err) {
      console.error(err);
      setMsg(tr.communitySaveFailed);
    }
  };

  const fetchCatalog = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/appstore_manager/catalog', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const d = await res.json();
        if (d.data) setCatalog(d.data);
      } else {
        setMsg(tr.fetchError);
      }
    } catch {
      setMsg(tr.commError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchCatalog();
  }, [language]);

  useEffect(() => {
    if (isConfigOpen) void fetchConfig();
  }, [isConfigOpen]);

  const handleInstall = async (pkg: Package) => {
    setInstallingId(pkg.id);
    setActivePkgId(pkg.id);
    setBuildLogs(['Starting real-time build status tracking...']);
    setBuildStatus('running');
    setBuildProgress(5);
    setShowBuildLogs(false);
    setRestartRequired(false);
    setRestartReason(null);
    setMsg(tr.installing(pkg.name));
    try {
      const res = await fetch('/api/appstore_manager/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: pkg.id,
          download_url: pkg.download_url,
          version: pkg.version,
          system_packages: pkg.system_packages,
          pip_packages: pkg.pip_packages,
          frontend_install: pkg.frontend_install || 'rebuild',
          requires_copanel_restart: !!pkg.requires_copanel_restart,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(tr.installSuccess(pkg.name));
        const interval = setInterval(async () => {
          try {
            const r = await fetch(`/api/appstore_manager/build-status/${pkg.id}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (r.ok) {
              const b = await r.json();
              if (handleBuildPollResult(b, pkg.name, pkg.frontend_install === 'extension')) clearInterval(interval);
            }
          } catch (err) {
            console.error(err);
          }
        }, 1500);
      } else {
        setMsg(tr.installError(formatApiDetail(d.detail) || 'Extraction failed.'));
        setBuildStatus('failed');
      }
    } catch {
      setMsg(tr.commError);
      setBuildStatus('failed');
    } finally {
      setInstallingId(null);
    }
  };

  const handleUpdateAll = async () => {
    const updates = catalog.filter((p) => p.update_status === 'update_available' || p.has_update);
    if (updates.length === 0) return;

    const confirmMsg = tr.updateAllConfirm(updates.length);
    if (!window.confirm(confirmMsg)) return;

    setBatchUpdating(true);
    setActivePkgId(BATCH_UPDATE_TASK_ID);
    setBuildLogs(['Starting batch update — single frontend build at end...']);
    setBuildStatus('running');
    setBuildProgress(5);
    setShowBuildLogs(false);
    setRestartRequired(false);
    setRestartReason(null);
    setMsg(tr.btnUpdatingAll);

    try {
      const res = await fetch('/api/appstore_manager/install-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          packages: updates.map((pkg) => ({
            id: pkg.id,
            download_url: pkg.download_url,
            version: pkg.version,
            system_packages: pkg.system_packages,
            pip_packages: pkg.pip_packages,
            frontend_install: pkg.frontend_install || 'rebuild',
            requires_copanel_restart: !!pkg.requires_copanel_restart,
          })),
        }),
      });
      const d = await res.json();
      if (res.ok) {
        const interval = setInterval(async () => {
          try {
            const r = await fetch(`/api/appstore_manager/build-status/${BATCH_UPDATE_TASK_ID}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (r.ok) {
              const b = await r.json();
              if (b.logs) setBuildLogs(b.logs);
              if (typeof b.progress === 'number') setBuildProgress(b.progress);
              if (b.status !== 'success' && b.status !== 'failed') return;

              setBuildStatus(b.status);
              if (b.status === 'success') {
                fetchCatalog();
                if (b.restart_scheduled) {
                  setRestartUi('waiting');
                  setMsg(tr.restartAutoInProgress(`${updates.length} modules`));
                  const back = await waitForCopanelHealth();
                  if (back) {
                    setMsg(tr.restartScheduled);
                    window.setTimeout(() => window.location.reload(), 800);
                  } else {
                    setRestartUi('idle');
                    setRestartRequired(true);
                    setRestartReason(b.restart_reason ?? 'hot_reload_failed');
                    setMsg(tr.restartTimedOut);
                  }
                } else if (b.restart_required) {
                  setRestartRequired(true);
                  setRestartReason(b.restart_reason ?? null);
                  setMsg(tr.installSuccessNeedsRestart(`${updates.length} modules`));
                } else {
                  setMsg(tr.updateAllSuccess(updates.length));
                  setTimeout(() => window.location.reload(), 1200);
                }
              } else {
                setMsg(tr.updateAllError(b.error || 'Build failed.'));
              }
              clearInterval(interval);
              setBatchUpdating(false);
            }
          } catch (err) {
            console.error(err);
          }
        }, 1500);
      } else {
        setMsg(tr.updateAllError(formatApiDetail(d.detail) || 'Request failed.'));
        setBuildStatus('failed');
        setBatchUpdating(false);
      }
    } catch {
      setMsg(tr.commError);
      setBuildStatus('failed');
      setBatchUpdating(false);
    }
  };

  const handleUninstall = async (pkg: Package) => {
    setUninstallingId(pkg.id);
    setMsg(`Uninstalling ${pkg.name}...`);
    try {
      const res = await fetch('/api/appstore_manager/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: pkg.id }),
      });
      const d = await res.json();
      if (res.ok) {
        setMsg(d.status === 'partial' ? `⚠ ${d.message}` : `✓ ${d.message || `${pkg.name} removed.`}`);
        fetchCatalog();
        setTimeout(() => window.location.reload(), d.status === 'partial' ? 2500 : 1200);
      } else {
        setMsg(`❌ Error uninstalling: ${d.detail || 'Request failed.'}`);
      }
    } catch {
      setMsg(tr.commError);
    } finally {
      setUninstallingId(null);
    }
  };

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    if (!file.name.endsWith('.zip')) {
      alert(lang === 'vi' ? 'Chỉ hỗ trợ .zip!' : 'Only .zip files supported!');
      return;
    }

    const pkgId = pkgIdFromZipName(file.name);
    setActivePkgId(pkgId);
    setBuildLogs([`Uploading ${file.name}...`]);
    setBuildStatus('running');
    setBuildProgress(5);
    setShowBuildLogs(false);
    setMsg(lang === 'vi' ? 'Đang tải ZIP...' : 'Uploading zip...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      let res = await fetch('/api/appstore_manager/upload-install', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (res.status === 404) {
        const fd2 = new FormData();
        fd2.append('file', file);
        res = await fetch('/api/appstore_manager/upload_zip', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd2,
        });
      }
      const d = await res.json();
      if (res.ok) {
        const interval = setInterval(async () => {
          try {
            const r = await fetch(`/api/appstore_manager/build-status/${pkgId}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (r.ok) {
              const b = await r.json();
              if (handleBuildPollResult(b, file.name)) clearInterval(interval);
            }
          } catch (err) {
            console.error(err);
          }
        }, 1500);
      } else {
        const errText = formatApiDetail(d.detail) || 'Invalid ZIP.';
        setMsg(errText);
        setBuildStatus('failed');
        setBuildLogs((prev) => [...prev, `❌ ${errText}`]);
      }
    } catch {
      setMsg(tr.commError);
      setBuildStatus('failed');
    }
  };

  const canOpenModule = (pkg: Package) => {
    if (!pkg.installed) return false;
    const path = modulePathFromPackageId(pkg.id);
    return Boolean(moduleRegistry.getByPath(path));
  };

  const handleOpenModule = (pkg: Package) => {
    const path = modulePathFromPackageId(pkg.id);
    if (moduleSupportsWindows(path)) {
      openModuleWindow(path);
    } else {
      window.location.href = path;
    }
  };

  const updateCount = catalog.filter((p) => p.update_status === 'update_available' || p.has_update).length;
  const installedCount = catalog.filter((p) => p.installed).length;

  const featuredPackages = useMemo(() => {
    const hot = filterPackagesByNav(catalog, 'hot');
    return (hot.length ? hot : catalog.filter((p) => p.is_core)).slice(0, 4);
  }, [catalog]);

  const visiblePackages = useMemo(() => {
    let list = filterPackagesByNav(catalog, nav);
    if (nav === 'all' && category !== 'all') {
      list = list.filter((p) => categoryForPackage(p.id) === category);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [catalog, nav, category, query]);

  return (
    <ModuleViewport className="select-none">
    <ModuleSidebarLayout
      isDark={isDark}
      mobileTitle={tr.title}
      sidebar={
        <AppStoreSidebar
          active={nav}
          onChange={setNav}
          isDark={isDark}
          tr={tr}
          updateCount={updateCount}
          installedCount={installedCount}
        />
      }
    >
      <div className={cn('flex min-w-0 flex-1 flex-col', chromeContentBg(isDark))}>
        <AppStoreHeader
          query={query}
          onQueryChange={setQuery}
          onRefresh={fetchCatalog}
          onCommunity={() => setIsConfigOpen(true)}
          onUploadZip={handleUploadZip}
          onUpdateAll={() => void handleUpdateAll()}
          updateCount={updateCount}
          batchUpdating={batchUpdating}
          loading={loading}
          isDark={isDark}
          tr={tr}
          version={selfModuleVersion}
        />

        {msg && (
          <div
            className={cn(
              'mx-4 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
              isDark ? 'border-slate-700 bg-slate-900/60 text-slate-200' : 'border-slate-200 bg-sky-50 text-slate-700',
            )}
          >
            <Icons.Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
            <span>{msg}</span>
          </div>
        )}

        {(nav === 'hot' || nav === 'all') && !query.trim() && (
          <FeaturedBanner
            packages={featuredPackages}
            isDark={isDark}
            language={lang}
            title={tr.featuredTitle}
          />
        )}

        {nav === 'all' && (
          <CategoryFilter
            active={category}
            onChange={setCategory}
            expanded={categoriesOpen}
            onToggle={() => setCategoriesOpen((v) => !v)}
            isDark={isDark}
            tr={tr}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogList
            packages={visiblePackages}
            isDark={isDark}
            language={lang}
            tr={tr}
            installingId={installingId}
            uninstallingId={uninstallingId}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onOpen={handleOpenModule}
            canOpenModule={canOpenModule}
            loading={loading}
            actionsDisabled={batchUpdating}
            sectionTitle={nav === 'hot' || nav === 'all' ? tr.officialServices : undefined}
          />
        </div>
      </div>
    </ModuleSidebarLayout>

      <BuildProgressModal
        open={!!activePkgId}
        isDark={isDark}
        language={lang}
        tr={tr}
        buildLogs={buildLogs}
        buildStatus={buildStatus}
        buildProgress={buildProgress}
        showBuildLogs={showBuildLogs}
        onToggleLogs={() => setShowBuildLogs((v) => !v)}
        onClose={resetBuildModal}
        restartRequired={restartRequired}
        restartReason={restartReason}
        restartUi={restartUi}
        onRestart={() => void handleRestartCopanel()}
      />

      <CommunityConfigModal
        open={isConfigOpen}
        isDark={isDark}
        language={lang}
        communityUrls={communityUrls}
        newUrl={newUrl}
        onNewUrlChange={setNewUrl}
        onAdd={() => {
          if (!newUrl.trim() || !newUrl.startsWith('http')) return;
          if (communityUrls.includes(newUrl.trim())) return;
          const updated = [...communityUrls, newUrl.trim()];
          setCommunityUrls(updated);
          setNewUrl('');
          saveConfig(updated);
        }}
        onRemove={(url) => {
          const updated = communityUrls.filter((u) => u !== url);
          setCommunityUrls(updated);
          saveConfig(updated);
        }}
        onClose={() => setIsConfigOpen(false)}
      />
    </ModuleViewport>
  );
}
