import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './attendance.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Daily/period attendance marking and summaries
 */

/**
 * @swagger
 * /attendance/roster:
 *   get:
 *     summary: Get a section's roster with attendance status for a given date
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: sectionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Roster fetched
 */
router.get('/roster', requirePermission('attendance.read'), controller.getRoster);

/**
 * @swagger
 * /attendance/mark:
 *   post:
 *     summary: Bulk-mark attendance for a section on a date
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sectionId, date, records]
 *             properties:
 *               sectionId: { type: string }
 *               date: { type: string, format: date }
 *               periodNo: { type: integer, nullable: true }
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     enrollmentId: { type: string }
 *                     status: { type: string, enum: [PRESENT, ABSENT, LATE, EXCUSED, HALF_DAY] }
 *     responses:
 *       201:
 *         description: Attendance marked
 */
router.post('/mark', requirePermission('attendance.mark'), controller.mark);

/**
 * @swagger
 * /attendance/mark/bulk:
 *   post:
 *     summary: Bulk-mark attendance for a section on a date from a CSV file
 *     tags: [Attendance]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [sectionId, date, file]
 *             properties:
 *               sectionId: { type: string }
 *               date: { type: string, format: date }
 *               periodNo: { type: integer, nullable: true }
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Attendance marked (per-row success/failure report)
 */
router.post(
  '/mark/bulk',
  requirePermission('attendance.mark'),
  csvUploadSingle('file'),
  controller.markBulk
);

/**
 * @swagger
 * /attendance/summary:
 *   get:
 *     summary: Get attendance summary counts (optionally by enrollmentId, from, to)
 *     tags: [Attendance]
 *     responses:
 *       200:
 *         description: Attendance summary fetched
 */
router.get('/summary', requirePermission('attendance.read'), controller.getSummary);

export default router;
