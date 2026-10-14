import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as campus from './campus.service.js';
import * as insights from '../insights/insights.service.js';
import { pulse } from '../insights/pulse.service.js';
import { inbox as approvalInbox } from '../approvals/approval.service.js';
import { shortCache, permissionKey, BOARD_CACHE_MS } from '../../utils/shortCache.js';

/**
 * @swagger
 * tags:
 *   - { name: Campus, description: Permission-filtered campus world (buildings, rooms, scheduled use, bookings, maintenance) }
 *   - { name: Insights, description: Role home screens and the principal's daily briefing }
 */
export const campusRouter = Router();
campusRouter.use(authenticate);
// The map depends on the school, the reader's role and grants, and the options —
// nothing personal — so readers with the same grants share one answer for a few seconds.
campusRouter.get('/map', requirePermission('campus.map.read'), asyncHandler(async (req, res) => {
  const opts = { campusCode: req.query.campusCode || undefined, at: req.query.at || null };
  const key = `campus:${req.actor.tenantId}:${req.actor.roleKey}:${permissionKey(req.actor.permissions)}:${opts.campusCode ?? ''}:${opts.at ?? ''}`;
  sendSuccess(res, await shortCache(key, BOARD_CACHE_MS, () => campus.campusMap(req.actor, opts)));
}));
campusRouter.get('/facilities/:id', requirePermission('campus.map.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await campus.facilityDetail(req.actor, req.params.id, { at: req.query.at || null }))));

export const insightsRouter = Router();
insightsRouter.use(authenticate);
insightsRouter.get('/home', asyncHandler(async (req, res) =>
  sendSuccess(res, await shortCache(`home:${req.actor.tenantId}:${req.actor.profileId}`, BOARD_CACHE_MS, () => insights.home(req.actor)))));
// Charts, activity, department tiles and a briefing, each limited to what the caller may read.
insightsRouter.get('/pulse', asyncHandler(async (req, res) => {
  sendSuccess(res, await shortCache(`pulse:${req.actor.tenantId}:${req.actor.profileId}`, BOARD_CACHE_MS, async () => {
    const decisions = req.actor.permissions?.['approvals.read'] ? (await approvalInbox(req.actor).catch(() => [])).length : 0;
    return pulse(req.actor, { decisions });
  }));
}));
