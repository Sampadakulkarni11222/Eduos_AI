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

/**
 * @swagger
 * /attendance/calendar:
 *   get:
 *     summary: Get day-level attendance statuses for a single month (for calendar views)
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: string, example: "2026-07" }
 *     responses:
 *       200:
 *         description: Attendance calendar fetched
 */
router.get('/calendar', requirePermission('attendance.read'), controller.getCalendar);

/**
 * @swagger
 * /attendance/subject-wise:
 *   get:
 *     summary: Per-subject attendance for one enrollment, grouped by subject offering
 *     description: >
 *       `basis` reports where the numbers come from: PERIOD (real per-period
 *       records), DAY (day-level records attributed to the subjects timetabled
 *       that day), or MIXED. Percentages are presentCount/totalSessions.
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: month
 *         schema: { type: string, example: '2026-07' }
 *     responses:
 *       200:
 *         description: Subject-wise attendance fetched
 */
router.get('/subject-wise', requirePermission('attendance.read'), controller.getSubjectWise);

/**
 * @swagger
 * /attendance/trend:
 *   get:
 *     summary: Get monthly attendance percentage trend for the last N months
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 6 }
 *     responses:
 *       200:
 *         description: Attendance trend fetched
 */
router.get('/trend', requirePermission('attendance.read'), controller.getTrend);

/**
 * @swagger
 * /attendance/lectures:
 *   get:
 *     summary: Lecture/period-level attendance for one enrollment
 *     description: >
 *       Returns every per-period attendance record in the range, matched to the
 *       timetable slot it belongs to for subject, room and times. Day-level
 *       records are excluded — they say nothing about an individual lecture.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: month
 *         schema: { type: string, example: '2026-09' }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Lecture attendance fetched
 */
router.get('/lectures', requirePermission('attendance.read'), controller.getLectures);

export default router;
