/**
 * Database Manager — Desktop sidebar shell + Classic full-page (dual UI).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';
import ModuleViewport from '../../core/shell/ModuleViewport';
import WindowModal from '../../core/shell/WindowModal';

type EngineId = 'mysql' | 'postgres';
type Tab = 'databases' | 'users';
type ConfirmKind = 'deleteDb' | 'deleteUser';

interface EngineOverview {
  installed: boolean;
  running: boolean;
  mode: string;
  engine: EngineId;
  database_count: number;
  user_count: number;
}

interface DbItem {
  name: string;
  size?: string;
}

interface UserItem {
  user: string;
  host?: string;
  db?: string;
}

const COPY = {
  en: {
    category: 'Databases',
    title: 'Database Manager',
    subtitle: 'Manage MySQL/MariaDB and PostgreSQL databases and users.',
    mysql: 'MySQL / MariaDB',
    postgres: 'PostgreSQL',
    tabDatabases: 'Databases',
    tabUsers: 'Users',
    installed: 'Installed',
    running: 'Running',
    stopped: 'Stopped',
    yes: 'Yes',
    no: 'No',
    create: 'Create',
    createUser: 'Create User',
    generatePassword: 'Generate',
    username: 'username',
    password: 'password',
    targetDb: 'target database',
    hostLocalhost: 'host (localhost)',
    hostFixed: 'Host: localhost (Postgres)',
    noDatabases: 'No databases found.',
    noUsers: 'No users found.',
    confirmDeleteDb: (n: string) => `Delete database '${n}'?`,
    confirmDeleteUser: (u: string) => `Delete user '${u}'?`,
    rotatePassword: 'Rotate password',
    newPassword: 'New password',
    apply: 'Apply',
    cancel: 'Cancel',
    delete: 'Delete',
    loadFailed: 'Failed to load database manager',
    createDbFailed: 'Failed to create database',
    deleteDbFailed: 'Failed to delete database',
    downloadFailed: 'Failed to download dump',
    genPwdFailed: 'Failed to generate password',
    createUserFailed: 'Failed to create user',
    deleteUserFailed: 'Failed to delete user',
    rotateFailed: 'Failed to update password',
  },
  vi: {
    category: 'Cơ sở dữ liệu',
    title: 'Quản lý Database',
    subtitle: 'Quản lý MySQL/MariaDB và PostgreSQL.',
    mysql: 'MySQL / MariaDB',
    postgres: 'PostgreSQL',
    tabDatabases: 'Databases',
    tabUsers: 'Người dùng',
    installed: 'Đã cài',
    running: 'Đang chạy',
    stopped: 'Đã dừng',
    yes: 'Có',
    no: 'Không',
    create: 'Tạo',
    createUser: 'Tạo user',
    generatePassword: 'Tạo mật khẩu',
    username: 'tên user',
    password: 'mật khẩu',
    targetDb: 'database đích',
    hostLocalhost: 'host (localhost)',
    hostFixed: 'Host cố định: localhost',
    noDatabases: 'Không có database.',
    noUsers: 'Không có user.',
    confirmDeleteDb: (n: string) => `Xóa database '${n}'?`,
    confirmDeleteUser: (u: string) => `Xóa user '${u}'?`,
    rotatePassword: 'Đổi mật khẩu',
    newPassword: 'Mật khẩu mới',
    apply: 'Áp dụng',
    cancel: 'Hủy',
    delete: 'Xóa',
    loadFailed: 'Không tải được database manager',
    createDbFailed: 'Tạo database thất bại',
    deleteDbFailed: 'Xóa database thất bại',
    downloadFailed: 'Tải dump thất bại',
    genPwdFailed: 'Tạo mật khẩu thất bại',
    createUserFailed: 'Tạo user thất bại',
    deleteUserFailed: 'Xóa user thất bại',
    rotateFailed: 'Cập nhật mật khẩu thất bại',
  },
};

export default function DatabaseManager() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const t = COPY[language === 'vi' ? 'vi' : 'en'];

  const [engine, setEngine] = useState<EngineId>('mysql');
  const [tab, setTab] = useState<Tab>('databases');
  const [overview, setOverview] = useState<Record<EngineId, EngineOverview> | null>(null);
  const [databases, setDatabases] = useState<DbItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [dbName, setDbName] = useState('');
  const [userName, setUserName] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userHost, setUserHost] = useState('localhost');
  const [userDb, setUserDb] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloadingDb, setDownloadingDb] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; name: string; user?: UserItem } | null>(null);
  const [rotateUser, setRotateUser] = useState<UserItem | null>(null);
  const [rotatePwd, setRotatePwd] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('copanel_token') : null;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const hostEnabled = engine === 'mysql';
  const activeOverview = useMemo(() => (overview ? overview[engine] : null), [overview, engine]);

  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputCls = isDark
    ? 'bg-slate-950/40 border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  async function fetchOverview() {
    const data = await api<{ overview: Record<EngineId, EngineOverview> }>('/api/database_manager/overview');
    setOverview(data.overview);
  }

  async function fetchEngineData(target: EngineId) {
    const [dbRes, userRes] = await Promise.all([
      api<{ databases: DbItem[] }>(`/api/database_manager/engines/${target}/databases`),
      api<{ users: UserItem[] }>(`/api/database_manager/engines/${target}/users`),
    ]);
    setDatabases(dbRes.databases || []);
    setUsers(userRes.users || []);
  }

  async function refresh(target: EngineId = engine) {
    setLoading(true);
    try {
      await Promise.all([fetchOverview(), fetchEngineData(target)]);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh('mysql');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh(engine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  async function createDatabase() {
    if (!dbName.trim()) return;
    try {
      await api(`/api/database_manager/engines/${engine}/databases`, { method: 'POST', body: { name: dbName.trim() } });
      setMessage(`Database '${dbName}' created`);
      setDbName('');
      refresh(engine);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.createDbFailed);
    }
  }

  async function deleteDatabase(name: string) {
    try {
      await api(`/api/database_manager/engines/${engine}/databases/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setMessage(`Database '${name}' deleted`);
      refresh(engine);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.deleteDbFailed);
    } finally {
      setConfirm(null);
    }
  }

  async function downloadDatabaseGzip(name: string) {
    setDownloadingDb(name);
    setError(null);
    try {
      const url = `/api/database_manager/dump-gzip?name=${encodeURIComponent(name)}`;
      const response = await fetch(url, { headers: authHeaders });
      if (!response.ok) {
        let msg = await response.text();
        try {
          const j = JSON.parse(msg) as { detail?: string };
          if (j.detail) msg = j.detail;
        } catch {
          /* plain */
        }
        throw new Error(msg || 'Download failed');
      }
      const blob = await response.blob();
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${name}.sql.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(href);
      setMessage(`Downloaded ${name}.sql.gz`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.downloadFailed);
    } finally {
      setDownloadingDb(null);
    }
  }

  async function generatePassword() {
    try {
      const data = await api<{ password: string }>(`/api/database_manager/engines/${engine}/password/generate`, {
        method: 'POST',
      });
      setUserPassword(data.password || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.genPwdFailed);
    }
  }

  async function createUser() {
    if (!userName.trim() || !userPassword.trim() || !userDb.trim()) return;
    try {
      await api(`/api/database_manager/engines/${engine}/users`, {
        method: 'POST',
        body: {
          user: userName.trim(),
          password: userPassword,
          db: userDb.trim(),
          host: hostEnabled ? userHost.trim() || 'localhost' : 'localhost',
        },
      });
      setMessage(`User '${userName}' created`);
      setUserName('');
      setUserPassword('');
      setUserHost('localhost');
      refresh(engine);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.createUserFailed);
    }
  }

  async function deleteUser(u: UserItem) {
    try {
      await api(`/api/database_manager/engines/${engine}/users`, {
        method: 'DELETE',
        body: { user: u.user, host: u.host || 'localhost' },
      });
      setMessage(`User '${u.user}' deleted`);
      refresh(engine);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.deleteUserFailed);
    } finally {
      setConfirm(null);
    }
  }

  async function applyRotatePassword() {
    if (!rotateUser || !rotatePwd.trim()) return;
    try {
      await api(`/api/database_manager/engines/${engine}/users/password`, {
        method: 'POST',
        body: { user: rotateUser.user, password: rotatePwd, host: rotateUser.host || 'localhost' },
      });
      setMessage(`Password updated for '${rotateUser.user}'`);
      setRotateUser(null);
      setRotatePwd('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.rotateFailed);
    }
  }

  const engines: { id: EngineId; label: string; icon: keyof typeof Icons }[] = [
    { id: 'mysql', label: t.mysql, icon: 'Database' },
    { id: 'postgres', label: t.postgres, icon: 'HardDrive' },
  ];

  const tabs: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
    { id: 'databases', label: `${t.tabDatabases} (${databases.length})`, icon: 'FolderOpen' },
    { id: 'users', label: `${t.tabUsers} (${users.length})`, icon: 'Users' },
  ];

  const confirmMessage =
    confirm?.kind === 'deleteDb'
      ? t.confirmDeleteDb(confirm.name)
      : confirm?.kind === 'deleteUser'
        ? t.confirmDeleteUser(confirm.name)
        : '';

  return (
    <ModuleViewport constrained>
      <div className={`flex flex-col h-full min-h-0 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <header
          className={`shrink-0 px-4 py-3 border-b flex items-center justify-between gap-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{t.category}</p>
            <h1 className="text-lg font-semibold truncate">{t.title}</h1>
            <p className={`text-xs mt-0.5 line-clamp-2 ${muted}`}>{t.subtitle}</p>
          </div>
          {activeOverview && (
            <div className={`shrink-0 flex gap-2 text-[10px] font-bold ${muted}`}>
              <span className={`px-2 py-1 rounded-lg border ${panel}`}>
                {t.installed}: {activeOverview.installed ? t.yes : t.no}
              </span>
              <span className={`px-2 py-1 rounded-lg border ${panel}`}>
                {activeOverview.running ? t.running : t.stopped}
              </span>
            </div>
          )}
        </header>

        {(error || message) && (
          <div
            className={`shrink-0 mx-4 mt-2 rounded-xl border px-4 py-2 text-xs ${
              error
                ? 'border-red-300 text-red-600 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300'
                : 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300'
            }`}
          >
            {error || message}
            <button type="button" className="float-right" onClick={() => { setError(null); setMessage(null); }}>
              <Icons.X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          <aside
            className={`w-48 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}
          >
            <div className="shrink-0 p-2 border-b border-inherit space-y-0.5">
              {engines.map((eng) => {
                const Icon = Icons[eng.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() => setEngine(eng.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg ${
                      engine === eng.id
                        ? isDark
                          ? 'bg-blue-600/25 text-blue-300'
                          : 'bg-blue-50 text-blue-700'
                        : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate text-left">{eng.label}</span>
                  </button>
                );
              })}
            </div>
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {tabs.map((item) => {
                const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                      tab === item.id
                        ? isDark
                          ? 'bg-blue-600/25 text-blue-300 font-semibold'
                          : 'bg-blue-50 text-blue-700 font-semibold'
                        : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="flex-1 min-h-0 overflow-y-auto p-4">
            {tab === 'databases' && (
              <section className={`rounded-2xl border p-4 space-y-3 ${panel}`}>
                <div className="flex gap-2">
                  <input
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    placeholder="new_database"
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                  />
                  <button
                    type="button"
                    onClick={createDatabase}
                    className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 text-sm font-bold"
                  >
                    {t.create}
                  </button>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {databases.map((d) => (
                    <li key={d.name} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm truncate">{d.name}</p>
                        <p className={`text-[11px] ${muted}`}>{d.size || 'N/A'}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {engine === 'mysql' && (
                          <button
                            type="button"
                            onClick={() => downloadDatabaseGzip(d.name)}
                            disabled={!!downloadingDb}
                            className="text-slate-400 hover:text-blue-500 disabled:opacity-40"
                          >
                            <Icons.Download className={`w-4 h-4 ${downloadingDb === d.name ? 'animate-pulse' : ''}`} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirm({ kind: 'deleteDb', name: d.name })}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {!loading && databases.length === 0 && <li className={`py-4 text-xs text-center ${muted}`}>{t.noDatabases}</li>}
                </ul>
              </section>
            )}

            {tab === 'users' && (
              <section className={`rounded-2xl border p-4 space-y-3 ${panel}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder={t.username}
                    className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                  />
                  <input
                    value={userDb}
                    onChange={(e) => setUserDb(e.target.value)}
                    placeholder={t.targetDb}
                    className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                  />
                  <input
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder={t.password}
                    className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                  />
                  {hostEnabled ? (
                    <input
                      value={userHost}
                      onChange={(e) => setUserHost(e.target.value)}
                      placeholder={t.hostLocalhost}
                      className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                    />
                  ) : (
                    <div className={`rounded-xl border px-3 py-2 text-xs flex items-center ${muted} ${inputCls}`}>{t.hostFixed}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={generatePassword} className={`rounded-xl border px-3 py-2 text-xs font-bold ${btnSecondary}`}>
                    {t.generatePassword}
                  </button>
                  <button
                    type="button"
                    onClick={createUser}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 text-sm font-bold"
                  >
                    {t.createUser}
                  </button>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => (
                    <li key={`${u.user}:${u.host || 'localhost'}`} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm truncate">{u.user}</p>
                        <p className={`text-[11px] ${muted}`}>
                          {u.host || 'localhost'}
                          {u.db ? ` • ${u.db}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => { setRotateUser(u); setRotatePwd(''); }} className="text-slate-400 hover:text-blue-500">
                          <Icons.KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirm({ kind: 'deleteUser', name: u.user, user: u })}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <Icons.Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {!loading && users.length === 0 && <li className={`py-4 text-xs text-center ${muted}`}>{t.noUsers}</li>}
                </ul>
              </section>
            )}
          </main>
        </div>
      </div>

      <WindowModal open={confirm !== null} onClose={() => setConfirm(null)} title={t.delete} maxWidth="sm">
        <p className={`text-sm mb-4 ${muted}`}>{confirmMessage}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm) return;
              if (confirm.kind === 'deleteDb') deleteDatabase(confirm.name);
              else if (confirm.user) deleteUser(confirm.user);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white"
          >
            {t.delete}
          </button>
        </div>
      </WindowModal>

      <WindowModal open={rotateUser !== null} onClose={() => setRotateUser(null)} title={t.rotatePassword} maxWidth="sm">
        {rotateUser && (
          <>
            <p className={`text-sm mb-2 ${muted}`}>
              <span className="font-mono font-bold">{rotateUser.user}</span>
            </p>
            <input
              value={rotatePwd}
              onChange={(e) => setRotatePwd(e.target.value)}
              placeholder={t.newPassword}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-mono mb-4 ${inputCls}`}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRotateUser(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
                {t.cancel}
              </button>
              <button type="button" onClick={applyRotatePassword} className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white">
                {t.apply}
              </button>
            </div>
          </>
        )}
      </WindowModal>
    </ModuleViewport>
  );
}
