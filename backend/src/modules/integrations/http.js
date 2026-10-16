/**
 * The one way EduOS talks to an ad platform or social network.
 *
 * - HTTPS only, and only to the official API hosts below (an allowlist, not a
 *   blocklist). A URL that comes back from a provider (Meta's `paging.next`,
 *   for instance) passes the same check before it is followed, so nothing a
 *   provider or a user types can point a request somewhere else (no SSRF).
 * - Redirects are never followed.
 * - Every call has a timeout and a response size cap.
 * - Rate limits (HTTP 429, Meta's throttling error codes) are retried with
 *   backoff, honouring Retry-After up to a minute. Server errors (5xx) and
 *   network failures are retried only for requests that are safe to repeat
 *   (`idempotent: true`, the default for GET): a post that may have been made
 *   is never sent twice.
 * - Errors carry the provider's own message, never the request URL, headers
 *   or body, so a token cannot reach a log or the browser through an error.
 *
 * fetch is looked up on globalThis at call time, so tests stub it with
 * vi.stubGlobal('fetch', ...) and no request ever leaves the machine.
 */

export const API_HOSTS = Object.freeze([
  // Meta: Graph API (Pages, Instagram, Marketing API insights, lead retrieval, OAuth token exchange).
  'graph.facebook.com',
  // Google: OAuth token/revoke, Google Ads API, GA4 Data and Admin APIs, YouTube Data API.
  'oauth2.googleapis.com', 'googleads.googleapis.com', 'analyticsdata.googleapis.com', 'analyticsadmin.googleapis.com', 'www.googleapis.com', 'youtube.googleapis.com',
  // LinkedIn: REST API (posts, organisations, ad analytics) and OAuth.
  'api.linkedin.com', 'www.linkedin.com',
  // X: API v2 (posts, users, OAuth 2.0 token and revoke).
  'api.x.com',
]);
const HOSTS = new Set(API_HOSTS);

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// Meta reports throttling as an error code (often with HTTP 400), not as 429.
const META_THROTTLE = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

export class ProviderError extends Error {
  constructor(message, { provider = null, status = 0, code = null, rateLimited = false, auth = false, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.providerCode = code;
    this.rateLimited = rateLimited;
    // The token was refused (expired, revoked): the school has to reconnect.
    this.auth = auth;
    this.retryable = retryable;
  }
}

let sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** Tests replace the wait between retries so they run instantly. */
export function setSleepForTests(fn) { sleep = fn ?? ((ms) => new Promise((r) => { setTimeout(r, ms); })); }

/** Refuses anything but https:// to an allowlisted API host, with no credentials or odd port in the URL. */
export function assertAllowedUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new ProviderError('Refused: not a valid provider URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !HOSTS.has(u.hostname.toLowerCase())) {
    throw new ProviderError(`Refused: ${u.hostname || 'that address'} is not an official provider API host`);
  }
  return u;
}

/** A short, safe description of a provider error body (Meta, Google, LinkedIn and X shapes). */
function describe(body, status) {
  if (!body || typeof body !== 'object') return { message: `HTTP ${status}`, code: null };
  const e = body.error;
  if (e && typeof e === 'object') {
    // Meta: { error: { message, code, error_subcode } }; Google: { error: { code, message, status } }
    return { message: String(e.error_user_msg || e.message || e.status || `HTTP ${status}`), code: e.code ?? null, sub: e.error_subcode ?? null };
  }
  if (typeof e === 'string') return { message: String(body.error_description || e), code: e }; // OAuth token endpoints
  if (Array.isArray(body.errors) && body.errors[0]) return { message: String(body.errors[0].message || body.errors[0].detail || body.title || `HTTP ${status}`), code: body.errors[0].code ?? null }; // X
  if (body.message) return { message: String(body.message), code: body.serviceErrorCode ?? body.code ?? null }; // LinkedIn
  if (body.detail || body.title) return { message: String(body.detail || body.title), code: body.type ?? null }; // X problem+json
  return { message: `HTTP ${status}`, code: null };
}

function retryAfterMs(res, attempt) {
  const h = res?.headers?.get?.('retry-after');
  const secs = h && /^\d+$/.test(h.trim()) ? Number(h) : null;
  if (secs !== null) return Math.min(secs, 60) * 1000;
  const reset = res?.headers?.get?.('x-rate-limit-reset'); // X: epoch seconds
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Math.min(Number(reset) * 1000 - Date.now(), 60_000));
  return Math.min(500 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
}

/**
 * One request to a provider API. Returns `{ status, data, headers }`; throws a
 * ProviderError for anything that is not a 2xx after the allowed retries.
 *
 * options: method, headers, query (object), json (body), form (object,
 * x-www-form-urlencoded), bearer (token for Authorization), basic ([id, secret]),
 * timeoutMs, retries (default 3), idempotent (default: GET), provider (label).
 */
export async function apiRequest(url, opts = {}) {
  const {
    method = 'GET', headers = {}, query, json, form, bearer, basic,
    timeoutMs = DEFAULT_TIMEOUT_MS, retries = 3, provider = null,
  } = opts;
  const idempotent = opts.idempotent ?? method === 'GET';
  const u = assertAllowedUrl(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const h = { Accept: 'application/json', ...headers };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  }
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (basic) h.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(basic[0])}:${encodeURIComponent(basic[1])}`).toString('base64')}`;

  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await globalThis.fetch(u.toString(), { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if (idempotent && attempt < retries) { await sleep(retryAfterMs(null, attempt)); continue; } // eslint-disable-line no-await-in-loop
      throw new ProviderError(timedOut ? `${provider ?? 'The provider'} did not answer in time` : `${provider ?? 'The provider'} could not be reached`, { provider, retryable: true });
    }
    // eslint-disable-next-line no-await-in-loop
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ProviderError(`${provider ?? 'The provider'} sent a response larger than allowed`, { provider, status: res.status });
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (res.status >= 200 && res.status < 300) return { status: res.status, data, headers: res.headers };
    if (res.status >= 300 && res.status < 400) throw new ProviderError(`${provider ?? 'The provider'} answered with a redirect, which is not followed`, { provider, status: res.status });

    const d = describe(data, res.status);
    const rateLimited = res.status === 429 || (provider === 'Meta' && META_THROTTLE.has(Number(d.code)));
    const serverError = res.status >= 500;
    // A rate-limited request was refused before it was processed, so it is always safe to repeat.
    if ((rateLimited || (serverError && idempotent)) && attempt < retries) {
      await sleep(retryAfterMs(res, attempt)); // eslint-disable-line no-await-in-loop
      continue;
    }
    const auth = res.status === 401 || (provider === 'Meta' && Number(d.code) === 190) || d.code === 'invalid_grant';
    throw new ProviderError(`${provider ?? 'Provider'}: ${d.message}`.slice(0, 400), { provider, status: res.status, code: d.code, rateLimited, auth, retryable: rateLimited || serverError });
  }
}
