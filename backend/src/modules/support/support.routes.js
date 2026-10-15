import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as plans from './support.service.js';

/**
 * @swagger
 * tags:
 *   - name: SupportPlans
 *     description: >
 *       Student support plans opened from the rule-based risk signals, attendance and marks:
 *       concern area, measurable goals with review dates (reminded through Tasks), actions with
 *       owners, progress reviews, family sharing and closure with an outcome. Families see the
 *       summary and goals for their own child only; internal notes and the safeguarding flag never.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('supportPlans'));
const read = requirePermission('supportplans.read');
const manage = requirePermission('supportplans.manage');

router.get('/', read, ok((r) => plans.list(r.actor, r.scope, r.query)));
router.get('/suggestions', manage, ok((r) => plans.suggestions(r.actor, r.scope, r.query)));
router.get('/family', read, ok((r) => plans.familyPlans(r.actor)));
router.post('/family/:id/acknowledge', read, ok((r) => plans.acknowledge(r.actor, r.params.id, r.body), 'Thank you, the school can see you have read it'));
router.post('/', manage, ok((r) => plans.create(r.actor, r.scope, r.body), 'Support plan opened', 201));
router.get('/:id', read, ok((r) => plans.get(r.actor, r.scope, r.params.id)));
router.patch('/:id', manage, ok((r) => plans.update(r.actor, r.scope, r.params.id, r.body)));
router.post('/:id/goals', manage, ok((r) => plans.addGoal(r.actor, r.scope, r.params.id, r.body), 'Goal added', 201));
router.post('/:id/goals/:goalId/progress', manage, ok((r) => plans.recordProgress(r.actor, r.scope, r.params.id, r.params.goalId, r.body), 'Progress recorded'));
router.post('/:id/actions', manage, ok((r) => plans.addAction(r.actor, r.scope, r.params.id, r.body), 'Action added', 201));
router.post('/:id/actions/:actionId/complete', manage, ok((r) => plans.completeAction(r.actor, r.scope, r.params.id, r.params.actionId, r.body)));
router.post('/:id/notes', manage, ok((r) => plans.addNote(r.actor, r.scope, r.params.id, r.body), 'Note added', 201));
router.post('/:id/reviews', manage, ok((r) => plans.addReview(r.actor, r.scope, r.params.id, r.body), 'Review recorded', 201));
router.post('/:id/share', manage, ok((r) => plans.share(r.actor, r.scope, r.params.id), 'Shared with the family'));
router.post('/:id/referral', manage, ok((r) => plans.markReferred(r.actor, r.scope, r.params.id), 'Referral recorded'));
router.post('/:id/close', manage, ok((r) => plans.close(r.actor, r.scope, r.params.id, r.body), 'Plan closed'));
router.post('/:id/reopen', manage, ok((r) => plans.reopen(r.actor, r.scope, r.params.id, r.body), 'Plan reopened'));

export default router;
