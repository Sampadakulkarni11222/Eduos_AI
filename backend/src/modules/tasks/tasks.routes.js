import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as service from './tasks.service.js';

/**
 * @swagger
 * tags:
 *   name: Tasks
 *   description: One queue for everything due (bills, renewals, services, inspections, follow-ups), with owners, reminders and escalation
 */
const router = Router();
router.use(authenticate, requireFeature('tasks'));

const read = requirePermission('tasks.read');
const manage = requirePermission('tasks.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', read, ok((r) => service.list(r.actor, r.scope, r.query)));
router.get('/summary', read, ok((r) => service.summary(r.actor, r.scope)));
router.post('/', manage, ok((r) => service.createItem(r.actor, r.scope, r.body), 'Task added', 201));
router.post('/:id/acknowledge', manage, ok((r) => service.acknowledge(r.actor, r.scope, r.params.id)));
router.post('/:id/snooze', manage, ok((r) => service.snooze(r.actor, r.scope, r.params.id, r.body)));
router.post('/:id/complete', manage, ok((r) => service.complete(r.actor, r.scope, r.params.id, r.body), 'Task completed'));
router.post('/:id/reassign', manage, ok((r) => service.reassign(r.actor, r.scope, r.params.id, r.body)));
router.post('/:id/cancel', manage, ok((r) => service.cancel(r.actor, r.scope, r.params.id, r.body)));

export default router;
