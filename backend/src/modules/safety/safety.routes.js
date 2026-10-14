import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { requireFeature, featureEnabled } from '../../utils/features.js';
import { deviceAuth, hasDeviceHeaders } from './deviceAuth.js';
import { requireAnyOf, alertDepartments } from './access.js';
import * as shared from './shared.js';
import * as checkpoints from './checkpoints.service.js';
import * as visitors from './visitors.service.js';
import * as pickup from './pickup.service.js';
import * as camera from './camera.service.js';
import * as devices from './devices.service.js';

/**
 * @swagger
 * tags:
 *   - name: Checkpoints
 *     description: ID cards and explicit checkpoints (gate, bus, lab, library). A scan is an event, not proof of presence.
 *   - name: Visitors
 *     description: Visitors and contractors, authorised pickup, delegations, custody restrictions and the release log
 *   - name: Camera
 *     description: Optional pilot. Unverified observations for trained human review; no identification.
 *   - name: Safety
 *     description: Settings, operational alerts, device registry and the emergency roster
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

// ── /checkpoints ──────────────────────────────────────────────────────────
export const checkpointsRouter = Router();
/**
 * @swagger
 * /checkpoints/scan:
 *   post:
 *     summary: A card scan — from a signed reader (X-Device-* headers) or a staff member (bearer token, checkpoints.manage)
 *     tags: [Checkpoints]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *               point: { type: string, enum: [GATE_IN, GATE_OUT, BUS_BOARD, BUS_ALIGHT, LAB, LIBRARY] }
 *               scannedAt: { type: string }
 *               scanId: { type: string, description: "device's own id; a resend is ignored" }
 *               scans: { type: array, description: a buffered batch }
 */
checkpointsRouter.post(
  '/scan',
  (req, res, next) => (hasDeviceHeaders(req) ? deviceAuth(['CHECKPOINT'])(req, res, next) : authenticate(req, res, next)),
  (req, res, next) => (req.device ? next() : requirePermission('checkpoints.manage')(req, res, next)),
  requireFeature('idCheckpoints'),
  ok((r) => checkpoints.scan(r.device ? { device: r.device } : { actor: r.actor }, r.body)),
);
checkpointsRouter.use(authenticate, requireFeature('idCheckpoints'));
checkpointsRouter.get('/my-children', requirePermission('checkpoints.read'), ok((r) => checkpoints.myChildren(r.actor, r.query)));
checkpointsRouter.get('/events', requirePermission('checkpoints.read', 'ALL'), ok((r) => checkpoints.events(r.query)));
checkpointsRouter.get('/attendance-suggestions', requireAnyOf(['checkpoints.read', 'ALL'], ['attendance.mark', 'ALL'], ['attendance.read', 'ALL']), ok((r) => checkpoints.attendanceSuggestions(r.query)));
checkpointsRouter.get('/cards', requirePermission('checkpoints.read', 'ALL'), ok((r) => checkpoints.listCards(r.query)));
checkpointsRouter.post('/cards', requirePermission('checkpoints.manage'), ok((r) => checkpoints.issueCard(r.actor, r.body), 'Card issued', 201));
checkpointsRouter.get('/cards/:id/history', requirePermission('checkpoints.read', 'ALL'), ok((r) => checkpoints.cardHistory(r.params.id)));
checkpointsRouter.post('/cards/:id/block', requirePermission('checkpoints.manage'), ok((r) => checkpoints.blockCard(r.actor, r.params.id, r.body)));
checkpointsRouter.post('/cards/:id/replace', requirePermission('checkpoints.manage'), ok((r) => checkpoints.replaceCard(r.actor, r.params.id, r.body), 'Card replaced', 201));

// ── /visitors ─────────────────────────────────────────────────────────────
export const visitorsRouter = Router();
visitorsRouter.use(authenticate, requireFeature('visitors'));
const vm = requirePermission('visitors.manage');
visitorsRouter.get('/', vm, ok((r) => visitors.list(r.query)));
// Any staff member may pre-register their own visitor (they are the host).
visitorsRouter.get('/hosting', ok((r) => visitors.mineAsHost(r.actor)));
visitorsRouter.post('/', (req, _res, next) => {
  if (['PARENT', 'STUDENT', 'ALUMNUS'].includes(req.actor?.roleKey)) throw new AppError('Visitors are registered by school staff.', 403);
  if (req.body?.hostProfileId && req.body.hostProfileId !== req.actor?.profileId && !req.actor?.permissions?.['visitors.manage']) throw new AppError('Missing permission: visitors.manage', 403);
  next();
}, ok((r) => visitors.create(r.actor, r.body), 'Visitor registered', 201));
visitorsRouter.post('/:id/host-decision', ok((r) => visitors.hostDecision(r.actor, r.params.id, r.body)));
visitorsRouter.post('/:id/check-in', vm, ok((r) => visitors.checkIn(r.actor, r.params.id, r.body)));
visitorsRouter.post('/:id/check-out', vm, ok((r) => visitors.checkOut(r.actor, r.params.id, r.body)));
visitorsRouter.post('/:id/cancel', vm, ok((r) => visitors.cancel(r.actor, r.params.id, r.body)));

// ── /pickup ───────────────────────────────────────────────────────────────
export const pickupRouter = Router();
pickupRouter.use(authenticate, requireFeature('visitors'));
// Guardians: their own children's delegates (no restrictions shown).
pickupRouter.get('/mine', ok((r) => pickup.guardianList(r.actor)));
pickupRouter.post('/mine/delegates', ok((r) => pickup.guardianRequest(r.actor, r.body), 'Code sent', 201));
pickupRouter.post('/mine/delegates/:id/confirm', ok((r) => pickup.guardianConfirm(r.actor, r.params.id, r.body)));
pickupRouter.post('/mine/delegates/:id/revoke', ok((r) => pickup.revoke(r.actor, r.params.id, r.body, { asGuardian: true })));
// Office.
pickupRouter.get('/students/:studentId', vm, ok((r) => pickup.listForStudentStaff(r.params.studentId)));
pickupRouter.post('/adults', vm, ok((r) => pickup.staffCreate(r.actor, r.body), 'Saved', 201));
pickupRouter.post('/adults/:id/revoke', vm, ok((r) => pickup.revoke(r.actor, r.params.id, r.body)));
pickupRouter.post('/release', vm, ok((r) => pickup.release(r.actor, r.body), 'Release recorded', 201));
pickupRouter.get('/releases', vm, ok((r) => pickup.releaseLog(r.query)));

// ── /camera ───────────────────────────────────────────────────────────────
export const cameraRouter = Router();
cameraRouter.post('/events', deviceAuth(['CAMERA']), requireFeature('camera'), ok((r) => camera.ingest(r.device, r.body), 'Observation received (unverified)', 201));
cameraRouter.post('/heartbeat', deviceAuth(['CAMERA']), requireFeature('camera'), ok((r) => camera.heartbeat(r.device)));
cameraRouter.use(authenticate);
const camRead = requireAnyOf(['camera.events.review'], ['camera.devices.manage']);
const review = requirePermission('camera.events.review');
// Reachable with the feature off, so the screen can say it is off.
cameraRouter.get('/status', camRead, ok(async () => ({ enabled: await featureEnabled('camera'), limits: camera.CAMERA_LIMITS })));
cameraRouter.use(requireFeature('camera'));
cameraRouter.get('/devices', camRead, ok(() => camera.devices()));
cameraRouter.get('/observations', review, ok((r) => camera.queue(r.query)));
cameraRouter.get('/observations/:id', review, ok((r) => camera.get(r.actor, r.params.id)));
cameraRouter.post('/observations/:id/review', review, ok((r) => camera.review(r.actor, r.params.id, r.body)));
cameraRouter.post('/observations/:id/link-case', review, ok((r) => camera.linkCase(r.actor, r.params.id, r.body)));
cameraRouter.get('/metrics', review, ok((r) => camera.metrics(r.query)));

// ── /class-check-ins (teachers; feeds the unattended-room reconciliation) ──
export const classCheckInRouter = Router();
classCheckInRouter.use(authenticate);
const teacherish = (req, _res, next) => {
  if (['PARENT', 'STUDENT', 'ALUMNUS'].includes(req.actor?.roleKey)) throw new AppError('Class check-in is for teachers', 403);
  next();
};
classCheckInRouter.get('/mine', teacherish, ok((r) => camera.myCheckIns(r.actor, r.query)));
classCheckInRouter.post('/', teacherish, ok((r) => camera.checkIn(r.actor, r.body), 'Checked in', 201));

// ── /safety ───────────────────────────────────────────────────────────────
export const safetyRouter = Router();
safetyRouter.use(authenticate);
const anyManage = requireAnyOf(['transport.fleet.manage'], ['checkpoints.manage'], ['visitors.manage'], ['hostel.outpass.manage'], ['camera.devices.manage']);
safetyRouter.get('/settings', anyManage, ok(async () => shared.getSettings()));
safetyRouter.put('/settings', anyManage, ok((r) => shared.updateSettings(r.actor, r.body)));
safetyRouter.get('/alerts', ok(async (r) => {
  const departments = alertDepartments(r.actor);
  if (!departments.length) throw new AppError('Missing permission to see safety alerts', 403);
  const wanted = r.query.department ? departments.filter((d) => d === String(r.query.department).toUpperCase()) : departments;
  return shared.listAlerts(r.query, { departments: wanted });
}));
safetyRouter.post('/alerts/:id', ok(async (r) => {
  const departments = alertDepartments(r.actor);
  if (!departments.length) throw new AppError('Missing permission to act on safety alerts', 403);
  return shared.closeAlert(r.actor, r.params.id, r.body, { departments });
}));
safetyRouter.get('/devices', anyManage, ok((r) => devices.list(r.actor, r.query)));
safetyRouter.post('/devices', anyManage, ok((r) => devices.create(r.actor, r.body), 'Device registered', 201));
safetyRouter.post('/devices/:id/rotate-secret', anyManage, ok((r) => devices.rotateSecret(r.actor, r.params.id)));
safetyRouter.post('/devices/:id/status', anyManage, ok((r) => devices.setStatus(r.actor, r.params.id, r.body)));
/**
 * @swagger
 * /safety/emergency-roster:
 *   get:
 *     summary: Who is on campus now (register minus releases and out-passes, plus visitors checked in). ?format=csv to download.
 *     tags: [Safety]
 */
safetyRouter.get('/emergency-roster', requireAnyOf(['visitors.manage'], ['checkpoints.read', 'ALL']), asyncHandler(async (req, res) => {
  const roster = await pickup.emergencyRoster();
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="emergency-roster-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pickup.rosterCsv(roster));
  }
  return sendSuccess(res, roster);
}));
