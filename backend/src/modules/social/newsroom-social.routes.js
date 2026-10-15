import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as svc from './newsroom-social.service.js';

/**
 * @swagger
 * tags:
 *   name: NewsroomSocial
 *   description: '"Also post to social media" from the newsroom: what the composer may offer, sharing a published public story to the school''s networks (staff with social.publish only; simulated without provider credentials) and each network''s status'
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate);
// Answers for everyone signed in: a family member simply gets { available: false }.
router.get('/options', ok((r) => svc.options(r.actor)));
// The service refuses parents, students and alumni whatever their role was configured to hold.
const pub = requirePermission('social.publish');
router.get('/statuses', pub, ok((r) => svc.statusesFor(r.actor, r.query.ids)));
router.get('/stories/:id', pub, ok((r) => svc.storyStatus(r.actor, r.params.id)));
router.post('/stories/:id/share', pub, ok((r) => svc.shareStory(r.actor, r.params.id, r.body), 'Shared'));

export default router;
