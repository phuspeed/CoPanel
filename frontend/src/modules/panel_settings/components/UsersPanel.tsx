import { useCallback, useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../../core/platform';

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

interface Props {
  isDark: boolean;
  language: 'en' | 'vi';
  card: string;
  input: string;
  label: string;
}

const EXCLUDED_MODULES = new Set(['auth', 'panel_settings']);

export default function UsersPanel({ isDark, language, card, input, label }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [availableModules, setAvailableModules] = useState<AvailableModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'superadmin' | 'user'>('user');
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [folderInput, setFolderInput] = useState('/home/');
  const [busy, setBusy] = useState(false);

  const t = {
    en: {
      title: 'User accounts & roles',
      desc: 'Create, modify, or remove panel user accounts. Set isolated home directories and module permissions.',
      createAccount: 'Create account',
      usernameLabel: 'Username',
      passwordLabel: 'Password',
      roleLabel: 'Role',
      user: 'User',
      superAdmin: 'SuperAdmin',
      permittedModules: 'Permitted modules',
      deselectAll: 'Deselect all',
      selectAll: 'Select all',
      isolatedDirs: 'Isolated directories',
      dirTip: "Accessible folder path. Set to '/' for full system access.",
      addBtn: 'Add user',
      registeredTitle: 'Registered accounts',
      colUsername: 'Username',
      colRole: 'Role',
      colPermissions: 'Permissions',
      colAction: 'Action',
      modules: 'Modules',
      restrictedHome: 'Restricted home',
      deleteBtn: 'Delete',
      loadingUsers: 'Loading user accounts…',
      fillError: 'Please fill in username and password.',
      regError: 'Failed to register new user.',
      deleteConfirm: 'Are you sure you want to delete this user?',
      availableModules: 'Available modules',
      none: 'None',
      allAccess: 'All',
      coreModule: 'Core',
      installedPackage: 'Installed',
    },
    vi: {
      title: 'Tài khoản & quyền hạn',
      desc: 'Tạo, chỉnh sửa hoặc xóa tài khoản panel. Thiết lập thư mục cô lập và quyền truy cập module.',
      createAccount: 'Tạo tài khoản',
      usernameLabel: 'Tên tài khoản',
      passwordLabel: 'Mật khẩu',
      roleLabel: 'Vai trò',
      user: 'Người dùng',
      superAdmin: 'Quản trị viên',
      permittedModules: 'Module được phép',
      deselectAll: 'Bỏ chọn hết',
      selectAll: 'Chọn tất cả',
      isolatedDirs: 'Thư mục cô lập',
      dirTip: "Đường dẫn thư mục được truy cập. Đặt '/' để cấp quyền toàn hệ thống.",
      addBtn: 'Thêm tài khoản',
      registeredTitle: 'Tài khoản đã đăng ký',
      colUsername: 'Tên tài khoản',
      colRole: 'Vai trò',
      colPermissions: 'Quyền truy cập',
      colAction: 'Thao tác',
      modules: 'Module',
      restrictedHome: 'Thư mục giới hạn',
      deleteBtn: 'Xóa',
      loadingUsers: 'Đang tải tài khoản…',
      fillError: 'Vui lòng điền tên đăng nhập và mật khẩu.',
      regError: 'Không thể tạo tài khoản mới.',
      deleteConfirm: 'Bạn có chắc muốn xóa tài khoản này?',
      availableModules: 'Module khả dụng',
      none: 'Không có',
      allAccess: 'Toàn quyền',
      coreModule: 'Core',
      installedPackage: 'Đã cài',
    },
  }[language];

  const formatModuleLabel = (id: string) =>
    id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ users: UserProfile[] }>('/api/auth/users');
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailableModules = useCallback(async () => {
    try {
      const [coreRes, pkgRes] = await Promise.all([
        fetch('/api/modules'),
        fetch('/api/package_manager/list'),
      ]);

      const next: AvailableModule[] = [];
      const seen = new Set<string>();

      if (coreRes.ok) {
        const data = await coreRes.json();
        const modules = data?.modules;
        const ids = Array.isArray(modules)
          ? modules
          : modules && typeof modules === 'object'
            ? Object.keys(modules)
            : [];
        ids.forEach((id: string) => {
          if (!id || seen.has(id) || EXCLUDED_MODULES.has(id)) return;
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

      next.sort((a, b) => a.label.localeCompare(b.label));
      setAvailableModules(next);
      setSelectedModules((current) => current.filter((id) => seen.has(id)));
    } catch (err) {
      console.error('Failed to load available modules:', err);
      setAvailableModules([]);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchAvailableModules();
  }, [fetchUsers, fetchAvailableModules]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(tr.fillError);
      return;
    }
    setError(null);
    setBusy(true);
    const pFolders = folderInput.split(',').map((f) => f.trim()).filter(Boolean);
    try {
      await api('/api/auth/users', {
        method: 'POST',
        body: {
          username,
          password,
          role,
          permitted_modules: role === 'superadmin' ? ['all'] : selectedModules,
          permitted_folders: pFolders,
        },
      });
      setUsername('');
      setPassword('');
      setSelectedModules([]);
      setFolderInput('/home/');
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || tr.regError);
    } finally {
      setBusy(false);
    }
  };

  const toggleModule = (id: string) => {
    setSelectedModules((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    );
  };

  const toggleSelectAllModules = () => {
    setSelectedModules((current) =>
      current.length === availableModules.length ? [] : availableModules.map((m) => m.id),
    );
  };

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm(tr.deleteConfirm)) return;
    try {
      await api(`/api/auth/users/${id}`, { method: 'DELETE' });
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const parseJsonList = (val: unknown): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      return JSON.parse(String(val));
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

  const chipBtn = (selected: boolean) =>
    `px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
      selected
        ? 'bg-blue-600 border-blue-500 text-white'
        : isDark
          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{tr.title}</h2>
        <p className={`text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.desc}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <form onSubmit={handleCreateUser} className={`${card} space-y-4 h-fit`}>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icons.UserPlus className="w-4 h-4 text-blue-500" />
            {tr.createAccount}
          </h3>

          <div>
            <label className={label}>{tr.usernameLabel}</label>
            <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className={label}>{tr.passwordLabel}</label>
            <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div>
            <label className={label}>{tr.roleLabel}</label>
            <select className={input} value={role} onChange={(e) => setRole(e.target.value as 'superadmin' | 'user')}>
              <option value="user">{tr.user}</option>
              <option value="superadmin">{tr.superAdmin}</option>
            </select>
          </div>

          {role === 'user' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={label}>{tr.permittedModules}</label>
                <button type="button" className="text-[11px] text-blue-500" onClick={toggleSelectAllModules}>
                  {selectedModules.length === availableModules.length ? tr.deselectAll : tr.selectAll}
                </button>
              </div>
              <p className={`text-[11px] mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {tr.availableModules}: {availableModules.length}
              </p>
              <div className={`flex flex-wrap gap-1.5 p-3 border rounded-lg min-h-[72px] ${isDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                {availableModules.map((m) => (
                  <button key={m.id} type="button" onClick={() => toggleModule(m.id)} className={chipBtn(selectedModules.includes(m.id))}>
                    {m.label}
                  </button>
                ))}
                {availableModules.length === 0 && (
                  <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.none}</span>
                )}
              </div>
            </div>
          )}

          <div>
            <label className={label}>{tr.isolatedDirs}</label>
            <input className={input} value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
            <p className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.dirTip}</p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {tr.addBtn}
          </button>
        </form>

        <div className={`xl:col-span-2 ${card} space-y-4`}>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icons.Users className="w-4 h-4 text-blue-500" />
            {tr.registeredTitle} ({users.length})
          </h3>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              {tr.loadingUsers}
            </div>
          ) : (
            <div className={`overflow-x-auto border rounded-lg ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className={`text-xs uppercase ${isDark ? 'bg-slate-950/60 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                    <th className="p-3">{tr.colUsername}</th>
                    <th className="p-3">{tr.colRole}</th>
                    <th className="p-3">{tr.colPermissions}</th>
                    <th className="p-3">{tr.colAction}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="p-3 font-mono font-medium">{u.username}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === 'superadmin' ? 'bg-purple-500/15 text-purple-400' : isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
                          {u.role === 'superadmin' ? tr.superAdmin : tr.user}
                        </span>
                      </td>
                      <td className="p-3 text-xs space-y-1">
                        <div>
                          <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>{tr.modules}: </span>
                          {formatPermissionModules(u.permitted_modules)}
                        </div>
                        <div>
                          <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>{tr.restrictedHome}: </span>
                          {parseJsonList(u.permitted_folders).join(', ') || '/'}
                        </div>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={u.username === 'admin'}
                          onClick={() => handleDeleteUser(u.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border disabled:opacity-40 ${
                            isDark ? 'text-red-400 border-red-900/40 hover:bg-red-950/40' : 'text-red-600 border-red-200 hover:bg-red-50'
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
          )}
        </div>
      </div>
    </div>
  );
}
