import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as creds from './credentials.service.js';

/**
 * @swagger
 * tags:
 *   - name: StaffProfile
 *     description: Staff qualifications, subjects, experience, certifications and bio, each with a "show to families" consent
 */
const router = Router();
router.use(authenticate);
const ok = (fn, message = 'OK') => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message));

// Who may do what is decided in the service from the session (own record, HR, families' own teachers).
router.get('/me', ok((r) => creds.mine(r.actor)));
router.put('/me', ok((r) => creds.updateMine(r.actor, r.body), 'Profile saved'));
router.get('/teachers-of', ok((r) => creds.teachersOf(r.actor, { studentId: r.query.studentId ? String(r.query.studentId) : null })));
router.get('/', ok((r) => creds.listStaff(r.actor, { search: r.query.search ? String(r.query.search) : '' })));
router.get('/:profileId', ok((r) => creds.read(r.actor, r.params.profileId)));
router.put('/:profileId', ok((r) => creds.updateFor(r.actor, r.params.profileId, r.body), 'Profile saved'));

export default router;
