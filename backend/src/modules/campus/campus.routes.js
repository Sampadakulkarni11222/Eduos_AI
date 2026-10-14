import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as campus from './campus.service.js';
import * as insights from '../insights/insights.service.js';
import { pulse } from '../insights/pulse.service.js';
import { inbox as approvalInbox } from '../approvals/approval.service.js';

/**
 * @swagger
 * tags:
 *   - { name: Campus, description: Permission-filtered campus world (buildings, rooms, scheduled use, bookings, maintenance) }
 *   - { name: Insights, description: Role home screens and the principal's daily briefing }
 */
export const campusRouter = Router();
campusRouter.use(authenticate);
campusRouter.get('/map', requirePermission('campus.map.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await campus.campusMap(req.actor, { campusCode: req.query.campusCode || undefined, at: req.query.at || null }))));
campusRouter.get('/facilities/:id', requirePermission('campus.map.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await campus.facilityDetail(req.actor, req.params.id, { at: req.query.at || null }))));

export const insightsRouter = Router();
insightsRouter.use(authenticate);
insightsRouter.get('/home', asyncHandler(async (req, res) => sendSuccess(res, await insights.home(req.actor))));
// Charts, activity, department tiles and a briefing, each limited to what the caller may read.
insightsRouter.get('/pulse', asyncHandler(async (req, res) => {
  const decisions = req.actor.permissions?.['approvals.read'] ? (await approvalInbox(req.actor).catch(() => [])).length : 0;
  sendSuccess(res, await pulse(req.actor, { decisions }));
}));
