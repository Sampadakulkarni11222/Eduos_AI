import { AppError } from '../../../utils/AppError.js';
import { logger } from '../../../utils/logger.js';

/**
 * Per-actor throttling and prompt-injection monitoring for the agent surface.
 *
 * Deliberately keyed on **profileId, not IP**. The general API limiter keys on
 * `req.ip`, which is the right choice for a browser but useless here: every
 * WhatsApp message arrives from Meta's webhook infrastructure, so the whole
 * school shares one source address. An IP-keyed limit would either be so loose
 * it never fires or so tight that one chatty parent locks out everybody. Keying
 * on the resolved actor also means the limit follows a person across surfaces —
 * hammering the web assistant and then switching to WhatsApp does not reset it.
 *
 * This lives in the core rather than in Express middleware for the same reason
 * the confirmation-superseding fix does: both surfaces call runAgent(), so a
 * guard here cannot be bypassed by reaching the orchestrator another way. The
 * HTTP limiter on the web routes is a cheap early rejection on top, not the
 * control itself.
 *
 * **Known limitation, stated rather than buried:** this is in-process memory.
 * It is correct for a single instance and degrades to per-instance counting
 * behind a load balancer. Moving it to Redis is a drop-in change to the two
 * Map operations below, and is required before running more than one replica.
 */

const WINDOW_MS = 60_000;

/** Sustained conversational pace. Generous for a human, hostile to a script. */
const MAX_CALLS_PER_WINDOW = Number(process.env.AGENT_RATE_LIMIT_PER_MIN) || 20;

/**
 * Injection attempts tolerated in the window before the surface closes for
 * this actor.
 *
 * Not 1: people legitimately paste text containing phrases like "ignore the
 * previous message", and a school assistant that locks out a parent for one
 * unlucky sentence is worse than useless. Repetition is the signal — nobody
 * probes a chatbot three times in a minute by accident.
 */
const MAX_INJECTION_ATTEMPTS = Number(process.env.AGENT_INJECTION_STRIKES) || 3;

/**
 * Cool-off after the strike limit — deliberately short.
 *
 * My first version locked the surface for 15 minutes. That is the wrong trade
 * for this product. A prompt injection here cannot actually gain anything: the
 * tool layer authorizes every action against live permissions, so the detector
 * is defence in depth, not the defence. The security benefit of a long block is
 * therefore close to zero, while the cost of a false positive is a parent who
 * quoted a sentence losing attendance and fee lookups for a quarter of an hour.
 *
 * A minute is enough to break a scripted probe loop — the thing worth stopping —
 * and cheap for a human who tripped it by accident. The durable part of the
 * response is the error-level log and the audit entry, which is what "monitor
 * for injection attempts" actually asks for.
 */
const INJECTION_BLOCK_MS = Number(process.env.AGENT_INJECTION_BLOCK_MS) || 60_000;

/** profileId → number[] of call timestamps within the window */
const calls = new Map();
/** profileId → { count, firstAt, blockedUntil } */
const injections = new Map();

/** Drops entries no longer inside any window so the maps cannot grow forever. */
function sweep(now) {
  for (const [key, stamps] of calls) {
    const live = stamps.filter((t) => now - t < WINDOW_MS);
    if (live.length) calls.set(key, live);
    else calls.delete(key);
  }
  for (const [key, rec] of injections) {
    const expired = now - rec.firstAt > WINDOW_MS && (!rec.blockedUntil || rec.blockedUntil < now);
    if (expired) injections.delete(key);
  }
}

let lastSweep = 0;
function maybeSweep(now) {
  if (now - lastSweep > WINDOW_MS) {
    sweep(now);
    lastSweep = now;
  }
}

/**
 * Records one agent call and throws 429 when the actor is over their pace.
 *
 * Also enforces an active injection block, so a flagged actor cannot simply
 * keep sending messages and reading the refusals for information.
 */
export function checkAgentRate(profileId) {
  const key = String(profileId);
  const now = Date.now();
  maybeSweep(now);

  const flagged = injections.get(key);
  if (flagged?.blockedUntil && flagged.blockedUntil > now) {
    const seconds = Math.ceil((flagged.blockedUntil - now) / 1000);
    throw new AppError(
      `The assistant needs a moment before it can take more requests from this account. Please try again in ${seconds} second(s).`,
      429,
      [],
      'AGENT_TEMPORARILY_BLOCKED'
    );
  }

  const stamps = (calls.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= MAX_CALLS_PER_WINDOW) {
    logger.warn(`Agent rate limit hit by profile ${key} (${stamps.length} calls in ${WINDOW_MS}ms)`);
    throw new AppError(
      'You are sending messages faster than I can answer them. Please wait a moment and try again.',
      429,
      [],
      'AGENT_RATE_LIMITED'
    );
  }

  stamps.push(now);
  calls.set(key, stamps);
}

/**
 * Records a detected injection attempt.
 *
 * Returns `{ count, blocked }`. Individual attempts were already logged; what
 * was missing was any notion of *repetition*, which is the difference between
 * an unlucky phrase and somebody probing the surface. On reaching the strike
 * limit the assistant closes for that actor and the event is logged at error
 * level so it surfaces in monitoring rather than sitting in a warn stream
 * nobody reads.
 */
export function recordInjectionAttempt(profileId, { source = 'WEB' } = {}) {
  const key = String(profileId);
  const now = Date.now();
  maybeSweep(now);

  const rec = injections.get(key);
  const withinWindow = rec && now - rec.firstAt < WINDOW_MS;
  const next = withinWindow
    ? { ...rec, count: rec.count + 1 }
    : { count: 1, firstAt: now, blockedUntil: rec?.blockedUntil ?? null };

  if (next.count >= MAX_INJECTION_ATTEMPTS) {
    next.blockedUntil = now + INJECTION_BLOCK_MS;
    logger.error(
      `Repeated prompt-injection attempts (${next.count} in one minute) from profile ${key} via ${source} — agent surface cooling off for ${Math.round(INJECTION_BLOCK_MS / 1000)}s`
    );
  }

  injections.set(key, next);
  return { count: next.count, blocked: Boolean(next.blockedUntil && next.blockedUntil > now) };
}

/** Test/ops hook — clears all counters. */
export function resetAgentThrottle() {
  calls.clear();
  injections.clear();
  lastSweep = 0;
}
