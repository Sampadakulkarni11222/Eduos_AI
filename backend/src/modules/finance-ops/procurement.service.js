import { Vendor, PurchaseRequest, Asset, Budget, FundingProposal } from '../../models/finance.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt } from '../../utils/crypto.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { createRequest, registerApprovalHandler } from '../approvals/approval.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, cleanAttachments, asPaise,
  parseDate, requireText, optionalText, oneOf, dto, pageArgs, profilesWithRoles,
} from '../ops/common.js';

/**
 * Procurement: requisition → quotes → budget check → approval → purchase order
 * → goods receipt → invoice match → payment approval → payment → assets.
 *
 * Controls enforced here:
 *   - quotes: at or above the quote threshold, three quotes are needed unless
 *     an emergency is declared with a reason (which the approver sees);
 *   - budget: the approval summary says whether the budget line can absorb it;
 *     approval commits the amount and payment moves it to actuals;
 *   - split purchases: several small requests that together cross the
 *     threshold are flagged to the approver;
 *   - conflicts: a vendor's declared-conflict staff are named to the approver;
 *   - duplicate invoices: the same vendor invoice number cannot be booked twice;
 *   - three-way match: invoice vs PO vs quantity received; a mismatch needs a
 *     separate payment approval;
 *   - separation: the requester cannot receive their own goods, and the person
 *     who initiates a payment cannot confirm it.
 */

export const QUOTE_THRESHOLD_PAISE = 50_000 * 100;
const MATCH_TOLERANCE_BP = 100; // 1%
const MACHINE = {
  DRAFT: ['IN_APPROVAL', 'CANCELLED'],
  IN_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['PO_ISSUED', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  PO_ISSUED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED'],
  RECEIVED: ['INVOICED'],
  INVOICED: ['PAYMENT_APPROVED', 'INVOICED'],
  PAYMENT_APPROVED: ['PAYMENT_INITIATED'],
  PAYMENT_INITIATED: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

// ── Vendors ──────────────────────────────────────────────────────────────

function presentVendor(v, actor) {
  const out = dto(v);
  delete out.bankEnc;
  if (!actor?.permissions?.['procurement.manage']) delete out.conflicts;
  return out;
}

export async function createVendor(actor, body = {}) {
  const gstin = optionalText(body.gstin, { max: 15 })?.toUpperCase() || null;
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new AppError('GSTIN format is not valid', 400);
  if (gstin && await Vendor.exists({ gstin })) throw new AppError('A vendor with this GSTIN exists', 409, [], 'DUPLICATE_VENDOR');
  const v = new Vendor({
    name: requireText(body.name, 'name', { max: 160 }), category: optionalText(body.category, { max: 60 }) || null, gstin,
    panMasked: body.pan ? `•••••${String(body.pan).slice(-5)}` : null,
    contactName: optionalText(body.contactName, { max: 120 }) || null, phone: optionalText(body.phone, { max: 20 }) || null,
    email: optionalText(body.email, { max: 120 }) || null, address: optionalText(body.address, { max: 500 }) || null,
  });
  if (body.bank) {
    const accountNo = String(body.bank.accountNo ?? '').replace(/\s+/g, '');
    if (!/^\d{6,20}$/.test(accountNo)) throw new AppError('Bank account number must be 6–20 digits', 400);
    v.bankEnc = encrypt({ accountNo, ifsc: String(body.bank.ifsc ?? '').toUpperCase(), holder: body.bank.holder ?? v.name });
    v.bankLast4 = accountNo.slice(-4);
  }
  pushHistory(v, actor, 'CREATED');
  await v.save();
  return presentVendor(v.toObject(), actor);
}

export async function vendorDueDiligence(actor, id, body = {}) {
  const v = await Vendor.findById(assertObjectId(id));
  if (!v) throw new AppError('Vendor not found', 404);
  const status = oneOf(body.status, ['ACTIVE', 'BLOCKED'], 'status');
  v.status = status;
  v.dueDiligence = { note: requireText(body.note, 'note', { max: 2000 }), byProfileId: actor.profileId, at: new Date(), verificationCaseId: optionalText(body.verificationCaseId, { max: 40 }) || null };
  pushHistory(v, actor, `DUE_DILIGENCE_${status}`, { note: v.dueDiligence.note });
  await v.save();
  return presentVendor(v.toObject(), actor);
}

/** Any staff member declares a relationship with a vendor. */
export async function declareVendorConflict(actor, id, body = {}) {
  requireProfile(actor);
  const v = await Vendor.findById(assertObjectId(id));
  if (!v) throw new AppError('Vendor not found', 404);
  v.conflicts.push({ profileId: actor.profileId, declaration: requireText(body.declaration, 'declaration', { max: 1000 }) });
  pushHistory(v, actor, 'CONFLICT_DECLARED');
  await v.save();
  return { declared: true };
}

export async function listVendors(actor) {
  const rows = await Vendor.find({}).sort({ name: 1 }).limit(2000).lean();
  return rows.map((v) => presentVendor(v, actor));
}

// ── Purchase requests ────────────────────────────────────────────────────

function presentPr(pr, actor) {
  const out = dto(pr);
  const received = (pr.items ?? []).reduce((n, i) => n + (i.receivedQty ?? 0), 0);
  const ordered = (pr.items ?? []).reduce((n, i) => n + i.qty, 0);
  out.receivedPct = ordered ? Math.round((received / ordered) * 100) : 0;
  out.selectedQuote = (pr.quotes ?? []).find((q) => q.selected) ?? null;
  out.amountPaise = out.selectedQuote?.amountPaise ?? pr.estimatedTotalPaise;
  out.isRequester = String(pr.requesterProfileId) === String(actor?.profileId);
  return out;
}

async function load(id, actor, scope) {
  const pr = await PurchaseRequest.findById(assertObjectId(id));
  if (!pr || (scope !== 'ALL' && String(pr.requesterProfileId) !== String(actor.profileId))) throw new AppError('Purchase request not found', 404);
  return pr;
}

function move(pr, actor, to, note) {
  assertTransition(MACHINE, pr.status, to, 'purchase request');
  pushHistory(pr, actor, to, { from: pr.status, to, note });
  pr.status = to;
}

export async function createRequestDraft(actor, body = {}) {
  requireProfile(actor);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((i) => {
    const qty = Number(i.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError('Each item needs a positive quantity', 400);
    return { description: requireText(i.description, 'item description', { max: 300 }), qty, unit: optionalText(i.unit, { max: 20 }) || 'nos', estUnitPaise: asPaise(i.estUnitPaise, 'estUnitPaise'), isAsset: i.isAsset === true };
  });
  if (!items.length) throw new AppError('Add at least one item', 400);
  const pr = new PurchaseRequest({
    refNo: await nextRef('PR'),
    title: requireText(body.title, 'title', { max: 200 }),
    requesterProfileId: actor.profileId, requesterName: actor.displayName,
    department: optionalText(body.department, { max: 80 }) || null,
    budgetId: body.budgetId ? assertObjectId(body.budgetId, 'budgetId') : null,
    budgetLineCode: optionalText(body.budgetLineCode, { max: 30 })?.toUpperCase() || null,
    kind: oneOf(body.kind, ['OPEX', 'CAPEX'], 'kind', items.some((i) => i.isAsset) ? 'CAPEX' : 'OPEX'),
    items,
    estimatedTotalPaise: items.reduce((n, i) => n + Math.round(i.qty * i.estUnitPaise), 0),
    justification: optionalText(body.justification, { max: 4000 }) ?? '',
    emergency: body.emergency === true,
    emergencyReason: body.emergency === true ? requireText(body.emergencyReason, 'emergencyReason', { max: 1000 }) : null,
    attachments: cleanAttachments(body.attachments, actor),
  });
  pushHistory(pr, actor, 'CREATED', { to: 'DRAFT' });
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

export async function setQuotes(actor, scope, id, body = {}) {
  const pr = await load(id, actor, scope);
  if (pr.status !== 'DRAFT') throw new AppError('Quotes are fixed once the request is submitted.', 409);
  const vendors = await Vendor.find({ _id: { $in: (body.quotes ?? []).map((q) => assertObjectId(q.vendorId, 'vendorId')) } }).lean();
  const byId = new Map(vendors.map((v) => [String(v._id), v]));
  pr.quotes = (body.quotes ?? []).slice(0, 10).map((q) => {
    const v = byId.get(String(q.vendorId));
    if (!v) throw new AppError('Quote vendor not found', 404);
    if (v.status === 'BLOCKED') throw new AppError(`${v.name} is blocked`, 409, [], 'VENDOR_BLOCKED');
    return { vendorId: v._id, vendorName: v.name, amountPaise: asPaise(q.amountPaise, 'quote amount'), validTill: parseDate(q.validTill, 'validTill'), url: optionalText(q.url, { max: 1000 }) || null, selected: q.selected === true };
  });
  if (pr.quotes.filter((q) => q.selected).length > 1) throw new AppError('Select one quote', 400);
  const sel = pr.quotes.find((q) => q.selected);
  if (sel) {
    const lowest = Math.min(...pr.quotes.map((q) => q.amountPaise));
    if (sel.amountPaise > lowest) pr.selectionNote = requireText(body.selectionNote, 'selectionNote (why not the lowest quote)', { max: 2000 });
    else pr.selectionNote = optionalText(body.selectionNote, { max: 2000 }) || null;
  }
  pushHistory(pr, actor, 'QUOTES_UPDATED');
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

/** Pre-approval checks shown to approvers. BLOCKERs stop submission; WARNINGs travel with it. */
export async function runChecks(pr) {
  const checks = [];
  const sel = pr.quotes.find((q) => q.selected);
  const amount = sel?.amountPaise ?? pr.estimatedTotalPaise;
  if (amount >= QUOTE_THRESHOLD_PAISE && pr.quotes.length < 3) {
    if (pr.emergency) checks.push({ level: 'WARNING', code: 'EMERGENCY_FEWER_QUOTES', message: `Emergency purchase with ${pr.quotes.length} quote(s): ${pr.emergencyReason}` });
    else checks.push({ level: 'BLOCKER', code: 'QUOTES_REQUIRED', message: `Purchases of ₹${QUOTE_THRESHOLD_PAISE / 100} or more need three quotes (${pr.quotes.length} attached).` });
  }
  if (pr.quotes.length && !sel) checks.push({ level: 'BLOCKER', code: 'NO_QUOTE_SELECTED', message: 'Select the quote to proceed with.' });
  if (sel) {
    const v = await Vendor.findById(sel.vendorId).lean();
    if (v?.status !== 'ACTIVE') checks.push({ level: 'WARNING', code: 'VENDOR_NOT_VETTED', message: `${sel.vendorName} has not completed due diligence.` });
    if (v?.conflicts?.length) checks.push({ level: 'WARNING', code: 'VENDOR_CONFLICT', message: `${v.conflicts.length} staff member(s) declared a relationship with ${sel.vendorName}; they must not approve this.` });
  }
  if (pr.budgetId && pr.budgetLineCode) {
    const b = await Budget.findById(pr.budgetId).lean();
    const line = b?.lines.find((l) => l.code === pr.budgetLineCode);
    if (!line) checks.push({ level: 'WARNING', code: 'BUDGET_LINE_MISSING', message: 'Budget line not found.' });
    else if (b.status !== 'APPROVED') checks.push({ level: 'WARNING', code: 'BUDGET_NOT_APPROVED', message: `Budget ${b.name} is not approved.` });
    else {
      const available = line.plannedPaise - line.committedPaise - line.actualPaise;
      if (amount > available) checks.push({ level: 'WARNING', code: 'OVER_BUDGET', message: `Exceeds the available budget on ${line.head} by ₹${((amount - available) / 100).toFixed(2)}.` });
    }
  } else checks.push({ level: 'WARNING', code: 'NO_BUDGET_LINE', message: 'Not linked to a budget line.' });
  // Split purchase: same requester, last 30 days, each below threshold but together above it.
  if (amount < QUOTE_THRESHOLD_PAISE) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const recent = await PurchaseRequest.find({ _id: { $ne: pr._id }, requesterProfileId: pr.requesterProfileId, createdAt: { $gte: since }, status: { $nin: ['DRAFT', 'CANCELLED', 'REJECTED'] }, estimatedTotalPaise: { $lt: QUOTE_THRESHOLD_PAISE } }).select('refNo estimatedTotalPaise').lean();
    const sum = recent.reduce((n, r) => n + r.estimatedTotalPaise, 0) + amount;
    if (recent.length && sum >= QUOTE_THRESHOLD_PAISE) checks.push({ level: 'WARNING', code: 'POSSIBLE_SPLIT', message: `Together with ${recent.map((r) => r.refNo).join(', ')} this totals ₹${(sum / 100).toFixed(2)} in 30 days — check it is not a split purchase.` });
  }
  return checks;
}

export async function submit(actor, scope, id) {
  const pr = await load(id, actor, scope);
  if (pr.status !== 'DRAFT') throw new AppError('Only a draft can be submitted.', 409);
  pr.checks = await runChecks(pr);
  const blockers = pr.checks.filter((c) => c.level === 'BLOCKER');
  if (blockers.length) { await pr.save(); throw new AppError(blockers.map((b) => b.message).join(' '), 409, [], blockers[0].code); }
  move(pr, actor, 'IN_APPROVAL');
  await pr.save();
  const sel = pr.quotes.find((q) => q.selected);
  const req = await createRequest(actor, {
    category: pr.kind === 'CAPEX' ? 'CAPEX' : 'PROCUREMENT',
    title: `${pr.refNo} ${pr.title}`, amountPaise: sel?.amountPaise ?? pr.estimatedTotalPaise, department: pr.department,
    summary: [
      `${pr.items.length} item(s). ${sel ? `Selected: ${sel.vendorName} ₹${(sel.amountPaise / 100).toFixed(2)} of ${pr.quotes.length} quote(s).` : 'No quotes (below threshold).'}`,
      pr.selectionNote ? `Selection note: ${pr.selectionNote}` : '',
      pr.justification ? `Justification: ${pr.justification}` : '',
      ...pr.checks.map((c) => `⚠ ${c.message}`),
    ].filter(Boolean).join('\n'),
    riskLevel: pr.checks.some((c) => ['OVER_BUDGET', 'POSSIBLE_SPLIT', 'VENDOR_CONFLICT'].includes(c.code)) ? 'HIGH' : 'LOW',
    priority: pr.emergency ? 'URGENT' : 'NORMAL',
    attachments: pr.quotes.filter((q) => q.url).map((q) => ({ name: `Quote — ${q.vendorName}`, url: q.url })),
  }, { entityType: 'PurchaseRequest', entityId: pr._id });
  pr.approvalRequestId = req.id;
  await pr.save();
  // Staff with a declared conflict on the selected vendor are excluded from deciding.
  if (sel) {
    const v = await Vendor.findById(sel.vendorId).lean();
    if (v?.conflicts?.length) {
      const { declareConflict } = await import('../approvals/approval.service.js');
      for (const c of v.conflicts) {
        // eslint-disable-next-line no-await-in-loop
        await declareConflict({ profileId: String(c.profileId), displayName: 'Declared vendor conflict' }, req.id, { declaration: c.declaration });
      }
    }
  }
  return presentPr(pr.toObject(), actor);
}

async function moveBudget(pr, { committed = 0, actual = 0 }) {
  if (!pr.budgetId || !pr.budgetLineCode) return;
  await Budget.updateOne(
    { _id: pr.budgetId, 'lines.code': pr.budgetLineCode },
    { $inc: { 'lines.$.committedPaise': committed, 'lines.$.actualPaise': actual } },
  );
}

registerApprovalHandler('PurchaseRequest', {
  async onApproved(req, actor) {
    const pr = await PurchaseRequest.findById(req.entityId);
    if (!pr) return;
    move(pr, actor, 'APPROVED');
    await pr.save();
    await moveBudget(pr, { committed: req.amountPaise });
    await notify({ recipientProfileIds: [String(pr.requesterProfileId)], type: 'SYSTEM', title: `Purchase approved: ${pr.title}`, body: pr.refNo, link: `/procurement?id=${pr._id}` });
  },
  async onRejected(req, actor) { const pr = await PurchaseRequest.findById(req.entityId); if (!pr) return; move(pr, actor, 'REJECTED', req.stages[req.currentStage]?.comment); await pr.save(); },
  async onReturned(req, actor) { const pr = await PurchaseRequest.findById(req.entityId); if (!pr) return; move(pr, actor, 'DRAFT', req.stages[req.currentStage]?.comment); pr.approvalRequestId = null; await pr.save(); },
});

export async function issuePo(actor, scope, id) {
  const pr = await load(id, actor, scope);
  const sel = pr.quotes.find((q) => q.selected);
  if (!sel) throw new AppError('No vendor selected.', 409);
  move(pr, actor, 'PO_ISSUED');
  pr.po = { number: await nextRef('PO'), issuedAt: new Date(), issuedByProfileId: actor.profileId, vendorId: sel.vendorId, vendorName: sel.vendorName, amountPaise: sel.amountPaise };
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

export async function receive(actor, scope, id, body = {}) {
  const pr = await load(id, actor, scope);
  if (!['PO_ISSUED', 'PARTIALLY_RECEIVED'].includes(pr.status)) throw new AppError('Goods are received against an issued PO.', 409);
  if (String(pr.requesterProfileId) === String(actor.profileId)) throw new AppError('The requester cannot record receipt of their own purchase.', 403, [], 'SELF_RECEIPT');
  const lines = (body.lines ?? []).map((l) => ({ itemIndex: Number(l.itemIndex), received: Math.max(0, Number(l.received) || 0), rejected: Math.max(0, Number(l.rejected) || 0) }));
  for (const l of lines) {
    const item = pr.items[l.itemIndex];
    if (!item) throw new AppError(`Item ${l.itemIndex} not on this order`, 400);
    if (item.receivedQty + l.received > item.qty) throw new AppError(`More received than ordered for "${item.description}"`, 400, [], 'OVER_RECEIPT');
    item.receivedQty += l.received;
    item.rejectedQty += l.rejected;
  }
  pr.receipts.push({ byProfileId: actor.profileId, byName: actor.displayName, lines, note: optionalText(body.note, { max: 1000 }) || null });
  const complete = pr.items.every((i) => i.receivedQty >= i.qty);
  move(pr, actor, complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED');
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

export async function addInvoice(actor, scope, id, body = {}) {
  const pr = await load(id, actor, scope);
  if (!['RECEIVED', 'INVOICED'].includes(pr.status)) throw new AppError('Book the invoice after the goods are received.', 409);
  const invoiceNo = requireText(body.vendorInvoiceNo, 'vendorInvoiceNo', { max: 60 }).toUpperCase();
  const dup = await PurchaseRequest.findOne({ 'po.vendorId': pr.po.vendorId, 'invoices.vendorInvoiceNo': invoiceNo }).select('refNo').lean();
  if (dup) throw new AppError(`Invoice ${invoiceNo} from this vendor is already booked on ${dup.refNo}.`, 409, [], 'DUPLICATE_INVOICE');
  const amount = asPaise(body.amountPaise, 'amountPaise');
  // Three-way match: value of accepted goods at PO prices vs invoice.
  const ordered = pr.items.reduce((n, i) => n + i.qty, 0);
  const accepted = pr.items.reduce((n, i) => n + Math.max(0, i.receivedQty - i.rejectedQty), 0);
  const expected = Math.round((pr.po.amountPaise * accepted) / (ordered || 1));
  const tolerance = Math.round((expected * MATCH_TOLERANCE_BP) / 10000);
  const matched = Math.abs(amount - expected) <= tolerance;
  pr.invoices.push({
    vendorInvoiceNo: invoiceNo, invoiceDate: parseDate(body.invoiceDate, 'invoiceDate') ?? new Date(), amountPaise: amount,
    taxPaise: asPaise(body.taxPaise ?? 0, 'taxPaise'), url: optionalText(body.url, { max: 1000 }) || null,
    matchStatus: matched ? 'MATCHED' : 'MISMATCH',
    matchNote: matched ? null : `Expected ₹${(expected / 100).toFixed(2)} for ${accepted}/${ordered} accepted units; invoiced ₹${(amount / 100).toFixed(2)}.`,
  });
  move(pr, actor, 'INVOICED');
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

/** Matched invoices are approved for payment by finance; a mismatch needs the approval engine. */
export async function approvePayment(actor, scope, id, body = {}) {
  const pr = await load(id, actor, scope);
  if (pr.status !== 'INVOICED') throw new AppError('Book the invoice first.', 409);
  const inv = pr.invoices.at(-1);
  if (inv.matchStatus === 'MATCHED') {
    if (String(pr.requesterProfileId) === String(actor.profileId)) throw new AppError('The requester cannot approve payment of their own purchase.', 403);
    pr.payment = { ...(pr.payment ?? {}), approvedAt: new Date(), approvedByProfileId: actor.profileId, amountPaise: inv.amountPaise };
    move(pr, actor, 'PAYMENT_APPROVED', 'Three-way match passed');
    await pr.save();
    return presentPr(pr.toObject(), actor);
  }
  const req = await createRequest(actor, {
    category: 'PAYMENT', title: `Payment with invoice mismatch: ${pr.refNo} ${pr.title}`, amountPaise: inv.amountPaise,
    summary: `${inv.matchNote}\nReason to pay: ${requireText(body.reason, 'reason', { max: 2000 })}`,
    attachments: inv.url ? [{ name: `Invoice ${inv.vendorInvoiceNo}`, url: inv.url }] : [],
  }, { entityType: 'PurchasePayment', entityId: pr._id });
  pr.payment = { ...(pr.payment ?? {}), approvalRequestId: req.id };
  pushHistory(pr, actor, 'PAYMENT_APPROVAL_REQUESTED');
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

registerApprovalHandler('PurchasePayment', {
  async onApproved(req, actor) {
    const pr = await PurchaseRequest.findById(req.entityId);
    if (!pr) return;
    pr.payment.approvedAt = new Date();
    pr.payment.approvedByProfileId = actor.profileId;
    pr.payment.amountPaise = req.amountPaise;
    pr.markModified('payment');
    move(pr, actor, 'PAYMENT_APPROVED', 'Mismatch approved');
    await pr.save();
  },
});

export async function initiatePayment(actor, scope, id, body = {}) {
  const pr = await load(id, actor, scope);
  if (pr.status !== 'PAYMENT_APPROVED') throw new AppError('Payment is not approved.', 409);
  pr.payment.initiatedAt = new Date();
  pr.payment.reference = requireText(body.reference, 'reference (UTR / cheque / batch)', { max: 120 });
  move(pr, actor, 'PAYMENT_INITIATED', pr.payment.reference);
  pr.markModified('payment');
  await pr.save();
  return presentPr(pr.toObject(), actor);
}

/** Confirmation from the bank statement, by someone other than the initiator; moves budget to actuals and registers assets. */
export async function confirmPayment(actor, scope, id, body = {}) {
  return runInAmbientTransaction(async () => {
    const pr = await load(id, actor, scope);
    if (pr.status !== 'PAYMENT_INITIATED') throw new AppError('Payment has not been initiated.', 409);
    const initiator = pr.history.filter((h) => h.to === 'PAYMENT_INITIATED').at(-1)?.actorProfileId;
    if (String(initiator) === String(actor.profileId)) throw new AppError('A different person confirms the payment from the bank statement.', 403, [], 'SAME_PERSON');
    pr.payment.confirmedAt = parseDate(body.confirmedAt, 'confirmedAt') ?? new Date();
    pr.payment.confirmedByProfileId = actor.profileId;
    pr.payment.bankReference = requireText(body.bankReference, 'bankReference', { max: 120 });
    move(pr, actor, 'PAID');
    pr.markModified('payment');
    await pr.save();
    await moveBudget(pr, { committed: -(pr.po?.amountPaise ?? 0), actual: pr.payment.amountPaise ?? 0 });
    // Accepted asset items become register entries with tags.
    let n = await Asset.countDocuments({});
    for (const item of pr.items.filter((i) => i.isAsset)) {
      const units = Math.max(0, Math.floor(item.receivedQty - item.rejectedQty));
      for (let k = 0; k < units && k < 500; k++) {
        n += 1;
        // eslint-disable-next-line no-await-in-loop
        await Asset.create({ tag: `AST-${String(n).padStart(5, '0')}`, description: item.description, costPaise: Math.round((pr.po.amountPaise / pr.items.reduce((m, i) => m + i.qty, 0))), acquiredOn: pr.payment.confirmedAt, vendorName: pr.po.vendorName, purchaseRequestId: pr._id });
      }
    }
    return presentPr(pr.toObject(), actor);
  });
}

export async function cancel(actor, scope, id, { reason } = {}) {
  const pr = await load(id, actor, scope);
  const wasCommitted = ['APPROVED', 'PO_ISSUED'].includes(pr.status);
  move(pr, actor, 'CANCELLED', requireText(reason, 'reason', { max: 500 }));
  await pr.save();
  if (wasCommitted) await moveBudget(pr, { committed: -((pr.quotes.find((q) => q.selected)?.amountPaise) ?? pr.estimatedTotalPaise) });
  return presentPr(pr.toObject(), actor);
}

export async function listRequests(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = scope === 'ALL' ? {} : { requesterProfileId: actor.profileId };
  if (query.status) filter.status = String(query.status).toUpperCase();
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    PurchaseRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).select('-history').lean(),
    PurchaseRequest.countDocuments(filter),
  ]);
  return { items: rows.map((r) => presentPr(r, actor)), total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function getRequestById(actor, scope, id) {
  return presentPr((await load(id, actor, scope)).toObject(), actor);
}

export async function listAssets() {
  return (await Asset.find({}).sort({ tag: 1 }).limit(5000).lean()).map(dto);
}

export async function updateAsset(id, body = {}) {
  const a = await Asset.findById(assertObjectId(id));
  if (!a) throw new AppError('Asset not found', 404);
  if (body.status !== undefined) a.status = oneOf(body.status, ['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED'], 'status');
  if (body.facilityId !== undefined) a.facilityId = body.facilityId ? assertObjectId(body.facilityId) : null;
  if (body.custodianProfileId !== undefined) a.custodianProfileId = body.custodianProfileId ? assertObjectId(body.custodianProfileId) : null;
  if (body.warrantyUntil !== undefined) a.warrantyUntil = parseDate(body.warrantyUntil, 'warrantyUntil');
  await a.save();
  return dto(a);
}

// ── Budgets ──────────────────────────────────────────────────────────────

function presentBudget(b) {
  const out = dto(b);
  out.lines = (out.lines ?? []).map((l) => ({
    ...l,
    availablePaise: l.plannedPaise - l.committedPaise - l.actualPaise,
    variancePaise: l.actualPaise - l.plannedPaise,
    utilisationPct: l.plannedPaise ? Math.round(((l.actualPaise + l.committedPaise) / l.plannedPaise) * 100) : null,
  }));
  out.totals = out.lines.reduce((t, l) => ({ planned: t.planned + l.plannedPaise, committed: t.committed + l.committedPaise, actual: t.actual + l.actualPaise }), { planned: 0, committed: 0, actual: 0 });
  return out;
}

export async function createBudget(actor, body = {}) {
  const fy = requireText(body.fiscalYear, 'fiscalYear', { max: 9 });
  if (!/^\d{4}-\d{2}$/.test(fy)) throw new AppError('fiscalYear must look like 2026-27', 400);
  const codes = new Set();
  const lines = (body.lines ?? []).slice(0, 300).map((l) => {
    const code = requireText(l.code, 'line code', { max: 30 }).toUpperCase();
    if (codes.has(code)) throw new AppError(`Line ${code} appears twice`, 400);
    codes.add(code);
    return { code, department: optionalText(l.department, { max: 80 }) || null, head: requireText(l.head, 'head', { max: 120 }), kind: oneOf(l.kind, ['OPEX', 'CAPEX'], 'kind', 'OPEX'), plannedPaise: asPaise(l.plannedPaise, 'plannedPaise') };
  });
  const b = new Budget({ fiscalYear: fy, name: requireText(body.name, 'name', { max: 120 }), campusCode: optionalText(body.campusCode, { max: 20 }) || null, lines });
  pushHistory(b, actor, 'CREATED');
  try { await b.save(); } catch (err) { if (err?.code === 11000) throw new AppError('A budget with that name exists for the year', 409); throw err; }
  return presentBudget(b.toObject());
}

export async function submitBudget(actor, id) {
  const b = await Budget.findById(assertObjectId(id));
  if (!b) throw new AppError('Budget not found', 404);
  if (b.status !== 'DRAFT') throw new AppError('Only a draft budget can be submitted.', 409);
  b.status = 'IN_APPROVAL';
  pushHistory(b, actor, 'IN_APPROVAL');
  await b.save();
  const total = b.lines.reduce((n, l) => n + l.plannedPaise, 0);
  const req = await createRequest(actor, { category: 'BUDGET', title: `Budget ${b.fiscalYear}: ${b.name}`, amountPaise: total, summary: b.lines.map((l) => `${l.code} ${l.head}: ₹${(l.plannedPaise / 100).toFixed(2)}`).join('\n').slice(0, 5000) }, { entityType: 'Budget', entityId: b._id });
  b.approvalRequestId = req.id;
  await b.save();
  return presentBudget(b.toObject());
}

registerApprovalHandler('Budget', {
  async onApproved(req, actor) { const b = await Budget.findById(req.entityId); if (!b) return; b.status = 'APPROVED'; pushHistory(b, actor, 'APPROVED'); await b.save(); },
  async onRejected(req, actor) { const b = await Budget.findById(req.entityId); if (!b) return; b.status = 'DRAFT'; pushHistory(b, actor, 'REJECTED'); b.approvalRequestId = null; await b.save(); },
  async onReturned(req, actor) { const b = await Budget.findById(req.entityId); if (!b) return; b.status = 'DRAFT'; pushHistory(b, actor, 'RETURNED'); b.approvalRequestId = null; await b.save(); },
});

export async function explainVariance(actor, id, body = {}) {
  const b = await Budget.findById(assertObjectId(id));
  if (!b) throw new AppError('Budget not found', 404);
  const line = b.lines.find((l) => l.code === String(body.code ?? '').toUpperCase());
  if (!line) throw new AppError('Line not found', 404);
  line.varianceExplanation = requireText(body.explanation, 'explanation', { max: 2000 });
  pushHistory(b, actor, 'VARIANCE_EXPLAINED', { note: `${line.code}: ${line.varianceExplanation}` });
  await b.save();
  return presentBudget(b.toObject());
}

export async function listBudgets() {
  return (await Budget.find({}).sort({ fiscalYear: -1, name: 1 }).lean()).map(presentBudget);
}

// ── Funding ──────────────────────────────────────────────────────────────

/** Equated monthly instalment in paise for principal P, annual rate (bp) and tenure (months). */
export function emi(principalPaise, annualRateBp, months) {
  if (!months) return 0;
  if (!annualRateBp) return Math.round(principalPaise / months);
  const r = annualRateBp / 10000 / 12;
  const f = (1 + r) ** months;
  return Math.round((principalPaise * r * f) / (f - 1));
}

export async function createFunding(actor, body = {}) {
  const offers = (body.offers ?? []).slice(0, 10).map((o) => {
    const principal = asPaise(o.principalPaise ?? body.amountRequestedPaise, 'principalPaise');
    const rate = Number.parseInt(o.annualRateBp, 10) || 0;
    const tenure = Math.max(0, Number.parseInt(o.tenureMonths, 10) || 0);
    const e = emi(principal, rate, tenure);
    const fee = asPaise(o.processingFeePaise ?? 0, 'processingFeePaise');
    const totalInterest = tenure ? e * tenure - principal : 0;
    return { provider: requireText(o.provider, 'provider', { max: 120 }), principalPaise: principal, annualRateBp: rate, tenureMonths: tenure, processingFeePaise: fee, emiPaise: e, totalInterestPaise: totalInterest, totalCostPaise: totalInterest + fee, covenants: optionalText(o.covenants, { max: 2000 }) || null, selected: o.selected === true };
  });
  const f = new FundingProposal({
    refNo: await nextRef('FND'), kind: oneOf(body.kind, ['LOAN', 'GRANT', 'DONATION', 'CSR', 'GOVERNMENT_SCHEME', 'INTERNAL_RESERVE'], 'kind'),
    title: requireText(body.title, 'title', { max: 200 }), purpose: optionalText(body.purpose, { max: 4000 }) ?? '',
    amountRequestedPaise: asPaise(body.amountRequestedPaise, 'amountRequestedPaise'), restricted: body.restricted === true, offers,
    attachments: cleanAttachments(body.attachments, actor),
  });
  pushHistory(f, actor, 'CREATED');
  await f.save();
  return dto(f);
}

export async function submitFunding(actor, id) {
  const f = await FundingProposal.findById(assertObjectId(id));
  if (!f) throw new AppError('Proposal not found', 404);
  if (f.status !== 'DRAFT') throw new AppError('Only a draft can be submitted.', 409);
  const sel = f.offers.find((o) => o.selected);
  f.status = 'IN_APPROVAL';
  pushHistory(f, actor, 'IN_APPROVAL');
  await f.save();
  const cmp = [...f.offers].sort((a, b) => a.totalCostPaise - b.totalCostPaise).map((o) => `${o.provider}: EMI ₹${(o.emiPaise / 100).toFixed(2)} × ${o.tenureMonths}, total cost ₹${(o.totalCostPaise / 100).toFixed(2)}${o.selected ? ' (selected)' : ''}`);
  const req = await createRequest(actor, { category: 'FUNDING', title: `${f.kind}: ${f.title}`, amountPaise: f.amountRequestedPaise, summary: [f.purpose, ...cmp, sel?.covenants ? `Covenants: ${sel.covenants}` : ''].filter(Boolean).join('\n').slice(0, 5000) }, { entityType: 'FundingProposal', entityId: f._id });
  f.approvalRequestId = req.id;
  await f.save();
  return dto(f);
}

registerApprovalHandler('FundingProposal', {
  async onApproved(req, actor) { const f = await FundingProposal.findById(req.entityId); if (!f) return; f.status = 'APPROVED'; pushHistory(f, actor, 'APPROVED — the institution may now apply; the ERP never applies or draws funds itself'); await f.save(); },
  async onRejected(req, actor) { const f = await FundingProposal.findById(req.entityId); if (!f) return; f.status = 'REJECTED'; pushHistory(f, actor, 'REJECTED'); await f.save(); },
  async onReturned(req, actor) { const f = await FundingProposal.findById(req.entityId); if (!f) return; f.status = 'DRAFT'; f.approvalRequestId = null; pushHistory(f, actor, 'RETURNED'); await f.save(); },
});

export async function updateFunding(actor, id, body = {}) {
  const f = await FundingProposal.findById(assertObjectId(id));
  if (!f) throw new AppError('Proposal not found', 404);
  if (body.status) {
    const to = oneOf(body.status, ['APPLIED', 'SANCTIONED', 'DISBURSED', 'CLOSED'], 'status');
    const order = ['APPROVED', 'APPLIED', 'SANCTIONED', 'DISBURSED', 'CLOSED'];
    if (order.indexOf(to) <= order.indexOf(f.status) || order.indexOf(f.status) < 0) throw new AppError(`Cannot move from ${f.status} to ${to}`, 409);
    f.status = to;
    pushHistory(f, actor, to, { note: body.note });
  }
  if (body.disbursement) f.disbursements.push({ at: parseDate(body.disbursement.at, 'at') ?? new Date(), amountPaise: asPaise(body.disbursement.amountPaise), reference: requireText(body.disbursement.reference, 'reference', { max: 120 }) });
  if (body.utilisation) {
    const disbursed = f.disbursements.reduce((n, d) => n + d.amountPaise, 0);
    const used = f.utilisation.reduce((n, u) => n + u.amountPaise, 0);
    const amt = asPaise(body.utilisation.amountPaise);
    if (used + amt > disbursed) throw new AppError('Utilisation cannot exceed the amount disbursed.', 409);
    f.utilisation.push({ at: new Date(), amountPaise: amt, description: requireText(body.utilisation.description, 'description', { max: 300 }) });
  }
  await f.save();
  return dto(f);
}

export async function listFunding() {
  return (await FundingProposal.find({}).sort({ createdAt: -1 }).lean()).map(dto);
}

export async function stats() {
  const [inApproval, toReceive, toPay, budgets] = await Promise.all([
    PurchaseRequest.countDocuments({ status: 'IN_APPROVAL' }),
    PurchaseRequest.countDocuments({ status: { $in: ['PO_ISSUED', 'PARTIALLY_RECEIVED'] } }),
    PurchaseRequest.countDocuments({ status: { $in: ['INVOICED', 'PAYMENT_APPROVED', 'PAYMENT_INITIATED'] } }),
    Budget.find({ status: 'APPROVED' }).lean(),
  ]);
  const lines = budgets.flatMap((b) => b.lines);
  return {
    purchaseRequestsInApproval: inApproval, ordersAwaitingReceipt: toReceive, invoicesAwaitingPayment: toPay,
    budgetPlannedPaise: lines.reduce((n, l) => n + l.plannedPaise, 0),
    budgetCommittedPaise: lines.reduce((n, l) => n + l.committedPaise, 0),
    budgetActualPaise: lines.reduce((n, l) => n + l.actualPaise, 0),
    linesOverBudget: lines.filter((l) => l.actualPaise + l.committedPaise > l.plannedPaise).length,
  };
}

export { profilesWithRoles };
