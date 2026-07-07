import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { getTeacherSectionIds } from '../../utils/scope.js';

export async function getTimetable(actor, scope, sectionId) {
  const filter = {};
  if (sectionId) filter.sectionId = sectionId;

  if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    filter.sectionId = sectionId ? sectionId : { $in: sectionIds };
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
