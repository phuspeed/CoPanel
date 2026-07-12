/**
 * Site Wizard — 1-click install + custom steps. Desktop sidebar shell.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import WindowModal from '../../core/shell/WindowModal';
import WizardSidebar, { type WizardStep } from './components/WizardSidebar';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';
import { api, jobsApi, useJob } from '../../core/platform';

interface Template {
  id: string;
  name: string;
  description: string;
  icon?: string;
  features?: string[];
  one_click?: boolean;
  php_version?: string | null;
  php_modules?: string[];
  proxy_port?: number | null;
  create_database?: boolean;
  issue_ssl?: boolean;
}

interface Preflight {
  nginx: { installed: boolean; ready: boolean };
  mysql: { installed: boolean; ready: boolean };
  php: { installed_versions: string[]; active: string; ready: boolean };
  ready_for_lemp: boolean;
  ready_for_static: boolean;
}

interface FormState {
  templateId: string;
  domain: string;
  document_root: string;
  php_version: string;
  php_modules: string[];
  proxy_port: string;
  create_database: boolean;
  database_name: string;
  database_user: string;
  database_password: string;
  issue_ssl: boolean;
  ssl_email: string;
}

const INITIAL: FormState = {
  templateId: 'wordpress',
  domain: '',
  document_root: '/var/www',
  php_version: '',
  php_modules: [],
  proxy_port: '',
  create_database: false,
  database_name: '',
  database_user: '',
  database_password: '',
  issue_ssl: true,
  ssl_email: '',
};

const TEMPLATE_ICONS: Record<string, typeof Icons.Globe> = {
  static: Icons.FileCode,
  wordpress: Icons.LayoutTemplate,
  laravel: Icons.Boxes,
  node_proxy: Icons.Server,
};

export default function SiteWizard() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const windowed = useIsWindowedModule();
  const [searchParams, setSearchParams] = useSearchParams();

  const [step, setStep] = useState<WizardStep>('quick');
  const [form, setForm] = useState<FormState>(INITIAL);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(searchParams.get('job'));
  const job = useJob(jobId);

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'Site Wizard',
          subtitle: '1-click hosting provision',
          quick: '1-Click Install',
          template: 'Template',
          domain: 'Domain',
          database: 'Database',
          ssl: 'SSL',
          review: 'Review',
          quickTitle: '1-Click Install',
          quickDesc: 'Pick a stack, enter your domain, and provision Nginx + app + DB + SSL in one job.',
          domainLabel: 'Domain name',
          domainHint: 'DNS should point to this server before SSL',
          sslEmail: 'SSL contact email',
          installNow: 'Install now',
          installing: 'Starting…',
          customize: 'Customize steps',
          stackStatus: 'Stack status',
          nginx: 'Nginx',
          mysql: 'MySQL/MariaDB',
          php: 'PHP',
          ready: 'Ready',
          missing: 'Will install',
          back: 'Back',
          next: 'Next',
          provision: 'Provision site',
          confirmTitle: 'Start provisioning?',
          confirmBody: 'This will create vhost, database, SSL, and deploy the selected template.',
          cancel: 'Cancel',
          confirm: 'Start',
        },
        vi: {
          title: 'Site Wizard',
          subtitle: 'Cài hosting 1-click',
          quick: 'Cài 1-Click',
          template: 'Mẫu',
          domain: 'Tên miền',
          database: 'Database',
          ssl: 'SSL',
          review: 'Xem lại',
          quickTitle: 'Cài đặt 1-Click',
          quickDesc: 'Chọn stack, nhập tên miền — tự động tạo Nginx + app + DB + SSL trong một job.',
          domainLabel: 'Tên miền',
          domainHint: 'DNS cần trỏ về máy chủ này trước khi cấp SSL',
          sslEmail: 'Email SSL',
          installNow: 'Cài ngay',
          installing: 'Đang khởi chạy…',
          customize: 'Tùy chỉnh từng bước',
          stackStatus: 'Trạng thái stack',
          nginx: 'Nginx',
          mysql: 'MySQL/MariaDB',
          php: 'PHP',
          ready: 'Sẵn sàng',
          missing: 'Sẽ cài',
          back: 'Quay lại',
          next: 'Tiếp',
          provision: 'Triển khai site',
          confirmTitle: 'Bắt đầu triển khai?',
          confirmBody: 'Sẽ tạo vhost, database, SSL và cài template đã chọn.',
          cancel: 'Hủy',
          confirm: 'Bắt đầu',
        },
      })[language === 'vi' ? 'vi' : 'en'],
    [language],
  );

  const labels: Record<WizardStep, string> = {
    quick: tr.quick,
    template: tr.template,
    domain: tr.domain,
    database: tr.database,
    ssl: tr.ssl,
    review: tr.review,
  };

  const stepMeta: Record<WizardStep, { title: string; desc: string }> = {
    quick: { title: tr.quickTitle, desc: tr.quickDesc },
    template: { title: tr.template, desc: 'Choose what to deploy on this server.' },
    domain: { title: tr.domain, desc: 'Domain, document root, PHP or proxy port.' },
    database: { title: tr.database, desc: 'Optional MySQL database and user.' },
    ssl: { title: tr.ssl, desc: "Let's Encrypt certificate via Certbot." },
    review: { title: tr.review, desc: 'Confirm settings before provisioning.' },
  };

  const loadMeta = useCallback(() => {
    api<Template[]>('/api/site_wizard/templates')
      .then((tpls) => setTemplates(Array.isArray(tpls) ? tpls : []))
      .catch(() => setTemplates([]));
    api<Preflight>('/api/site_wizard/preflight')
      .then(setPreflight)
      .catch(() => setPreflight(null));
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const id = searchParams.get('job');
    if (id) setJobId(id);
  }, [searchParams]);

  useEffect(() => {
    if (!jobId) return;
    const id = setInterval(() => {
      jobsApi.get(jobId).catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [jobId]);

  function applyTemplate(tpl: Template) {
    setForm((s) => ({
      ...s,
      templateId: tpl.id,
      php_version: tpl.php_version || '',
      php_modules: tpl.php_modules || [],
      proxy_port: tpl.proxy_port ? String(tpl.proxy_port) : '',
      create_database: !!tpl.create_database,
      issue_ssl: tpl.issue_ssl !== false,
    }));
  }

  useEffect(() => {
    if (templates.length && form.templateId === INITIAL.templateId) {
      const wp = templates.find((t) => t.id === 'wordpress');
      if (wp) applyTemplate(wp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function onDomainChange(domain: string) {
    const clean = domain.trim().toLowerCase();
    const tpl = templates.find((t) => t.id === form.templateId);
    const root =
      tpl?.id === 'laravel'
        ? `/var/www/${clean || 'site'}/public`
        : `/var/www/${clean || 'site'}`;
    setForm((s) => ({
      ...s,
      domain: clean,
      document_root: clean ? root : s.document_root,
      ssl_email: s.ssl_email || (clean ? `admin@${clean}` : ''),
    }));
  }

  const selectedTpl = templates.find((t) => t.id === form.templateId);

  const canSubmit = form.domain.length >= 3 && (!form.issue_ssl || form.ssl_email.includes('@'));

  const buildBody = () => ({
    domain: form.domain,
    document_root: form.document_root,
    template_id: form.templateId,
    php_version: form.php_version || null,
    php_modules: form.php_modules.length ? form.php_modules : selectedTpl?.php_modules || [],
    proxy_port: form.proxy_port ? Number(form.proxy_port) : null,
    create_database: form.create_database,
    database_name: form.database_name || null,
    database_user: form.database_user || null,
    database_password: form.database_password || null,
    issue_ssl: form.issue_ssl,
    ssl_email: form.ssl_email || null,
  });

  async function submit() {
    setSubmitting(true);
    setError(null);
    setConfirmOpen(false);
    try {
      const res = await api<{ job_id: string }>('/api/site_wizard/run', { method: 'POST', body: buildBody() });
      setJobId(res.job_id);
      setSearchParams({ job: res.job_id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start wizard';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const card = cn(
    'rounded-2xl border p-5 shadow-sm',
    isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200',
  );

  const inputCls = cn(
    'w-full rounded-xl px-3 py-2.5 text-sm border transition focus:outline-none focus:border-violet-500',
    isDark
      ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-600'
      : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400',
  );

  const renderQuick = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {templates.map((tpl) => {
          const Icon = TEMPLATE_ICONS[tpl.id] || Icons.LayoutTemplate;
          const active = form.templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className={cn(
                'text-left p-4 rounded-xl border transition',
                active
                  ? isDark
                    ? 'border-violet-500 ring-2 ring-violet-500/30 bg-violet-500/10'
                    : 'border-violet-500 ring-2 ring-violet-500/20 bg-violet-50'
                  : isDark
                    ? 'border-slate-800 hover:border-violet-500/50'
                    : 'border-slate-200 hover:border-violet-300',
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn('w-5 h-5 shrink-0', active ? 'text-violet-500' : 'text-slate-400')} />
                <div className="min-w-0">
                  <p className={cn('text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tpl.name}</p>
                  <p className={cn('text-xs mt-1', isDark ? 'text-slate-400' : 'text-slate-500')}>{tpl.description}</p>
                  {tpl.features && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tpl.features.slice(0, 3).map((f) => (
                        <span
                          key={f}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                            isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className={cn('grid gap-4', windowed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2')}>
        <Field label={tr.domainLabel} hint={tr.domainHint} isDark={isDark}>
          <input
            value={form.domain}
            onChange={(e) => onDomainChange(e.target.value)}
            className={inputCls}
            placeholder="example.com"
          />
        </Field>
        <Field label={tr.sslEmail} isDark={isDark}>
          <input
            value={form.ssl_email}
            onChange={(e) => setForm({ ...form, ssl_email: e.target.value })}
            className={inputCls}
            placeholder="admin@example.com"
            disabled={!form.issue_ssl}
          />
        </Field>
      </div>

      {preflight && (
        <div className={card}>
          <p className={cn('text-xs font-bold uppercase tracking-wider mb-3', isDark ? 'text-slate-400' : 'text-slate-500')}>
            {tr.stackStatus}
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <StackPill label={tr.nginx} ok={preflight.nginx.ready} ready={tr.ready} missing={tr.missing} isDark={isDark} />
            <StackPill label={tr.mysql} ok={preflight.mysql.ready} ready={tr.ready} missing={tr.missing} isDark={isDark} />
            <StackPill
              label={`${tr.php} ${preflight.php.active || preflight.php.installed_versions[0] || ''}`}
              ok={preflight.php.ready}
              ready={tr.ready}
              missing={tr.missing}
              isDark={isDark}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setStep('template')}
        className={cn('text-xs font-semibold', isDark ? 'text-violet-400 hover:text-violet-300' : 'text-violet-600 hover:text-violet-700')}
      >
        {tr.customize} →
      </button>
    </div>
  );

  const renderStepContent = () => {
    if (step === 'quick') return renderQuick();
    if (step === 'template') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className={cn(
                'text-left p-4 rounded-xl border transition',
                form.templateId === tpl.id
                  ? isDark
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-violet-500 bg-violet-50'
                  : isDark
                    ? 'border-slate-800'
                    : 'border-slate-200',
              )}
            >
              <p className={cn('text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-800')}>{tpl.name}</p>
              <p className={cn('text-xs mt-1', isDark ? 'text-slate-400' : 'text-slate-500')}>{tpl.description}</p>
            </button>
          ))}
        </div>
      );
    }
    if (step === 'domain') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Domain" isDark={isDark}>
            <input value={form.domain} onChange={(e) => onDomainChange(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Document root" isDark={isDark}>
            <input
              value={form.document_root}
              onChange={(e) => setForm({ ...form, document_root: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="PHP version" isDark={isDark}>
            <input
              value={form.php_version}
              onChange={(e) => setForm({ ...form, php_version: e.target.value })}
              className={inputCls}
              placeholder="8.2"
            />
          </Field>
          <Field label="Proxy port" isDark={isDark}>
            <input
              value={form.proxy_port}
              onChange={(e) => setForm({ ...form, proxy_port: e.target.value.replace(/[^\d]/g, '') })}
              className={inputCls}
              placeholder="3000"
            />
          </Field>
        </div>
      );
    }
    if (step === 'database') {
      return (
        <div className="space-y-4">
          <label className={cn('flex items-center gap-3 text-sm', isDark ? 'text-slate-200' : 'text-slate-700')}>
            <input
              type="checkbox"
              checked={form.create_database}
              onChange={(e) => setForm({ ...form, create_database: e.target.checked })}
              className="w-4 h-4"
            />
            Provision MySQL database
          </label>
          {form.create_database && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="DB name" isDark={isDark}>
                <input value={form.database_name} onChange={(e) => setForm({ ...form, database_name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="DB user" isDark={isDark}>
                <input value={form.database_user} onChange={(e) => setForm({ ...form, database_user: e.target.value })} className={inputCls} />
              </Field>
              <Field label="DB password" isDark={isDark}>
                <input value={form.database_password} onChange={(e) => setForm({ ...form, database_password: e.target.value })} className={inputCls} placeholder="(auto)" />
              </Field>
            </div>
          )}
        </div>
      );
    }
    if (step === 'ssl') {
      return (
        <div className="space-y-4">
          <label className={cn('flex items-center gap-3 text-sm', isDark ? 'text-slate-200' : 'text-slate-700')}>
            <input
              type="checkbox"
              checked={form.issue_ssl}
              onChange={(e) => setForm({ ...form, issue_ssl: e.target.checked })}
              className="w-4 h-4"
            />
            Issue Let&apos;s Encrypt SSL
          </label>
          {form.issue_ssl && (
            <Field label="Contact email" isDark={isDark}>
              <input value={form.ssl_email} onChange={(e) => setForm({ ...form, ssl_email: e.target.value })} className={inputCls} />
            </Field>
          )}
        </div>
      );
    }
    if (step === 'review') {
      return (
        <div className={cn(card, 'space-y-2 text-sm')}>
          <Row k="Template" v={form.templateId} isDark={isDark} />
          <Row k="Domain" v={form.domain || '-'} isDark={isDark} />
          <Row k="Document root" v={form.document_root} isDark={isDark} />
          <Row k="PHP" v={form.php_version || '-'} isDark={isDark} />
          <Row k="Proxy" v={form.proxy_port || '-'} isDark={isDark} />
          <Row k="Database" v={form.create_database ? 'yes' : 'no'} isDark={isDark} />
          <Row k="SSL" v={form.issue_ssl ? form.ssl_email : 'no'} isDark={isDark} />
        </div>
      );
    }
    return null;
  };

  const stepOrder: WizardStep[] = ['quick', 'template', 'domain', 'database', 'ssl', 'review'];
  const stepIndex = stepOrder.indexOf(step);
  const isQuick = step === 'quick';
  const isReview = step === 'review';

  const resetWizard = () => {
    setJobId(null);
    setSearchParams({});
    setStep('quick');
    setForm(INITIAL);
    if (templates.find((t) => t.id === 'wordpress')) applyTemplate(templates.find((t) => t.id === 'wordpress')!);
  };

  return (
    <ModuleViewport className="flex min-h-0 flex-col overflow-hidden">
      <div className={cn('flex h-full min-h-0', isDark ? 'text-slate-100' : 'text-slate-900')}>
        <WizardSidebar
          step={step}
          onStep={setStep}
          isDark={isDark}
          labels={labels}
          title={tr.title}
          subtitle={tr.subtitle}
          disabled={!!jobId}
          completed={{
            template: !!form.templateId,
            domain: form.domain.length >= 3,
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className={cn('min-h-0 flex-1 overflow-y-auto', windowed ? 'p-5' : 'p-5 md:p-8')}>
            {!jobId ? (
              <>
                <header className="mb-6 space-y-1.5">
                  <h2 className={cn('text-lg font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>
                    {stepMeta[step].title}
                  </h2>
                  <p className={cn('text-xs max-w-2xl', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    {stepMeta[step].desc}
                  </p>
                </header>
                <div className={card}>{renderStepContent()}</div>
                {error && (
                  <p className="mt-3 text-sm text-red-500 flex items-center gap-2">
                    <Icons.AlertCircle className="w-4 h-4" /> {error}
                  </p>
                )}
              </>
            ) : (
              <RunPanel job={job} isDark={isDark} onReset={resetWizard} />
            )}
          </main>

          {!jobId && (
            <footer
              className={cn(
                'shrink-0 flex items-center justify-between gap-3 border-t px-5 py-4',
                isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white/80',
              )}
            >
              <button
                type="button"
                onClick={() => setStep(stepOrder[Math.max(0, stepIndex - 1)])}
                disabled={stepIndex === 0}
                className={cn(
                  'px-4 py-2 rounded-xl border text-sm font-bold disabled:opacity-40',
                  isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
                )}
              >
                {tr.back}
              </button>
              {isQuick || isReview ? (
                <button
                  type="button"
                  disabled={!canSubmit || submitting}
                  onClick={() => setConfirmOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  <Icons.Zap className="w-4 h-4" />
                  {submitting ? tr.installing : tr.installNow}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep(stepOrder[Math.min(stepOrder.length - 1, stepIndex + 1)])}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold"
                >
                  {tr.next}
                </button>
              )}
            </footer>
          )}
        </div>
      </div>

      <WindowModal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={tr.confirmTitle} maxWidth="md">
        <div className="space-y-4 p-4">
          <p className={cn('text-sm', isDark ? 'text-slate-300' : 'text-slate-600')}>{tr.confirmBody}</p>
          <div className={cn('rounded-xl border p-3 text-xs space-y-1', isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-slate-50')}>
            <Row k="Template" v={selectedTpl?.name || form.templateId} isDark={isDark} />
            <Row k="Domain" v={form.domain} isDark={isDark} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmOpen(false)} className={cn('px-4 py-2 rounded-xl text-sm font-bold border', isDark ? 'border-slate-700' : 'border-slate-200')}>
              {tr.cancel}
            </button>
            <button type="button" onClick={submit} disabled={submitting} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold">
              {tr.confirm}
            </button>
          </div>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}

function StackPill({
  label,
  ok,
  ready,
  missing,
  isDark,
}: {
  label: string;
  ok: boolean;
  ready: string;
  missing: string;
  isDark: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold',
        ok
          ? isDark
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : isDark
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {ok ? <Icons.Check className="w-3 h-3" /> : <Icons.Download className="w-3 h-3" />}
      {label}: {ok ? ready : missing}
    </span>
  );
}

function RunPanel({ job, isDark, onReset }: { job: ReturnType<typeof useJob>; isDark: boolean; onReset: () => void }) {
  if (!job) {
    return <p className={cn('text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>Submitting…</p>;
  }
  const failed = job.status === 'failed';
  const done = job.status === 'success';
  const card = cn('rounded-2xl border p-5 space-y-3', isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200');

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className={cn('text-base font-bold', isDark ? 'text-slate-100' : 'text-slate-800')}>{job.title}</h2>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-500">
            {job.status}
          </span>
        </div>
        {(job.status === 'running' || job.status === 'queued') && (
          <div className={cn('h-2 rounded-full overflow-hidden', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${job.progress || 0}%` }} />
          </div>
        )}
        {job.message && <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{job.message}</p>}
        {failed && <p className="text-sm text-red-500">{job.error}</p>}
        {done && job.result && (
          <div className="space-y-2 text-sm">
            <Row k="Summary" v={job.result.summary} isDark={isDark} />
            {job.result.site_url && (
              <a href={job.result.site_url} target="_blank" rel="noreferrer" className="text-violet-500 text-sm font-semibold hover:underline">
                {job.result.site_url}
              </a>
            )}
            {job.result.database && (
              <>
                <Row k="DB" v={job.result.database.name} isDark={isDark} />
                <Row k="User" v={job.result.database.user} isDark={isDark} />
                <Row k="Password" v={job.result.database.password} isDark={isDark} mono />
              </>
            )}
            {job.result.deployment?.admin_url && (
              <a href={job.result.deployment.admin_url} target="_blank" rel="noreferrer" className="text-violet-500 text-sm font-semibold hover:underline block">
                WordPress setup →
              </a>
            )}
            {job.result.ssl && <Row k="SSL" v={`${job.result.ssl.type} (${job.result.ssl.domain})`} isDark={isDark} />}
            {job.result.verification?.reachable !== undefined && (
              <Row
                k="Reachable"
                v={`${job.result.verification.reachable ? 'yes' : 'no'} ${job.result.verification.status_line || job.result.verification.error || ''}`}
                isDark={isDark}
              />
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onReset}
        className={cn('px-4 py-2 rounded-xl border text-sm font-bold', isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600')}
      >
        Provision another site
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  isDark,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  isDark: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={cn('text-[11px] font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>
        {label}
      </span>
      {children}
      {hint && <span className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{hint}</span>}
    </label>
  );
}

function Row({ k, v, isDark, mono }: { k: string; v: unknown; isDark: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={cn('text-xs uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>{k}</span>
      <span className={cn('text-sm', isDark ? 'text-slate-100' : 'text-slate-800', mono && 'font-mono')}>{String(v ?? '-')}</span>
    </div>
  );
}
