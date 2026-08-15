import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { AppError } from '../../utils/AppError.js';

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
  }

  return TimetableSlot.find(filter)
    .populate({ path: 'subjectOfferingId', populate: ['subjectId', 'teacherId'] })
    .sort({ dayOfWeek: 1, periodNo: 1 });
}

export const upsertSlot = (data) =>
  TimetableSlot.findOneAndUpdate(
    { sectionId: data.sectionId, dayOfWeek: data.dayOfWeek, periodNo: data.periodNo },
    data,
    { upsert: true, new: true }
  );
