import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { csvUploadSingle } from '../../utils/csvImport.js';
import * as controller from './fee.controller.js';

const router = Router();
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
