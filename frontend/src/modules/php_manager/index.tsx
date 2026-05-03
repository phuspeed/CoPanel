/**
 * PHP Manager Dashboard Component
 * Manage and install PHP versions, edit php.ini configuration files, and view modules.
 * Fully supports mobile responsive view and stunning dark/light theme.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

export default function PHPManagerDashboard() {
  const [versions, setVersions] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [phpIniContent, setPhpIniContent] = useState<string>('');
  const [editingIni, setEditingIni] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const t = {
    en: {
      title: 'PHP Version Manager',
      desc: 'Deploy, control, and update PHP versions for your application environment. Direct access to configuration and modules included.',
      status: 'PHP Service Status',
      ready: 'Service Ready',
      loading: 'Fetching versions and modules...',
      versionsTitle: 'Available PHP Versions',
      modulesTitle: 'Available standard PHP Modules',
      colVersion: 'Version',
      colStatus: 'Status',
      colAction: 'Actions',
      noVersions: 'No PHP versions available.',
      noModules: 'No standard modules found.',
      install: 'Install',
      editIni: 'Edit php.ini',
      iniModalTitle: 'Configure php.ini',
      savingIni: 'Saving...',
      saveBtn: 'Save & Apply',
      cancel: 'Cancel',
      successInstall: 'PHP version successfully installed.',
      successSave: 'php.ini configuration updated successfully.'
    },
    vi: {
      title: 'Quản lý Phiên bản PHP',
      desc: 'Triển khai, kiểm soát và cập nhật các phiên bản PHP cho môi trường ứng dụng của bạn. Chỉnh sửa tệp cấu hình và theo dõi module có sẵn.',
      status: 'Trạng thái PHP',
      ready: 'Sẵn sàng',
      loading: 'Đang tải thông tin...',
      versionsTitle: 'Danh sách Phiên bản PHP',
      modulesTitle: 'Danh sách Module PHP Tiêu chuẩn',
      colVersion: 'Phiên bản',
      colStatus: 'Trạng thái',
      colAction: 'Thao tác',
      noVersions: 'Không tìm thấy phiên bản PHP nào.',
      noModules: 'Không tìm thấy module tiêu chuẩn nào.',
      install: 'Cài đặt',
      editIni: 'Cấu hình php.ini',
      iniModalTitle: 'Chỉnh sửa tệp php.ini',
      savingIni: 'Đang lưu...',
      saveBtn: 'Lưu & Khởi động lại',
      cancel: 'Hủy',
      successInstall: 'Cài đặt phiên bản PHP thành công.',
      successSave: 'Cấu hình tệp php.ini thành công.'
    }
  };

  const tr = t[language || 'en'];

  const fetchVersionsAndModules = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const [resVersions, resModules] = await Promise.all([
        fetch('/api/php_manager/versions', { headers }),
        fetch('/api/php_manager/modules', { headers })
      ]);
      
      if (resVersions.ok) {
        const dataVersions = await resVersions.json();
        if (dataVersions.versions) {
          setVersions(dataVersions.versions);
        }
      }

      if (resModules.ok) {
        const dataModules = await resModules.json();
        if (dataModules.modules) {
          setModules(dataModules.modules);
        }
      }
    } catch (err) {
      console.error('Error fetching PHP details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersionsAndModules();
  }, []);

  const handleInstall = async (version: string) => {
    setInstalling(version);
    setMsg(null);
    try {
      const res = await fetch('/api/php_manager/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ version })
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: data.message || tr.successInstall, isError: false });
        fetchVersionsAndModules();
      } else {
        setMsg({ text: data.detail || 'Could not install PHP version.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    } finally {
      setInstalling(null);
    }
  };

  const handleEditIni = async (version: string) => {
    setMsg(null);
    setSelectedVersion(version);
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/php_manager/php_ini/${version}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setPhpIniContent(data.content || '');
        setEditingIni(true);
      } else {
        const data = await res.json();
        setMsg({ text: data.detail || 'Could not load php.ini content.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveIni = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/php_manager/php_ini/${selectedVersion}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: phpIniContent })
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: data.message || tr.successSave, isError: false });
        setEditingIni(false);
      } else {
        setMsg({ text: data.detail || 'Could not save php.ini file.', isError: true });
      }
    } catch {
      setMsg({ text: 'Error communicating with backend.', isError: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none">
      {/* Premium Ambient Banner */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center md:justify-start gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-sky-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-sky-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Cpu className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex flex-col items-center md:items-end gap-3 self-stretch md:self-auto">
          <div className={`flex flex-col items-center md:items-end gap-1 text-center md:text-right px-4 py-3 rounded-xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] ${
            isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white/80 border-slate-200 shadow-sm'
          }`}>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{tr.status}</span>
            <span className={`text-lg md:text-xl font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{tr.ready}</span>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`p-3.5 border rounded-xl text-xs flex items-center gap-2 animate-fade-in ${
          msg.isError
            ? (isDark ? 'bg-red-950/20 border-red-600/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600')
            : (isDark ? 'bg-blue-950/20 border-blue-600/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-600')
        }`}>
          {msg.isError ? <Icons.AlertCircle className="w-4 h-4 shrink-0" /> : <Icons.Info className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Main Feature Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* PHP Versions Listing */}
        <div className={`col-span-1 lg:col-span-2 border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <Icons.Layers className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.versionsTitle}
          </h3>

          {loading && versions.length === 0 ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
              <Icons.Loader className="w-4 h-4 animate-spin text-blue-500" />
              <p>{tr.loading}</p>
            </div>
          ) : versions.length > 0 ? (
            <div className={`overflow-x-auto border rounded-xl ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className={`border-b text-xs font-bold uppercase tracking-widest ${
                    isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50/80 border-slate-100 text-slate-600'
                  }`}>
                    <th className="p-4">{tr.colVersion}</th>
                    <th className="p-4">{tr.colStatus}</th>
                    <th className="p-4 text-center">{tr.colAction}</th>
                  </tr>
                </thead>
                <tbody className={`text-xs divide-y font-mono ${
                  isDark ? 'text-slate-200 divide-slate-800/40' : 'text-slate-700 divide-slate-100'
                }`}>
                  {versions.map((version, idx) => (
                    <tr key={idx} className={`transition-all ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/60'}`}>
                      <td className={`p-4 font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                        PHP {version}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded border text-[10px] uppercase font-bold transition-all ${
                          isDark ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-green-50 text-green-600 border-green-200'
                        }`}>
                          Available
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleInstall(version)}
                            disabled={installing === version}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition border flex items-center justify-center gap-1.5 ${
                              isDark ? 'bg-blue-950/40 border-blue-900/40 hover:bg-blue-900/40 text-blue-400' : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600'
                            }`}
                          >
                            {installing === version ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Zap className="w-3.5 h-3.5" />}
                            {installing === version ? 'Installing' : tr.install}
                          </button>
                          <button
                            onClick={() => handleEditIni(version)}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition border flex items-center justify-center gap-1.5 ${
                              isDark ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                            }`}
                          >
                            <Icons.Sliders className="w-3.5 h-3.5" />
                            {tr.editIni}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noVersions}
            </div>
          )}
        </div>

        {/* Standard Modules Section */}
        <div className={`col-span-1 border p-5 md:p-8 rounded-2xl backdrop-blur-sm space-y-5 transition-all duration-300 shadow-sm ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200'
        }`}>
          <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <Icons.Box className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /> {tr.modulesTitle}
          </h3>

          {modules.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {modules.map((mod, idx) => (
                <div key={idx} className={`p-3 rounded-xl border flex items-center gap-2 justify-between transition duration-200 font-mono text-xs ${
                  isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-700'
                }`}>
                  <span className="font-bold truncate select-all">{mod}</span>
                  <Icons.CheckCircle2 className={`w-4 h-4 shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className={`text-xs border p-4 rounded-xl text-center md:text-left ${
              isDark ? 'text-slate-400 border-slate-800/40 bg-slate-950/20' : 'text-slate-500 border-slate-100 bg-slate-50/50'
            }`}>
              {tr.noModules}
            </div>
          )}
        </div>
      </div>

      {/* php.ini Content Editing Modal */}
      {editingIni && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <form onSubmit={handleSaveIni} className={`p-6 rounded-2xl w-full max-w-2xl shadow-2xl border space-y-4 flex flex-col justify-between max-h-[90vh] ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.Sliders className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                {tr.iniModalTitle} (PHP {selectedVersion})
              </h3>
              <button
                type="button"
                onClick={() => setEditingIni(false)}
                className="text-slate-500 hover:text-red-400 transition"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-auto py-2">
              <textarea
                value={phpIniContent}
                onChange={(e) => setPhpIniContent(e.target.value)}
                rows={14}
                className={`w-full border rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition-all font-mono text-xs select-all resize-none ${
                  isDark ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-800'
                }`}
              />
            </div>

            <div className="flex items-center justify-end gap-3 mt-4 border-t pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingIni(false)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tr.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-md flex items-center gap-1.5"
              >
                {saving ? <Icons.Loader className="w-3.5 h-3.5 animate-spin" /> : <Icons.Save className="w-3.5 h-3.5" />}
                {saving ? tr.savingIni : tr.saveBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
