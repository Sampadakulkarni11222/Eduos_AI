import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as payroll from './payroll.service.js';
import * as procurement from './procurement.service.js';

/**
 * @swagger
 * tags:
 *   - { name: Payroll, description: Pay structures, versioned statutory rules, payroll runs, bank file, payment confirmation, statutory exports, payslips }
 *   - { name: Procurement, description: Vendors, purchase requests, purchase orders, receipts, invoice matching, payments and assets }
 *   - { name: Budgets, description: Budgets, commitments, actuals and variance; funding proposals }
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const csv = (fn, name) => asyncHandler(async (req, res) => {
  const out = await fn(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name(req)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(out.csv);
});

export const payrollRouter = Router();
payrollRouter.use(authenticate);
const pRead = requirePermission('payroll.read');
const pPrep = requirePermission('payroll.prepare');
const pSens = requirePermission('payroll.sensitive.read');
payrollRouter.get('/payslips/mine', pRead, ok((r) => payroll.myPayslips(r.actor)));
payrollRouter.get('/rules', requirePermission('payroll.read', 'ALL'), ok(() => payroll.listRules()));
payrollRouter.post('/rules', pPrep, ok((r) => payroll.upsertRule(r.actor, r.body), 'Rule added', 201));
payrollRouter.post('/rules/seed', pPrep, ok(() => payroll.seedRules(), 'Rules seeded (unverified)'));
payrollRouter.post('/rules/:id/verify', pPrep, ok((r) => payroll.verifyRule(r.actor, r.params.id), 'Rule verified'));
payrollRouter.get('/compensation', pPrep, ok((r) => payroll.listCompensation(r.actor)));
payrollRouter.put('/compensation', pSens, pPrep, ok((r) => payroll.upsertCompensation(r.actor, r.body), 'Pay structure saved'));
payrollRouter.get('/runs', requirePermission('payroll.read', 'ALL'), ok((r) => payroll.listRuns(r.actor)));
payrollRouter.post('/runs', pPrep, ok((r) => payroll.createRun(r.actor, r.body), 'Run created', 201));
payrollRouter.get('/runs/:id', requirePermission('payroll.read', 'ALL'), ok((r) => payroll.getRun(r.actor, r.params.id)));
payrollRouter.put('/runs/:id/inputs', pPrep, ok((r) => payroll.setInputs(r.actor, r.params.id, r.body), 'Inputs saved'));
payrollRouter.post('/runs/:id/calculate', pPrep, ok((r) => payroll.calculate(r.actor, r.params.id), 'Calculated'));
payrollRouter.post('/runs/:id/submit', pPrep, ok((r) => payroll.submitRun(r.actor, r.params.id, r.body), 'Sent for approval'));
payrollRouter.post('/runs/:id/reopen', pPrep, ok((r) => payroll.reopen(r.actor, r.params.id, r.body), 'Reopened'));
payrollRouter.get('/runs/:id/bank-file.csv', pSens, pPrep, csv((r) => payroll.bankFile(r.actor, r.params.id), (r) => `bank-${r.params.id}.csv`));
payrollRouter.post('/runs/:id/payment-initiated', pPrep, ok((r) => payroll.markPaymentInitiated(r.actor, r.params.id, r.body), 'Payment initiation recorded'));
payrollRouter.post('/runs/:id/payment-confirmed', pPrep, ok((r) => payroll.confirmPayment(r.actor, r.params.id, r.body), 'Payment confirmed'));
payrollRouter.get('/runs/:id/statutory/:code.csv', pSens, pPrep, csv((r) => payroll.statutoryExport(r.actor, r.params.id, r.params.code), (r) => `${r.params.code}-${r.params.id}.csv`));
// The EPFO ECR 2.0 upload file itself (#~#-separated text), beside the CSV working file.
payrollRouter.get('/runs/:id/statutory/EPF_ECR.txt', pSens, pPrep, asyncHandler(async (req, res) => {
  const out = await payroll.statutoryExport(req.actor, req.params.id, 'EPF_ECR');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ECR-${req.params.id}.txt"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(out.ecr ?? '');
}));
payrollRouter.post('/runs/:id/statutory', pPrep, ok((r) => payroll.recordStatutorySubmission(r.actor, r.params.id, r.body), 'Submission recorded'));
payrollRouter.post('/runs/:id/close', pPrep, ok((r) => payroll.closeRun(r.actor, r.params.id), 'Closed'));

export const procurementRouter = Router();
procurementRouter.use(authenticate);
const qRead = requirePermission('procurement.read');
const qReq = requirePermission('procurement.request');
const qMan = requirePermission('procurement.manage');
procurementRouter.get('/stats', qRead, ok(() => procurement.stats()));
procurementRouter.get('/vendors', qRead, ok((r) => procurement.listVendors(r.actor)));
procurementRouter.post('/vendors', qMan, ok((r) => procurement.createVendor(r.actor, r.body), 'Vendor added', 201));
procurementRouter.post('/vendors/:id/due-diligence', qMan, ok((r) => procurement.vendorDueDiligence(r.actor, r.params.id, r.body), 'Due diligence recorded'));
procurementRouter.post('/vendors/:id/conflict', qReq, ok((r) => procurement.declareVendorConflict(r.actor, r.params.id, r.body), 'Conflict declared'));
procurementRouter.get('/requests', qRead, ok((r) => procurement.listRequests(r.actor, r.scope, r.query)));
procurementRouter.post('/requests', qReq, ok((r) => procurement.createRequestDraft(r.actor, r.body), 'Request created', 201));
procurementRouter.get('/requests/:id', qRead, ok((r) => procurement.getRequestById(r.actor, r.scope, r.params.id)));
procurementRouter.put('/requests/:id/quotes', qReq, ok((r) => procurement.setQuotes(r.actor, r.actor.permissions['procurement.manage'] ? 'ALL' : 'OWN', r.params.id, r.body), 'Quotes saved'));
procurementRouter.post('/requests/:id/submit', qReq, ok((r) => procurement.submit(r.actor, 'OWN', r.params.id), 'Sent for approval'));
procurementRouter.post('/requests/:id/cancel', qReq, ok((r) => procurement.cancel(r.actor, r.actor.permissions['procurement.manage'] ? 'ALL' : 'OWN', r.params.id, r.body), 'Cancelled'));
procurementRouter.post('/requests/:id/po', qMan, ok((r) => procurement.issuePo(r.actor, 'ALL', r.params.id, r.body ?? {}), 'PO issued'));
procurementRouter.post('/requests/:id/receive', qMan, ok((r) => procurement.receive(r.actor, 'ALL', r.params.id, r.body), 'Receipt recorded'));
procurementRouter.post('/requests/:id/invoice', qMan, ok((r) => procurement.addInvoice(r.actor, 'ALL', r.params.id, r.body), 'Invoice booked'));
procurementRouter.post('/requests/:id/approve-payment', qMan, ok((r) => procurement.approvePayment(r.actor, 'ALL', r.params.id, r.body), 'Payment approval recorded'));
procurementRouter.post('/requests/:id/payment-initiated', qMan, ok((r) => procurement.initiatePayment(r.actor, 'ALL', r.params.id, r.body), 'Payment initiated'));
procurementRouter.post('/requests/:id/payment-confirmed', qMan, ok((r) => procurement.confirmPayment(r.actor, 'ALL', r.params.id, r.body), 'Payment confirmed'));
procurementRouter.get('/assets', qRead, ok(() => procurement.listAssets()));
procurementRouter.patch('/assets/:id', qMan, ok((r) => procurement.updateAsset(r.params.id, r.body), 'Asset updated'));

export const budgetRouter = Router();
budgetRouter.use(authenticate);
budgetRouter.get('/', requirePermission('budget.read'), ok(() => procurement.listBudgets()));
budgetRouter.post('/', requirePermission('budget.manage'), ok((r) => procurement.createBudget(r.actor, r.body), 'Budget created', 201));
budgetRouter.post('/:id/submit', requirePermission('budget.manage'), ok((r) => procurement.submitBudget(r.actor, r.params.id), 'Sent for approval'));
budgetRouter.post('/:id/variance', requirePermission('budget.manage'), ok((r) => procurement.explainVariance(r.actor, r.params.id, r.body), 'Explanation saved'));
budgetRouter.get('/funding', requirePermission('funding.read'), ok(() => procurement.listFunding()));
budgetRouter.post('/funding', requirePermission('funding.manage'), ok((r) => procurement.createFunding(r.actor, r.body), 'Proposal created', 201));
budgetRouter.post('/funding/:id/submit', requirePermission('funding.manage'), ok((r) => procurement.submitFunding(r.actor, r.params.id), 'Sent for approval'));
budgetRouter.patch('/funding/:id', requirePermission('funding.manage'), ok((r) => procurement.updateFunding(r.actor, r.params.id, r.body), 'Proposal updated'));
