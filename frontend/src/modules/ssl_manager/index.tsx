/**
 * SSL Manager Dashboard Component
 * Issue Free Certificates via Certbot or paste Custom certificates.
 */
import { useState, useEffect } from 'react';
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
  const [msg, setMsg] = useState<string | null>(null);

  // Certbot state
  const [certbotDomain, setCertbotDomain] = useState('');
  const [certbotEmail, setCertbotEmail] = useState('');

  // Custom SSL state
  const [customDomain, setCustomDomain] = useState('');
  const [customPrivateKey, setCustomPrivateKey] = useState('');
  const [customCertificate, setCustomCertificate] = useState('');

  const token = localStorage.getItem('copanel_token');

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

  const handleIssueCertbot = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Requesting Let\'s Encrypt certificate...');
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
        setMsg(`✓ Success: ${d.message}`);
        fetchCerts();
        setCertbotDomain('');
        setCertbotEmail('');
      } else {
        setMsg(`Error: ${d.detail || 'Could not issue SSL'}`);
      }
    } catch {
      setMsg('Error communicating with backend.');
    }
  };

  const handleCustomSSL = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Saving custom SSL files...');
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
        setMsg(`✓ Success: ${d.message}`);
        fetchCerts();
        setCustomDomain('');
        setCustomPrivateKey('');
        setCustomCertificate('');
      } else {
        setMsg(`Error: ${d.detail || 'Could not install custom SSL'}`);
      }
    } catch {
      setMsg('Error communicating with backend.');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Premium Ambient Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-teal-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-teal-400 via-emerald-200 to-white bg-clip-text text-transparent">
            SSL Certificate Manager
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Generate and manage Let's Encrypt certificates automatically with Certbot, or upload your own SSL fullchains and private keys directly.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-teal-400 uppercase tracking-widest">SSL Status</span>
          <span className="text-2xl font-mono font-bold text-slate-100">Certbot Ready</span>
        </div>
      </div>

      {msg && (
        <div className="p-3.5 bg-teal-900/20 border border-teal-600/30 rounded-xl text-teal-300 text-xs flex items-center gap-2 max-w-xl animate-pulse">
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {/* Active Certificates Table */}
      <div className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Icons.ShieldCheck className="w-5 h-5 text-teal-400" /> Domain SSL Listing
        </h3>
        {loading && certs.length === 0 ? (
          <p className="text-slate-400 text-xs">Loading domains...</p>
        ) : certs.length > 0 ? (
          <div className="overflow-x-auto border border-slate-800/60 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800/60 text-xs font-bold text-slate-300 uppercase tracking-widest">
                  <th className="p-4">Domain</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Expiry</th>
                </tr>
              </thead>
              <tbody className="text-xs text-slate-200 divide-y divide-slate-800/40 font-mono">
                {certs.map((cert, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30 transition-all">
                    <td className="p-4 font-bold text-blue-400">{cert.domain}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded border text-[10px] uppercase font-bold ${
                        cert.active ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}>
                        {cert.active ? 'Secured' : 'No SSL'}
                      </span>
                    </td>
                    <td className="p-4 text-slate-300">{cert.type}</td>
                    <td className="p-4 text-slate-400">{cert.expiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-slate-500 border border-slate-800/40 p-4 rounded-xl">
            No active website domains found to evaluate.
          </div>
        )}
      </div>

      {/* Issuing Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Let's Encrypt issuance */}
        <form onSubmit={handleIssueCertbot} className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit flex flex-col justify-between min-h-[380px]">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Icons.Shield className="w-5 h-5 text-teal-400" />
              Let's Encrypt Certbot
            </h3>
            <p className="text-xs text-slate-400">Issue a free, auto-renewing certificate directly to your domain server block.</p>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Domain Name</label>
                <input
                  type="text"
                  value={certbotDomain}
                  onChange={(e) => setCertbotDomain(e.target.value)}
                  placeholder="example.com"
                  required
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Notification Email</label>
                <input
                  type="email"
                  value={certbotEmail}
                  onChange={(e) => setCertbotEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-800/60">
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-teal-500/20"
            >
              <Icons.Zap className="w-3.5 h-3.5" /> Issue Certificate
            </button>
          </div>
        </form>

        {/* Custom SSL uploading */}
        <form onSubmit={handleCustomSSL} className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Icons.Key className="w-5 h-5 text-teal-400" />
            Custom SSL Certificate
          </h3>
          <p className="text-xs text-slate-400">Install an external SSL fullchain and private key directly into Nginx.</p>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Domain Name</label>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="example.com"
                required
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Certificate Content (fullchain.pem)</label>
              <textarea
                value={customCertificate}
                onChange={(e) => setCustomCertificate(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                required
                rows={3}
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none font-mono transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Private Key Content (privkey.pem)</label>
              <textarea
                value={customPrivateKey}
                onChange={(e) => setCustomPrivateKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                required
                rows={3}
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-teal-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none font-mono transition-all"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-blue-500/20"
            >
              <Icons.Save className="w-3.5 h-3.5" /> Save Custom SSL
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
