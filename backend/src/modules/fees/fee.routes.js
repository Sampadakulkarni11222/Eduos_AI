import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './fee.controller.js';

const router = Router();

/**
 * @swagger
 * /fees/webhooks/razorpay:
 *   post:
 *     summary: Razorpay payment webhook (authenticated by HMAC signature, not JWT)
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: Webhook processed or acknowledged
 *       401:
 *         description: Signature verification failed
 */
// Mounted above `authenticate` on purpose: the gateway cannot present a bearer
// token, and its signature is the stronger check anyway.
router.post('/webhooks/razorpay', controller.razorpayWebhook);

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Fees
 *   description: Fee structures, invoices, and payments
 */

/**
 * @swagger
 * /fees/heads:
 *   post:
 *     summary: Create a fee head (e.g. Tuition, Transport)
 *     tags: [Fees]
 *     responses:
 *       201:
 *         description: Fee head created
 */
router.post('/heads', requirePermission('fees.structure.manage'), controller.createFeeHead);

/**
 * @swagger
 * /fees/heads:
 *   get:
 *     summary: List fee heads
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: Fee heads fetched
 */
router.get('/heads', requirePermission('fees.read', 'ALL'), controller.listFeeHeads);

/**
 * @swagger
 * /fees/structures:
 *   post:
 *     summary: Create a fee structure under a fee head for an academic year
 *     tags: [Fees]
 *     responses:
 *       201:
 *         description: Fee structure created
 */
router.post('/structures', requirePermission('fees.structure.manage'), controller.createFeeStructure);

/**
 * @swagger
 * /fees/structures:
 *   get:
 *     summary: List fee structures, optionally filtered by academic year and grade
 *     tags: [Fees]
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema: { type: string }
 *       - in: query
 *         name: gradeId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Fee structures fetched
 */
router.get('/structures', requirePermission('fees.read', 'ALL'), controller.listFeeStructures);

/**
 * @swagger
 * /fees/invoices/generate:
 *   post:
 *     summary: Generate invoices for every active enrollment from the matching fee structures
 *     description: >
 *       Idempotent per fee structure — a structure already billed to an
 *       enrollment is skipped, so this can be safely re-run after adding a new
 *       structure. Pass dryRun to preview totals without writing.
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [academicYearId]
 *             properties:
 *               academicYearId: { type: string }
 *               gradeId: { type: string, description: "Omit to bill every grade" }
 *               dueOn: { type: string, format: date }
 *               dryRun: { type: boolean }
 *     responses:
 *       201:
 *         description: Invoices generated
 *       200:
 *         description: Dry-run preview
 */
router.post('/invoices/generate', requirePermission('fees.manage'), controller.generateInvoices);

/**
 * @swagger
 * /fees/invoices:
 *   get:
 *     summary: List invoices (scoped to OWN children for parents/students)
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: List of invoices
 *   post:
 *     summary: Create an invoice with line items for an enrollment
 *     tags: [Fees]
 *     responses:
 *       201:
 *         description: Invoice created
 */
router.get('/invoices', requirePermission('fees.read'), controller.listInvoices);
router.post('/invoices', requirePermission('fees.manage'), controller.createInvoice);

/**
 * @swagger
 * /fees/invoices/{id}:
 *   get:
 *     summary: Get a single invoice with its line items and payment history (scoped to OWN for parents/students)
 *     tags: [Fees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invoice detail fetched
 */
router.get('/invoices/:id', requirePermission('fees.read'), controller.getInvoiceDetail);

/**
 * @swagger
 * /fees/invoices/{id}/pdf:
 *   get:
 *     summary: Download the invoice as a PDF (scoped to OWN for parents/students)
 *     tags: [Fees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invoice PDF stream
 */
router.get('/invoices/:id/pdf', requirePermission('fees.read'), controller.getInvoicePdf);

/**
 * @swagger
 * /fees/invoices/bulk:
 *   post:
 *     summary: Bulk-create one-line invoices from a CSV (admissionNo, invoiceNo, description, amount, dueOn)
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Bulk import result { imported, failed, errors }
 */
router.post('/invoices/bulk', requirePermission('fees.manage'), csvUploadSingle('file'), controller.bulkCreateInvoices);

/**
 * @swagger
 * /fees/summary:
 *   get:
 *     summary: Get total/paid/outstanding fee summary
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: Fee summary fetched
 */
router.get('/summary', requirePermission('fees.read'), controller.getSummary);

/**
 * @swagger
 * /fees/payments:
 *   post:
 *     summary: Record a payment against an invoice
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId, amountPaise, mode]
 *             properties:
 *               invoiceId: { type: string }
 *               amountPaise: { type: integer }
 *               mode: { type: string, enum: [GATEWAY, CASH, CHEQUE, BANK] }
 *               gatewayRef: { type: string }
 *               receiptNo: { type: string }
 *     responses:
 *       201:
 *         description: Payment recorded
 */
router.post('/payments', requirePermission('fees.pay'), controller.recordPayment);

/**
 * @swagger
 * /fees/payments:
 *   get:
 *     summary: List payment receipts (scoped to OWN children for parents/students)
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: List of payment receipts
 */
router.get('/payments', requirePermission('fees.read'), controller.listPayments);

/**
 * @swagger
 * /fees/payments/{id}/pdf:
 *   get:
 *     summary: Download the payment receipt as a PDF (scoped to OWN for parents/students)
 *     tags: [Fees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Receipt PDF stream
 */
router.get('/payments/:id/pdf', requirePermission('fees.read'), controller.getReceiptPdf);

/**
 * @swagger
 * /fees/pay:
 *   post:
 *     summary: Pay an invoice online through the configured payment provider
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId]
 *             properties:
 *               invoiceId: { type: string }
 *               amountPaise: { type: integer, description: "Defaults to the full outstanding balance" }
 *     responses:
 *       201:
 *         description: Payment captured and recorded on the ledger
 */
router.post('/pay', requirePermission('fees.pay'), controller.payOnline);

/**
 * @swagger
 * /fees/pay/verify:
 *   post:
 *     summary: Confirm a checkout the payer just completed in the browser
 *     description: >
 *       Verifies Razorpay Checkout's `order_id|payment_id` signature and then
 *       settles through the same path the webhook uses, so it cannot double-credit
 *       and cannot bypass the amount check. The webhook remains authoritative —
 *       this only spares the payer a wait.
 *     tags: [Fees]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentId, signature]
 *             properties:
 *               orderId: { type: string }
 *               paymentId: { type: string }
 *               signature: { type: string }
 *     responses:
 *       200:
 *         description: Payment confirmed (or already confirmed)
 *       400:
 *         description: Signature verification failed
 */
router.post('/pay/verify', requirePermission('fees.pay'), controller.verifyCheckout);

/**
 * @swagger
 * /fees/pay/speedypay:
 *   post:
 *     summary: "SpeedyPay: settle an invoice instantly for testing (development only)"
 *     description: >
 *       Writes a real ledger entry without contacting a gateway, so fee flows can
 *       be tested without typing a card number. Returns 403 SPEEDYPAY_DISABLED
 *       unless SPEEDYPAY_ENABLED=true **and** NODE_ENV is development; production
 *       refuses to start with it enabled at all. Payments are referenced
 *       SPEEDYPAY-… so they can never be mistaken for real settlements.
 *     tags: [Fees]
 *     responses:
 *       201:
 *         description: Test payment recorded
 *       403:
 *         description: SpeedyPay is not available in this environment
 */
router.post('/pay/speedypay', requirePermission('fees.pay'), controller.speedyPay);

/**
 * @swagger
 * /fees/payment-methods:
 *   get:
 *     summary: Which payment options the pay screen should offer
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: "{ provider, online, speedypay }"
 */
router.get('/payment-methods', requirePermission('fees.read'), controller.paymentMethods);

/**
 * @swagger
 * /fees/payments/{id}/refund:
 *   post:
 *     summary: Refund a payment
 *     tags: [Fees]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment refunded
 */
router.post('/payments/:id/refund', requirePermission('fees.payments.refund'), controller.refundPayment);

export default router;
