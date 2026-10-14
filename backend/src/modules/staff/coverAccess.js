import { CoverAssignment } from '../../models/staffLeave.model.js';

/**
 * Whether a confirmed cover assignment makes `profileId` the substitute for
 * `periodNo` of `sectionId` on `day` (UTC midnight, as registers are stored).
 * Read by the attendance service: a substitute may open and mark that one
 * period's register, nothing more. Kept dependency-free (model only) so the
 * attendance service can import it without a cycle.
 */
export async function hasConfirmedCover(profileId, sectionId, day, periodNo) {
  if (!profileId || !sectionId || !day || periodNo === null || periodNo === undefined) return false;
  return Boolean(await CoverAssignment.exists({ substituteProfileId: profileId, sectionId, date: day, periodNo: Number(periodNo), status: 'CONFIRMED' }));
}
