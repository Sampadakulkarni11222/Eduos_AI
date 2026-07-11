import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './student.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Enrollments
 *   description: Student-in-section-for-year enrollment records
 */

/**
 * @swagger
 * /enrollments:
 *   get:
 *     summary: List enrollments (filter by sectionId, academicYearId, studentId query params)
 *     tags: [Enrollments]
 *     responses:
 *       200:
 *         description: List of enrollments
 *   post:
 *     summary: Enroll a student into a section for an academic year
 *     tags: [Enrollments]
 *     responses:
 *       201:
 *         description: Student enrolled
 */
router.get('/', requirePermission('students.read'), controller.listEnrollments);

/**
 * @swagger
 * /enrollments/next-roll-no:
 *   get:
 *     summary: Get the next suggested roll number for a section+year
 *     tags: [Enrollments]
 *     parameters:
 *       - in: query
 *         name: sectionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: academicYearId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Next roll number
 */
router.get('/next-roll-no', requirePermission('students.read'), controller.getNextRollNo);

router.post('/', requirePermission('enrollments.manage'), controller.enroll);

/**
 * @swagger
 * /enrollments/bulk:
 *   post:
 *     summary: Bulk-assign students to a section for an academic year from a CSV file
 *     tags: [Enrollments]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [sectionId, academicYearId, file]
 *             properties:
 *               sectionId: { type: string }
 *               academicYearId: { type: string }
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Students enrolled (per-row success/failure report)
 */
router.post(
  '/bulk',
  requirePermission('enrollments.manage'),
  csvUploadSingle('file'),
  controller.bulkEnroll
);

/**
 * @swagger
 * /enrollments/{id}/status:
 *   patch:
 *     summary: Update an enrollment's status (ACTIVE/TRANSFERRED/WITHDRAWN/GRADUATED)
 *     tags: [Enrollments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enrollment status updated
 */
router.patch('/:id/status', requirePermission('enrollments.manage'), controller.updateEnrollmentStatus);

export default router;
