/**
 * Backup and Sync Manager
 * Supports automated local directory backups, cron automation, and Google Drive Rclone configuration.
 */
import { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';

export default function BackupAndSyncDashboard() {
  const [config, setConfig] = useState<any>({
    source_dir: '',
    rclone_remote_name: 'gdrive',
    rclone_folder: 'CoPanel-Backups',
    google_drive_client_id: '',
    google_drive_client_secret: '',
    google_drive_refresh_token: '',
    cron_expression: '0 0 * * *',
  });
  const [cronjobs, setCronjobs] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const token = localStorage.getItem('copanel_token');

  const fetchConfigAndCrons = async () => {
    try {
      const cr = await fetch('/api/backup_manager/config', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (cr.ok) {
        const d = await cr.json();
        if (d.data) setConfig(d.data);
      }

      const cronsRes = await fetch('/api/backup_manager/cronjobs', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (cronsRes.ok) {
        const cData = await cronsRes.json();
        if (cData.data) setCronjobs(cData.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConfigAndCrons();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setMsg('Configuration saved successfully! ✓');
        fetchConfigAndCrons();
      } else {
        setMsg('Failed to save configuration.');
      }
    } catch {
      setMsg('Failed to communicate with the backend.');
    }
  };

  const handleSetupCron = async () => {
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/cronjobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cron_expression: config.cron_expression })
      });
      if (res.ok) {
        setMsg('Successfully scheduled cron timer!');
        fetchConfigAndCrons();
      } else {
        setMsg('Failed to create crontab timer.');
      }
    } catch {
      setMsg('Error communicating with backend.');
    }
  };

  const handleDeleteCrons = async () => {
    if (!window.confirm('Clear all backup cron entries?')) return;
    setMsg(null);
    try {
      const res = await fetch('/api/backup_manager/cronjobs/delete', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        setMsg('Cleared backup crons.');
        fetchConfigAndCrons();
      }
    } catch {
      setMsg('Error connecting to backend.');
    }
  };

  const handleBackupNow = async () => {
    setMsg('Backing up now, please wait...');
    try {
      const res = await fetch('/api/backup_manager/backup-now', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`Success: ${data.message}`);
      } else {
        setMsg(`Error: ${data.detail || 'Backup failed.'}`);
      }
    } catch {
      setMsg('Error invoking backup.');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Premium Ambient Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-200 to-white bg-clip-text text-transparent">
            Automated Backups & Sync
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Automate daily backups of your target directories. Configure rclone to seamlessly sync generated archives directly to your Google Drive remote.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Storage Status</span>
          <span className="text-2xl font-mono font-bold text-slate-100">Rclone Ready</span>
        </div>
      </div>

      {msg && (
        <div className="p-3.5 bg-indigo-900/20 border border-indigo-600/30 rounded-xl text-indigo-300 text-xs flex items-center gap-2 max-w-xl">
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Backup and Cloud config */}
        <form onSubmit={handleSaveConfig} className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Icons.Settings className="w-5 h-5 text-indigo-400" />
            Configurations
          </h3>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Local Target Directory</label>
              <input
                type="text"
                value={config.source_dir}
                onChange={(e) => setConfig({ ...config, source_dir: e.target.value })}
                placeholder="/var/www/html"
                required
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
              <span className="text-[10px] text-slate-500 block leading-tight">Folder to backup.</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Cron Schedule Expression</label>
              <input
                type="text"
                value={config.cron_expression}
                onChange={(e) => setConfig({ ...config, cron_expression: e.target.value })}
                placeholder="0 0 * * *"
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all font-mono"
              />
              <span className="text-[10px] text-slate-500 block leading-tight">Crontab standard syntax (e.g. 0 0 * * * for daily midnight).</span>
            </div>

            <div className="border-t border-slate-800/80 pt-4 space-y-3">
              <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                <Icons.Cloud className="w-3.5 h-3.5" /> Google Drive Rclone Config
              </h4>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 uppercase">Google Client ID</label>
                <input
                  type="text"
                  value={config.google_drive_client_id}
                  onChange={(e) => setConfig({ ...config, google_drive_client_id: e.target.value })}
                  placeholder="Paste client id here"
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 uppercase">Google Client Secret</label>
                <input
                  type="password"
                  value={config.google_drive_client_secret}
                  onChange={(e) => setConfig({ ...config, google_drive_client_secret: e.target.value })}
                  placeholder="Paste client secret here"
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300 uppercase">Google OAuth Token (Refresh Token)</label>
                <textarea
                  value={config.google_drive_refresh_token}
                  onChange={(e) => setConfig({ ...config, google_drive_refresh_token: e.target.value })}
                  placeholder='Paste rclone refresh token JSON here e.g. {"access_token":"...","token_type":"Bearer"}'
                  rows={3}
                  className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-indigo-500/20"
            >
              <Icons.Save className="w-3.5 h-3.5" /> Save Config
            </button>
            <button
              type="button"
              onClick={handleBackupNow}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-green-500/20"
            >
              <Icons.Zap className="w-3.5 h-3.5" /> Sync Now
            </button>
          </div>
        </form>

        {/* Schedule management */}
        <div className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit flex flex-col justify-between min-h-[360px]">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Icons.Calendar className="w-5 h-5 text-indigo-400" />
              Automated Scheduling (Crontab)
            </h3>
            <p className="text-xs text-slate-400">Manage active automated backup cron scripts below.</p>

            {cronjobs.length > 0 ? (
              <div className="space-y-2 border border-slate-800/60 bg-slate-950/40 p-4 rounded-xl max-h-[160px] overflow-y-auto">
                {cronjobs.map((job, idx) => (
                  <div key={idx} className="font-mono text-xs p-2 bg-slate-900 border border-slate-800 rounded-lg text-indigo-300 truncate">
                    {job}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 border border-slate-800/40 p-4 rounded-xl">
                No active CoPanel crons found.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-800/60">
            <button
              type="button"
              onClick={handleSetupCron}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-xs text-white transition-all shadow-lg hover:shadow-blue-500/20"
            >
              <Icons.Clock className="w-3.5 h-3.5" /> Register Cron
            </button>
            <button
              type="button"
              onClick={handleDeleteCrons}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-red-950/40 hover:bg-red-900/40 text-red-400 font-bold border border-red-900/40 rounded-xl transition-all"
            >
              <Icons.Trash2 className="w-3.5 h-3.5" /> Clear Backup Cron
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
