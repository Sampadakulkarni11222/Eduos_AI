import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { aiRateLimiter } from '../../middleware/rateLimiter.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as drafts from './drafts.service.js';

/**
 * @swagger
 * tags:
 *   name: AiDrafts
 *   description: Drafts of letters, circulars, minutes, lesson-plan outlines and report-card remarks. A draft is returned to the person who asked and is never sent, published or saved.
 */
const router = Router();
router.use(authenticate, requireFeature('aiDrafts'), requirePermission('ai.drafts.use'));

router.get('/', asyncHandler(async (_req, res) => sendSuccess(res, drafts.status())));
router.post('/', aiRateLimiter, asyncHandler(async (req, res) => sendSuccess(res, await drafts.draft(req.actor, req.body), 'Draft ready (not saved)')));

export default router;
