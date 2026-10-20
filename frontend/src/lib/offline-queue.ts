/**
 * Offline queue for the key teacher and gate tasks: attendance marking, lab
 * issue/return, gate and bus checkpoint scans by staff, sanitation checks,
 * PTM check-in and class check-in.
 *
 * A write made while offline (or one whose request never reached the server)
 * is kept in IndexedDB with an idempotency key and the time it was queued.
 * When the browser is back online the queue replays in order with
 * `Idempotency-Key` and `X-Offline-Queued-At`; the server runs each write at
 * most once. Conflicts: the server wins. A replay the server refuses (409/4xx)
 * or answers with `conflicts` is dropped from the queue and shown as a notice
 * saying the school's copy was kept.
 *
 * Every storage call is wrapped: private windows, blocked storage and
 * browsers without IndexedDB fall back to memory for this tab.
 */
import { ApiError, request } from './api';

export type OfflineKind = 'ATTENDANCE' | 'LAB_STOCK' | 'CHECKPOINT_SCAN' | 'SANITATION_CHECK' | 'PTM_CHECK_IN' | 'CLASS_CHECK_IN';
export interface QueuedWrite { key: string; kind: OfflineKind; path: string; body: unknown; label: string; queuedAt: string; attempts: number; lastError?: string | null }
export interface OfflineNotice { id: string; label: string; text: string; at: string; tone: 'conflict' | 'error' | 'ok' }
export interface OfflineResult<T> { queued: boolean; key: string; data?: T }

const DB = 'eduos-offline';
const STORE = 'queue';
const EVENT = 'eduos-offline-change';
let memory: QueuedWrite[] = [];
let notices: OfflineNotice[] = [];
let syncing = false;

const newKey = () => {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `off-${crypto.randomUUID()}`; } catch { /* fall through */ }
  return `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

function emit() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE, { keyPath: 'key' }); } catch { /* exists */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void, fallback: () => T): Promise<T> {
  const db = await openDb();
  if (!db) return fallback();
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { resolve((r && 'result' in r ? (r.result as T) : (undefined as T))); db.close(); };
      tx.onerror = () => { resolve(fallback()); db.close(); };
      tx.onabort = () => { resolve(fallback()); db.close(); };
    } catch { resolve(fallback()); }
  });
}

export async function listQueued(): Promise<QueuedWrite[]> {
  const rows = await withStore<QueuedWrite[]>('readonly', (s) => s.getAll(), () => memory);
  return [...(rows ?? [])].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

async function put(item: QueuedWrite) {
  const ok = await withStore<boolean | undefined>('readwrite', (s) => s.put(item), () => { memory = [...memory.filter((m) => m.key !== item.key), item]; return true; });
  void ok;
  emit();
}

async function remove(key: string) {
  await withStore<undefined>('readwrite', (s) => s.delete(key), () => { memory = memory.filter((m) => m.key !== key); return undefined; });
  emit();
}

export const queuedCount = async () => (await listQueued()).length;
export const offlineNotices = () => notices;
export function dismissNotice(id: string) { notices = notices.filter((n) => n.id !== id); emit(); }
function notice(label: string, text: string, tone: OfflineNotice['tone']) {
  notices = [{ id: newKey(), label, text, at: new Date().toISOString(), tone }, ...notices].slice(0, 20);
  emit();
}

export function onOfflineChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = () => fn();
  window.addEventListener(EVENT, h);
  window.addEventListener('online', h);
  window.addEventListener('offline', h);
  return () => { window.removeEventListener(EVENT, h); window.removeEventListener('online', h); window.removeEventListener('offline', h); };
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
/** A request that never reached the server (no response at all). */
const isNetworkError = (err: unknown) => err instanceof TypeError || (err instanceof Error && /Failed to fetch|NetworkError|Load failed|network/i.test(err.message) && !(err instanceof ApiError));

const send = <T>(path: string, body: unknown, key: string, queuedAt?: string) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers: { 'Idempotency-Key': key, ...(queuedAt ? { 'X-Offline-Queued-At': queuedAt } : {}) } });

/**
 * Sends a write now when online, or queues it. A request that fails because
 * the network dropped is queued too; a refusal from the server is thrown as
 * usual (the person is looking at the screen and can fix it).
 */
export async function offlineWrite<T>(kind: OfflineKind, path: string, body: unknown, label: string): Promise<OfflineResult<T>> {
  const key = newKey();
  const queuedAt = new Date().toISOString();
  if (isOnline()) {
    try {
      const data = await send<T>(path, body, key, queuedAt);
      reportConflicts(label, data);
      return { queued: false, key, data };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }
  await put({ key, kind, path, body, label, queuedAt, attempts: 0, lastError: null });
  return { queued: true, key };
}

function reportConflicts(label: string, data: unknown) {
  const conflicts = (data as { conflicts?: Array<{ yours: string; kept: string }> } | null)?.conflicts;
  if (Array.isArray(conflicts) && conflicts.length) {
    notice(label, `${conflicts.length} ${conflicts.length === 1 ? 'entry was' : 'entries were'} changed by someone else after you made this change. The school's copy was kept (${conflicts.map((c) => `${c.yours.toLowerCase()} → kept ${c.kept.toLowerCase()}`).join(', ')}).`, 'conflict');
  }
}

/**
 * Replays the queue in order. Stops at the first network failure (still
 * offline) or a signed-out session; anything the server answered leaves the
 * queue, with a notice when the server kept its own version.
 */
export async function syncQueue(): Promise<{ sent: number; left: number }> {
  if (syncing || !isOnline()) return { sent: 0, left: await queuedCount() };
  syncing = true;
  let sent = 0;
  try {
    for (const item of await listQueued()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await send<unknown>(item.path, item.body, item.key, item.queuedAt);
        reportConflicts(item.label, data);
        // eslint-disable-next-line no-await-in-loop
        await remove(item.key);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err)) break;
        if (err instanceof ApiError && (err.status === 401 || err.status >= 500)) {
          // eslint-disable-next-line no-await-in-loop
          await put({ ...item, attempts: item.attempts + 1, lastError: err.message });
          break;
        }
        const msg = err instanceof Error ? err.message : 'Refused';
        notice(item.label, `Not applied: ${msg}. The school's copy was kept.`, 'conflict');
        // eslint-disable-next-line no-await-in-loop
        await remove(item.key);
      }
    }
  } finally {
    syncing = false;
  }
  if (sent) notice('Offline changes', `${sent} change${sent === 1 ? '' : 's'} saved to the school.`, 'ok');
  return { sent, left: await queuedCount() };
}

/** For tests. */
export function __resetOfflineForTests() { memory = []; notices = []; syncing = false; }
