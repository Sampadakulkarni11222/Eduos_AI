import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as social from './social.service.js';

/**
 * @swagger
 * tags:
 *   - name: SocialPublishing
 *     description: Staff-only outbox for sharing public newsroom stories to the school's social accounts; simulated without provider credentials
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
// Parents, students and alumni are refused before anything else, even if a role were misconfigured.
router.use(authenticate, (req, _res, next) => { social.assertStaff(req.actor, req.actor?.permissions?.['social.connect'] && !req.actor?.permissions?.['social.publish'] ? 'social.connect' : 'social.publish'); next(); }, requireFeature('socialPublishing'));
const pub = requirePermission('social.publish');
const connect = requirePermission('social.connect');

router.get('/accounts', ok((r) => social.listAccounts(r.actor)));
router.post('/accounts', connect, ok((r) => social.connectAccount(r.actor, r.body), 'Recorded — connection pending', 201));
router.post('/accounts/:id/disconnect', connect, ok((r) => social.disconnectAccount(r.actor, r.params.id), 'Disconnected'));
router.get('/stories', pub, ok((r) => social.shareableStories(r.actor)));
router.get('/posts', pub, ok((r) => social.listPosts(r.actor)));
router.post('/posts', pub, ok((r) => social.compose(r.actor, r.body), 'Saved', 201));
router.get('/posts/:id', pub, ok((r) => social.getPost(r.actor, r.params.id)));
router.post('/posts/:id/publish', pub, ok((r) => social.publish(r.actor, r.params.id), 'Done'));

export default router;
