import { Lab } from '../../models/lab.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, requireProfile } from '../ops/common.js';

/**
 * Who may see and run which lab.
 *
 * labs.read / labs.manage at ALL: every lab (administrator, principal).
 * At OWN: the labs a person is in charge of, or assists in. A teacher also
 * sees the practical sessions they teach in any lab (labs.sessions.js).
 */
const NON_STAFF = ['STUDENT', 'PARENT', 'ALUMNUS'];

export const isStaff = (actor) => Boolean(actor?.system) || (actor?.roleKey && !NON_STAFF.includes(actor.roleKey));

/** Lab ids the actor may act on, or null for every lab. */
export async function ownLabIds(actor, scope) {
  if (scope === 'ALL') return null;
  requireProfile(actor);
  const me = actor.profileId;
  const rows = await Lab.find({ $or: [{ inChargeProfileIds: me }, { assistantProfileId: me }] }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

export function labFilter(ids) {
  return ids === null ? {} : { labId: { $in: ids } };
}

export async function loadLab(actor, scope, id) {
  const lab = await Lab.findById(assertObjectId(id, 'labId'));
  if (!lab) throw new AppError('Lab not found', 404);
  if (scope !== 'ALL') {
    const me = String(actor?.profileId);
    const mine = lab.inChargeProfileIds.some((p) => String(p) === me) || String(lab.assistantProfileId) === me;
    if (!mine) throw new AppError('Lab not found', 404);
  }
  return lab;
}

export async function assertLabAccess(actor, scope, labId) {
  return loadLab(actor, scope, labId);
}

/** The role key of a profile, for the "no hazardous handling by students" rule. */
export async function roleKeyOf(profileId) {
  if (!profileId) return null;
  const p = await Profile.findById(profileId).select('roleId').populate('roleId', 'key').lean();
  return p?.roleId?.key ?? null;
}

/** Labs' owners for tasks: the first in-charge, falling back to the department lead. */
export const labOwner = (lab) => (lab?.inChargeProfileIds?.[0] ? String(lab.inChargeProfileIds[0]) : null);
