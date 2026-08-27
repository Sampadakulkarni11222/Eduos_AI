import bcrypt from 'bcryptjs';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { RefreshToken } from '../../models/refreshToken.model.js';
import { OtpCode } from '../../models/otpCode.model.js';
import { AppError } from '../../utils/AppError.js';
import { signAccessToken } from '../../utils/jwt.js';
import { generateOtp, hashOtp, compareOtp } from '../../utils/otp.js';
import { generateRefreshToken, hashRefreshToken } from '../../utils/refreshToken.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { sendOtpSms, sendOtpEmail } from '../../providers/notification.provider.js';
import { CircuitBreaker } from '../../utils/circuitBreaker.js';


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

// Per-account ceiling on OTP issuance. The IP rate limiter alone doesn't stop
// a distributed attacker from flooding one victim's phone/inbox with codes
// (and running up SMS cost) — this caps it at the account level too.
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MINUTES = 15;

async function issueOtpForAccount(account, purpose = 'LOGIN') {
  const since = new Date(Date.now() - OTP_WINDOW_MINUTES * 60 * 1000);
  const recent = await OtpCode.countDocuments({
    accountId: account._id,
    purpose,
    createdAt: { $gte: since },
  });
  if (recent >= OTP_MAX_PER_WINDOW) {
    throw new AppError(
      'Too many codes requested. Please wait a few minutes before trying again.',
      429,
      [],
      'OTP_THROTTLED'
    );
  }

  const code = generateOtp();
  await OtpCode.create({
    accountId: account._id,
    codeHash: await hashOtp(code),
    purpose,
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
  });
  return code;
}

async function consumeOtp(account, code, purpose = 'LOGIN') {
  const otp = await OtpCode.findOne({ accountId: account._id, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (!otp) throw new AppError('No OTP requested, or it was already used', 401, [], 'OTP_NOT_FOUND');
  if (otp.expiresAt < new Date()) throw new AppError('OTP expired, request a new one', 401, [], 'OTP_EXPIRED');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw new AppError('Too many attempts, request a new OTP', 429, [], 'OTP_LOCKED');

  if (!(await compareOtp(code, otp.codeHash))) {
    otp.attempts += 1;
    await otp.save();
    throw new AppError('That code is incorrect', 401, [], 'OTP_WRONG');
  }

  otp.consumedAt = new Date();
  await otp.save();
}

export async function requestOtp({ phone }) {
  const account = await Account.findOne({ phoneE164: phone });
  // Phone accounts are pre-provisioned by the school too — auto-creating a
  // blank account here just produced a code that led nowhere (the account
  // has no profile, so verifyOtp would still dead-end at "no profiles linked
  // to this account"). Same fix as email: reject up front instead.
  if (!account) {
    throw new AppError('This phone number is not registered.', 404, [], 'PHONE_NOT_REGISTERED');
  }

  const code = await issueOtpForAccount(account);
  const { delivered, devOtp } = await sendOtpSms(phone, code);
  if (!delivered && env.isProd) {
    throw new AppError('SMS delivery is not configured. Contact your administrator.', 503, [], 'OTP_DELIVERY_UNAVAILABLE');
  }

  return { message: 'OTP sent', devOtp };
}

export async function verifyOtp({ phone, code }, opts) {
  const account = await Account.findOne({ phoneE164: phone });
  if (!account) throw new AppError('Invalid phone or code', 401, [], 'OTP_WRONG');

  await consumeOtp(account, code);
  return resolveSession(account, opts);
}

export async function requestEmailOtp({ email }) {
  const normalized = email?.trim().toLowerCase();
  const account = await Account.findOne({ email: normalized });
  // Email accounts are pre-provisioned (never self-registered like phone), so
  // an unrecognized email is always a typo or an unlisted address — tell the
  // user up front rather than sending them to an OTP screen that can never
  // receive a code.
  if (!account) {
    throw new AppError('This email is not registered.', 404, [], 'EMAIL_NOT_REGISTERED');
  }

  const code = await issueOtpForAccount(account);
  const { delivered, devOtp } = await sendOtpEmail(normalized, code);
  if (!delivered && env.isProd) {
    throw new AppError('Email delivery is not configured. Contact your administrator.', 503, [], 'OTP_DELIVERY_UNAVAILABLE');
  }

  return { message: 'OTP sent', devOtp };
}

export async function verifyEmailOtp({ email, code }, opts) {
  const account = await Account.findOne({ email: email?.trim().toLowerCase() });
  if (!account) throw new AppError('That code is incorrect', 401, [], 'OTP_WRONG');

  await consumeOtp(account, code);
  return resolveSession(account, opts);
}

// Google mints ID tokens under either spelling of the issuer claim.
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const googleAuthCircuitBreaker = new CircuitBreaker('google-auth', {
  failureThreshold: 3,
  cooldownPeriod: 10000,
  timeoutMs: 3000
});

/**
 * Google Sign-In.
 * Verifies the Google ID token server-side (signature + issuer + audience via
 * Google's tokeninfo endpoint), then signs the matching EduOS account in.
 * Accounts are never auto-created from Google — sign-in only.
 */
export async function googleLogin({ idToken }, opts) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError('Google sign-in is not configured on this server.', 501, [], 'GOOGLE_NOT_CONFIGURED');
  }
  if (!idToken) throw new AppError('idToken is required', 400);

  let payload;
  try {
    payload = await googleAuthCircuitBreaker.execute(async () => {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) throw new Error(`tokeninfo status ${res.status}`);
      return await res.json();
    });
  } catch (err) {
    logger.warn(`Google token verification failed: ${err.message}`);
    throw new AppError('Could not verify Google sign-in', 401, [], 'GOOGLE_TOKEN_INVALID');
  }

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new AppError('Google token was not issued by Google', 401, [], 'GOOGLE_TOKEN_INVALID');
  }
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new AppError('Google token was issued for a different application', 401, [], 'GOOGLE_TOKEN_INVALID');
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw new AppError('Google account email is not verified', 401, [], 'GOOGLE_EMAIL_UNVERIFIED');
  }

  const account = await Account.findOne({ email: payload.email?.toLowerCase() });
  if (!account) {
    throw new AppError('No EduOS account is linked to this Google account.', 404, [], 'USER_NOT_FOUND');
  }
  if (account.status !== 'ACTIVE') throw new AppError('Account is inactive', 403);

  return resolveSession(account, opts);
}

// Password brute-force ceiling. After MAX_FAILED_LOGINS consecutive wrong
// passwords the account stops accepting *any* password for LOCKOUT_MINUTES,
// so an attacker can't walk a dictionary against a known email address.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export async function login({ email, password }, opts) {
  const account = await Account.findOne({ email: email?.toLowerCase() });
  if (!account || !account.passwordHash) throw new AppError('Invalid email or password', 401, [], 'BAD_CREDENTIALS');

  if (account.lockoutUntil && account.lockoutUntil > new Date()) {
    const minutesLeft = Math.ceil((account.lockoutUntil - Date.now()) / 60000);
    throw new AppError(
      `Too many failed sign-in attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
      403,
      [],
      'ACCOUNT_LOCKED'
    );
  }

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) {
    // A lapsed lockout counts as a clean slate: this failure starts a new streak.
    const attempts = account.lockoutUntil ? 1 : account.failedLoginAttempts + 1;
    const locked = attempts >= MAX_FAILED_LOGINS;
    account.failedLoginAttempts = locked ? 0 : attempts;
    account.lockoutUntil = locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await account.save();

    if (locked) {
      logger.warn(`Account ${account._id} locked after ${MAX_FAILED_LOGINS} failed sign-ins (ip: ${opts?.ip ?? 'unknown'})`);
      throw new AppError(
        `Too many failed sign-in attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        403,
        [],
        'ACCOUNT_LOCKED'
      );
    }
    throw new AppError('Invalid email or password', 401, [], 'BAD_CREDENTIALS');
  }
  if (account.status !== 'ACTIVE') throw new AppError('Account is inactive', 403);

  if (account.failedLoginAttempts !== 0 || account.lockoutUntil) {
    account.failedLoginAttempts = 0;
    account.lockoutUntil = null;
    await account.save();
  }

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

  if (!stored) throw new AppError('Invalid or expired refresh token', 401);

  // Reuse detection: tokens rotate on every refresh, so a *revoked* token being
  // presented again means either a stolen token is being replayed or the real
  // user's token was stolen and already used. We can't tell which, so we end
  // every session on the account and force a fresh sign-in.
  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { accountId: stored.accountId, revokedAt: null },
      { revokedAt: new Date() }
    );
    logger.warn(
      `Refresh token reuse detected for account ${stored.accountId} (ip: ${opts?.ip ?? 'unknown'}) — all sessions revoked`
    );
    throw new AppError('Session expired, please sign in again', 401, [], 'REFRESH_REUSE_DETECTED');
  }

  if (stored.expiresAt < new Date()) {
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
