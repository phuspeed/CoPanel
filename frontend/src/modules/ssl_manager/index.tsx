/**
 * SSL Manager — Desktop sidebar shell, certificates, issue, custom, auto-renew.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';
import SslManagerSidebar, { type SslTab } from './components/SslManagerSidebar';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';

interface Certificate {
  domain: string;
  active: boolean;
  type: string;
  expiry: string;
  days_left?: number;
}

interface AutoRenewStatus {
  enabled: boolean;
  hour: number;
  minute: number;
  cron_installed: boolean;
  cron_expression: string | null;
  certbot_installed: boolean;
  certbot_timer: { active: boolean; source: string | null };
  last_run: string | null;
  last_status: string | null;
  last_message: string | null;
  log_file: string;
}

export default function SSLManagerDashboard() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const windowed = useIsWindowedModule();

  const [tab, setTab] = useState<SslTab>('certificates');
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [autoRenew, setAutoRenew] = useState<AutoRenewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const [certbotDomain, setCertbotDomain] = useState('');
  const [certbotEmail, setCertbotEmail] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [customPrivateKey, setCustomPrivateKey] = useState('');
  const [customCertificate, setCustomCertificate] = useState('');

  const [inlineDomain, setInlineDomain] = useState<string | null>(null);
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlineMode, setInlineMode] = useState<'issue' | 'renew'>('issue');

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoHour, setAutoHour] = useState(3);
  const [autoMinute, setAutoMinute] = useState(30);

  const token = localStorage.getItem('copanel_token');
  const authHeaders = useCallback(
    (json = false): HeadersInit => {
      const headers: Record<string, string> = {};
      if (json) headers['Content-Type'] = 'application/json';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return headers;
    },
    [token],
  );

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'SSL Manager',
          subtitle: "Let's Encrypt & custom certs",
          certificates: 'Certificates',
          issue: 'Issue LE',
          custom: 'Custom SSL',
          autoRenew: 'Auto Renew',
          certTitle: 'Domain certificates',
          certDesc: 'All domains detected from Nginx and certificate stores.',
          issueTitle: "Let's Encrypt",
          issueDesc: 'Issue a free certificate via Certbot for a new domain.',
          customTitle: 'Custom certificate',
          customDesc: 'Paste fullchain and private key for external SSL.',
          autoTitle: 'Auto renew',
          autoDesc: 'Schedule daily certbot renew via CoPanel cron. Reloads Nginx after renewal.',
          secured: 'Secured',
          noSsl: 'No SSL',
          issueBtn: 'Issue',
          renewBtn: 'Renew',
          renewAll: 'Renew all now',
          renewing: 'Renewing…',
          saveAuto: 'Save schedule',
          saving: 'Saving…',
          autoOn: 'Enable auto-renew',
          schedule: 'Daily at',
          lastRun: 'Last run',
          cronStatus: 'CoPanel cron',
          certbotTimer: 'OS certbot timer',
          active: 'Active',
          inactive: 'Inactive',
          installed: 'Installed',
          notInstalled: 'Not installed',
          loading: 'Loading…',
          noDomains: 'No domains found.',
          domain: 'Domain',
          email: 'Email',
          cancel: 'Cancel',
          confirmIssue: 'Issue certificate',
          confirmRenew: 'Renew certificate',
        },
        vi: {
          title: 'Quản lý SSL',
          subtitle: "Let's Encrypt & chứng chỉ tùy chỉnh",
          certificates: 'Chứng chỉ',
          issue: 'Cấp LE',
          custom: 'SSL tùy chỉnh',
          autoRenew: 'Tự gia hạn',
          certTitle: 'Chứng chỉ tên miền',
          certDesc: 'Tên miền từ Nginx và kho chứng chỉ.',
          issueTitle: "Let's Encrypt",
          issueDesc: 'Cấp chứng chỉ miễn phí qua Certbot.',
          customTitle: 'Chứng chỉ tùy chỉnh',
          customDesc: 'Dán fullchain và private key.',
          autoTitle: 'Tự động gia hạn',
          autoDesc: 'Lên lịch certbot renew hàng ngày qua cron CoPanel.',
          secured: 'Đã bảo mật',
          noSsl: 'Chưa SSL',
          issueBtn: 'Cấp',
          renewBtn: 'Gia hạn',
          renewAll: 'Gia hạn tất cả',
          renewing: 'Đang gia hạn…',
          saveAuto: 'Lưu lịch',
          saving: 'Đang lưu…',
          autoOn: 'Bật tự gia hạn',
          schedule: 'Hàng ngày lúc',
          lastRun: 'Lần chạy cuối',
          cronStatus: 'Cron CoPanel',
          certbotTimer: 'Timer certbot OS',
          active: 'Đang bật',
          inactive: 'Tắt',
          installed: 'Đã cài',
          notInstalled: 'Chưa cài',
          loading: 'Đang tải…',
          noDomains: 'Không có tên miền.',
          domain: 'Tên miền',
          email: 'Email',
          cancel: 'Hủy',
          confirmIssue: 'Xác nhận cấp SSL',
          confirmRenew: 'Xác nhận gia hạn',
        },
      })[language === 'vi' ? 'vi' : 'en'],
    [language],
  );

  const labels: Record<SslTab, string> = {
    certificates: tr.certificates,
    issue: tr.issue,
    custom: tr.custom,
    auto_renew: tr.autoRenew,
  };

  const tabMeta: Record<SslTab, { title: string; desc: string }> = {
    certificates: { title: tr.certTitle, desc: tr.certDesc },
    issue: { title: tr.issueTitle, desc: tr.issueDesc },
    custom: { title: tr.customTitle, desc: tr.customDesc },
    auto_renew: { title: tr.autoTitle, desc: tr.autoDesc },
  };

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ssl_manager/certificates', { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        if (d.data) setCerts(d.data);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const fetchAutoRenew = useCallback(async () => {
    try {
      const res = await fetch('/api/ssl_manager/auto_renew', { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        const data = d.data as AutoRenewStatus;
        setAutoRenew(data);
        setAutoEnabled(!!data.enabled);
        setAutoHour(data.hour ?? 3);
        setAutoMinute(data.minute ?? 30);
      }
    } catch {
      /* ignore */
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchCerts();
    fetchAutoRenew();
  }, [fetchCerts, fetchAutoRenew]);

  const showMsg = (text: string, isError: boolean) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 5000);
  };

  const handleRenewAll = async () => {
    setRenewing(true);
    try {
      const res = await fetch('/api/ssl_manager/renew', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (res.ok) {
        showMsg(d.message || 'Renewed.', false);
        fetchCerts();
        fetchAutoRenew();
      } else {
        showMsg(d.detail || 'Renew failed', true);
      }
    } catch {
      showMsg('Connection error', true);
    } finally {
      setRenewing(false);
    }
  };

  const handleRenewDomain = async (domain: string) => {
    setRenewing(true);
    try {
      const res = await fetch(`/api/ssl_manager/renew/${encodeURIComponent(domain)}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(d.message || 'Renewed.', false);
        fetchCerts();
      } else {
        showMsg(d.detail || 'Renew failed', true);
      }
    } catch {
      showMsg('Connection error', true);
    } finally {
      setRenewing(false);
      setInlineDomain(null);
    }
  };

  const handleIssue = async (domain: string, email: string) => {
    try {
      const res = await fetch('/api/ssl_manager/issue', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ domain, email }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(d.message || 'Issued.', false);
        fetchCerts();
        setCertbotDomain('');
        setCertbotEmail('');
        setInlineDomain(null);
      } else {
        showMsg(d.detail || 'Issue failed', true);
      }
    } catch {
      showMsg('Connection error', true);
    }
  };

  const handleCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/ssl_manager/custom', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          domain: customDomain,
          private_key: customPrivateKey,
          certificate: customCertificate,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(d.message || 'Saved.', false);
        fetchCerts();
        setCustomDomain('');
        setCustomPrivateKey('');
        setCustomCertificate('');
      } else {
        showMsg(d.detail || 'Failed', true);
      }
    } catch {
      showMsg('Connection error', true);
    }
  };

  const handleSaveAutoRenew = async () => {
    setSavingAuto(true);
    try {
      const res = await fetch('/api/ssl_manager/auto_renew', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: autoEnabled, hour: autoHour, minute: autoMinute }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg(d.message || 'Saved.', false);
        fetchAutoRenew();
      } else {
        showMsg(d.detail || 'Save failed', true);
      }
    } catch {
      showMsg('Connection error', true);
    } finally {
      setSavingAuto(false);
    }
  };

  const openAction = (cert: Certificate) => {
    if (cert.active && cert.type === "Let's Encrypt") {
      setInlineMode('renew');
      setInlineDomain(cert.domain);
    } else {
      setInlineMode('issue');
      setInlineDomain(cert.domain);
      setInlineEmail(certbotEmail || `admin@${cert.domain}`);
    }
  };

  const card = cn(
    'rounded-2xl border p-5 shadow-sm',
    isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200',
  );
  const inputCls = cn(
    'w-full rounded-xl px-3 py-2.5 text-sm border transition focus:outline-none focus:border-teal-500',
    isDark
      ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-600'
      : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400',
  );

  const expiringCount = certs.filter((c) => c.active && (c.days_left ?? 99) <= 30).length;

  const renderCertificates = () => (
    <div className="space-y-4">
      {loading && certs.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Icons.Loader className="w-4 h-4 animate-spin text-teal-500" /> {tr.loading}
        </div>
      ) : certs.length > 0 ? (
        <div className={cn('overflow-x-auto border rounded-xl', isDark ? 'border-slate-800' : 'border-slate-100')}>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className={cn('border-b font-bold uppercase tracking-wider', isDark ? 'bg-slate-950/60 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500')}>
                <th className="p-3">{tr.domain}</th>
                <th className="p-3">Status</th>
                <th className="p-3">Type</th>
                <th className="p-3">Expiry</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y font-mono', isDark ? 'divide-slate-800 text-slate-200' : 'divide-slate-100 text-slate-700')}>
              {certs.map((cert) => (
                <tr key={cert.domain} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                  <td className="p-3 font-bold text-teal-500">{cert.domain}</td>
                  <td className="p-3">
                    <span className={cn('px-2 py-0.5 rounded border text-[10px] font-bold uppercase', cert.active ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10' : 'border-red-500/30 text-red-500 bg-red-500/10')}>
                      {cert.active ? tr.secured : tr.noSsl}
                    </span>
                  </td>
                  <td className="p-3">{cert.type}</td>
                  <td className="p-3">
                    <span className={cn((cert.days_left ?? 99) <= 14 && cert.active ? 'text-amber-500 font-bold' : 'text-slate-400')}>
                      {cert.expiry}
                      {cert.days_left !== undefined && cert.days_left >= 0 && ` (${cert.days_left}d)`}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => openAction(cert)}
                      className={cn('px-3 py-1.5 rounded-lg text-[11px] font-bold border transition', isDark ? 'border-teal-800 bg-teal-950/40 text-teal-400 hover:bg-teal-900/40' : 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100')}
                    >
                      {cert.active && cert.type === "Let's Encrypt" ? tr.renewBtn : tr.issueBtn}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.noDomains}</p>
      )}
    </div>
  );

  const renderIssue = () => (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        handleIssue(certbotDomain, certbotEmail);
      }}
    >
      <Field label={tr.domain} isDark={isDark}>
        <input value={certbotDomain} onChange={(e) => setCertbotDomain(e.target.value)} className={inputCls} placeholder="example.com" required />
      </Field>
      <Field label={tr.email} isDark={isDark}>
        <input type="email" value={certbotEmail} onChange={(e) => setCertbotEmail(e.target.value)} className={inputCls} placeholder="admin@example.com" required />
      </Field>
      <button type="submit" className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold flex items-center gap-2">
        <Icons.Zap className="w-4 h-4" /> {tr.issueBtn}
      </button>
    </form>
  );

  const renderCustom = () => (
    <form className="space-y-4" onSubmit={handleCustom}>
      <Field label={tr.domain} isDark={isDark}>
        <input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} className={inputCls} required />
      </Field>
      <Field label="Certificate (fullchain.pem)" isDark={isDark}>
        <textarea value={customCertificate} onChange={(e) => setCustomCertificate(e.target.value)} rows={4} className={cn(inputCls, 'font-mono resize-none')} required />
      </Field>
      <Field label="Private key" isDark={isDark}>
        <textarea value={customPrivateKey} onChange={(e) => setCustomPrivateKey(e.target.value)} rows={4} className={cn(inputCls, 'font-mono resize-none')} required />
      </Field>
      <button type="submit" className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold flex items-center gap-2">
        <Icons.Save className="w-4 h-4" /> Save
      </button>
    </form>
  );

  const renderAutoRenew = () => (
    <div className="space-y-5">
      <label className={cn('flex items-center justify-between gap-4 p-4 rounded-xl border', isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50')}>
        <div>
          <p className={cn('text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tr.autoOn}</p>
          <p className={cn('text-xs mt-1', isDark ? 'text-slate-400' : 'text-slate-500')}>
            {tr.schedule} {String(autoHour).padStart(2, '0')}:{String(autoMinute).padStart(2, '0')} UTC
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAutoEnabled((v) => !v)}
          className={cn('relative w-11 h-6 rounded-full transition', autoEnabled ? 'bg-emerald-600' : isDark ? 'bg-slate-700' : 'bg-slate-300')}
        >
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', autoEnabled ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </label>

      <div className="grid grid-cols-2 gap-3 max-w-xs">
        <Field label="Hour (0-23)" isDark={isDark}>
          <input type="number" min={0} max={23} value={autoHour} onChange={(e) => setAutoHour(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Minute (0-59)" isDark={isDark}>
          <input type="number" min={0} max={59} value={autoMinute} onChange={(e) => setAutoMinute(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>

      {autoRenew && (
        <div className={cn('grid gap-2 text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>
          <StatusRow label={tr.cronStatus} value={autoRenew.cron_installed ? tr.installed : tr.notInstalled} ok={autoRenew.cron_installed} isDark={isDark} />
          <StatusRow label={tr.certbotTimer} value={autoRenew.certbot_timer?.active ? tr.active : tr.inactive} ok={autoRenew.certbot_timer?.active} isDark={isDark} />
          <StatusRow label="Certbot" value={autoRenew.certbot_installed ? tr.installed : tr.notInstalled} ok={autoRenew.certbot_installed} isDark={isDark} />
          {autoRenew.last_run && (
            <p>
              {tr.lastRun}: {new Date(autoRenew.last_run).toLocaleString()} — {autoRenew.last_status}
              {autoRenew.last_message ? ` (${autoRenew.last_message})` : ''}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSaveAutoRenew}
          disabled={savingAuto}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
        >
          {savingAuto ? tr.saving : tr.saveAuto}
        </button>
        <button
          type="button"
          onClick={handleRenewAll}
          disabled={renewing}
          className={cn('px-4 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2', isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600')}
        >
          {renewing ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.RefreshCw className="w-4 h-4" />}
          {renewing ? tr.renewing : tr.renewAll}
        </button>
      </div>
    </div>
  );

  return (
    <ModuleViewport className="flex min-h-0 flex-col overflow-hidden">
      <ModuleSidebarLayout
        isDark={isDark}
        mobileTitle={tr.title}
        className={isDark ? 'text-slate-100' : 'text-slate-900'}
        sidebar={
          <SslManagerSidebar
            tab={tab}
            onTab={setTab}
            isDark={isDark}
            labels={labels}
            title={tr.title}
            subtitle={tr.subtitle}
            autoRenewOn={autoRenew?.enabled}
            counts={{ certificates: certs.length || undefined, auto_renew: expiringCount || undefined }}
          />
        }
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className={cn('min-h-0 flex-1 overflow-y-auto', windowed ? 'p-5' : 'p-5 md:p-8')}>
            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <h2 className={cn('text-lg font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tabMeta[tab].title}</h2>
                <p className={cn('text-xs max-w-2xl', isDark ? 'text-slate-400' : 'text-slate-500')}>{tabMeta[tab].desc}</p>
              </div>
              {tab === 'certificates' && (
                <button
                  type="button"
                  onClick={handleRenewAll}
                  disabled={renewing}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                >
                  <Icons.RefreshCw className={cn('w-4 h-4', renewing && 'animate-spin')} />
                  {tr.renewAll}
                </button>
              )}
            </header>

            {msg && (
              <div className={cn('mb-4 p-3 border rounded-xl text-xs flex items-center gap-2', msg.isError ? 'border-red-500/30 text-red-400 bg-red-950/20' : 'border-teal-500/30 text-teal-300 bg-teal-950/20')}>
                {msg.isError ? <Icons.AlertCircle className="w-4 h-4" /> : <Icons.CheckCircle2 className="w-4 h-4" />}
                {msg.text}
              </div>
            )}

            <div className={card}>
              {tab === 'certificates' && renderCertificates()}
              {tab === 'issue' && renderIssue()}
              {tab === 'custom' && renderCustom()}
              {tab === 'auto_renew' && renderAutoRenew()}
            </div>
          </main>
        </div>
      </ModuleSidebarLayout>

      <WindowModal
        open={!!inlineDomain}
        onClose={() => setInlineDomain(null)}
        title={inlineMode === 'renew' ? tr.confirmRenew : tr.confirmIssue}
        maxWidth="sm"
      >
        <div className="space-y-4 p-4">
          <p className={cn('font-mono text-sm font-bold', isDark ? 'text-teal-400' : 'text-teal-600')}>{inlineDomain}</p>
          {inlineMode === 'issue' && (
            <Field label={tr.email} isDark={isDark}>
              <input type="email" value={inlineEmail} onChange={(e) => setInlineEmail(e.target.value)} className={inputCls} required />
            </Field>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={() => setInlineDomain(null)} className={cn('px-3 py-2 rounded-xl text-xs font-bold border', isDark ? 'border-slate-700' : 'border-slate-200')}>
              {tr.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!inlineDomain) return;
                if (inlineMode === 'renew') handleRenewDomain(inlineDomain);
                else handleIssue(inlineDomain, inlineEmail);
              }}
              className="px-3 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
            >
              {inlineMode === 'renew' ? tr.renewBtn : tr.issueBtn}
            </button>
          </div>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}

function Field({ label, children, isDark }: { label: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={cn('text-[11px] font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>{label}</span>
      {children}
    </label>
  );
}

function StatusRow({ label, value, ok, isDark }: { label: string; value: string; ok: boolean; isDark: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className={cn('font-semibold', ok ? 'text-emerald-500' : isDark ? 'text-slate-500' : 'text-slate-400')}>{value}</span>
    </div>
  );
}
