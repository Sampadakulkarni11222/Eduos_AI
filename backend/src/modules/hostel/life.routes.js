import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as life from './life.service.js';

/**
 * @swagger
 * tags:
 *   name: HostelLife
 *   description: Night and morning roll call, the mess menu and headcount, the kitchen allergy list, hostel incidents with the parent-contact log, and the warden's briefing
 */
const router = Router();
router.use(authenticate);
const read = requirePermission('hostel.read');
const manage = requirePermission('hostel.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/briefing', read, ok(() => life.briefing()));
router.get('/residents', read, ok((r) => life.residents(r.query)));
router.get('/rollcalls', read, ok((r) => life.listRollCalls(r.query)));
router.post('/rollcalls', manage, ok((r) => life.startRollCall(r.actor, r.body ?? {}), 'Roll call open', 201));
router.get('/rollcalls/:id', read, ok((r) => life.getRollCall(r.params.id)));
router.post('/rollcalls/:id/mark', manage, ok((r) => life.markRollCall(r.actor, r.params.id, r.body ?? {}), 'Marked'));
router.post('/rollcalls/:id/submit', manage, ok((r) => life.submitRollCall(r.actor, r.params.id), 'Roll call submitted'));
router.get('/mess/menu', read, ok((r) => life.getMenu(r.query)));
router.put('/mess/menu', manage, ok((r) => life.saveMenu(r.actor, r.body ?? {}), 'Menu saved'));
router.get('/mess/headcount', read, ok((r) => life.headcount(r.query)));
router.get('/mess/diet', manage, requirePermission('medical.read'), ok((r) => life.dietList(r.actor)));
router.get('/incidents', read, ok((r) => life.listIncidents(r.query)));
router.post('/incidents', manage, ok((r) => life.createIncident(r.actor, r.body ?? {}), 'Incident recorded', 201));
router.get('/incidents/:id', read, ok((r) => life.getIncident(r.params.id)));
router.post('/incidents/:id/contact', manage, ok((r) => life.logParentContact(r.actor, r.params.id, r.body ?? {}), 'Parent contact logged'));
router.post('/incidents/:id/resolve', manage, ok((r) => life.resolveIncident(r.actor, r.params.id, r.body ?? {}), 'Incident resolved'));

export default router;
