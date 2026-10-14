import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as approvals from '../src/modules/approvals/approval.service.js';
import * as proc from '../src/modules/finance-ops/procurement.service.js';
import { Asset, PurchaseRequest } from '../src/models/finance.model.js';

/**
 * F11 three-way match compared unit COUNTS across unlike items; asset cost
 *     likewise averaged the PO over all units.
 * F12 asset tags were countDocuments()+1.
 * F28 POs went to vendors still pending due diligence.
 * F13 approval summary money without Indian grouping.
 */

const oak = (fn) => inSchool(OAK, fn);
let P; let roles;

const approveAll = async (reqId) => {
  for (let i = 0; i < 5; i++) {
    const r = await oak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', reqId));
    if (r.status !== 'PENDING') return r;
    const who = { PRINCIPAL: P.PRINCIPAL, FINANCE: P.FINANCE, TRUSTEE: P.TRUSTEE }[r.currentApproverRole];
    await oak(() => approvals.decide(who.actor, reqId, { action: 'APPROVE' }));
  }
  return null;
};

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'TRUSTEE']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
});

async function vendors(vetted = true) {
  const out = [];
  for (const name of ['Alpha AV', 'Beta Tech', 'Gamma Supplies']) {
    const v = await oak(() => proc.createVendor(P.FINANCE.actor, { name }));
    if (vetted) await oak(() => proc.vendorDueDiligence(P.FINANCE.actor, v.id, { status: 'ACTIVE', note: 'GST and references checked' }));
    out.push(v);
  }
  return out;
}

/** 1 projector (₹50,000) + 10 HDMI cables (₹100 each), approved. */
async function approvedProjectorOrder(vs, { unitPrices } = {}) {
  const pr = await oak(() => proc.createRequestDraft(P.TEACHER.actor, { title: 'Projector for Room 12', items: [
    { description: 'Projector', qty: 1, estUnitPaise: 5_000_000, isAsset: true },
    { description: 'HDMI cable', qty: 10, estUnitPaise: 10_000, isAsset: true },
  ] }));
  await oak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', pr.id, { quotes: [
    { vendorId: vs[0].id, amountPaise: 5_100_000, selected: true, ...(unitPrices && { unitPrices }) },
    { vendorId: vs[1].id, amountPaise: 5_300_000 },
    { vendorId: vs[2].id, amountPaise: 5_400_000 },
  ] }));
  const sub = await oak(() => proc.submit(P.TEACHER.actor, 'OWN', pr.id));
  await approveAll(sub.approvalRequestId);
  return { pr, sub };
}

describe('F11: three-way match values each line at its quoted unit price', () => {
  it('an invoice for the near-full PO does not match when only the cables were accepted', async () => {
    const vs = await vendors();
    const { pr } = await approvedProjectorOrder(vs);
    await oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id));
    await oak(() => proc.receive(P.ADMIN.actor, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 1, rejected: 1 }, { itemIndex: 1, received: 10 }] }));

    // The old count-based figure: ₹51,000 × 10/11 ≈ ₹46,364, which this would have matched.
    const bad = await oak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr.id, { vendorInvoiceNo: 'AV/1', amountPaise: 4_636_400 }));
    expect(bad.invoices.at(-1).matchStatus).toBe('MISMATCH');
    expect(bad.invoices.at(-1).matchNote).toMatch(/Expected ₹1,000\.00/);
    const good = await oak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr.id, { vendorInvoiceNo: 'AV/2', amountPaise: 100_000 }));
    expect(good.invoices.at(-1).matchStatus).toBe('MATCHED');
  });

  it('uses the quote\'s own unit prices when given, and refuses ones that do not add up', async () => {
    const vs = await vendors();
    const draft = await oak(() => proc.createRequestDraft(P.TEACHER.actor, { title: 'x', items: [{ description: 'A', qty: 2, estUnitPaise: 100 }] }));
    await expect(oak(() => proc.setQuotes(P.TEACHER.actor, 'OWN', draft.id, { quotes: [{ vendorId: vs[0].id, amountPaise: 1_000, unitPrices: [100], selected: true }] })))
      .rejects.toMatchObject({ code: 'QUOTE_LINES_MISMATCH' });

    // Projector quoted at ₹50,500 and cables at ₹50 each (total ₹51,000).
    const { pr } = await approvedProjectorOrder(vs, { unitPrices: [5_050_000, 5_000] });
    const po = await oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id));
    expect(po.po.unitPrices).toEqual([5_050_000, 5_000]);
    await oak(() => proc.receive(P.ADMIN.actor, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 1, rejected: 1 }, { itemIndex: 1, received: 10 }] }));
    const inv = await oak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr.id, { vendorInvoiceNo: 'AV/9', amountPaise: 50_000 }));
    expect(inv.invoices.at(-1).matchStatus).toBe('MATCHED');
  });
});

describe('F11/F12: assets are costed per line and tagged from a counter', () => {
  it('each asset carries its own line\'s unit cost; tags continue after existing ones and never repeat', async () => {
    const vs = await vendors();
    await oak(() => Asset.create({ tag: 'AST-00007', description: 'Old desk', costPaise: 1 }));
    const { pr } = await approvedProjectorOrder(vs);
    await oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id));
    await oak(() => proc.receive(P.ADMIN.actor, 'ALL', pr.id, { lines: [{ itemIndex: 0, received: 1 }, { itemIndex: 1, received: 10, rejected: 8 }] }));
    await oak(() => proc.addInvoice(P.FINANCE.actor, 'ALL', pr.id, { vendorInvoiceNo: 'AV/3', amountPaise: 5_020_000 }));
    await oak(() => proc.approvePayment(P.FINANCE.actor, 'ALL', pr.id));
    await oak(() => proc.initiatePayment(P.FINANCE.actor, 'ALL', pr.id, { reference: 'NEFT-9' }));
    const finAlt = await seedPerson({ roleKey: 'FINANCE', roleId: roles.FINANCE, displayName: 'Accounts 2' });
    await oak(() => proc.confirmPayment(finAlt.actor, 'ALL', pr.id, { bankReference: 'UTR-9' }));

    const assets = await oak(() => Asset.find({ purchaseRequestId: pr.id }).sort({ tag: 1 }).lean());
    expect(assets.map((a) => [a.description, a.costPaise])).toEqual([['Projector', 5_000_000], ['HDMI cable', 10_000], ['HDMI cable', 10_000]]);
    expect(assets.map((a) => a.tag)).toEqual(['AST-00008', 'AST-00009', 'AST-00010']);
  });
});

describe('F28: no purchase order to an unvetted vendor without a recorded override', () => {
  it('refuses, then accepts an explicit override with a reason and records it', async () => {
    const vs = await vendors(false);
    const { pr, sub } = await approvedProjectorOrder(vs);
    const req = await oak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', sub.approvalRequestId));
    expect(req.summary).toMatch(/Selected: Alpha AV ₹51,000\.00 of 3 quote\(s\)/);
    expect(req.summary).toMatch(/has not completed due diligence/);

    await expect(oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id))).rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_NOT_VETTED' });
    await expect(oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id, { overrideDueDiligence: true }))).rejects.toMatchObject({ statusCode: 400 });
    const po = await oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id, { overrideDueDiligence: true, overrideReason: 'Only authorised dealer in the district; vetting booked for Monday' }));
    expect(po.status).toBe('PO_ISSUED');
    expect(po.po.dueDiligenceOverride).toMatchObject({ reason: /Only authorised dealer/, vendorStatus: 'PENDING_DUE_DILIGENCE' });
    const stored = await oak(() => PurchaseRequest.findById(pr.id).lean());
    expect(stored.history.at(-1).note).toMatch(/Due diligence overridden/);
  });

  it('never issues to a blocked vendor, override or not', async () => {
    const vs = await vendors();
    const { pr } = await approvedProjectorOrder(vs);
    await oak(() => proc.vendorDueDiligence(P.FINANCE.actor, vs[0].id, { status: 'BLOCKED', note: 'GST cancelled' }));
    await expect(oak(() => proc.issuePo(P.FINANCE.actor, 'ALL', pr.id, { overrideDueDiligence: true, overrideReason: 'x' }))).rejects.toMatchObject({ code: 'VENDOR_BLOCKED' });
  });
});
