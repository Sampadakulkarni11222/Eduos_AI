'use client';
import { useEffect, useRef, useState } from 'react';
import { renewSession } from './api';

/**
 * Keeps an in-use session alive, and ends an unused one.
 *
 * Two separate problems, previously both unhandled, which is why an active
 * student was being sent back to the sign-in page every quarter of an hour:
 *
 *   Renewal. The access token lives 15 minutes and was only ever replaced
 *     after something had already failed with a 401 — and only for calls that
 *     went through the API client. A page that sat open (a timetable, a
 *     report card) made no calls, so nothing triggered the repair, and the
 *     next navigation found a session that had quietly lapsed. The fix is to
 *     renew on a timer while the person is actually here, comfortably before
 *     expiry. The token's lifetime is untouched; what changed is that it is
 *     now replaced on time.
 *
 *   Inactivity. A session that nobody is using should end, which is a
 *     different question from whether the token has expired. That is measured
 *     here from real interaction, and only that ends the session.
 *
 * Renewal is deliberately gated on recent activity: an abandoned tab must not
 * keep itself signed in forever by refreshing in the background.
 */

/** Minutes of no interaction before the session is ended. */
const INACTIVITY_MINUTES = clampMinutes(process.env.NEXT_PUBLIC_INACTIVITY_MINUTES, 10, 1, 120);
/** How long before the cut-off the warning appears. */
const WARNING_SECONDS = 60;
/**
 * How often to renew, in minutes. Must stay comfortably under the backend's
 * ACCESS_TOKEN_EXPIRES_IN (15m) so a renewal lands well before expiry, and
 * comfortably over it would mean lengthening the token — which is exactly what
 * this must not do.
 */
const RENEW_EVERY_MINUTES = 10;
/** Resolution of the inactivity check. */
const TICK_MS = 15_000;

function clampMinutes(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Events that count as "the person is here".
 *
 * `mousemove` is included but throttled to one update per tick, because
 * writing a timestamp on every pixel of movement is a lot of work to record
 * something a single write already records.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'] as const;

export interface SessionActivityState {
  /** Seconds left before sign-out, once inside the warning window. */
  secondsUntilSignOut: number | null;
  /** Call from the warning's "Stay signed in" button. */
  keepAlive: () => void;
}

export function useSessionActivity(
  active: boolean,
  onIdleSignOut: () => void,
): SessionActivityState {
  const lastActivity = useRef(Date.now());
  const lastRenew = useRef(Date.now());
  const signedOut = useRef(false);
  const onIdle = useRef(onIdleSignOut);
  const [secondsUntilSignOut, setSecondsUntilSignOut] = useState<number | null>(null);

  // Held in a ref so changing the callback does not tear down the listeners
  // and reset the idle clock with it.
  useEffect(() => { onIdle.current = onIdleSignOut; }, [onIdleSignOut]);

  useEffect(() => {
    if (!active) return;

    signedOut.current = false;
    lastActivity.current = Date.now();
    lastRenew.current = Date.now();

    let lastWrite = 0;
    const mark = () => {
      const now = Date.now();
      if (now - lastWrite < 1000) return; // throttle: one write a second is plenty
      lastWrite = now;
      lastActivity.current = now;
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, mark, { passive: true });
    }

    // Coming back to the tab is itself activity, and is also the moment the
    // token is most likely to have lapsed while the tab was hidden.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      mark();
      void maybeRenew(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    const idleMs = INACTIVITY_MINUTES * 60 * 1000;
    const renewMs = RENEW_EVERY_MINUTES * 60 * 1000;

    async function maybeRenew(force = false) {
      const now = Date.now();
      // Never renew for someone who has already gone: that would keep an
      // abandoned tab signed in indefinitely, which is the opposite of an
      // inactivity policy.
      if (now - lastActivity.current > idleMs) return;
      if (!force && now - lastRenew.current < renewMs) return;

      // Set before awaiting, so a slow renewal cannot be started twice — the
      // API client de-duplicates concurrent refreshes too, and between them
      // there is no path to a refresh loop.
      lastRenew.current = now;
      const ok = await renewSession();
      if (!ok) {
        // The session is genuinely gone (revoked, or the refresh token
        // expired). Nothing is retried — retrying a dead session is the loop
        // this is written to avoid.
        endSession();
      }
    }

    function endSession() {
      if (signedOut.current) return;
      signedOut.current = true;
      setSecondsUntilSignOut(null);
      onIdle.current();
    }

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;

      if (idleFor >= idleMs) {
        endSession();
        return;
      }

      const remaining = Math.ceil((idleMs - idleFor) / 1000);
      setSecondsUntilSignOut(remaining <= WARNING_SECONDS ? remaining : null);

      void maybeRenew();
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, mark);
    };
  }, [active]);

  return {
    secondsUntilSignOut,
    keepAlive: () => {
      lastActivity.current = Date.now();
      setSecondsUntilSignOut(null);
      void renewSession();
    },
  };
}

export const INACTIVITY_POLICY_MINUTES = INACTIVITY_MINUTES;
