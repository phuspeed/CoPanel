/**
 * Premium Dashboard page with dynamic module overview and server summary
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { moduleRegistry } from './registry';
import * as Icons from 'lucide-react';

export default function Dashboard() {
  const modules = moduleRegistry.getAll();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Welcome Header with Glassmorphism Effect */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent">
            Welcome to CoPanel
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Your high-performance Linux VPS Management System. Gain complete control over your server,
            processes, files, and more with CoPanel's pluggable architecture.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">Server Time</span>
          <span className="text-2xl font-mono font-bold text-slate-100">
            {currentTime.toLocaleTimeString()}
          </span>
          <span className="text-xs text-slate-400">
            {currentTime.toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Module Quick Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
            <Icons.Grid className="w-5 h-5 text-blue-400" />
            Active Modules ({modules.length})
          </h3>
          <span className="text-xs text-slate-400 bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700">
            Fully dynamic & pluggable
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => (
            <Link
              key={module.path}
              to={module.path}
              className="group relative flex flex-col justify-between bg-slate-900/60 border border-slate-800 hover:border-blue-500/40 p-6 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-1 backdrop-blur-sm"
              title={module.description}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-500 text-blue-400 transition-all duration-300">
                    <Icons.Grid className="w-6 h-6" />
                  </div>
                  <Icons.ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-300" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-200 group-hover:text-white transition-colors duration-300">
                    {module.name}
                  </h4>
                  <p className="text-slate-400 text-xs mt-1.5 line-clamp-2 leading-normal">
                    {module.description}
                  </p>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1 font-mono uppercase tracking-wider text-slate-400/80">
                  <Icons.Layout className="w-3.5 h-3.5" />
                  {module.path}
                </span>
                <span className="group-hover:text-blue-400 transition-colors duration-300">
                  Manage module
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Useful Commands & System Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 border border-slate-800/80 p-6 rounded-2xl space-y-4">
          <h4 className="text-slate-200 font-bold text-base flex items-center gap-2">
            <Icons.Terminal className="w-5 h-5 text-blue-400" />
            Quick Service Management
          </h4>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/50">
              <span className="text-xs text-slate-400">Restart Panel</span>
              <code className="text-xs font-mono text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-900/40">
                systemctl restart copanel
              </code>
            </div>
            <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/50">
              <span className="text-xs text-slate-400">View Server Logs</span>
              <code className="text-xs font-mono text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-900/40">
                journalctl -u copanel -f
              </code>
            </div>
            <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/50">
              <span className="text-xs text-slate-400">Check Nginx Status</span>
              <code className="text-xs font-mono text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-900/40">
                systemctl status nginx
              </code>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800/80 p-6 rounded-2xl space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="text-slate-200 font-bold text-base flex items-center gap-2">
              <Icons.ShieldCheck className="w-5 h-5 text-blue-400" />
              Developer & Architecture
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              CoPanel is explicitly designed to be extensible. To add your own customized backend 
              functionality, simply drop a Python file into the modules folder of the backend. 
              The systemd service will automatically pick it up and secure permissions recursively.
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/80 pt-4 mt-2">
            <span className="text-xs text-slate-500">Architecture version 1.0.0</span>
            <span className="text-xs font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full flex items-center gap-1">
              <Icons.Sparkles className="w-3.5 h-3.5" />
              Premium design
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
