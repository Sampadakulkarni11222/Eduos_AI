'use client';
import { useSyncExternalStore } from 'react';
import { invalidateCache } from './cache';

/**
 * The school a platform administrator is currently looking at.
 *
 * A Super Admin belongs to no school, so every request they make runs across
 * all of them by default. Opening one school from the console sets this, and
 * from then on `X-School-Id` rides on every API call — the header the backend
 * already honours for a Super Admin and ignores for everyone else
 * (see backend middleware/auth.js, applyTenantScope).
 *
 * It is a *view*, not an authority: a school-level account cannot widen its
 * reach by setting this, because the backend derives their school from their
 * own profile and never reads the header for them.
 *
 * Stored per tab. A school admin never has one, and it is dropped on sign-out
 * and whenever the platform-wide console is opened, so a cross-school screen
 * can never be quietly narrowed to a single school.
 */

export interface ActingSchool {
  slug: string;
  name: string;
}

const KEY = 'eduos.actingSchool';

let current: ActingSchool | null | undefined;
const listeners = new Set<() => void>();

function read(): ActingSchool | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActingSchool) : null;
  } catch {
    return null;
  }
}

/** The school in view, or null when acting across the whole platform. */
export function getActingSchool(): ActingSchool | null {
  if (current === undefined) current = read();
  return current;
}

/**
 * Switches the school in view.
 *
 * The read cache is dropped on every switch: its keys are request paths, which
 * say nothing about which school answered them, so keeping it would show one
 * school's rows under another's name.
 */
export function setActingSchool(school: ActingSchool | null) {
  const before = getActingSchool();
  if (before?.slug === school?.slug) return;

  current = school;
  try {
    if (school) sessionStorage.setItem(KEY, JSON.stringify(school));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the switch still holds for this page's lifetime.
  }
  invalidateCache();
  listeners.forEach((fn) => fn());
}

export const clearActingSchool = () => setActingSchool(null);

/**
 * The school-wide portals a platform administrator may open a school through.
 *
 * Each is an aggregation over a whole school, and the backend's own role gates
 * on those endpoints already list SUPER_ADMIN. The per-person portals
 * (teacher, student, parent) are deliberately absent: each is one signed-in
 * person's own classes, record or children, so there is nothing there for a
 * platform actor to look at.
 */
export const PLATFORM_VIEW_PORTALS = ['admin', 'principal', 'finance', 'librarian', 'warden'];

/**
 * Whether this page is a platform administrator looking at one school.
 *
 * A Super Admin holds every permission and belongs to no school, so the usual
 * portal test — your role owns this portal, and this is your school — would
 * bounce them out of the very screens the console sends them to. What stands
 * in for it: the school they opened is the school in the URL, and the portal
 * is one that spans a whole school. Everyone else fails the first check, so
 * this can never widen a school account's reach.
 */
export function platformViewAllowed({
  role,
  actingSlug,
  urlSlug,
  portalSlug,
}: {
  role: string | null | undefined;
  /** The school the console opened, if any. */
  actingSlug: string | null | undefined;
  /** The school segment of the current URL. */
  urlSlug: string | null | undefined;
  /** The portal this page belongs to (`admin`, `finance`, …). */
  portalSlug: string;
}): boolean {
  if (role !== 'SUPER_ADMIN') return false;
  if (!actingSlug || actingSlug !== urlSlug) return false;
  return PLATFORM_VIEW_PORTALS.includes(portalSlug);
}

/** Re-renders a component when the school in view changes. */
export function useActingSchool(): ActingSchool | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getActingSchool,
    () => null,
  );
}
