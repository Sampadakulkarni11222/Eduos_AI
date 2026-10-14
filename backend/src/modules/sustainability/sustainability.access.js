import { EcoTeam } from '../../models/sustainability.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { assertObjectId, requireProfile } from '../ops/common.js';

/**
 * Who may act on which eco team.
 *
 * sustainability.manage / .verify at ALL: every team (administrator,
 * principal, compliance officer). At OWN: the teams a person leads, plus the
 * CLASS teams of sections they teach or are class teacher of. A teacher logs
 * activities for those teams and may verify them, but never an activity they
 * logged themselves (see verifyActivity).
 *
 * Students and parents read only the eco-points board; the operational
 * registers (waste, meters, sanitation) are staff screens.
 */
const NON_STAFF = ['STUDENT', 'PARENT', 'ALUMNUS'];

export const isStaff = (actor) => Boolean(actor?.system) || Boolean(actor?.roleKey && !NON_STAFF.includes(actor.roleKey));

export function requireStaff(actor) {
  if (!isStaff(actor)) throw new AppError('This sustainability register is for staff. Eco points are on the Eco points page.', 403, [], 'STAFF_ONLY');
}

/** Team ids the actor may act on, or null for every team. */
export async function ownTeamIds(actor, scope) {
  if (scope === 'ALL') return null;
  requireProfile(actor);
  const sections = await getTeacherSectionIds(actor.profileId);
  const rows = await EcoTeam.find({ $or: [{ leadProfileIds: actor.profileId }, { kind: 'CLASS', sectionId: { $in: sections } }] }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

export async function loadTeam(actor, scope, id) {
  const team = await EcoTeam.findById(assertObjectId(id, 'teamId')).lean();
  if (!team) throw new AppError('Eco team not found', 404);
  const own = await ownTeamIds(actor, scope);
  if (own !== null && !own.includes(String(team._id))) throw new AppError('Eco team not found', 404);
  return team;
}
