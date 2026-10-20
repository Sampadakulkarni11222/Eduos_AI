import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Invoice, Payment } from '../src/models/fee.model.js';
import { EmployeeCompensation, PayrollRun } from '../src/models/finance.model.js';
import { HealthVisit } from '../src/models/health.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { VerificationCase } from '../src/models/verification.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import * as collections from '../src/modules/p4ops/collections.service.js';
import * as people from '../src/modules/p4ops/people.service.js';
import * as insights from '../src/modules/p4ops/healthInsights.service.js';
import * as health from '../src/modules/health/health.service.js';

/**
 * Part 4 (finance, HR, nurse audit): what the new reports and workflows hold to.
 *   - collections count only ledger-credited money, by mode, cashier, class and head
 *   - ageing buckets overdue fees; reminders reach the guardians once a week
 *   - audit flags carry their evidence (a repeated UTR)
 *   - a day's cash close needs a note for a variance, and a second person checks it
 *   - recruitment follows its stages; a child-facing post needs cleared verification to join
 *   - the full-and-final worksheet: gratuity 15/26 × wage × years, encashment, notice recovery,
 *     then a FULL_AND_FINAL payroll run with those lines (no one pays from here)
 *   - the nurse's watch list finds a cluster in one class and is the nurse's alone
 */

let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const ymd = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const grants = (key) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === key).grants });

beforeEach(async () => {
  s = await seedSchool();
  s.people.HR = await seedPerson({ roleKey: 'HR', roleId: s.roleIds.HR, displayName: 'HR officer' });
  s.people.HR2 = await seedPerson({ roleKey: 'HR', roleId: s.roleIds.HR, displayName: 'HR two' });
  s.people.NURSE = await seedPerson({ roleKey: 'NURSE', roleId: s.roleIds.NURSE, displayName: 'Nurse Joy' });
});
const F = () => s.people.FINANCE.actor;

async function pay(invoice, amountPaise, mode, over = {}) {
  return inOak(() => Payment.create({ invoiceId: invoice._id, amountPaise, mode, status: 'SUCCESS', recordStatus: 'PUBLISHED', paidOn: new Date(), createdByProfileId: s.people.FINANCE.profile._id, ...over }));
}

describe('collections report and day book', () => {
  it('counts credited payments by mode, cashier and class; leaves out pending and rejected', async () => {
    await pay(s.inv1, 300000, 'CASH');
    await pay(s.inv1, 200000, 'UPI', { instrument: { referenceNo: '123456789012' } });
    await pay(s.inv2, 100000, 'CASH', { recordStatus: 'PENDING_ADMIN_APPROVAL' });
    await pay(s.inv2, 999900, 'CASH', { recordStatus: 'REJECTED' });
    const r = await inOak(() => collections.collectionReport(F(), {}));
    expect(r.totals).toMatchObject({ receipts: 2, collectedPaise: 500000 });
    expect(r.byMode.map((m) => [m.key, m.amountPaise])).toEqual([['CASH', 300000], ['UPI', 200000]]);
    expect(r.byCashier[0]).toMatchObject({ key: 'FINANCE user', amountPaise: 500000 });
    expect(r.byClass[0]).toMatchObject({ key: 'Class 6 A', amountPaise: 500000 });
    expect(r.byHead.reduce((n, h) => n + h.amountPaise, 0)).toBe(500000);
    expect(r.pendingApproval).toEqual({ count: 1, amountPaise: 100000 });
    const csv = await inOak(() => collections.dayBookCsv(F(), {}));
    expect(csv.csv.split('\n')).toHaveLength(4); // header + 2 credited + 1 awaiting approval
    expect(csv.csv).toMatch(/Rahul Sharma,OAK-1,Class 6 A,INV-1001,UPI,123456789012,2000\.00,Credited/);
    expect(csv.csv).not.toMatch(/9999\.00/);
  });
});

describe('ageing and reminders', () => {
  it('buckets overdue fees and sends one reminder a week to the guardians', async () => {
    const a = await inOak(() => collections.ageing(F(), {}));
    expect(a.items).toHaveLength(1); // INV-1002 is not yet due
    expect(a.items[0]).toMatchObject({ name: 'Rahul Sharma', outstandingPaise: 800000, bucket: '0-30' });
    expect(a.buckets.find((b) => b.key === '0-30')).toMatchObject({ students: 1, amountPaise: 800000 });
    const dry = await inOak(() => collections.sendReminders(F(), { dryRun: true }));
    expect(dry).toMatchObject({ students: 1, sent: 0, dryRun: true });
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER' }))).toBe(0);
    const sent = await inOak(() => collections.sendReminders(F(), {}));
    expect(sent.sent).toBe(1);
    const n1 = await inOak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER', recipientProfileId: s.people.PARENT.profile._id }));
    expect(n1).toBeGreaterThan(0);
    await inOak(() => collections.sendReminders(F(), {}));
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER' }))).toBe(n1);
  });

  it('keeps to the school: Riverside invoices never appear', async () => {
    const a = await inOak(() => collections.ageing(F(), {}));
    expect(JSON.stringify(a)).not.toMatch(/Riverside|INV-9001/);
  });
});

describe('audit flags', () => {
  it('flags the same UTR on two receipts, with the receipts as evidence', async () => {
    await pay(s.inv1, 100000, 'UPI', { instrument: { referenceNo: '555566667777' } });
    await pay(s.inv2, 100000, 'UPI', { instrument: { referenceNo: '555566667777' } });
    const r = await inOak(() => collections.anomalies(F(), {}));
    const dup = r.flags.find((f) => f.rule === 'DUPLICATE_REFERENCE');
    expect(dup.count).toBe(2);
    expect(dup.evidence.map((e) => e.invoiceNo).sort()).toEqual(['INV-1001', 'INV-1002']);
  });
});

describe('day-end cash close', () => {
  it('needs a note for a variance, refuses a second close, and is checked by a different person', async () => {
    await pay(s.inv1, 250000, 'CASH');
    const exp = await inOak(() => collections.expectedForDay(F(), undefined));
    expect(exp.expectedCashPaise).toBe(250000);
    const counts = [{ denominationPaise: 50000, count: 4 }, { denominationPaise: 20000, count: 2 }]; // ₹2,400: ₹100 short
    await expect(inOak(() => collections.closeDay(F(), { counts }))).rejects.toMatchObject({ code: 'VARIANCE_NEEDS_NOTE' });
    const closed = await inOak(() => collections.closeDay(F(), { counts, note: 'Change given twice' }));
    expect(closed).toMatchObject({ countedPaise: 240000, variancePaise: -10000, status: 'CLOSED' });
    await expect(inOak(() => collections.closeDay(F(), { counts: [{ denominationPaise: 50000, count: 5 }] }))).rejects.toMatchObject({ code: 'ALREADY_CLOSED' });
    await expect(inOak(() => collections.checkClose(F(), closed.id))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    const checked = await inOak(() => collections.checkClose(s.people.ADMIN.actor, closed.id));
    expect(checked).toMatchObject({ status: 'CHECKED', checkedBy: 'ADMIN user' });
  });
});

describe('recruitment', () => {
  it('moves a candidate through the stages, needs an offer, and blocks joining before verification clears', async () => {
    const hr = s.people.HR.actor;
    const v = await inOak(() => people.createVacancy(hr, { title: 'TGT Mathematics', department: 'Academics', subject: 'Mathematics', qualifications: 'B.Ed, CTET' }));
    const c = await inOak(() => people.addCandidate(hr, { vacancyId: v.id, name: 'Kavya Rao', email: 'kavya@example.com', experienceYears: 4 }));
    await expect(inOak(() => people.addCandidate(hr, { vacancyId: v.id, name: 'Kavya Rao', email: 'kavya@example.com' }))).rejects.toMatchObject({ code: 'DUPLICATE_CANDIDATE' });
    await expect(inOak(() => people.moveCandidate(hr, c.id, { stage: 'OFFERED' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await inOak(() => people.moveCandidate(hr, c.id, { stage: 'SCREENED' }));
    await inOak(() => people.moveCandidate(hr, c.id, { stage: 'INTERVIEW' }));
    const scored = await inOak(() => people.scoreCandidate(hr, c.id, { ratings: { subjectKnowledge: 5, pedagogy: 4, childSafeguarding: 3 }, recommendation: 'YES' }));
    expect(scored.averageScore).toBe(4);
    await expect(inOak(() => people.moveCandidate(hr, c.id, { stage: 'OFFERED' }))).rejects.toMatchObject({ code: 'OFFER_MISSING' });
    const offer = await inOak(() => people.draftOffer(hr, c.id, { ctcPaise: 54000000, joiningOn: ymd(new Date(Date.now() + 30 * DAY)) }));
    expect(offer.letter).toMatch(/Kavya Rao/);
    expect(offer.letter).toMatch(/₹5,40,000/);
    expect(offer.letter).toMatch(/police verification/);
    await inOak(() => people.moveCandidate(hr, c.id, { stage: 'OFFERED' }));
    await inOak(() => people.moveCandidate(hr, c.id, { stage: 'ACCEPTED' }));
    await expect(inOak(() => people.moveCandidate(hr, c.id, { stage: 'JOINED' }))).rejects.toMatchObject({ code: 'VERIFICATION_NOT_CLEARED' });
    const started = await inOak(() => people.startCandidateVerification(hr, c.id, {}));
    expect(started.verification.refNo).toMatch(/^BGV\//);
    await inOak(() => VerificationCase.updateOne({ _id: started.verification.id }, { status: 'CLEARED' }));
    const joined = await inOak(() => people.moveCandidate(hr, c.id, { stage: 'JOINED' }));
    expect(joined.stage).toBe('JOINED');
  });

  it('is HR\'s: the finance role does not hold org.manage', () => {
    expect(grants('HR')['org.manage']).toBe('ALL');
    expect(grants('FINANCE')['org.manage']).toBeUndefined();
    expect(grants('NURSE')['org.manage']).toBeUndefined();
  });
});

describe('exit and full-and-final', () => {
  it('works out gratuity, encashment and notice recovery and puts them on a FULL_AND_FINAL run', async () => {
    const hr = s.people.HR.actor;
    const teacher = s.people.TEACHER;
    await inOak(() => EmployeeCompensation.create({
      profileId: teacher.profile._id, employeeCode: 'EMP-T1', name: 'Teacher One', designation: 'TGT English',
      joiningDate: new Date(Date.now() - (6 * 365 + 200) * DAY),
      components: [
        { code: 'BASIC', name: 'Basic', kind: 'EARNING', value: 3000000, statutoryWage: true },
        { code: 'DA', name: 'DA', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 1000, statutoryWage: true },
        { code: 'HRA', name: 'HRA', kind: 'EARNING', value: 900000 },
      ],
    }));
    await expect(inOak(() => people.startExit(hr, { profileId: hr.profileId, kind: 'RESIGNATION', lastWorkingDay: ymd(new Date(Date.now() + 10 * DAY)) }))).rejects.toMatchObject({ code: 'SELF_EXIT' });
    const x = await inOak(() => people.startExit(hr, { profileId: String(teacher.profile._id), kind: 'RESIGNATION', noticeOn: ymd(new Date()), lastWorkingDay: ymd(new Date(Date.now() + 19 * DAY)), departments: ['LIBRARY', 'ACCOUNTS'] }));
    expect(x.clearancesPending).toBe(2);
    await inOak(() => people.updateClearance(hr, x.id, { department: 'LIBRARY', status: 'DUES', duesPaise: 50000, note: '2 books' }));
    await expect(inOak(() => people.sendSettlementToPayroll(hr, x.id))).rejects.toMatchObject({ code: 'NO_ESTIMATE' });
    await inOak(() => people.updateClearance(hr, x.id, { department: 'ACCOUNTS', status: 'CLEARED' }));
    const { settlement } = await inOak(() => people.settlementEstimate(hr, x.id, { elDays: 13 }));
    const line = (n) => settlement.lines.find((l) => l.name === n).amountPaise;
    // wage = 30,000 + 10% DA = 33,000; 6 years + ~200 days (> 6 months) → 7 years.
    expect(settlement.wagePaise).toBe(3300000);
    expect(line('Gratuity')).toBe(Math.round((3300000 * 15 * 7) / 26));
    expect(line('Leave encashment')).toBe(Math.round((3300000 * 13) / 26));
    // 20 days served of 30 → 10 days × gross 42,000 / 30.
    expect(line('Notice period recovery')).toBe(-Math.round((4200000 * 10) / 30));
    expect(line('Clearance dues')).toBe(-50000);
    const sent = await inOak(() => people.sendSettlementToPayroll(hr, x.id));
    const run = await inOak(() => PayrollRun.findById(sent.run.id).lean());
    expect(run.kind).toBe('FULL_AND_FINAL');
    expect(run.inputs[0].adjustments.map((a) => a.name)).toEqual(['Gratuity', 'Leave encashment', 'Notice period recovery', 'Clearance dues']);
    expect(run.status).toBe('DRAFT');
    const comp = await inOak(() => EmployeeCompensation.findOne({ profileId: teacher.profile._id }).lean());
    expect(ymd(comp.exitDate)).toBe(ymd(new Date(Date.now() + 19 * DAY)));
  });

  it('gives no gratuity under five years of service', async () => {
    const hr = s.people.HR.actor;
    await inOak(() => EmployeeCompensation.create({ profileId: s.people.LIBRARIAN.profile._id, employeeCode: 'EMP-L1', name: 'Lib', joiningDate: new Date(Date.now() - 3 * 365 * DAY), components: [{ code: 'BASIC', name: 'Basic', kind: 'EARNING', value: 2000000 }] }));
    const x = await inOak(() => people.startExit(hr, { profileId: String(s.people.LIBRARIAN.profile._id), kind: 'RESIGNATION', noticeOn: ymd(new Date(Date.now() - 40 * DAY)), lastWorkingDay: ymd(new Date()), departments: ['LIBRARY'] }));
    const { settlement } = await inOak(() => people.settlementEstimate(hr, x.id, { elDays: 0 }));
    expect(settlement.lines.find((l) => l.name === 'Gratuity').amountPaise).toBe(0);
    expect(settlement.lines.find((l) => l.name === 'Notice period recovery').amountPaise).toBe(0);
  });
});

describe("the nurse's watch list", () => {
  it('finds a possible cluster in one class, and is refused to everyone but the nurse', async () => {
    const N = s.people.NURSE.actor;
    for (const st of [s.rahul, s.priya, s.aman]) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => health.recordVisit(N, { studentId: String(st.student._id), complaint: 'High fever and body ache', outcome: 'SENT_HOME', vitals: { temperatureC: 38.6 } }));
    }
    await inOak(() => health.recordVisit(N, { studentId: String(s.riya.student._id), complaint: 'Fever', outcome: 'REST' }));
    const w = await inOak(() => insights.insights(N, {}));
    expect(w.clusters).toHaveLength(1);
    expect(w.clusters[0]).toMatchObject({ className: 'Class 6 A', category: 'FEVER', children: 3 });
    expect(w.screening.totalStudents).toBe(4);
    for (const who of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'HR']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(inOak(() => insights.insights(s.people[who].actor, {})), who).rejects.toMatchObject({ statusCode: 403 });
    }
    const csv = await inOak(() => insights.registerCsv(N, {}));
    expect(csv.csv.split('\n')).toHaveLength(5);
    expect(await inOak(() => HealthVisit.countDocuments())).toBe(4);
  });

  it('sorts complaints into categories', () => {
    expect(insights._test.categoryOf('Loose motions since morning')).toBe('GASTRO');
    expect(insights._test.categoryOf('Red sticky eye')).toBe('EYE');
    expect(insights._test.categoryOf('Grazed knee')).toBeNull();
  });
});

describe('tenancy', () => {
  it('keeps vacancies to their school', async () => {
    await inOak(() => people.createVacancy(s.people.HR.actor, { title: 'PGT Physics' }));
    const river = await inSchool(RIVER, () => people.listVacancies({ ...s.people.RIVER_ADMIN.actor }, {}));
    expect(river.items).toHaveLength(0);
    expect(await inOak(() => Invoice.countDocuments())).toBe(2);
  });
});
