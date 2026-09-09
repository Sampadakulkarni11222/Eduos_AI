import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as controller from './exam.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Exams
 *   description: Exams, exam subjects, and marks
 */

/**
 * @swagger
 * /exams:
 *   post:
 *     summary: Create an exam
 *     tags: [Exams]
 *     responses:
 *       201:
 *         description: Exam created
 */
router.post('/', requirePermission('exams.manage'), controller.createExam);

/**
 * @swagger
 * /exams:
 *   get:
 *     summary: List exams (optionally by termId query param)
 *     tags: [Exams]
 *     responses:
 *       200:
 *         description: List of exams
 */
router.get('/', requirePermission('marks.read'), controller.listExams);

/**
 * @swagger
 * /exams/subjects:
 *   get:
 *     summary: List exam subjects (optionally by examId query param). Teachers only see subjects tied to their own classes.
 *     tags: [Exams]
 *     responses:
 *       200:
 *         description: List of exam subjects
 *   post:
 *     summary: Attach a subject offering to an exam with a max marks
 *     tags: [Exams]
 *     responses:
 *       201:
 *         description: Exam subject created
 */
router.get('/subjects', requirePermission('marks.read'), controller.listExamSubjects);
router.post('/subjects', requirePermission('exams.manage'), controller.createExamSubject);

/**
 * @swagger
 * /exams/marks-grid:
 *   get:
 *     summary: Get the full class roster with marks for an exam subject (every enrolled student, entered or not), scoped to OWN for teachers
 *     tags: [Exams]
 *     parameters:
 *       - in: query
 *         name: examSubjectId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Marks grid fetched
 */
router.get('/marks-grid', requirePermission('marks.read'), controller.getMarksGrid);

/**
 * @swagger
 * /exams/performance:
 *   get:
 *     summary: Get published marks/performance for an enrollment
 *     tags: [Exams]
 *     responses:
 *       200:
 *         description: Performance fetched
 */
/**
 * @swagger
 * /exams/performance/history:
 *   get:
 *     summary: Published results for every academic year and term the student has a record in
 *     description: >
 *       Scoped exactly like /performance — a student sees only their own years,
 *       a parent only their child's, a subject teacher only the subjects they
 *       teach. Years with nothing published are returned with empty results
 *       rather than omitted.
 *     tags: [Exams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Performance history fetched
 */
// Declared before /performance so the more specific path wins.
router.get('/performance/history', requirePermission('marks.read'), controller.getPerformanceHistory);

router.get('/performance', requirePermission('marks.read'), controller.getPerformance);

/**
 * @swagger
 * /exams/report-card:
 *   get:
 *     summary: Report card for one enrollment — per-subject grades, totals, percentage and GPA
 *     description: >
 *       Includes published marks only, scoped exactly like /performance: a
 *       parent sees only their own child, a subject teacher only the subjects
 *       they teach in that section.
 *     tags: [Exams]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *         description: Omit for parents/students — resolved from the session
 *       - in: query
 *         name: exam
 *         schema: { type: string }
 *         description: Limit to a single exam by name (e.g. "Unit Test 1")
 *     responses:
 *       200:
 *         description: Report card fetched
 */
router.get('/report-card', requirePermission('marks.read'), controller.getReportCard);

/**
 * @swagger
 * /exams/report-card/pdf:
 *   get:
 *     summary: Download the report card as a PDF
 *     tags: [Exams]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: exam
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Report card PDF stream
 */
router.get('/report-card/pdf', requirePermission('marks.read'), controller.getReportCardPdf);

/**
 * @swagger
 * /exams/marks:
 *   post:
 *     summary: Bulk-enter draft marks for an exam subject
 *     tags: [Exams]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [examSubjectId, entries]
 *             properties:
 *               examSubjectId: { type: string }
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     enrollmentId: { type: string }
 *                     marks: { type: number }
 *                     gradeLabel: { type: string }
 *                     remarks: { type: string }
 *     responses:
 *       201:
 *         description: Marks entered
 */
router.post('/marks', requirePermission('marks.enter'), controller.enterMarks);

/**
 * @swagger
 * /exams/publish:
 *   post:
 *     summary: Publish all draft marks for an exam subject
 *     tags: [Exams]
 *     responses:
 *       200:
 *         description: Marks published
 */
router.post('/publish', requirePermission('marks.publish'), controller.publishMarks);

export default router;
