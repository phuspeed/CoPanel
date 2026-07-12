/**
 * Create Project wizard — name, folder, compose config, deploy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import WindowModal from '../../../core/shell/WindowModal';
import { cn } from '../../../lib/utils';
import * as Icons from 'lucide-react';
import FolderBrowser from './FolderBrowser';

export type WizardStep = 1 | 2 | 3 | 4;
export type ConfigMode = 'existing' | 'template' | 'paste';
export type FolderMode = 'managed' | 'custom';

interface ComposeTemplate {
  id: string;
  name_en: string;
  name_vi: string;
  description_en: string;
  description_vi: string;
  icon: string;
  compose: string;
}

interface InspectData {
  path: string;
  exists: boolean;
  has_compose: boolean;
  compose_file: string | null;
  compose_content: string | null;
  writable: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  isDark: boolean;
  language: 'en' | 'vi';
}

const DEFAULT_TEMPLATE = { image: 'nginx:alpine', host_port: 8080, container_port: 80 };

const DEFAULT_COMPOSE = `services:
  app:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
`;

export default function CreateProjectModal({ open, onClose, onCreated, isDark, language }: Props) {
  const [step, setStep] = useState<WizardStep>(1);
  const [projectName, setProjectName] = useState('');
  const [folderMode, setFolderMode] = useState<FolderMode>('managed');
  const [folderPath, setFolderPath] = useState('');
  const [managedRoot, setManagedRoot] = useState('/opt/copanel/stacks');
  const [inspect, setInspect] = useState<InspectData | null>(null);
  const [configMode, setConfigMode] = useState<ConfigMode>('template');
  const [composeContent, setComposeContent] = useState(DEFAULT_COMPOSE);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [overwriteCompose, setOverwriteCompose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [gallery, setGallery] = useState<ComposeTemplate[]>([]);
  const [templateSubMode, setTemplateSubMode] = useState<'gallery' | 'simple'>('gallery');
  const [selectedGalleryId, setSelectedGalleryId] = useState<string | null>(null);

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'Create Project',
          step1: 'Project name',
          step2: 'Project folder',
          step3: 'Configuration',
          step4: 'Review & deploy',
          step1Desc: 'Choose a unique project name (letters, numbers, dash, underscore).',
          step2Desc: 'Use a managed folder or pick an existing directory on the server.',
          step3Desc: 'Use detected compose, a quick template, or paste your own YAML.',
          step4Desc: 'Confirm settings and deploy the stack.',
          projectName: 'Project name',
          projectPlaceholder: 'my-nginx',
          managed: 'Managed folder',
          managedHint: 'Recommended — stored under panel stacks directory.',
          custom: 'Custom folder',
          customHint: 'Select an existing directory on the server.',
          composeDetected: 'Compose file detected',
          noCompose: 'No compose file in this folder',
          useExisting: 'Use existing compose',
          quickTemplate: 'Quick template',
          pasteYaml: 'Paste YAML',
          image: 'Image',
          hostPort: 'Host port',
          containerPort: 'Container port',
          composeYaml: 'docker-compose.yml',
          templateGallery: 'Template gallery',
          singleContainer: 'Single container',
          validate: 'Validate YAML',
          validateOk: 'Compose file is valid.',
          validateFail: 'Validation failed.',
          overwrite: 'Replace existing compose file',
          next: 'Next',
          back: 'Back',
          create: 'Create & Deploy',
          creating: 'Creating project...',
          cancel: 'Cancel',
          browse: 'Refresh',
          selectFolder: 'Select this folder',
          loading: 'Loading folders...',
          empty: 'No subfolders',
          parent: 'Parent folder',
          path: 'Folder path',
          deployNote: 'Deploy runs in the background via Task Center (pull + up).',
          nameRequired: 'Project name is required.',
          nameInvalid: 'Use only letters, numbers, dash or underscore.',
          folderRequired: 'Select a folder first.',
        },
        vi: {
          title: 'Tạo Project',
          step1: 'Tên project',
          step2: 'Thư mục project',
          step3: 'Cấu hình',
          step4: 'Xem lại & triển khai',
          step1Desc: 'Chọn tên project duy nhất (chữ, số, gạch ngang, gạch dưới).',
          step2Desc: 'Dùng thư mục quản lý hoặc chọn thư mục có sẵn trên máy chủ.',
          step3Desc: 'Dùng compose phát hiện sẵn, template nhanh, hoặc dán YAML.',
          step4Desc: 'Xác nhận cài đặt và triển khai stack.',
          projectName: 'Tên project',
          projectPlaceholder: 'my-nginx',
          managed: 'Thư mục quản lý',
          managedHint: 'Khuyến nghị — lưu trong thư mục stacks của panel.',
          custom: 'Thư mục tùy chỉnh',
          customHint: 'Chọn thư mục có sẵn trên máy chủ.',
          composeDetected: 'Đã phát hiện tệp compose',
          noCompose: 'Không có tệp compose trong thư mục',
          useExisting: 'Dùng compose có sẵn',
          quickTemplate: 'Template nhanh',
          pasteYaml: 'Dán YAML',
          image: 'Image',
          hostPort: 'Cổng host',
          containerPort: 'Cổng container',
          composeYaml: 'docker-compose.yml',
          templateGallery: 'Thư viện template',
          singleContainer: 'Container đơn',
          validate: 'Kiểm tra YAML',
          validateOk: 'Tệp compose hợp lệ.',
          validateFail: 'Kiểm tra thất bại.',
          overwrite: 'Ghi đè tệp compose hiện có',
          next: 'Tiếp',
          back: 'Quay lại',
          create: 'Tạo & Triển khai',
          creating: 'Đang tạo project...',
          cancel: 'Hủy',
          browse: 'Làm mới',
          selectFolder: 'Chọn thư mục này',
          loading: 'Đang tải thư mục...',
          empty: 'Không có thư mục con',
          parent: 'Thư mục cha',
          path: 'Đường dẫn',
          deployNote: 'Triển khai chạy nền qua Task Center (pull + up).',
          nameRequired: 'Vui lòng nhập tên project.',
          nameInvalid: 'Chỉ dùng chữ, số, gạch ngang hoặc gạch dưới.',
          folderRequired: 'Hãy chọn thư mục trước.',
        },
      })[language],
    [language],
  );

  const reset = useCallback(() => {
    setStep(1);
    setProjectName('');
    setFolderMode('managed');
    setFolderPath('');
    setInspect(null);
    setConfigMode('template');
    setComposeContent(DEFAULT_COMPOSE);
    setTemplate(DEFAULT_TEMPLATE);
    setOverwriteCompose(false);
    setError(null);
    setValidateMsg(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    fetch('/api/docker_manager/projects/defaults')
      .then((r) => r.json())
      .then((d) => {
        if (d?.data?.managed_root) setManagedRoot(d.data.managed_root);
      })
      .catch(() => undefined);
    fetch('/api/docker_manager/projects/templates')
      .then((r) => r.json())
      .then((d) => setGallery(d.data || []))
      .catch(() => undefined);
  }, [open, reset]);

  const resolvedFolder = useMemo(() => {
    if (folderMode === 'managed' && projectName.trim()) {
      return `${managedRoot.replace(/\/$/, '')}/${projectName.trim()}`;
    }
    return folderPath;
  }, [folderMode, projectName, folderPath, managedRoot]);

  const inspectFolder = useCallback(async (path: string) => {
    if (!path) return null;
    const res = await fetch('/api/docker_manager/projects/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data?.detail;
      throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Inspect failed');
    }
    return data.data as InspectData;
  }, []);

  const handleInspect = useCallback(async () => {
    if (!resolvedFolder) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inspectFolder(resolvedFolder);
      setInspect(result);
      if (result?.has_compose && result.compose_content) {
        setComposeContent(result.compose_content);
        setConfigMode('existing');
      } else {
        setConfigMode('template');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }, [resolvedFolder, inspectFolder]);

  useEffect(() => {
    if (step === 2 && resolvedFolder) {
      handleInspect().catch(() => undefined);
    }
  }, [step, resolvedFolder, handleInspect]);

  const validateYaml = async () => {
    setBusy(true);
    setValidateMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/docker_manager/projects/validate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compose_content: composeContent }),
      });
      const data = await res.json();
      if (data.status === 'success' && data.data?.status === 'success') {
        setValidateMsg(tr.validateOk);
      } else {
        setValidateMsg(data.data?.error || data.data?.output || tr.validateFail);
      }
    } catch {
      setValidateMsg(tr.validateFail);
    } finally {
      setBusy(false);
    }
  };

  const nameValid = /^[a-zA-Z0-9_-]+$/.test(projectName.trim());

  const goNext = async () => {
    setError(null);
    if (step === 1) {
      if (!projectName.trim()) {
        setError(tr.nameRequired);
        return;
      }
      if (!nameValid) {
        setError(tr.nameInvalid);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!resolvedFolder) {
        setError(tr.folderRequired);
        return;
      }
      await handleInspect();
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const source =
        configMode === 'template' && templateSubMode === 'gallery' && selectedGalleryId ? 'paste' : configMode;
      const body: Record<string, unknown> = {
        project_name: projectName.trim(),
        folder_mode: folderMode,
        folder_path: folderMode === 'custom' ? folderPath : undefined,
        source,
        deploy: true,
        overwrite_compose: overwriteCompose,
      };
      if (source === 'paste' || source === 'existing') {
        body.compose_content = composeContent;
      }
      if (source === 'template') {
        body.template = template;
      }
      const res = await fetch('/api/docker_manager/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Create failed');
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: tr.step1 },
    { n: 2, label: tr.step2 },
    { n: 3, label: tr.step3 },
    { n: 4, label: tr.step4 },
  ];

  return (
    <WindowModal open={open} onClose={onClose} title={tr.title} maxWidth="2xl" className="max-w-2xl" closeOnBackdropClick={false}>
      <div className="flex flex-col gap-4 p-4 max-h-[75vh] overflow-y-auto">
        <div className="flex items-center gap-1">
          {steps.map(({ n, label }) => (
            <div key={n} className="flex flex-1 items-center gap-1 min-w-0">
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  step >= n
                    ? 'bg-blue-600 text-white'
                    : isDark
                      ? 'bg-slate-800 text-slate-500'
                      : 'bg-slate-200 text-slate-500',
                )}
              >
                {n}
              </div>
              <span className={cn('truncate text-[10px] font-medium hidden sm:inline', step === n ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-slate-500')}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-400">
            <Icons.AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.step1Desc}</p>
            <label className="block space-y-1.5">
              <span className={cn('text-xs font-bold', isDark ? 'text-slate-300' : 'text-slate-700')}>{tr.projectName}</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={tr.projectPlaceholder}
                className={cn(
                  'w-full rounded-xl border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40',
                  isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900',
                )}
              />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.step2Desc}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['managed', 'custom'] as FolderMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFolderMode(mode)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition',
                    folderMode === mode
                      ? isDark
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-blue-400 bg-blue-50'
                      : isDark
                        ? 'border-slate-800 hover:border-slate-700'
                        : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <div className="text-xs font-bold">{mode === 'managed' ? tr.managed : tr.custom}</div>
                  <div className="text-[10px] mt-1 text-slate-500">{mode === 'managed' ? tr.managedHint : tr.customHint}</div>
                </button>
              ))}
            </div>

            {folderMode === 'managed' ? (
              <div className={cn('rounded-xl border px-3 py-2 font-mono text-xs', isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600')}>
                {resolvedFolder || `${managedRoot}/...`}
              </div>
            ) : (
              <FolderBrowser
                isDark={isDark}
                selectedPath={folderPath}
                onSelect={setFolderPath}
                labels={{
                  browse: tr.browse,
                  selectFolder: tr.selectFolder,
                  loading: tr.loading,
                  empty: tr.empty,
                  parent: tr.parent,
                }}
              />
            )}

            {inspect && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
                  inspect.has_compose
                    ? isDark
                      ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : isDark
                      ? 'border-amber-500/30 bg-amber-950/20 text-amber-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700',
                )}
              >
                {inspect.has_compose ? <Icons.CheckCircle2 className="w-4 h-4" /> : <Icons.Info className="w-4 h-4" />}
                {inspect.has_compose ? `${tr.composeDetected}: ${inspect.compose_file}` : tr.noCompose}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.step3Desc}</p>
            <div className="flex flex-wrap gap-2">
              {inspect?.has_compose && (
                <button
                  type="button"
                  onClick={() => {
                    setConfigMode('existing');
                    if (inspect.compose_content) setComposeContent(inspect.compose_content);
                  }}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-[11px] font-bold border transition',
                    configMode === 'existing' ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
                  )}
                >
                  {tr.useExisting}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfigMode('template')}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[11px] font-bold border transition',
                  configMode === 'template' ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
                )}
              >
                {tr.quickTemplate}
              </button>
              <button
                type="button"
                onClick={() => setConfigMode('paste')}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[11px] font-bold border transition',
                  configMode === 'paste' ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
                )}
              >
                {tr.pasteYaml}
              </button>
            </div>

            {configMode === 'template' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTemplateSubMode('gallery')}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-[11px] font-bold border',
                      templateSubMode === 'gallery' ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200',
                    )}
                  >
                    {tr.templateGallery}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateSubMode('simple')}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-[11px] font-bold border',
                      templateSubMode === 'simple' ? 'bg-blue-600 text-white border-blue-600' : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200',
                    )}
                  >
                    {tr.singleContainer}
                  </button>
                </div>
                {templateSubMode === 'gallery' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {gallery.map((tpl) => {
                      const active = selectedGalleryId === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => {
                            setSelectedGalleryId(tpl.id);
                            setComposeContent(tpl.compose);
                          }}
                          className={cn(
                            'rounded-xl border p-3 text-left transition',
                            active
                              ? isDark
                                ? 'border-blue-500/50 bg-blue-500/10'
                                : 'border-blue-400 bg-blue-50'
                              : isDark
                                ? 'border-slate-800 hover:border-slate-700'
                                : 'border-slate-200 hover:border-slate-300',
                          )}
                        >
                          <div className="text-xs font-bold">{language === 'vi' ? tpl.name_vi : tpl.name_en}</div>
                          <div className="text-[10px] mt-1 text-slate-500 line-clamp-2">
                            {language === 'vi' ? tpl.description_vi : tpl.description_en}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-500">{tr.image}</span>
                      <input
                        value={template.image}
                        onChange={(e) => setTemplate((t) => ({ ...t, image: e.target.value }))}
                        className={cn('w-full rounded-lg border px-2 py-1.5 text-xs font-mono', isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white')}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-500">{tr.hostPort}</span>
                      <input
                        type="number"
                        value={template.host_port}
                        onChange={(e) => setTemplate((t) => ({ ...t, host_port: Number(e.target.value) }))}
                        className={cn('w-full rounded-lg border px-2 py-1.5 text-xs', isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white')}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-500">{tr.containerPort}</span>
                      <input
                        type="number"
                        value={template.container_port}
                        onChange={(e) => setTemplate((t) => ({ ...t, container_port: Number(e.target.value) }))}
                        className={cn('w-full rounded-lg border px-2 py-1.5 text-xs', isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white')}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {(configMode === 'paste' || configMode === 'existing') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-xs font-bold', isDark ? 'text-slate-300' : 'text-slate-700')}>{tr.composeYaml}</span>
                  <button
                    type="button"
                    onClick={validateYaml}
                    disabled={busy}
                    className="text-[11px] font-bold text-blue-500 hover:text-blue-400 disabled:opacity-50"
                  >
                    {tr.validate}
                  </button>
                </div>
                <textarea
                  value={composeContent}
                  onChange={(e) => setComposeContent(e.target.value)}
                  rows={10}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                    isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900',
                  )}
                />
                {validateMsg && (
                  <p className={cn('text-[11px]', validateMsg === tr.validateOk ? 'text-emerald-500' : 'text-amber-500')}>{validateMsg}</p>
                )}
              </div>
            )}

            {inspect?.has_compose && configMode !== 'existing' && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={overwriteCompose} onChange={(e) => setOverwriteCompose(e.target.checked)} />
                {tr.overwrite}
              </label>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-xs">
            <p className={cn(isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.step4Desc}</p>
            <dl className={cn('rounded-xl border divide-y', isDark ? 'border-slate-800 divide-slate-800' : 'border-slate-200 divide-slate-100')}>
              {[
                [tr.projectName, projectName],
                [tr.path, resolvedFolder],
                [tr.step3, configMode],
              ].map(([k, v]) => (
                <div key={String(k)} className="grid grid-cols-[8rem_1fr] gap-2 px-3 py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className={cn('font-mono break-all', isDark ? 'text-slate-200' : 'text-slate-800')}>{v}</dd>
                </div>
              ))}
            </dl>
            <p className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.deployNote}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/30">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition',
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600',
            )}
          >
            {step === 1 ? tr.cancel : tr.back}
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50"
            >
              {tr.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
            >
              {busy && <Icons.Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? tr.creating : tr.create}
            </button>
          )}
        </div>
      </div>
    </WindowModal>
  );
}
