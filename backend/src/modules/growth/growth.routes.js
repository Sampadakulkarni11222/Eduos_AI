import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './growth.controller.js';
import { AppError } from '../../utils/AppError.js';
import mongoose from 'mongoose';
import { Enrollment } from '../../models/student.model.js';
import { getGuardianStudentIds, getEnrollmentIdsForStudents, getTeacherSectionIds, getOwnStudentId } from '../../utils/scope.js';

/**
 * Who may read a growth score. Staff with ai.insights.read, as before. A parent
 * (analytics.child.read OWN, no ai.insights.read) for their own child only: the
 * enrolment must belong to one of their linked children. Without this the
 * parent's Student View page was a 403 behind a menu item it shows them.
 */
export async function canReadScore(req, _res, next) {
  try {
    const insights = req.actor?.permissions?.['ai.insights.read'];
    if (insights === 'ALL') { req.scope = 'ALL'; return next(); }
    if (insights) {
      // OWN scope reaches only the caller's own pupils: a teacher's sections, or a student's own record.
      const wanted = String(req.query.enrollmentId ?? '');
      const enrollment = mongoose.isValidObjectId(wanted) ? await Enrollment.findById(wanted).select('sectionId studentId').lean() : null;
      const sections = await getTeacherSectionIds(req.actor.profileId);
      const ownStudent = await getOwnStudentId(req.actor.profileId);
      const allowed = enrollment && (sections.map(String).includes(String(enrollment.sectionId)) || String(enrollment.studentId) === String(ownStudent));
      if (!allowed) throw new AppError("That student's growth view is outside your access.", 403, [], 'OUT_OF_SCOPE');
      req.scope = 'OWN';
      return next();
    }
    if (req.actor?.roleKey === 'PARENT' && req.actor?.permissions?.['analytics.child.read']) {
      const mine = await getEnrollmentIdsForStudents(await getGuardianStudentIds(req.actor.profileId));
      if (!mine.includes(String(req.query.enrollmentId ?? ''))) throw new AppError("You can only see your own child's growth view.", 403, [], 'NOT_YOUR_CHILD');
      req.scope = 'OWN';
      return next();
    }
    throw new AppError('Missing permission: ai.insights.read', 403);
  } catch (err) { return next(err); }
}

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Growth
 *   description: >
 *     Growth score (STAND-IN). Computed with a transparent heuristic
 *     (60% marks + 40% attendance) rather than a trained model Ã¢â‚¬” see
 *     docs/ARCHITECTURE.md for what a real implementation would replace.
 */

/**
 * @swagger
 * /growth/score:
 *   get:
 *     summary: Get (and recompute) a student's growth score for a period
 *     tags: [Growth]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         required: true
 *         schema: { type: string, example: "2026-06" }
 *     responses:
 *       200:
 *         description: Growth score computed
 */
router.get('/score', canReadScore, controller.getScore);

export default router;
