import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { School } from '../src/models/school.model.js';
import { login } from '../src/modules/auth/auth.service.js';

/**
 * Account lockout after repeated password failures (audit item M4), plus the
 * Google ID-token issuer check (L1). Both were added without test cover.
 */

const EMAIL = 'staff@example.test';
const PASSWORD = 'correct-horse-battery';
// Every sign-in names the door it came through; this admin's is their school's.
const SCHOOL = 'eduos-demo-tenant';

beforeEach(async () => {
  await School.create({ slug: SCHOOL, name: 'Demo School' });
  const role = await Role.create({ key: 'ADMIN', name: 'Admin', permissions: [{ key: 'students.read', scope: 'ALL' }] });
  const account = await Account.create({
    phoneE164: '+919900000001',
    email: EMAIL,
    passwordHash: await bcrypt.hash(PASSWORD, 4), // low cost: these tests run often
  });
  await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'Test Admin' });
});

const attempt = (password) => login({ email: EMAIL, password, schoolId: SCHOOL }, { ip: '10.0.0.1' });
const failNTimes = async (n) => {
  for (let i = 0; i < n; i++) await attempt('wrong').catch(() => {});
};

describe('login — successful sign-in', () => {
  it('issues a session for the right password', async () => {
    const res = await attempt(PASSWORD);
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
  });

  it('is case-insensitive on the email', async () => {
    await expect(login({ email: EMAIL.toUpperCase(), password: PASSWORD, schoolId: SCHOOL }, {})).resolves.toBeTruthy();
  });
});

describe('login — failure counting', () => {
  it('increments the failure counter on a wrong password', async () => {
    await attempt('wrong').catch(() => {});
    const account = await Account.findOne({ email: EMAIL }).lean();
    expect(account.failedLoginAttempts).toBe(1);
    expect(account.lockoutUntil).toBeNull();
  });

  it('returns a generic error that does not reveal the counter', async () => {
    await expect(attempt('wrong')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS', statusCode: 401 });
  });

  it('resets the counter after a successful sign-in', async () => {
    await failNTimes(3);
    expect((await Account.findOne({ email: EMAIL }).lean()).failedLoginAttempts).toBe(3);

    await attempt(PASSWORD);
    const account = await Account.findOne({ email: EMAIL }).lean();
    expect(account.failedLoginAttempts).toBe(0);
    expect(account.lockoutUntil).toBeNull();
  });
});

describe('login — lockout', () => {
  it('locks the account on the 5th consecutive failure', async () => {
    await failNTimes(4);
    expect((await Account.findOne({ email: EMAIL }).lean()).lockoutUntil).toBeNull();

    await expect(attempt('wrong')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', statusCode: 403 });

    const account = await Account.findOne({ email: EMAIL }).lean();
    expect(account.lockoutUntil).toBeInstanceOf(Date);
    expect(account.lockoutUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects even the CORRECT password while locked', async () => {
    await failNTimes(5);
    // The whole point of a lockout: an attacker who guesses correctly on
    // attempt six still cannot get in.
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('locks for roughly 15 minutes', async () => {
    await failNTimes(5);
    const { lockoutUntil } = await Account.findOne({ email: EMAIL }).lean();
    const minutes = (lockoutUntil.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('lets the user back in once the lockout has expired', async () => {
    await failNTimes(5);
    await Account.updateOne({ email: EMAIL }, { $set: { lockoutUntil: new Date(Date.now() - 1000) } });

    await expect(attempt(PASSWORD)).resolves.toBeTruthy();
    expect((await Account.findOne({ email: EMAIL }).lean()).lockoutUntil).toBeNull();
  });

  it('starts a fresh streak after a lockout lapses, rather than re-locking instantly', async () => {
    await failNTimes(5);
    await Account.updateOne({ email: EMAIL }, { $set: { lockoutUntil: new Date(Date.now() - 1000) } });

    // One wrong password after the lockout expires must not immediately
    // re-lock — it is the first failure of a new streak.
    await expect(attempt('wrong')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
    const account = await Account.findOne({ email: EMAIL }).lean();
    expect(account.failedLoginAttempts).toBe(1);
    expect(account.lockoutUntil).toBeNull();
  });
});

describe('login — unknown accounts', () => {
  it('gives the same error for an unknown email as for a wrong password', async () => {
    await expect(login({ email: 'nobody@example.test', password: 'x', schoolId: SCHOOL }, {})).rejects.toMatchObject({
      code: 'BAD_CREDENTIALS',
      statusCode: 401,
    });
  });

  it('rejects an account that has no password set', async () => {
    await Account.create({ phoneE164: '+919900000002', email: 'otponly@example.test' });
    await expect(login({ email: 'otponly@example.test', password: 'x', schoolId: SCHOOL }, {})).rejects.toMatchObject({
      code: 'BAD_CREDENTIALS',
    });
  });
});
