import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { isActiveSchoolOrigin } from './domain.service.js';

/**
 * The CORS origin decision, for the `cors` middleware.
 *
 * The configured CORS_ORIGIN keeps working exactly as before: '*' stays a
 * wildcard and a named origin is allowed. On top of it, an https origin on a
 * school's ACTIVE domain is allowed — and nothing else is, so configuring a
 * domain, or even verifying it, opens nothing until a Super Admin activates it.
 *
 * A failed lookup denies rather than throws: the browser then refuses the
 * cross-origin call, which is the safe way for this to break.
 */
export function corsOrigin(origin, callback) {
  const configured = String(env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (configured.includes('*')) return callback(null, '*');
  // Same-origin and non-browser requests carry no Origin header.
  if (!origin || configured.includes(origin)) return callback(null, true);

  return isActiveSchoolOrigin(origin)
    .then((allowed) => callback(null, allowed))
    .catch((err) => {
      logger.error(`CORS domain lookup failed for ${origin}: ${err.message}`);
      callback(null, false);
    });
}
