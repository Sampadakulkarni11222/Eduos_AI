import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as bills from './bills.service.js';
import * as review from './review.service.js';
import { renewals, syncRenewals } from './renewals.service.js';

/**
 * @swagger
 * tags:
 *   name: Bills
 *   description: Recurring bills and service contracts, payments with confirmation, AMC visits, one renewals list, review flags and cost dashboard
 */
const router = Router();
router.use(authenticate, requireFeature('bills'));

const read = requirePermission('bills.read', 'ALL');
const manage = requirePermission('bills.manage', 'ALL');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/accounts', read, ok((r) => bills.listAccounts(r.actor, r.query)));
router.post('/accounts', manage, ok((r) => bills.createAccount(r.actor, r.body), 'Service added', 201));
router.patch('/accounts/:id', manage, ok((r) => bills.updateAccount(r.actor, r.params.id, r.body), 'Service updated'));
router.post('/accounts/:id/visits', manage, ok((r) => bills.createVisit(r.actor, r.params.id, r.body), 'Visit scheduled', 201));
router.get('/visits', read, ok((r) => bills.listVisits(r.actor, r.query)));
router.post('/visits/:id/complete', manage, ok((r) => bills.completeVisit(r.actor, r.params.id, r.body), 'Visit closed'));
router.get('/renewals', read, ok((r) => renewals(r.actor, r.query)));
router.get('/review', read, ok((r) => review.reviewQueue(r.actor, r.query)));
router.post('/review', manage, ok((r) => review.reviewFlag(r.actor, r.body), 'Review recorded'));
router.get('/dashboard', read, ok((r) => review.dashboard(r.actor, r.query)));
router.post('/due/sync', manage, ok(async () => ({ bills: await bills.runBillsDue(), renewals: await syncRenewals() }), 'Reminders brought up to date'));

router.get('/', read, ok((r) => bills.listBills(r.actor, r.query)));
router.post('/', manage, ok((r) => bills.createBill(r.actor, r.body), 'Bill recorded', 201));
router.get('/:id', read, ok((r) => bills.getBill(r.actor, r.params.id)));
router.post('/:id/payments', manage, ok((r) => bills.recordPayment(r.actor, r.params.id, r.body), 'Payment recorded (not settled until confirmed)'));
router.post('/:id/payments/:paymentId/confirm', manage, ok((r) => bills.confirmPayment(r.actor, r.params.id, r.params.paymentId, r.body), 'Payment decision recorded'));
router.post('/:id/status', manage, ok((r) => bills.setBillStatus(r.actor, r.params.id, r.body), 'Bill updated'));

export default router;
