import { useEffect, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

type EngineId = 'mysql' | 'postgres';

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

export default function DatabaseManager() {
  const [engine, setEngine] = useState<EngineId>('mysql');
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

  const hostEnabled = engine === 'mysql';

  const activeOverview = useMemo(() => (overview ? overview[engine] : null), [overview, engine]);

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
    } catch (err: any) {
      setError(err?.message || 'Failed to load database manager');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh('mysql');
  }, []);

  useEffect(() => {
    refresh(engine);
  }, [engine]);

  async function createDatabase() {
    if (!dbName.trim()) return;
    try {
      await api(`/api/database_manager/engines/${engine}/databases`, { method: 'POST', body: { name: dbName.trim() } });
      setMessage(`Database '${dbName}' created`);
      setDbName('');
      refresh(engine);
    } catch (err: any) {
      setError(err?.message || 'Failed to create database');
    }
  }

  async function deleteDatabase(name: string) {
    if (!confirm(`Delete database '${name}'?`)) return;
    try {
      await api(`/api/database_manager/engines/${engine}/databases/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setMessage(`Database '${name}' deleted`);
      refresh(engine);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete database');
    }
  }

  async function generatePassword() {
    try {
      const data = await api<{ password: string }>(`/api/database_manager/engines/${engine}/password/generate`, { method: 'POST' });
      setUserPassword(data.password || '');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate password');
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
    } catch (err: any) {
      setError(err?.message || 'Failed to create user');
    }
  }

  async function deleteUser(u: UserItem) {
    if (!confirm(`Delete user '${u.user}'?`)) return;
    try {
      await api(`/api/database_manager/engines/${engine}/users`, {
        method: 'DELETE',
        body: { user: u.user, host: u.host || 'localhost' },
      });
      setMessage(`User '${u.user}' deleted`);
      refresh(engine);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete user');
    }
  }

  async function rotatePassword(u: UserItem) {
    const pwd = prompt(`Set new password for ${u.user}`, userPassword || '');
    if (!pwd) return;
    try {
      await api(`/api/database_manager/engines/${engine}/users/password`, {
        method: 'POST',
        body: { user: u.user, password: pwd, host: u.host || 'localhost' },
      });
      setMessage(`Password updated for '${u.user}'`);
    } catch (err: any) {
      setError(err?.message || 'Failed to update password');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">Databases</p>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100">Database Manager</h1>
        <p className="text-xs text-slate-500 max-w-3xl">
          Multi-engine panel to manage MySQL and PostgreSQL databases/users with fast provisioning and password rotation.
        </p>
      </header>

      {error && <div className="text-sm rounded-xl border border-red-300 text-red-600 px-3 py-2 bg-red-50">{error}</div>}
      {message && <div className="text-sm rounded-xl border border-emerald-300 text-emerald-700 px-3 py-2 bg-emerald-50">{message}</div>}

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4">
        <div className="grid grid-cols-2 gap-2 md:w-[360px]">
          {(['mysql', 'postgres'] as EngineId[]).map((id) => (
            <button
              key={id}
              onClick={() => setEngine(id)}
              className={`rounded-xl px-3 py-2 text-sm font-bold border ${
                engine === id
                  ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              {id === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'}
            </button>
          ))}
        </div>

        {activeOverview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Stat title="Installed" value={activeOverview.installed ? 'Yes' : 'No'} />
            <Stat title="Running" value={activeOverview.running ? 'Active' : 'Stopped'} />
            <Stat title="Databases" value={String(activeOverview.database_count)} />
            <Stat title="Users" value={String(activeOverview.user_count)} />
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-sm font-bold">Databases</h2>
          <div className="flex gap-2">
            <input
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="new database name"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950/40"
            />
            <button onClick={createDatabase} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm font-bold">
              Create
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {databases.map((d) => (
              <li key={d.name} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm truncate">{d.name}</p>
                  <p className="text-[11px] text-slate-500">{d.size || 'N/A'}</p>
                </div>
                <button onClick={() => deleteDatabase(d.name)} className="text-slate-400 hover:text-red-500">
                  <Icons.Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
            {!loading && databases.length === 0 && <li className="py-2 text-xs text-slate-500">No databases found.</li>}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-sm font-bold">Users</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="username"
              className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950/40"
            />
            <input
              value={userDb}
              onChange={(e) => setUserDb(e.target.value)}
              placeholder="target database"
              className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950/40"
            />
            <input
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              placeholder="password"
              className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950/40"
            />
            {hostEnabled ? (
              <input
                value={userHost}
                onChange={(e) => setUserHost(e.target.value)}
                placeholder="host (localhost)"
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950/40"
              />
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500 flex items-center">
                Host fixed: localhost (Postgres)
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={generatePassword} className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-bold">
              Generate Password
            </button>
            <button onClick={createUser} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm font-bold">
              Create User
            </button>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <li key={`${u.user}:${u.host || 'localhost'}`} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm truncate">{u.user}</p>
                  <p className="text-[11px] text-slate-500">
                    Host: {u.host || 'localhost'} {u.db ? `• DB: ${u.db}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => rotatePassword(u)} className="text-slate-400 hover:text-blue-500" title="Rotate password">
                    <Icons.KeyRound className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteUser(u)} className="text-slate-400 hover:text-red-500" title="Delete user">
                    <Icons.Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
            {!loading && users.length === 0 && <li className="py-2 text-xs text-slate-500">No users found.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{title}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
