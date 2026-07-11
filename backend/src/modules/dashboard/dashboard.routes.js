import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as ctrl from './dashboard.controller.js';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /dashboard/owner:
 *   get:
 *     summary: Owner dashboard — school-wide KPIs, audit log, CRM, fees
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Owner dashboard data
 */
router.get('/owner', requirePermission('analytics.school.read'), ctrl.ownerDashboard);

/**
 * @swagger
 * /dashboard/admin:
 *   get:
 *     summary: Admin dashboard — students, tickets, announcements, admissions pipeline
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin dashboard data
 */
router.get('/admin', requirePermission('students.read'), ctrl.adminDashboard);

/**
 * @swagger
 * /dashboard/finance:
 *   get:
 *     summary: Finance dashboard — fee collection, pending invoices
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Finance dashboard data
 */
router.get('/finance', requirePermission('fees.read'), ctrl.financeDashboard);

/**
 * @swagger
 * /dashboard/teacher:
 *   get:
 *     summary: Teacher dashboard — own classes, attendance, assignments
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Teacher dashboard data
 */
router.get('/teacher', requirePermission('timetable.read'), ctrl.teacherDashboard);

/**
 * @swagger
 * /dashboard/student:
 *   get:
 *     summary: Student dashboard — attendance, timetable, assignments, exams, fees
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student dashboard data
 */
router.get('/student', requirePermission('attendance.read'), ctrl.studentDashboard);

/**
 * @swagger
 * /dashboard/parent:
 *   get:
 *     summary: Parent dashboard — children's attendance, fees, exams, results
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Parent dashboard data
 */
router.get('/parent', requirePermission('students.read'), ctrl.parentDashboard);

/**
 * @swagger
 * /dashboard/warden:
 *   get:
 *     summary: Warden dashboard — hostel occupancy, maintenance, allocations
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Warden dashboard data
 */
router.get('/warden', requirePermission('hostel.read'), ctrl.wardenDashboard);

/**
 * @swagger
 * /dashboard/librarian:
 *   get:
 *     summary: Librarian dashboard — book catalog, issues, returns, overdue
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Librarian dashboard data
 */
router.get('/librarian', requirePermission('library.read'), ctrl.librarianDashboard);

export default router;
