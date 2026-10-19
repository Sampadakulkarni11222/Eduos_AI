import { createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { env, numFromEnv } from '../config/env.js';
import { sendError } from '../utils/response.js';

/** General API limiter — sized for normal interactive dashboard usage. */
export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Session refreshes all arrive from the frontend server's address, so a
  // per-IP budget is a platform-wide one for them; they have their own
  // per-session limiter instead (refreshRateLimiter below).
  // Live CCTV playback (a playlist and a segment every few seconds) has its own per-viewing limiter.
  skip: (req) => (req.method === 'POST' && /^\/(api\/)?v1\/auth\/refresh\/?$/.test(req.path)) || /^\/(api\/)?v1\/cctv\/play\//.test(req.path),
  handler: (_req, res) =>
    sendError(res, 'Too many requests, please try again later.', 429, [], 'RATE_LIMITED'),
});

/**
 * Limiter for the AI assistant endpoints.
 *
 * Sized well below the general limit because each call can reach a model and a
 * write proposal, so it is both the most expensive and the most abusable
 * surface. Keyed on the authenticated profile where one exists, falling back to
 * IP for anything unauthenticated: keying purely on IP would put every parent
 * behind a school's shared connection — and every WhatsApp user, since that
 * traffic all arrives from Meta — into one bucket.
 *
 * The real per-actor control lives in the agent core (see agent/throttle.js),
 * because both the web and WhatsApp surfaces call runAgent() and only one of
 * them passes through this middleware. This is the cheap early rejection.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  max: numFromEnv('RATE_LIMIT_AI_MAX', 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.actor?.profileId ?? req.ip),
  handler: (_req, res) =>
    sendError(res, 'Too many assistant requests, please slow down.', 429, [], 'RATE_LIMITED'),
});

/**
 * Upload limiter.
 *
 * Uploads previously fell under the general limiter only, which allows 2000
 * requests per 15 minutes — at UPLOAD_MAX_BYTES (15 MB by default) that is
 * roughly 30 GB of writes per IP per window, from any signed-in account. Disk
 * exhaustion is the cheapest denial of service this system offers, and a
 * student with a valid session is all it takes.
 *
 * Keyed on the profile rather than the IP: a whole school behind one NAT is
 * the normal case here, and an IP-keyed limit would punish the class for one
 * pupil.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60_000,
  max: numFromEnv('RATE_LIMIT_UPLOAD_MAX', 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.actor?.profileId ?? req.ip),
  handler: (_req, res) =>
    sendError(res, 'Too many uploads, please wait a moment and try again.', 429, [], 'RATE_LIMITED'),
});

/**
 * The account a credential request is about: the email or phone it submits.
 * Normalised (trimmed, lower-cased, phone digits only) so "A@x.com " and
 * "a@x.com" share a bucket. Null when the request names no account (Google
 * sign-in sends an opaque token), in which case only the address is used.
 */
export function authIdentifier(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email) return `e:${email}`;
  const phone = typeof b.phone === 'string' || typeof b.phone === 'number' ? String(b.phone).replace(/[^\d]/g, '') : '';
  if (phone) return `p:${phone}`;
  return null;
}

const authLimited = (_req, res) =>
  sendError(res, 'Too many sign-in attempts, please try again later.', 429, [], 'RATE_LIMITED');

/**
 * Credential limiter, part 1: per address AND account.
 *
 * A school's staff usually share one public IP (one NAT, one office router).
 * Keyed on the address alone, thirty sign-ins from that IP in fifteen minutes
 * locked the whole school out at 8 am. Keyed on address + the email/phone
 * being tried, each person has their own RATE_LIMIT_AUTH_MAX budget, and
 * guessing one account's password is still bounded just as tightly.
 * (The per-phone OTP throttle in the auth service is separate and unchanged.)
 */
const authIdentityLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = authIdentifier(req.body);
    return id ? `ai:${req.ip}|${id}` : `ai:${req.ip}`;
  },
  handler: authLimited,
});

/**
 * Credential limiter, part 2: a looser ceiling per address.
 *
 * Without it, one address could try a few passwords against every account in
 * turn (a fresh identity bucket each time). RATE_LIMIT_AUTH_IP_MAX (default
 * 300 per window) comfortably covers a whole staff room signing in together.
 */
const authAddressLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_IP_MAX,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `aip:${req.ip}`,
  handler: authLimited,
});

/** Limiter for credential endpoints (login, OTP request/verify, Google): both parts, address ceiling first. */
export function authRateLimiter(req, res, next) {
  authAddressLimiter(req, res, (err) => {
    if (err) return next(err);
    return authIdentityLimiter(req, res, next);
  });
}

/**
 * Limiter for POST /auth/refresh, keyed on the session rather than the IP.
 *
 * Refreshes do not come from browsers: the portal's backend-for-frontend
 * (frontend/src/app/api/session/refresh) makes them server-side, so every user
 * on the platform arrives from the frontend server's one address. Under the
 * per-IP credential limiter (RATE_LIMIT_AUTH_MAX, 30 per window) the whole
 * platform shared thirty refreshes per fifteen minutes, and the next one was a
 * 429 that signed its user out.
 *
 * A refresh token is 320 random bits, so there is nothing to guess and no
 * reason to throttle by address; what is worth bounding is one session
 * refreshing in a loop. Keyed on a hash of the token so the raw value is never
 * held as a map key.
 */
export const refreshRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: numFromEnv('RATE_LIMIT_REFRESH_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    return token ? `rt:${createHash('sha256').update(token).digest('hex')}` : `ip:${req.ip}`;
  },
  handler: (_req, res) =>
    sendError(res, 'Too many session refreshes, please try again shortly.', 429, [], 'RATE_LIMITED'),
});

/**
 * True when the request carries the frontend server's shared secret.
 *
 * The portal's backend-for-frontend makes every refresh from one address, and
 * it already limits failed refreshes per *real* client address itself (it can
 * see them; this server cannot). So it is exempt from the per-IP failure limit
 * below — otherwise anyone could send bad cookies through it until the shared
 * bucket filled and every user's refresh was refused. Unset secret: no
 * exemption, and the frontend server is simply one more address.
 */
export function isTrustedFrontendProxy(req) {
  const secret = env.FRONTEND_PROXY_SECRET;
  const given = req.headers['x-eduos-proxy-secret'];
  if (!secret || typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Per-address limit on FAILED refreshes.
 *
 * A refresh token cannot be guessed, but invalid ones cost a database lookup
 * each, and the per-session limiter above gives every random token a fresh
 * bucket. Successful refreshes are not counted (skipSuccessfulRequests), so
 * users sharing an address never use this budget up by refreshing honestly.
 */
export const refreshFailureRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: numFromEnv('RATE_LIMIT_REFRESH_FAIL_MAX', 100),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => isTrustedFrontendProxy(req),
  keyGenerator: (req) => `rf:${req.ip}`,
  handler: (_req, res) =>
    sendError(res, 'Too many failed session refreshes from this address, please try again later.', 429, [], 'RATE_LIMITED'),
});
