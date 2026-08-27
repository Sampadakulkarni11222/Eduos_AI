import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { buildPermissionMap } from '../utils/buildPermissionMap.js';
import { Account } from '../models/account.model.js';
import { Profile } from '../models/profile.model.js';

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
    // Request context, carried on the actor so the service layer can audit a
    // read without every service signature having to take `req`.
    ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    userAgent: req.headers['user-agent'] ?? null,
  };

  next();
});
