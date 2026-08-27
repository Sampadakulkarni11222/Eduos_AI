import { describe, it, expect, beforeEach } from 'vitest';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { OtpCode } from '../src/models/otpCode.model.js';
import { env } from '../src/config/env.js';
import { compareOtp } from '../src/utils/otp.js';
import {
  requestOtp, verifyOtp, requestEmailOtp, verifyEmailOtp,
} from '../src/modules/auth/auth.service.js';

/**
 * OTP issuance and verification.
 * Covers the salted-hash change (audit item M6) and the per-account issuance
 * ceiling, both of which were shipped without tests.
 */

const PHONE = '+919812345678';
const EMAIL = 'otp@example.test';
let accountId;

beforeEach(async () => {
  const role = await Role.create({ key: 'PARENT', name: 'Parent', permissions: [] });
  const account = await Account.create({ phoneE164: PHONE, email: EMAIL });
  accountId = account._id;
  await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'OTP Parent' });
});

/** The console provider hands the code back so a dev flow can complete. */
const issue = async () => (await requestOtp({ phone: PHONE })).devOtp;

describe('OTP issuance', () => {
  it('issues a six-digit numeric code', async () => {
    const code = await issue();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('rejects an unregistered phone rather than creating a dead account', async () => {
    await expect(requestOtp({ phone: '+910000000000' })).rejects.toMatchObject({
      code: 'PHONE_NOT_REGISTERED',
      statusCode: 404,
    });
    expect(await Account.countDocuments({})).toBe(1);
  });

  it('rejects an unregistered email', async () => {
    await expect(requestEmailOtp({ email: 'nobody@example.test' })).rejects.toMatchObject({
      code: 'EMAIL_NOT_REGISTERED',
    });
  });

  it('normalises the email before lookup', async () => {
    await expect(requestEmailOtp({ email: '  OTP@Example.TEST ' })).resolves.toBeTruthy();
  });
});

describe('OTP storage — audit item M6, salted hashing', () => {
  it('never stores the code in the clear', async () => {
    const code = await issue();
    const row = await OtpCode.findOne({ accountId }).lean();
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).not.toContain(code);
  });

  it('stores a bcrypt hash, not an unsalted digest', async () => {
    await issue();
    const row = await OtpCode.findOne({ accountId }).lean();
    // A bcrypt hash carries its own salt in the string; a sha256 hex digest
    // (the old scheme) would be 64 plain hex characters.
    expect(row.codeHash).toMatch(/^\$2[aby]\$/);
    expect(row.codeHash).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('salts each code separately, so identical codes hash differently', async () => {
    const a = await import('../src/utils/otp.js');
    const [h1, h2] = await Promise.all([a.hashOtp('123456'), a.hashOtp('123456')]);
    expect(h1).not.toBe(h2);
    expect(await compareOtp('123456', h1)).toBe(true);
    expect(await compareOtp('123456', h2)).toBe(true);
  });
});

describe('OTP verification', () => {
  it('signs in with the correct code', async () => {
    const code = await issue();
    const session = await verifyOtp({ phone: PHONE, code }, {});
    expect(session.accessToken).toBeTruthy();
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await issue();
    await expect(verifyOtp({ phone: PHONE, code: '000000' }, {})).rejects.toMatchObject({ code: 'OTP_WRONG' });
    expect((await OtpCode.findOne({ accountId }).lean()).attempts).toBe(1);
  });

  it('locks the code after OTP_MAX_ATTEMPTS wrong guesses', async () => {
    await issue();
    for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) {
      await verifyOtp({ phone: PHONE, code: '000000' }, {}).catch(() => {});
    }
    await expect(verifyOtp({ phone: PHONE, code: '000000' }, {})).rejects.toMatchObject({
      code: 'OTP_LOCKED',
      statusCode: 429,
    });
  });

  it('a locked code cannot be redeemed even if the guess is then correct', async () => {
    const code = await issue();
    for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) {
      await verifyOtp({ phone: PHONE, code: '000000' }, {}).catch(() => {});
    }
    await expect(verifyOtp({ phone: PHONE, code }, {})).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('rejects an expired code', async () => {
    const code = await issue();
    await OtpCode.updateOne({ accountId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyOtp({ phone: PHONE, code }, {})).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('cannot reuse a code once consumed', async () => {
    const code = await issue();
    await verifyOtp({ phone: PHONE, code }, {});
    await expect(verifyOtp({ phone: PHONE, code }, {})).rejects.toMatchObject({ code: 'OTP_NOT_FOUND' });
  });

  it('errors when no code was ever requested', async () => {
    await expect(verifyOtp({ phone: PHONE, code: '123456' }, {})).rejects.toMatchObject({
      code: 'OTP_NOT_FOUND',
    });
  });

  it('gives an unknown phone the same generic failure as a wrong code', async () => {
    await expect(verifyOtp({ phone: '+910000000000', code: '123456' }, {})).rejects.toMatchObject({
      code: 'OTP_WRONG',
      statusCode: 401,
    });
  });

  it('verifies the email OTP flow end to end', async () => {
    const { devOtp } = await requestEmailOtp({ email: EMAIL });
    const session = await verifyEmailOtp({ email: EMAIL, code: devOtp }, {});
    expect(session.accessToken).toBeTruthy();
  });
});

describe('OTP throttling — per-account issuance ceiling', () => {
  it('allows up to five codes in the window', async () => {
    for (let i = 0; i < 5; i++) await expect(issue()).resolves.toMatch(/^\d{6}$/);
  });

  it('refuses the sixth request in the window', async () => {
    for (let i = 0; i < 5; i++) await issue();
    await expect(requestOtp({ phone: PHONE })).rejects.toMatchObject({
      code: 'OTP_THROTTLED',
      statusCode: 429,
    });
  });

  it('counts email and phone codes against the same account ceiling', async () => {
    // The limiter is per account+purpose, and both flows use purpose LOGIN —
    // otherwise an attacker just alternates channels to double the cap.
    for (let i = 0; i < 5; i++) await issue();
    await expect(requestEmailOtp({ email: EMAIL })).rejects.toMatchObject({ code: 'OTP_THROTTLED' });
  });

  it('lets issuance resume once older codes fall outside the window', async () => {
    for (let i = 0; i < 5; i++) await issue();
    const oldEnough = new Date(Date.now() - 16 * 60 * 1000);
    // Through the raw driver: Mongoose marks `createdAt` immutable, so a
    // model-level $set on it is silently dropped.
    await OtpCode.collection.updateMany({ accountId }, { $set: { createdAt: oldEnough } });
    await expect(issue()).resolves.toMatch(/^\d{6}$/);
  });
});
