import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './risk.service.js';

export const scan = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.scan(req.query), 'Risk scan complete');
});
