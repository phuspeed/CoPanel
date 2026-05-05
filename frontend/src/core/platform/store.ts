/**
 * Tiny vanilla store backed by ``useSyncExternalStore``.
 *
 * Avoids adding a new runtime dep (Zustand/Redux) while still giving us a
 * single source of truth for cross-cutting UI state - notifications, jobs,
 * launcher visibility, etc.
 */
import { useSyncExternalStore } from 'react';

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
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}
