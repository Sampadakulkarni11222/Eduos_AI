import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './settings.service.js';

export const getSettings = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSettings(req.actor), 'Settings fetched');
});

export const updateSettings = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.updateSettings(req.actor, req.body), 'Settings updated');
});
