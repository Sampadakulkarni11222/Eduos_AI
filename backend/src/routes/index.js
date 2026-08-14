import { Router } from 'express';
import { sendSuccess } from '../utils/response.js';
import { env } from '../config/env.js';

import authRoutes from '../modules/auth/auth.routes.js';
import roleRoutes from '../modules/roles/role.routes.js';
import profileRoutes from '../modules/profiles/profile.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import permissionRoutes from '../modules/permissions/permission.routes.js';
import academicsRoutes from '../modules/academics/academics.routes.js';
import studentRoutes from '../modules/students/student.routes.js';
import enrollmentRoutes from '../modules/students/enrollment.routes.js';
import timetableRoutes from '../modules/timetable/timetable.routes.js';
import attendanceRoutes from '../modules/attendance/attendance.routes.js';
import attendanceOcrRoutes from '../modules/attendance/ocr.routes.js';
import leaveRoutes from '../modules/leave/leave.routes.js';
import assignmentRoutes from '../modules/assignments/assignment.routes.js';
import examRoutes from '../modules/exams/exam.routes.js';
import feeRoutes from '../modules/fees/fee.routes.js';
import announcementRoutes from '../modules/announcements/announcement.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import calendarRoutes from '../modules/calendar/calendar.routes.js';
import ticketRoutes from '../modules/tickets/ticket.routes.js';
import medicalRoutes from '../modules/medical/medical.routes.js';
import admissionRoutes from '../modules/admissions/admission.routes.js';
import growthRoutes from '../modules/growth/growth.routes.js';
import riskRoutes from '../modules/risk/risk.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import whatsappRoutes from '../modules/whatsapp/whatsapp.routes.js';
import observabilityRoutes from '../modules/observability/observability.routes.js';
import libraryRoutes from '../modules/library/library.routes.js';
import hostelRoutes from '../modules/hostel/hostel.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import documentRoutes from '../modules/documents/document.routes.js';
import transportRoutes from '../modules/transport/transport.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import uploadRoutes from '../modules/uploads/upload.routes.js';
import { auditLogger } from '../middleware/auditLogger.js';

const router = Router();

// Global audit logging for state-modifying requests
router.use(auditLogger);


/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     security: []
 *     responses:
 *       200:
 *         description: API is up and running
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/health', (_req, res) =>
  sendSuccess(
    res,
    { status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() },
    'Server is healthy'
  )
);

// ─── Module routes ──────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/roles', roleRoutes);
router.use('/profiles', profileRoutes);
router.use('/users', userRoutes);
router.use('/permissions', permissionRoutes);
router.use('/academics', academicsRoutes);
router.use('/students', studentRoutes);
router.use('/enrollments', enrollmentRoutes);
router.use('/timetable', timetableRoutes);
router.use('/attendance/ocr', attendanceOcrRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/exams', examRoutes);
router.use('/fees', feeRoutes);
router.use('/announcements', announcementRoutes);
router.use('/notifications', notificationRoutes);
router.use('/calendar', calendarRoutes);
router.use('/tickets', ticketRoutes);
router.use('/medical', medicalRoutes);
router.use('/admissions', admissionRoutes);
router.use('/growth', growthRoutes);
router.use('/risk', riskRoutes);
router.use('/ai', aiRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/observability', observabilityRoutes);
router.use('/library', libraryRoutes);
router.use('/hostel', hostelRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/documents', documentRoutes);
router.use('/transport', transportRoutes);
router.use('/audit', auditRoutes);
router.use('/uploads', uploadRoutes);

// NOTE — a public GET /admin-seed endpoint used to live here, gated only by a
// hardcoded default secret ('eduos-seed-2026'). Anyone who could reach the API
// could (re)create every demo account, including OWNER, with the shared demo
// password. Seeding is an operator task: run `npm run seed` with shell access
// to the deployment instead.

export default router;
