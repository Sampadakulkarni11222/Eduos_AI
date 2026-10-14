import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as svc from './sustainability.service.js';
import * as sanitation from './sustainability.sanitation.js';
import { buildPack, packCsv, PACKS } from './sustainability.packs.js';
import { sustainabilityFor } from './sustainability.map.js';
import { requireStaff } from './sustainability.access.js';

/**
 * @swagger
 * tags:
 *   name: Sustainability
 *   description: Trees and plants with survival checks, waste by stream with vendor receipts, compost, water and energy meters, sanitation duties (as tasks), verified eco points, and evidence packs to support SHVR, CSE Green Schools and Mission LiFE submissions
 */
const router = Router();
router.use(authenticate, requireFeature('sustainability'));

const read = requirePermission('sustainability.read');
const manage = requirePermission('sustainability.manage');
const manageAll = requirePermission('sustainability.manage', 'ALL');
const verify = requirePermission('sustainability.verify');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/overview', read, ok((r) => svc.overview(r.actor, r.scope, r.query)));
router.get('/eco-points', read, ok((r) => svc.ecoPoints(r.actor)));
router.get('/map', read, ok(async (r) => { requireStaff(r.actor); return sustainabilityFor(); }));

router.get('/zones', read, ok((r) => svc.listZones(r.actor)));
router.post('/zones', manageAll, ok((r) => svc.createZone(r.actor, r.body), 'Zone added', 201));
router.patch('/zones/:id', manageAll, ok((r) => svc.updateZone(r.actor, r.params.id, r.body), 'Zone updated'));

router.get('/teams', read, ok((r) => svc.listTeams(r.actor, r.actor.permissions?.['sustainability.manage'] ?? 'OWN')));
router.post('/teams', manageAll, ok((r) => svc.createTeam(r.actor, r.body), 'Team added', 201));
router.patch('/teams/:id', manageAll, ok((r) => svc.updateTeam(r.actor, r.params.id, r.body), 'Team updated'));

router.get('/plants', read, ok((r) => svc.listPlants(r.actor, r.actor.permissions?.['sustainability.manage'] ?? 'OWN', r.query)));
router.get('/plants/:id', read, ok((r) => svc.getPlant(r.actor, r.params.id)));
router.post('/plants', manage, ok((r) => svc.createPlant(r.actor, r.scope, r.body), 'Planting recorded', 201));
router.post('/plants/:id/checks', manage, ok((r) => svc.recordPlantCheck(r.actor, r.scope, r.params.id, r.body), 'Survival check recorded', 201));

router.get('/waste', read, ok((r) => svc.listWaste(r.actor, r.query)));
router.post('/waste', manageAll, ok((r) => svc.createWaste(r.actor, r.body), 'Waste recorded', 201));
router.get('/compost', read, ok((r) => svc.listCompost(r.actor)));
router.post('/compost', manageAll, ok((r) => svc.createCompost(r.actor, r.body), 'Compost batch started', 201));
router.patch('/compost/:id', manageAll, ok((r) => svc.updateCompost(r.actor, r.params.id, r.body), 'Compost batch updated'));
router.get('/meters', read, ok((r) => svc.listMeters(r.actor, r.query)));
router.post('/meters', manageAll, ok((r) => svc.recordMeter(r.actor, r.body), 'Reading recorded', 201));

router.get('/sanitation', read, ok((r) => sanitation.listDuties(r.actor)));
router.post('/sanitation', manageAll, ok((r) => sanitation.createDuty(r.actor, r.body), 'Duty added; its first task is in Tasks', 201));
router.patch('/sanitation/:id', manageAll, ok((r) => sanitation.updateDuty(r.actor, r.params.id, r.body), 'Duty updated'));
router.get('/sanitation/:id/checks', read, ok((r) => sanitation.listChecks(r.actor, r.params.id)));
router.post('/sanitation/:id/checks', manage, ok((r) => sanitation.recordCheck(r.actor, r.scope, r.params.id, r.body), 'Check recorded', 201));
router.post('/sanitation/sync', manageAll, ok(() => sanitation.syncDuties(), 'Sanitation tasks brought up to date'));

router.get('/activities', read, ok((r) => svc.listActivities(r.actor, r.actor.permissions?.['sustainability.manage'] ?? r.actor.permissions?.['sustainability.verify'] ?? 'OWN', r.query)));
router.post('/activities', manage, ok((r) => svc.logActivity(r.actor, r.scope, r.body), 'Activity logged; it earns points once verified', 201));
router.post('/activities/:id/decision', verify, ok((r) => svc.decideActivity(r.actor, r.scope, r.params.id, r.body), 'Decision recorded'));

router.get('/packs', manageAll, ok(() => Object.values(PACKS)));
router.get('/packs/:key', manageAll, ok((r) => buildPack(r.actor, r.params.key, r.query)));
router.get('/packs/:key/csv', manageAll, asyncHandler(async (req, res) => {
  const { filename, csv } = await packCsv(req.actor, req.params.key, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`${String.fromCharCode(0xfeff)}${csv}`);
}));

export default router;
