import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { AppError } from '../../utils/AppError.js';
import * as alumni from './alumni.service.js';

/**
 * @swagger
 * tags:
 *   - name: Alumni
 *     description: Graduation and leaving into alumni access, batches and served years, the consent-based directory, reunions, alumni circle posts, and students' profile links
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate);

// Profile links on a current student's profile: the student, their guardians and staff. Not feature-gated
// (they belong to the student profile, not to the alumni module).
const cRead = requirePermission('community.read');
router.get('/student-links/mine', cRead, ok((r) => alumni.myStudentLinks(r.actor)));
router.get('/student-links/:studentId', cRead, ok((r) => alumni.getStudentLinks(r.actor, r.params.studentId)));
router.put('/student-links/:studentId', cRead, ok((r) => alumni.setStudentLinks(r.actor, r.params.studentId, r.body), 'Links saved'));

router.use(requireFeature('alumni'));
const dir = requirePermission('alumni.directory.read');
const manage = requirePermission('alumni.manage', 'ALL');
/** Directory readers or managers. */
const anyAlumni = (req, _res, next) => {
  if (req.actor?.permissions?.['alumni.directory.read'] || req.actor?.permissions?.['alumni.manage']) return next();
  throw new AppError('Missing permission: alumni.directory.read', 403);
};

router.get('/me', dir, ok((r) => alumni.me(r.actor)));
router.put('/me', dir, ok((r) => alumni.updateMe(r.actor, r.body), 'Saved'));
router.get('/me/record', dir, ok((r) => alumni.myRecord(r.actor)));
router.get('/directory', anyAlumni, ok((r) => alumni.directory(r.actor, r.query)));
router.get('/batches', anyAlumni, ok(() => alumni.batches()));
router.get('/circles', anyAlumni, ok((r) => alumni.myCircles(r.actor)));
router.get('/posts', anyAlumni, ok((r) => alumni.listPosts(r.actor, r.query)));
router.post('/posts', anyAlumni, ok((r) => alumni.createPost(r.actor, r.body), 'Sent for review', 201));
router.post('/posts/:id/moderate', manage, ok((r) => alumni.moderatePost(r.actor, r.params.id, r.body), 'Updated'));
router.get('/events', anyAlumni, ok((r) => alumni.listEvents(r.actor)));
router.post('/events', manage, ok((r) => alumni.createEvent(r.actor, r.body), 'Event created', 201));
router.post('/events/:id/cancel', manage, ok((r) => alumni.cancelEvent(r.actor, r.params.id, r.body), 'Event cancelled'));
router.post('/events/:id/rsvp', dir, ok((r) => alumni.rsvp(r.actor, r.params.id, r.body), 'Reply saved'));
router.get('/records', manage, ok((r) => alumni.listAlumni(r.actor, r.query)));
router.patch('/records/:id', manage, ok((r) => alumni.updateAlumnus(r.actor, r.params.id, r.body), 'Saved'));
router.post('/transitions', manage, ok((r) => alumni.transition(r.actor, r.body), 'Moved to alumni', 201));

export default router;
