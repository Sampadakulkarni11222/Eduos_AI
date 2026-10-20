import { Router } from 'express';
import { sendSuccess } from '../utils/response.js';
import { env } from '../config/env.js';

import authRoutes from '../modules/auth/auth.routes.js';
import roleRoutes from '../modules/roles/role.routes.js';
import profileRoutes from '../modules/profiles/profile.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import permissionRoutes from '../modules/permissions/permission.routes.js';
import schoolRoutes from '../modules/schools/school.routes.js';
import academicsRoutes from '../modules/academics/academics.routes.js';
import studentRoutes from '../modules/students/student.routes.js';
import enrollmentRoutes from '../modules/students/enrollment.routes.js';
import timetableRoutes from '../modules/timetable/timetable.routes.js';
import shiftRoutes from '../modules/shifts/shifts.routes.js';
import staffProfileRoutes from '../modules/staff/credentials.routes.js';
import attendanceRoutes from '../modules/attendance/attendance.routes.js';
import attendanceOcrRoutes from '../modules/attendance/ocr.routes.js';
import leaveRoutes from '../modules/leave/leave.routes.js';
import assignmentRoutes from '../modules/assignments/assignment.routes.js';
import examRoutes from '../modules/exams/exam.routes.js';
import quizRoutes from '../modules/quizzes/quiz.routes.js';
import { requestRouter as documentRequestRoutes, typeRouter as documentTypeRoutes } from '../modules/documentRequests/documentRequest.routes.js';
import feeRoutes from '../modules/fees/fee.routes.js';
import announcementRoutes from '../modules/announcements/announcement.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import calendarRoutes from '../modules/calendar/calendar.routes.js';
import ticketRoutes from '../modules/tickets/ticket.routes.js';
import medicalRoutes from '../modules/medical/medical.routes.js';
import registrationRoutes from '../modules/registrations/registration.routes.js';
import studentRequestRoutes from '../modules/studentRequests/studentRequests.routes.js';
import admissionRoutes from '../modules/admissions/admission.routes.js';
import growthRoutes from '../modules/growth/growth.routes.js';
// Part 4 (parent): the family desk.
import familyRoutes from '../modules/family/family.routes.js';
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
import seatRoutes from '../modules/seats/seat.routes.js';
import customizationRoutes from '../modules/customization/customization.routes.js';
import domainRoutes from '../modules/domains/domain.routes.js';
import uploadRoutes from '../modules/uploads/upload.routes.js';
import importRoutes from '../modules/imports/imports.routes.js';
// Institution operations (see docs/erp-operations).
import approvalRoutes from '../modules/approvals/approval.routes.js';
import messagingRoutes from '../modules/messaging/messaging.routes.js';
import automationRoutes from '../modules/automations/automations.routes.js';
import { institutionRouter, orgRouter } from '../modules/institution/institution.routes.js';
import {
  correspondenceRouter, facilitiesRouter, eventsRouter, contractsRouter, verificationRouter,
  complianceRouter, safeguardingRouter, governanceRouter,
} from '../modules/administration/administration.routes.js';
import { payrollRouter, procurementRouter, budgetRouter } from '../modules/finance-ops/finance-ops.routes.js';
import { communityRouter, marketingRouter } from '../modules/community/community.routes.js';
import { campusRouter, insightsRouter } from '../modules/campus/campus.routes.js';
import { auditLogger } from '../middleware/auditLogger.js';
import { signUploadUrlsInResponses, unsignUploadUrlsInBody } from '../modules/uploads/signedUrls.js';
import lectureRoutes from '../modules/lectures/lecture.routes.js';
import syllabusRoutes from '../modules/syllabus/syllabus.routes.js';
import tasksRoutes from '../modules/tasks/tasks.routes.js';
// Transport fleet/trips/GPS, ID checkpoints, visitors and pickup, hostel out-pass, optional camera review.
import fleetRoutes from '../modules/fleet/fleet.routes.js';
import outpassRoutes from '../modules/hostel/outpass.routes.js';
import { checkpointsRouter, visitorsRouter, pickupRouter, cameraRouter, classCheckInRouter, safetyRouter } from '../modules/safety/safety.routes.js';
// Optional live CCTV viewing (feature cctvLive): staff API and token-authenticated playback proxy.
import { cctvRouter, cctvPlayRouter } from '../modules/cctv/cctv.routes.js';
// PTM, review calls, conversations, staff leave/cover, term report cards.
import { ptmRouter, reviewCallsRouter } from '../modules/ptm/ptm.routes.js';
import conversationRoutes from '../modules/conversations/conversations.routes.js';
import staffRoutes from '../modules/staff/staff.routes.js';
import reportCardRoutes from '../modules/reportcards/reportcards.routes.js';
import teachingRoutes from '../modules/teaching/teaching.routes.js'; // Part 4: lesson plans, question bank, CPD hours.
import analyticsRoutes from '../modules/analytics/analytics.routes.js';
import labsRoutes from '../modules/labs/labs.routes.js';
import billsRoutes from '../modules/bills/bills.routes.js';
// Clubs, teams, houses, fixtures; achievement and top-ranker showcase.
import clubsRoutes from '../modules/clubs/clubs.routes.js';
import showcaseRoutes from '../modules/showcase/showcase.routes.js';
// Sustainability, public online admission form, library accession/scan, AI drafts.
import sustainabilityRoutes from '../modules/sustainability/sustainability.routes.js';
import { publicAdmissionRouter, onlineApplicationsRouter } from '../modules/admissions/online.routes.js';
import libraryCopiesRoutes from '../modules/library/library.copies.routes.js';
// Part 4 (support roles): library desk, hostel life, data protection, admissions follow-ups.
import libraryDeskRoutes from '../modules/library/library.desk.routes.js';
import hostelLifeRoutes from '../modules/hostel/life.routes.js';
import privacyRoutes from '../modules/compliance/privacy.routes.js';
import followupRoutes from '../modules/marketing/followups.routes.js';
import aiDraftsRoutes from '../modules/ai/drafts.routes.js';
import { feeAdjustmentsRouter, accountsExportRouter } from '../modules/fees/finance-extras.routes.js';
// Alumni lifecycle and community, newsroom social publishing (staff only), daily learning digest.
import alumniRoutes from '../modules/alumni/alumni.routes.js';
// Part 4: student and alumnus audit (alumni certificates, give-back board, student planner).
import { alumniServicesRouter, plannerRouter } from '../modules/p4StudentAlumnus/p4StudentAlumnus.routes.js';
import socialRoutes from '../modules/social/social.routes.js';
import digestRoutes from '../modules/digest/digest.routes.js';
// Part 4: opportunities and the interactive weekly / monthly newsletter.
import newsletterRoutes, { publicNewsletterRouter } from '../modules/newsletter/newsletter.routes.js';
// Part 2 gaps: student support plans.
import supportPlanRoutes from '../modules/support/support.routes.js';
// Part 3: school health room.
import healthRoutes from '../modules/health/health.routes.js';
// Part 4 (finance, HR, nurse audit): collections reports and cash close, recruitment, exits, the nurse's watch list.
import { financeReportsRouter, recruitmentRouter, exitsRouter, healthInsightsRouter } from '../modules/p4ops/p4ops.routes.js';
import schoolPolicyRoutes from '../modules/policy/policy.routes.js';
import portfolioRoutes from '../modules/portfolios/portfolios.routes.js';
import scenarioRoutes from '../modules/scenarios/scenarios.routes.js';
// Part 4 (leadership): attendance overview, teacher workload, board packs, certificates.
import leadershipRoutes from '../modules/leadership/leadership.routes.js';
// Part 8: exam halls, Rooms & Classes and room shifts.
import examRoomsRoutes from '../modules/examRooms/examRooms.routes.js';
import { offlineIdempotency } from '../middleware/idempotency.js';
// Universal search; newsroom social sharing; offline marketing, ad connectors and attribution.
import searchRoutes from '../modules/search/search.routes.js';
import genuiRoutes from '../modules/genui/genui.routes.js';
import newsroomSocialRoutes from '../modules/social/newsroom-social.routes.js';
import { growthRouter, publicMarketingRouter } from '../modules/marketing/growth.routes.js';
// Part 3: OAuth connections to ad/social providers (live ad sync, live posting) and the app-level Meta webhook.
import { integrationsRouter, publicIntegrationsRouter } from '../modules/integrations/integrations.routes.js';

const router = Router();

// File links: every /uploads path leaving in a response is signed and
// expiring; signed links coming back in a request body are stored canonical.
// See modules/uploads/signedUrls.js.
router.use(unsignUploadUrlsInBody);
router.use(signUploadUrlsInResponses);

// Global audit logging for state-modifying requests
router.use(auditLogger);

// Offline queues replay attendance, lab, checkpoint, sanitation and check-in writes with an
// Idempotency-Key; a replay returns the first response and never writes twice.
router.use(offlineIdempotency);


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
// Checks the database as well as the process: an instance that is serving HTTP
// but has lost MongoDB answers 503, so a load balancer stops sending it
// traffic. The body says "ok" or "unavailable" and nothing about the target.
router.get('/health', async (_req, res) => {
  const { databaseHealth } = await import('../config/db.js');
  const database = await databaseHealth();
  const healthy = database === 'ok';
  sendSuccess(
    res,
    { status: healthy ? 'ok' : 'degraded', database, env: env.NODE_ENV, timestamp: new Date().toISOString() },
    healthy ? 'Server is healthy' : 'Database unavailable',
    healthy ? 200 : 503
  );
});

// ─── Module routes ──────────────────────────────────────────────
// Public (no sign-in): the per-school online admission form.
router.use('/public/admissions', publicAdmissionRouter);
router.use('/public/newsletter', publicNewsletterRouter);
// Public (no sign-in): campaign tracking links and the HMAC-verified lead webhook.
router.use('/public/marketing', publicMarketingRouter);
router.use('/public/integrations', publicIntegrationsRouter);
router.use('/auth', authRoutes);
router.use('/roles', roleRoutes);
router.use('/profiles', profileRoutes);
router.use('/users', userRoutes);
router.use('/permissions', permissionRoutes);
router.use('/schools', schoolRoutes);
router.use('/academics', academicsRoutes);
router.use('/students', studentRoutes);
router.use('/enrollments', enrollmentRoutes);
router.use('/timetable', timetableRoutes);
router.use('/shifts', shiftRoutes);
router.use('/staff-profile', staffProfileRoutes);
router.use('/attendance/ocr', attendanceOcrRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/exams', examRoutes);
router.use('/quizzes', quizRoutes);
router.use('/document-requests', documentRequestRoutes);
router.use('/document-types', documentTypeRoutes);
router.use('/fees', feeRoutes);
router.use('/announcements', announcementRoutes);
router.use('/notifications', notificationRoutes);
router.use('/calendar', calendarRoutes);
router.use('/tickets', ticketRoutes);
router.use('/medical', medicalRoutes);
router.use('/registrations', registrationRoutes);
router.use('/student-requests', studentRequestRoutes);
router.use('/admissions/online', onlineApplicationsRouter);
router.use('/admissions', admissionRoutes);
router.use('/growth', growthRoutes);
router.use('/risk', riskRoutes);
router.use('/ai/drafts', aiDraftsRoutes);
router.use('/ai', aiRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/observability', observabilityRoutes);
router.use('/library/copies', libraryCopiesRoutes);
router.use('/library/desk', libraryDeskRoutes);
router.use('/hostel/life', hostelLifeRoutes);
router.use('/compliance/privacy', privacyRoutes);
router.use('/admissions/followups', followupRoutes);
router.use('/library', libraryRoutes);
router.use('/hostel', hostelRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/documents', documentRoutes);
router.use('/transport', transportRoutes);
router.use('/audit', auditRoutes);
router.use('/seats', seatRoutes);
router.use('/customization', customizationRoutes);
router.use('/domains', domainRoutes);
router.use('/uploads', uploadRoutes);
// Part 7: bulk import through Ask AI (sheet upload, templates, error reports).
router.use('/imports', importRoutes);
router.use('/approvals', approvalRoutes);
router.use('/messaging', messagingRoutes);
// Part 7: school automations, drafts, opt-ins, personal reminders and "what needs you today".
router.use('/automations', automationRoutes);
router.use('/institution', institutionRouter);
router.use('/org', orgRouter);
router.use('/correspondence', correspondenceRouter);
router.use('/facilities', facilitiesRouter);
router.use('/institution-events', eventsRouter);
router.use('/contracts', contractsRouter);
router.use('/verification', verificationRouter);
router.use('/compliance', complianceRouter);
router.use('/safeguarding', safeguardingRouter);
router.use('/governance', governanceRouter);
router.use('/payroll', payrollRouter);
router.use('/procurement', procurementRouter);
router.use('/budgets', budgetRouter);
router.use('/lectures', lectureRoutes);
router.use('/syllabus', syllabusRoutes);
router.use('/teaching', teachingRoutes);
router.use('/tasks', tasksRoutes);
router.use('/fleet', fleetRoutes);
router.use('/checkpoints', checkpointsRouter);
router.use('/visitors', visitorsRouter);
router.use('/pickup', pickupRouter);
router.use('/outpass', outpassRoutes);
router.use('/camera', cameraRouter);
router.use('/cctv/play', cctvPlayRouter);
router.use('/cctv', cctvRouter);
router.use('/class-check-ins', classCheckInRouter);
router.use('/safety', safetyRouter);
router.use('/ptm', ptmRouter);
router.use('/review-calls', reviewCallsRouter);
router.use('/conversations', conversationRoutes);
router.use('/staff', staffRoutes);
router.use('/report-cards', reportCardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/labs', labsRoutes);
router.use('/bills', billsRoutes);
router.use('/clubs', clubsRoutes);
router.use('/showcase', showcaseRoutes);
router.use('/sustainability', sustainabilityRoutes);
router.use('/fee-adjustments', feeAdjustmentsRouter);
router.use('/accounts-export', accountsExportRouter);
router.use('/community', communityRouter);
router.use('/marketing', marketingRouter);
router.use('/campus', campusRouter);
router.use('/insights', insightsRouter);
router.use('/alumni', alumniRoutes);
router.use('/alumni-services', alumniServicesRouter);
router.use('/student-planner', plannerRouter);
router.use('/social', socialRoutes);
router.use('/digest', digestRoutes);
router.use('/newsletter', newsletterRoutes);
router.use('/support-plans', supportPlanRoutes);
router.use('/health', healthRoutes);
router.use('/finance-reports', financeReportsRouter);
router.use('/recruitment', recruitmentRouter);
router.use('/exits', exitsRouter);
router.use('/health-insights', healthInsightsRouter);
router.use('/school-policy', schoolPolicyRoutes);
router.use('/portfolios', portfolioRoutes);
router.use('/scenarios', scenarioRoutes);
router.use('/search', searchRoutes);
router.use('/genui', genuiRoutes);
router.use('/newsroom-social', newsroomSocialRoutes);
router.use('/marketing-growth', growthRouter);
router.use('/integrations', integrationsRouter);
router.use('/family', familyRoutes);
router.use('/leadership', leadershipRoutes);
router.use('/exam-rooms', examRoomsRoutes);

// NOTE — a public GET /admin-seed endpoint used to live here, gated only by a
// hardcoded default secret ('eduos-seed-2026'). Anyone who could reach the API
// could (re)create every demo account, including the platform Super Admin, with the shared demo
// password. Seeding is an operator task: run `npm run seed` with shell access
// to the deployment instead.

export default router;
