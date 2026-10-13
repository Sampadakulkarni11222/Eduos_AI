import { ApiError, api } from './api';
import type { PublicSchoolDto } from './types';

/**
 * Finding a school's sign-in door from its code.
 *
 * An installed app opens at one address for every school, so someone has to be
 * able to get from there to `/oakridge` without already knowing it is a URL.
 * This resolves what they type against the same public endpoint the door
 * itself uses (`GET /schools/public/:slug`), which answers with a school's
 * name and branding only, and only for an exact, active slug.
 *
 * Deliberately a lookup and not a search: there is no endpoint that lists or
 * matches schools by name, and adding one would publish the platform's
 * customer list to anyone who asked. A person is given their school's code the
 * same way they are given its address today.
 *
 * None of this is access control. It only chooses which sign-in screen to
 * show; the backend still refuses an account at the wrong door and serves a
 * profile its own school's data whatever address was used.
 */

/** Mirrors SLUG_RE in the backend's schools/school.service.js. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * First path segments that are the app's own routes, never a school. The slug
 * rule alone would accept these, and looking one up would only produce a
 * confusing "no such school" for what is really a mistyped address.
 */
export const RESERVED: ReadonlySet<string> = new Set(['login', 'select-profile', 'super-admin', 'public', 'api', 'find-school', 'icons']);

export type SchoolCode = { ok: true; slug: string } | { ok: false; message: string };

const INVALID =
  'Enter the school code from your school — letters, numbers and hyphens, like "oakridge".';

/**
 * Turns what was typed into a school slug.
 *
 * Accepts the bare code, or the school's link pasted whole (`…/oakridge` or
 * `…/oakridge/student`), since a link is what most people are actually sent.
 */
export function parseSchoolCode(input: string): SchoolCode {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return { ok: false, message: 'Enter your school code.' };

  if (value.includes('/')) {
    // A pasted address: the school is its first path segment.
    const path = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[?#].*$/, '');
    const segments = path.split('/').filter(Boolean);
    // With a scheme, or a first part that reads as a hostname, segment 0 is
    // the host. Anything else dotted ("../admin") is not a host to skip over.
    const hasHost =
      /^[a-z][a-z0-9+.-]*:\/\//.test(value) ||
      /^([a-z0-9-]+(\.[a-z0-9-]+)+|localhost)(:\d+)?$/.test(segments[0] ?? '');
    value = (hasHost ? segments[1] : segments[0]) ?? '';
    if (!value) {
      return { ok: false, message: 'That link does not name a school. Enter the school code instead.' };
    }
  }

  if (!SLUG_RE.test(value) || RESERVED.has(value)) return { ok: false, message: INVALID };
  return { ok: true, slug: value };
}

export type SchoolLookup =
  | { status: 'found'; school: PublicSchoolDto }
  | { status: 'not-found' | 'unavailable' | 'error'; message: string };

/** Resolves a validated slug. Never throws: every outcome is one the screen can show. */
export async function lookupSchool(slug: string): Promise<SchoolLookup> {
  try {
    return { status: 'found', school: await api.publicSchool(slug) };
  } catch (x) {
    if (x instanceof ApiError) {
      if (x.status === 404 || x.status === 400) {
        return { status: 'not-found', message: `No school uses the code "${slug}". Check it with your school and try again.` };
      }
      if (x.status === 403) {
        return { status: 'unavailable', message: 'This school is not available right now. Please contact your school administrator.' };
      }
      if (x.status === 429) {
        return { status: 'error', message: 'Too many attempts. Please wait a few minutes and try again.' };
      }
      return { status: 'error', message: 'Something went wrong while looking up your school. Please try again.' };
    }
    return { status: 'error', message: 'Cannot reach the server. Check your connection and try again.' };
  }
}

/**
 * The school this device last opened, so the app can go straight to its door.
 *
 * Only the slug, and only a convenience: it is re-resolved against the server
 * every time it is used, and it grants nothing.
 */
const LAST_SCHOOL_KEY = 'eduos.lastSchool';

export function rememberSchool(slug: string) {
  try {
    localStorage.setItem(LAST_SCHOOL_KEY, slug);
  } catch {
    // Private mode or blocked storage — the finder simply asks again next time.
  }
}

export function recallSchool(): string | null {
  try {
    const slug = localStorage.getItem(LAST_SCHOOL_KEY);
    return slug && SLUG_RE.test(slug) && !RESERVED.has(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** Forgets the remembered school; with a slug, only if that is the one remembered. */
export function forgetSchool(slug?: string) {
  try {
    if (slug && localStorage.getItem(LAST_SCHOOL_KEY) !== slug) return;
    localStorage.removeItem(LAST_SCHOOL_KEY);
  } catch {
    /* nothing to forget */
  }
}
