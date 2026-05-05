/**
 * Site Wizard - multi-step UI that drives the backend ``site_wizard``
 * module. Submits a single request that backend orchestrates as a job;
 * we then poll the platform job store for progress and surface result
 * details (database credentials, verification, SSL status).
 */
import { useEffect, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { api, jobsApi, useJob } from '../../core/platform';

interface Template {
  id: string;
  name: string;
  description: string;
  php_version?: string | null;
  php_modules?: string[];
  proxy_port?: number | null;
  create_database?: boolean;
  issue_ssl?: boolean;
}

interface FormState {
  templateId: string;
  domain: string;
  document_root: string;
  php_version: string;
  proxy_port: string;
  create_database: boolean;
  database_name: string;
  database_user: string;
  database_password: string;
  issue_ssl: boolean;
  ssl_email: string;
}

const STEPS = ['Template', 'Domain', 'Database', 'SSL', 'Review'] as const;

const INITIAL: FormState = {
  templateId: 'static',
  domain: '',
  document_root: '/var/www',
  php_version: '',
  proxy_port: '',
  create_database: false,
  database_name: '',
  database_user: '',
  database_password: '',
  issue_ssl: false,
  ssl_email: '',
};

export default function SiteWizard() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);

  useEffect(() => {
    api<Template[]>('/api/site_wizard/templates')
      .then((tpls) => setTemplates(tpls || []))
      .catch(() => setTemplates([]));
  }, []);

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
      proxy_port: tpl.proxy_port ? String(tpl.proxy_port) : '',
      create_database: !!tpl.create_database,
      issue_ssl: !!tpl.issue_ssl,
    }));
  }

  const stepContent = useMemo(() => {
    if (step === 0) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => applyTemplate(tpl)}
              className={`text-left p-4 rounded-xl border transition ${
                form.templateId === tpl.id
                  ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/40 dark:bg-blue-500/10'
                  : 'border-slate-200 hover:border-blue-300 dark:border-slate-800 dark:hover:border-blue-500/50'
              }`}
            >
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{tpl.name}</p>
              <p className="text-xs text-slate-500 mt-1">{tpl.description}</p>
            </button>
          ))}
        </div>
      );
    }
    if (step === 1) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Domain" hint="e.g. example.com">
            <input
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value.trim().toLowerCase() })}
              className={inputClass()}
              placeholder="example.com"
              required
            />
          </Field>
          <Field label="Document Root" hint="Created if missing">
            <input
              value={form.document_root}
              onChange={(e) => setForm({ ...form, document_root: e.target.value })}
              className={inputClass()}
              placeholder="/var/www/example"
            />
          </Field>
          <Field label="PHP Version" hint="Leave blank for static / proxy">
            <input
              value={form.php_version}
              onChange={(e) => setForm({ ...form, php_version: e.target.value })}
              className={inputClass()}
              placeholder="8.2"
            />
          </Field>
          <Field label="Reverse Proxy Port" hint="For Node/Bun apps">
            <input
              value={form.proxy_port}
              onChange={(e) => setForm({ ...form, proxy_port: e.target.value.replace(/[^\d]/g, '') })}
              className={inputClass()}
              placeholder="3000"
            />
          </Field>
        </div>
      );
    }
    if (step === 2) {
      return (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.create_database}
              onChange={(e) => setForm({ ...form, create_database: e.target.checked })}
              className="w-4 h-4"
            />
            Provision a new MySQL database for this site
          </label>
          {form.create_database && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Database name" hint="default: domain_slug">
                <input value={form.database_name} onChange={(e) => setForm({ ...form, database_name: e.target.value })} className={inputClass()} />
              </Field>
              <Field label="DB user" hint="default: same as db">
                <input value={form.database_user} onChange={(e) => setForm({ ...form, database_user: e.target.value })} className={inputClass()} />
              </Field>
              <Field label="DB password" hint="auto-generated if empty">
                <input value={form.database_password} onChange={(e) => setForm({ ...form, database_password: e.target.value })} className={inputClass()} placeholder="(auto)" />
              </Field>
            </div>
          )}
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.issue_ssl}
              onChange={(e) => setForm({ ...form, issue_ssl: e.target.checked })}
              className="w-4 h-4"
            />
            Issue Let's Encrypt SSL via Certbot
          </label>
          {form.issue_ssl && (
            <Field label="Contact email" hint="Used by Certbot for renewal alerts">
              <input
                value={form.ssl_email}
                onChange={(e) => setForm({ ...form, ssl_email: e.target.value })}
                className={inputClass()}
                placeholder="admin@example.com"
              />
            </Field>
          )}
        </div>
      );
    }
    if (step === 4) {
      return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1 text-sm">
          <Row k="Template" v={form.templateId} />
          <Row k="Domain" v={form.domain || '-'} />
          <Row k="Document root" v={form.document_root || '-'} />
          <Row k="PHP" v={form.php_version || '-'} />
          <Row k="Proxy port" v={form.proxy_port || '-'} />
          <Row k="Database" v={form.create_database ? `${form.database_name || '(auto)'} / ${form.database_user || '(auto)'}` : 'no'} />
          <Row k="SSL" v={form.issue_ssl ? `letsencrypt (${form.ssl_email || 'no email'})` : 'no'} />
        </div>
      );
    }
    return null;
  }, [step, form, templates]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        domain: form.domain,
        document_root: form.document_root,
        php_version: form.php_version || null,
        proxy_port: form.proxy_port ? Number(form.proxy_port) : null,
        create_database: form.create_database,
        database_name: form.database_name || null,
        database_user: form.database_user || null,
        database_password: form.database_password || null,
        issue_ssl: form.issue_ssl,
        ssl_email: form.ssl_email || null,
      };
      const res = await api<{ job_id: string }>('/api/site_wizard/run', { method: 'POST', body });
      setJobId(res.job_id);
    } catch (err: any) {
      setError(err?.message || 'Failed to start wizard');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">Hosting</p>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">Site Wizard</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-xl">
          Provision a website end-to-end. We will create the Nginx vhost, optional MySQL database,
          and optional Let's Encrypt SSL certificate, then verify the site responds.
        </p>
      </header>

      {!jobId ? (
        <>
          <Stepper step={step} />
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5">
            {stepContent}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <footer className="flex items-center justify-between">
            <button
              onClick={prev}
              disabled={step === 0}
              className="px-4 py-2 rounded-xl border text-sm font-bold disabled:opacity-40 border-slate-200 dark:border-slate-700"
            >
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
              >
                Next
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
              >
                {submitting ? 'Starting...' : 'Provision site'}
              </button>
            )}
          </footer>
        </>
      ) : (
        <RunPanel job={job} onReset={() => { setJobId(null); setStep(0); setForm(INITIAL); }} />
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] ${
                active
                  ? 'bg-blue-600 text-white'
                  : done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {done ? <Icons.Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={active ? 'text-blue-500' : done ? 'text-emerald-500' : 'text-slate-400'}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-slate-300 dark:text-slate-700">/</span>}
          </li>
        );
      })}
    </ol>
  );
}

function RunPanel({ job, onReset }: { job: any; onReset: () => void }) {
  if (!job) {
    return <p className="text-sm text-slate-500">Submitting...</p>;
  }
  const failed = job.status === 'failed';
  const done = job.status === 'success';
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{job.title}</h2>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500">
            {job.status}
          </span>
        </div>
        {(job.status === 'running' || job.status === 'queued') && (
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${job.progress || 0}%` }} />
          </div>
        )}
        {job.message && <p className="text-xs text-slate-500">{job.message}</p>}
        {failed && <p className="text-sm text-red-500">{job.error}</p>}
        {done && job.result && (
          <div className="space-y-1 text-sm">
            <Row k="Summary" v={job.result.summary} />
            {job.result.database && (
              <>
                <Row k="DB name" v={job.result.database.name} />
                <Row k="DB user" v={job.result.database.user} />
                <Row k="DB password" v={job.result.database.password} mono />
              </>
            )}
            {job.result.verification?.reachable !== undefined && (
              <Row
                k="Reachable"
                v={`${job.result.verification.reachable ? 'yes' : 'no'} (${job.result.verification.status_line || job.result.verification.error || ''})`}
              />
            )}
          </div>
        )}
      </div>
      <button onClick={onReset} className="px-4 py-2 rounded-xl border text-sm font-bold border-slate-200 dark:border-slate-700">
        Provision another site
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Row({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-slate-400">{k}</span>
      <span className={`text-sm text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}>{String(v ?? '-')}</span>
    </div>
  );
}

function inputClass() {
  return 'w-full rounded-xl px-3 py-2 text-sm border bg-white border-slate-200 hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:bg-slate-950/60 dark:border-slate-800 dark:hover:border-slate-700 dark:text-slate-100';
}
