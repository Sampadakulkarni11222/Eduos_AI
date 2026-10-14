import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { deviceAuth } from '../safety/deviceAuth.js';
import { requireAnyOf } from '../safety/access.js';
import * as vehicles from './vehicles.service.js';
import * as trips from './trips.service.js';
import * as telemetry from './telemetry.service.js';

/**
 * @swagger
 * tags:
 *   name: Fleet
 *   description: >
 *     Vehicles (capacity, papers, service, fuel, breakdowns), trips (seat
 *     allocation, boarding, safe handover, reconciliation), GPS telemetry from
 *     signed devices, and "my bus today" for families.
 */
const router = Router();
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

/**
 * @swagger
 * /fleet/telemetry:
 *   post:
 *     summary: GPS fixes from a registered device (HMAC-signed; see deviceAuth.js)
 *     security: []
 *     tags: [Fleet]
 *     parameters:
 *       - { in: header, name: X-Device-Id, required: true, schema: { type: string } }
 *       - { in: header, name: X-Device-Timestamp, required: true, schema: { type: string } }
 *       - { in: header, name: X-Device-Nonce, required: true, schema: { type: string } }
 *       - { in: header, name: X-Device-Signature, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               points:
 *                 type: array
 *                 items: { type: object, properties: { seq: { type: integer }, eventAt: { type: string }, lat: { type: number }, lng: { type: number }, speedKmh: { type: number }, heading: { type: number } } }
 *     responses:
 *       200: { description: Accepted, duplicate and rejected counts }
 *       401: { description: Bad signature, stale timestamp or replayed nonce }
 */
router.post('/telemetry', deviceAuth(['GPS']), requireFeature('fleet'), requireFeature('gpsTracking'), ok((r) => telemetry.ingest(r.device, r.body)));

router.use(authenticate, requireFeature('fleet'));

const manage = requirePermission('transport.fleet.manage');
// Whole-school reading: the transport office, the principal, transport.read holders.
const readAll = requireAnyOf(['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate', 'ALL'], ['transport.read', 'ALL']);
// Trips: the above at ALL, or a teacher on bus duty at OWN.
const tripRead = requireAnyOf(['transport.fleet.manage'], ['transport.tracking.read', 'ALL'], ['transport.trips.operate']);
const operate = requireAnyOf(['transport.fleet.manage'], ['transport.trips.operate']);

/**
 * @swagger
 * /fleet/my-trips:
 *   get:
 *     summary: My bus today — a parent's own children, or a student's own trips
 *     description: Only the child's own allocation, trip status, stop and an ETA labelled as an estimate. Never other children or the driver's other trips.
 *     tags: [Fleet]
 */
router.get('/my-trips', ok((r) => trips.myTrips(r.actor)));

router.get('/vehicles', readAll, ok((r) => vehicles.list(r.query)));
router.post('/vehicles', manage, ok((r) => vehicles.create(r.actor, r.body), 'Vehicle added', 201));
router.get('/vehicles/:id', readAll, ok((r) => vehicles.get(r.params.id)));
router.patch('/vehicles/:id', manage, ok((r) => vehicles.update(r.actor, r.params.id, r.body)));
router.post('/vehicles/:id/status', manage, ok((r) => vehicles.setStatus(r.actor, r.params.id, r.body)));
router.post('/vehicles/:id/logs', manage, ok((r) => vehicles.addLog(r.actor, r.params.id, r.body), 'Recorded', 201));
router.post('/vehicles/:id/logs/:logId/resolve', manage, ok((r) => vehicles.resolveBreakdown(r.actor, r.params.id, r.params.logId, r.body)));
router.put('/vehicles/:id/gps-device', manage, ok((r) => vehicles.attachGpsDevice(r.actor, r.params.id, r.body?.deviceId ?? null)));
router.get('/vehicles/:id/track', readAll, ok((r) => telemetry.track(r.params.id, r.query)));
router.get('/fuel', manage, ok((r) => vehicles.fuelSummary(r.query)));
router.get('/live', readAll, ok(() => telemetry.livePositions()));

router.get('/trips', tripRead, ok((r) => trips.list(r.actor, r.scope, r.query)));
router.post('/trips', manage, ok((r) => trips.create(r.actor, r.body), 'Trip planned', 201));
router.post('/trips/plan-day', manage, ok((r) => trips.planDay(r.actor, r.body)));
router.get('/trips/:id', tripRead, ok((r) => trips.get(r.actor, r.scope, r.params.id)));
router.post('/trips/:id/crew', manage, ok((r) => trips.assignCrew(r.actor, r.params.id, r.body)));
router.post('/trips/:id/substitute', manage, ok((r) => trips.substituteVehicle(r.actor, r.params.id, r.body)));
router.post('/trips/:id/cancel', manage, ok((r) => trips.cancel(r.actor, r.params.id, r.body)));
router.post('/trips/:id/allocate', operate, ok((r) => trips.allocate(r.actor, r.scope, r.params.id, r.body), 'Seat allocated', 201));
router.post('/trips/:id/allocate-enrolled', operate, ok((r) => trips.allocateEnrolled(r.actor, r.scope, r.params.id)));
router.post('/trips/:id/allocations/:allocationId/release', operate, ok((r) => trips.release(r.actor, r.scope, r.params.id, r.params.allocationId, r.body)));
router.post('/trips/:id/start', operate, ok((r) => trips.start(r.actor, r.scope, r.params.id)));
router.post('/trips/:id/stops/:stopId', operate, ok((r) => trips.markStop(r.actor, r.scope, r.params.id, r.params.stopId, r.body)));
router.post('/trips/:id/board', operate, ok((r) => trips.board(r.actor, r.scope, r.params.id, r.body)));
router.post('/trips/:id/alight', operate, ok((r) => trips.alight(r.actor, r.scope, r.params.id, r.body)));
router.post('/trips/:id/no-show', operate, ok((r) => trips.markNoShow(r.actor, r.scope, r.params.id, r.body)));
router.post('/trips/:id/handover', operate, ok((r) => trips.handover(r.actor, r.scope, r.params.id, r.body)));
router.post('/trips/:id/reconcile', operate, ok((r) => trips.reconcile(r.actor, r.scope, r.params.id)));
router.post('/trips/:id/complete', operate, ok((r) => trips.complete(r.actor, r.scope, r.params.id, r.body)));
router.post('/trips/:id/suppress-alerts', operate, ok((r) => trips.suppressAlerts(r.actor, r.scope, r.params.id, r.body)));

export default router;
