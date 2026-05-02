/**
 * Terminal Module - Frontend
 * Advanced web terminal client using xterm.js and WebSocket.
 */
import { useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalDashboard() {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const context = useOutletContext<{
    theme: 'dark' | 'light';
    language: 'en' | 'vi';
  }>();

  const isDark = context?.theme === 'dark';
  const language = context?.language || 'en';

  const t = {
    en: {
      title: 'CoPanel Web Terminal',
      desc: 'Execute command lines directly on your Linux VPS. Fully interactive, low-latency, and highly secure terminal session via WebSocket.',
      connected: 'Connected to CoPanel VPS terminal via WebSocket.',
      error: 'WebSocket error occurred.',
      closed: 'Connection closed.'
    },
    vi: {
      title: 'Dòng lệnh Web Terminal',
      desc: 'Thực thi các lệnh trực tiếp trên máy chủ Linux VPS của bạn qua kết nối WebSocket an toàn, độ trễ cực thấp.',
      connected: 'Đã kết nối thành công tới Terminal của CoPanel qua WebSocket.',
      error: 'Có lỗi xảy ra với kết nối WebSocket.',
      closed: 'Đã đóng kết nối.'
    }
  };

  const tr = t[language || 'en'];

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", Courier, monospace',
      theme: {
        background: isDark ? '#0f172a' : '#1e293b',
        foreground: '#f8fafc',
        cursor: '#3b82f6',
        selectionBackground: 'rgba(59, 130, 246, 0.3)',
      },
      convertEol: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    const wsUrl = `${proto}//${host}${port}/api/terminal/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      term.writeln(`\x1b[1;32m${tr.connected}\x1b[0m\r\n`);
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln(`\x1b[1;31m${tr.error}\x1b[0m`);
    };

    ws.onclose = () => {
      term.writeln(`\x1b[1;31m\r\n${tr.closed}\x1b[0m`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      ws.close();
      term.dispose();
      window.removeEventListener('resize', handleResize);
    };
  }, [language, isDark]);

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 border transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div>
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Terminal className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h1>
          <p className={`${isDark ? 'text-slate-400' : 'text-slate-600'} text-xs md:text-sm mt-2 max-w-xl leading-relaxed`}>
            {tr.desc}
          </p>
        </div>
      </div>

      <div className={`p-4 rounded-2xl backdrop-blur-md shadow-xl border transition-all duration-300 h-[600px] flex flex-col ${
        isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center gap-2 px-2 py-1 mb-3 border-b border-slate-800/20 text-xs font-mono select-none">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          <span className={`ml-2 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>root@vps:bash</span>
        </div>
        <div ref={terminalRef} className="flex-1 overflow-hidden" />
      </div>
    </div>
  );
}
