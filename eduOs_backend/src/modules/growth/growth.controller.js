import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './growth.service.js';

export const getScore = asyncHandler(async (req, res) => {
  const { enrollmentId, period } = req.query;
  if (!enrollmentId || !period) throw new AppError('enrollmentId and period (YYYY-MM) are required', 400);
  sendSuccess(res, await service.getScore(enrollmentId, period), 'Growth score computed');
});
