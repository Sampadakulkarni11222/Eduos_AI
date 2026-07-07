import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './admission.service.js';

export const getPipeline = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.getPipeline(), 'Admissions pipeline fetched');
});

export const createLead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createLead(req.body), 'Lead created', 201);
});

export const updateLead = asyncHandler(async (req, res) => {
  const lead = await service.updateLead({ ...req.body, actorProfileId: req.actor.profileId });
  sendSuccess(res, lead, 'Lead updated');
});
