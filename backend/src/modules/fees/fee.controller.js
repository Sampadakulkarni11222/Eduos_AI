import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import { renderInvoicePdf } from '../../utils/invoicePdf.js';
import { renderReceiptPdf } from '../../utils/receiptPdf.js';
import * as service from './fee.service.js';

export const createFeeHead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeHead(req.body), 'Fee head created', 201);
});

export const createFeeStructure = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeStructure(req.body), 'Fee structure created', 201);
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
  sendSuccess(res, await service.recordPayment(req.actor, req.scope, req.body), 'Payment recorded', 201);
});

export const listPayments = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listPayments(req.actor, req.scope, req.query), 'Payments fetched');
});

export const payOnline = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.payOnline(req.actor, req.scope, req.body), 'Payment successful', 201);
});

export const refundPayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.refundPayment(req.params.id), 'Payment refunded');
});

export const getSummary = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSummary(req.actor, req.scope, req.query), 'Fee summary fetched');
});
