import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './profile.service.js';

export const list = asyncHandler(async (req, res) => {
  const profiles = await service.listForAccount(req.actor.accountId);
  sendSuccess(res, profiles, 'Profiles fetched');
});
