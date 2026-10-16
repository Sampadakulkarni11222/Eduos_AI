import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as mode from './approverMode.service.js';

/**
 * @swagger
 * tags:
 *   - name: SchoolPolicy
 *     description: >
 *       Single-approver mode: off by default; with settings.manage (whole school) a small school lets its
 *       principal or administrator approve their own showcase entry, fixture result, offline campaign or bill
 *       payment, each marked "single-approver". Every change is audit-logged.
 */
const router = Router();
router.use(authenticate);
// Any signed-in person may see whether the mode is on (screens explain why a self-approval was allowed).
router.get('/approver-mode', asyncHandler(async (_req, res) => sendSuccess(res, await mode.getApproverMode())));
router.put('/approver-mode', requirePermission('settings.manage', 'ALL'), asyncHandler(async (req, res) => sendSuccess(res, await mode.setApproverMode(req.actor, req.body ?? {}), 'Saved')));

export default router;
