import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './attendance.service.js';

export const getRoster = asyncHandler(async (req, res) => {
  const { sectionId, date } = req.query;
  const roster = await service.getRoster(req.actor, req.scope, sectionId, date);
  sendSuccess(res, roster, 'Roster fetched');
});

export const mark = asyncHandler(async (req, res) => {
  const roster = await service.markAttendance(req.actor, req.body);
  sendSuccess(res, roster, 'Attendance marked', 201);
});

export const markBulk = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const { sectionId, date, periodNo } = req.body;
  const result = await service.markAttendanceBulk(req.actor, {
    sectionId,
    date,
    periodNo: periodNo ? Number(periodNo) : null,
    rows,
  });
  sendSuccess(res, result, `Marked attendance for ${result.imported} of ${rows.length} students`, 201);
});

export const getSummary = asyncHandler(async (req, res) => {
  const summary = await service.getSummary(req.actor, req.scope, req.query);
  sendSuccess(res, summary, 'Attendance summary fetched');
});
