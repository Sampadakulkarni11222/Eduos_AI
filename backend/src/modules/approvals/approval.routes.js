import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './approval.service.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Approvals
 *   description: Multi-stage approval requests, delegations and approval policies
 */

/**
 * @swagger
 * /approvals/inbox:
 *   get:
 *     summary: Requests whose current stage the caller may decide
 *     tags: [Approvals]
 */
router.get('/inbox', requirePermission('approvals.read'), asyncHandler(async (req, res) => sendSuccess(res, await service.inbox(req.actor))));
router.get('/summary', requirePermission('approvals.read'), asyncHandler(async (req, res) => sendSuccess(res, await service.summaryFor(req.actor))));
router.get('/policies', requirePermission('approvals.read'), asyncHandler(async (_req, res) => sendSuccess(res, await service.listPolicies())));
router.put('/policies/:category', requirePermission('approvals.configure'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.setPolicy(req.actor, req.params.category, req.body), 'Approval policy saved')));
router.delete('/policies/:category', requirePermission('approvals.configure'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.resetPolicy(req.params.category), 'Approval policy reset to default')));

router.get('/delegations', requirePermission('approvals.read'), asyncHandler(async (req, res) => sendSuccess(res, await service.listDelegations(req.actor))));
router.post('/delegations', requirePermission('approvals.decide'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.createDelegation(req.actor, req.body), 'Delegation created', 201)));
router.post('/delegations/:id/revoke', requirePermission('approvals.decide'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.revokeDelegation(req.actor, req.params.id), 'Delegation revoked')));

/**
 * @swagger
 * /approvals:
 *   get:
 *     summary: List approval requests (OWN scope sees only requests it raised)
 *     tags: [Approvals]
 *   post:
 *     summary: Raise a standalone approval request
 *     tags: [Approvals]
 */
router.get('/', requirePermission('approvals.read'), asyncHandler(async (req, res) => sendSuccess(res, await service.list(req.actor, req.scope, req.query))));
router.post('/', requirePermission('approvals.submit'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.createRequest(req.actor, req.body), 'Approval requested', 201)));
router.get('/:id', requirePermission('approvals.read'), asyncHandler(async (req, res) => sendSuccess(res, await service.getRequest(req.actor, req.scope, req.params.id))));
router.post('/:id/decide', requirePermission('approvals.decide'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.decide(req.actor, req.params.id, req.body), 'Decision recorded')));
router.post('/:id/resubmit', requirePermission('approvals.submit'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.resubmit(req.actor, req.params.id, req.body), 'Resubmitted')));
router.post('/:id/withdraw', requirePermission('approvals.submit'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.withdraw(req.actor, req.params.id, req.body), 'Withdrawn')));
router.post('/:id/conflict', requirePermission('approvals.decide'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.declareConflict(req.actor, req.params.id, req.body), 'Conflict declared')));
router.post('/:id/escalate', requirePermission('approvals.read'), asyncHandler(async (req, res) =>
  sendSuccess(res, await service.escalate(req.actor, req.params.id, req.body), 'Escalated')));

export default router;
