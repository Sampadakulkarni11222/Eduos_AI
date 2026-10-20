import { Club, House } from '../../models/club.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { assertObjectId, requireProfile } from '../ops/common.js';

/**
 * Who may see and run which club.
 *
 * clubs.read   ALL: staff see every club, its members and sessions.
 *              OWN: students and families browse the catalogue (it holds no
 *              personal data) and see memberships, attendance and portfolio
 *              for themselves or their own children only.
 * clubs.manage ALL: administration and the principal run every club, house and fixture.
 *              OWN: a teacher runs the clubs they are in charge of (coachProfileIds)
 *              and the fixtures of those clubs or of a house they are master of.
 * clubs.join   OWN: a student for themselves, a parent for their child.
 */
export const FAMILY_ROLES = ['STUDENT', 'PARENT', 'ALUMNUS'];
export const isFamily = (actor) => FAMILY_ROLES.includes(actor?.roleKey);
export const isStaff = (actor) => Boolean(actor?.system) || Boolean(actor?.roleKey && !FAMILY_ROLES.includes(actor.roleKey));

/** The students an actor speaks for: themselves (a student) or their children (a parent). */
export async function familyStudentIds(actor) {
  requireProfile(actor);
  if (actor.roleKey === 'PARENT') return (await getGuardianStudentIds(actor.profileId)).map(String);
  if (actor.roleKey === 'STUDENT') {
    const own = await getOwnStudentId(actor.profileId);
    return own ? [String(own)] : [];
  }
  return [];
}

/** Refuses a student the actor may not see. Staff with ALL see everyone. */
export async function assertStudentVisible(actor, scope, studentId) {
  const id = assertObjectId(studentId, 'studentId');
  if (scope === 'ALL' && isStaff(actor)) return id;
  const mine = await familyStudentIds(actor);
  if (!mine.includes(id)) throw new AppError('Student not found', 404, [], 'NOT_YOUR_CHILD');
  return id;
}

export const isCoach = (club, actor) => (club?.coachProfileIds ?? []).some((p) => String(p) === String(actor?.profileId));

/** Club ids an actor may run, or null for every club. */
export async function managedClubIds(actor, scope) {
  if (scope === 'ALL') return null;
  requireProfile(actor);
  const rows = await Club.find({ coachProfileIds: actor.profileId }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

export async function loadClub(id) {
  const club = await Club.findById(assertObjectId(id, 'clubId'));
  if (!club) throw new AppError('Club not found', 404);
  return club;
}

/** A club the actor runs (coach at OWN, anyone at ALL). */
export async function loadManagedClub(actor, scope, id) {
  const club = await loadClub(id);
  if (scope !== 'ALL' && !isCoach(club, actor)) throw new AppError('You are not in charge of this club.', 403, [], 'NOT_CLUB_COACH');
  return club;
}

export async function housesMastered(actor) {
  if (!actor?.profileId) return [];
  return (await House.find({ masterProfileIds: actor.profileId }).select('_id').lean()).map((h) => String(h._id));
}

/** A student with their current class and grade, for eligibility and labels. */
export async function studentContext(studentId) {
  const student = await Student.findOne({ _id: assertObjectId(studentId, 'studentId'), deletedAt: null }).select('firstName lastName admissionNo dob profileId').lean();
  if (!student) throw new AppError('Student not found', 404);
  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' }).sort({ createdAt: -1 })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const section = enrollment?.sectionId ?? null;
  return {
    student,
    name: `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim(),
    sectionId: section?._id ? String(section._id) : null,
    gradeId: section?.gradeId?._id ? String(section.gradeId._id) : null,
    className: section ? `${section.gradeId?.name ?? ''} ${section.name ?? ''}`.trim() : null,
  };
}

/**
 * Under 18 on the given day. A student with no date of birth on record is
 * treated as a minor: parent consent is asked for rather than assumed.
 */
export function isMinor(student, at = new Date()) {
  if (!student?.dob) return true;
  const dob = new Date(student.dob);
  const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
  return at < eighteenth;
}

export const studentName = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : null);
