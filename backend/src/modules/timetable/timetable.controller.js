import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './timetable.service.js';

export const getTimetable = asyncHandler(async (req, res) => {
  const slots = await service.getTimetable(req.actor, req.scope, req.query.sectionId);
  const dtos = slots.map(s => {
    // A slot with no subjectOfferingId is a break by definition (see
    // timetableSlot.model.js) — there is no separate isBreak field.
    const isBreak = !s.subjectOfferingId;
    return {
      id: s._id,
      dayOfWeek: s.dayOfWeek,
      periodNo: s.periodNo,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectOfferingId?.subjectId?.name || (isBreak ? 'Break' : 'Unknown'),
      teacher: s.subjectOfferingId?.teacherId?.displayName || null,
      subjectOfferingId: s.subjectOfferingId?._id?.toString() ?? null,
      isBreak,
    };
  });
  sendSuccess(res, { sectionId: req.query.sectionId || '', slots: dtos }, 'Timetable fetched');
});

export const upsertSlot = asyncHandler(async (req, res) => {
  const slot = await service.upsertSlot(req.body);
  sendSuccess(res, slot, 'Timetable slot saved', 201);
});
