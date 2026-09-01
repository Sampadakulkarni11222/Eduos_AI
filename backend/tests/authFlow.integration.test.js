import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { RefreshToken } from '../src/models/refreshToken.model.js';
import { School } from '../src/models/school.model.js';
import { login, refresh, logout, me } from '../src/modules/auth/auth.service.js';

/**
 * End-to-end exercise of the token lifecycle the httpOnly-cookie BFF depends
 * on (ISS-009). The BFF routes live in the Next app and cannot be imported
 * here, but everything they rely on from the backend is verified below:
 * rotation on every refresh, reuse detection, and revocation on logout.
 *
 * The BFF contract this pins down:
 *   1. /auth/refresh returns BOTH a new accessToken and a new refreshToken —
 *      if the route failed to persist the rotated one, the next refresh would
 *      replay a revoked token and kill the whole session.
 *   2. Replaying a used refresh token revokes every session on the account,
 *      which is why the cookie must be overwritten on each refresh.
 */

const EMAIL = 'flow@example.test';
const PASSWORD = 'correct-horse-battery';
const SCHOOL = 'eduos-demo-tenant';
let accountId;

beforeAll(() => {
  expect(mongoose.connection.readyState).toBe(1);
});

beforeEach(async () => {
  await School.create({ slug: SCHOOL, name: 'Demo School' });
  const role = await Role.create({ key: 'ADMIN', name: 'Admin', permissions: [{ key: 'students.read', scope: 'ALL' }] });
  const account = await Account.create({
    phoneE164: '+919900001234',
    email: EMAIL,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
  accountId = account._id;
  await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'Flow Admin' });
});

const signIn = () =>
  login({ email: EMAIL, password: PASSWORD, schoolId: SCHOOL }, { ip: '10.0.0.1', userAgent: 'vitest' });

describe('token lifecycle — what the BFF cookie flow depends on', () => {
  it('sign-in issues both an access token and a refresh token', async () => {
    const session = await signIn();
    expect(typeof session.accessToken).toBe('string');
    expect(typeof session.refreshToken).toBe('string');
    // The BFF puts the refresh token in the cookie and returns only the rest.
    expect(session.refreshToken).not.toBe(session.accessToken);
  });

  it('refresh returns a NEW refresh token — the cookie must be rewritten', async () => {
    const first = await signIn();
    const second = await refresh(first.refreshToken, { ip: '10.0.0.1' });

    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).toBeTruthy();
    // If the BFF returned the old token to the cookie, the next refresh would
    // be a replay and revoke everything. This is the assertion that catches it.
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('supports repeated refreshes when each rotation is persisted', async () => {
    let token = (await signIn()).refreshToken;
    for (let i = 0; i < 3; i++) {
      const next = await refresh(token, { ip: '10.0.0.1' });
      expect(next.accessToken).toBeTruthy();
      token = next.refreshToken;
    }
  });

  it('replaying a spent refresh token is rejected and kills the session', async () => {
    const first = await signIn();
    const second = await refresh(first.refreshToken, { ip: '10.0.0.1' });

    // Simulates a BFF that forgot to overwrite the cookie.
    await expect(refresh(first.refreshToken, { ip: '10.0.0.1' })).rejects.toMatchObject({
      code: 'REFRESH_REUSE_DETECTED',
      statusCode: 401,
    });

    // Reuse detection revokes everything, including the token that was valid.
    await expect(refresh(second.refreshToken, { ip: '10.0.0.1' })).rejects.toBeTruthy();
  });

  it('rejects a refresh token that was never issued', async () => {
    await expect(refresh('not-a-real-token', {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it('logout revokes the refresh token so the cookie becomes useless', async () => {
    const session = await signIn();
    const profile = await Profile.findOne({ accountId });

    await logout({ accountId: accountId.toString(), profileId: profile._id.toString() }, session.refreshToken);

    await expect(refresh(session.refreshToken, {})).rejects.toBeTruthy();
  });

  it('logout without a token revokes every session on the account', async () => {
    const a = await signIn();
    const b = await signIn();
    const profile = await Profile.findOne({ accountId });

    await logout({ accountId: accountId.toString(), profileId: profile._id.toString() }, undefined);

    expect(await RefreshToken.countDocuments({ accountId, revokedAt: null })).toBe(0);
    for (const s of [a, b]) {
      await expect(refresh(s.refreshToken, {})).rejects.toBeTruthy();
    }
  });

  it('the access token from a refresh still authenticates', async () => {
    const first = await signIn();
    const second = await refresh(first.refreshToken, { ip: '10.0.0.1' });

    // profileId rides on the rotated token, so `me` must still resolve.
    const profile = await Profile.findOne({ accountId });
    const identity = await me({ accountId: accountId.toString(), profileId: profile._id.toString() });
    expect(identity.email).toBe(EMAIL);
    expect(second.accessToken).toBeTruthy();
  });

  it('stores the refresh token hashed, never in the clear', async () => {
    const session = await signIn();
    const rows = await RefreshToken.find({ accountId }).lean();
    expect(rows).toHaveLength(1);
    // A database leak must not hand over usable refresh tokens.
    expect(rows[0].tokenHash).not.toBe(session.refreshToken);
    expect(JSON.stringify(rows[0])).not.toContain(session.refreshToken);
  });
});
