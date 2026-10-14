/**
 * What a school's slug may be.
 *
 * The slug is the first segment of the school's portal URL (`/oakridge`), and
 * the portal has routes of its own at that level. A static route wins over the
 * `[school]` segment, so a school given one of these names would exist in the
 * database and be unreachable in the browser: its address would open the
 * platform sign-in, the school finder or a folder of icons instead.
 *
 * Keep this list in step with the top-level folders of frontend/src/app and
 * with RESERVED in frontend/src/lib/school-lookup.ts.
 */
export const SCHOOL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const RESERVED_SCHOOL_SLUGS = Object.freeze([
  'api',
  'find-school',
  'icons',
  'login',
  'public',
  'select-profile',
  'super-admin',
]);

export function isReservedSchoolSlug(slug) {
  return RESERVED_SCHOOL_SLUGS.includes(String(slug ?? '').trim().toLowerCase());
}
