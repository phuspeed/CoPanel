import { useCallback, useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../../core/platform';

interface DateTimeStatus {
  current_time: string;
  timezone: string;
  ntp_enabled: boolean;
  ntp_synchronized: boolean;
  google_ntp_configured: boolean;
  can_ntp: boolean;
  is_linux: boolean;
}

interface Props {
  isDark: boolean;
  language: 'en' | 'vi';
  isLinux: boolean;
  card: string;
  input: string;
  label: string;
  onError: (message: string) => void;
  onSaved: (message: string) => void;
}

export default function DateTimePanel({
  isDark,
  language,
  isLinux,
  card,
  input,
  label,
  onError,
  onSaved,
}: Props) {
  const [status, setStatus] = useState<DateTimeStatus | null>(null);
  const [timezones, setTimezones] = useState<string[]>([]);
  const [tzQuery, setTzQuery] = useState('');
  const [selectedTz, setSelectedTz] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [manualConfirm, setManualConfirm] = useState(false);
  const [ntpEnabled, setNtpEnabled] = useState(false);
  const [useGoogle, setUseGoogle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const t = {
    en: {
      title: 'Date & time',
      desc: 'Set system timezone, adjust clock manually, or sync automatically with Google NTP servers.',
      currentTime: 'Current system time',
      timezone: 'Timezone',
      timezoneHint: 'Search and select a timezone (IANA format, e.g. Asia/Ho_Chi_Minh).',
      applyTimezone: 'Apply timezone',
      manualTime: 'Manual time',
      manualHint: 'Disable NTP sync first if enabled. Format: YYYY-MM-DD HH:MM:SS',
      manualConfirm: 'I understand — apply manual time change',
      applyTime: 'Set time',
      ntpSync: 'Automatic time sync',
      ntpHint: 'Sync system clock with Google public NTP servers (time.google.com).',
      enableNtp: 'Enable NTP sync (Google servers)',
      ntpStatus: 'NTP status',
      synchronized: 'Synchronized',
      notSynchronized: 'Not synchronized',
      googleConfigured: 'Google NTP configured',
      applyNtp: 'Save NTP settings',
      refresh: 'Refresh',
      linuxOnly: 'Date/time settings require a Linux server.',
      searchTz: 'Search timezone…',
    },
    vi: {
      title: 'Ngày & giờ',
      desc: 'Chọn múi giờ, chỉnh giờ thủ công hoặc đồng bộ tự động với máy chủ NTP của Google.',
      currentTime: 'Giờ hệ thống hiện tại',
      timezone: 'Múi giờ',
      timezoneHint: 'Tìm và chọn múi giờ (định dạng IANA, ví dụ Asia/Ho_Chi_Minh).',
      applyTimezone: 'Áp dụng múi giờ',
      manualTime: 'Chỉnh giờ thủ công',
      manualHint: 'Tắt đồng bộ NTP trước nếu đang bật. Định dạng: YYYY-MM-DD HH:MM:SS',
      manualConfirm: 'Tôi hiểu — áp dụng đổi giờ thủ công',
      applyTime: 'Đặt giờ',
      ntpSync: 'Đồng bộ giờ tự động',
      ntpHint: 'Đồng bộ đồng hồ hệ thống với máy chủ NTP công cộng của Google (time.google.com).',
      enableNtp: 'Bật đồng bộ NTP (máy chủ Google)',
      ntpStatus: 'Trạng thái NTP',
      synchronized: 'Đã đồng bộ',
      notSynchronized: 'Chưa đồng bộ',
      googleConfigured: 'Đã cấu hình NTP Google',
      applyNtp: 'Lưu cài đặt NTP',
      refresh: 'Làm mới',
      linuxOnly: 'Cài đặt ngày/giờ chỉ khả dụng trên Linux.',
      searchTz: 'Tìm múi giờ…',
    },
  }[language];

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<DateTimeStatus>('/api/panel_settings/datetime');
      setStatus(data);
      setSelectedTz(data.timezone);
      setManualTime(data.current_time);
      setNtpEnabled(data.ntp_enabled);
      setUseGoogle(true);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadTimezones = useCallback(async (query: string) => {
    try {
      const data = await api<{ timezones: string[] }>(
        `/api/panel_settings/datetime/timezones?query=${encodeURIComponent(query)}&limit=200`,
      );
      setTimezones(data.timezones || []);
    } catch (err: any) {
      onError(err.message);
    }
  }, [onError]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadTimezones(tzQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tzQuery, loadTimezones]);

  const applyTimezone = async () => {
    setBusy(true);
    onError('');
    try {
      await api('/api/panel_settings/datetime/timezone', {
        method: 'PUT',
        body: { timezone: selectedTz },
      });
      onSaved('Saved.');
      await loadStatus();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyManualTime = async () => {
    setBusy(true);
    onError('');
    try {
      await api('/api/panel_settings/datetime/time', {
        method: 'PUT',
        body: { datetime: manualTime, confirm: manualConfirm },
      });
      onSaved('Saved.');
      await loadStatus();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyNtp = async () => {
    setBusy(true);
    onError('');
    try {
      await api('/api/panel_settings/datetime/ntp', {
        method: 'PUT',
        body: { enabled: ntpEnabled, use_google: useGoogle },
      });
      onSaved('Saved.');
      await loadStatus();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Icons.Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          <p className={`text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.desc}</p>
        </div>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-lg text-sm border ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}
          onClick={() => loadStatus()}
        >
          <span className="inline-flex items-center gap-1.5">
            <Icons.RefreshCw className="w-3.5 h-3.5" />
            {t.refresh}
          </span>
        </button>
      </div>

      {!isLinux && (
        <p className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{t.linuxOnly}</p>
      )}

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={card}>
            <p className={`text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.currentTime}</p>
            <p className="font-mono text-sm mt-2">{status.current_time}</p>
          </div>
          <div className={card}>
            <p className={`text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.timezone}</p>
            <p className="font-mono text-sm mt-2">{status.timezone}</p>
          </div>
          <div className={card}>
            <p className={`text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.ntpStatus}</p>
            <p className="text-sm mt-2">
              {status.ntp_enabled ? (
                status.ntp_synchronized ? t.synchronized : t.notSynchronized
              ) : (
                '—'
              )}
            </p>
            {status.google_ntp_configured && (
              <p className={`text-xs mt-1 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{t.googleConfigured}</p>
            )}
          </div>
        </div>
      )}

      <div className={card}>
        <h3 className="text-sm font-semibold mb-3">{t.timezone}</h3>
        <p className={`text-sm mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.timezoneHint}</p>
        <label className={label}>{t.searchTz}</label>
        <input className={input} value={tzQuery} onChange={(e) => setTzQuery(e.target.value)} placeholder="Asia/Ho_Chi_Minh" />
        <label className={`${label} mt-3`}>{t.timezone}</label>
        <select
          className={input}
          value={selectedTz}
          onChange={(e) => setSelectedTz(e.target.value)}
          size={8}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          disabled={busy || !isLinux || !selectedTz}
          onClick={applyTimezone}
        >
          {t.applyTimezone}
        </button>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold mb-3">{t.manualTime}</h3>
        <p className={`text-sm mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.manualHint}</p>
        <label className={label}>{t.manualTime}</label>
        <input
          className={input}
          value={manualTime}
          onChange={(e) => setManualTime(e.target.value)}
          placeholder="2026-07-12 14:30:00"
        />
        <label className="flex items-center gap-2 mt-4 text-sm">
          <input type="checkbox" checked={manualConfirm} onChange={(e) => setManualConfirm(e.target.checked)} />
          {t.manualConfirm}
        </label>
        <button
          type="button"
          className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          disabled={busy || !isLinux || !manualConfirm}
          onClick={applyManualTime}
        >
          {t.applyTime}
        </button>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold mb-3">{t.ntpSync}</h3>
        <p className={`text-sm mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.ntpHint}</p>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={ntpEnabled} onChange={(e) => setNtpEnabled(e.target.checked)} />
          {t.enableNtp}
        </label>
        {ntpEnabled && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useGoogle} onChange={(e) => setUseGoogle(e.target.checked)} />
            time.google.com
          </label>
        )}
        <button
          type="button"
          className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          disabled={busy || !isLinux}
          onClick={applyNtp}
        >
          {t.applyNtp}
        </button>
      </div>
    </div>
  );
}
