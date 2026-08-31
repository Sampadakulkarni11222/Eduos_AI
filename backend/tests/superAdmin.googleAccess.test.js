import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { ensureSuperAdminAccount, requestEmailOtp } from '../src/modules/auth/auth.service.js';

/**
 * Provisioning the Super Admin from SUPER_ADMIN_EMAILS.
 *
 * This is the "Continue with Google" bootstrap: the operator puts an address in
 * the environment, and the first time Google hands us that verified address the
 * account and its SUPER_ADMIN profile come into being. The tests below pin down
 * the part that matters — that it happens for listed addresses and for nobody
 * else, and that it never disturbs an account that already exists.
 */

const LISTED = 'platform.owner@example.com';
const UNLISTED = 'someone.else@example.com';

let superAdminRoleId;
const originalEnv = process.env.SUPER_ADMIN_EMAILS;

beforeEach(async () => {
  process.env.SUPER_ADMIN_EMAILS = LISTED;
  for (const r of SYSTEM_ROLES) {
    const doc = await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
    if (r.key === 'SUPER_ADMIN') superAdminRoleId = doc._id;
  }
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = originalEnv;
});

const superAdminProfiles = () => Profile.find({ roleId: superAdminRoleId }).lean();

describe('who the allowlist provisions', () => {
  it('creates the account and the Super Admin profile for a listed address', async () => {
    const account = await ensureSuperAdminAccount(LISTED, 'Platform Owner');

    expect(account).not.toBeNull();
    expect(account.email).toBe(LISTED);
    const profiles = await superAdminProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ displayName: 'Platform Owner', status: 'ACTIVE' });
  });

  it('does nothing at all for an address that is not listed', async () => {
    expect(await ensureSuperAdminAccount(UNLISTED, 'Nobody')).toBeNull();
    expect(await Account.countDocuments({ email: UNLISTED })).toBe(0);
    expect(await superAdminProfiles()).toHaveLength(0);
  });

  it('matches case-insensitively and ignores surrounding whitespace in the list', async () => {
    process.env.SUPER_ADMIN_EMAILS = `  ${LISTED.toUpperCase()} , other@example.com `;
    const account = await ensureSuperAdminAccount(' Platform.Owner@Example.com ');
    expect(account?.email).toBe(LISTED);
  });

  it('falls back to the local part of the address when Google sends no name', async () => {
    await ensureSuperAdminAccount(LISTED);
    expect((await superAdminProfiles())[0].displayName).toBe('platform.owner');
  });

  it('gives the account a non-dialable placeholder phone that no real number can collide with', async () => {
    const account = await ensureSuperAdminAccount(LISTED);
    expect(account.phoneE164).toMatch(/^\+000\d{9}$/);
    // The E.164 rule every user-entered phone is validated against rejects it.
    expect(/^\+[1-9]\d{7,14}$/.test(account.phoneE164)).toBe(false);
  });

  it('is idempotent — a second sign-in adds nothing', async () => {
    const first = await ensureSuperAdminAccount(LISTED, 'Platform Owner');
    const second = await ensureSuperAdminAccount(LISTED, 'Platform Owner');

    expect(String(second._id)).toBe(String(first._id));
    expect(await Account.countDocuments({ email: LISTED })).toBe(1);
    expect(await superAdminProfiles()).toHaveLength(1);
  });

  it('does nothing when the SUPER_ADMIN role is missing from the database', async () => {
    await Role.deleteOne({ _id: superAdminRoleId });
    expect(await ensureSuperAdminAccount(LISTED, 'Platform Owner')).toBeNull();
    expect(await Account.countDocuments({ email: LISTED })).toBe(0);
  });
});

describe('what it does to an account that already exists', () => {
  let existing;

  beforeEach(async () => {
    existing = await Account.create({
      phoneE164: '+919876500001',
      email: LISTED,
      passwordHash: await bcrypt.hash('their-existing-password', 4),
    });
    const teacher = await Role.findOne({ key: 'TEACHER' });
    await Profile.create({ accountId: existing._id, roleId: teacher._id, displayName: 'Also A Teacher' });
  });

  it('attaches the profile without touching the phone, password or other profiles', async () => {
    const account = await ensureSuperAdminAccount(LISTED, 'Platform Owner');

    expect(String(account._id)).toBe(String(existing._id));
    expect(account.phoneE164).toBe('+919876500001');
    expect(await bcrypt.compare('their-existing-password', account.passwordHash)).toBe(true);
    expect(await Profile.countDocuments({ accountId: existing._id })).toBe(2);
  });

  it('reactivates a Super Admin profile that had been suspended', async () => {
    await ensureSuperAdminAccount(LISTED, 'Platform Owner');
    await Profile.updateOne({ roleId: superAdminRoleId }, { $set: { status: 'SUSPENDED' } });

    await ensureSuperAdminAccount(LISTED, 'Platform Owner');
    expect((await superAdminProfiles())[0].status).toBe('ACTIVE');
  });
});

describe('the sign-in path the Google button actually takes', () => {
  it('provisions a listed Super Admin who has never signed in before', async () => {
    const result = await requestEmailOtp({ email: LISTED });

    expect(result.devOtp).toBeTruthy();
    expect(await superAdminProfiles()).toHaveLength(1);
  });

  it('still refuses an unknown address that is not listed', async () => {
    await expect(requestEmailOtp({ email: UNLISTED })).rejects.toMatchObject({
      statusCode: 404,
      code: 'EMAIL_NOT_REGISTERED',
    });
    expect(await Account.countDocuments({})).toBe(0);
  });

  it('leaves the existing behaviour intact for an ordinary account', async () => {
    const teacher = await Role.findOne({ key: 'TEACHER' });
    const account = await Account.create({ phoneE164: '+919876500002', email: 'teacher@example.com' });
    await Profile.create({ accountId: account._id, roleId: teacher._id, displayName: 'A Teacher' });

    const result = await requestEmailOtp({ email: 'teacher@example.com' });
    expect(result.devOtp).toBeTruthy();
    // No stray Super Admin profile was created along the way.
    expect(await superAdminProfiles()).toHaveLength(0);
  });

  it('grants nothing when the allowlist is empty', async () => {
    delete process.env.SUPER_ADMIN_EMAILS;
    await expect(requestEmailOtp({ email: LISTED })).rejects.toMatchObject({ statusCode: 404 });
    expect(await superAdminProfiles()).toHaveLength(0);
  });
});
