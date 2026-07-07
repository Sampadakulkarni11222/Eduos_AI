import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './timetable.service.js';

export const getTimetable = asyncHandler(async (req, res) => {
  const slots = await service.getTimetable(req.actor, req.scope, req.query.sectionId);
  const dtos = slots.map(s => ({
    id: s._id,
    dayOfWeek: s.dayOfWeek,
    periodNo: s.periodNo,
    startTime: s.startTime,
    endTime: s.endTime,
    subject: s.subjectOfferingId?.subjectId?.name || (s.isBreak ? 'Break' : 'Unknown'),
    teacher: s.subjectOfferingId?.teacherId?.displayName || null,
    isBreak: s.isBreak || false,
  }));
  sendSuccess(res, { sectionId: req.query.sectionId || '', slots: dtos }, 'Timetable fetched');
});

export const upsertSlot = asyncHandler(async (req, res) => {
  const slot = await service.upsertSlot(req.body);
  sendSuccess(res, slot, 'Timetable slot saved', 201);
});
