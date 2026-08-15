import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './risk.service.js';

export const scan = asyncHandler(async (req, res) => {
  // read() serves from the persisted predictions and only rescans when they
  // are stale or ?refresh=true, so filtering/sorting/paging no longer rescore.
  sendSuccess(res, await service.read(req.query), 'Risk scan complete');
});
