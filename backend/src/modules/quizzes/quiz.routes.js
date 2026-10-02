import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permission.js';
import * as controller from './quiz.controller.js';

const router = Router();
router.use(authenticate);

/**
 * Quizzes reuse the permission keys of the academic work they belong to —
 * setting a quiz is setting work for a class, taking one is submitting work —
 * so no role's grants change and admins manage them from the same Access &
 * Permissions screen. Taking a quiz is additionally limited to the STUDENT
 * role: staff who hold `submissions.submit` at ALL scope have no attempt of
 * their own to make.
 */
const take = [requirePermission('submissions.submit'), requireRole('STUDENT')];
const manage = requirePermission('assignments.manage');

/**
 * @swagger
 * tags:
 *   name: Quizzes
 *   description: MCQ quizzes — set by teachers for their own classes, taken and auto-graded for students
 */

/**
 * @swagger
 * /quizzes:
 *   get:
 *     summary: List quizzes (teacher — own quizzes; student — published quizzes for their class)
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: List of quizzes
 *   post:
 *     summary: Create a draft quiz for one of the teacher's own class + subject assignments
 *     tags: [Quizzes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               subjectOfferingId: { type: string }
 *               sectionId: { type: string }
 *               subjectId: { type: string }
 *               durationMinutes: { type: integer, nullable: true }
 *     responses:
 *       201:
 *         description: Quiz created
 */
router.get('/', requirePermission('assignments.read'), controller.list);
router.post('/', manage, controller.create);

/**
 * @swagger
 * /quizzes/my-attempts:
 *   get:
 *     summary: The signed-in student's submitted quiz attempts
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Previous attempts with scores
 */
// Must come before /:id.
router.get('/my-attempts', ...take, controller.myAttempts);

/**
 * @swagger
 * /quizzes/{id}:
 *   get:
 *     summary: Full quiz for its teacher, answer key included
 *     tags: [Quizzes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quiz with questions
 *   patch:
 *     summary: Update a quiz's title, description, duration or class/subject
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Quiz updated
 *   delete:
 *     summary: Delete a quiz no student has attempted
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Quiz deleted
 */
router.get('/:id', manage, controller.get);
router.patch('/:id', manage, controller.update);
router.delete('/:id', manage, controller.remove);

/**
 * @swagger
 * /quizzes/{id}/questions:
 *   post:
 *     summary: Add an MCQ (exactly one correct option, at least two options)
 *     tags: [Quizzes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, options]
 *             properties:
 *               text: { type: string }
 *               marks: { type: number }
 *               options:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     text: { type: string }
 *                     isCorrect: { type: boolean }
 *     responses:
 *       201:
 *         description: Question added
 */
router.post('/:id/questions', manage, controller.addQuestion);
router.patch('/:id/questions/:questionId', manage, controller.updateQuestion);
router.delete('/:id/questions/:questionId', manage, controller.deleteQuestion);

/**
 * @swagger
 * /quizzes/{id}/publish:
 *   post:
 *     summary: Publish a quiz whose questions are all complete
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Quiz published
 * /quizzes/{id}/unpublish:
 *   post:
 *     summary: Hide a quiz from students
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Quiz unpublished
 */
router.post('/:id/publish', manage, controller.publish);
router.post('/:id/unpublish', manage, controller.unpublish);

/**
 * @swagger
 * /quizzes/{id}/results:
 *   get:
 *     summary: Class roster with each student's quiz score, plus summary statistics
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Results
 */
router.get('/:id/results', requirePermission('submissions.grade'), controller.results);

/**
 * @swagger
 * /quizzes/{id}/take:
 *   get:
 *     summary: Instructions view for a student (no questions)
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Quiz details and the student's attempt status
 * /quizzes/{id}/start:
 *   post:
 *     summary: Start or resume the student's attempt; returns the questions without answers
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Question paper
 * /quizzes/{id}/submit:
 *   post:
 *     summary: Submit answers; graded on the server and returned immediately
 *     tags: [Quizzes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     questionId: { type: string }
 *                     optionId: { type: string }
 *     responses:
 *       201:
 *         description: Result
 * /quizzes/{id}/my-result:
 *   get:
 *     summary: The signed-in student's own result for a quiz
 *     tags: [Quizzes]
 *     responses:
 *       200:
 *         description: Result
 */
router.get('/:id/take', ...take, controller.overview);
router.post('/:id/start', ...take, controller.start);
router.post('/:id/submit', ...take, controller.submit);
router.get('/:id/my-result', ...take, controller.myResult);

export default router;
