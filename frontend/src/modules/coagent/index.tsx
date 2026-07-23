/**
 * CoAgent — AI SysAdmin chat assistant
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import { api } from '../../core/platform';
import ModuleViewport from '../../core/shell/ModuleViewport';
import { COPY, type Lang } from './i18n';
import MessageBubble, { type ChatMessage } from './components/MessageBubble';
import type { PendingAction } from './components/ActionConfirmCard';
import QuickPrompts from './components/QuickPrompts';
import SettingsDrawer from './components/SettingsDrawer';

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function CoAgentDashboard() {
  const { language } = useAppShellContext();
  const lang = (language === 'vi' ? 'vi' : 'en') as Lang;
  const t = COPY[lang];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const apiMessages = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const updateActionStatus = useCallback(
    (actionId: string, patch: Partial<PendingAction>) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.pending_actions?.length) return m;
          return {
            ...m,
            pending_actions: m.pending_actions.map((a) =>
              a.action_id === actionId ? { ...a, ...patch } : a,
            ),
          };
        }),
      );
    },
    [],
  );

  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError('');
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed };
    const nextHistory = [...apiMessages, { role: 'user' as const, content: trimmed }];
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const data = await api<{
        reply: string;
        pending_actions?: PendingAction[];
      }>('/api/coagent/chat', {
        method: 'POST',
        body: { messages: nextHistory },
      });
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: data.reply || '',
        pending_actions: (data.pending_actions || []).map((a) => ({
          ...a,
          status: 'pending',
        })),
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const onApprove = async (actionId: string) => {
    updateActionStatus(actionId, { status: 'running' });
    try {
      const data = await api<{
        result?: { ok?: boolean; summary?: string; error?: string };
        title?: string;
      }>('/api/coagent/execute-action', {
        method: 'POST',
        body: { action_id: actionId },
      });
      const ok = !!data?.result?.ok;
      const summary = data?.result?.summary || data?.result?.error || '';
      updateActionStatus(actionId, {
        status: ok ? 'done' : 'failed',
        resultSummary: summary,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: ok
            ? `✅ **${data.title || 'Action'}**\n\n${summary}`
            : `❌ **${data.title || 'Action'}**\n\n${summary || t.actionFailed}`,
        },
      ]);
    } catch (e: any) {
      updateActionStatus(actionId, {
        status: 'failed',
        resultSummary: e?.message || String(e),
      });
      setError(e?.message || String(e));
    }
  };

  const onCancel = async (actionId: string) => {
    try {
      await api('/api/coagent/cancel-action', {
        method: 'POST',
        body: { action_id: actionId },
      });
    } catch {
      /* still mark cancelled locally */
    }
    updateActionStatus(actionId, { status: 'cancelled' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText(input);
    }
  };

  return (
    <ModuleViewport className="relative flex h-full min-h-0 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow">
            <Icons.Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{t.title}</div>
            <div className="truncate text-xs text-slate-500">{t.subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t.clearChat}
            onClick={() => {
              setMessages([]);
              setError('');
            }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Icons.Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t.settings}
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Icons.Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !loading && (
            <div className="mx-auto max-w-2xl space-y-4 pt-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 text-violet-600">
                <Icons.Sparkles className="h-7 w-7" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t.empty}</p>
              <QuickPrompts language={lang} disabled={loading} onPick={(p) => void sendText(p)} />
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              language={lang}
              onApprove={onApprove}
              onCancel={onCancel}
            />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Icons.Loader2 className="h-4 w-4 animate-spin" />
              {t.thinking}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <span className="font-semibold">{t.error}: </span>
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {messages.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-2 dark:border-slate-800">
            <QuickPrompts language={lang} disabled={loading} onPick={(p) => void sendText(p)} />
          </div>
        )}

        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              disabled={loading}
              placeholder={t.placeholder}
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={loading || !input.trim()}
              onClick={() => void sendText(input)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              <Icons.Send className="h-4 w-4" />
              {t.send}
            </button>
          </div>
        </div>
      </div>

      <SettingsDrawer open={settingsOpen} language={lang} onClose={() => setSettingsOpen(false)} />
    </ModuleViewport>
  );
}
