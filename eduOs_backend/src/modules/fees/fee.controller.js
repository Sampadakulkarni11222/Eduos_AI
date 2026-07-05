import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './fee.service.js';

export const createFeeHead = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeHead(req.body), 'Fee head created', 201);
});

export const createFeeStructure = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createFeeStructure(req.body), 'Fee structure created', 201);
});

export const listInvoices = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listInvoices(req.actor, req.scope, req.query), 'Invoices fetched');
});

export const createInvoice = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createInvoice(req.body), 'Invoice created', 201);
});

export const recordPayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.recordPayment(req.body), 'Payment recorded', 201);
});

export const refundPayment = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.refundPayment(req.params.id), 'Payment refunded');
});

export const getSummary = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSummary(req.actor, req.scope, req.query), 'Fee summary fetched');
});
