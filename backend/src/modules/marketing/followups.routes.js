import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as followups from './followups.service.js';

/**
 * @swagger
 * tags:
 *   name: AdmissionFollowups
 *   description: The counsellor's follow-up queue (overdue, due today, never contacted, no next action), logging a follow-up in one step, explainable enquiry scores, and per-counsellor response and conversion
 */
const router = Router();
router.use(authenticate);
const read = requirePermission('admissions.read');
const manage = requirePermission('admissions.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', read, ok((r) => followups.queue(r.actor, { mine: r.query.mine, limit: r.query.limit })));
router.get('/counsellors', read, ok((r) => followups.counsellorStats({ days: r.query.days })));
router.get('/:leadId/score', read, ok((r) => followups.leadScore(r.params.leadId)));
router.post('/:leadId', manage, ok((r) => followups.logFollowUp(r.actor, r.params.leadId, r.body ?? {}), 'Follow-up logged', 201));

export default router;
