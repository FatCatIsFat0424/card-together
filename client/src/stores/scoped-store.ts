import { createContext, useContext } from 'react';
import type { Context } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StateCreator, StoreApi } from 'zustand/vanilla';

/**
 * A Zustand hook that renders against the store provided by the nearest `Scope`, or the global
 * store outside one. Static members (`getState`, `subscribe`, ...) always address the global
 * store, so socket handlers and app-level code keep updating live state.
 */
export interface ScopedStoreHook<T> extends StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
  /** The store the calling component renders against. */
  useApi: () => StoreApi<T>;
  /** A separate instance built from the same initializer, for one `Scope`. */
  createScope: () => StoreApi<T>;
  /** `null` restores the global store inside an enclosing scope. */
  Scope: Context<StoreApi<T> | null>;
}

export function scopedStore<T>(initializer: StateCreator<T, [], []>): ScopedStoreHook<T> {
  const global = createStore<T>()(initializer);
  const Scope = createContext<StoreApi<T> | null>(null);
  const useApi = (): StoreApi<T> => useContext(Scope) ?? global;
  const identity = (state: T): T => state;
  function useScopedStore<U>(selector?: (state: T) => U): T | U {
    return useStore<StoreApi<T>, T | U>(useApi(), selector ?? identity);
  }
  const createScope = (): StoreApi<T> => {
    const scoped = createStore<T>()(initializer);
    // Scopes start empty and are filled before their first render, so a server render reads the
    // current state instead of the initializer's.
    return { ...scoped, getInitialState: scoped.getState };
  };
  return Object.assign(useScopedStore as ScopedStoreHook<T>, global, { useApi, createScope, Scope });
}
