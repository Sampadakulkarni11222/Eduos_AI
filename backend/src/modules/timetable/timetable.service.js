import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { SubjectOffering, Section } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { SubjectRegistration } from '../../models/subjectRegistration.model.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { AppError } from '../../utils/AppError.js';

/** Student ids the caller may see a timetable for (their own, or their children's). */
async function ownStudentIds(actor) {
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    return id ? [id] : [];
  }
  if (actor.roleKey === 'PARENT') return getGuardianStudentIds(actor.profileId);
  return [];
}

/**
 * Elective offerings in the caller's own sections that they are NOT approved
 * for, so those periods can be hidden from their timetable.
 *
 * A section's elective is on the section's timetable but is only actually
 * attended by the students whose registration was approved — showing it to
 * everyone would put a class on their schedule that they are not in.
 */
async function unregisteredElectiveIds(actor, sectionIds) {
  if (sectionIds.length === 0) return [];

  const electives = await SubjectOffering.find({
    sectionId: { $in: sectionIds },
    isElective: true,
  }).select('_id');
  if (electives.length === 0) return [];

  const studentIds = await ownStudentIds(actor);
  const approved = await SubjectRegistration.find({
    studentId: { $in: studentIds },
    subjectOfferingId: { $in: electives.map((e) => e._id) },
    status: 'APPROVED',
  }).select('subjectOfferingId');

  const approvedIds = new Set(approved.map((r) => r.subjectOfferingId.toString()));
  return electives.map((e) => e._id).filter((id) => !approvedIds.has(id.toString()));
}

/** Sections the caller (student, or parent via their children) is enrolled in. */
async function getOwnSectionIds(actor) {
  let studentIds = [];
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    studentIds = id ? [id] : [];
  } else if (actor.roleKey === 'PARENT') {
    studentIds = await getGuardianStudentIds(actor.profileId);
  }
  if (studentIds.length === 0) return [];
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId');
  return [...new Set(enrollments.map((e) => e.sectionId?.toString()).filter(Boolean))];
}

export async function getTimetable(actor, scope, sectionId) {
  const filter = {};
  if (sectionId) filter.sectionId = sectionId;

  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    if (sectionId && !sectionIds.includes(sectionId)) {
      throw new AppError('You do not teach this section', 403);
    }
    filter.sectionId = sectionId ? sectionId : { $in: sectionIds };

    // A teacher only sees the periods they personally teach, not every
    // subject taught by other teachers in a section they're merely
    // class-teacher of.
    const teacherOfferings = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id');
    filter.subjectOfferingId = { $in: teacherOfferings.map((o) => o._id) };
  } else if (scope === 'OWN') {
    // Students and parents hold timetable.read at OWN scope. Without this
    // branch the OWN check applied to teachers only, so passing any sectionId
    // returned that class's timetable — and omitting it returned the whole
    // school's. Restrict them to the sections they are actually enrolled in.
    const ownSectionIds = await getOwnSectionIds(actor);
    if (sectionId && !ownSectionIds.includes(String(sectionId))) {
      throw new AppError('You are not enrolled in this section', 403);
    }
    filter.sectionId = sectionId ? sectionId : { $in: ownSectionIds };

    // An approved elective belongs on this student's timetable; the section's
    // other electives, which they did not take, do not.
    const hidden = await unregisteredElectiveIds(actor, sectionId ? [String(sectionId)] : ownSectionIds);
    if (hidden.length) filter.subjectOfferingId = { $nin: hidden };
  }

  return TimetableSlot.find(filter)
    .populate({ path: 'subjectOfferingId', populate: ['subjectId', 'teacherId'] })
    .sort({ dayOfWeek: 1, periodNo: 1 });
}

/**
 * Creates or replaces one period.
 *
 * The section — and, unless the period is a break, the subject offering — must
 * exist in the acting school, and the offering must belong to that section.
 * This used to upsert against whatever ids arrived, so a slot could be filed
 * under another school's section or show one class another class's subject.
 * The lookups go through the tenant-scoped models, so a foreign id is "not
 * found"; the REST route and the assistant both get the check.
 */
export async function upsertSlot(data) {
  const section = await Section.findById(data.sectionId).select('_id').lean();
  if (!section) throw new AppError('Section not found', 404);
  if (data.subjectOfferingId) {
    const offering = await SubjectOffering.findById(data.subjectOfferingId).select('sectionId').lean();
    if (!offering) throw new AppError('Subject offering not found', 404);
    if (String(offering.sectionId) !== String(data.sectionId)) {
      throw new AppError('That subject offering belongs to a different section', 400, [], 'OFFERING_NOT_IN_SECTION');
    }
  }
  return TimetableSlot.findOneAndUpdate(
    { sectionId: data.sectionId, dayOfWeek: data.dayOfWeek, periodNo: data.periodNo },
    data,
    // runValidators is off by default on findOneAndUpdate, so the schema's own
    // constraints (dayOfWeek 1-7, required times) were silently skipped on this
    // path — a slot with dayOfWeek 8 was accepted and written.
    { upsert: true, new: true, runValidators: true }
  );
}
