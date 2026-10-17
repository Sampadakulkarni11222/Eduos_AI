import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './growth.service.js';

export const getScore = asyncHandler(async (req, res) => {
  const { enrollmentId } = req.query;
  // The current month in India time when none is given (the parent Student View asks for "now").
  const period = req.query.period || new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  if (!enrollmentId || !/^\d{4}-\d{2}$/.test(String(period))) throw new AppError('enrollmentId and period (YYYY-MM) are required', 400);
  sendSuccess(res, await service.getScore(enrollmentId, period), 'Growth score computed');
});
