/**
 * Job store - tracks queued/running/completed jobs, fed by SSE updates and
 * one-shot REST fetches. Consumed by the Task Center.
 */
import { api } from './api';
import { events } from './events';
import { createStore, useStore } from './store';

export interface Job {
  id: string;
  kind: string;
  module?: string;
  title: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  payload?: any;
  result?: any;
  error?: string | null;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
  actor?: string | null;
}

interface State {
  jobs: Record<string, Job>;
  order: string[];
  lastFetch: number;
}

const store = createStore<State>({ jobs: {}, order: [], lastFetch: 0 });

type Lang = 'en' | 'vi';

function getCurrentLang(): Lang {
  return (localStorage.getItem('copanel_lang') as Lang) === 'vi' ? 'vi' : 'en';
}

function pickLocalizedFromValue(value: any, lang: Lang): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value[lang] || value.en || value.vi || value.default;
  return undefined;
}

function resolveLocalizedField(src: any, baseKey: string, lang: Lang): string | undefined {
  if (!src || typeof src !== 'object') return undefined;
  const direct = pickLocalizedFromValue(src[baseKey], lang);
  if (direct) return direct;
  const fromMap = pickLocalizedFromValue(src[`${baseKey}_i18n`], lang);
  if (fromMap) return fromMap;
  const fromLangSpecific = src[`${baseKey}_${lang}`];
  if (typeof fromLangSpecific === 'string' && fromLangSpecific) return fromLangSpecific;
  const fallbackEn = src[`${baseKey}_en`];
  if (typeof fallbackEn === 'string' && fallbackEn) return fallbackEn;
  const fallbackVi = src[`${baseKey}_vi`];
  if (typeof fallbackVi === 'string' && fallbackVi) return fallbackVi;
  return undefined;
}

function localizeJob(raw: Job | any): Job {
  const lang = getCurrentLang();
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {};
  return {
    ...raw,
    title: resolveLocalizedField(raw, 'title', lang)
      || resolveLocalizedField(payload, 'title', lang)
      || raw?.title
      || '',
    message: resolveLocalizedField(raw, 'message', lang)
      || resolveLocalizedField(payload, 'message', lang)
      || raw?.message,
    error: resolveLocalizedField(raw, 'error', lang)
      || resolveLocalizedField(payload, 'error', lang)
      || raw?.error
      || null,
  };
}

function upsert(job: Job) {
  const localized = localizeJob(job);
  store.setState((s) => {
    const next = { ...s.jobs, [localized.id]: { ...s.jobs[localized.id], ...localized } };
    let order = s.order;
    if (!order.includes(localized.id)) {
      order = [localized.id, ...order].slice(0, 200);
    }
    return { jobs: next, order };
  });
}

events.on('jobs', (msg: any) => {
  if (msg?.job) upsert(msg.job);
  else if (msg?.job_id && msg?.event === 'update') {
    const existing = store.getState().jobs[msg.job_id];
    if (existing) {
      upsert({ ...existing, progress: msg.progress, message: msg.message, status: msg.status });
    }
  }
});

export const jobsApi = {
  async refresh(limit = 50) {
    const list = await api<Job[]>(`/api/platform/jobs?limit=${limit}`);
    store.setState(() => {
      const map: Record<string, Job> = {};
      const order: string[] = [];
      for (const raw of list) {
        const j = localizeJob(raw);
        map[j.id] = j;
        order.push(j.id);
      }
      return { jobs: map, order, lastFetch: Date.now() };
    });
  },
  async get(id: string): Promise<Job> {
    const data = await api<Job>(`/api/platform/jobs/${id}`);
    return localizeJob(data);
  },
  async cancel(id: string) {
    return api(`/api/platform/jobs/${id}/cancel`, { method: 'POST' });
  },
};

export function useJobs(): { jobs: Job[]; running: number } {
  return useStore(store, (s) => {
    const list = s.order.map((id) => s.jobs[id]).filter(Boolean);
    const running = list.filter((j) => j.status === 'running' || j.status === 'queued').length;
    return { jobs: list, running };
  });
}

export function useJob(id: string | null | undefined): Job | undefined {
  return useStore(store, (s) => (id ? s.jobs[id] : undefined));
}
