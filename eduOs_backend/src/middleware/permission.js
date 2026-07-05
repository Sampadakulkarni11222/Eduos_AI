import { AppError } from '../utils/AppError.js';

/**
 * Enforces that the authenticated actor's role has been granted the given
 * permission key. Must run after `authenticate`. The resolved scope (ALL/OWN)
 * is attached to req.scope so controllers/services can filter data accordingly.
 */
export const requirePermission = (permissionKey) => (req, _res, next) => {
  const scope = req.actor?.permissions?.[permissionKey];
  if (!scope) {
    throw new AppError(`Missing permission: ${permissionKey}`, 403);
  }
  req.scope = scope;
  next();
};
