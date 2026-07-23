import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as Icons from 'lucide-react';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import ActionConfirmCard, { type PendingAction } from './ActionConfirmCard';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending_actions?: PendingAction[];
}

export default function MessageBubble({
  message,
  language,
  onApprove,
  onCancel,
}: {
  message: ChatMessage;
  language: Lang;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const t = COPY[language];
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600/15 text-violet-600 dark:text-violet-300">
          <Icons.Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-violet-600 text-white'
            : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100'
        }`}
      >
        <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${isUser ? 'text-violet-100' : 'text-slate-400'}`}>
          {isUser ? t.you : t.agent}
        </div>
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="coagent-md text-[13px] leading-relaxed [&_a]:text-violet-600 [&_a]:underline dark:[&_a]:text-violet-300 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] dark:[&_code]:bg-slate-900 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
        {!isUser &&
          (message.pending_actions || []).map((a) => (
            <ActionConfirmCard
              key={a.action_id}
              action={a}
              language={language}
              onApprove={onApprove}
              onCancel={onCancel}
            />
          ))}
      </div>
    </div>
  );
}
