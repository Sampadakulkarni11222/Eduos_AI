import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as family from './family.service.js';

/**
 * The family desk (parents and guardians): today across all children, the
 * yearly fee statement for income tax, and school notices in the family's
 * language. Every read is limited to the guardian's own linked children.
 */
const router = Router();
router.use(authenticate);

router.get('/today', requireRole('PARENT'), requirePermission('students.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await family.familyToday(req.actor), 'Today for your family')));

router.get('/fee-statement', requireRole('PARENT'), requirePermission('fees.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await family.feeStatement(req.actor, { fy: req.query.fy, studentId: req.query.studentId }), 'Fee statement')));

router.post('/translate-announcement', requirePermission('announcements.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await family.translateAnnouncement(req.actor, { announcementId: req.body?.announcementId, lang: req.body?.lang }), 'Translation')));

router.get('/languages', asyncHandler(async (_req, res) =>
  sendSuccess(res, family.FAMILY_LANGUAGES.map((code) => ({ code, name: family.languageName(code) })))));

export default router;
