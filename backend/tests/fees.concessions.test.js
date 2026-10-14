import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Invoice, InvoiceLine, FeeHead, FeeStructure } from '../src/models/fee.model.js';
import { FeeAdjustment } from '../src/models/feeAdjustment.model.js';
import * as adjustments from '../src/modules/fees/adjustment.service.js';
import * as fees from '../src/modules/fees/fee.service.js';
import { decide } from '../src/modules/approvals/approval.service.js';

/**
 * Concessions, credit notes and voids are recorded adjustments that apply only
 * after approval; the issued total stays; nothing reduces an invoice below
 * what has been paid; and new invoices are numbered from the school's series.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => { s = await seedSchool(); });

describe('fee concessions', () => {
  it('applies a percentage concession only after the principal approves it, keeping the issued total', async () => {
    const finance = s.people.FINANCE.actor;
    const principal = s.people.PRINCIPAL.actor;
    const scheme = await inOak(() => adjustments.createConcessionType(finance, { code: 'SIB', name: 'Sibling concession', kind: 'SIBLING', method: 'PERCENT', valueBp: 1000, eligibility: 'Second child enrolled' }));
    const adj = await inOak(() => adjustments.requestAdjustment(finance, { kind: 'CONCESSION', invoiceId: String(s.inv2._id), concessionTypeId: scheme.id, reason: 'Elder sibling in Class 9' }));
    expect(adj).toMatchObject({ status: 'PENDING_APPROVAL', amountPaise: 50000 });
    expect((await inOak(() => Invoice.findById(s.inv2._id).lean())).totalPaise).toBe(500000);
    // The requester cannot approve their own request.
    await expect(inOak(() => decide(finance, adj.approvalRequestId, { action: 'APPROVE' }))).rejects.toBeTruthy();
    await inOak(() => decide(principal, adj.approvalRequestId, { action: 'APPROVE' }));
    const inv = await inOak(() => Invoice.findById(s.inv2._id).lean());
    expect(inv).toMatchObject({ totalPaise: 450000, grossTotalPaise: 500000, adjustedPaise: 50000 });
    const line = await inOak(() => InvoiceLine.findOne({ invoiceId: s.inv2._id }).lean());
    expect(line.concessionPaise).toBe(50000);
    expect((await inOak(() => FeeAdjustment.findById(adj.id).lean()))).toMatchObject({ status: 'APPLIED', beforeTotalPaise: 500000, afterTotalPaise: 450000 });
  });

  it('refuses to go below what has been paid, and voids only an unpaid invoice', async () => {
    const finance = s.people.FINANCE.actor;
    const principal = s.people.PRINCIPAL.actor;
    await inOak(() => Invoice.updateOne({ _id: s.inv1._id }, { $set: { paidPaise: 700000, status: 'PARTIAL' } }));
    await expect(inOak(() => adjustments.requestAdjustment(finance, { kind: 'CREDIT_NOTE', invoiceId: String(s.inv1._id), amountPaise: 150000, reason: 'Wrong term charged' }))).rejects.toMatchObject({ code: 'EXCEEDS_OUTSTANDING' });
    await expect(inOak(() => adjustments.requestAdjustment(finance, { kind: 'VOID', invoiceId: String(s.inv1._id), reason: 'Raised twice' }))).rejects.toMatchObject({ code: 'INVOICE_HAS_PAYMENTS' });
    const cn = await inOak(() => adjustments.requestAdjustment(finance, { kind: 'CREDIT_NOTE', invoiceId: String(s.inv1._id), amountPaise: 100000, reason: 'Transport not used in June' }));
    await inOak(() => decide(principal, cn.approvalRequestId, { action: 'APPROVE' }));
    expect((await inOak(() => Invoice.findById(s.inv1._id).lean()))).toMatchObject({ totalPaise: 700000, status: 'PAID' });
    const v = await inOak(() => adjustments.requestAdjustment(finance, { kind: 'VOID', invoiceId: String(s.inv2._id), reason: 'Student withdrew before term' }));
    await inOak(() => decide(principal, v.approvalRequestId, { action: 'APPROVE' }));
    const voided = await inOak(() => Invoice.findById(s.inv2._id).lean());
    expect(voided).toMatchObject({ status: 'CANCELLED', totalPaise: 0, grossTotalPaise: 500000, voidReason: 'Student withdrew before term' });
    expect(await inOak(() => Invoice.countDocuments({}))).toBe(2); // nothing deleted
  });
});

describe('invoice numbering and tax lines', () => {
  it('numbers generated invoices from the school series and carries a head\'s GST rate onto the line', async () => {
    await inOak(async () => {
      const head = await FeeHead.create({ name: 'Transport', category: 'TRANSPORT', hsnSac: '996412', gstRateBp: 500 });
      await FeeStructure.create({ feeHeadId: head._id, academicYearId: s.year._id, gradeId: s.grade._id, name: 'Term 1', amountPaise: 300000, dueOn: new Date('2026-11-01') });
    });
    const out = await inOak(() => fees.generateInvoices({ academicYearId: String(s.year._id), gradeId: String(s.grade._id) }));
    expect(out.generated).toBe(4);
    expect(out.invoices.every((i) => /^INV\/\d{4}-\d{2}\/\d{6}$/.test(i.invoiceNo))).toBe(true);
    const inv = await inOak(() => Invoice.findOne({ invoiceNo: out.invoices[0].invoiceNo }).lean());
    expect(inv.totalPaise).toBe(315000);
    const line = await inOak(() => InvoiceLine.findOne({ invoiceId: inv._id }).lean());
    expect(line).toMatchObject({ hsnSac: '996412', gstRateBp: 500, taxPaise: 15000 });
  });
});
