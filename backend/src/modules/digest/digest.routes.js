import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as digest from './digest.service.js';

/**
 * @swagger
 * tags:
 *   - name: Digest
 *     description: Daily learning and trends digest from admin-approved RSS/Atom feeds, matched to each person's interests
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('digest'));
const read = requirePermission('digest.read');
const manage = requirePermission('digest.manage', 'ALL');

router.get('/today', read, ok((r) => digest.today(r.actor)));
router.get('/interests', read, ok((r) => digest.interests(r.actor)));
router.put('/preferences', read, ok((r) => digest.setPreferences(r.actor, r.body), 'Interests saved'));
router.get('/sources', manage, ok(() => digest.listSources()));
router.post('/sources', manage, ok((r) => digest.addSource(r.actor, r.body), 'Source approved', 201));
router.patch('/sources/:id', manage, ok((r) => digest.updateSource(r.actor, r.params.id, r.body), 'Source updated'));
router.post('/sources/:id/check', manage, ok((r) => digest.checkSource(r.actor, r.params.id), 'Checked'));
router.post('/run', manage, ok(() => digest.runDaily(), 'Digest built'));

export default router;
