/**
 * Premium Users and Permissions Management Dashboard
 */
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

interface UserProfile {
  id: number;
  username: string;
  role: 'superadmin' | 'user';
  permitted_modules: string | string[];
  permitted_folders: string | string[];
}

interface AvailableModule {
  id: string;
  label: string;
  source: 'core' | 'package';
}

export default function UsersDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [availableModules, setAvailableModules] = useState<AvailableModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'superadmin' | 'user'>('user');
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [folderInput, setFolderInput] = useState<string>('/home/');

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const token = localStorage.getItem('copanel_token');

  const t = {
    en: {
      title: 'User Accounts & Roles',
      desc: 'As a SuperAdmin, you can create, modify, or remove user accounts. Isolate their accessible files via specific home directory paths (e.g., /home/user1/) and specify accessible dynamic modules.',
      activeAccounts: 'Active Accounts',
      totalRecords: 'Total Records',
      createAccount: 'Create Account',
      usernameLabel: 'Username',
      passwordLabel: 'Password',
      roleLabel: 'Role',
      user: 'User',
      superAdmin: 'SuperAdmin',
      permittedModules: 'Permitted Modules',
      deselectAll: 'Deselect All',
      selectAll: 'Select All',
      isolatedDirs: 'Isolated Directories',
      dirTip: "Accessible folder path. Set to '/' for full system access.",
      addBtn: 'Add User Profile',
      registeredTitle: 'Registered Accounts',
      colUsername: 'Username',
      colRole: 'Role',
      colPermissions: 'Permissions',
      colAction: 'Action',
      modules: 'Modules',
      restrictedHome: 'Restricted Home',
      deleteBtn: 'Delete',
      loadingUsers: 'Loading user accounts...',
      fillError: 'Please fill in username and password.',
      regError: 'Failed to register new user profile.',
      commError: 'Failed to reach authentication backend.',
      deleteConfirm: 'Are you sure you want to delete this user?',
      availableModules: 'Available modules',
      none: 'None',
      allAccess: 'All',
      coreModule: 'Core',
      installedPackage: 'Installed',
    },
    vi: {
      title: 'Tài khoản người dùng & Quyền hạn',
      desc: 'Là quản trị viên cao cấp, bạn có thể tạo mới, chỉnh sửa hoặc xóa các tài khoản người dùng khác. Thiết lập thư mục cô lập (ví dụ: /home/user1/) và các module mà họ được phép sử dụng.',
      activeAccounts: 'Tài khoản hoạt động',
      totalRecords: 'Tổng số tài khoản',
      createAccount: 'Tạo tài khoản',
      usernameLabel: 'Tên tài khoản',
      passwordLabel: 'Mật khẩu',
      roleLabel: 'Vai trò',
      user: 'Người dùng',
      superAdmin: 'Quản trị viên',
      permittedModules: 'Các module được phép',
      deselectAll: 'Bỏ chọn hết',
      selectAll: 'Chọn tất cả',
      isolatedDirs: 'Thư mục cô lập',
      dirTip: "Đường dẫn thư mục được truy cập. Đặt thành '/' để cấp quyền truy cập toàn bộ hệ thống.",
      addBtn: 'Thêm tài khoản',
      registeredTitle: 'Tài khoản đã đăng ký',
      colUsername: 'Tên tài khoản',
      colRole: 'Vai trò',
      colPermissions: 'Quyền truy cập',
      colAction: 'Thao tác',
      modules: 'Các module',
      restrictedHome: 'Thư mục giới hạn',
      deleteBtn: 'Xóa',
      loadingUsers: 'Đang tải danh sách tài khoản...',
      fillError: 'Vui lòng điền tên đăng nhập và mật khẩu.',
      regError: 'Không thể đăng ký tài khoản mới này.',
      commError: 'Không thể kết nối tới máy chủ.',
      deleteConfirm: 'Bạn có chắc chắn muốn xóa tài khoản này không?',
      availableModules: 'Module khả dụng',
      none: 'Không có',
      allAccess: 'Toàn quyền',
      coreModule: 'Core',
      installedPackage: 'Đã cài',
    }
  };

  const tr = t[language || 'en'];

  const fetchUsers = () => {
    setLoading(true);
    fetch('/api/auth/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.users) {
          setUsers(data.users);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  const formatModuleLabel = (id: string) =>
    id
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const fetchAvailableModules = async () => {
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [coreRes, pkgRes] = await Promise.all([
        fetch('/api/modules', { headers }),
        fetch('/api/package_manager/list', { headers }),
      ]);

      const next: AvailableModule[] = [];
      const seen = new Set<string>();

      if (coreRes.ok) {
        const data = await coreRes.json();
        const modules = Array.isArray(data?.modules) ? data.modules : [];
        modules.forEach((id: string) => {
          if (!id || seen.has(id)) return;
          seen.add(id);
          next.push({ id, label: formatModuleLabel(id), source: 'core' });
        });
      }

      if (pkgRes.ok) {
        const data = await pkgRes.json();
        const packages = Array.isArray(data?.packages) ? data.packages : [];
        packages
          .filter((p: any) => p?.id && p?.status !== 'not_installed')
          .forEach((p: any) => {
            const id = String(p.id);
            if (seen.has(id)) return;
            seen.add(id);
            next.push({
              id,
              label: p.name || formatModuleLabel(id),
              source: 'package',
            });
          });
      }

      setAvailableModules(next);
      setSelectedModules((current) => current.filter((id) => seen.has(id)));
    } catch (err) {
      console.error('Failed to load available modules:', err);
      setAvailableModules([]);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAvailableModules();
  }, [language]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(tr.fillError);
      return;
    }

    setError(null);

    const pFolders = folderInput.split(',').map(f => f.trim()).filter(Boolean);

    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username,
          password,
          role,
          permitted_modules: role === 'superadmin' ? ['all'] : selectedModules,
          permitted_folders: pFolders
        })
      });

      if (res.ok) {
        setUsername('');
        setPassword('');
        setSelectedModules([]);
        setFolderInput('/home/');
        fetchUsers();
        fetchAvailableModules();
      } else {
        const errData = await res.json();
        setError(errData.detail || tr.regError);
      }
    } catch {
      setError(tr.commError);
    }
  };

  const toggleModule = (id: string) => {
    if (selectedModules.includes(id)) {
      setSelectedModules(selectedModules.filter((m) => m !== id));
    } else {
      setSelectedModules([...selectedModules, id]);
    }
  };

  const toggleSelectAllModules = () => {
    if (selectedModules.length === availableModules.length) {
      setSelectedModules([]);
    } else {
      setSelectedModules(availableModules.map((m) => m.id));
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm(tr.deleteConfirm)) return;
    try {
      const res = await fetch(`/api/auth/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const parseJsonList = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      return JSON.parse(val);
    } catch {
      return [String(val)];
    }
  };

  const formatPermissionModules = (value: string | string[]) => {
    const ids = parseJsonList(value);
    if (ids.includes('all')) return tr.allAccess;
    if (!ids.length) return tr.none;
    return ids
      .map((id) => availableModules.find((m) => m.id === id)?.label || formatModuleLabel(id))
      .join(', ');
  };

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-indigo-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 border-slate-200 shadow-slate-100'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${
            isDark ? 'bg-gradient-to-r from-indigo-400 via-purple-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className={`flex flex-col items-center md:items-end gap-1 text-right p-4 rounded-xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] ${
          isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-50/60 border-slate-200 shadow-sm'
        }`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{tr.activeAccounts}</span>
          <span className={`text-lg md:text-2xl font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{users.length}</span>
          <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.totalRecords}</span>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2 max-w-xl">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <form onSubmit={handleCreateUser} className={`border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'}`}>
          <h3 className={`text-lg font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            <Icons.UserPlus className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.createAccount}
          </h3>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.usernameLabel}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user1"
                required
                className={`w-full border rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.passwordLabel}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={`w-full border rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.roleLabel}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className={`w-full border rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                }`}
              >
                <option value="user">{tr.user}</option>
                <option value="superadmin">{tr.superAdmin}</option>
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.permittedModules}</label>
                <button
                  type="button"
                  onClick={toggleSelectAllModules}
                  className={`text-[10px] transition ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-500'}`}
                >
                  {selectedModules.length === availableModules.length ? tr.deselectAll : tr.selectAll}
                </button>
              </div>
              <p className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {tr.availableModules}: {availableModules.length}
              </p>
              <div className={`flex flex-wrap gap-1.5 p-3.5 border rounded-xl min-h-[85px] ${isDark ? 'bg-slate-950/40 border-slate-800/60' : 'bg-slate-50 border-slate-100'}`}>
                {availableModules.map((m) => {
                  const isSelected = selectedModules.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModule(m.id)}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-xl border transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/10'
                          : isDark ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-300' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {m.label} <span className="opacity-70">({m.source === 'core' ? tr.coreModule : tr.installedPackage})</span>
                    </button>
                  );
                })}
                {availableModules.length === 0 && (
                  <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.none}</span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tr.isolatedDirs}</label>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="/home/"
                className={`w-full border rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-all ${
                  isDark ? 'bg-slate-950 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'
                }`}
              />
              <span className={`text-[10px] block leading-tight ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.dirTip}</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-xs text-white shadow-lg hover:shadow-indigo-500/20 transition-all duration-200"
          >
            <Icons.UserPlus className="w-3.5 h-3.5" />
            {tr.addBtn}
          </button>
        </form>

        <div className={`lg:col-span-2 border p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
          <h3 className={`text-lg font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            <Icons.Users className={`w-5 h-5 ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            {tr.registeredTitle} ({users.length})
          </h3>

          {loading ? (
            <div className={`flex flex-col items-center justify-center p-12 border rounded-xl ${isDark ? 'bg-slate-950/40 border-slate-800/50' : 'bg-slate-50 border-slate-100'}`}>
              <Icons.Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs text-slate-400 mt-2">{tr.loadingUsers}</span>
            </div>
          ) : (
            <>
              {/* Desktop view */}
              <div className={`hidden md:block overflow-x-auto border rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                <table className="w-full text-left border-collapse select-none">
                  <thead>
                    <tr className={`border-b text-xs font-bold uppercase tracking-widest ${isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                      <th className="p-4">{tr.colUsername}</th>
                      <th className="p-4">{tr.colRole}</th>
                      <th className="p-4">{tr.colPermissions}</th>
                      <th className="p-4">{tr.colAction}</th>
                    </tr>
                  </thead>
                  <tbody className={`text-xs divide-y ${isDark ? 'divide-slate-800/40 text-slate-200' : 'divide-slate-100 text-slate-700'}`}>
                    {users.map((u) => (
                      <tr key={u.id} className={`transition duration-150 ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'}`}>
                        <td className={`p-4 font-mono font-bold ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>{u.username}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded border ${
                            u.role === 'superadmin'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : isDark ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {u.role === 'superadmin' ? tr.superAdmin : tr.user}
                          </span>
                        </td>
                        <td className="p-4 space-y-1.5 min-w-[180px]">
                          <div>
                            <span className={`text-[10px] uppercase font-semibold block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.modules}:</span>
                            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${isDark ? 'text-slate-300 bg-slate-900/60 border-slate-800' : 'text-slate-700 bg-slate-50 border-slate-100'}`}>
                              {formatPermissionModules(u.permitted_modules)}
                            </span>
                          </div>
                          <div>
                            <span className={`text-[10px] uppercase font-semibold block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.restrictedHome}:</span>
                            <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${isDark ? 'text-slate-300 bg-slate-900/60 border-slate-800' : 'text-slate-700 bg-slate-50 border-slate-100'}`}>
                              {parseJsonList(u.permitted_folders).join(', ') || '/'}
                            </span>
                          </div>
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            disabled={u.username === 'admin'}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold border rounded-xl transition-all ${
                              isDark ? 'text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/40 border-red-900/40 disabled:opacity-50' : 'text-red-600 hover:bg-red-100 bg-red-50 border-red-200 disabled:opacity-40'
                            }`}
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5" />
                            {tr.deleteBtn}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile view - Cards */}
              <div className="grid grid-cols-1 gap-4 md:hidden">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`p-4 rounded-xl border flex flex-col justify-between gap-4 transition duration-200 ${
                      isDark ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-mono font-bold ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>
                          {u.username}
                        </span>
                        <span className={`px-2 py-0.5 text-[10px] rounded border ${
                          u.role === 'superadmin'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : isDark ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {u.role === 'superadmin' ? tr.superAdmin : tr.user}
                        </span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className={`text-[10px] uppercase font-bold block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.modules}</span>
                          <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border block mt-0.5 ${isDark ? 'text-slate-300 bg-slate-950/40 border-slate-800' : 'text-slate-700 bg-slate-50 border-slate-100'}`}>
                            {formatPermissionModules(u.permitted_modules)}
                          </span>
                        </div>
                        <div>
                          <span className={`text-[10px] uppercase font-bold block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.restrictedHome}</span>
                          <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border block mt-0.5 ${isDark ? 'text-slate-300 bg-slate-950/40 border-slate-800' : 'text-slate-700 bg-slate-50 border-slate-100'}`}>
                            {parseJsonList(u.permitted_folders).join(', ') || '/'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end border-t pt-3 dark:border-slate-800">
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        disabled={u.username === 'admin'}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold border rounded-xl transition-all ${
                          isDark ? 'text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/40 border-red-900/40 disabled:opacity-50' : 'text-red-600 hover:bg-red-100 bg-red-50 border-red-200 disabled:opacity-40'
                        }`}
                      >
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                        {tr.deleteBtn}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
