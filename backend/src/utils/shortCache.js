/**
 * A few seconds of memory for the live boards (campus map, pulse, home).
 *
 * Those screens re-poll every 30-60 seconds and each answer costs dozens of
 * queries, so a school's morning — every teacher's map refreshing at once —
 * recomputed the same answer hundreds of times a minute. Each key is computed
 * once per window, and requests that arrive while it is being computed wait
 * for that one computation instead of starting their own.
 *
 * Only for read-only answers whose key already captures everything that makes
 * them differ (school, role or person, options). Off when the window is 0,
 * which is the default under test so assertions see fresh data.
 */
const entries = new Map();
const MAX_KEYS = 2000;

export const BOARD_CACHE_MS = Number(process.env.BOARD_CACHE_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 15000));

export async function shortCache(key, ms, compute) {
  if (!(ms > 0)) return compute();
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.until > now) return hit.promise;
  const promise = Promise.resolve().then(compute);
  if (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value);
  entries.set(key, { until: now + ms, promise });
  // A failure is not remembered: the next request tries again.
  promise.catch(() => { if (entries.get(key)?.promise === promise) entries.delete(key); });
  return promise;
}

/** Drops every cached answer whose key starts with the prefix (e.g. after a write that changes a board). */
export function forgetCached(prefix) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}

/** A stable fingerprint of a permission map, so callers with the same grants share an answer. */
export function permissionKey(permissions = {}) {
  return Object.keys(permissions).sort().map((k) => `${k}=${permissions[k]}`).join('|');
}

/**
 * The same idea for a whole GET route: a successful JSON answer is kept for a
 * few seconds under a key the caller derives from the request (school, person,
 * address), and repeated requests in that window get it without recomputing.
 * Only 200 answers are kept; errors always go through to the handler.
 */
export function cacheGetResponses(keyOf, ms) {
  return (req, res, next) => {
    if (!(ms > 0) || req.method !== 'GET') return next();
    const key = keyOf(req);
    const hit = key ? entries.get(key) : null;
    if (hit && hit.until > Date.now() && hit.body !== undefined) return res.status(200).json(hit.body);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (key && res.statusCode === 200) {
        if (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value);
        entries.set(key, { until: Date.now() + ms, body, promise: Promise.resolve(body) });
      }
      return json(body);
    };
    return next();
  };
}

/** Role dashboards: per person, a little shorter than the live boards. */
export const DASHBOARD_CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 10000));
