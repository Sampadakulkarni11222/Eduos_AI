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
import assignmentRoutes from '../modules/assignments/assignment.routes.js';
import examRoutes from '../modules/exams/exam.routes.js';
import feeRoutes from '../modules/fees/fee.routes.js';
import announcementRoutes from '../modules/announcements/announcement.routes.js';
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
router.use('/attendance', attendanceRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/exams', examRoutes);
router.use('/fees', feeRoutes);
router.use('/announcements', announcementRoutes);
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

// ─── One-time Seed Endpoint (protected by secret key) ───────────
// Access via: GET /api/v1/admin-seed?secret=SEED_SECRET_KEY
// Remove this endpoint after first seed is complete.
router.get('/admin-seed', async (req, res) => {
  const { secret } = req.query;
  if (!secret || secret !== (process.env.SEED_SECRET_KEY || 'eduos-seed-2026')) {
    return res.status(403).json({ success: false, message: 'Forbidden: invalid secret key' });
  }
  try {
    const { Permission } = await import('../models/permission.model.js');
    const { Role } = await import('../models/role.model.js');
    const { Account } = await import('../models/account.model.js');
    const { Profile } = await import('../models/profile.model.js');
    const { PERMISSION_CATALOG, SYSTEM_ROLES } = await import('../constants/permissions.js');
    const { DEMO_USERS } = await import('../constants/demoUsers.js');
    const bcrypt = await import('bcryptjs');
    const results = [];

    for (const p of PERMISSION_CATALOG) {
      await Permission.updateOne({ key: p.key }, { $set: { group: p.group, description: p.description, isSystem: true } }, { upsert: true });
    }
    results.push(`✔ Seeded ${PERMISSION_CATALOG.length} permissions`);

    for (const r of SYSTEM_ROLES) {
      await Role.updateOne({ key: r.key }, { $set: { name: r.name, description: r.description ?? '', isSystem: true, permissions: r.grants } }, { upsert: true });
    }
    results.push(`✔ Seeded ${SYSTEM_ROLES.length} roles`);

    for (const u of DEMO_USERS) {
      const role = await Role.findOne({ key: u.roleKey });
      if (!role) { results.push(`✘ Skipped unknown role: ${u.roleKey}`); continue; }
      let account = await Account.findOne({ phoneE164: u.phone });
      if (!account) {
        const passwordHash = u.password ? await bcrypt.default.hash(u.password, 10) : null;
        account = await Account.create({ phoneE164: u.phone, ...(u.email && { email: u.email }), passwordHash });
      }
      const existingProfile = await Profile.findOne({ accountId: account._id, roleId: role._id });
      if (!existingProfile) {
        await Profile.create({ accountId: account._id, roleId: role._id, displayName: u.displayName });
        results.push(`✔ Created user: ${u.roleKey} → ${u.email || u.phone}`);
      } else {
        results.push(`- User already exists: ${u.roleKey}`);
      }
    }

    return res.json({ success: true, message: 'Seed complete!', results });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
