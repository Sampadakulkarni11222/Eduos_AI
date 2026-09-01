import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { buildPermissionMap } from '../utils/buildPermissionMap.js';
import { Account } from '../models/account.model.js';
import { Profile } from '../models/profile.model.js';
import { School } from '../models/school.model.js';
import { runWithTenant, runAcrossSchools } from '../tenancy/tenantContext.js';

const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';

/**
 * Resolves which school the rest of the request runs against.
 *
 * A school-level actor gets exactly one answer: the school on their own
 * profile. The header is ignored for them, so it cannot be used to read
 * another school's data.
 *
 * A Super Admin is the only actor that can choose. `X-School-Id` names the
 * school it is acting on (that is how the console opens one school's
 * dashboards); with no header it runs across schools, which is what the
 * platform-level views need.
 */
async function applyTenantScope(req, profile, next) {
  if (!profile) return runAcrossSchools(next);

  if (profile.roleId?.key === SUPER_ADMIN_ROLE_KEY) {
    const requested = String(req.headers['x-school-id'] ?? req.query?.schoolId ?? '').trim().toLowerCase();
    if (!requested) return runAcrossSchools(next);

    const school = await School.findOne({ slug: requested }).lean();
    if (!school) throw new AppError(`No school with id "${requested}"`, 404, [], 'SCHOOL_NOT_FOUND');
    req.actor.actingSchoolId = school.slug;
    return runWithTenant(school.slug, next);
  }

  // Every school-level actor must name the school it belongs to. A profile
  // with no tenantId used to fall back to the demo school's label, which
  // quietly granted whoever held it a real school's data; a profile that has
  // lost its school is a broken record, not a demo user, so it is refused
  // here instead. Pre-migration profiles are unaffected: the schema defaults
  // tenantId, so they all carry one.
  const tenantId = String(profile.tenantId ?? '').trim();
  if (!tenantId) {
    throw new AppError(
      'This profile is not assigned to a school. Ask an administrator to assign one.',
      403, [], 'NO_SCHOOL_ASSIGNED',
    );
  }
  return runWithTenant(tenantId, next);
}

/**
 * Verifies the Bearer access token and loads the account.
 *
 * The token carries { accountId, profileId }. profileId is null for a
 * "pre-session" token (account has zero or multiple profiles and hasn't
 * called /auth/profile/select yet) — in that case req.actor.permissions is
 * an empty map, so requirePermission() naturally 403s on every permission-
 * gated route while /auth/profile/select, /profiles, /auth/logout (which
 * don't require a permission) still work.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('Authentication required', 401);
  }

  let payload;
  try {
    payload = verifyAccessToken(header.split(' ')[1]);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  const account = await Account.findById(payload.accountId);
  if (!account || account.status !== 'ACTIVE') {
    throw new AppError('Account not found or inactive', 401);
  }

  let profile = null;
  if (payload.profileId) {
    profile = await Profile.findOne({ _id: payload.profileId, deletedAt: null }).populate('roleId');
    if (!profile || profile.status !== 'ACTIVE') {
      throw new AppError('Profile not found or inactive', 401);
    }
  }

  req.actor = {
    accountId: account._id.toString(),
    phone: account.phoneE164,
    email: account.email,
    profileId: profile?._id?.toString() ?? null,
    displayName: profile?.displayName ?? null,
    roleId: profile?.roleId?._id?.toString() ?? null,
    roleKey: profile?.roleId?.key ?? null,
    permissions: profile ? buildPermissionMap(profile.roleId) : {},
    // The sign-in address this session came in through — a school slug, null
    // for the platform door, undefined for a session minted before doors
    // existed. Profile selection is confined to it (see auth.service.js).
    door: payload.door,
    // Request context, carried on the actor so the service layer can audit a
    // read without every service signature having to take `req`.
    ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    userAgent: req.headers['user-agent'] ?? null,
    // The school this request reads and writes. Every school-owned collection
    // is filtered by it — see src/tenancy/.
    tenantId: profile?.tenantId ?? null,
    tenantName: profile?.tenantName ?? null,
  };

  await applyTenantScope(req, profile, next);
});
