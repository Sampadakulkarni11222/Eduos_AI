import { describe, it, expect } from 'vitest';
import { checkDoor } from '@/lib/login-door';

/**
 * Who each sign-in screen admits.
 *
 *   /            the platform — Super Admins only
 *   /oakridge    that school  — only accounts belonging to it
 *
 * Isolation itself is the backend's job; this decides which door works, and
 * makes sure someone turned away is told where to go instead.
 */

const platform = { doorSchoolSlug: null };
const oakridgeDoor = { doorSchoolSlug: 'oakridge', doorSchoolName: 'Oakridge Academy' };

describe('the platform door at /', () => {
  it('admits a Super Admin and sends them to the platform console', () => {
    expect(checkDoor({ ...platform, role: 'SUPER_ADMIN', ownSchoolSlug: null }))
      .toMatchObject({ ok: true, destination: 'platform' });
  });

  it.each(['ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'] as const)(
    'turns a %s away',
    (role) => {
      const verdict = checkDoor({ ...platform, role, ownSchoolSlug: 'oakridge' });
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toMatch(/platform sign-in/i);
    },
  );

  it('names the school address the person should use instead', () => {
    const verdict = checkDoor({ ...platform, role: 'TEACHER', ownSchoolSlug: 'nvmp' });
    expect(verdict.goTo).toEqual({ href: '/nvmp', label: 'Sign in at /nvmp' });
  });

  it('still refuses when the account has no school to point at', () => {
    const verdict = checkDoor({ ...platform, role: 'ADMIN', ownSchoolSlug: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.goTo).toBeUndefined();
  });
});

describe("a school's door at /oakridge", () => {
  it('admits that school’s own people', () => {
    expect(checkDoor({ ...oakridgeDoor, role: 'ADMIN', ownSchoolSlug: 'oakridge' }))
      .toMatchObject({ ok: true, destination: 'school' });
    expect(checkDoor({ ...oakridgeDoor, role: 'STUDENT', ownSchoolSlug: 'oakridge' }).ok).toBe(true);
  });

  it('turns away an account from another school, by name', () => {
    const verdict = checkDoor({ ...oakridgeDoor, role: 'ADMIN', ownSchoolSlug: 'nvmp' });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe('This account is not part of Oakridge Academy.');
    expect(verdict.goTo).toEqual({ href: '/nvmp', label: 'Sign in at /nvmp instead' });
  });

  it('turns a Super Admin away — the platform has its own address', () => {
    const verdict = checkDoor({ ...oakridgeDoor, role: 'SUPER_ADMIN', ownSchoolSlug: 'oakridge' });
    expect(verdict.ok).toBe(false);
    expect(verdict.goTo).toEqual({ href: '/login', label: 'Go to the platform sign-in' });
  });

  it('is symmetric — NVMP refuses an Oakridge account too', () => {
    const verdict = checkDoor({
      doorSchoolSlug: 'nvmp', doorSchoolName: 'NVMP School',
      role: 'TEACHER', ownSchoolSlug: 'oakridge',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe('This account is not part of NVMP School.');
    expect(verdict.goTo?.href).toBe('/oakridge');
  });

  it('admits a profile that has no school recorded, rather than stranding it', () => {
    // Pre-migration profiles carry no tenant. The backend still scopes them;
    // refusing here would lock them out of the only door they have.
    expect(checkDoor({ ...oakridgeDoor, role: 'TEACHER', ownSchoolSlug: null }).ok).toBe(true);
  });
});
