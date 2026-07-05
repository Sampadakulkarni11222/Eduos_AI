import bcrypt from 'bcryptjs';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { RefreshToken } from '../../models/refreshToken.model.js';
import { OtpCode } from '../../models/otpCode.model.js';
import { AppError } from '../../utils/AppError.js';
import { signAccessToken } from '../../utils/jwt.js';
import { generateOtp, hashOtp } from '../../utils/otp.js';
import { generateRefreshToken, hashRefreshToken } from '../../utils/refreshToken.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

const toProfileSummary = (profile) => ({
  id: profile._id,
  displayName: profile.displayName,
  avatarUrl: profile.avatarUrl,
  role: profile.roleId?.key,
  tenantId: profile.tenantId || 'eduos-demo-tenant',
  tenantName: profile.tenantName || 'EduOS AI Academy',
});

async function issueSession(account, { profileId = null, userAgent, ip } = {}) {
  const accessToken = signAccessToken({ accountId: account._id.toString(), profileId });
  const refreshToken = generateRefreshToken();

  await RefreshToken.create({
    accountId: account._id,
    tokenHash: hashRefreshToken(refreshToken),
    profileId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    userAgent,
    ip,
  });

  return { accessToken, refreshToken };
}

/**
 * After an account proves identity (OTP or password), resolve which profile
 * the session should act as.
 *
 * - Exactly one profile -> always auto-select, full session.
 * - Zero profiles -> always an error, regardless of MULTI_PROFILE_ENABLED.
 * - Multiple profiles:
 *     MULTI_PROFILE_ENABLED=true  (default) -> pre-session (profileId: null),
 *       client must call /auth/profile/select.
 *     MULTI_PROFILE_ENABLED=false -> auto-select the most recently created
 *       profile and issue a full session immediately, skipping selection.
 */
async function resolveSession(account, opts) {
  const profiles = await Profile.find({ accountId: account._id, status: 'ACTIVE', deletedAt: null })
    .sort({ createdAt: -1 })
    .populate('roleId');

  if (profiles.length === 0) {
    throw new AppError('No profiles are linked to this account yet. Contact your school admin.', 403);
  }

  if (profiles.length === 1 || !env.MULTI_PROFILE_ENABLED) {
    const profile = profiles[0];
    const session = await issueSession(account, { profileId: profile._id, ...opts });
    return {
      ...session,
      profile: toProfileSummary(profile),
      permissions: buildPermissionMap(profile.roleId),
      ...(profiles.length > 1 && { autoSelected: true }),
    };
  }

  const session = await issueSession(account, { profileId: null, ...opts });
  return {
    ...session,
    requiresProfileSelection: true,
    profiles: profiles.map(toProfileSummary),
  };
}

export async function requestOtp({ phone }) {
  let account = await Account.findOne({ phoneE164: phone });
  if (!account) account = await Account.create({ phoneE164: phone });

  const code = generateOtp();
  await OtpCode.create({
    accountId: account._id,
    codeHash: hashOtp(code),
    purpose: 'LOGIN',
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
  });

  // STAND-IN: no SMS gateway configured. A real implementation would call
  // an SMS provider here instead of logging. devOtp is only ever returned
  // outside production so the flow can be exercised end-to-end in tests.
  logger.info(`OTP for ${phone}: ${code} (stand-in — no SMS provider configured)`);

  return {
    message: 'OTP sent',
    devOtp: env.isProd ? undefined : code,
  };
}

export async function verifyOtp({ phone, code }, opts) {
  const account = await Account.findOne({ phoneE164: phone });
  if (!account) throw new AppError('Invalid phone or code', 401);

  const otp = await OtpCode.findOne({ accountId: account._id, purpose: 'LOGIN', consumedAt: null }).sort({ createdAt: -1 });
  if (!otp) throw new AppError('No OTP requested, or it was already used', 401);
  if (otp.expiresAt < new Date()) throw new AppError('OTP expired, request a new one', 401);
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw new AppError('Too many attempts, request a new OTP', 429);

  if (otp.codeHash !== hashOtp(code)) {
    otp.attempts += 1;
    await otp.save();
    throw new AppError('Invalid phone or code', 401);
  }

  otp.consumedAt = new Date();
  await otp.save();

  return resolveSession(account, opts);
}

export async function login({ email, password }, opts) {
  const account = await Account.findOne({ email: email?.toLowerCase() });
  if (!account || !account.passwordHash) throw new AppError('Invalid email or password', 401);

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) throw new AppError('Invalid email or password', 401);
  if (account.status !== 'ACTIVE') throw new AppError('Account is inactive', 403);

  return resolveSession(account, opts);
}

export async function selectProfile(actor, profileId, opts) {
  const profile = await Profile.findOne({
    _id: profileId,
    accountId: actor.accountId,
    status: 'ACTIVE',
    deletedAt: null,
  }).populate('roleId');
  if (!profile) throw new AppError('Profile not found', 404);

  const account = await Account.findById(actor.accountId);
  const session = await issueSession(account, { profileId: profile._id, ...opts });

  return {
    ...session,
    profile: toProfileSummary(profile),
    permissions: buildPermissionMap(profile.roleId),
  };
}

export async function refresh(refreshTokenValue, opts) {
  const tokenHash = hashRefreshToken(refreshTokenValue);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  stored.revokedAt = new Date();
  await stored.save();

  const account = await Account.findById(stored.accountId);
  if (!account) throw new AppError('Account not found', 401);

  return issueSession(account, { profileId: stored.profileId, ...opts });
}

export async function logout(actor, refreshTokenValue) {
  if (refreshTokenValue) {
    await RefreshToken.updateOne(
      { tokenHash: hashRefreshToken(refreshTokenValue), accountId: actor.accountId },
      { revokedAt: new Date() }
    );
  } else {
    // No specific token given -> revoke every active session on this account
    await RefreshToken.updateMany(
      { accountId: actor.accountId, revokedAt: null },
      { revokedAt: new Date() }
    );
  }
}

export async function me(actor) {
  if (!actor.profileId) throw new AppError('Select a profile first', 403);

  const [account, profile] = await Promise.all([
    Account.findById(actor.accountId),
    Profile.findById(actor.profileId).populate('roleId'),
  ]);
  if (!account || !profile) throw new AppError('Profile not found', 404);

  return {
    accountId: account._id,
    phone: account.phoneE164,
    email: account.email,
    profile: toProfileSummary(profile),
    permissions: buildPermissionMap(profile.roleId),
  };
}

/**
 * Admin-driven onboarding: attach a new role-bound profile to an account
 * (creating the account if it doesn't exist yet). One phone number can hold
 * several profiles — e.g. call this twice with PARENT then TEACHER.
 */
export async function register({ name, phone, email, password, roleKey }) {
  const role = await Role.findOne({ key: roleKey?.toUpperCase() });
  if (!role) throw new AppError(`Unknown role: ${roleKey}`, 400);

  let account = await Account.findOne({ phoneE164: phone });
  if (!account) {
    const passwordHash = password ? await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS) : null;
    account = await Account.create({ phoneE164: phone, email, passwordHash });
  } else if (password && !account.passwordHash) {
    account.passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
    await account.save();
  }

  const existing = await Profile.findOne({ accountId: account._id, roleId: role._id });
  if (existing) throw new AppError('This account already has a profile with that role', 409);

  const profile = await Profile.create({ accountId: account._id, roleId: role._id, displayName: name });
  return { account, profile };
}
