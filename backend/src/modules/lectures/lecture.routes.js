import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './lecture.service.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Lectures
 *   description: Digital lectures and online meetings - scheduling, joining, attendance and recordings
 */

const read = requirePermission('lectures.read');
const manage = requirePermission('lectures.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', read, ok((r) => service.list(r.actor, r.query)));
router.get('/options', manage, ok((r) => service.options(r.actor)));
router.get('/stats', read, ok((r) => service.stats(r.actor)));
router.post('/', manage, ok((r) => service.create(r.actor, r.body), 'Class scheduled', 201));
router.get('/:id', read, ok((r) => service.get(r.actor, r.params.id)));
// Joining returns the meeting link to a person the class is for; the service decides who that is.
router.post('/:id/join', read, ok((r) => service.join(r.actor, r.params.id), 'Join link issued'));
router.patch('/:id', manage, ok((r) => service.update(r.actor, r.params.id, r.body), 'Class updated'));
router.post('/:id/cancel', manage, ok((r) => service.cancel(r.actor, r.params.id, r.body), 'Class cancelled'));
router.post('/:id/finish', manage, ok((r) => service.finish(r.actor, r.params.id, r.body), 'Class closed'));
router.get('/:id/attendance', manage, ok((r) => service.attendance(r.actor, r.params.id)));

export default router;
