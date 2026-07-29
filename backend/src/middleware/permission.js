import { AppError } from '../utils/AppError.js';

/**
 * Enforces that the authenticated actor's role has been granted the given
 * permission key. Must run after `authenticate`. The resolved scope (ALL/OWN)
 * is attached to req.scope so controllers/services can filter data accordingly.
 */
export const requirePermission = (permissionKey, minScope) => (req, _res, next) => {
  const scope = req.actor?.permissions?.[permissionKey];
  if (!scope) {
    throw new AppError(`Missing permission: ${permissionKey}`, 403);
  }
  // Some endpoints aggregate across the whole school, so holding the
  // permission at OWN scope must not be enough to reach them — otherwise a
  // parent's `students.read: OWN` opens a school-wide report.
  if (minScope === 'ALL' && scope !== 'ALL') {
    throw new AppError(`Missing permission: ${permissionKey} at school-wide scope`, 403);
  }
  req.scope = scope;
  next();
};

/**
 * Restricts a route to specific roles.
 *
 * Permissions answer "may this actor touch this kind of data"; they do not
 * answer "is this actor the audience for this screen". Role-specific
 * aggregations (the per-role dashboards) need the second question answered
 * too, since several roles legitimately share a read permission.
 */
export const requireRole = (...roleKeys) => (req, _res, next) => {
  if (!roleKeys.includes(req.actor?.roleKey)) {
    throw new AppError('This resource is not available for your role', 403, [], 'ROLE_NOT_PERMITTED');
  }
  next();
};
