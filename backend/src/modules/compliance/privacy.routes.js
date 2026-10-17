import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as privacy from './privacy.service.js';

/**
 * @swagger
 * tags:
 *   name: DataProtection
 *   description: DPDP Act data-principal requests, the breach register with the 72-hour Board-report clock, statutory committees (POCSO, ICC, safety, SMC) and an evidence-backed readiness checklist
 */
const router = Router();
router.use(authenticate);
// Counts and the checklist for anyone who reads compliance (principal, trustees, HR);
// the registers themselves (names of requesters, breach details) for the officer.
const read = requirePermission('compliance.read');
const manage = requirePermission('compliance.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/overview', read, ok(() => privacy.overview()));
router.get('/readiness', read, ok(() => privacy.readiness()));
router.get('/committees', read, ok(() => privacy.listCommittees()));
router.post('/committees', manage, ok((r) => privacy.saveCommittee(r.actor, r.body ?? {}), 'Committee saved', 201));
router.patch('/committees/:id', manage, ok((r) => privacy.saveCommittee(r.actor, r.body ?? {}, r.params.id), 'Committee updated'));
router.get('/requests', manage, ok((r) => privacy.listRequests(r.query)));
router.post('/requests', manage, ok((r) => privacy.createRequest(r.actor, r.body ?? {}), 'Request logged', 201));
router.get('/requests/:id', manage, ok((r) => privacy.getRequest(r.params.id)));
router.patch('/requests/:id', manage, ok((r) => privacy.updateRequest(r.actor, r.params.id, r.body ?? {}), 'Request updated'));
router.get('/breaches', manage, ok((r) => privacy.listBreaches(r.query)));
router.post('/breaches', manage, ok((r) => privacy.createBreach(r.actor, r.body ?? {}), 'Breach logged', 201));
router.patch('/breaches/:id', manage, ok((r) => privacy.updateBreach(r.actor, r.params.id, r.body ?? {}), 'Breach updated'));

export default router;
