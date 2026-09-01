'use client';
import type { PublicSchoolDto } from './types';

/**
 * The school whose door someone came in through.
 *
 * `/oakridge` and `/nvmp` are the same login screen pointed at different
 * schools. The slug is remembered for the tab so the branding survives a
 * reload and so sign-in can refuse an account that belongs elsewhere.
 *
 * It is a convenience, never an authority: the backend derives the acting
 * school from the signed-in profile, so editing this changes what the page
 * says, not what any API returns.
 */
const KEY = 'eduos.school';

export function setActiveSchool(school: PublicSchoolDto) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(school));
  } catch {
    // Private mode or blocked storage — the page still works, unbranded.
  }
}

export function getActiveSchool(): PublicSchoolDto | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PublicSchoolDto) : null;
  } catch {
    return null;
  }
}

export function clearActiveSchool() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
