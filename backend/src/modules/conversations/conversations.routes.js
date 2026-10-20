import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as service from './conversations.service.js';

/**
 * @swagger
 * tags:
 *   name: Conversations
 *   description: Parent–teacher messages about a child, with read receipts, office hours and an unanswered queue
 */
const router = Router();
router.use(authenticate, requireFeature('conversations'));
const use = requirePermission('conversations.use');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', use, ok((r) => service.list(r.actor, r.scope, r.query)));
router.get('/contacts', use, ok((r) => service.contacts(r.actor, r.scope, r.query)));
router.get('/queue', use, ok((r) => service.unansweredQueue(r.actor, r.scope, r.query)));
router.get('/settings', use, ok((r) => service.getSettings(r.actor)));
router.put('/settings', use, ok((r) => service.setSettings(r.actor, r.body), 'Saved'));
router.post('/', use, ok((r) => service.start(r.actor, r.scope, r.body), 'Message sent', 201));
router.get('/:id', use, ok((r) => service.getThread(r.actor, r.scope, r.params.id)));
router.post('/:id/messages', use, ok((r) => service.reply(r.actor, r.scope, r.params.id, r.body), 'Message sent', 201));
router.post('/:id/close', use, ok((r) => service.close(r.actor, r.scope, r.params.id, r.body), 'Conversation closed'));

export default router;
