/**
 * Tiny vanilla store backed by ``useSyncExternalStore``.
 *
 * Avoids adding a new runtime dep (Zustand/Redux) while still giving us a
 * single source of truth for cross-cutting UI state - notifications, jobs,
 * launcher visibility, etc.
 */
import { useEffect, useState } from 'react';

export type Listener = () => void;

export interface Store<T> {
  getState: () => T;
  setState: (updater: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (listener: Listener) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState: (updater) => {
      const patch = typeof updater === 'function' ? (updater as (s: T) => Partial<T>)(state) : updater;
      if (!patch || Object.keys(patch).length === 0) return;
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof T>) {
        if (state[key] !== patch[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object, R>(store: Store<T>, selector: (s: T) => R): R {
  // Safer than useSyncExternalStore for this simple custom store in production
  // bundles: we keep one subscribed state snapshot and derive from it.
  const [state, setState] = useState<T>(() => store.getState());
  useEffect(() => {
    const unsub = store.subscribe(() => setState(store.getState()));
    return unsub;
  }, [store]);
  return selector(state);
}
