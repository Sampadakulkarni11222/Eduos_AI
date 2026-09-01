import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { School } from '../../models/school.model.js';
import { RefreshToken } from '../../models/refreshToken.model.js';
import { OtpCode } from '../../models/otpCode.model.js';
import { AppError } from '../../utils/AppError.js';
import { signAccessToken } from '../../utils/jwt.js';
import { generateOtp, hashOtp, compareOtp } from '../../utils/otp.js';
import { generateRefreshToken, hashRefreshToken } from '../../utils/refreshToken.js';
import { buildPermissionMap } from '../../utils/buildPermissionMap.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
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

const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';

/**
 * The sign-in address a request came through — the "door".
 *
 *   a school slug  — that school's own front door (`/oakridge`, `/nvmp`).
 *   null           — the platform door (`/`), for platform administrators.
 *   undefined      — no door was named. Only sessions minted before doors
 *                    existed are in this state; they stay unrestricted so a
 *                    live session is not cut off mid-flight.
 *
 * A door decides which of an account's profiles may be used, and every token
 * carries it, so the decision holds for the life of the session (profile
 * switching and refreshes included) rather than only at the moment of sign-in.
 */
async function resolveDoor(schoolId) {
  const slug = String(schoolId ?? '').trim().toLowerCase();
  if (!slug) return null;

  const school = await School.findOne({ slug }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');
  if (school.status !== 'ACTIVE') {
    throw new AppError(`${school.name} is not active on this platform.`, 403, [], 'SCHOOL_SUSPENDED');
  }
  return school.slug;
}

/** The profiles on an account that the given door admits. */
function admittedProfiles(profiles, door) {
  if (door === undefined) return profiles;
  return profiles.filter((profile) => {
    const isSuperAdmin = profile.roleId?.key === SUPER_ADMIN_ROLE_KEY;
    if (door === null) return isSuperAdmin;
    return !isSuperAdmin && String(profile.tenantId ?? '').trim() === door;
  });
}

/**
 * Turned away at this door.
 *
 * `reveal` is false before identity has been proved (the OTP-request step),
 * where naming the school an address belongs to would tell anyone who can
 * guess an email where its owner studies or works. Once a code or password has
 * been verified the account is the person's own, so the message names the door
 * they should have used instead of leaving them stuck.
 */
function wrongDoorError(door, profiles, { reveal }) {
  const elsewhere = profiles.find((p) => p.roleId?.key !== SUPER_ADMIN_ROLE_KEY && p.tenantId);

  if (door === null) {
    const hint = reveal && elsewhere ? ` Sign in at /${elsewhere.tenantId} instead.` : '';
    return new AppError(
      `This sign-in is for platform administrators only.${hint}`,
      403, [], 'WRONG_DOOR',
    );
  }

  const isPlatformAdmin = profiles.some((p) => p.roleId?.key === SUPER_ADMIN_ROLE_KEY);
  let hint = '';
  if (reveal && elsewhere) hint = ` Sign in at /${elsewhere.tenantId} instead.`;
  else if (reveal && isPlatformAdmin) hint = ' Platform administrators sign in at the main address.';

  return new AppError(`This account is not part of this school.${hint}`, 403, [], 'WRONG_DOOR');
}

/** Every profile an account can act as, newest first. */
const activeProfiles = (accountId) =>
  Profile.find({ accountId, status: 'ACTIVE', deletedAt: null })
    .sort({ createdAt: -1 })
    .populate('roleId');

/**
 * Refuses an account that this door does not admit, before an OTP is issued.
 * The code is worth withholding on its own: sending one implies the address
 * belongs here, and delivering codes to people who could never sign in is
 * cost with no purpose.
 */
async function assertDoorAdmits(account, door) {
  const profiles = await activeProfiles(account._id);
  if (admittedProfiles(profiles, door).length === 0) {
    throw wrongDoorError(door, profiles, { reveal: false });
  }
}

async function issueSession(account, { profileId = null, door, userAgent, ip } = {}) {
  const accessToken = signAccessToken({
    accountId: account._id.toString(),
    profileId,
    ...(door !== undefined && { door }),
  });
  const refreshToken = generateRefreshToken();

  await RefreshToken.create({
    accountId: account._id,
    tokenHash: hashRefreshToken(refreshToken),
    profileId,
    ...(door !== undefined && { door }),
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
 * Only the profiles this door admits are considered, so an account holding
 * profiles in two schools sees exactly the one it came in for — and an account
 * with none here cannot start a session at all.
 *
 * - Exactly one profile -> always auto-select, full session.
 * - Zero profiles -> always an error, regardless of MULTI_PROFILE_ENABLED.
 * - Multiple profiles:
 *     MULTI_PROFILE_ENABLED=true  (default) -> pre-session (profileId: null),
 *       client must call /auth/profile/select.
 *     MULTI_PROFILE_ENABLED=false -> auto-select the most recently created
 *       profile and issue a full session immediately, skipping selection.
 */
async function resolveSession(account, opts, door) {
  const all = await activeProfiles(account._id);

  if (all.length === 0) {
    throw new AppError('No profiles are linked to this account yet. Contact your school admin.', 403);
  }

  const profiles = admittedProfiles(all, door);
  if (profiles.length === 0) {
    throw wrongDoorError(door, all, { reveal: true });
  }

  if (profiles.length === 1 || !env.MULTI_PROFILE_ENABLED) {
    const profile = profiles[0];
    const session = await issueSession(account, { profileId: profile._id, door, ...opts });
    return {
      ...session,
      profile: toProfileSummary(profile),
      permissions: buildPermissionMap(profile.roleId),
      ...(profiles.length > 1 && { autoSelected: true }),
    };
  }

  const session = await issueSession(account, { profileId: null, door, ...opts });
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

export async function requestOtp({ phone, schoolId }) {
  const door = await resolveDoor(schoolId);
  const account = await Account.findOne({ phoneE164: phone });
  // Phone accounts are pre-provisioned by the school too — auto-creating a
  // blank account here just produced a code that led nowhere (the account
  // has no profile, so verifyOtp would still dead-end at "no profiles linked
  // to this account"). Same fix as email: reject up front instead.
  if (!account) {
    throw new AppError('This phone number is not registered.', 404, [], 'PHONE_NOT_REGISTERED');
  }
  await assertDoorAdmits(account, door);

  const code = await issueOtpForAccount(account);
  const { delivered, devOtp } = await sendOtpSms(phone, code);
  if (!delivered && env.isProd) {
    throw new AppError('SMS delivery is not configured. Contact your administrator.', 503, [], 'OTP_DELIVERY_UNAVAILABLE');
  }

  return { message: 'OTP sent', devOtp };
}

export async function verifyOtp({ phone, code, schoolId }, opts) {
  const door = await resolveDoor(schoolId);
  const account = await Account.findOne({ phoneE164: phone });
  if (!account) throw new AppError('Invalid phone or code', 401, [], 'OTP_WRONG');

  await consumeOtp(account, code);
  return resolveSession(account, opts, door);
}


/**
 * A stable, deliberately non-dialable stand-in for the required phone number
 * on an account provisioned from an email address alone.
 *
 * `+000…` cannot collide with a real number (no country code starts with 0)
 * and is rejected by the E.164 validation every user-entered phone passes, so
 * it can never clash with an account someone creates by hand. Deriving it from
 * the email keeps re-provisioning the same address idempotent.
 */
function placeholderPhoneFor(email) {
  const digits = BigInt(`0x${createHash('sha256').update(email).digest('hex').slice(0, 12)}`) % 1_000_000_000n;
  return `+000${String(digits).padStart(9, '0')}`;
}

/**
 * Provisions the Super Admin named by SUPER_ADMIN_EMAILS.
 *
 * Called only from the sign-in paths behind a Google account, and only for an
 * address the operator has put in the environment. Any other address falls
 * through untouched, so this cannot create an account for anyone else, and it
 * grants nothing beyond the SUPER_ADMIN profile.
 *
 * Idempotent: an existing account keeps its phone, password and other profiles
 * and simply gains the Super Admin profile if it lacks one.
 */
export async function ensureSuperAdminAccount(email, name) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !env.SUPER_ADMIN_EMAILS.includes(normalized)) return null;

  const role = await Role.findOne({ key: SUPER_ADMIN_ROLE_KEY });
  if (!role) {
    // The boot sequence upserts this role, so its absence means the process is
    // running against a database an older build owns. Say so rather than
    // failing the sign-in with something unrelated.
    logger.error(`${SUPER_ADMIN_ROLE_KEY} role is missing — cannot provision ${normalized}`);
    return null;
  }

  let account = await Account.findOne({ email: normalized });
  if (!account) {
    account = await Account.create({
      email: normalized,
      phoneE164: placeholderPhoneFor(normalized),
    });
    logger.warn(`Provisioned Super Admin account for ${normalized} (listed in SUPER_ADMIN_EMAILS)`);
  }

  const existing = await Profile.findOne({ accountId: account._id, roleId: role._id });
  if (!existing) {
    await Profile.create({
      accountId: account._id,
      roleId: role._id,
      displayName: name?.trim() || normalized.split('@')[0],
    });
    logger.warn(`Granted the Super Admin profile to ${normalized} (listed in SUPER_ADMIN_EMAILS)`);
  } else if (existing.status !== 'ACTIVE' || existing.deletedAt) {
    // Re-listing a suspended address in the environment is how an operator
    // recovers from locking themselves out.
    existing.status = 'ACTIVE';
    existing.deletedAt = null;
    await existing.save();
    logger.warn(`Reactivated the Super Admin profile for ${normalized}`);
  }

  return account;
}

export async function requestEmailOtp({ email, schoolId }) {
  const door = await resolveDoor(schoolId);
  const normalized = email?.trim().toLowerCase();
  // The Google sign-in demo signs in through this path, so a Super Admin
  // listed in the environment is provisioned here too. No-op for every other
  // address, which still gets the 404 below.
  await ensureSuperAdminAccount(normalized);
  const account = await Account.findOne({ email: normalized });
  // Email accounts are pre-provisioned (never self-registered like phone), so
  // an unrecognized email is always a typo or an unlisted address — tell the
  // user up front rather than sending them to an OTP screen that can never
  // receive a code.
  if (!account) {
    throw new AppError('This email is not registered.', 404, [], 'EMAIL_NOT_REGISTERED');
  }
  await assertDoorAdmits(account, door);

  const code = await issueOtpForAccount(account);
  const { delivered, devOtp } = await sendOtpEmail(normalized, code);
  if (!delivered && env.isProd) {
    throw new AppError('Email delivery is not configured. Contact your administrator.', 503, [], 'OTP_DELIVERY_UNAVAILABLE');
  }

  return { message: 'OTP sent', devOtp };
}

export async function verifyEmailOtp({ email, code, schoolId }, opts) {
  const door = await resolveDoor(schoolId);
  const account = await Account.findOne({ email: email?.trim().toLowerCase() });
  if (!account) throw new AppError('That code is incorrect', 401, [], 'OTP_WRONG');

  await consumeOtp(account, code);
  return resolveSession(account, opts, door);
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
export async function googleLogin({ idToken, schoolId }, opts) {
  const door = await resolveDoor(schoolId);
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

  // Google has verified this address belongs to the person signing in, so an
  // operator listing it in SUPER_ADMIN_EMAILS is enough to provision it.
  await ensureSuperAdminAccount(payload.email, payload.name);

  const account = await Account.findOne({ email: payload.email?.toLowerCase() });
  if (!account) {
    throw new AppError('No EduOS account is linked to this Google account.', 404, [], 'USER_NOT_FOUND');
  }
  if (account.status !== 'ACTIVE') throw new AppError('Account is inactive', 403);

  return resolveSession(account, opts, door);
}

// Password brute-force ceiling. After MAX_FAILED_LOGINS consecutive wrong
// passwords the account stops accepting *any* password for LOCKOUT_MINUTES,
// so an attacker can't walk a dictionary against a known email address.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export async function login({ email, password, schoolId }, opts) {
  const door = await resolveDoor(schoolId);
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

  return resolveSession(account, opts, door);
}

export async function selectProfile(actor, profileId, opts) {
  const profile = await Profile.findOne({
    _id: profileId,
    accountId: actor.accountId,
    status: 'ACTIVE',
    deletedAt: null,
  }).populate('roleId');
  if (!profile) throw new AppError('Profile not found', 404);

  // The door is carried on the token, so an account that holds profiles in two
  // schools cannot select the other school's one by naming its id here — the
  // selection is confined to the address it signed in at.
  if (admittedProfiles([profile], actor.door).length === 0) {
    throw wrongDoorError(actor.door, [profile], { reveal: true });
  }

  const account = await Account.findById(actor.accountId);
  const session = await issueSession(account, { profileId: profile._id, door: actor.door, ...opts });

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

  return issueSession(account, { profileId: stored.profileId, door: stored.door, ...opts });
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

  // A profile belongs to the school the request is acting on. Without this it
  // would fall back to the schema default and land in no school anyone uses,
  // so an admin creating a teacher would create one nobody's portal can see.
  const tenantId = currentTenantId();
  const school = tenantId ? await School.findOne({ slug: tenantId }).select('slug name').lean() : null;

  const profile = await Profile.create({
    accountId: account._id,
    roleId: role._id,
    displayName: name,
    // The acting school wins even if its School record cannot be read here;
    // falling through to the schema default would file the new user under the
    // demo school, i.e. outside the school that just created them.
    ...(tenantId && { tenantId, tenantName: school?.name ?? tenantId }),
  });
  return { account, profile };
}
