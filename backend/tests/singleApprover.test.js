import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, RIVER, seedPerson } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { ShowcaseEntry } from '../src/models/showcase.model.js';
import { Fixture } from '../src/models/club.model.js';
import { OfflineCampaign } from '../src/models/marketingGrowth.model.js';
import { Bill } from '../src/models/bill.model.js';
import * as mode from '../src/modules/policy/approverMode.service.js';
import * as showcase from '../src/modules/showcase/showcase.service.js';
import * as fixtures from '../src/modules/clubs/fixtures.service.js';
import * as growth from '../src/modules/marketing/growth.service.js';
import * as bills from '../src/modules/bills/bills.service.js';

/**
 * Single-approver mode (part 3, decision 3): the second-person rules stay the
 * default; a school may switch the mode on (settings.manage ALL, audited, with
 * a reason) so its principal or administrator can approve their own showcase
 * entry, fixture result, offline campaign or bill payment. Each such record is
 * marked singleApprover and the use is audited. Nobody else gains anything.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const P = () => s.people.PRINCIPAL.actor;
const A = () => s.people.ADMIN.actor;

beforeEach(async () => {
  s = await seedFamilySchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING });
});

const turnOn = () => inOak(() => mode.setApproverMode(A(), { enabled: true, reason: 'Small school: one administrator, one principal' }));

describe('the setting', () => {
  it('is off by default, changes only with settings.manage ALL and a reason, and is audited', async () => {
    expect((await inOak(() => mode.getApproverMode())).singleApproverMode).toBe(false);
    await expect(inOak(() => mode.setApproverMode(P(), { enabled: true, reason: 'x' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => mode.setApproverMode(A(), { enabled: true }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const on = await turnOn();
    expect(on).toMatchObject({ singleApproverMode: true, reason: 'Small school: one administrator, one principal' });
    expect(await inOak(() => AuditLog.countDocuments({ action: 'policy.single_approver.on' }))).toBe(1);
    // Per school: Riverside is unaffected.
    expect((await inSchool(RIVER, () => mode.getApproverMode())).singleApproverMode).toBe(false);
    await inOak(() => mode.setApproverMode(A(), { enabled: false }));
    expect(await inOak(() => AuditLog.countDocuments({ action: 'policy.single_approver.off' }))).toBe(1);
  });
});

describe('showcase review', () => {
  it('refuses self-review by default; with the mode on the principal reviews their own entry, marked single-approver; a teacher never', async () => {
    const ed = await inOak(() => showcase.createEdition(P(), { title: 'Sports week' }));
    const entry = await inOak(() => showcase.addEntry(P(), ed.id, { kind: 'ACHIEVEMENT', studentId: String(s.rahul.student._id), category: 'SPORTS', title: 'Gold, 100 m' }));
    await expect(inOak(() => showcase.reviewEntry(P(), entry.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    await turnOn();
    await inOak(() => showcase.reviewEntry(P(), entry.id, { decision: 'APPROVE' }));
    const row = await inOak(() => ShowcaseEntry.findById(entry.id).lean());
    expect(row).toMatchObject({ status: 'REVIEWED', singleApprover: true });
    expect(await inOak(() => AuditLog.countDocuments({ action: 'policy.single_approver.used', entityType: 'ShowcaseEntry' }))).toBe(1);
  });
});

describe('fixture results', () => {
  it('lets the principal approve a result they recorded only in the mode; a teacher recorder is still refused', async () => {
    const red = await inOak(() => fixtures.createHouse(P(), 'ALL', { name: 'Ruby', colour: '#cc2244', masterProfileIds: [String(s.people.TEACHER.profile._id)] }));
    const blue = await inOak(() => fixtures.createHouse(P(), 'ALL', { name: 'Sapphire', colour: '#2244cc' }));
    await inOak(() => fixtures.assignHouse(P(), 'ALL', { houseId: red.id, studentIds: [String(s.rahul.student._id)] }));
    await inOak(() => fixtures.assignHouse(P(), 'ALL', { houseId: blue.id, studentIds: [String(s.aman.student._id)] }));
    const make = (actor, scope) => inOak(() => fixtures.createFixture(actor, scope, { kind: 'HOUSE', title: 'Relay', activity: 'ATHLETICS', houseIds: [red.id, blue.id], startsAt: new Date(Date.now() - 3_600_000).toISOString() }));
    const result = { summary: 'Ruby won.', outcome: 'PLACED', placements: [{ houseId: red.id, position: 1, points: 10 }, { houseId: blue.id, position: 2, points: 6 }] };

    const fx = await make(P(), 'ALL');
    await inOak(() => fixtures.recordResult(P(), 'ALL', fx.id, result));
    await expect(inOak(() => fixtures.decideResult(P(), 'ALL', fx.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    await turnOn();
    await inOak(() => fixtures.decideResult(P(), 'ALL', fx.id, { decision: 'APPROVE' }));
    expect((await inOak(() => Fixture.findById(fx.id).lean())).result).toMatchObject({ status: 'APPROVED', singleApprover: true });

    // A teacher is not a single approver, mode or not.
    const fx2 = await make(s.people.TEACHER.actor, 'OWN');
    await inOak(() => fixtures.recordResult(s.people.TEACHER.actor, 'OWN', fx2.id, result));
    await expect(inOak(() => fixtures.decideResult(s.people.TEACHER.actor, 'OWN', fx2.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
  });
});

describe('offline campaign approval', () => {
  it('lets the principal approve a campaign they created only in the mode; the marketing creator is still refused', async () => {
    const make = (actor, code) => inOak(() => growth.createOffline(actor, { name: `Posters ${code}`, code, channelType: 'POSTER', startsOn: '2026-10-01', endsOn: '2026-10-31', placements: [{ location: 'Market', quantity: 10 }], quantity: 10, cost: '1000' }));
    const mine = await make(P(), 'P-1');
    await inOak(() => growth.moveOffline(P(), mine.id, { action: 'SUBMIT' }));
    await expect(inOak(() => growth.moveOffline(P(), mine.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await turnOn();
    await inOak(() => growth.moveOffline(P(), mine.id, { action: 'APPROVE', note: 'No second approver here' }));
    const row = await inOak(() => OfflineCampaign.findById(mine.id).lean());
    expect(row.status).toBe('APPROVED');
    expect(row.decision.singleApprover).toBe(true);

    const theirs = await make(s.people.MARKETING.actor, 'M-1');
    await inOak(() => growth.moveOffline(s.people.MARKETING.actor, theirs.id, { action: 'SUBMIT' }));
    await expect(inOak(() => growth.moveOffline(s.people.MARKETING.actor, theirs.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
  });
});

describe('bill payment verification', () => {
  it('lets the administrator confirm a payment they recorded only in the mode; finance still needs a second person', async () => {
    const acct = await inOak(() => bills.createAccount(A(), { name: 'Water', category: 'WATER', vendorName: 'Municipal Water Board', billingCycle: 'MONTHLY' }));
    const bill = await inOak(() => bills.createBill(A(), { accountId: acct.id, billNo: 'W-1', billDate: new Date(Date.now() - 2 * DAY), dueOn: new Date(Date.now() + 10 * DAY), amountPaise: 100_000 }));
    const paid = await inOak(() => bills.recordPayment(A(), bill.id, { amountPaise: 100_000, mode: 'BANK', reference: 'NEFT-9' }));
    const payId = paid.payments[0]._id;
    await expect(inOak(() => bills.confirmPayment(A(), bill.id, payId, { bankReference: 'UTR9' }))).rejects.toMatchObject({ code: 'SAME_PERSON' });
    await turnOn();
    const done = await inOak(() => bills.confirmPayment(A(), bill.id, payId, { bankReference: 'UTR9' }));
    expect(done.status).toBe('PAID');
    expect((await inOak(() => Bill.findById(bill.id).lean())).payments[0].singleApprover).toBe(true);

    const fin = s.people.FINANCE.actor;
    const bill2 = await inOak(() => bills.createBill(fin, { accountId: acct.id, billNo: 'W-2', billDate: new Date(Date.now() - DAY), dueOn: new Date(Date.now() + 10 * DAY), amountPaise: 50_000 }));
    const p2 = await inOak(() => bills.recordPayment(fin, bill2.id, { amountPaise: 50_000, mode: 'BANK', reference: 'NEFT-10' }));
    await expect(inOak(() => bills.confirmPayment(fin, bill2.id, p2.payments[0]._id, { bankReference: 'UTR10' }))).rejects.toMatchObject({ code: 'SAME_PERSON' });
  });
});
