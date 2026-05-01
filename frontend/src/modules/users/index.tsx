/**
 * Premium Users and Permissions Management Dashboard
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';

interface UserProfile {
  id: number;
  username: string;
  role: 'superadmin' | 'user';
  permitted_modules: string | string[];
  permitted_folders: string | string[];
}

export default function UsersDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New User Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'superadmin' | 'user'>('user');
  const [moduleInput, setModuleInput] = useState<string>('system_monitor, file_manager');
  const [folderInput, setFolderInput] = useState<string>('/home/');

  const token = localStorage.getItem('copanel_token');

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

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please fill in username and password.');
      return;
    }

    setError(null);

    // Convert comma strings to lists
    const pModules = moduleInput.split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
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
          permitted_modules: pModules,
          permitted_folders: pFolders
        })
      });

      if (res.ok) {
        setUsername('');
        setPassword('');
        setModuleInput('system_monitor, file_manager');
        setFolderInput('/home/');
        fetchUsers();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to register new user profile.');
      }
    } catch {
      setError('Failed to reach authentication backend.');
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Dynamic Ambient Background Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-200 to-white bg-clip-text text-transparent">
            User Accounts & Roles
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            As a SuperAdmin, you can create, modify, or remove user accounts.
            Isolate their accessible files via specific home directory paths (e.g., /home/user1/)
            and specify accessible dynamic modules.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Active Accounts</span>
          <span className="text-2xl font-mono font-bold text-slate-100">
            {users.length}
          </span>
          <span className="text-xs text-slate-400">Total Records</span>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2 max-w-xl">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Actionable User Creation Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form onSubmit={handleCreateUser} className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit">
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Icons.UserPlus className="w-5 h-5 text-indigo-400" />
            Create Account
          </h3>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user1"
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              >
                <option value="user">User</option>
                <option value="superadmin">SuperAdmin</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Permitted Modules</label>
              <input
                type="text"
                value={moduleInput}
                onChange={(e) => setModuleInput(e.target.value)}
                placeholder="system_monitor, file_manager"
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
              <span className="text-[10px] text-slate-500 block leading-tight">Enter module IDs separated by commas. Use 'all' for full access.</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-widest">Isolated Directories</label>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="/home/"
                className="w-full bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-all"
              />
              <span className="text-[10px] text-slate-500 block leading-tight">Accessible folder path. Set to '/' for full system access.</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-xs text-white shadow-lg hover:shadow-indigo-500/20 transition-all duration-200"
          >
            <Icons.UserPlus className="w-3.5 h-3.5" />
            Add User Profile
          </button>
        </form>

        {/* Existing Users Table Grid View */}
        <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 h-fit">
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Icons.Users className="w-5 h-5 text-indigo-400" />
            Registered Accounts ({users.length})
          </h3>

          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 bg-slate-950/40 border border-slate-800/50 rounded-xl">
              <Icons.Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs text-slate-400 mt-2">Loading user accounts...</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800/60">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800/60 text-xs font-bold text-slate-300 uppercase tracking-widest select-none">
                    <th className="p-4">Username</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Permissions</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody className="text-xs text-slate-200 divide-y divide-slate-800/40">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/30 transition-all">
                      <td className="p-4 font-mono font-bold text-indigo-300">
                        {u.username}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded border ${
                          u.role === 'superadmin'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-4 space-y-1.5 min-w-[200px]">
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-slate-500 block">Modules:</span>
                          <span className="text-[11px] font-mono text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                            {parseJsonList(u.permitted_modules).join(', ') || 'None'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-slate-500 block">Restricted Home:</span>
                          <span className="text-[11px] font-mono text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                            {parseJsonList(u.permitted_folders).join(', ') || '/'}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={u.username === 'admin'}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/40 disabled:opacity-50 border border-red-900/40 rounded-xl transition-all"
                        >
                          <Icons.Trash2 className="w-3.5 h-3.5" />
                          Delete
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
