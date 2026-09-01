import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { School } from '../src/models/school.model.js';
import { verifyAccessToken } from '../src/utils/jwt.js';
import {
  requestEmailOtp, verifyEmailOtp, requestOtp, login, selectProfile, refresh,
} from '../src/modules/auth/auth.service.js';

/**
 * Which door admits which account.
 *
 *   /oakridge  — accounts with a profile in Oakridge, and nobody else.
 *   /nvmp      — accounts with a profile in NVMP, and nobody else.
 *   /          — the platform sign-in. Platform administrators only.
 *
 * Before this, any registered address could sign in at any school's address:
 * the door was checked in the browser after a session had already been issued,
 * so an Oakridge account entering at /nvmp got a working session and its own
 * school's records. The rules below are enforced server-side, where the browser
 * cannot skip them.
 */

const PASSWORD = 'correct-horse-battery';
const OAK = { slug: 'oakridge', name: 'Oakridge International' };
const NVMP = { slug: 'nvmp', name: 'NVMP School' };

const OAK_EMAIL = 'teacher@oakridge.test';
const NVMP_EMAIL = 'teacher@nvmp.test';
const PLATFORM_EMAIL = 'owner@platform.test';
const BOTH_EMAIL = 'both@example.test';

let roles;

/** An account with one profile per (school, role) pair given. */
async function makeAccount(email, phone, profiles) {
  const account = await Account.create({
    email, phoneE164: phone, passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
  for (const { role, school } of profiles) {
    await Profile.create({
      accountId: account._id,
      roleId: roles[role],
      displayName: email,
      ...(school && { tenantId: school.slug, tenantName: school.name }),
    });
  }
  return account;
}

beforeEach(async () => {
  await School.create([OAK, NVMP]);
  roles = {};
  for (const key of ['TEACHER', 'ADMIN', 'PARENT', 'SUPER_ADMIN']) {
    roles[key] = (await Role.create({ key, name: key, permissions: [] }))._id;
  }

  await makeAccount(OAK_EMAIL, '+919800000001', [{ role: 'TEACHER', school: OAK }]);
  await makeAccount(NVMP_EMAIL, '+919800000002', [{ role: 'TEACHER', school: NVMP }]);
  await makeAccount(PLATFORM_EMAIL, '+919800000003', [{ role: 'SUPER_ADMIN', school: null }]);
});

const signIn = (email, schoolId) => login({ email, password: PASSWORD, schoolId }, {});

describe("a school's door admits only that school's accounts", () => {
  it('lets an Oakridge account in at /oakridge', async () => {
    const session = await signIn(OAK_EMAIL, 'oakridge');
    expect(session.accessToken).toBeTruthy();
    expect(session.profile.tenantId).toBe('oakridge');
  });

  it('refuses an Oakridge account at /nvmp', async () => {
    await expect(signIn(OAK_EMAIL, 'nvmp')).rejects.toMatchObject({
      code: 'WRONG_DOOR',
      statusCode: 403,
    });
  });

  it('names the door they should have used, once the password proved who they are', async () => {
    await expect(signIn(OAK_EMAIL, 'nvmp')).rejects.toMatchObject({
      message: expect.stringContaining('/oakridge'),
    });
  });

  it('refuses an NVMP account at /oakridge', async () => {
    await expect(signIn(NVMP_EMAIL, 'oakridge')).rejects.toMatchObject({ code: 'WRONG_DOOR' });
  });

  it('turns a platform administrator away from a school door', async () => {
    await expect(signIn(PLATFORM_EMAIL, 'oakridge')).rejects.toMatchObject({ code: 'WRONG_DOOR' });
  });

  it('rejects a school that does not exist rather than treating it as the platform', async () => {
    await expect(signIn(OAK_EMAIL, 'no-such-school')).rejects.toMatchObject({
      code: 'SCHOOL_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('refuses a suspended school outright', async () => {
    await School.updateOne({ slug: 'oakridge' }, { $set: { status: 'SUSPENDED' } });
    await expect(signIn(OAK_EMAIL, 'oakridge')).rejects.toMatchObject({ code: 'SCHOOL_SUSPENDED' });
  });
});

describe('the platform door admits platform administrators only', () => {
  it('lets a Super Admin in', async () => {
    const session = await signIn(PLATFORM_EMAIL, null);
    expect(session.profile.role).toBe('SUPER_ADMIN');
  });

  it('refuses a school account — omitting the school is not a way past the check', async () => {
    await expect(signIn(OAK_EMAIL, null)).rejects.toMatchObject({
      code: 'WRONG_DOOR',
      statusCode: 403,
    });
  });

  it('points a school account at its own address', async () => {
    await expect(signIn(OAK_EMAIL, null)).rejects.toMatchObject({
      message: expect.stringContaining('/oakridge'),
    });
  });
});

describe('no code is issued to an account the door will not admit', () => {
  it('refuses the email OTP request before sending anything', async () => {
    await expect(requestEmailOtp({ email: OAK_EMAIL, schoolId: 'nvmp' })).rejects.toMatchObject({
      code: 'WRONG_DOOR',
    });
  });

  it('refuses the phone OTP request too', async () => {
    await expect(requestOtp({ phone: '+919800000001', schoolId: 'nvmp' })).rejects.toMatchObject({
      code: 'WRONG_DOOR',
    });
  });

  it('does not name the other school before the code has been checked', async () => {
    // Anyone can type an address into a login form; where its owner works is
    // not something to hand out for the asking.
    await expect(requestEmailOtp({ email: OAK_EMAIL, schoolId: 'nvmp' })).rejects.toMatchObject({
      message: expect.not.stringContaining('oakridge'),
    });
  });

  it('still admits the account at its own door', async () => {
    const { devOtp } = await requestEmailOtp({ email: OAK_EMAIL, schoolId: 'oakridge' });
    const session = await verifyEmailOtp({ email: OAK_EMAIL, code: devOtp, schoolId: 'oakridge' }, {});
    expect(session.profile.tenantId).toBe('oakridge');
  });

  it('refuses the verify step as well, in case a code was obtained elsewhere', async () => {
    const { devOtp } = await requestEmailOtp({ email: OAK_EMAIL, schoolId: 'oakridge' });
    await expect(
      verifyEmailOtp({ email: OAK_EMAIL, code: devOtp, schoolId: 'nvmp' }, {})
    ).rejects.toMatchObject({ code: 'WRONG_DOOR' });
  });
});

describe('an account holding profiles in two schools', () => {
  let both;

  beforeEach(async () => {
    both = await makeAccount(BOTH_EMAIL, '+919800000004', [
      { role: 'TEACHER', school: OAK },
      { role: 'ADMIN', school: NVMP },
    ]);
  });

  it('sees only the door’s own profile, not a choice between schools', async () => {
    const session = await signIn(BOTH_EMAIL, 'oakridge');
    expect(session.requiresProfileSelection).toBeUndefined();
    expect(session.profile.tenantId).toBe('oakridge');
  });

  it('gets the other school’s profile at the other door', async () => {
    const session = await signIn(BOTH_EMAIL, 'nvmp');
    expect(session.profile.tenantId).toBe('nvmp');
  });

  it('cannot select the other school’s profile by naming its id', async () => {
    const session = await signIn(BOTH_EMAIL, 'oakridge');
    const nvmpProfile = await Profile.findOne({ accountId: both._id, tenantId: 'nvmp' });

    await expect(
      selectProfile({ accountId: both._id.toString(), door: 'oakridge' }, nvmpProfile._id, {})
    ).rejects.toMatchObject({ code: 'WRONG_DOOR' });
    expect(session.profile.tenantId).toBe('oakridge');
  });

  it('offers a choice only among profiles the door admits', async () => {
    // A second Oakridge profile on the same account: now there is a real
    // choice to make, and NVMP's profile is not part of it. It has to be a
    // different role from the NVMP one — an account holds each role once.
    await Profile.create({
      accountId: both._id, roleId: roles.PARENT, displayName: 'Oak Parent',
      tenantId: OAK.slug, tenantName: OAK.name,
    });

    const session = await signIn(BOTH_EMAIL, 'oakridge');
    expect(session.requiresProfileSelection).toBe(true);
    expect(session.profiles.map((p) => p.tenantId)).toEqual(['oakridge', 'oakridge']);
  });
});

describe('the door travels with the session', () => {
  it('is stamped on the access token', async () => {
    const session = await signIn(OAK_EMAIL, 'oakridge');
    expect(verifyAccessToken(session.accessToken).door).toBe('oakridge');
  });

  it('survives a refresh, so a rotated token is pinned to the same door', async () => {
    const session = await signIn(OAK_EMAIL, 'oakridge');
    const rotated = await refresh(session.refreshToken, {});
    expect(verifyAccessToken(rotated.accessToken).door).toBe('oakridge');
  });

  it('records the platform door as null rather than leaving it unset', async () => {
    const session = await signIn(PLATFORM_EMAIL, null);
    expect(verifyAccessToken(session.accessToken).door).toBeNull();
  });
});
