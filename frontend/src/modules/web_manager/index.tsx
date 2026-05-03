/**
 * Web Manager - Site Management Component
 * Premium Nginx sites-available/sites-enabled dashboard.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface SiteItem {
  filename: string;
  domain: string;
  root: string;
  active: boolean;
  content: string;
}

export default function WebManagerDashboard() {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [domain, setDomain] = useState<string>('');
  const [root, setRoot] = useState<string>('/var/www/html');
  const [port, setPort] = useState<number>(80);
  const [proxyPort, setProxyPort] = useState<number | ''>('');
  const [siteType, setSiteType] = useState<'static' | 'proxy' | 'php'>('static');

  // PHP specific states
  const [phpVersion, setPhpVersion] = useState<string>('8.2');
  const [phpModules, setPhpModules] = useState<string[]>([]);
  const [availablePhpVersions, setAvailablePhpVersions] = useState<string[]>(['8.3', '8.2', '8.1', '8.0', '7.4']);
  const [availablePhpModules, setAvailablePhpModules] = useState<string[]>(['mysqli', 'curl', 'mbstring', 'gd', 'zip', 'xml', 'redis', 'intl', 'soap', 'bcmath']);

  const [viewingSite, setViewingSite] = useState<SiteItem | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<{ msg: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const t = {
    en: {
      title: 'Web Manager',
      desc: 'Manage Nginx configurations and available sites',
      createBtn: 'Create New Site',
      loadingSites: 'Loading Nginx sites...',
      colFilename: 'Filename',
      colDomain: 'Domain / Server Name',
      colRoot: 'Root Path',
      colStatus: 'Status',
      colActions: 'Actions',
      noSites: 'No sites found in sites-available',
      active: 'Active',
      inactive: 'Inactive',
      editConfig: 'Edit Config',
      save: 'Save Configuration',
      saving: 'Saving...',
      saveMsg: '✓ Configuration successfully updated and reloaded.',
      saveTip: 'When saving, the config will be auto-tested and reloaded.',
      deleteConfirm: (fn: string) => `Are you sure you want to completely delete "${fn}"?`,
      serviceType: 'Service Type',
      staticService: 'Static Web Service',
      phpService: 'PHP Web Service',
      proxyService: 'Nginx Port Proxy (Reverse Proxy)',
      domainLabel: 'Domain Name (server_name)',
      portLabel: 'Port',
      rootLabel: 'Root Path',
      proxyPortLabel: 'Proxy Port',
      phpVersionLabel: 'PHP Version',
      phpModulesLabel: 'PHP Modules (Enable)',
      create: 'Create',
      cancel: 'Cancel'
    },
    vi: {
      title: 'Quản lý Web',
      desc: 'Quản lý các tệp cấu hình Nginx và các trang web hiện có',
      createBtn: 'Tạo website mới',
      loadingSites: 'Đang tải danh sách website...',
      colFilename: 'Tên tệp cấu hình',
      colDomain: 'Tên miền / Server Name',
      colRoot: 'Thư mục gốc',
      colStatus: 'Trạng thái',
      colActions: 'Hành động',
      noSites: 'Không tìm thấy trang nào trong sites-available',
      active: 'Bật',
      inactive: 'Tắt',
      editConfig: 'Sửa cấu hình',
      save: 'Lưu cấu hình',
      saving: 'Đang lưu...',
      saveMsg: '✓ Tệp cấu hình đã được cập nhật và tải lại thành công.',
      saveTip: 'Khi lưu, cấu hình sẽ được kiểm tra cú pháp tự động trước khi tải lại.',
      deleteConfirm: (fn: string) => `Bạn có chắc chắn muốn xóa hoàn toàn "${fn}" không?`,
      serviceType: 'Loại dịch vụ',
      staticService: 'Dịch vụ Web Tĩnh',
      phpService: 'Dịch vụ Web PHP',
      proxyService: 'Nginx Proxy Cổng (Reverse Proxy)',
      domainLabel: 'Tên miền (server_name)',
      portLabel: 'Cổng truy cập',
      rootLabel: 'Thư mục gốc',
      proxyPortLabel: 'Cổng Proxy',
      phpVersionLabel: 'Phiên bản PHP',
      phpModulesLabel: 'PHP Modules (Bật)',
      create: 'Tạo mới',
      cancel: 'Hủy'
    }
  };

  const tr = t[language || 'en'];

  const openViewModal = (item: SiteItem) => {
    setViewingSite(item);
    setEditedContent(item.content || '');
    setSaveStatus(null);
  };

  const fetchSites = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/web_manager/list');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch Nginx sites');
      }
      const data = await response.json();
      setSites(data.sites || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  useEffect(() => {
    const fetchPhpOptions = async () => {
      try {
        const resV = await fetch('/api/php_manager/versions');
        if (resV.ok) {
          const dV = await resV.json();
          if (dV.versions) setAvailablePhpVersions(dV.versions);
        }
        const resM = await fetch('/api/php_manager/modules');
        if (resM.ok) {
          const dM = await resM.json();
          if (dM.modules) setAvailablePhpModules(dM.modules);
        }
      } catch (err) {
        console.error('Error fetching PHP options:', err);
      }
    };
    if (showCreateModal) {
      fetchPhpOptions();
    }
  }, [showCreateModal]);

  const handleToggleStatus = async (item: SiteItem) => {
    try {
      const response = await fetch('/api/web_manager/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.filename, active: !item.active }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to toggle status');
      }
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error toggling site status');
    }
  };

  const handleDeleteSite = async (item: SiteItem) => {
    if (!confirm(tr.deleteConfirm(item.filename))) return;
    try {
      const response = await fetch('/api/web_manager/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.filename }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to delete site');
      }
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error deleting site');
    }
  };

  const handleCreateSite = async () => {
    if (!domain) return;
    try {
      const response = await fetch('/api/web_manager/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          root: siteType !== 'proxy' ? root : '',
          port,
          proxy_port: siteType === 'proxy' ? (proxyPort || null) : null,
          php_version: siteType === 'php' ? phpVersion : null,
          php_modules: siteType === 'php' ? phpModules : null,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to create site');
      }
      setDomain('');
      setRoot('/var/www/html');
      setPort(80);
      setProxyPort('');
      setPhpModules([]);
      setShowCreateModal(false);
      fetchSites();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating site');
    }
  };

  const handleSaveConfig = async () => {
    if (!viewingSite) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const response = await fetch('/api/web_manager/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: viewingSite.filename, content: editedContent }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to update configuration');
      }
      setSaveStatus({ msg: tr.saveMsg, isError: false });
      setViewingSite({ ...viewingSite, content: editedContent });
      fetchSites();
    } catch (err) {
      setSaveStatus({ msg: err instanceof Error ? err.message : 'Error saving config', isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleModule = (mod: string) => {
    if (phpModules.includes(mod)) {
      setPhpModules(phpModules.filter((m) => m !== mod));
    } else {
      setPhpModules([...phpModules, mod]);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div>
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Globe className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h1>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm transition shadow-lg"
          >
            <Icons.Plus className="w-4 h-4" /> {tr.createBtn}
          </button>
          <button
            onClick={fetchSites}
            className={`flex items-center p-3 rounded-xl transition border shadow-lg ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
            }`}
            title="Refresh sites list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400 text-xs">{tr.loadingSites}</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-600/30 p-4 rounded-xl text-red-400 text-xs max-w-2xl">
          <p>Error: {error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className={`border rounded-2xl overflow-hidden backdrop-blur-md shadow-sm transition-all ${
            isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className={`border-b text-xs uppercase tracking-wider ${
                    isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'
                  }`}>
                    <th className="p-4 font-bold">{tr.colFilename}</th>
                    <th className="p-4 font-bold">{tr.colDomain}</th>
                    <th className="p-4 font-bold">{tr.colRoot}</th>
                    <th className="p-4 font-bold text-center">{tr.colStatus}</th>
                    <th className="p-4 font-bold text-center w-28">{tr.colActions}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-100'}`}>
                  {sites.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-xs select-none text-slate-400">
                        {tr.noSites}
                      </td>
                    </tr>
                  )}
                  {sites.map((item, idx) => (
                    <tr key={idx} className={`transition duration-200 ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'}`}>
                      <td className={`p-4 font-bold text-xs ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{item.filename}</td>
                      <td className={`p-4 font-mono text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{item.domain}</td>
                      <td className={`p-4 font-mono text-xs truncate max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`} title={item.root}>
                        {item.root || '—'}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className={`px-3 py-1 text-xs font-semibold rounded-full transition-all border select-none ${
                            item.active
                              ? 'bg-green-600/10 border-green-500/20 text-green-500'
                              : isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          {item.active ? tr.active : tr.inactive}
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openViewModal(item)}
                            className={`p-2 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-blue-600'
                            }`}
                            title="Edit Configuration"
                          >
                            <Icons.Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSite(item)}
                            className={`p-2 rounded-xl border transition-all ${
                              isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600'
                            }`}
                            title="Delete Site"
                          >
                            <Icons.Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-lg shadow-2xl border flex flex-col h-[85vh] transition-all duration-300 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 flex-shrink-0 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Plus className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.createBtn}
            </h3>
            <div className="space-y-4 flex-1 overflow-auto pr-1">
              <div>
                <label className={`text-[10px] font-bold mb-2 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {tr.serviceType}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setSiteType('static')}
                    className={`p-2.5 rounded-xl border font-bold text-[11px] flex flex-col items-center justify-center gap-1 transition ${
                      siteType === 'static'
                        ? 'bg-blue-600/10 border-blue-500 text-blue-500'
                        : isDark ? 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-200'
                    }`}
                  >
                    <Icons.Globe className="w-4 h-4" /> {tr.staticService}
                  </button>
                  <button
                    onClick={() => setSiteType('php')}
                    className={`p-2.5 rounded-xl border font-bold text-[11px] flex flex-col items-center justify-center gap-1 transition ${
                      siteType === 'php'
                        ? 'bg-blue-600/10 border-blue-500 text-blue-500'
                        : isDark ? 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-200'
                    }`}
                  >
                    <Icons.Code className="w-4 h-4" /> {tr.phpService}
                  </button>
                  <button
                    onClick={() => setSiteType('proxy')}
                    className={`p-2.5 rounded-xl border font-bold text-[11px] flex flex-col items-center justify-center gap-1 transition ${
                      siteType === 'proxy'
                        ? 'bg-blue-600/10 border-blue-500 text-blue-500'
                        : isDark ? 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-200'
                    }`}
                  >
                    <Icons.Shield className="w-4 h-4" /> {tr.proxyService}
                  </button>
                </div>
              </div>

              <div>
                <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {tr.domainLabel}
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className={`w-full border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                  }`}
                  placeholder="e.g. example.com"
                />
              </div>

              {siteType === 'php' && (
                <div className="space-y-3 p-3.5 border rounded-xl bg-slate-50/50 dark:bg-slate-950/20 dark:border-slate-800/80">
                  <div>
                    <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {tr.phpVersionLabel}
                    </label>
                    <select
                      value={phpVersion}
                      onChange={(e) => setPhpVersion(e.target.value)}
                      className={`w-full border px-3 py-1.5 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                        isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-800'
                      }`}
                    >
                      {availablePhpVersions.map((v) => (
                        <option key={v} value={v}>PHP {v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {tr.phpModulesLabel}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 max-h-32 overflow-auto p-1">
                      {availablePhpModules.map((mod) => (
                        <label key={mod} className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-[10px] cursor-pointer transition select-none ${
                          phpModules.includes(mod)
                            ? 'bg-blue-600/10 border-blue-500/40 text-blue-400 font-bold'
                            : isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-100 text-slate-600'
                        }`}>
                          <input
                            type="checkbox"
                            checked={phpModules.includes(mod)}
                            onChange={() => handleToggleModule(mod)}
                            className="hidden"
                          />
                          {phpModules.includes(mod) ? <Icons.CheckSquare className="w-3.5 h-3.5 shrink-0" /> : <Icons.Square className="w-3.5 h-3.5 shrink-0" />}
                          {mod}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {tr.portLabel}
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className={`w-full border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                      isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                    }`}
                  />
                </div>
                {siteType !== 'proxy' ? (
                  <div>
                    <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {tr.rootLabel}
                    </label>
                    <input
                      type="text"
                      value={root}
                      onChange={(e) => setRoot(e.target.value)}
                      className={`w-full border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                        isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                      }`}
                    />
                  </div>
                ) : (
                  <div>
                    <label className={`text-[10px] font-bold mb-1 block uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {tr.proxyPortLabel}
                    </label>
                    <input
                      type="number"
                      value={proxyPort}
                      onChange={(e) => setProxyPort(e.target.value ? Number(e.target.value) : '')}
                      className={`w-full border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                        isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                      }`}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 flex-shrink-0 border-t pt-4 dark:border-slate-800">
              <button
                onClick={() => setShowCreateModal(false)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleCreateSite}
                disabled={!domain}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition shadow-md"
              >
                {tr.create}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingSite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-2xl h-[75vh] flex flex-col shadow-2xl border ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className={`text-base md:text-lg font-bold flex items-center gap-2 truncate max-w-md ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.Edit className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                <span>{tr.editConfig}: {viewingSite.filename}</span>
              </h3>
              <button
                onClick={() => setViewingSite(null)}
                className="text-slate-500 hover:text-red-400 transition"
              >
                &times;
              </button>
            </div>

            {saveStatus && (
              <div className={`p-3.5 mb-3 rounded-xl border text-[11px] leading-relaxed font-mono whitespace-pre-wrap ${
                saveStatus.isError
                  ? 'bg-red-950/40 border-red-900/40 text-red-400'
                  : 'bg-green-950/40 border-green-900/40 text-green-400'
              }`}>
                {saveStatus.msg}
              </div>
            )}

            <textarea
              className={`flex-1 p-4 rounded-xl font-mono text-xs focus:outline-none focus:border-blue-500 overflow-auto resize-none border ${
                isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
              }`}
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              spellCheck="false"
            />

            <div className="flex items-center justify-between gap-3 mt-4 flex-shrink-0">
              <p className={`text-[11px] max-w-xs leading-normal ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {tr.saveTip}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setViewingSite(null)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tr.cancel}
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={isSaving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> {tr.saving}
                    </>
                  ) : (
                    <>
                      <Icons.Save className="w-3.5 h-3.5" /> {tr.save}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
