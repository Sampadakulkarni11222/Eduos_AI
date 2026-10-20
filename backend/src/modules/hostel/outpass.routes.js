import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { requireAnyOf } from '../safety/access.js';
import * as service from './outpass.service.js';

/**
 * @swagger
 * tags:
 *   name: Hostel out-pass
 *   description: Student or guardian request → guardian confirmation → warden approval → gate exit and return, late-return alerts
 */
const router = Router();
router.use(authenticate, requireFeature('hostelOutpass'));
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const read = requireAnyOf(['hostel.outpass.manage'], ['hostel.outpass.request']);
const manage = requirePermission('hostel.outpass.manage');

router.get('/', read, ok((r) => service.list(r.actor, r.scope, r.query)));
router.post('/', read, ok((r) => service.request(r.actor, r.scope, r.body), 'Out-pass requested', 201));
router.get('/:id', read, ok((r) => service.get(r.actor, r.scope, r.params.id)));
router.post('/:id/parent-decision', requirePermission('hostel.outpass.request'), ok((r) => service.parentDecision(r.actor, r.params.id, r.body)));
router.post('/:id/decision', manage, ok((r) => service.wardenDecision(r.actor, r.params.id, r.body)));
router.post('/:id/gate', manage, ok((r) => service.recordManual(r.actor, r.params.id, r.body)));
router.post('/:id/cancel', read, ok((r) => service.cancel(r.actor, r.scope, r.params.id, r.body)));

export default router;
