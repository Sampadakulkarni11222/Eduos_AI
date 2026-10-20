import { Invoice, InvoiceLine, Payment, FeeHead, FeeStructure } from '../../models/fee.model.js';
import { ConcessionType, FeeAdjustment, CONCESSION_KINDS } from '../../models/feeAdjustment.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { inr } from '../finance-ops/format.js';
import { createRequest, registerApprovalHandler, withdraw as withdrawApproval } from '../approvals/approval.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, requireText, optionalText, oneOf, dto, asPaise,
} from '../ops/common.js';

/**
 * Fee concessions, credit notes and voids — always as recorded adjustments.
 *
 * An issued invoice is never edited away. An adjustment is requested with a
 * reason, goes through the approvals engine (FEE_CONCESSION for concessions,
 * OTHER for credit notes and voids), and only on approval changes what the
 * invoice asks for: totalPaise goes down, the issued total stays in
 * grossTotalPaise, the concession is recorded on the line it applies to, and
 * the adjustment keeps the before and after totals. A void keeps the invoice
 * as CANCELLED. Nothing can take an invoice below what has already been paid
 * (that is a refund, which has its own approval).
 */

const OPEN = 'PENDING_APPROVAL';

// ── Concession types ──────────────────────────────────────────────────────

function typeFields(body, partial = false) {
  const out = {};
  if (!partial || body.code !== undefined) out.code = requireText(body.code, 'code', { max: 20 }).toUpperCase();
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 120 });
  if (!partial || body.kind !== undefined) out.kind = oneOf(body.kind, CONCESSION_KINDS, 'kind');
  if (!partial || body.method !== undefined) out.method = oneOf(body.method, ['PERCENT', 'FIXED', 'DISCRETIONARY'], 'method');
  if (body.valueBp !== undefined) {
    const n = Number(body.valueBp);
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new AppError('valueBp must be whole basis points between 0 and 10000', 400);
    out.valueBp = n;
  }
  if (body.amountPaise !== undefined) out.amountPaise = asPaise(body.amountPaise, 'amountPaise');
  if (body.feeHeadIds !== undefined) out.feeHeadIds = (Array.isArray(body.feeHeadIds) ? body.feeHeadIds : []).slice(0, 30).map((id) => assertObjectId(id, 'feeHeadIds'));
  if (body.eligibility !== undefined) out.eligibility = optionalText(body.eligibility, { max: 1000 }) || null;
  if (body.active !== undefined) out.active = body.active !== false;
  return out;
}

export async function listConcessionTypes() {
  const rows = await ConcessionType.find({}).sort({ active: -1, name: 1 }).select('-history').lean();
  const heads = new Map((await FeeHead.find({}).select('name').lean()).map((h) => [String(h._id), h.name]));
  return rows.map((r) => ({ ...dto(r), feeHeadNames: (r.feeHeadIds ?? []).map((id) => heads.get(String(id))).filter(Boolean) }));
}

export async function createConcessionType(actor, body = {}) {
  requireProfile(actor);
  const t = new ConcessionType(typeFields(body));
  if (t.method === 'PERCENT' && !t.valueBp) throw new AppError('A percentage concession needs valueBp (e.g. 2500 for 25%).', 400);
  if (t.method === 'FIXED' && !t.amountPaise) throw new AppError('A fixed concession needs amountPaise.', 400);
  if (await ConcessionType.exists({ code: t.code })) throw new AppError(`Concession code ${t.code} is already used.`, 409);
  pushHistory(t, actor, 'CREATED');
  await t.save();
  return dto(t.toObject());
}

export async function updateConcessionType(actor, id, body = {}) {
  const t = await ConcessionType.findById(assertObjectId(id));
  if (!t) throw new AppError('Concession type not found', 404);
  Object.assign(t, typeFields(body, true));
  pushHistory(t, actor, 'UPDATED');
  await t.save();
  return dto(t.toObject());
}

// ── Adjustments ───────────────────────────────────────────────────────────

async function linesWithHeads(invoiceId) {
  const lines = await InvoiceLine.find({ invoiceId }).lean();
  const structures = new Map((await FeeStructure.find({ _id: { $in: lines.map((l) => l.feeStructureId).filter(Boolean) } }).select('feeHeadId').lean()).map((s) => [String(s._id), String(s.feeHeadId)]));
  return lines.map((l) => ({ ...l, feeHeadId: l.feeStructureId ? structures.get(String(l.feeStructureId)) ?? null : null }));
}

async function reservedPaise(invoiceId, exceptId = null) {
  const rows = await FeeAdjustment.find({ invoiceId, status: OPEN, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('amountPaise').lean();
  return rows.reduce((n, r) => n + r.amountPaise, 0);
}

async function presentAdjustment(a) {
  const out = dto(a);
  if (a.enrollmentId) {
    const e = await Enrollment.findById(a.enrollmentId).select('studentId').lean();
    const st = e ? await Student.findById(e.studentId).select('firstName lastName admissionNo').lean() : null;
    out.studentName = st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : null;
    out.admissionNo = st?.admissionNo ?? null;
  }
  return out;
}

export async function requestAdjustment(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, ['CONCESSION', 'CREDIT_NOTE', 'VOID'], 'kind');
  const invoice = await Invoice.findById(assertObjectId(body.invoiceId, 'invoiceId')).lean();
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'CANCELLED') throw new AppError('This invoice is cancelled.', 409, [], 'INVOICE_CANCELLED');
  if (await FeeAdjustment.exists({ invoiceId: invoice._id, kind: 'VOID', status: OPEN })) throw new AppError('A void is already waiting for approval on this invoice.', 409, [], 'VOID_PENDING');
  const reason = requireText(body.reason, 'reason', { max: 2000 });
  const outstanding = invoice.totalPaise - (invoice.paidPaise ?? 0);
  const lines = await linesWithHeads(invoice._id);
  let amount = 0;
  let type = null;
  let lineId = null;

  if (kind === 'VOID') {
    if ((invoice.paidPaise ?? 0) > 0) throw new AppError('Money has been received against this invoice; refund it or issue a credit note instead of voiding.', 409, [], 'INVOICE_HAS_PAYMENTS');
    if (await Payment.exists({ invoiceId: invoice._id, recordStatus: 'PENDING_ADMIN_APPROVAL' })) throw new AppError('A payment on this invoice is waiting for approval.', 409, [], 'PAYMENT_PENDING');
    amount = invoice.totalPaise;
  } else if (kind === 'CONCESSION') {
    type = await ConcessionType.findById(assertObjectId(body.concessionTypeId, 'concessionTypeId')).lean();
    if (!type || !type.active) throw new AppError('Concession type not found', 404);
    const heads = (type.feeHeadIds ?? []).map(String);
    const applicable = heads.length ? lines.filter((l) => l.feeHeadId && heads.includes(l.feeHeadId)) : lines;
    if (!applicable.length) throw new AppError(`${type.name} does not apply to any fee on this invoice.`, 400, [], 'NOT_APPLICABLE');
    const base = applicable.reduce((n, l) => n + l.amountPaise - (l.concessionPaise ?? 0), 0);
    if (type.method === 'PERCENT') amount = Math.round((base * type.valueBp) / 10000);
    else if (type.method === 'FIXED') amount = Math.min(type.amountPaise, base);
    else amount = asPaise(body.amountPaise, 'amountPaise');
    if (amount > base) throw new AppError(`The concession (${inr(amount)}) is more than the fees it applies to (${inr(base)}).`, 400);
    lineId = [...applicable].sort((a, b) => b.amountPaise - a.amountPaise)[0]._id;
  } else {
    amount = asPaise(body.amountPaise, 'amountPaise');
    if (body.lineId) {
      const l = lines.find((x) => String(x._id) === String(body.lineId));
      if (!l) throw new AppError('Line not found on this invoice', 404);
      lineId = l._id;
    }
  }
  if (!amount) throw new AppError('The adjustment works out to nothing.', 400, [], 'ZERO_AMOUNT');
  const reserved = await reservedPaise(invoice._id);
  if (kind !== 'VOID' && amount + reserved > outstanding) {
    throw new AppError(`Only ${inr(outstanding - reserved)} of this invoice is unpaid${reserved ? ' after the adjustments already waiting' : ''}; an amount already paid is returned by refund, not by reducing the invoice.`, 409, [], 'EXCEEDS_OUTSTANDING');
  }

  const adj = new FeeAdjustment({
    refNo: await nextRef(kind === 'CONCESSION' ? 'CON' : kind === 'VOID' ? 'VOID' : 'CN'),
    kind, invoiceId: invoice._id, invoiceNo: invoice.invoiceNo, enrollmentId: invoice.enrollmentId,
    concessionTypeId: type?._id ?? null, concessionName: type?.name ?? null, lineId, amountPaise: amount, reason,
    evidence: cleanAttachments(body.evidence, actor), requestedByProfileId: actor.profileId, requestedByName: actor.displayName ?? null,
  });
  pushHistory(adj, actor, 'REQUESTED', { to: OPEN });
  await adj.save();
  const label = kind === 'CONCESSION' ? `Fee concession (${type.name})` : kind === 'VOID' ? 'Void fee invoice' : 'Fee credit note';
  try {
    const req = await createRequest(actor, {
      category: kind === 'CONCESSION' ? 'FEE_CONCESSION' : 'OTHER',
      title: `${label}: ${invoice.invoiceNo}`,
      amountPaise: amount,
      summary: `${adj.refNo}: ${inr(amount)} off invoice ${invoice.invoiceNo} (total ${inr(invoice.totalPaise)}, paid ${inr(invoice.paidPaise ?? 0)}).${type ? `\nScheme: ${type.name} — ${type.method === 'PERCENT' ? `${type.valueBp / 100}%` : type.method === 'FIXED' ? inr(type.amountPaise) : 'discretionary amount'}.${type.eligibility ? ` Eligibility: ${type.eligibility}` : ''}` : ''}\nReason: ${reason}`,
      attachments: adj.evidence.map((e) => ({ name: e.name, url: e.url })),
      department: 'FINANCE',
    }, { entityType: 'FeeAdjustment', entityId: adj._id });
    adj.approvalRequestId = req.id;
    await adj.save();
  } catch (err) {
    await FeeAdjustment.deleteOne({ _id: adj._id });
    throw err;
  }
  return presentAdjustment(adj.toObject());
}

/** Applies an approved adjustment. Runs inside the approval decision's transaction. */
async function apply(adj, actor) {
  const invoice = await Invoice.findById(adj.invoiceId);
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'CANCELLED') throw new AppError('The invoice was cancelled meanwhile.', 409, [], 'INVOICE_CANCELLED');
  const before = invoice.totalPaise;
  if (adj.kind === 'VOID') {
    if ((invoice.paidPaise ?? 0) > 0) throw new AppError('Money was received against this invoice meanwhile; it cannot be voided.', 409, [], 'INVOICE_HAS_PAYMENTS');
    invoice.grossTotalPaise = invoice.grossTotalPaise ?? before;
    invoice.adjustedPaise = (invoice.adjustedPaise ?? 0) + before;
    invoice.totalPaise = 0;
    invoice.status = 'CANCELLED';
    invoice.voidedAt = new Date();
    invoice.voidReason = adj.reason;
  } else {
    const outstanding = invoice.totalPaise - (invoice.paidPaise ?? 0);
    if (adj.amountPaise > outstanding) throw new AppError(`Only ${inr(outstanding)} is unpaid now; this adjustment of ${inr(adj.amountPaise)} would go below what has been paid.`, 409, [], 'EXCEEDS_OUTSTANDING');
    invoice.grossTotalPaise = invoice.grossTotalPaise ?? before;
    invoice.adjustedPaise = (invoice.adjustedPaise ?? 0) + adj.amountPaise;
    invoice.totalPaise = before - adj.amountPaise;
    if ((invoice.paidPaise ?? 0) >= invoice.totalPaise) invoice.status = 'PAID';
    else if ((invoice.paidPaise ?? 0) > 0) invoice.status = 'PARTIAL';
    if (adj.lineId && adj.kind === 'CONCESSION') await InvoiceLine.updateOne({ _id: adj.lineId }, { $inc: { concessionPaise: adj.amountPaise } });
  }
  await invoice.save();
  adj.status = 'APPLIED';
  adj.appliedAt = new Date();
  adj.beforeTotalPaise = before;
  adj.afterTotalPaise = invoice.totalPaise;
  pushHistory(adj, actor, 'APPLIED', { from: OPEN, to: 'APPLIED', note: `${inr(before)} → ${inr(invoice.totalPaise)}` });
  await adj.save();
}

registerApprovalHandler('FeeAdjustment', {
  async onApproved(req, actor) {
    const adj = await FeeAdjustment.findById(req.entityId);
    if (adj && adj.status === OPEN) await apply(adj, actor);
  },
  async onRejected(req, actor) {
    const adj = await FeeAdjustment.findById(req.entityId);
    if (!adj || adj.status !== OPEN) return;
    adj.status = 'REJECTED';
    pushHistory(adj, actor, 'REJECTED', { from: OPEN, to: 'REJECTED', note: req.stages?.[req.currentStage]?.comment ?? null });
    await adj.save();
  },
  async onReturned(req, actor) {
    const adj = await FeeAdjustment.findById(req.entityId);
    if (!adj || adj.status !== OPEN) return;
    // Returned for changes: the reserved amount is released; raise it again with the changes.
    adj.status = 'WITHDRAWN';
    pushHistory(adj, actor, 'RETURNED', { from: OPEN, to: 'WITHDRAWN', note: req.stages?.[req.currentStage]?.comment ?? null });
    await adj.save();
  },
  async onWithdrawn(req, actor) {
    const adj = await FeeAdjustment.findById(req.entityId);
    if (!adj || adj.status !== OPEN) return;
    adj.status = 'WITHDRAWN';
    pushHistory(adj, actor, 'WITHDRAWN', { from: OPEN, to: 'WITHDRAWN' });
    await adj.save();
  },
});

export async function withdrawAdjustment(actor, id, body = {}) {
  const adj = await FeeAdjustment.findById(assertObjectId(id));
  if (!adj) throw new AppError('Adjustment not found', 404);
  if (adj.status !== OPEN) throw new AppError('Only a request waiting for approval can be withdrawn.', 409);
  await withdrawApproval(actor, String(adj.approvalRequestId), { reason: optionalText(body.reason, { max: 500 }) || 'Withdrawn by requester' });
  return presentAdjustment((await FeeAdjustment.findById(adj._id).lean()));
}

export async function listAdjustments(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.invoiceId) filter.invoiceId = assertObjectId(query.invoiceId, 'invoiceId');
  if (query.kind) filter.kind = oneOf(query.kind, ['CONCESSION', 'CREDIT_NOTE', 'VOID'], 'kind');
  if (query.status) filter.status = oneOf(query.status, ['PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'WITHDRAWN'], 'status');
  const rows = await FeeAdjustment.find(filter).sort({ createdAt: -1 }).limit(500).select('-history').lean();
  const out = [];
  // eslint-disable-next-line no-await-in-loop
  for (const r of rows) out.push(await presentAdjustment(r));
  return out;
}

/** An invoice with its lines and every adjustment, for the screen that requests one. */
export async function invoiceForAdjustment(actor, id) {
  requireProfile(actor);
  const inv = await Invoice.findById(assertObjectId(id)).lean();
  if (!inv) throw new AppError('Invoice not found', 404);
  const [lines, adjustments] = await Promise.all([linesWithHeads(inv._id), FeeAdjustment.find({ invoiceId: inv._id }).sort({ createdAt: 1 }).select('-history').lean()]);
  const reserved = adjustments.filter((a) => a.status === OPEN).reduce((n, a) => n + a.amountPaise, 0);
  return { invoice: dto(inv), lines: lines.map(dto), adjustments: adjustments.map(dto), outstandingPaise: inv.totalPaise - (inv.paidPaise ?? 0), reservedPaise: reserved, adjustablePaise: Math.max(0, inv.totalPaise - (inv.paidPaise ?? 0) - reserved) };
}
