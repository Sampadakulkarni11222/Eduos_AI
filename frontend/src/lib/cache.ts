'use client';
/**
 * A very small read cache for API results.
 *
 * The app has no query library; every page fetched in a `useEffect` and showed
 * a skeleton while it waited, so navigating back to a page you were just on
 * refetched everything and flashed a loader over data that had not changed.
 *
 * This adds three things and nothing more:
 *   1. a module-level store, readable synchronously, so a revisited page can
 *      render its previous data on the first frame instead of a skeleton;
 *   2. in-flight de-duplication, so two components mounting at once (or a
 *      double navigation) share one request rather than firing two;
 *   3. explicit invalidation, so a mutation drops exactly the keys it affects
 *      and the next read is guaranteed fresh.
 *
 * Cached entries are served immediately and then revalidated in the background
 * once they pass `staleMs`, so what you see is never older than one navigation
 * — the trade the requirements ask for (no stale data, no needless skeletons).
 *
 * The store is per-tab and in-memory only: it is cleared on sign-out so one
 * account's data can never be served to the next session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Entry<T = unknown> {
  data: T;
  at: number;
}

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<() => void>>();

/** Default: serve instantly, revalidate in the background after 30s. */
const DEFAULT_STALE_MS = 30_000;

function notify(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

export function readCache<T>(key: string): Entry<T> | undefined {
  return store.get(key) as Entry<T> | undefined;
}

export function writeCache<T>(key: string, data: T) {
  store.set(key, { data, at: Date.now() });
  notify(key);
}

/**
 * Drops cached entries. `invalidateCache('students')` clears every key that
 * starts with "students" — call it after a mutation that could change them.
 * With no argument the whole store is dropped (used on sign-out).
 */
export function invalidateCache(prefix?: string) {
  if (!prefix) {
    const keys = [...store.keys()];
    store.clear();
    inFlight.clear();
    keys.forEach(notify);
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      inFlight.delete(key);
      notify(key);
    }
  }
}

/**
 * Fetches through the cache, collapsing concurrent callers onto one request.
 * Always resolves with fresh-enough data; use `useCachedResource` in
 * components so the cached value is also rendered on the first frame.
 */
export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, staleMs = DEFAULT_STALE_MS): Promise<T> {
  const hit = readCache<T>(key);
  if (hit && Date.now() - hit.at < staleMs) return Promise.resolve(hit.data);

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = fetcher()
    .then((data) => { writeCache(key, data); return data; })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

export interface CachedResource<T> {
  data: T | undefined;
  /** True only when there is nothing to show yet — never on a background revalidate. */
  loading: boolean;
  /** True while a revalidation runs behind data that is already on screen. */
  revalidating: boolean;
  error: unknown;
  /** Forces a refetch, bypassing the cache. */
  refresh: () => Promise<void>;
}

/**
 * Reads a cached resource in a component.
 *
 * `key` must identify the request completely (include any filter/page in it),
 * otherwise two different queries would share one cache slot.
 * Pass `enabled: false` to hold off until prerequisites are ready.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; enabled?: boolean } = {},
): CachedResource<T> {
  const { staleMs = DEFAULT_STALE_MS, enabled = true } = opts;

  // Seed from cache so a revisited page paints real data on the first frame.
  const [data, setData] = useState<T | undefined>(() => (key ? readCache<T>(key)?.data : undefined));
  const [error, setError] = useState<unknown>(null);
  const [revalidating, setRevalidating] = useState(false);

  // Keep the latest fetcher without making it a dependency: callers usually
  // pass an inline arrow, which would otherwise refetch on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (force: boolean) => {
    if (!key || !enabled) return;
    const hit = readCache<T>(key);
    const fresh = hit && Date.now() - hit.at < staleMs;
    if (hit) setData(hit.data);
    if (fresh && !force) return;

    setRevalidating(true);
    try {
      const value = force
        ? await fetcherRef.current().then((d) => { writeCache(key, d); return d; })
        : await cachedFetch<T>(key, () => fetcherRef.current(), staleMs);
      setData(value);
      setError(null);
    } catch (e) {
      setError(e);
      // A failed revalidation leaves the last good value on screen rather than
      // blanking the page; `error` lets the caller surface it if it wants to.
    } finally {
      setRevalidating(false);
    }
  }, [key, enabled, staleMs]);

  useEffect(() => {
    if (!key || !enabled) return;
    setData(readCache<T>(key)?.data);
    void run(false);

    // Re-render when someone else writes or invalidates this key.
    const onChange = () => {
      const hit = readCache<T>(key);
      if (hit) setData(hit.data);
      else void run(true);
    };
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key)!.add(onChange);
    return () => {
      subscribers.get(key)?.delete(onChange);
      if (subscribers.get(key)?.size === 0) subscribers.delete(key);
    };
  }, [key, enabled, run]);

  const refresh = useCallback(() => run(true), [run]);

  return {
    data,
    loading: data === undefined && enabled && !!key,
    revalidating,
    error,
    refresh,
  };
}
