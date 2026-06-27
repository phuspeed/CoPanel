/**
 * Premium Glassmorphic Login Component for CoPanel
 */
import { useState } from 'react';
import * as Icons from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, user: any) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || (need2fa && !totpCode)) {
      setError('Please fill in all fields.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          totp_code: totpCode || undefined,
        }),
      });

      const errData = await response.json().catch(() => ({}));

      if (response.ok) {
        if (errData.access_token) {
          onLoginSuccess(errData.access_token, errData.user);
        } else if (errData.data?.access_token) {
          onLoginSuccess(errData.data.access_token, errData.data.user);
        } else {
          setError('Invalid login response from server.');
        }
      } else {
        const errObj = errData.error || errData;
        if (
          errObj?.code === 'TOTP_REQUIRED' ||
          errObj?.details?.need_2fa ||
          errData.detail?.details?.need_2fa
        ) {
          setNeed2fa(true);
          setError('Enter the 6-digit code from your authenticator app.');
        } else {
          setError(errObj?.message || errData.detail || 'Access denied. Invalid credentials.');
        }
      }
    } catch {
      setError('Network error. Unable to contact authentication endpoint.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[160px] pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[160px] pointer-events-none animate-pulse"></div>

      <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/80 p-8 md:p-10 rounded-3xl backdrop-blur-xl shadow-2xl space-y-8 relative z-10 transition-all">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400 shadow-lg shadow-blue-500/5">
            <Icons.Server className="w-7 h-7 animate-bounce" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent">
              CoPanel Access
            </h1>
            <p className="text-slate-400 text-xs mt-1">Lightweight VPS Management</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <Icons.AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Username</label>
              <div className="relative">
                <Icons.User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  disabled={need2fa}
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-blue-500 rounded-xl px-10 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all duration-200 select-none disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Password</label>
              <div className="relative">
                <Icons.Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={need2fa}
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-blue-500 rounded-xl px-10 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all duration-200 select-none disabled:opacity-60"
                />
              </div>
            </div>

            {need2fa && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Authenticator code</label>
                <div className="relative">
                  <Icons.Shield className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="123456"
                    className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-blue-500 rounded-xl px-10 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all duration-200 select-none"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/50 rounded-xl font-bold text-sm text-white shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all duration-200"
          >
            {loading ? (
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Icons.ArrowRight className="w-4 h-4" />
            )}
            {need2fa ? 'Verify & Sign In' : 'Sign In'}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800/50 text-center text-xs text-slate-500">
          <span>Security-first pluggable access</span>
        </div>
      </div>
    </div>
  );
}
