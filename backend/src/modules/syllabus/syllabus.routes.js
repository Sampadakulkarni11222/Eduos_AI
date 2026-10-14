import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './syllabus.service.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Syllabus
 *   description: Module plans, timelines and what was taught, per subject and class
 */

const read = requirePermission('syllabus.read');
const manage = requirePermission('syllabus.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', read, ok((r) => service.overview(r.actor, r.query)));
router.get('/offerings', manage, ok((r) => service.myOfferings(r.actor)));
router.get('/offerings/:offeringId', read, ok((r) => service.plan(r.actor, r.params.offeringId)));
router.post('/modules', manage, ok((r) => service.createModule(r.actor, r.body), 'Module added', 201));
router.patch('/modules/:id', manage, ok((r) => service.updateModule(r.actor, r.params.id, r.body), 'Module updated'));
router.post('/modules/:id/progress', manage, ok((r) => service.recordProgress(r.actor, r.params.id, r.body), 'Lesson recorded'));
router.delete('/modules/:id', manage, ok((r) => service.removeModule(r.actor, r.params.id), 'Module removed'));

export default router;
