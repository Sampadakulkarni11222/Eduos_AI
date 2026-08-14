import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './assignment.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Assignments
 *   description: Homework/project assignments and submissions
 */

/**
 * @swagger
 * /assignments:
 *   get:
 *     summary: List assignments (scoped to OWN classes/own enrollment depending on role)
 *     tags: [Assignments]
 *     responses:
 *       200:
 *         description: List of assignments
 *   post:
 *     summary: Create an assignment
 *     tags: [Assignments]
 *     responses:
 *       201:
 *         description: Assignment created
 */
router.get('/', requirePermission('assignments.read'), controller.list);
router.post('/', requirePermission('assignments.manage'), controller.create);

/**
 * @swagger
 * /assignments/grade:
 *   post:
 *     summary: Grade a student's submission for an assignment
 *     tags: [Assignments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignmentId, enrollmentId, marks]
 *             properties:
 *               assignmentId: { type: string }
 *               enrollmentId: { type: string }
 *               marks: { type: number }
 *               feedback: { type: string }
 *     responses:
 *       200:
 *         description: Submission graded
 */
router.post('/grade', requirePermission('submissions.grade'), controller.grade);

/**
 * @swagger
 * /assignments/submit:
 *   post:
 *     summary: Submit a student's work for an assignment
 *     tags: [Assignments]
 *     responses:
 *       201:
 *         description: Assignment submitted
 */
router.post('/submit', requirePermission('submissions.submit'), controller.submit);

/**
 * @swagger
 * /assignments/{id}/submissions:
 *   get:
 *     summary: Submission roster for an assignment (grader view)
 *     tags: [Assignments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Roster of enrollments with submission status
 */
router.get('/:id/submissions', requirePermission('submissions.grade'), controller.listSubmissions);

export default router;
