import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { verifyWebhookSignature } from '../../providers/payment.provider.js';
import { logger } from '../../utils/logger.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import { renderInvoicePdf } from '../../utils/invoicePdf.js';
import { renderReceiptPdf } from '../../utils/receiptPdf.js';
import * as service from './fee.service.js';
import * as planService from './plan.service.js';

// Both go through the actor-aware service, so the route and the assistant meet
// the same scope check, field allow-list, foreign-school reference check and
// audit entry. The raw pass-throughs these used to call have been removed.
export const createFeeHead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeHeadForActor(req.actor, req.scope, req.body), 'Fee head created', 201);
});

export const createFeeStructure = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeStructureForActor(req.actor, req.scope, req.body), 'Fee structure created', 201);
});

export const listFeeHeads = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listFeeHeads(), 'Fee heads fetched');
});

export const listFeeStructures = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listFeeStructures(req.query), 'Fee structures fetched');
});

export const generateInvoices = asyncHandler(async (req, res) => {
  const result = await service.generateInvoices({
    academicYearId: req.body.academicYearId,
    gradeId: req.body.gradeId ?? null,
    dueOn: req.body.dueOn,
    dryRun: req.body.dryRun === true,
  });
  sendSuccess(
    res,
    result,
    result.dryRun
      ? `Preview: ${result.generated} invoice(s) would be generated, ${result.skipped} already billed`
      : `${result.generated} invoice(s) generated, ${result.skipped} already billed`,
    result.dryRun ? 200 : 201
  );
});

export const listInvoices = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listInvoices(req.actor, req.scope, req.query), 'Invoices fetched');
});

export const getInvoiceDetail = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getInvoiceDetail(req.actor, req.scope, req.params.id), 'Invoice detail fetched');
});

export const getInvoicePdf = asyncHandler(async (req, res) => {
  const invoice = await service.getInvoiceDetail(req.actor, req.scope, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Invoice-${invoice.invoiceNo}.pdf"`);
  renderInvoicePdf(res, invoice);
});

export const getReceiptPdf = asyncHandler(async (req, res) => {
  const receipt = await service.getPaymentReceipt(req.actor, req.scope, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Receipt-${receipt.receiptNo}.pdf"`);
  renderReceiptPdf(res, receipt);
});

export const createInvoice = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createInvoice(req.body), 'Invoice created', 201);
});

export const bulkCreateInvoices = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateInvoices(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} invoices`, 201);
});

export const recordPayment = asyncHandler(async (req, res) => {
  const result = await service.recordPayment(req.actor, req.scope, req.body);
  // Two genuinely different outcomes, so two different messages: a cashier who
  // is told "Payment recorded" when it is actually queued will tell the payer
  // the same thing.
  sendSuccess(
    res,
    result,
    result.awaitingApproval ? 'Payment recorded and sent for admin approval' : 'Payment recorded',
    201
  );
});

export const approvePayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.approvePayment(req.actor, req.params.id), 'Payment approved and published');
});

export const rejectPayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.rejectPayment(req.actor, req.params.id, req.body?.reason), 'Payment rejected');
});

export const updatePayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.updatePayment(req.actor, req.params.id, req.body), 'Payment updated');
});

export const getPaymentHistory = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getPaymentHistory(req.params.id), 'Payment history fetched');
});

export const createPaymentChangeRequest = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await service.createPaymentChangeRequest(req.actor, { ...req.body, paymentId: req.params.id }),
    'Change request submitted for admin approval',
    201
  );
});

export const listPaymentChangeRequests = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listPaymentChangeRequests(req.query), 'Change requests fetched');
});

export const decidePaymentChangeRequest = asyncHandler(async (req, res) => {
  const approve = req.body?.approve === true;
  const result = await service.decidePaymentChangeRequest(req.actor, req.params.id, {
    approve,
    reason: req.body?.reason,
  });
  sendSuccess(res, result, approve ? 'Change approved and applied' : 'Change request rejected');
});

export const listPaymentAcademicYears = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listPaymentAcademicYears(req.actor, req.scope), 'Academic years fetched');
});

export const getStudentPaymentOverview = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await service.getStudentPaymentOverview(req.actor, req.scope, req.query),
    'Payment overview fetched'
  );
});

// ── Installment plans ────────────────────────────────────────────────────
export const createFeePlan = asyncHandler(async (req, res) => {
  sendSuccess(res, await planService.createFeePlan(req.actor, req.body), 'Fee plan created', 201);
});

export const updateFeePlan = asyncHandler(async (req, res) => {
  sendSuccess(res, await planService.updateFeePlan(req.actor, req.params.id, req.body), 'Fee plan updated');
});

export const listFeePlans = asyncHandler(async (req, res) => {
  sendSuccess(res, await planService.listFeePlans(req.actor, req.scope, req.query), 'Fee plans fetched');
});

export const getFeePlan = asyncHandler(async (req, res) => {
  sendSuccess(res, await planService.getFeePlanDetail(req.actor, req.scope, req.params.id), 'Fee plan fetched');
});

export const transitionFeePlan = asyncHandler(async (req, res) => {
  const plan = await planService.transitionFeePlan(req.actor, req.params.id, req.params.step, req.body ?? {});
  sendSuccess(res, plan, `Fee plan is now ${plan.status.toLowerCase().replace(/_/g, ' ')}`);
});

export const publishFeePlan = asyncHandler(async (req, res) => {
  const result = await planService.publishFeePlan(req.actor, req.params.id);
  sendSuccess(res, result, `Fee plan published — ${result.invoicesRaised.length} invoice(s) raised`);
});

export const listPayments = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listPayments(req.actor, req.scope, req.query), 'Payments fetched');
});

export const payOnline = asyncHandler(async (req, res) => {
  const result = await service.payOnline(req.actor, req.scope, req.body);
  // A real gateway returns an order to complete, not a receipt — saying
  // "Payment successful" there would be a lie the UI then repeats to the payer.
  sendSuccess(
    res,
    result,
    result.requiresClientAction ? 'Payment order created — complete the payment to finish' : 'Payment successful',
    201
  );
});

export const verifyCheckout = asyncHandler(async (req, res) => {
  const result = await service.verifyCheckout(req.actor, req.scope, req.body);
  sendSuccess(res, result, result.idempotent ? 'Payment already confirmed' : 'Payment confirmed');
});

/**
 * Razorpay webhook. Unauthenticated by necessity (Razorpay holds no JWT), so
 * the HMAC signature over the raw body is the *only* authentication — it is
 * checked before the payload is looked at, let alone acted on.
 *
 * Responds 200 for anything genuine-but-unactionable (other event types,
 * unknown orders, duplicate deliveries). Razorpay retries non-2xx for hours,
 * and a permanent condition retried on a schedule is just noise.
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!verifyWebhookSignature(req.rawBody, signature)) {
    logger.warn(`Rejected Razorpay webhook with invalid signature from ${req.ip}`);
    return sendError(res, 'Invalid webhook signature', 401, [], 'WEBHOOK_SIGNATURE_INVALID');
  }

  const event = req.body?.event;
  const entity = req.body?.payload?.payment?.entity ?? {};

  const result = await service.settleGatewayPayment({
    event,
    orderId: entity.order_id,
    gatewayPaymentId: entity.id,
    amountPaise: entity.amount,
  });

  return sendSuccess(res, result, result.handled ? 'Webhook processed' : `Webhook acknowledged: ${result.reason}`);
});

export const refundPayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.refundPayment(req.params.id), 'Payment refunded');
});

export const getSummary = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSummary(req.actor, req.scope, req.query), 'Fee summary fetched');
});
