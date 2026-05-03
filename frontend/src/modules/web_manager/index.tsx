/**
 * Web Manager - Multi-Tab High-End Management Dashboard
 * Dynamic tabs: Website, Web Services, SQL Databases, PHP Manager.
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
  const [activeTab, setActiveTab] = useState<'sites' | 'services' | 'databases' | 'php'>('sites');

  // Tab 1: Sites States
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [domain, setDomain] = useState<string>('');
  const [root, setRoot] = useState<string>('/var/www/');
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

  // Tab 2: Services States
  const [webServices, setWebServices] = useState<any[]>([]);
  const [loadingServices, setLoadingServices] = useState<boolean>(false);

  // Tab 3: Databases States
  const [databases, setDatabases] = useState<any[]>([]);
  const [loadingDbs, setLoadingDbs] = useState<boolean>(false);
  const [newDbName, setNewDbName] = useState<string>('');
  const [dbError, setDbError] = useState<string | null>(null);

  // Tab 4: PHP Manager States
  const [phpManagerVersion, setPhpManagerVersion] = useState<string>('8.2');
  const [phpIniContent, setPhpIniContent] = useState<string>('');
  const [savingPhpIni, setSavingPhpIni] = useState<boolean>(false);
  const [phpIniStatus, setPhpIniStatus] = useState<{ msg: string; isError: boolean } | null>(null);
  const [newPhpVersionToInstall, setNewPhpVersionToInstall] = useState<string>('8.3');

  const t = {
    en: {
      title: 'Web & PHP Manager',
      desc: 'Control website domains, underlying server software, PHP versions/configurations, and database services.',
      tabSites: 'Website Management',
      tabServices: 'Web Services Status',
      tabDbs: 'SQL Database Manager',
      tabPhp: 'PHP Version & ini Manager',
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
      cancel: 'Cancel',

      // Databases
      dbTitle: 'MySQL / MariaDB Management',
      dbDesc: 'Instantly create or drop your databases. Integrate with phpMyAdmin for database viewing.',
      createDbBtn: 'Create Database',
      dbNameLabel: 'New Database Name',
      dbNamePlaceholder: 'e.g. blog_database',
      colDb: 'Database Name',
      colDbSize: 'Size',
      noDbs: 'No databases found on your server.',
      pmaTip: 'For phpMyAdmin management, go to the Packages Manager or use an available SQL client tool.',

      // Web Services
      wsTitle: 'Web Services & Reverse Proxies',
      wsDesc: 'Check and control local web services like Nginx, Apache2, or OpenLiteSpeed.',
      colService: 'Service Name',
      colServiceStatus: 'Status',
      colInstalled: 'Installed',

      // PHP Manager
      phpTitle: 'Advanced PHP Manager',
      phpDesc: 'Manage, install new PHP versions, and edit their php.ini server configurations directly.',
      colPhpVersion: 'PHP Version',
      installPhpBtn: 'Install PHP Version',
      editIniBtn: 'Edit php.ini Config',
      saveIniBtn: 'Save php.ini'
    },
    vi: {
      title: 'Quản lý Web & PHP',
      desc: 'Quản lý toàn diện trang web, cấu hình nginx, dịch vụ web, phiên bản PHP/php.ini và các cơ sở dữ liệu SQL.',
      tabSites: 'Quản lý Website',
      tabServices: 'Dịch vụ Web',
      tabDbs: 'Dịch vụ Database',
      tabPhp: 'Dịch vụ PHP & php.ini',
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
      cancel: 'Hủy',

      // Databases
      dbTitle: 'Quản lý MySQL / MariaDB',
      dbDesc: 'Khởi tạo và xóa dữ liệu SQL database dễ dàng. Kết nối với phpMyAdmin để trực quan hóa.',
      createDbBtn: 'Tạo mới Database',
      dbNameLabel: 'Tên Database',
      dbNamePlaceholder: 'VD: dulieu_blog',
      colDb: 'Tên Database',
      colDbSize: 'Kích thước',
      noDbs: 'Chưa có database nào được tìm thấy.',
      pmaTip: 'Để quản lý cơ sở dữ liệu qua phpMyAdmin, hãy chuyển tới App Store / Package Manager.',

      // Web Services
      wsTitle: 'Dịch vụ Web & Reverse Proxies',
      wsDesc: 'Kiểm tra và quản lý trạng thái của các dịch vụ Nginx, Apache2 hoặc OpenLiteSpeed.',
      colService: 'Tên dịch vụ',
      colServiceStatus: 'Trạng thái',
      colInstalled: 'Đã cài đặt',

      // PHP Manager
      phpTitle: 'Quản lý PHP Nâng Cao',
      phpDesc: 'Cài đặt các phiên bản PHP mới và tùy chỉnh cấu hình tệp php.ini trực tiếp cho từng phiên bản.',
      colPhpVersion: 'Phiên bản PHP',
      installPhpBtn: 'Cài đặt PHP',
      editIniBtn: 'Sửa php.ini',
      saveIniBtn: 'Lưu php.ini'
    }
  };

  const tr = t[language || 'en'];

  // Data Fetchers
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

  const fetchWebServices = async () => {
    setLoadingServices(true);
    try {
      const response = await fetch('/api/web_manager/web_services');
      if (response.ok) {
        const d = await response.json();
        if (d.services) setWebServices(d.services);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingServices(false);
    }
  };

  const fetchDatabases = async () => {
    setLoadingDbs(true);
    try {
      const response = await fetch('/api/database_manager/list');
      if (response.ok) {
        const d = await response.json();
        if (d.databases) setDatabases(d.databases);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDbs(false);
    }
  };

  const fetchPhpIni = async (version: string) => {
    try {
      const response = await fetch(`/api/php_manager/php_ini/${version}`);
      if (response.ok) {
        const d = await response.json();
        if (d.content) setPhpIniContent(d.content);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'sites') fetchSites();
    if (activeTab === 'services') fetchWebServices();
    if (activeTab === 'databases') fetchDatabases();
    if (activeTab === 'php') fetchPhpIni(phpManagerVersion);
  }, [activeTab, phpManagerVersion]);

  // PHP version/module options fetching
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
    fetchPhpOptions();
  }, [showCreateModal, activeTab]);

  // Actions
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
      setRoot('/var/www/');
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

  const handleServiceAction = async (serviceId: string, action: string) => {
    try {
      const response = await fetch(`/api/web_manager/web_services/${serviceId}/${action}`, {
        method: 'POST'
      });
      if (response.ok) {
        fetchWebServices();
      } else {
        const d = await response.json();
        alert(d.detail || 'Service control failed');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim()) return;
    setDbError(null);
    try {
      const response = await fetch('/api/database_manager/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDbName })
      });
      const d = await response.json();
      if (!response.ok) {
        throw new Error(d.detail || 'Failed to create database');
      }
      setNewDbName('');
      fetchDatabases();
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'Error creating database');
    }
  };

  const handleDeleteDatabase = async (dbname: string) => {
    if (!confirm(language === 'vi' ? `Bạn có chắc muốn xóa database ${dbname}?` : `Delete database ${dbname}?`)) return;
    try {
      const response = await fetch('/api/database_manager/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dbname })
      });
      if (response.ok) {
        fetchDatabases();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInstallPhp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/php_manager/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: newPhpVersionToInstall })
      });
      const data = await response.json();
      if (response.ok) {
        alert(data.message || 'PHP version installed successfully.');
        fetchSites();
      } else {
        alert(data.detail || 'Failed to install PHP');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSavePhpIni = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPhpIni(true);
    setPhpIniStatus(null);
    try {
      const response = await fetch(`/api/php_manager/php_ini/${phpManagerVersion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: phpIniContent })
      });
      const d = await response.json();
      if (response.ok) {
        setPhpIniStatus({ msg: d.message || 'php.ini saved successfully.', isError: false });
      } else {
        setPhpIniStatus({ msg: d.detail || 'Failed to save php.ini config', isError: true });
      }
    } catch (err) {
      setPhpIniStatus({ msg: 'Communication error.', isError: true });
    } finally {
      setSavingPhpIni(false);
    }
  };

  const handleToggleModule = (mod: string) => {
    if (phpModules.includes(mod)) {
      setPhpModules(phpModules.filter((m) => m !== mod));
    } else {
      setPhpModules([...phpModules, mod]);
    }
  };

  const openViewModal = (item: SiteItem) => {
    setViewingSite(item);
    setEditedContent(item.content || '');
    setSaveStatus(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Premium Dashboard Banner */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Globe className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>

        {/* Action Buttons: Add Site */}
        {activeTab === 'sites' && (
          <button
            onClick={() => {
              setDomain('');
              setRoot('/var/www/');
              setPort(80);
              setProxyPort('');
              setShowCreateModal(true);
            }}
            className={`w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-xs text-white transition-all shadow-md ${
              isDark ? 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/20' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            <Icons.Plus className="w-4 h-4" />
            {tr.createBtn}
          </button>
        )}
      </div>

      {/* Multi-Tab Switcher */}
      <div className="flex border-b border-slate-200/60 dark:border-slate-800/60 gap-1 overflow-x-auto select-none">
        <button
          onClick={() => setActiveTab('sites')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'sites'
              ? 'border-blue-500 text-blue-500 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Icons.Globe className="w-4 h-4" /> {tr.tabSites}
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'services'
              ? 'border-blue-500 text-blue-500 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Icons.Server className="w-4 h-4" /> {tr.tabServices}
        </button>
        <button
          onClick={() => setActiveTab('databases')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'databases'
              ? 'border-blue-500 text-blue-500 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Icons.Database className="w-4 h-4" /> {tr.tabDbs}
        </button>
        <button
          onClick={() => setActiveTab('php')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'php'
              ? 'border-blue-500 text-blue-500 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Icons.Code className="w-4 h-4" /> {tr.tabPhp}
        </button>
      </div>

      {/* Tab Content Rendering */}
      {activeTab === 'sites' && (
        <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          {error && (
            <div className={`p-4 border rounded-xl text-xs flex items-center gap-2 animate-fade-in ${
              isDark ? 'bg-red-950/20 border-red-800/40 text-red-400' : 'bg-red-50 border-red-200 text-red-600'
            }`}>
              <Icons.AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
              <p>{tr.loadingSites}</p>
            </div>
          ) : sites.length > 0 ? (
            <div className="space-y-4 animate-fade-in">
              {/* Desktop view Table */}
              <div className={`hidden md:block overflow-x-auto border rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                <table className="w-full text-left border-collapse select-none">
                  <thead>
                    <tr className={`border-b text-xs font-bold uppercase tracking-widest ${
                      isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50/80 border-slate-100 text-slate-600'
                    }`}>
                      <th className="p-4">{tr.colFilename}</th>
                      <th className="p-4">{tr.colDomain}</th>
                      <th className="p-4">{tr.colRoot}</th>
                      <th className="p-4">{tr.colStatus}</th>
                      <th className="p-4 text-center">{tr.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className={`text-xs divide-y font-mono ${isDark ? 'text-slate-200 divide-slate-800/40' : 'text-slate-700 divide-slate-100'}`}>
                    {sites.map((item, idx) => (
                      <tr key={idx} className={`transition-all ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/60'}`}>
                        <td className="p-4">{item.filename}</td>
                        <td className="p-4 font-bold text-blue-500 dark:text-blue-400 truncate max-w-[200px]" title={item.domain}>
                          {item.domain}
                        </td>
                        <td className="p-4 truncate max-w-[220px]" title={item.root}>{item.root || '—'}</td>
                        <td className="p-4">
                          <button
                            onClick={() => handleToggleStatus(item)}
                            className={`px-3 py-1 rounded-xl text-[10px] font-bold tracking-wider uppercase transition border flex items-center gap-1.5 ${
                              item.active
                                ? 'bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20'
                                : 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                            {item.active ? tr.active : tr.inactive}
                          </button>
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openViewModal(item)}
                              className={`p-2 rounded-xl border transition ${
                                isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                              }`}
                              title={tr.editConfig}
                            >
                              <Icons.Edit3 className="w-3.5 h-3.5 text-blue-500" />
                            </button>
                            <button
                              onClick={() => handleDeleteSite(item)}
                              className={`p-2 rounded-xl border transition ${
                                isDark ? 'bg-slate-800 hover:bg-red-950/40 border-slate-700 hover:border-red-800' : 'bg-slate-50 hover:bg-red-50 border-slate-200 hover:border-red-200'
                              }`}
                            >
                              <Icons.Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List view */}
              <div className="grid grid-cols-1 gap-4 md:hidden">
                {sites.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border flex flex-col justify-between gap-4 transition duration-200 ${
                      isDark ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold truncate text-blue-500 dark:text-blue-400" title={item.domain}>
                          {item.domain}
                        </span>
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-bold tracking-wider uppercase transition border flex items-center gap-1.5 ${
                            item.active
                              ? 'bg-green-500/10 text-green-500 border-green-500/20'
                              : 'bg-red-500/10 text-red-500 border-red-500/20'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                          {item.active ? tr.active : tr.inactive}
                        </button>
                      </div>
                      <div className="flex flex-col gap-1 text-xs">
                        <span className={`font-mono text-[11px] truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                          <strong>{tr.colFilename}:</strong> {item.filename}
                        </span>
                        <span className={`font-mono text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          <strong>{tr.colRoot}:</strong> {item.root || '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-end border-t pt-3 dark:border-slate-800 gap-2">
                      <button
                        onClick={() => openViewModal(item)}
                        className={`p-2 rounded-xl border transition ${
                          isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                        }`}
                        title={tr.editConfig}
                      >
                        <Icons.Edit3 className="w-3.5 h-3.5 text-blue-500" />
                      </button>
                      <button
                        onClick={() => handleDeleteSite(item)}
                        className={`p-2 rounded-xl border transition ${
                          isDark ? 'bg-slate-800 hover:bg-red-950/40 border-slate-700 hover:border-red-800' : 'bg-slate-50 hover:bg-red-50 border-slate-200 hover:border-red-200'
                        }`}
                      >
                        <Icons.Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noSites}
            </div>
          )}
        </div>
      )}

      {activeTab === 'services' && (
        <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-6 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <div className="space-y-2">
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Server className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.wsTitle}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.wsDesc}</p>
          </div>

          {loadingServices ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
              <p>{tr.loadingSites}</p>
            </div>
          ) : webServices.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {webServices.map((ws, index) => (
                <div key={index} className={`border p-5 rounded-2xl flex flex-col justify-between gap-4 transition duration-200 ${
                  isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/50 border-slate-100'
                }`}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                        {ws.name}
                      </span>
                      <span className={`px-2 py-0.5 rounded-xl border text-[10px] font-bold uppercase tracking-wide ${
                        ws.installed
                          ? ws.status === 'running'
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                          : 'bg-red-500/10 text-red-500 border-red-500/20'
                      }`}>
                        {ws.installed ? ws.status : 'not_installed'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t pt-3 dark:border-slate-800/60">
                    {!ws.installed ? (
                      <button
                        onClick={() => handleServiceAction(ws.id, 'install')}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-xs text-white transition-all shadow-sm`}
                      >
                        <Icons.Download className="w-3.5 h-3.5" />
                        Install
                      </button>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5 w-full">
                        <button
                          onClick={() => handleServiceAction(ws.id, 'start')}
                          className={`flex items-center justify-center gap-1 p-1.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-bold shadow-sm transition`}
                        >
                          <Icons.Play className="w-3 h-3 shrink-0" />
                        </button>
                        <button
                          onClick={() => handleServiceAction(ws.id, 'stop')}
                          className={`flex items-center justify-center gap-1 p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold shadow-sm transition`}
                        >
                          <Icons.Square className="w-3 h-3 shrink-0" />
                        </button>
                        <button
                          onClick={() => handleServiceAction(ws.id, 'restart')}
                          className={`flex items-center justify-center gap-1 p-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl text-xs font-bold shadow-sm transition`}
                        >
                          <Icons.RotateCcw className="w-3 h-3 shrink-0" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              No web services status found.
            </div>
          )}
        </div>
      )}

      {activeTab === 'databases' && (
        <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-6 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <div className="space-y-2">
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Database className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.dbTitle}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.dbDesc}</p>
          </div>

          <form onSubmit={handleCreateDatabase} className={`border p-5 rounded-xl space-y-4 max-w-xl transition duration-200 ${
            isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/40 border-slate-100'
          }`}>
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{tr.createDbBtn}</h4>
            {dbError && (
              <div className={`p-3 text-xs border rounded-xl flex items-center gap-2 ${isDark ? 'bg-red-950/10 border-red-800/40 text-red-400' : 'bg-red-50 border-red-100 text-red-600'}`}>
                <Icons.AlertTriangle className="w-4 h-4" /> {dbError}
              </div>
            )}
            <div className="flex flex-col md:flex-row items-center gap-3">
              <input
                type="text"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder={tr.dbNamePlaceholder}
                className={`flex-1 w-full border px-4 py-2.5 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                }`}
                required
              />
              <button
                type="submit"
                className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                <Icons.Database className="w-4 h-4" />
                {tr.create}
              </button>
            </div>
          </form>

          {loadingDbs ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
              <p>{tr.loadingSites}</p>
            </div>
          ) : databases.length > 0 ? (
            <div className="space-y-4 animate-fade-in">
              <div className={`overflow-x-auto border rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                <table className="w-full text-left border-collapse select-none">
                  <thead>
                    <tr className={`border-b text-xs font-bold uppercase tracking-widest ${
                      isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50/80 border-slate-100 text-slate-600'
                    }`}>
                      <th className="p-4">{tr.colDb}</th>
                      <th className="p-4">{tr.colDbSize}</th>
                      <th className="p-4 text-center">{tr.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className={`text-xs divide-y font-mono ${isDark ? 'text-slate-200 divide-slate-800/40' : 'text-slate-700 divide-slate-100'}`}>
                    {databases.map((db, idx) => (
                      <tr key={idx} className={`transition-all ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/60'}`}>
                        <td className="p-4 font-bold text-blue-500 dark:text-blue-400">{db.name}</td>
                        <td className="p-4">{db.size}</td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleDeleteDatabase(db.name)}
                            className={`p-2 rounded-xl border transition mx-auto flex items-center justify-center gap-1 ${
                              isDark ? 'bg-slate-800 hover:bg-red-950/40 border-slate-700 hover:border-red-800' : 'bg-slate-50 hover:bg-red-50 border-slate-200 hover:border-red-200'
                            }`}
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noDbs}
            </div>
          )}

          <div className={`p-4 border rounded-xl text-xs flex flex-wrap items-center justify-between gap-3 select-none ${
            isDark ? 'bg-indigo-950/10 border-indigo-900/40 text-indigo-300' : 'bg-indigo-50/40 border-indigo-100 text-indigo-700'
          }`}>
            <div className="flex items-center gap-2">
              <Icons.Database className="w-4 h-4 shrink-0" />
              <span>{tr.pmaTip}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'php' && (
        <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-6 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <div className="space-y-2">
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Icons.Code className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.phpTitle}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.phpDesc}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form onSubmit={handleInstallPhp} className={`border p-5 rounded-2xl space-y-4 h-fit transition duration-200 ${
              isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/40 border-slate-100'
            }`}>
              <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {tr.installPhpBtn}
              </h4>
              <div className="flex flex-col md:flex-row items-center gap-3">
                <select
                  value={newPhpVersionToInstall}
                  onChange={(e) => setNewPhpVersionToInstall(e.target.value)}
                  className={`flex-1 w-full border px-3 py-2.5 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  {['8.3', '8.2', '8.1', '8.0', '7.4'].map((v) => (
                    <option key={v} value={v}>PHP {v}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  <Icons.Download className="w-4 h-4" />
                  {tr.create}
                </button>
              </div>
            </form>

            <form onSubmit={handleSavePhpIni} className={`border p-5 rounded-2xl space-y-4 transition duration-200 ${
              isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/40 border-slate-100'
            }`}>
              <div className="flex items-center justify-between">
                <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {tr.editIniBtn}
                </h4>
                <select
                  value={phpManagerVersion}
                  onChange={(e) => setPhpManagerVersion(e.target.value)}
                  className={`border px-3 py-1.5 rounded-xl font-mono text-[11px] outline-none focus:border-blue-500 transition ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  {availablePhpVersions.map((v) => (
                    <option key={v} value={v}>PHP {v} ini</option>
                  ))}
                </select>
              </div>

              {phpIniStatus && (
                <div className={`p-3 border rounded-xl text-xs flex items-center gap-2 ${
                  phpIniStatus.isError ? (isDark ? 'bg-red-950/20 border-red-800/40 text-red-400' : 'bg-red-50 border-red-200 text-red-600')
                  : (isDark ? 'bg-blue-950/20 border-blue-800/40 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-600')
                }`}>
                  {phpIniStatus.isError ? <Icons.AlertCircle className="w-3.5 h-3.5 shrink-0" /> : <Icons.CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                  <span>{phpIniStatus.msg}</span>
                </div>
              )}

              <textarea
                value={phpIniContent}
                onChange={(e) => setPhpIniContent(e.target.value)}
                rows={10}
                className={`w-full border p-3 rounded-xl outline-none focus:border-blue-500 font-mono text-[11px] transition resize-none ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                }`}
              />

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={savingPhpIni}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm flex items-center gap-1.5"
                >
                  {savingPhpIni ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Save className="w-3.5 h-3.5" />}
                  {savingPhpIni ? tr.saving : tr.saveIniBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Viewing / Modifying Config Modal */}
      {viewingSite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-4xl shadow-2xl border flex flex-col h-[85vh] transition-all duration-300 ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.FileText className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.editConfig}: <span className="font-mono text-xs">{viewingSite.filename}</span>
              </h3>
              <button
                onClick={() => setViewingSite(null)}
                className="text-slate-500 hover:text-red-400 transition"
              >
                &times;
              </button>
            </div>

            {saveStatus && (
              <div className={`p-3.5 border rounded-xl text-xs flex items-center gap-2 mb-4 animate-fade-in flex-shrink-0 ${
                saveStatus.isError
                  ? (isDark ? 'bg-red-950/20 border-red-600/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600')
                  : (isDark ? 'bg-blue-950/20 border-blue-600/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-600')
              }`}>
                {saveStatus.isError ? <Icons.AlertCircle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span>{saveStatus.msg}</span>
              </div>
            )}

            <div className="flex-1 min-h-0 mb-4 flex flex-col">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className={`w-full h-full border p-4 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition resize-none ${
                  isDark ? 'bg-slate-950 border-slate-800/80 text-slate-100' : 'bg-slate-50 border-slate-100 text-slate-800'
                }`}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-4 dark:border-slate-800 flex-shrink-0">
              <span className={`text-[11px] max-w-sm hidden md:inline ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {tr.saveTip}
              </span>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <button
                  onClick={() => setViewingSite(null)}
                  className={`flex-1 md:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tr.cancel}
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={isSaving}
                  className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-md`}
                >
                  {isSaving ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Save className="w-4 h-4" />}
                  {isSaving ? tr.saving : tr.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Creating New Website Modal Popup */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-lg shadow-2xl border flex flex-col h-[85vh] transition-all duration-300 ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
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
                  onChange={(e) => {
                    const val = e.target.value;
                    setDomain(val);
                    if (val.trim()) {
                      const cleanDomain = val.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
                      setRoot(`/var/www/${cleanDomain}`);
                    } else {
                      setRoot('/var/www/');
                    }
                  }}
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
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-md flex items-center gap-1.5"
              >
                <Icons.Plus className="w-4 h-4" /> {tr.create}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
