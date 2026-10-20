import { AppError } from '../../utils/AppError.js';

/**
 * Small access helpers for the transport and safety routers, where one screen
 * is legitimately reached through several keys (a principal reads trips by
 * transport.tracking.read ALL, the transport office by transport.fleet.manage,
 * a teacher on bus duty by transport.trips.operate OWN).
 */

/**
 * Passes when the actor holds any of `grants` ([key, minScope?]); sets
 * req.scope to ALL if any matching grant is at ALL, otherwise OWN.
 */
export const requireAnyOf = (...grants) => (req, _res, next) => {
  const perms = req.actor?.permissions ?? {};
  let best = null;
  for (const [key, minScope] of grants) {
    const s = perms[key];
    if (!s) continue;
    if (minScope === 'ALL' && s !== 'ALL') continue;
    if (s === 'ALL') { best = 'ALL'; break; }
    best = best ?? s;
  }
  if (!best) throw new AppError(`Missing permission: one of ${grants.map(([k]) => k).join(', ')}`, 403);
  req.scope = best;
  next();
};

/** Alert departments an actor may see. */
export function alertDepartments(actor) {
  const p = actor?.permissions ?? {};
  const out = [];
  if (p['transport.fleet.manage'] || p['transport.trips.operate'] === 'ALL' || p['transport.tracking.read'] === 'ALL') out.push('TRANSPORT');
  if (p['checkpoints.read'] === 'ALL' || p['checkpoints.manage'] || p['visitors.manage']) out.push('GATE', 'SAFETY');
  if (p['hostel.outpass.manage']) out.push('HOSTEL');
  return out;
}
