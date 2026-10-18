import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, RIVER, seedSchool, seedPerson } from './support/mcpSchool.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { BookHold, PrivacyRequest } from '../src/models/supportRoles.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { OutPass } from '../src/models/safety.model.js';
import { Lead, LeadInteraction } from '../src/models/lead.model.js';
import { Licence } from '../src/models/compliance.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import * as library from '../src/modules/library/library.service.js';
import * as desk from '../src/modules/library/library.desk.js';
import * as life from '../src/modules/hostel/life.service.js';
import * as privacy from '../src/modules/compliance/privacy.service.js';
import * as followups from '../src/modules/marketing/followups.service.js';

/**
 * Part 4, support roles: the library desk, hostel life, data protection and
 * admissions follow-ups. What these tests hold the services to:
 *   - a renewal extends a loan, at most twice, never an overdue loan, never past a waiting reservation
 *   - a reservation queues when no copy is free; a return sets the copy aside for the first in line
 *     (the copy is claimed, so the desk cannot lend it to someone else); collecting makes the loan
 *   - an overdue reminder goes once a day; a dry run sends nothing
 *   - a fine is settled by a person; waiving needs a reason
 *   - a reading challenge counts returned books in its window, per student
 *   - suggestions come with reasons and never repeat a book already borrowed
 *   - roll call pre-marks residents out on an out-pass; anyone unaccounted for on submit opens a critical task
 *   - a data request has a response date and a task; it cannot be completed before identity is verified
 *   - a breach has a 72-hour clock and cannot be closed before the Board report is recorded
 *   - the readiness checklist names the missing certificate and committee
 *   - the follow-up queue buckets enquiries; logging respects withdrawn contact consent
 *   - everything is tenant-scoped
 */

let s;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const L = () => s.people.LIBRARIAN.actor;
const W = () => s.people.WARDEN.actor;

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Admissions head' });
  s.people.COMPLIANCE = await seedPerson({ roleKey: 'COMPLIANCE', roleId: s.roleIds.COMPLIANCE, displayName: 'Compliance officer' });
});

async function book(over = {}) {
  return inOak(() => Book.create({ title: 'Wings of Fire', author: 'A P J Abdul Kalam', category: 'Biography', totalCopies: 1, availableCopies: 1, ...over }));
}
const issue = (bookId, student, days = 14) => inOak(() => library.issueBook({ bookId: String(bookId), studentId: String(student._id), dueAt: new Date(Date.now() + days * DAY).toISOString().slice(0, 10) }));

describe('library desk: renewals', () => {
  it('extends a loan, at most twice', async () => {
    const b = await book({ totalCopies: 2, availableCopies: 2 });
    const loan = await issue(b._id, s.rahul.student);
    const r1 = await inOak(() => desk.renewLoan(L(), loan.id));
    expect(new Date(r1.dueAt) > new Date(loan.dueAt)).toBe(true);
    expect(r1.renewalsLeft).toBe(1);
    await inOak(() => desk.renewLoan(L(), loan.id));
    await expect(inOak(() => desk.renewLoan(L(), loan.id))).rejects.toMatchObject({ code: 'RENEWAL_LIMIT' });
  });

  it('refuses an overdue loan and one another student is waiting for', async () => {
    const b = await book();
    const loan = await issue(b._id, s.rahul.student);
    await inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.aman.student._id) }));
    await expect(inOak(() => desk.renewLoan(L(), loan.id))).rejects.toMatchObject({ code: 'RESERVED_BY_OTHERS' });
    await inOak(() => BookIssue.updateOne({ _id: loan.id }, { $set: { dueDate: new Date(Date.now() - 3 * DAY) } }));
    await expect(inOak(() => desk.renewLoan(L(), loan.id))).rejects.toMatchObject({ code: 'LOAN_OVERDUE' });
  });
});

describe('library desk: reservations', () => {
  it('queues when no copy is free, sets the returned copy aside for the first in line, and lends it on collection', async () => {
    const b = await book();
    const loan = await issue(b._id, s.rahul.student);
    const h1 = await inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.aman.student._id) }));
    const h2 = await inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.riya.student._id) }));
    expect([h1.status, h1.position, h2.position]).toEqual(['QUEUED', 1, 2]);
    await expect(inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.aman.student._id) }))).rejects.toMatchObject({ code: 'ALREADY_RESERVED' });

    await inOak(() => library.returnBook(loan.id));
    const after = await inOak(() => BookHold.findById(h1.id).lean());
    expect(after.status).toBe('READY');
    // The copy is held for Aman: nobody else can borrow it at the desk.
    expect((await inOak(() => Book.findById(b._id).lean())).availableCopies).toBe(0);
    await expect(issue(b._id, s.priya.student)).rejects.toMatchObject({ statusCode: 409 });

    const got = await inOak(() => desk.collectHold(L(), h1.id));
    expect(got.status).toBe('FULFILLED');
    const lent = await inOak(() => BookIssue.findById(got.issueId).lean());
    expect(String(lent.borrowerProfileId)).toBe(String(s.aman.student._id));
    expect((await inOak(() => BookHold.findById(h2.id).lean())).status).toBe('QUEUED');
  });

  it('an uncollected reservation expires and the copy passes to the next in line', async () => {
    const b = await book();
    const h1 = await inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.aman.student._id) }));
    expect(h1.status).toBe('READY');
    const h2 = await inOak(() => desk.placeHold(L(), { bookId: String(b._id), studentId: String(s.riya.student._id) }));
    const out = await inOak(() => desk.expireHolds({ now: new Date(Date.now() + 10 * DAY) }));
    expect(out.expired).toBe(1);
    expect((await inOak(() => BookHold.findById(h2.id).lean())).status).toBe('READY');
    expect((await inOak(() => Book.findById(b._id).lean())).availableCopies).toBe(0);
  });
});

describe('library desk: overdue and fines', () => {
  it('reminds each overdue borrower once a day; a dry run sends nothing', async () => {
    const b = await book();
    const loan = await issue(b._id, s.rahul.student);
    await inOak(() => BookIssue.updateOne({ _id: loan.id }, { $set: { dueDate: new Date(Date.now() - 4 * DAY) } }));
    const dry = await inOak(() => desk.sendOverdueReminders(L(), { dryRun: true }));
    expect(dry.wouldRemind).toBe(1);
    expect(await inOak(() => MessageOutbox.countDocuments({ idempotencyKey: { $regex: '^library-overdue' } }))).toBe(0);
    const sent = await inOak(() => desk.sendOverdueReminders(L(), {}));
    expect(sent.reminded).toBe(1);
    const again = await inOak(() => desk.sendOverdueReminders(L(), {}));
    expect([again.reminded, again.alreadyToday]).toEqual([0, 1]);
    const list = await inOak(() => desk.overdueList());
    expect(list[0]).toMatchObject({ daysLate: 4, fineSoFarRupees: 20, className: 'Class 6 A' });
  });

  it('a fine is settled by a person; waiving needs a reason', async () => {
    const b = await book();
    const loan = await issue(b._id, s.rahul.student);
    await inOak(() => BookIssue.updateOne({ _id: loan.id }, { $set: { dueDate: new Date(Date.now() - 2 * DAY), status: 'OVERDUE' } }));
    const back = await inOak(() => library.returnBook(loan.id));
    expect([back.finePaise, back.fineStatus]).toEqual([1000, 'DUE']);
    expect((await inOak(() => desk.listFines())).totalDueRupees).toBe(10);
    await expect(inOak(() => desk.settleFine(L(), loan.id, { status: 'WAIVED' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await inOak(() => desk.settleFine(L(), loan.id, { status: 'PAID' }));
    await expect(inOak(() => desk.settleFine(L(), loan.id, { status: 'PAID' }))).rejects.toMatchObject({ code: 'FINE_SETTLED' });
  });
});

describe('library desk: reading programme and suggestions', () => {
  it('a reading challenge counts returned books in its window for the classes taking part', async () => {
    const a = await book({ title: 'Malgudi Days', category: 'Fiction' });
    const b2 = await book({ title: 'The Jungle Book', category: 'Fiction' });
    for (const bk of [a, b2]) { const l = await issue(bk._id, s.rahul.student); await inOak(() => library.returnBook(l.id)); }
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const c = await inOak(() => desk.createChallenge(L(), { title: 'Read 2 this month', sectionIds: [String(s.sectionA._id)], startsOn: today, endsOn: today, targetBooks: 2 }));
    const p = await inOak(() => desk.challengeProgress(c.id));
    const rahul = p.rows.find((r) => r.name === 'Rahul Sharma');
    expect([rahul.read, rahul.completed]).toEqual([2, true]);
    expect(p.rows.find((r) => r.name === 'Riya Kapoor')).toBeUndefined(); // 6 B is not taking part
    const mine = await inOak(() => desk.myChallenges(String(s.rahul.student._id)));
    expect(mine[0]).toMatchObject({ read: 2, completed: true });
  });

  it('a whole-school challenge counts students on roll only, not former pupils (part 5)', async () => {
    const { Enrollment } = await import('../src/models/student.model.js');
    await inOak(() => Enrollment.updateOne({ _id: s.aman.enrollment._id }, { $set: { status: 'GRADUATED' } }));
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const c = await inOak(() => desk.createChallenge(L(), { title: 'Whole school', startsOn: today, endsOn: today, targetBooks: 1 }));
    const p = await inOak(() => desk.challengeProgress(c.id));
    expect(p.rows.map((r) => r.name)).not.toContain('Aman Gupta');
    expect(p.participants).toBe(3); // Rahul, Priya and Riya are on roll
  });

  it('suggests unread books with reasons', async () => {
    const read = await book({ title: 'Malgudi Days', category: 'Fiction', totalCopies: 2, availableCopies: 2 });
    await book({ title: 'Swami and Friends', category: 'Fiction', totalCopies: 2, availableCopies: 2 });
    const l = await issue(read._id, s.rahul.student);
    await inOak(() => library.returnBook(l.id));
    const out = await inOak(() => desk.suggestFor(String(s.rahul.student._id)));
    expect(out.suggestions.map((x) => x.title)).toEqual(['Swami and Friends']);
    expect(out.suggestions[0].reasons.join(' ')).toMatch(/Fiction/);
  });
});

describe('hostel life', () => {
  async function residents() {
    return inOak(async () => {
      const room = await HostelRoom.create({ roomNo: '101', block: 'A', capacity: 4, type: 'BOYS' });
      for (const st of [s.rahul, s.aman]) await HostelAllocation.create({ roomId: room._id, studentId: st.student._id });
      await OutPass.create({ refNo: 'OUT/2026/0001', studentId: s.aman.student._id, status: 'OUT', fromAt: new Date(Date.now() - DAY), toAt: new Date(Date.now() + DAY), reason: 'Family function', destination: 'Home', requestedByRole: 'PARENT', requestedByProfileId: s.people.PARENT.profile._id });
    });
  }

  it('roll call pre-marks out-pass residents; an unaccounted resident opens a critical task', async () => {
    await residents();
    const r = await inOak(() => life.startRollCall(W(), {}));
    expect(r.counts).toMatchObject({ ON_LEAVE: 1, UNMARKED: 1 });
    expect(r.entries.find((e) => e.name === 'Aman Gupta').outPassRef).toBe('OUT/2026/0001');
    const again = await inOak(() => life.startRollCall(W(), {}));
    expect(again.id).toBe(r.id);
    const done = await inOak(() => life.submitRollCall(W(), r.id));
    expect(done.unaccounted).toBe(1);
    const task = await inOak(() => DueItem.findOne({ sourceKey: `hostel-roll:${r.id}` }).lean());
    expect(task).toMatchObject({ severity: 'CRITICAL', department: 'HOSTEL' });
    // After submitting, only a missing resident can be marked as arrived late; that closes the task.
    await expect(inOak(() => life.markRollCall(W(), r.id, { entries: [{ studentId: String(s.aman.student._id), status: 'PRESENT' }] }))).rejects.toMatchObject({ code: 'ROLL_SUBMITTED' });
    const late = await inOak(() => life.markRollCall(W(), r.id, { entries: [{ studentId: String(s.rahul.student._id), status: 'LATE', note: 'Back from the library at 21:40' }] }));
    expect(late.unaccounted).toBe(0);
    expect((await inOak(() => DueItem.findOne({ sourceKey: `hostel-roll:${r.id}` }).lean())).status).toBe('DONE');
  });

  it('mess headcount leaves out residents away; the menu saves per week', async () => {
    await residents();
    const hc = await inOak(() => life.headcount({}));
    expect(hc).toMatchObject({ residents: 2, away: 1, meals: 1 });
    const m = await inOak(() => life.saveMenu(W(), { week: '2026-10-14', days: [{ day: 0, breakfast: 'Poha', dinner: 'Dal, rice, roti' }] }));
    expect(m.weekStart).toBe('2026-10-12');
    expect(m.days[0]).toMatchObject({ breakfast: 'Poha', date: '2026-10-12' });
  });

  it('records an incident with a parent-contact log and resolves it', async () => {
    const i = await inOak(() => life.createIncident(W(), { studentIds: [String(s.rahul.student._id)], category: 'LATE_RETURN', severity: 'HIGH', description: 'Returned at 22:15 after lights out.' }));
    expect(i.refNo).toMatch(/^HIN\//);
    const c = await inOak(() => life.logParentContact(W(), i.id, { guardianName: 'Mr Sharma', channel: 'CALL', summary: 'Father informed; agreed on 21:00 return.' }));
    expect(c.parentContacts).toHaveLength(1);
    await expect(inOak(() => life.resolveIncident(W(), i.id, {}))).rejects.toMatchObject({ code: 'RESOLUTION_REQUIRED' });
    const r = await inOak(() => life.resolveIncident(W(), i.id, { resolution: 'Spoke with the student; no repeat in a week.' }));
    expect(r.status).toBe('RESOLVED');
  });
});

describe('data protection and committees', () => {
  const C = () => s.people.COMPLIANCE.actor;

  it('a data request gets a response date and a task, and cannot be completed before identity is verified', async () => {
    const r = await inOak(() => privacy.createRequest(C(), { kind: 'CORRECTION', requesterName: 'Mr Sharma', studentId: String(s.rahul.student._id), details: 'Date of birth is wrong' }));
    expect(r.requesterRelation).toBe('PARENT');
    expect(Math.round((new Date(r.dueAt) - new Date(r.receivedAt)) / DAY)).toBe(privacy.RESPONSE_DAYS);
    expect(await inOak(() => DueItem.exists({ sourceKey: `privacy-request:${r.id}` }))).toBeTruthy();
    await expect(inOak(() => privacy.updateRequest(C(), r.id, { status: 'COMPLETED', outcome: 'Corrected' }))).rejects.toMatchObject({ code: 'IDENTITY_NOT_VERIFIED' });
    await expect(inOak(() => privacy.updateRequest(C(), r.id, { status: 'COMPLETED', identityVerified: true }))).rejects.toMatchObject({ code: 'OUTCOME_REQUIRED' });
    const done = await inOak(() => privacy.updateRequest(C(), r.id, { status: 'COMPLETED', identityVerified: true, outcome: 'DOB corrected from the birth certificate' }));
    expect(done.status).toBe('COMPLETED');
    expect((await inOak(() => DueItem.findOne({ sourceKey: `privacy-request:${r.id}` }).lean())).status).toBe('DONE');
  });

  it('a breach has the 72-hour clock and closes only after the Board report is recorded', async () => {
    const b = await inOak(() => privacy.createBreach(C(), { title: 'Marks sheet emailed to the wrong parent group', discoveredAt: new Date(Date.now() - 80 * 3600_000).toISOString(), affectedCount: 42, childrenAffected: true }));
    expect(b.reportOverdue).toBe(true);
    await expect(inOak(() => privacy.updateBreach(C(), b.id, { status: 'CLOSED' }))).rejects.toMatchObject({ code: 'REPORT_NOT_RECORDED' });
    const u = await inOak(() => privacy.updateBreach(C(), b.id, { boardReportAt: new Date().toISOString(), status: 'CLOSED' }));
    expect(u.status).toBe('CLOSED');
  });

  it('the readiness checklist names what is missing and what is on file', async () => {
    await inOak(() => Licence.create({ kind: 'CERTIFICATE', title: 'Fire safety NOC', expiresOn: new Date(Date.now() + 200 * DAY) }));
    await inOak(() => privacy.saveCommittee(C(), { kind: 'POCSO', members: [{ name: 'Ms Rao', role: 'Chair' }], constitutedOn: '2026-06-01', displayedOnWebsite: true }));
    const r = await inOak(() => privacy.readiness());
    const by = (item) => r.items.find((i) => i.item === item);
    expect(by('Fire safety certificate').state).toBe('OK');
    expect(by('Building safety certificate').state).toBe('MISSING');
    expect(by('POCSO / child protection committee').state).toBe('OK');
    expect(by('Internal Committee (POSH)').state).toBe('MISSING');
  });

  it('is tenant-scoped', async () => {
    await inOak(() => privacy.createRequest(C(), { kind: 'ACCESS', requesterName: 'A parent' }));
    expect(await inSchool(RIVER, () => PrivacyRequest.countDocuments({}))).toBe(0);
  });
});

describe('admissions follow-ups', () => {
  const M = () => s.people.MARKETING.actor;
  async function leads() {
    return inOak(async () => ({
      overdue: await Lead.create({ childName: 'Kabir', guardianName: 'Mr Mehta', phone: '+919800000001', stage: 'CONTACTED', nextActionAt: new Date(Date.now() - 3 * DAY), firstResponseAt: new Date(Date.now() - 5 * DAY) }),
      fresh: await Lead.create({ childName: 'Anaya', guardianName: 'Ms Iyer', phone: '+919800000002', stage: 'NEW', createdAt: new Date(Date.now() - 2 * DAY) }),
      optedOut: await Lead.create({ childName: 'Vihaan', guardianName: 'Mr Rao', phone: '+919800000003', stage: 'CONTACTED', contactConsent: { given: true, withdrawnAt: new Date() }, nextActionAt: new Date(Date.now() - DAY), firstResponseAt: new Date() }),
    }));
  }

  it('buckets the queue, with an explained score on each enquiry', async () => {
    const l = await leads();
    const q = await inOak(() => followups.queue(M(), {}));
    expect(q.overdue.map((x) => x.childName).sort()).toEqual(['Kabir', 'Vihaan']);
    expect(q.untouched.map((x) => x.childName)).toEqual(['Anaya']);
    const v = q.overdue.find((x) => x.childName === 'Vihaan');
    expect(v.doNotContact).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/do not contact/);
    const sc = await inOak(() => followups.leadScore(String(l.overdue._id)));
    expect(sc.score).toBeGreaterThanOrEqual(0);
    expect(sc.reasons.length).toBeGreaterThan(0);
  });

  it('logs a follow-up with the next action, moves NEW to CONTACTED, and refuses to contact a family that opted out', async () => {
    const l = await leads();
    const next = new Date(Date.now() + 2 * DAY).toISOString();
    const out = await inOak(() => followups.logFollowUp(M(), String(l.fresh._id), { channel: 'CALL', outcome: 'Spoke to mother; wants a campus tour on Saturday.', nextActionAt: next }));
    expect(out.lead.stage).toBe('CONTACTED');
    const saved = await inOak(() => Lead.findById(l.fresh._id).lean());
    expect(saved.firstResponseAt).toBeTruthy();
    expect(await inOak(() => LeadInteraction.countDocuments({ leadId: l.fresh._id, type: 'CALL' }))).toBe(1);
    await expect(inOak(() => followups.logFollowUp(M(), String(l.optedOut._id), { channel: 'WHATSAPP', outcome: 'Sent brochure' }))).rejects.toMatchObject({ code: 'CONTACT_CONSENT_WITHDRAWN' });
    await expect(inOak(() => followups.logFollowUp(M(), String(l.overdue._id), { channel: 'CALL', outcome: 'Chose another school', stage: 'LOST' }))).rejects.toMatchObject({ code: 'LOST_REASON_REQUIRED' });
    const stats = await inOak(() => followups.counsellorStats({}));
    expect(stats.reduce((a, r) => a + r.leads, 0)).toBe(3);
  });
});
