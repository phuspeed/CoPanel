/**
 * SSL Manager Dashboard Component
 * Issue Free Certificates via Certbot or paste Custom certificates.
 * Fully supports mobile responsive view and stunning dark/light theme.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface Certificate {
  domain: string;
  active: boolean;
  type: string;
  expiry: string;
}

export default function SSLManagerDashboard() {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  // Certbot state
  const [certbotDomain, setCertbotDomain] = useState('');
  const [certbotEmail, setCertbotEmail] = useState('');

  // Custom SSL state
  const [customDomain, setCustomDomain] = useState('');
  const [customPrivateKey, setCustomPrivateKey] = useState('');
  const [customCertificate, setCustomCertificate] = useState('');

  const token = localStorage.getItem('copanel_token');

  const t = {
    en: {
      title: 'SSL Certificate Manager',
      desc: 'Generate and manage Let\'s Encrypt certificates automatically with Certbot, or upload your own SSL fullchains and private keys directly.',
      status: 'SSL Status',
      ready: 'Certbot Ready',
      renewBtn: 'Auto Renew All SSL',
      renewing: 'Renewing...',
      loading: 'Loading domains...',
      listingTitle: 'Domain SSL Listing',
      colDomain: 'Domain',
      colStatus: 'Status',
      colType: 'Type',
      colExpiry: 'Expiry',
      noDomains: 'No active website domains found to evaluate.',
      secured: 'Secured',
      noSsl: 'No SSL',
      leTitle: 'Let\'s Encrypt Certbot',
      leDesc: 'Issue a free, auto-renewing certificate directly to your domain server block.',
      customTitle: 'Custom SSL Certificate',
      customDesc: 'Install an external SSL fullchain and private key directly into Nginx.',
      domainLabel: 'Domain Name',
      emailLabel: 'Notification Email',
      certLabel: 'Certificate Content (fullchain.pem)',
      keyLabel: 'Private Key Content (privkey.pem)',
      issueBtn: 'Issue Certificate',
      saveBtn: 'Save Custom SSL',
    },
    vi: {
      title: 'Quản lý Chứng chỉ SSL',
      desc: 'Tự động tạo và quản lý chứng chỉ Let\'s Encrypt bằng Certbot, hoặc tải lên các tệp fullchain và khóa riêng SSL tùy chỉnh của bạn.',
      status: 'Trạng thái SSL',
      ready: 'Sẵn sàng Certbot',
      renewBtn: 'Tự động Gia hạn SSL',
      renewing: 'Đang gia hạn...',
      loading: 'Đang tải danh sách tên miền...',
      listingTitle: 'Danh sách Tên miền & SSL',
      colDomain: 'Tên miền',
      colStatus: 'Trạng thái',
      colType: 'Loại',
      colExpiry: 'Ngày hết hạn',
      noDomains: 'Không tìm thấy tên miền hoạt động nào.',
      secured: 'Đã bảo mật',
      noSsl: 'Chưa có SSL',
      leTitle: 'Let\'s Encrypt Certbot',
      leDesc: 'Cấp chứng chỉ miễn phí, tự động gia hạn trực tiếp cho tên miền của bạn.',
      customTitle: 'Chứng chỉ SSL Tùy chỉnh',
      customDesc: 'Cài đặt tệp fullchain và khóa riêng SSL bên ngoài trực tiếp vào Nginx.',
      domainLabel: 'Tên miền (Domain Name)',
      emailLabel: 'Email thông báo',
      certLabel: 'Nội dung chứng chỉ (fullchain.pem)',
      keyLabel: 'Nội dung khóa riêng (privkey.pem)',
      issueBtn: 'Cấp chứng chỉ',
      saveBtn: 'Lưu SSL Tùy chỉnh',
    }
  };

  const tr = t[language || 'en'];

  const fetchCerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ssl_manager/certificates', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const d = await res.json();
        if (d.data) setCerts(d.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCerts();
  }, []);

  const handleRenewSSL = async () => {
    setRenewing(true);
    setMsg({ text: 'Renewing all available Let\'s Encrypt certificates...', isError: false });
    try {
      const res = await fetch('/api/ssl_manager/renew', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const d = await res.json();
      if (res.ok) {
        setMsg({ text: `✓ Success: ${d.message || 'SSL certificates successfully renewed.'}`, isError: false });
        fetchCerts();
      } else {
        setMsg({ text: `Error: ${d.detail || 'Failed to renew SSL'}`, isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    } finally {
      setRenewing(false);
    }
  };

  const handleIssueCertbot = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: 'Requesting Let\'s Encrypt certificate...', isError: false });
    try {
      const res = await fetch('/api/ssl_manager/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ domain: certbotDomain, email: certbotEmail })
      });
      const d = await res.json();
      if (res.ok) {
        setMsg({ text: `✓ Success: ${d.message}`, isError: false });
        fetchCerts();
        setCertbotDomain('');
        setCertbotEmail('');
      } else {
        setMsg({ text: `Error: ${d.detail || 'Could not issue SSL'}`, isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    }
  };

  const handleCustomSSL = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: 'Saving custom SSL files...', isError: false });
    try {
      const res = await fetch('/api/ssl_manager/custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          domain: customDomain,
          private_key: customPrivateKey,
          certificate: customCertificate
        })
      });
      const d = await res.json();
      if (res.ok) {
        setMsg({ text: `✓ Success: ${d.message}`, isError: false });
        fetchCerts();
        setCustomDomain('');
        setCustomPrivateKey('');
        setCustomCertificate('');
      } else {
        setMsg({ text: `Error: ${d.detail || 'Could not install custom SSL'}`, isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Premium Ambient Banner */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-teal-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-teal-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
            isDark ? 'bg-gradient-to-r from-teal-400 via-emerald-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-teal-600 via-emerald-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Shield className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-teal-400' : 'text-teal-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex flex-col items-center md:items-end gap-3 self-stretch md:self-auto">
          <div className={`flex flex-col items-center md:items-end gap-1 text-center md:text-right px-4 py-3 rounded-xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] ${
            isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white/80 border-slate-200 shadow-sm'
          }`}>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-teal-400' : 'text-teal-600'}`}>{tr.status}</span>
            <span className={`text-lg md:text-xl font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.ready}</span>
          </div>
          <button
            onClick={handleRenewSSL}
            disabled={renewing}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md ${
              isDark ? 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-emerald-500/20' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {renewing ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.RefreshCw className="w-4 h-4" />}
            {renewing ? tr.renewing : tr.renewBtn}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3.5 border rounded-xl text-xs flex items-center gap-2 animate-fade-in ${
          msg.isError
            ? (isDark ? 'bg-red-950/20 border-red-600/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600')
            : (isDark ? 'bg-teal-950/20 border-teal-600/30 text-teal-300' : 'bg-teal-50 border-teal-200 text-teal-600')
        }`}>
          {msg.isError ? <Icons.AlertCircle className="w-4 h-4 shrink-0" /> : <Icons.Info className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Active Certificates Table */}
      <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 shadow-sm ${
        isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
      }`}>
        <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          <Icons.ShieldCheck className={`w-5 h-5 ${isDark ? 'text-teal-400' : 'text-teal-600'}`} /> {tr.listingTitle}
        </h3>
        {loading && certs.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Icons.Loader className="w-4 h-4 animate-spin text-teal-500" />
            <p>{tr.loading}</p>
          </div>
        ) : certs.length > 0 ? (
          <div className={`overflow-x-auto border rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
            <table className="w-full text-left border-collapse select-none">
              <thead>
                <tr className={`border-b text-xs font-bold uppercase tracking-widest ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50/80 border-slate-100 text-slate-600'
                }`}>
                  <th className="p-4">{tr.colDomain}</th>
                  <th className="p-4">{tr.colStatus}</th>
                  <th className="p-4">{tr.colType}</th>
                  <th className="p-4">{tr.colExpiry}</th>
                </tr>
              </thead>
              <tbody className={`text-xs divide-y font-mono ${
                isDark ? 'text-slate-200 divide-slate-800/40' : 'text-slate-700 divide-slate-100'
              }`}>
                {certs.map((cert, idx) => (
                  <tr key={idx} className={`transition-all ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/60'}`}>
                    <td className={`p-4 font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{cert.domain}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-0.5 rounded border text-[10px] uppercase font-bold transition-all ${
                        cert.active
                          ? 'bg-green-500/10 text-green-500 border-green-500/20'
                          : 'bg-red-500/10 text-red-500 border-red-500/20'
                      }`}>
                        {cert.active ? tr.secured : tr.noSsl}
                      </span>
                    </td>
                    <td className="p-4">{cert.type}</td>
                    <td className="p-4 text-slate-400">{cert.expiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
            isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
          }`}>
            {tr.noDomains}
          </div>
        )}
      </div>

      {/* Issuing Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        {/* Let's Encrypt issuance */}
        <form onSubmit={handleIssueCertbot} className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 flex flex-col justify-between transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <div className="space-y-4">
            <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              <Icons.Shield className={`w-5 h-5 ${isDark ? 'text-teal-400' : 'text-teal-600'}`} />
              {tr.leTitle}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {tr.leDesc}
            </p>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.domainLabel}</label>
                <input
                  type="text"
                  value={certbotDomain}
                  onChange={(e) => setCertbotDomain(e.target.value)}
                  placeholder="example.com"
                  required
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 transition-all ${
                    isDark ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.emailLabel}</label>
                <input
                  type="email"
                  value={certbotEmail}
                  onChange={(e) => setCertbotEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 transition-all ${
                    isDark ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                  }`}
                />
              </div>
            </div>
          </div>

          <div className={`flex flex-wrap items-center gap-2 pt-4 border-t ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-3 py-3 bg-teal-600 hover:bg-teal-500 rounded-xl font-bold text-xs text-white transition-all shadow-md"
            >
              <Icons.Zap className="w-4 h-4" /> {tr.issueBtn}
            </button>
          </div>
        </form>

        {/* Custom SSL uploading */}
        <form onSubmit={handleCustomSSL} className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <Icons.Key className={`w-5 h-5 ${isDark ? 'text-teal-400' : 'text-teal-600'}`} />
            {tr.customTitle}
          </h3>
          <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {tr.customDesc}
          </p>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.domainLabel}</label>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="example.com"
                required
                className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 transition-all ${
                  isDark ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.certLabel}</label>
              <textarea
                value={customCertificate}
                onChange={(e) => setCustomCertificate(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                required
                rows={3}
                className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 font-mono transition-all resize-none ${
                  isDark ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.keyLabel}</label>
              <textarea
                value={customPrivateKey}
                onChange={(e) => setCustomPrivateKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                required
                rows={3}
                className={`w-full border rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-teal-500 font-mono transition-all resize-none ${
                  isDark ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                }`}
              />
            </div>
          </div>

          <div className={`flex flex-wrap items-center gap-2 pt-2 border-t ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-3 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-xs text-white transition-all shadow-md"
            >
              <Icons.Save className="w-4 h-4" /> {tr.saveBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
