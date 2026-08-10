import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './incident.service.js';

export const createIncident = asyncHandler(async (req, res) => {
  const report = await service.createIncident(req.actor, req.body);
  sendSuccess(res, report, 'Incident report created', 201);
});

export const listIncidents = asyncHandler(async (req, res) => {
  const reports = await service.listIncidents(req.actor, req.scope, req.query);
  sendSuccess(res, reports, 'Incident reports fetched');
});

export const updateIncident = asyncHandler(async (req, res) => {
  const report = await service.updateIncident(req.actor, req.params.id, req.body);
  sendSuccess(res, report, 'Incident report updated');
});
