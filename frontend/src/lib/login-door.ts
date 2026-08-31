import type { RoleKey } from './types';

/**
 * Which sign-in screen an account is allowed to use.
 *
 * The platform has two kinds of door and each admits one kind of person:
 *
 *   /            the platform. Super Admins only.
 *   /oakridge    that school. Only accounts belonging to it.
 *
 * This is not what keeps a school's data private — the backend does that, by
 * serving a profile its own school's rows whatever address was used. It is
 * what stops someone landing in a portal that looks broken, and tells them
 * which address is theirs.
 */

export interface DoorVerdict {
  ok: boolean;
  /** Why they were turned away. */
  message?: string;
  /** The door they should have used. */
  goTo?: { href: string; label: string };
  /** Where to send them when they are admitted. */
  destination?: 'platform' | 'school';
}

export function checkDoor({
  doorSchoolSlug,
  doorSchoolName,
  role,
  ownSchoolSlug,
}: {
  /** The school whose door this is; null at the platform sign-in. */
  doorSchoolSlug: string | null;
  doorSchoolName?: string | null;
  role: RoleKey | null | undefined;
  /** The school on the signed-in profile. */
  ownSchoolSlug: string | null | undefined;
}): DoorVerdict {
  const isSuperAdmin = role === 'SUPER_ADMIN';

  if (doorSchoolSlug) {
    if (isSuperAdmin) {
      return {
        ok: false,
        message: 'Platform administrators sign in at the main address, not at a school.',
        goTo: { href: '/login', label: 'Go to the platform sign-in' },
      };
    }
    if (ownSchoolSlug && ownSchoolSlug !== doorSchoolSlug) {
      return {
        ok: false,
        message: `This account is not part of ${doorSchoolName ?? doorSchoolSlug}.`,
        goTo: { href: `/${ownSchoolSlug}`, label: `Sign in at /${ownSchoolSlug} instead` },
      };
    }
    return { ok: true, destination: 'school' };
  }

  if (!isSuperAdmin) {
    return {
      ok: false,
      message: "This is the platform sign-in. Use your school's address instead.",
      goTo: ownSchoolSlug ? { href: `/${ownSchoolSlug}`, label: `Sign in at /${ownSchoolSlug}` } : undefined,
    };
  }

  return { ok: true, destination: 'platform' };
}
