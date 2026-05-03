/**
 * PHP Manager Dashboard - Upgraded
 * Features: multi-version selector, enable/disable modules, php.ini editor, tabs
 */
import { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

const INSTALLABLE_VERSIONS = ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4'];

const ALL_PHP_MODULES = [
  'bcmath','calendar','curl','dom','exif','fileinfo','filter','ftp',
  'gd','gettext','gmp','hash','iconv','imap','intl','json',
  'ldap','mbstring','mysqli','mysqlnd','opcache','openssl','pcntl',
  'pcre','pdo','pdo_mysql','pdo_pgsql','pdo_sqlite','pgsql','posix',
  'readline','redis','session','shmop','simplexml','soap','sockets',
  'sodium','sqlite3','sysvmsg','sysvsem','sysvshm','tokenizer',
  'xml','xmlreader','xmlrpc','xmlwriter','xsl','zip','zlib',
  'imagick','xdebug','memcached','mongodb','apcu',
];

type Tab = 'versions' | 'modules' | 'ini';
type ModuleState = Record<string, boolean>;

interface InstalledVersion {
  version: string;
  status: 'active' | 'installed' | 'available';
}

export default function PHPManagerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark'|'light'; language: 'en'|'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const [tab, setTab] = useState<Tab>('versions');
  const [versions, setVersions] = useState<InstalledVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('8.2');
  const [moduleStates, setModuleStates] = useState<ModuleState>({});
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all'|'enabled'|'disabled'>('all');
  const [phpIniContent, setPhpIniContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState<string|null>(null);
  const [togglingMod, setTogglingMod] = useState<string|null>(null);
  const [msg, setMsg] = useState<{text:string;isError:boolean}|null>(null);

  const tr = {
    en: {
      title:'PHP Manager', desc:'Install PHP versions, manage extensions, edit php.ini.',
      tabVersions:'Versions', tabModules:'Extensions', tabIni:'php.ini',
      install:'Install', uninstall:'Remove', setActive:'Set Active',
      active:'Active', installed:'Installed', available:'Available',
      saveIni:'Save & Reload', cancel:'Cancel', saving:'Saving...',
      modSearch:'Search extensions...', enabled:'Enabled', disabled:'Disabled',
      allMods:'All', enabledMods:'Enabled', disabledMods:'Disabled',
      loading:'Loading...', noVersions:'No versions found.',
    },
    vi: {
      title:'Quản lý PHP', desc:'Cài đặt phiên bản PHP, bật/tắt extension, chỉnh php.ini.',
      tabVersions:'Phiên bản', tabModules:'Extensions', tabIni:'php.ini',
      install:'Cài đặt', uninstall:'Gỡ', setActive:'Đặt mặc định',
      active:'Đang dùng', installed:'Đã cài', available:'Có thể cài',
      saveIni:'Lưu & Reload', cancel:'Hủy', saving:'Đang lưu...',
      modSearch:'Tìm extension...', enabled:'Bật', disabled:'Tắt',
      allMods:'Tất cả', enabledMods:'Đang bật', disabledMods:'Đang tắt',
      loading:'Đang tải...', noVersions:'Chưa có phiên bản nào.',
    }
  }[language || 'en'];

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }), [token]);

  const showMsg = (text: string, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 4000);
  };

  // Fetch versions list
  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/php_manager/versions', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const installed: string[] = data.versions || [];
        const active: string = data.active || installed[0] || '';
        setVersions(INSTALLABLE_VERSIONS.map(v => ({
          version: v,
          status: v === active ? 'active' : installed.includes(v) ? 'installed' : 'available'
        })));
        if (!selectedVersion) setSelectedVersion(active || '8.2');
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // Fetch modules for selected version
  const fetchModules = async (ver: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/php_manager/modules/${ver}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const enabled: string[] = data.enabled || data.modules || [];
        const init: ModuleState = {};
        ALL_PHP_MODULES.forEach(m => { init[m] = enabled.includes(m); });
        setModuleStates(init);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // Fetch php.ini
  const fetchIni = async (ver: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/php_manager/php_ini/${ver}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setPhpIniContent(data.content || '');
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVersions(); }, []);
  useEffect(() => {
    if (tab === 'modules') fetchModules(selectedVersion);
    if (tab === 'ini') fetchIni(selectedVersion);
  }, [tab, selectedVersion]);

  const handleInstall = async (ver: string) => {
    setInstalling(ver);
    try {
      const res = await fetch('/api/php_manager/install', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ version: ver })
      });
      const d = await res.json();
      showMsg(d.message || 'Done.', !res.ok);
      if (res.ok) fetchVersions();
    } catch { showMsg('Connection error.', true); }
    finally { setInstalling(null); }
  };

  const handleUninstall = async (ver: string) => {
    if (!confirm(`Remove PHP ${ver}?`)) return;
    try {
      const res = await fetch(`/api/php_manager/uninstall/${ver}`, {
        method: 'DELETE', headers: authHeaders
      });
      const d = await res.json();
      showMsg(d.message || 'Done.', !res.ok);
      if (res.ok) fetchVersions();
    } catch { showMsg('Connection error.', true); }
  };

  const handleSetActive = async (ver: string) => {
    try {
      const res = await fetch('/api/php_manager/set_active', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ version: ver })
      });
      const d = await res.json();
      showMsg(d.message || 'Done.', !res.ok);
      if (res.ok) fetchVersions();
    } catch { showMsg('Connection error.', true); }
  };

  const handleToggleModule = async (mod: string, enable: boolean) => {
    setTogglingMod(mod);
    const prev = moduleStates[mod];
    setModuleStates(s => ({ ...s, [mod]: enable }));
    try {
      const res = await fetch('/api/php_manager/module_toggle', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ version: selectedVersion, module: mod, enable })
      });
      if (!res.ok) {
        setModuleStates(s => ({ ...s, [mod]: prev }));
        const d = await res.json();
        showMsg(d.detail || 'Failed.', true);
      }
    } catch {
      setModuleStates(s => ({ ...s, [mod]: prev }));
      showMsg('Connection error.', true);
    }
    finally { setTogglingMod(null); }
  };

  const handleSaveIni = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/php_manager/php_ini/${selectedVersion}`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ content: phpIniContent })
      });
      const d = await res.json();
      showMsg(d.message || 'Saved.', !res.ok);
    } catch { showMsg('Connection error.', true); }
    finally { setSaving(false); }
  };

  const filteredModules = useMemo(() =>
    ALL_PHP_MODULES.filter(m => {
      const matchSearch = m.toLowerCase().includes(moduleSearch.toLowerCase());
      const matchFilter = moduleFilter === 'all' || (moduleFilter === 'enabled' ? moduleStates[m] : !moduleStates[m]);
      return matchSearch && matchFilter;
    }), [moduleSearch, moduleFilter, moduleStates]);

  // ─── Styles helpers ───
  const card = `rounded-2xl border p-5 md:p-6 ${isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'} shadow-sm`;
  const btn = (color: string) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 border ${color}`;
  const tabCls = (t: Tab) => `px-4 py-2 text-xs font-semibold rounded-lg transition ${tab===t
    ? (isDark ? 'bg-blue-600 text-white' : 'bg-blue-600 text-white')
    : (isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100')}`;
  const statusBadge = (s: InstalledVersion['status']) => {
    if (s==='active') return isDark ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-green-50 text-green-600 border-green-200';
    if (s==='installed') return isDark ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-blue-50 text-blue-600 border-blue-200';
    return isDark ? 'bg-slate-700/40 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200';
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5 select-none">
      {/* Header */}
      <div className={`${card} flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div>
          <h2 className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
            <Icons.Cpu className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.desc}</p>
        </div>
        {/* Version selector */}
        <div className="flex items-center gap-2">
          <Icons.Code2 className={`w-4 h-4 shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
          <select
            value={selectedVersion}
            onChange={e => setSelectedVersion(e.target.value)}
            className={`text-xs font-mono font-semibold px-3 py-2 rounded-lg border transition focus:outline-none focus:border-blue-500 ${
              isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            {INSTALLABLE_VERSIONS.map(v => (
              <option key={v} value={v}>PHP {v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`p-3 border rounded-xl text-xs flex items-center gap-2 ${
          msg.isError
            ? (isDark ? 'bg-red-950/20 border-red-600/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600')
            : (isDark ? 'bg-green-950/20 border-green-600/30 text-green-400' : 'bg-green-50 border-green-200 text-green-700')
        }`}>
          {msg.isError ? <Icons.AlertCircle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle2 className="w-4 h-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button className={tabCls('versions')} onClick={() => setTab('versions')}>
          <span className="flex items-center gap-1.5"><Icons.Layers className="w-3.5 h-3.5" />{tr.tabVersions}</span>
        </button>
        <button className={tabCls('modules')} onClick={() => setTab('modules')}>
          <span className="flex items-center gap-1.5"><Icons.Box className="w-3.5 h-3.5" />{tr.tabModules}</span>
        </button>
        <button className={tabCls('ini')} onClick={() => setTab('ini')}>
          <span className="flex items-center gap-1.5"><Icons.FileText className="w-3.5 h-3.5" />{tr.tabIni}</span>
        </button>
      </div>

      {/* ── VERSIONS TAB ── */}
      {tab === 'versions' && (
        <div className={card}>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" /> {tr.loading}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`text-xs font-bold uppercase tracking-wider border-b ${isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-100'}`}>
                    <th className="py-3 px-4">Version</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={`text-xs divide-y ${isDark ? 'divide-slate-800/50' : 'divide-slate-100'}`}>
                  {versions.map(({ version, status }) => (
                    <tr key={version} className={`transition ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>
                      <td className={`py-3 px-4 font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>PHP {version}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded border text-[10px] uppercase font-bold ${statusBadge(status)}`}>
                          {status === 'active' ? tr.active : status === 'installed' ? tr.installed : tr.available}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 justify-end flex-wrap">
                          {status === 'available' && (
                            <button
                              onClick={() => handleInstall(version)}
                              disabled={installing === version}
                              className={btn(isDark ? 'bg-blue-600/20 border-blue-600/40 text-blue-400 hover:bg-blue-600/30' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100')}
                            >
                              {installing === version ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Download className="w-3.5 h-3.5" />}
                              {installing === version ? '...' : tr.install}
                            </button>
                          )}
                          {status === 'installed' && (
                            <>
                              <button
                                onClick={() => handleSetActive(version)}
                                className={btn(isDark ? 'bg-green-600/20 border-green-600/40 text-green-400 hover:bg-green-600/30' : 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100')}
                              >
                                <Icons.Star className="w-3.5 h-3.5" /> {tr.setActive}
                              </button>
                              <button
                                onClick={() => handleUninstall(version)}
                                className={btn(isDark ? 'bg-red-600/20 border-red-600/40 text-red-400 hover:bg-red-600/30' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100')}
                              >
                                <Icons.Trash2 className="w-3.5 h-3.5" /> {tr.uninstall}
                              </button>
                            </>
                          )}
                          {status === 'active' && (
                            <span className={`text-[10px] font-semibold flex items-center gap-1 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                              <Icons.CheckCircle2 className="w-3.5 h-3.5" /> Active
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODULES TAB ── */}
      {tab === 'modules' && (
        <div className={`${card} space-y-4`}>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border flex-1 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <Icons.Search className={`w-4 h-4 shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-400'}`} />
              <input
                type="text"
                placeholder={tr.modSearch}
                value={moduleSearch}
                onChange={e => setModuleSearch(e.target.value)}
                className={`bg-transparent text-xs flex-1 focus:outline-none ${isDark ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700 placeholder-slate-400'}`}
              />
            </div>
            <div className={`flex rounded-lg border overflow-hidden text-xs font-semibold ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
              {(['all','enabled','disabled'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setModuleFilter(f)}
                  className={`px-3 py-2 transition ${moduleFilter === f
                    ? (isDark ? 'bg-blue-600 text-white' : 'bg-blue-600 text-white')
                    : (isDark ? 'bg-slate-800 text-slate-400 hover:text-slate-200' : 'bg-white text-slate-500 hover:text-slate-700')}`}
                >
                  {f === 'all' ? tr.allMods : f === 'enabled' ? tr.enabledMods : tr.disabledMods}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className={`flex gap-4 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            <span className={`${isDark ? 'text-green-400' : 'text-green-600'} font-semibold`}>
              ● {Object.values(moduleStates).filter(Boolean).length} enabled
            </span>
            <span className={`${isDark ? 'text-slate-500' : 'text-slate-400'} font-semibold`}>
              ○ {Object.values(moduleStates).filter(v => !v).length} disabled
            </span>
            <span className="ml-auto">PHP {selectedVersion}</span>
          </div>

          {/* Module grid */}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" /> {tr.loading}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredModules.map(mod => {
                const enabled = moduleStates[mod] ?? false;
                const toggling = togglingMod === mod;
                return (
                  <div
                    key={mod}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition ${
                      enabled
                        ? (isDark ? 'bg-blue-600/10 border-blue-600/30' : 'bg-blue-50 border-blue-200')
                        : (isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200')
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icons.Package className={`w-3.5 h-3.5 shrink-0 ${enabled ? (isDark ? 'text-blue-400' : 'text-blue-500') : (isDark ? 'text-slate-600' : 'text-slate-300')}`} />
                      <span className={`font-mono text-xs font-semibold truncate ${enabled ? (isDark ? 'text-slate-200' : 'text-slate-700') : (isDark ? 'text-slate-500' : 'text-slate-400')}`}>
                        {mod}
                      </span>
                    </div>
                    <button
                      onClick={() => handleToggleModule(mod, !enabled)}
                      disabled={toggling}
                      title={enabled ? 'Disable' : 'Enable'}
                      className={`relative w-9 h-5 rounded-full border transition-all shrink-0 ml-2 ${
                        toggling ? 'opacity-50' : ''
                      } ${enabled
                        ? (isDark ? 'bg-blue-600 border-blue-600' : 'bg-blue-600 border-blue-600')
                        : (isDark ? 'bg-slate-700 border-slate-600' : 'bg-slate-200 border-slate-300')
                      }`}
                    >
                      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PHP.INI TAB ── */}
      {tab === 'ini' && (
        <div className={`${card} space-y-4`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              <Icons.FileText className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              php.ini — PHP {selectedVersion}
            </h3>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" /> {tr.loading}
            </div>
          ) : (
            <>
              <textarea
                value={phpIniContent}
                onChange={e => setPhpIniContent(e.target.value)}
                rows={22}
                spellCheck={false}
                className={`w-full border rounded-xl px-4 py-3 font-mono text-xs focus:outline-none focus:border-blue-500 transition resize-none ${
                  isDark ? 'bg-slate-950/80 border-slate-800 text-slate-200 hover:border-slate-700' : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => fetchIni(selectedVersion)}
                  className={btn(isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200')}
                >
                  <Icons.RefreshCw className="w-3.5 h-3.5" /> Reset
                </button>
                <button
                  onClick={handleSaveIni}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow"
                >
                  {saving ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Save className="w-3.5 h-3.5" />}
                  {saving ? tr.saving : tr.saveIni}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
