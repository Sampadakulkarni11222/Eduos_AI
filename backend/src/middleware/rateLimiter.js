import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { sendError } from '../utils/response.js';

/** General API limiter — sized for normal interactive dashboard usage. */
export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
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
  max: Number(process.env.RATE_LIMIT_AI_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.actor?.profileId ?? req.ip),
  handler: (_req, res) =>
    sendError(res, 'Too many assistant requests, please slow down.', 429, [], 'RATE_LIMITED'),
});

/** Strict limiter for credential endpoints (login, OTP request/verify). */
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    sendError(res, 'Too many sign-in attempts, please try again later.', 429, [], 'RATE_LIMITED'),
});
