/**
 * Terminal Module - Frontend
 * Web terminal (xterm.js + WebSocket) and saved command snippets (REST + JSON).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type BuiltinSnippet = {
  id: string;
  command: string;
  title_en: string;
  title_vi: string;
};

type CustomSnippet = {
  id: string;
  title: string;
  command: string;
};

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('copanel_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function TerminalDashboard() {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const context = useOutletContext<{
    theme: 'dark' | 'light';
    language: 'en' | 'vi';
  }>();

  const isDark = context?.theme === 'dark';
  const language = context?.language || 'en';

  const [wsConnected, setWsConnected] = useState(false);
  const [builtinSnippets, setBuiltinSnippets] = useState<BuiltinSnippet[]>([]);
  const [customSnippets, setCustomSnippets] = useState<CustomSnippet[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(true);
  const [snippetsError, setSnippetsError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCommand, setDraftCommand] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);

  const t = {
    en: {
      title: 'CoPanel Web Terminal',
      desc: 'Execute command lines directly on your Linux VPS. Fully interactive, low-latency, and highly secure terminal session via WebSocket.',
      connected: 'Connected to CoPanel VPS terminal via WebSocket.',
      error: 'WebSocket error occurred.',
      closed: 'Connection closed.',
      snippets: 'Snippets',
      snippetsHint: 'Built-in CoPanel commands and your saved shortcuts (stored as JSON on the server).',
      copanelBuiltin: 'CoPanel (built-in)',
      mySnippets: 'My snippets',
      run: 'Run',
      insert: 'Insert',
      titleLabel: 'Title',
      commandLabel: 'Command',
      addSnippet: 'Add snippet',
      saveSnippets: 'Save',
      saving: 'Saving…',
      savedOk: 'Saved.',
      remove: 'Remove',
      loadError: 'Could not load snippets.',
      saveError: 'Could not save snippets.',
      notConnected: 'Connect the terminal first.',
      togglePanel: 'Snippets',
      collapse: 'Hide',
      expand: 'Show',
    },
    vi: {
      title: 'Dòng lệnh Web Terminal',
      desc: 'Thực thi các lệnh trực tiếp trên máy chủ Linux VPS của bạn qua kết nối WebSocket an toàn, độ trễ cực thấp.',
      connected: 'Đã kết nối thành công tới Terminal của CoPanel qua WebSocket.',
      error: 'Có lỗi xảy ra với kết nối WebSocket.',
      closed: 'Đã đóng kết nối.',
      snippets: 'Snippet lệnh',
      snippetsHint: 'Lệnh CoPanel có sẵn và lệnh tự lưu (lưu file JSON trên máy chủ).',
      copanelBuiltin: 'CoPanel (có sẵn)',
      mySnippets: 'Của tôi',
      run: 'Chạy',
      insert: 'Chèn',
      titleLabel: 'Tiêu đề',
      commandLabel: 'Lệnh',
      addSnippet: 'Thêm snippet',
      saveSnippets: 'Lưu',
      saving: 'Đang lưu…',
      savedOk: 'Đã lưu.',
      remove: 'Xóa',
      loadError: 'Không tải được snippet.',
      saveError: 'Không lưu được snippet.',
      notConnected: 'Hãy kết nối terminal trước.',
      togglePanel: 'Snippet',
      collapse: 'Thu gọn',
      expand: 'Mở rộng',
    },
  };

  const tr = t[language === 'vi' ? 'vi' : 'en'];

  const sendRaw = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(text);
    return true;
  }, []);

  const runCommand = useCallback(
    (cmd: string) => {
      const line = cmd.replace(/\r?\n$/, '');
      return sendRaw(line + '\r');
    },
    [sendRaw]
  );

  const insertCommand = useCallback(
    (cmd: string) => {
      return sendRaw(cmd.replace(/\r?\n$/, ''));
    },
    [sendRaw]
  );

  const focusTerm = useCallback(() => {
    termInstanceRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSnippetsLoading(true);
      setSnippetsError(null);
      try {
        const res = await fetch('/api/terminal/snippets', { headers: getAuthHeader() });
        const json = await res.json();
        if (!res.ok || json.status !== 'success' || !json.data) {
          throw new Error(json?.error?.message || tr.loadError);
        }
        if (!cancelled) {
          setBuiltinSnippets(json.data.builtin || []);
          setCustomSnippets(json.data.custom || []);
        }
      } catch {
        if (!cancelled) setSnippetsError(tr.loadError);
      } finally {
        if (!cancelled) setSnippetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tr.loadError]);

  const persistCustom = async () => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/terminal/snippets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ snippets: customSnippets }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json?.error?.message || tr.saveError);
      }
      if (json.data?.custom) setCustomSnippets(json.data.custom);
      setSaveState('ok');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('err');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  const addDraftSnippet = () => {
    const title = draftTitle.trim();
    const command = draftCommand.trim();
    if (!title || !command) return;
    setCustomSnippets((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title, command },
    ]);
    setDraftTitle('');
    setDraftCommand('');
  };

  const removeCustom = (id: string) => {
    setCustomSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  const builtinTitle = (s: BuiltinSnippet) => (language === 'vi' ? s.title_vi : s.title_en);

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
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    termInstanceRef.current = term;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    const wsUrl = `${proto}//${host}${port}/api/terminal/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      term.writeln(`\x1b[1;32m${tr.connected}\x1b[0m\r\n`);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln(`\x1b[1;31m${tr.error}\x1b[0m`);
    };

    ws.onclose = () => {
      setWsConnected(false);
      term.writeln(`\x1b[1;31m\r\n${tr.closed}\x1b[0m`);
    };

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      wsRef.current = null;
      termInstanceRef.current = null;
    };
  }, [language, isDark, tr.connected, tr.error, tr.closed]);

  const snippetBtn = (active: boolean) =>
    `inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-bold px-2 py-1.5 transition min-h-[36px] ${
      active
        ? isDark
          ? 'bg-blue-600/40 text-blue-100 hover:bg-blue-600/55'
          : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
        : isDark
          ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
          : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
    }`;

  const shell = isDark
    ? 'bg-slate-900/40 border-slate-800/80 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div
        className={`relative overflow-hidden p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 border transition-all duration-300 ${
          isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
        }`}
      >
        <div>
          <h1
            className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
              isDark
                ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent'
                : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
            }`}
          >
            <Icons.Terminal className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h1>
          <p className={`${isDark ? 'text-slate-400' : 'text-slate-600'} text-xs md:text-sm mt-2 max-w-xl leading-relaxed`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex items-center gap-2 md:flex-col md:items-end">
          <span
            className={`text-[10px] font-mono font-bold px-2 py-1 rounded-lg ${
              wsConnected
                ? isDark
                  ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : isDark
                  ? 'bg-slate-800 text-slate-500 border border-slate-700'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
            }`}
          >
            {wsConnected ? 'WS ●' : 'WS ○'}
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className={`xl:hidden flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border ${
              isDark ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Icons.Sparkles className="w-4 h-4" />
            {panelOpen ? tr.collapse : tr.expand} {tr.togglePanel}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-stretch">
        <div className={`p-4 rounded-2xl backdrop-blur-md shadow-xl border transition-all duration-300 h-[480px] sm:h-[560px] md:h-[600px] flex flex-col min-h-0 ${shell}`}>
          <div
            className={`flex items-center gap-2 px-2 py-1 mb-3 border-b text-xs font-mono select-none shrink-0 ${
              isDark ? 'border-slate-800/40' : 'border-slate-200'
            }`}
          >
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
            <span className={`ml-2 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>root@vps:bash</span>
          </div>
          <div ref={terminalRef} className="flex-1 min-h-0 overflow-hidden" />
        </div>

        <aside
          className={`rounded-2xl border shadow-xl min-h-0 transition-all duration-300 xl:max-h-[600px] ${
            panelOpen ? 'flex flex-col' : 'hidden xl:flex flex-col'
          } ${shell}`}
        >
          <div className={`p-4 border-b shrink-0 ${isDark ? 'border-slate-800/60' : 'border-slate-200'}`}>
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Icons.Bookmark className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
              {tr.snippets}
            </h2>
            <p className={`text-[10px] mt-1 leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.snippetsHint}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
            {snippetsError && (
              <div className="text-xs text-red-500 flex items-center gap-1">
                <Icons.AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {snippetsError}
              </div>
            )}
            {snippetsLoading && (
              <div className={`text-xs flex items-center gap-2 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                <Icons.Loader className="w-4 h-4 animate-spin" />
                …
              </div>
            )}

            <section>
              <h3 className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                {tr.copanelBuiltin}
              </h3>
              <ul className="space-y-2">
                {builtinSnippets.map((s) => (
                  <li
                    key={s.id}
                    className={`rounded-xl border p-2.5 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-100 bg-slate-50/80'}`}
                  >
                    <div className="text-xs font-semibold leading-tight">{builtinTitle(s)}</div>
                    <div className={`text-[10px] font-mono mt-1 truncate ${isDark ? 'text-slate-500' : 'text-slate-600'}`} title={s.command}>
                      {s.command}
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        type="button"
                        className={snippetBtn(wsConnected)}
                        disabled={!wsConnected}
                        onClick={() => {
                          insertCommand(s.command);
                          focusTerm();
                        }}
                      >
                        <Icons.CornerDownLeft className="w-3.5 h-3.5" />
                        {tr.insert}
                      </button>
                      <button
                        type="button"
                        className={snippetBtn(wsConnected)}
                        disabled={!wsConnected}
                        onClick={() => {
                          runCommand(s.command);
                          focusTerm();
                        }}
                      >
                        <Icons.Play className="w-3.5 h-3.5" />
                        {tr.run}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                {tr.mySnippets}
              </h3>
              <div className={`rounded-xl border p-3 space-y-2 mb-3 ${isDark ? 'border-slate-800 bg-slate-950/30' : 'border-slate-200 bg-white'}`}>
                <label className={`text-[10px] font-bold uppercase ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.titleLabel}</label>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className={`w-full px-2 py-2 rounded-lg text-xs border outline-none ${
                    isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200'
                  }`}
                />
                <label className={`text-[10px] font-bold uppercase ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{tr.commandLabel}</label>
                <textarea
                  value={draftCommand}
                  onChange={(e) => setDraftCommand(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className={`w-full px-2 py-2 rounded-lg text-xs font-mono border outline-none resize-none ${
                    isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200'
                  }`}
                />
                <button
                  type="button"
                  onClick={addDraftSnippet}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold ${
                    isDark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  <Icons.Plus className="w-4 h-4" />
                  {tr.addSnippet}
                </button>
              </div>

              <ul className="space-y-2">
                {customSnippets.map((s) => (
                  <li
                    key={s.id}
                    className={`rounded-xl border p-2.5 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-100 bg-slate-50/80'}`}
                  >
                    <div className="text-xs font-semibold leading-tight">{s.title}</div>
                    <div className={`text-[10px] font-mono mt-1 truncate ${isDark ? 'text-slate-500' : 'text-slate-600'}`} title={s.command}>
                      {s.command}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button
                        type="button"
                        className={snippetBtn(wsConnected)}
                        disabled={!wsConnected}
                        onClick={() => {
                          insertCommand(s.command);
                          focusTerm();
                        }}
                      >
                        <Icons.CornerDownLeft className="w-3.5 h-3.5" />
                        {tr.insert}
                      </button>
                      <button
                        type="button"
                        className={snippetBtn(wsConnected)}
                        disabled={!wsConnected}
                        onClick={() => {
                          runCommand(s.command);
                          focusTerm();
                        }}
                      >
                        <Icons.Play className="w-3.5 h-3.5" />
                        {tr.run}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustom(s.id)}
                        className={`inline-flex items-center gap-1 rounded-lg text-[10px] font-bold px-2 py-1.5 min-h-[36px] ${
                          isDark ? 'bg-red-950/40 text-red-300 hover:bg-red-900/50' : 'bg-red-50 text-red-700 hover:bg-red-100'
                        }`}
                      >
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                        {tr.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className={`p-3 border-t shrink-0 ${isDark ? 'border-slate-800/60' : 'border-slate-200'}`}>
            <button
              type="button"
              onClick={persistCustom}
              disabled={saveState === 'saving'}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold ${
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-100' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
              } disabled:opacity-50`}
            >
              {saveState === 'saving' ? (
                <>
                  <Icons.Loader className="w-4 h-4 animate-spin" />
                  {tr.saving}
                </>
              ) : (
                <>
                  <Icons.Save className="w-4 h-4" />
                  {tr.saveSnippets}
                </>
              )}
            </button>
            {!wsConnected && (
              <p className={`text-[10px] mt-2 text-center ${isDark ? 'text-amber-400/90' : 'text-amber-700'}`}>{tr.notConnected}</p>
            )}
            {saveState === 'ok' && <p className="text-[10px] mt-2 text-center text-emerald-500">{tr.savedOk}</p>}
            {saveState === 'err' && <p className="text-[10px] mt-2 text-center text-red-500">{tr.saveError}</p>}
          </div>
        </aside>
      </div>

      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className={`xl:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-xs font-bold ${
            isDark ? 'bg-amber-600 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          <Icons.Sparkles className="w-4 h-4" />
          {tr.togglePanel}
        </button>
      )}
    </div>
  );
}
