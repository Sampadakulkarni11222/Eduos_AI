import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { Licence } from '../src/models/compliance.model.js';
import { Contract } from '../src/models/administration.model.js';
import * as bills from '../src/modules/bills/bills.service.js';
import * as review from '../src/modules/bills/review.service.js';
import { renewals, syncRenewals } from '../src/modules/bills/renewals.service.js';

/**
 * Bills: a recorded payment is not a settled bill until a second person
 * confirms it; every due date is a task; AMC visits close with evidence and
 * schedule the next; the review queue explains each flag with its numbers;
 * and the renewals list combines the registers.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

beforeEach(async () => { s = await seedSchool(); });

describe('a bill and its payments', () => {
  it('stays unsettled until a different person confirms the payment, and tracks its task', async () => {
    const finance = s.people.FINANCE.actor;
    const admin = s.people.ADMIN.actor;
    const acct = await inOak(() => bills.createAccount(finance, { name: 'Electricity — main meter', category: 'ELECTRICITY', vendorName: 'State Power Distribution Co.', accountNo: 'CN-4471-0092', billingCycle: 'MONTHLY', expectedAmountPaise: 8_500_000, consumptionUnit: 'kWh' }));
    const bill = await inOak(() => bills.createBill(finance, { accountId: acct.id, billNo: 'E-0926', billDate: daysAgo(5), dueOn: new Date(Date.now() + 10 * DAY), amountPaise: 9_000_000, units: 10500 }));
    expect(bill.status).toBe('DUE');
    await expect(inOak(() => bills.createBill(finance, { accountId: acct.id, billNo: 'e-0926', dueOn: new Date(), amountPaise: 1 }))).rejects.toMatchObject({ code: 'DUPLICATE_BILL' });
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: { $regex: `^bill:${bill.id}:pay:` }, status: 'OPEN' }))).toBe(1);
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: { $regex: `^billacct:${acct.id}:expected:` }, status: 'OPEN' }))).toBe(1);

    const part = await inOak(() => bills.recordPayment(finance, bill.id, { amountPaise: 4_000_000, mode: 'BANK', reference: 'NEFT-1', evidence: [{ name: 'Screenshot', url: '/uploads/p1.png' }] }));
    expect(part.status).toBe('PARTIALLY_PAID');
    await expect(inOak(() => bills.recordPayment(finance, bill.id, { amountPaise: 6_000_000, mode: 'BANK' }))).rejects.toMatchObject({ code: 'OVERPAYMENT' });
    const full = await inOak(() => bills.recordPayment(finance, bill.id, { amountPaise: 5_000_000, mode: 'UPI', reference: 'UPI-2' }));
    expect(full.status).toBe('PAYMENT_RECORDED');
    expect(full.settled).toBe(false);
    await expect(inOak(() => bills.confirmPayment(finance, bill.id, full.payments[0]._id, { bankReference: 'UTR1' }))).rejects.toMatchObject({ code: 'SAME_PERSON' });
    await inOak(() => bills.confirmPayment(admin, bill.id, full.payments[0]._id, { bankReference: 'UTR1' }));
    const paid = await inOak(() => bills.confirmPayment(admin, bill.id, full.payments[1]._id, { bankReference: 'UTR2' }));
    expect(paid.status).toBe('PAID');
    expect(paid.outstandingPaise).toBe(0);
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: { $regex: `^bill:${bill.id}:pay:` }, status: 'OPEN' }))).toBe(0);
  });
});

describe('service visits', () => {
  it('needs evidence to close a visit and schedules the next one', async () => {
    const admin = s.people.ADMIN.actor;
    const acct = await inOak(() => bills.createAccount(admin, { name: 'Fire extinguisher AMC', category: 'AMC', vendorName: 'SafeGuard Fire Services', billingCycle: 'ANNUAL', expectedAmountPaise: 2_400_000, visitsPerYear: 4, firstVisitOn: new Date(Date.now() + 3 * DAY) }));
    const [visit] = await inOak(() => bills.listVisits(admin, { accountId: acct.id }));
    await expect(inOak(() => bills.completeVisit(admin, visit.id, {}))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const out = await inOak(() => bills.completeVisit(admin, visit.id, { technician: 'R. Iyer', findings: '24 units refilled', evidence: [{ name: 'Service report', url: '/uploads/amc.pdf' }] }));
    expect(out.next.status).toBe('SCHEDULED');
    const gap = (new Date(out.next.scheduledOn) - new Date(out.visit.doneOn)) / DAY;
    expect(gap).toBeGreaterThan(85);
    expect(gap).toBeLessThan(95);
  });
});

describe('review queue', () => {
  it('explains an amount above average, a duplicate candidate, an overdue bill and a payment without evidence', async () => {
    const admin = s.people.ADMIN.actor;
    const water = await inOak(() => bills.createAccount(admin, { name: 'Water supply', category: 'WATER', vendorName: 'City Water Board', billingCycle: 'MONTHLY', consumptionUnit: 'kL' }));
    for (const [i, amt, units] of [[150, 1_200_000, 300], [120, 1_250_000, 310], [90, 1_180_000, 295], [60, 1_220_000, 305]]) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => bills.createBill(admin, { accountId: water.id, billNo: `W-${i}`, billDate: daysAgo(i), dueOn: daysAgo(i - 15), amountPaise: amt, units }));
    }
    const spike = await inOak(() => bills.createBill(admin, { accountId: water.id, billNo: 'W-30', billDate: daysAgo(30), dueOn: daysAgo(10), amountPaise: 2_600_000, units: 640 }));
    await inOak(() => bills.createBill(admin, { accountId: water.id, billNo: 'W-27', billDate: daysAgo(27), dueOn: new Date(Date.now() + 5 * DAY), amountPaise: 2_600_000 }));
    await inOak(() => bills.recordPayment(admin, spike.id, { amountPaise: 100_000, mode: 'CASH' }));
    const q = await inOak(() => review.reviewQueue(admin, {}));
    const codes = new Set(q.items.map((f) => f.code));
    for (const c of ['AMOUNT_ABOVE_AVERAGE', 'CONSUMPTION_SPIKE', 'DUPLICATE_CANDIDATE', 'UNPAID_PAST_DUE', 'PAYMENT_WITHOUT_EVIDENCE']) expect(codes.has(c)).toBe(true);
    const above = q.items.find((f) => f.code === 'AMOUNT_ABOVE_AVERAGE' && f.entityId === spike.id);
    expect(above.explanation).toMatch(/average of ₹12,125.00 over the previous 4 bills/);
    expect(JSON.stringify(q)).not.toMatch(/fraud/i);
    await inOak(() => review.reviewFlag(admin, { flagKey: above.key, status: 'EXPLAINED', note: 'Tanker supply during pipeline repair' }));
    const after = await inOak(() => review.reviewQueue(admin, {}));
    expect(after.items.some((f) => f.key === above.key)).toBe(false);
    const dash = await inOak(() => review.dashboard(admin, { preset: 'financialYear', compare: 'lastYear' }));
    expect(dash.byCategory.find((c) => c.category === 'WATER').bills).toBeGreaterThan(0);
  });
});

describe('renewals', () => {
  it('lists licences, agreements and service contracts due next quarter, with cost and owner, and puts them in the tasks queue', async () => {
    const admin = s.people.ADMIN.actor;
    await inOak(async () => {
      await Licence.create({ kind: 'NOC', title: 'Fire safety NOC', expiresOn: new Date(Date.now() + 40 * DAY), renewalCostPaise: 1_500_000, ownerProfileId: s.people.ADMIN.profile._id });
      await Contract.create({ refNo: 'AGR/2026/0001', title: 'Housekeeping services', kind: 'SERVICE', counterparty: 'CleanCo', endsOn: new Date(Date.now() + 70 * DAY), noticePeriodDays: 30, autoRenews: true, valuePaise: 36_000_000, status: 'ACTIVE' });
      await Licence.create({ kind: 'INSURANCE', title: 'Building insurance', expiresOn: new Date(Date.now() + 300 * DAY) });
    });
    const list = await inOak(() => renewals(admin, { withinDays: 90 }));
    expect(list.items.map((r) => r.source).sort()).toEqual(['CONTRACT', 'LICENCE']);
    const agr = list.items.find((r) => r.source === 'CONTRACT');
    expect(agr.consequence).toMatch(/Renews automatically unless notice/);
    expect(agr.decideInDays).toBeLessThanOrEqual(41);
    expect(list.total.costPaise).toBe(37_500_000);
    await inOak(() => syncRenewals());
    await inOak(() => syncRenewals());
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: /^renewal:/, status: 'OPEN' }))).toBe(2);
    // Renewed: the licence moves out of the window and its task closes.
    await inOak(() => Licence.updateOne({ title: 'Fire safety NOC' }, { $set: { expiresOn: new Date(Date.now() + 400 * DAY) } }));
    await inOak(() => syncRenewals());
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: /^renewal:/, status: 'OPEN' }))).toBe(1);
  });
});
