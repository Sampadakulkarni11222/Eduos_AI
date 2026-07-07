import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './medical.service.js';

export const getByStudentId = asyncHandler(async (req, res) => {
  const record = await service.getByStudentId(req.actor, req.scope, req.params.studentId);
  sendSuccess(res, record, 'Medical record fetched');
});

export const upsert = asyncHandler(async (req, res) => {
  const record = await service.upsert(req.params.studentId, req.body);
  sendSuccess(res, record, 'Medical record saved');
});
