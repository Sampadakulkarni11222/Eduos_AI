import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { AppError } from '../../utils/AppError.js';

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
