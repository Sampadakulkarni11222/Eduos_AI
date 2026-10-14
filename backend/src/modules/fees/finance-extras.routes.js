import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { AppError } from '../../utils/AppError.js';
import * as adjustments from './adjustment.service.js';
import * as exportsSvc from './accounts-export.service.js';

/**
 * @swagger
 * tags:
 *   - { name: FeeAdjustments, description: Fee concession schemes, and concessions / credit notes / voids on issued invoices through approval }
 *   - { name: AccountsExport, description: Tally-compatible voucher export (XML and CSV) and GST summary of taxable fee lines }
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const feeAdjustmentsRouter = Router();
feeAdjustmentsRouter.use(authenticate, requireFeature('accountsExport'));
const conc = requirePermission('fees.concessions.manage', 'ALL');
feeAdjustmentsRouter.get('/types', conc, ok(() => adjustments.listConcessionTypes()));
feeAdjustmentsRouter.post('/types', conc, ok((r) => adjustments.createConcessionType(r.actor, r.body), 'Concession scheme added', 201));
feeAdjustmentsRouter.patch('/types/:id', conc, ok((r) => adjustments.updateConcessionType(r.actor, r.params.id, r.body), 'Concession scheme updated'));
feeAdjustmentsRouter.get('/', conc, ok((r) => adjustments.listAdjustments(r.actor, r.query)));
feeAdjustmentsRouter.get('/invoices/:id', conc, ok((r) => adjustments.invoiceForAdjustment(r.actor, r.params.id)));
// A concession needs the concessions permission; a credit note or a void changes an invoice, so it needs fees.manage as well.
feeAdjustmentsRouter.post('/', conc, (req, _res, next) => {
  if (String(req.body?.kind ?? '').toUpperCase() !== 'CONCESSION' && req.actor?.permissions?.['fees.manage'] !== 'ALL') {
    return next(new AppError('Missing permission: fees.manage at school-wide scope', 403));
  }
  return next();
}, ok((r) => adjustments.requestAdjustment(r.actor, r.body), 'Sent for approval', 201));
feeAdjustmentsRouter.post('/:id/withdraw', conc, ok((r) => adjustments.withdrawAdjustment(r.actor, r.params.id, r.body), 'Withdrawn'));

export const accountsExportRouter = Router();
accountsExportRouter.use(authenticate, requireFeature('accountsExport'));
const exp = requirePermission('accounts.export', 'ALL');
accountsExportRouter.get('/vouchers', exp, asyncHandler(async (req, res) => {
  const out = await exportsSvc.exportVouchers(req.actor, req.query);
  if (out.json) return sendSuccess(res, out.json);
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(out.body);
}));
accountsExportRouter.get('/gst', exp, ok((r) => exportsSvc.gstSummary(r.actor, r.query)));
accountsExportRouter.get('/fee-heads', exp, ok(() => exportsSvc.listFeeHeadTax()));
accountsExportRouter.put('/fee-heads/:id/tax', exp, requirePermission('fees.structure.manage'), ok((r) => exportsSvc.setFeeHeadTax(r.actor, r.params.id, r.body), 'Tax set-up saved'));
