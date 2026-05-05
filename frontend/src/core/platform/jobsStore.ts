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

function upsert(job: Job) {
  store.setState((s) => {
    const next = { ...s.jobs, [job.id]: { ...s.jobs[job.id], ...job } };
    let order = s.order;
    if (!order.includes(job.id)) {
      order = [job.id, ...order].slice(0, 200);
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
      for (const j of list) {
        map[j.id] = j;
        order.push(j.id);
      }
      return { jobs: map, order, lastFetch: Date.now() };
    });
  },
  async get(id: string): Promise<Job> {
    return api<Job>(`/api/platform/jobs/${id}`);
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
