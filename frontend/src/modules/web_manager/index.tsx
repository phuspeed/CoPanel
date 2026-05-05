/**
 * Web Manager v1.0.1 - Multi-Tab High-End Management Dashboard
 * Dynamic tabs: Website, Web Services (Stack Wizard), SQL Databases & Users, PHP Manager.
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
  const token = localStorage.getItem('copanel_token');
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

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
  const [installingStack, setInstallingStack] = useState<string | null>(null);
  const [stackMsg, setStackMsg] = useState<{ msg: string; isError: boolean } | null>(null);

  // Tab 3: Databases & Users States
  // Smart DB Admin engines
  const [dbEngines, setDbEngines] = useState<any[]>([]);
  const [loadingEngines, setLoadingEngines] = useState<boolean>(false);
  const [installingAdminer, setInstallingAdminer] = useState<boolean>(false);
  const [installingEngineId, setInstallingEngineId] = useState<string | null>(null);
  const [adminerMsg, setAdminerMsg] = useState<{ msg: string; isError: boolean } | null>(null);

  const [databases, setDatabases] = useState<any[]>([]);
  const [loadingDbs, setLoadingDbs] = useState<boolean>(false);
  const [newDbName, setNewDbName] = useState<string>('');
  const [dbError, setDbError] = useState<string | null>(null);

  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [newDbUser, setNewDbUser] = useState<string>('');
  const [newDbPass, setNewDbPass] = useState<string>('');
  const [targetDbForUser, setTargetDbForUser] = useState<string>('');
  const [dbUserError, setDbUserError] = useState<string | null>(null);

  // phpMyAdmin credentials
  const [pmaCredentials, setPmaCredentials] = useState<{ user: string; password: string; installed: boolean } | null>(null);
  const [pmaPassVisible, setPmaPassVisible] = useState<boolean>(false);
  const [pmaCopied, setPmaCopied] = useState<'user'|'pass'|null>(null);
  const [pmaUserEdit, setPmaUserEdit] = useState<string>('');
  const [pmaPassEdit, setPmaPassEdit] = useState<string>('');
  const [isEditingPma, setIsEditingPma] = useState<boolean>(false);


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

      // Web Services
      wsTitle: 'Web Services & Stack Manager',
      wsDesc: 'Select and manage your primary web server stack. Compatibility conflicts are shown automatically.',
      wsStackTitle: 'Initialize Web Server Stack',
      wsStackDesc: 'Choose your primary web server. Only one server can listen on port 80/443 at a time.',
      wsConflict: 'Conflicts with',
      wsInstallStack: 'Install This Stack',
      wsCombo: 'Nginx + Apache Combo',
      wsComboDesc: 'Nginx handles port 80 as a proxy; Apache processes PHP on port 8080.',

      // Databases
      dbTitle: 'Database Services & Users',
      dbDesc: 'Manage databases and users. Admin tools are detected automatically based on installed engines.',
      createDbBtn: 'Create Database',
      dbNameLabel: 'New Database Name',
      dbNamePlaceholder: 'e.g. blog_database',
      colDb: 'Database Name',
      colDbSize: 'Size',
      noDbs: 'No databases found on your server.',
      pmaTip: 'Fast shortcut to phpMyAdmin on this server:',
      openPmaBtn: 'Access phpMyAdmin',

      // DB Users
      usersTitle: 'Database Users',
      createUsersBtn: 'Create New DB User',
      colUsername: 'Username',
      colHost: 'Allowed Host',
      colAccessDb: 'Assigned Database',
      noUsers: 'No specific DB users found.',

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
      tabDbs: 'Dịch vụ Database & User',
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
      dbTitle: 'Dịch vụ Database & Users',
      dbDesc: 'Quản lý database và tài khoản. Công cụ admin được phát hiện tự động theo engine đã cài.',
      createDbBtn: 'Tạo mới Database',
      dbNameLabel: 'Tên Database',
      dbNamePlaceholder: 'VD: dulieu_blog',
      colDb: 'Tên Database',
      colDbSize: 'Kích thước',
      noDbs: 'Chưa có database nào được tìm thấy.',
      pmaTip: 'Đường dẫn truy cập nhanh phpMyAdmin trên máy chủ của bạn:',
      openPmaBtn: 'Truy cập phpMyAdmin',

      // DB Users
      usersTitle: 'Tài khoản Database',
      createUsersBtn: 'Tạo tài khoản DB mới',
      colUsername: 'Tài khoản',
      colHost: 'Host cho phép',
      colAccessDb: 'Cơ sở dữ liệu',
      noUsers: 'Chưa có tài khoản database nào được tìm thấy.',

      // Web Services
      wsTitle: 'Dịch vụ Web & Quản lý Stack',
      wsDesc: 'Chọn và quản lý web server chính. Cảnh báo xung đột được phát hiện tự động.',
      wsStackTitle: 'Khởi tạo Web Server Stack',
      wsStackDesc: 'Chọn web server chính. Chỉ một dịch vụ có thể lắng nghe cổng 80/443 cùng lúc.',
      wsConflict: 'Xung đột với',
      wsInstallStack: 'Cài đặt Stack này',
      wsCombo: 'Combo Nginx + Apache',
      wsComboDesc: 'Nginx xử lý cổng 80 làm proxy; Apache xử lý PHP ở cổng 8080.',
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
      const response = await fetch('/api/web_manager/list', { headers: authHeaders });
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
      const response = await fetch('/api/web_manager/web_services', { headers: authHeaders });
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

  const fetchDbEngines = async () => {
    setLoadingEngines(true);
    try {
      const res = await fetch('/api/web_manager/db_admin_tools', { headers: authHeaders });
      if (res.ok) {
        const d = await res.json();
        if (d.engines) setDbEngines(d.engines);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEngines(false);
    }
  };

  const fetchDatabases = async () => {
    setLoadingDbs(true);
    try {
      const response = await fetch('/api/database_manager/list', { headers: authHeaders });
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

  const fetchDbUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch('/api/database_manager/users', { headers: authHeaders });
      if (response.ok) {
        const d = await response.json();
        if (d.users) setDbUsers(d.users);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchPmaCredentials = async () => {
    try {
      const res = await fetch('/api/web_manager/phpmyadmin', { headers: authHeaders });
      if (res.ok) {
        const d = await res.json();
        setPmaCredentials(d);
        if (d.user) setPmaUserEdit(d.user);
        if (d.password) setPmaPassEdit(d.password);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const copyPma = (type: 'user'|'pass', val: string) => {
    navigator.clipboard.writeText(val);
    setPmaCopied(type);
    setTimeout(() => setPmaCopied(null), 2000);
  };

  const buildAdminToolUrl = (adminPath: string) => {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const currentPort = window.location.port;
    const normalizedPath = adminPath.startsWith('/') ? adminPath : `/${adminPath}`;

    // DB admin tools are usually exposed by web server on 80/443, not panel UI port.
    if (currentPort && currentPort !== '80' && currentPort !== '443') {
      return `${protocol}//${host}${normalizedPath}`;
    }
    return `${window.location.origin}${normalizedPath}`;
  };

  const handleSavePmaCredentials = async () => {
    try {
      const res = await fetch('/api/web_manager/phpmyadmin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user: pmaUserEdit, password: pmaPassEdit })
      });
      if (res.ok) {
        alert(language === 'vi' ? 'Lưu tài khoản phpMyAdmin thành công!' : 'phpMyAdmin account saved successfully!');
        setIsEditingPma(false);
        fetchPmaCredentials();
      } else {
        const d = await res.json();
        alert(d.detail || 'Failed to save credentials');
      }
    } catch (err) {
      console.error(err);
    }
  };


  const fetchPhpIni = async (version: string) => {
    try {
      const response = await fetch(`/api/php_manager/php_ini/${version}`, { headers: authHeaders });
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
    if (activeTab === 'databases') {
      fetchDatabases();
      fetchDbUsers();
      fetchPmaCredentials();
      fetchDbEngines();
    }
    if (activeTab === 'php') fetchPhpIni(phpManagerVersion);
  }, [activeTab, phpManagerVersion]);


  // PHP version/module options fetching
  useEffect(() => {
    const fetchPhpOptions = async () => {
      try {
        const resV = await fetch('/api/php_manager/versions', { headers: authHeaders });
        if (resV.ok) {
          const dV = await resV.json();
          if (dV.versions) setAvailablePhpVersions(dV.versions);
        }
        const resM = await fetch('/api/php_manager/modules', { headers: authHeaders });
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        method: 'POST',
        headers: authHeaders
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

  const handleInstallStack = async (stack: string) => {
    setInstallingStack(stack);
    setStackMsg(null);
    try {
      const res = await fetch('/api/web_manager/web_services/install_stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ stack })
      });
      const d = await res.json();
      if (res.ok) {
        setStackMsg({ msg: d.message || 'Stack installed.', isError: false });
        fetchWebServices();
      } else {
        setStackMsg({ msg: d.detail || 'Install failed.', isError: true });
      }
    } catch (err) {
      setStackMsg({ msg: 'Network error.', isError: true });
    } finally {
      setInstallingStack(null);
    }
  };

  const handleInstallAdminer = async () => {
    setInstallingAdminer(true);
    setAdminerMsg(null);
    try {
      const res = await fetch('/api/web_manager/db_admin_tools/adminer/install', { method: 'POST', headers: authHeaders });
      const d = await res.json();
      if (res.ok) {
        setAdminerMsg({ msg: d.message || 'Adminer installed.', isError: false });
        fetchDbEngines();
      } else {
        setAdminerMsg({ msg: d.detail || 'Install failed.', isError: true });
      }
    } catch {
      setAdminerMsg({ msg: 'Network error.', isError: true });
    } finally {
      setInstallingAdminer(false);
    }
  };

  const handleInstallEngineTool = async (engineId: string) => {
    setInstallingEngineId(engineId);
    setAdminerMsg(null);
    try {
      const res = await fetch(`/api/web_manager/db_admin_tools/${engineId}/install`, { method: 'POST', headers: authHeaders });
      const d = await res.json();
      if (res.ok) {
        setAdminerMsg({ msg: d.message || 'Installation completed.', isError: false });
        fetchDbEngines();
      } else {
        setAdminerMsg({ msg: d.detail || 'Install failed.', isError: true });
      }
    } catch {
      setAdminerMsg({ msg: 'Network error.', isError: true });
    } finally {
      setInstallingEngineId(null);
    }
  };


  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim()) return;
    setDbError(null);
    try {
      const response = await fetch('/api/database_manager/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: dbname })
      });
      if (response.ok) {
        fetchDatabases();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateDbUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbUser.trim() || !newDbPass.trim()) return;
    setDbUserError(null);
    try {
      const response = await fetch('/api/database_manager/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          user: newDbUser,
          host: 'localhost',
          password: newDbPass,
          db: targetDbForUser || 'all_databases'
        })
      });
      const d = await response.json();
      if (!response.ok) {
        throw new Error(d.detail || 'Failed to create user');
      }
      setNewDbUser('');
      setNewDbPass('');
      setTargetDbForUser('');
      fetchDbUsers();
    } catch (err) {
      setDbUserError(err instanceof Error ? err.message : 'Error creating database user');
    }
  };

  const handleDeleteDbUser = async (username: string, host: string) => {
    if (!confirm(language === 'vi' ? `Bạn có chắc muốn xóa tài khoản ${username}?` : `Delete database user ${username}?`)) return;
    try {
      const response = await fetch('/api/database_manager/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user: username, host })
      });
      if (response.ok) {
        fetchDbUsers();
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
            <span className={`text-xs font-mono px-2 py-0.5 rounded border tracking-normal ${isDark ? 'text-blue-300 bg-blue-900/30 border-blue-800' : 'text-blue-600 bg-blue-50 border-blue-200'}`}>
              v1.0.5
            </span>
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
            <>
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
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                          ws.status === 'running' ? (isDark ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-green-100 text-green-700 border-green-200')
                          : ws.status === 'stopped' ? (isDark ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-red-100 text-red-700 border-red-200')
                          : (isDark ? 'bg-slate-500/15 text-slate-400 border-slate-500/30' : 'bg-slate-100 text-slate-500 border-slate-200')
                        }`}>
                          {ws.installed ? ws.status : 'not installed'}
                        </span>
                      </div>
                      <p className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{ws.description}</p>
                      {ws.conflicts_with?.length > 0 && (
                        <div className={`flex items-center gap-1.5 text-[10px] font-semibold mt-1 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                          <Icons.AlertTriangle className="w-3 h-3 shrink-0" />
                          {tr.wsConflict}: {ws.conflicts_with.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="border-t pt-3 dark:border-slate-800/60">
                      {!ws.installed ? (
                        <button
                          onClick={() => handleInstallStack(ws.id)}
                          disabled={installingStack !== null || ws.conflicts_with?.length > 0}
                          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold text-xs text-white transition shadow-sm"
                        >
                          {installingStack === ws.id ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Download className="w-3.5 h-3.5" />}
                          {installingStack === ws.id ? (language === 'vi' ? 'Đang cài...' : 'Installing...') : tr.wsInstallStack}
                        </button>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5 w-full">
                          <button onClick={() => handleServiceAction(ws.id, 'start')} className="flex items-center justify-center p-1.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-bold transition"><Icons.Play className="w-3 h-3" /></button>
                          <button onClick={() => handleServiceAction(ws.id, 'stop')} className="flex items-center justify-center p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition"><Icons.Square className="w-3 h-3" /></button>
                          <button onClick={() => handleServiceAction(ws.id, 'restart')} className="flex items-center justify-center p-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl text-xs font-bold transition"><Icons.RotateCcw className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Nginx + Apache Combo */}
              <div className={`border rounded-2xl p-5 space-y-3 ${isDark ? 'border-violet-800/30 bg-violet-950/10' : 'border-violet-200 bg-violet-50/40'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-violet-300' : 'text-violet-700'}`}>
                      <Icons.Layers className="w-4 h-4" /> {tr.wsCombo}
                    </h4>
                    <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.wsComboDesc}</p>
                  </div>
                  <button
                    onClick={() => handleInstallStack('nginx_apache')}
                    disabled={installingStack !== null}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition shadow-sm disabled:opacity-50"
                  >
                    {installingStack === 'nginx_apache' ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Download className="w-3.5 h-3.5" />}
                    {tr.wsInstallStack}
                  </button>
                </div>
                <div className={`text-[11px] flex items-center gap-1.5 px-3 py-2 rounded-xl border ${isDark ? 'bg-amber-950/20 border-amber-800/30 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                  <Icons.Info className="w-3.5 h-3.5 shrink-0" />
                  {language === 'vi' ? 'Nginx nghe cổng 80/443, Apache2 tự động cấu hình sang cổng 8080.' : 'Nginx listens on 80/443; Apache2 is auto-configured to port 8080.'}
                </div>
              </div>
            </>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              {language === 'vi' ? 'Không có dịch vụ web nào.' : 'No web services found.'}
            </div>
          )}
        </div>
      )}

      {activeTab === 'databases' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">

          {/* Smart DB Admin Panel - full width */}
          <div className={`md:col-span-2 border rounded-2xl p-5 space-y-4 transition-all ${
            isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            <div>
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.Database className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                {language === 'vi' ? 'Công cụ Quản lý Database Admin' : 'Database Admin Tools'}
              </h3>
              <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.dbDesc}</p>
            </div>

            {adminerMsg && (
              <div className={`p-3 border rounded-xl text-xs flex items-center gap-2 ${adminerMsg.isError ? (isDark ? 'bg-red-950/20 border-red-800/40 text-red-400' : 'bg-red-50 border-red-200 text-red-600') : (isDark ? 'bg-green-950/20 border-green-800/40 text-green-400' : 'bg-green-50 border-green-200 text-green-700')}`}>
                {adminerMsg.isError ? <Icons.AlertCircle className="w-4 h-4 shrink-0" /> : <Icons.CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span>{adminerMsg.msg}</span>
              </div>
            )}

            {loadingEngines ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
                <span>{language === 'vi' ? 'Đang phát hiện database engines...' : 'Detecting database engines...'}</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {dbEngines.map((engine: any, idx: number) => {
                  const colorMap: Record<string, string> = {
                    mysql: isDark ? 'border-blue-800/40 bg-blue-950/15' : 'border-blue-200 bg-blue-50/40',
                    postgresql: isDark ? 'border-sky-800/40 bg-sky-950/15' : 'border-sky-200 bg-sky-50/40',
                    adminer: isDark ? 'border-emerald-800/40 bg-emerald-950/15' : 'border-emerald-200 bg-emerald-50/40',
                  };
                  const iconColorMap: Record<string, string> = {
                    mysql: isDark ? 'text-blue-400' : 'text-blue-600',
                    postgresql: isDark ? 'text-sky-400' : 'text-sky-600',
                    adminer: isDark ? 'text-emerald-400' : 'text-emerald-600',
                  };
                  return (
                    <div key={idx} className={`border rounded-2xl p-5 flex flex-col gap-4 transition ${colorMap[engine.id] || (isDark ? 'border-slate-800/60 bg-slate-950/30' : 'border-slate-200 bg-slate-50/50')}`}>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{engine.name}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                            engine.status === 'running' ? (isDark ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-green-100 text-green-700 border-green-200')
                            : engine.status === 'stopped' ? (isDark ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border-yellow-200')
                            : engine.status === 'available' ? (isDark ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border-emerald-200')
                            : (isDark ? 'bg-slate-500/15 text-slate-400 border-slate-500/30' : 'bg-slate-100 text-slate-500 border-slate-200')
                          }`}>
                            {engine.status === 'not_installed' ? (language === 'vi' ? 'Chưa cài' : 'Not installed') : engine.status}
                          </span>
                        </div>
                        {engine.version && <p className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{engine.version}</p>}
                        <div className="flex items-center gap-1.5">
                          <Icons.ExternalLink className={`w-3 h-3 ${iconColorMap[engine.id] || 'text-blue-500'}`} />
                          <span className={`text-[11px] font-semibold ${iconColorMap[engine.id] || 'text-blue-500'}`}>{engine.admin_name}</span>
                          {engine.admin_installed
                            ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isDark ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700'}`}>✓</span>
                            : <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{language === 'vi' ? 'Chưa cài' : 'Not installed'}</span>
                          }
                        </div>
                      </div>
                      <div className="border-t pt-3 dark:border-slate-800/40 flex flex-col gap-2">
                        {engine.admin_installed ? (
                          <button
                            onClick={() => window.open(buildAdminToolUrl(engine.admin_url), '_blank')}
                            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl font-bold text-xs text-white transition shadow-sm ${
                              engine.id === 'mysql' ? 'bg-blue-600 hover:bg-blue-500'
                              : engine.id === 'postgresql' ? 'bg-sky-600 hover:bg-sky-500'
                              : 'bg-emerald-600 hover:bg-emerald-500'
                            }`}
                          >
                            <Icons.ExternalLink className="w-3.5 h-3.5" />
                            {language === 'vi' ? `Mở ${engine.admin_name}` : `Open ${engine.admin_name}`}
                          </button>
                        ) : (
                          <button
                            onClick={engine.id === 'adminer' ? handleInstallAdminer : () => handleInstallEngineTool(engine.id)}
                            disabled={installingAdminer || installingEngineId !== null}
                            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl font-bold text-xs text-white disabled:opacity-50 transition shadow-sm ${
                              engine.id === 'mysql' ? 'bg-blue-600 hover:bg-blue-500' :
                              engine.id === 'postgresql' ? 'bg-sky-600 hover:bg-sky-500' :
                              'bg-emerald-600 hover:bg-emerald-500'
                            }`}
                          >
                            {(installingAdminer || installingEngineId === engine.id) ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Download className="w-3.5 h-3.5" />}
                            {(installingAdminer || installingEngineId === engine.id)
                              ? (language === 'vi' ? 'Đang cài...' : 'Installing...')
                              : (language === 'vi'
                                ? `Cài ${engine.admin_name || engine.name}`
                                : `Install ${engine.admin_name || engine.name}`)}
                          </button>
                        )}
                        {/* phpMyAdmin credentials for MySQL */}
                        {engine.id === 'mysql' && engine.admin_installed && (
                          <div className="space-y-2 mt-1">
                            <button onClick={() => setIsEditingPma(v => !v)} className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border transition ${isDark ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                              <Icons.Settings className="w-3.5 h-3.5" />
                              {isEditingPma ? (language === 'vi' ? 'Hủy' : 'Cancel') : (language === 'vi' ? 'Quản lý tài khoản MySQL' : 'Manage MySQL Account')}
                            </button>
                            {isEditingPma && (
                              <div className="space-y-2 border rounded-xl p-3 dark:border-slate-800">
                                <input type="text" value={pmaUserEdit} onChange={e => setPmaUserEdit(e.target.value)} placeholder="Username" className={`w-full border px-3 py-2 rounded-xl outline-none font-mono text-xs focus:border-blue-500 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
                                <input type="password" value={pmaPassEdit} onChange={e => setPmaPassEdit(e.target.value)} placeholder="Password" className={`w-full border px-3 py-2 rounded-xl outline-none font-mono text-xs focus:border-blue-500 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`} />
                                <button onClick={handleSavePmaCredentials} disabled={!pmaUserEdit || !pmaPassEdit} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition">
                                  <Icons.Save className="w-3.5 h-3.5" />{language === 'vi' ? 'Lưu tài khoản' : 'Save Account'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Databases Panel */}
          <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-6 transition-all duration-300 shadow-sm ${
            isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            <div className="space-y-2">
              <h3 className={`text-sm font-bold flex items-center justify-between ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <span className="flex items-center gap-2">
                  <Icons.Database className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.dbTitle}
                </span>
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
              <div className="space-y-4 animate-fade-in max-h-[300px] overflow-auto border rounded-xl dark:border-slate-800/60 p-2">
                <div className={`overflow-x-auto rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
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
                          <td className="p-4 font-bold text-blue-500 dark:text-blue-400 truncate max-w-[150px]" title={db.name}>
                            {db.name}
                          </td>
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
          </div>

          {/* Database Users Panel */}
          <div className={`border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-6 transition-all duration-300 shadow-sm ${
            isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            <div className="space-y-2">
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.User className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.usersTitle}
              </h3>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Create user credentials and link them directly to a specific SQL Database.
              </p>
            </div>

            <form onSubmit={handleCreateDbUser} className={`border p-5 rounded-xl space-y-4 max-w-xl transition duration-200 ${
              isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50/40 border-slate-100'
            }`}>
              <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {tr.createUsersBtn}
              </h4>
              {dbUserError && (
                <div className={`p-3 text-xs border rounded-xl flex items-center gap-2 ${isDark ? 'bg-red-950/10 border-red-800/40 text-red-400' : 'bg-red-50 border-red-100 text-red-600'}`}>
                  <Icons.AlertTriangle className="w-4 h-4" /> {dbUserError}
                </div>
              )}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={newDbUser}
                    onChange={(e) => setNewDbUser(e.target.value)}
                    placeholder={tr.colUsername}
                    className={`border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                      isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                    required
                  />
                  <input
                    type="password"
                    value={newDbPass}
                    onChange={(e) => setNewDbPass(e.target.value)}
                    placeholder="Password"
                    className={`border px-4 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                      isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                    required
                  />
                </div>
                <div className="flex flex-col md:flex-row items-center gap-3">
                  <select
                    value={targetDbForUser}
                    onChange={(e) => setTargetDbForUser(e.target.value)}
                    className={`flex-1 w-full border px-3 py-2 rounded-xl outline-none focus:border-blue-500 font-mono text-xs transition-all ${
                      isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  >
                    <option value="">{language === 'vi' ? '— Gán tất cả DBs —' : '— Assign all DBs —'}</option>
                    {databases.map((db, idx) => (
                      <option key={idx} value={db.name}>{db.name}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm"
                  >
                    <Icons.Plus className="w-4 h-4" />
                    {tr.create}
                  </button>
                </div>
              </div>
            </form>

            {loadingUsers ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
                <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
                <p>{tr.loadingSites}</p>
              </div>
            ) : dbUsers.length > 0 ? (
              <div className="space-y-4 animate-fade-in max-h-[300px] overflow-auto border rounded-xl dark:border-slate-800/60 p-2">
                <div className={`overflow-x-auto rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                  <table className="w-full text-left border-collapse select-none">
                    <thead>
                      <tr className={`border-b text-xs font-bold uppercase tracking-widest ${
                        isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50/80 border-slate-100 text-slate-600'
                      }`}>
                        <th className="p-4">{tr.colUsername}</th>
                        <th className="p-4">{tr.colAccessDb}</th>
                        <th className="p-4 text-center">{tr.colActions}</th>
                      </tr>
                    </thead>
                    <tbody className={`text-xs divide-y font-mono ${isDark ? 'text-slate-200 divide-slate-800/40' : 'text-slate-700 divide-slate-100'}`}>
                      {dbUsers.map((user, idx) => (
                        <tr key={idx} className={`transition-all ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/60'}`}>
                          <td className="p-4 font-bold text-blue-500 dark:text-blue-400 truncate max-w-[150px]" title={user.user}>
                            {user.user}
                          </td>
                          <td className="p-4 truncate max-w-[150px]" title={user.db}>{user.db || 'Selected'}</td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => handleDeleteDbUser(user.user, user.host || 'localhost')}
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
                {tr.noUsers}
              </div>
            )}
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
