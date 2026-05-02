/**
 * Premium Dashboard page with dynamic module overview and server summary
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { moduleRegistry } from './registry';
import * as Icons from 'lucide-react';

export default function Dashboard() {
  const modules = moduleRegistry.getAll();
  const [currentTime, setCurrentTime] = useState(new Date());
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const t = {
    en: {
      welcome: 'Welcome to CoPanel',
      desc: 'Your high-performance Linux VPS Management System. Gain complete control over your server, processes, files, and more with CoPanel\'s pluggable architecture.',
      serverTime: 'Server Time',
      activeModules: 'Active Modules',
      manage: 'Manage module',
      quickService: 'Quick Service Management',
      devArch: 'Developer & Architecture',
      archDesc: 'CoPanel is explicitly designed to be extensible. To add your own customized backend functionality, simply drop a Python file into the modules folder of the backend. The systemd service will automatically pick it up and secure permissions recursively.',
      archVer: 'Architecture version 1.0.0',
      premiumDesign: 'Premium design',
      modulesNames: {
        'appstore_manager': 'App Store',
        'app_store': 'App Store',
        'backup_manager': 'Backup',
        'docker_manager': 'Docker',
        'file_manager': 'Files',
        'firewall': 'Firewall',
        'package_manager': 'Packages',
        'ssl_manager': 'SSL',
        'system_monitor': 'Monitor',
        'terminal': 'Terminal',
        'users': 'Users',
        'web_manager': 'Web'
      }
    },
    vi: {
      welcome: 'Chào mừng bạn đến với CoPanel',
      desc: 'Hệ thống quản lý Linux VPS hiệu năng cao của bạn. Kiểm soát hoàn toàn máy chủ, tiến trình, tệp tin và nhiều hơn nữa với kiến trúc cắm (pluggable) của CoPanel.',
      serverTime: 'Giờ hệ thống',
      activeModules: 'Các Module đang hoạt động',
      manage: 'Quản lý module',
      quickService: 'Quản lý dịch vụ nhanh',
      devArch: 'Nhà phát triển & Kiến trúc',
      archDesc: 'CoPanel được thiết kế đặc biệt để có thể mở rộng. Để thêm chức năng backend tùy chỉnh của riêng bạn, chỉ cần thêm một tệp Python vào thư mục modules của backend. Dịch vụ systemd sẽ tự động áp dụng và phân quyền đệ quy.',
      archVer: 'Phiên bản kiến trúc 1.0.0',
      premiumDesign: 'Thiết kế cao cấp',
      modulesNames: {
        'appstore_manager': 'Kho ứng dụng',
        'app_store': 'Kho ứng dụng',
        'backup_manager': 'Sao lưu',
        'docker_manager': 'Docker',
        'file_manager': 'Quản lý file',
        'firewall': 'Tường lửa',
        'package_manager': 'Cài đặt gói',
        'ssl_manager': 'Quản lý SSL',
        'system_monitor': 'Theo dõi hệ thống',
        'terminal': 'Dòng lệnh',
        'users': 'Người dùng',
        'web_manager': 'Quản lý Web'
      }
    }
  };

  const tr = t[language || 'en'];

  const getModuleName = (mod: any) => {
    const key = mod.name.toLowerCase().replace(/\s+/g, '_');
    return (tr as any).modulesNames?.[key] || mod.name;
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Welcome Header with Glassmorphism Effect */}
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200 shadow-slate-100'
      }`}>
        <div className="space-y-3 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            {tr.welcome}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className={`flex flex-col items-center md:items-end gap-1 text-right p-4 rounded-2xl border backdrop-blur-sm self-stretch md:self-auto min-w-[180px] ${
          isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-slate-50/60 border-slate-200/80 shadow-sm'
        }`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{tr.serverTime}</span>
          <span className={`text-xl md:text-2xl font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            {currentTime.toLocaleTimeString()}
          </span>
          <span className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {currentTime.toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Module Quick Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`text-base md:text-lg font-bold flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.Grid className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.activeModules} ({modules.length})
          </h3>
          <span className={`text-xs px-3 py-1 rounded-full border ${isDark ? 'text-slate-400 bg-slate-800/80 border-slate-700' : 'text-slate-600 bg-slate-100 border-slate-200'}`}>
            Fully dynamic & pluggable
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {modules.map((module) => (
            <Link
              key={module.path}
              to={module.path}
              className={`group relative flex flex-col justify-between p-5 md:p-6 rounded-2xl transition-all duration-300 hover:shadow-lg hover:-translate-y-1 backdrop-blur-sm border ${
                isDark ? 'bg-slate-900/60 border-slate-800 hover:border-blue-500/40 hover:shadow-blue-500/5' : 'bg-white border-slate-200 hover:border-blue-400/40 hover:shadow-blue-400/5'
              }`}
              title={module.description}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className={`p-3 border rounded-xl group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-500 transition-all duration-300 ${
                    isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-200/60 text-blue-600'
                  }`}>
                    <Icons.Grid className="w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <Icons.ArrowRight className={`w-4 h-4 transition-all duration-300 group-hover:translate-x-1 ${
                    isDark ? 'text-slate-600 group-hover:text-blue-400' : 'text-slate-400 group-hover:text-blue-600'
                  }`} />
                </div>
                <div>
                  <h4 className={`text-base md:text-lg font-bold group-hover:text-blue-500 transition-colors duration-300 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {getModuleName(module)}
                  </h4>
                  <p className={`text-xs mt-1 line-clamp-2 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {module.description}
                  </p>
                </div>
              </div>
              <div className={`mt-5 pt-3 border-t flex items-center justify-between text-[11px] ${isDark ? 'border-slate-800/80 text-slate-500' : 'border-slate-100 text-slate-400'}`}>
                <span className={`flex items-center gap-1 font-mono uppercase tracking-wider ${isDark ? 'text-slate-400/80' : 'text-slate-500'}`}>
                  <Icons.Layout className="w-3.5 h-3.5" />
                  {module.path}
                </span>
                <span className="group-hover:text-blue-500 font-bold transition-colors duration-300">
                  {tr.manage}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Useful Commands & System Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`border p-6 rounded-2xl space-y-4 ${isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
          <h4 className={`font-bold text-sm md:text-base flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            <Icons.Terminal className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.quickService}
          </h4>
          <div className="space-y-2.5">
            <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800/50' : 'bg-slate-50 border-slate-100'}`}>
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Restart Panel</span>
              <code className={`text-[11px] font-mono px-2 py-0.5 rounded border ${isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-600 bg-blue-50 border-blue-100'}`}>
                systemctl restart copanel
              </code>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800/50' : 'bg-slate-50 border-slate-100'}`}>
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>View Server Logs</span>
              <code className={`text-[11px] font-mono px-2 py-0.5 rounded border ${isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-600 bg-blue-50 border-blue-100'}`}>
                journalctl -u copanel -f
              </code>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800/50' : 'bg-slate-50 border-slate-100'}`}>
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Check Nginx Status</span>
              <code className={`text-[11px] font-mono px-2 py-0.5 rounded border ${isDark ? 'text-blue-400 bg-blue-950/40 border-blue-900/40' : 'text-blue-600 bg-blue-50 border-blue-100'}`}>
                systemctl status nginx
              </code>
            </div>
          </div>
        </div>

        <div className={`border p-6 rounded-2xl space-y-4 flex flex-col justify-between ${isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className="space-y-3">
            <h4 className={`font-bold text-sm md:text-base flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              <Icons.ShieldCheck className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              {tr.devArch}
            </h4>
            <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {tr.archDesc}
            </p>
          </div>
          <div className={`flex items-center justify-between border-t pt-4 mt-4 ${isDark ? 'border-slate-800/80 text-slate-500' : 'border-slate-100 text-slate-400'}`}>
            <span className="text-xs">{tr.archVer}</span>
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1 border ${
              isDark ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' : 'text-blue-600 bg-blue-50 border-blue-200/60'
            }`}>
              <Icons.Sparkles className="w-3.5 h-3.5" />
              {tr.premiumDesign}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
