import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { Facility } from '../../models/facility.model.js';
import { Lab } from '../../models/lab.model.js';
import * as labs from './labs.service.js';
import * as assets from './labs.assets.js';
import * as sessions from './labs.sessions.js';
import { runLabsDue } from './labs.due.js';

/**
 * @swagger
 * tags:
 *   name: Labs
 *   description: Science and computer laboratories — stock batches and ledger, instruments and calibration, computers and software seats, practical sessions and incidents
 */
const router = Router();
router.use(authenticate, requireFeature('labs'));

const read = requirePermission('labs.read');
const manage = requirePermission('labs.manage');
const manageAll = requirePermission('labs.manage', 'ALL');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/', read, ok((r) => labs.listLabs(r.actor, r.scope)));
router.get('/overview', read, ok((r) => labs.overview(r.actor, r.scope)));
router.post('/', manageAll, ok((r) => labs.createLab(r.actor, r.body), 'Lab created', 201));
// LAB rooms that do not yet have a lab profile, for the "set up a lab" form.
router.get('/facilities', manageAll, ok(async () => {
  const taken = (await Lab.find({}).select('facilityId').lean()).map((l) => l.facilityId);
  return (await Facility.find({ kind: 'LAB', _id: { $nin: taken } }).select('code name capacity').sort({ code: 1 }).lean()).map((f) => ({ id: String(f._id), code: f.code, name: f.name, capacity: f.capacity }));
}));
router.get('/scan/:code', read, ok((r) => labs.resolveCode(r.actor, r.scope, r.params.code)));
router.post('/due/sync', manageAll, ok(() => runLabsDue(), 'Lab reminders brought up to date'));

// Catalogue and stock.
router.get('/items', read, ok((r) => labs.listItems(r.actor, r.scope, r.query)));
router.patch('/items/:id', manage, ok((r) => labs.updateItem(r.actor, r.scope, r.params.id, r.body), 'Item updated'));
router.post('/items/:id/receive', manage, ok((r) => labs.receive(r.actor, r.scope, r.params.id, r.body), 'Stock received', 201));
router.get('/items/:id/fefo', read, ok((r) => labs.suggestFefo(r.actor, r.scope, r.params.id, r.query)));
router.post('/items/:id/reorder', manage, ok((r) => labs.reorder(r.actor, r.scope, r.params.id, r.body), 'Purchase request drafted', 201));
router.post('/stock/issue', manage, ok((r) => labs.moveOut(r.actor, r.scope, 'ISSUE', r.body), 'Issued'));
router.post('/stock/consume', manage, ok((r) => labs.moveOut(r.actor, r.scope, 'CONSUMED', r.body), 'Consumption recorded'));
router.post('/stock/damage', manage, ok((r) => labs.moveOut(r.actor, r.scope, 'DAMAGED', r.body), 'Damage recorded'));
router.post('/stock/dispose', manage, ok((r) => labs.moveOut(r.actor, r.scope, 'DISPOSED', r.body), 'Disposal recorded'));
router.post('/stock/return', manage, ok((r) => labs.returnStock(r.actor, r.scope, r.body), 'Returned'));
router.patch('/batches/:id', manage, ok((r) => labs.setBatchStatus(r.actor, r.scope, r.params.id, r.body), 'Batch updated'));
router.get('/movements', read, ok((r) => labs.listMovements(r.actor, r.scope, r.query)));

// Instruments.
router.get('/equipment', read, ok((r) => assets.listEquipment(r.actor, r.scope, r.query)));
router.patch('/equipment/:id', manage, ok((r) => assets.updateEquipment(r.actor, r.scope, r.params.id, r.body), 'Instrument updated'));
router.post('/equipment/:id/calibration', manage, ok((r) => assets.recordCalibration(r.actor, r.scope, r.params.id, r.body), 'Calibration recorded'));
router.post('/equipment/:id/repairs', manage, ok((r) => assets.addEquipmentRepair(r.actor, r.scope, r.params.id, r.body), 'Repair logged'));
router.post('/equipment/:id/repairs/:repairId/close', manage, ok((r) => assets.closeEquipmentRepair(r.actor, r.scope, r.params.id, r.params.repairId, r.body), 'Repair closed'));

// Computers and software seats.
router.get('/devices', read, ok((r) => assets.listDevices(r.actor, r.scope, r.query)));
router.patch('/devices/:id', manage, ok((r) => assets.updateDevice(r.actor, r.scope, r.params.id, r.body), 'Device updated'));
router.post('/devices/:id/repairs', manage, ok((r) => assets.addDeviceRepair(r.actor, r.scope, r.params.id, r.body), 'Repair logged'));
router.post('/devices/:id/repairs/:repairId/close', manage, ok((r) => assets.closeDeviceRepair(r.actor, r.scope, r.params.id, r.params.repairId, r.body), 'Repair closed'));
router.post('/devices/:id/decommission', manage, ok((r) => assets.decommissionDevice(r.actor, r.scope, r.params.id, r.body), 'Device decommissioned'));
router.get('/software', read, ok((r) => assets.listSoftware(r.actor, r.scope, r.query)));
router.post('/software', manage, ok((r) => assets.createSoftware(r.actor, r.scope, r.body), 'Software added', 201));
router.patch('/software/:id', manage, ok((r) => assets.updateSoftware(r.actor, r.scope, r.params.id, r.body), 'Software updated'));
router.post('/software/:id/seats', manage, ok((r) => assets.assignSeat(r.actor, r.scope, r.params.id, r.body), 'Seat assigned'));
router.post('/software/:id/seats/release', manage, ok((r) => assets.releaseSeat(r.actor, r.scope, r.params.id, r.body), 'Seat released'));

// Practical sessions.
router.get('/sessions', read, ok((r) => sessions.listSessions(r.actor, r.scope, r.query)));
router.post('/sessions', manage, ok((r) => sessions.createSession(r.actor, r.scope, r.body), 'Practical planned', 201));
router.get('/sessions/:id', read, ok((r) => sessions.getSession(r.actor, r.scope, r.params.id)));
router.patch('/sessions/:id', manage, ok((r) => sessions.updateSession(r.actor, r.scope, r.params.id, r.body), 'Practical updated'));
router.post('/sessions/:id/readiness', manage, ok((r) => sessions.checkReadiness(r.actor, r.scope, r.params.id)));
router.post('/sessions/:id/prep', manage, ok((r) => sessions.requestPreparation(r.actor, r.scope, r.params.id, r.body), 'Sent to the lab assistant'));
router.post('/sessions/:id/prepared', manage, ok((r) => sessions.markPrepared(r.actor, r.scope, r.params.id, r.body), 'Marked prepared'));
router.post('/sessions/:id/start', manage, ok((r) => sessions.startSession(r.actor, r.scope, r.params.id, r.body), 'Practical started'));
router.post('/sessions/:id/attendance', manage, ok((r) => sessions.recordAttendance(r.actor, r.scope, r.params.id, r.body), 'Attendance saved'));
router.post('/sessions/:id/complete', manage, ok((r) => sessions.completeSession(r.actor, r.scope, r.params.id, r.body), 'Practical completed'));
router.post('/sessions/:id/cancel', manage, ok((r) => sessions.cancelSession(r.actor, r.scope, r.params.id, r.body), 'Practical cancelled'));

// Incidents.
router.get('/incidents', read, ok((r) => sessions.listIncidents(r.actor, r.scope, r.query)));
router.post('/incidents', manage, ok((r) => sessions.reportIncident(r.actor, r.scope, r.body), 'Incident reported', 201));
router.post('/incidents/:id/close', manage, ok((r) => sessions.closeIncident(r.actor, r.scope, r.params.id, r.body), 'Incident closed'));

// One lab (last, so the paths above are not read as an id).
router.get('/:id', read, ok((r) => labs.getLab(r.actor, r.scope, r.params.id)));
router.patch('/:id', manage, ok((r) => labs.updateLab(r.actor, r.scope, r.params.id, r.body), 'Lab updated'));
router.post('/:labId/items', manage, ok((r) => labs.createItem(r.actor, r.scope, r.params.labId, r.body), 'Item added', 201));
router.post('/:labId/stocktake', manage, ok((r) => labs.stocktake(r.actor, r.scope, r.params.labId, r.body), 'Stocktake recorded'));
router.post('/:labId/equipment', manage, ok((r) => assets.createEquipment(r.actor, r.scope, r.params.labId, r.body), 'Instrument added', 201));
router.post('/:labId/devices', manage, ok((r) => assets.createDevices(r.actor, r.scope, r.params.labId, r.body), 'Device(s) added', 201));

export default router;
