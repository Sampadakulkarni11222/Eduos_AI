import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, todayKey, OAK, RIVER } from './support/mcpSchool.js';
import { School } from '../src/models/school.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { Notification } from '../src/models/notification.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { Student } from '../src/models/student.model.js';
import { HealthVisit, HealthStock } from '../src/models/health.model.js';
import { PurchaseRequest } from '../src/models/finance.model.js';
import { AutomationDraft, PersonalAutomation } from '../src/models/automation.model.js';
import * as messaging from '../src/modules/messaging/messaging.service.js';
import * as jobs from '../src/modules/automations/automations.jobs.js';
import * as service from '../src/modules/automations/automations.service.js';
import * as personal from '../src/modules/automations/personal.js';
import { inQuietWindow } from '../src/modules/automations/automations.runtime.js';
import { JOBS } from '../src/jobs/scheduler.js';

/**
 * Part 7 school automations: each runs once per school per day (or week) at
 * its hour, never in the quiet window or (where it says so) on a non-school
 * day; messages go through the outbox (consent decides WhatsApp; SIMULATED
 * without a provider; the in-app copy always goes); records are drafts or
 * tasks; and nothing crosses schools.
 */

// Monday 19 Oct 2026 in India (UTC+5:30).
const IST = (ymd, hh, mm = 0) => new Date(Date.UTC(...ymd.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), hh, mm) - 330 * 60_000);
const MONDAY = '2026-10-19';
const oak = (fn) => inSchool(OAK, fn);
let school;

beforeEach(async () => {
  school = await seedSchool();
  await School.create([{ slug: OAK, name: 'Oakridge Academy' }, { slug: RIVER, name: 'Riverside School' }]);
});

const outbox = (filter) => oak(() => MessageOutbox.find(filter).lean());

describe('register not marked: nudge, escalation, timing and consent', () => {
  it('reminds the class teacher once, after the hour, on a school day, outside quiet hours', async () => {
    const teacher = school.people.TEACHER.actor.profileId;
    expect((await oak(() => jobs.runRegisterNudge(IST(MONDAY, 9, 0)))).skipped).toBe('not yet time');
    expect((await oak(() => jobs.runRegisterNudge(IST('2026-10-18', 11, 0)))).skipped).toBe('not a school day');
    expect((await oak(() => jobs.runRegisterNudge(IST(MONDAY, 22, 0)))).skipped).toBe('quiet hours');

    const out = await oak(() => jobs.runRegisterNudge(IST(MONDAY, 10, 30)));
    expect(out.ran).toBe(true);
    expect(out.unmarked).toBe(2); // 6 A and 6 B have no marks on Monday
    expect(out.nudged).toBe(1); // only 6 A has a class teacher
    const rows = await outbox({ templateKey: 'REGISTER_NOT_MARKED', recipientProfileId: teacher });
    expect(rows).toHaveLength(1);
    // Not opted in to WhatsApp: recorded as skipped for consent, but the in-app copy went.
    expect(rows[0].status).toBe('SKIPPED_NO_CONSENT');
    expect(rows[0].preview).toContain('Class 6 A');
    expect(await oak(() => Notification.countDocuments({ recipientProfileId: teacher, title: /Class 6 A/ }))).toBe(1);

    // Again the same day: claimed, nothing new.
    expect((await oak(() => jobs.runRegisterNudge(IST(MONDAY, 11, 0)))).skipped).toBe('already ran');
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'REGISTER_NOT_MARKED', recipientProfileId: teacher }))).toBe(1);

    // Two hours after the nudge hour the principal gets one list, in the app.
    const later = await oak(() => jobs.runRegisterNudge(IST(MONDAY, 12, 15)));
    expect(later.escalation.ran).toBe(true);
    const p = await outbox({ templateKey: 'REGISTER_NOT_MARKED', recipientProfileId: school.people.PRINCIPAL.actor.profileId });
    expect(p).toHaveLength(0); // in-app only (no channel rows)...
    expect(await oak(() => Notification.countDocuments({ recipientProfileId: school.people.PRINCIPAL.actor.profileId, title: /Class 6 A, Class 6 B/ }))).toBe(1);
  });

  it('a teacher who opted in to WhatsApp gets it SIMULATED (no provider in tests), and a switched-off school gets nothing', async () => {
    await oak(() => messaging.updatePreferences(school.people.TEACHER.actor, { whatsappOptIn: true }));
    await oak(() => jobs.runRegisterNudge(IST(MONDAY, 10, 30)));
    const [row] = await outbox({ templateKey: 'REGISTER_NOT_MARKED' });
    expect(row.status).toBe('SIMULATED');

    await oak(() => service.updateAutomation(school.people.ADMIN.actor, 'attendanceRegisterNudge', { enabled: false }));
    expect((await oak(() => jobs.runRegisterNudge(IST('2026-10-20', 10, 30)))).skipped).toBe('switched off');
  });

  it('runs inside one school only', async () => {
    await inSchool(RIVER, () => jobs.runRegisterNudge(IST(MONDAY, 10, 30)));
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'REGISTER_NOT_MARKED' }))).toBe(0);
  });

  it('the quiet window is 21:00 to 07:00 school time', () => {
    expect(inQuietWindow(IST(MONDAY, 21, 0))).toBe(true);
    expect(inQuietWindow(IST(MONDAY, 6, 59))).toBe(true);
    expect(inQuietWindow(IST(MONDAY, 7, 0))).toBe(false);
  });
});

describe('homework due tomorrow', () => {
  it('reminds each student who has not submitted, once; not those who did, and not parents by default', async () => {
    await oak(async () => {
      const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
      const subject = await Subject.create({ name: 'Mathematics' });
      const off = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
      const a = await Assignment.create({ subjectOfferingId: off._id, title: 'Fractions worksheet', dueAt: IST('2026-10-20', 9, 0) });
      const b = await Assignment.create({ subjectOfferingId: off._id, title: 'Already handed in', dueAt: IST('2026-10-20', 9, 0) });
      await Submission.create({ assignmentId: b._id, enrollmentId: school.priya.enrollment._id, status: 'SUBMITTED' });
      return a;
    });
    const out = await oak(() => jobs.runHomeworkDue(IST(MONDAY, 17, 30)));
    expect(out.ran).toBe(true);
    const rows = await outbox({ templateKey: 'HOMEWORK_DUE' });
    // Priya (the only student with a login) for the worksheet she has not handed in; nobody for the other.
    expect(rows.map((r) => String(r.recipientProfileId))).toEqual([school.people.STUDENT.actor.profileId]);
    expect(rows[0].preview).toContain('Fractions worksheet');
    expect(rows.some((r) => String(r.recipientProfileId) === school.people.PARENT.actor.profileId)).toBe(false);
    await oak(() => jobs.runHomeworkDue(IST(MONDAY, 17, 30), { force: true }));
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'HOMEWORK_DUE' }))).toBe(1);
  });
});

describe('fee reminders with escalation', () => {
  it('is off until the school switches it on; then each stage goes once, and 15 days overdue raises a finance task', async () => {
    const now = new Date();
    now.setUTCHours(5, 0, 0, 0); // 10:30 in India, today
    expect((await oak(() => jobs.runFeeReminders(now))).skipped).toBe('switched off');

    await oak(() => service.updateAutomation(school.people.ADMIN.actor, 'feeReminders', { enabled: true }));
    const out = await oak(() => jobs.runFeeReminders(now));
    expect(out.ran).toBe(true);
    expect(out.escalated).toBe(1); // INV-1001 is 20 days overdue; INV-1002 is not due for 20 days
    const rows = await outbox({ templateKey: 'FEE_REMINDER' });
    expect(rows).toHaveLength(1);
    expect(String(rows[0].recipientProfileId)).toBe(school.people.PARENT.actor.profileId);
    expect(rows[0].idempotencyKey).toMatch(/:escalated$/);
    const task = await oak(() => DueItem.findOne({ 'source.entityType': 'Invoice' }).lean());
    expect(task.title).toContain('INV-1001');
    expect(String(task.ownerProfileId)).toBe(school.people.FINANCE.actor.profileId);

    await oak(() => jobs.runFeeReminders(now, { force: true }));
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'FEE_REMINDER' }))).toBe(1);
    expect(await oak(() => DueItem.countDocuments({ 'source.entityType': 'Invoice' }))).toBe(1);
  });

  it('stages: 3 days before, overdue, and 15 days overdue', () => {
    const today = new Date('2026-10-19T00:00:00Z');
    expect(jobs.feeStage(new Date('2026-10-22'), today)).toBe('due');
    expect(jobs.feeStage(new Date('2026-10-25'), today)).toBe(null);
    expect(jobs.feeStage(new Date('2026-10-18'), today)).toBe('overdue');
    expect(jobs.feeStage(new Date('2026-10-01'), today)).toBe('escalated');
  });

  it('only a settings manager can switch automations, and only to an hour outside quiet hours', async () => {
    await expect(oak(() => service.updateAutomation(school.people.TEACHER.actor, 'feeReminders', { enabled: true }))).rejects.toThrow(/manages school settings/);
    await expect(oak(() => service.updateAutomation(school.people.ADMIN.actor, 'feeReminders', { hour: 22 }))).rejects.toThrow(/quiet hours/);
  });
});

describe('briefing, digest and greetings', () => {
  it('sends the principal a morning briefing (email + app) once', async () => {
    const out = await oak(() => jobs.runDailyBriefing(IST(MONDAY, 7, 30)));
    expect(out.sent).toBe(1);
    const [row] = await outbox({ templateKey: 'DAILY_BRIEFING' });
    expect(row.channel).toBe('EMAIL');
    expect(String(row.recipientProfileId)).toBe(school.people.PRINCIPAL.actor.profileId);
  });

  it('weekly digest only to parents who opted in, one per child', async () => {
    const friday = IST('2026-10-23', 17, 30);
    expect((await oak(() => jobs.runWeeklyDigest(friday))).sent).toBe(0);
    await oak(() => service.setMyOptIn(school.people.PARENT.actor, 'weeklyParentDigest', true));
    expect((await oak(() => jobs.runWeeklyDigest(friday, { force: true }))).sent).toBe(1);
    const [row] = await outbox({ templateKey: 'WEEKLY_CHILD_DIGEST' });
    expect(row.preview).toMatch(/^This week for Rahul: .*a fee is due/);
    await expect(oak(() => service.setMyOptIn(school.people.TEACHER.actor, 'weeklyParentDigest', true))).rejects.toThrow(/parent/);
  });

  it('birthday greeting in the app only, and only with an opt-in', async () => {
    await oak(() => service.updateAutomation(school.people.ADMIN.actor, 'birthdayGreetings', { enabled: true }));
    await oak(() => Student.updateOne({ _id: school.priya.student._id }, { $set: { dob: new Date('2014-10-19') } }));
    expect((await oak(() => jobs.runBirthdays(IST(MONDAY, 8, 30)))).greeted).toBe(0);
    await oak(() => service.setMyOptIn(school.people.STUDENT.actor, 'birthdayGreetings', true));
    expect((await oak(() => jobs.runBirthdays(IST(MONDAY, 8, 30), { force: true }))).greeted).toBe(1);
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'BIRTHDAY_GREETING' }))).toBe(0); // no outside channel
    expect(await oak(() => Notification.countDocuments({ recipientProfileId: school.people.STUDENT.actor.profileId, title: /Happy birthday, Priya/ }))).toBe(1);
  });
});

describe('drafts and tasks a person confirms', () => {
  it('health visit sent home: one follow-up task for the nurse, with the reference only', async () => {
    const nurse = await seedPerson({ roleKey: 'NURSE', roleId: school.roleIds.NURSE });
    await oak(() => HealthVisit.create({ refNo: 'HV/2026/0001', studentId: school.rahul.student._id, arrivedAt: IST(MONDAY, 11, 0), outcome: 'SENT_HOME', complaintEnc: 'x' }));
    await oak(() => jobs.runHealthFollowups(IST(MONDAY, 16, 30)));
    await oak(() => jobs.runHealthFollowups(IST(MONDAY, 16, 45), { force: true }));
    const tasks = await oak(() => DueItem.find({ department: 'HEALTH' }).lean());
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Health visit follow-up (HV/2026/0001)');
    expect(tasks[0].title).not.toMatch(/Rahul/);
    expect(String(tasks[0].ownerProfileId)).toBe(nurse.actor.profileId);
  });

  it('low stock becomes a purchase draft; nothing is bought until a person confirms, and then only a DRAFT request', async () => {
    const nurse = await seedPerson({ roleKey: 'NURSE', roleId: school.roleIds.NURSE });
    await oak(() => HealthStock.create({ name: 'Paracetamol 500mg', quantity: 4, reorderLevel: 20, unit: 'strips' }));
    await oak(() => HealthStock.create({ name: 'Bandages', quantity: 50, reorderLevel: 10 }));
    const out = await oak(() => jobs.runLowStockDrafts(IST(MONDAY, 9, 30)));
    expect(out).toMatchObject({ low: 1, drafts: 1 });
    expect(await oak(() => PurchaseRequest.countDocuments())).toBe(0);
    const [draft] = await oak(() => service.listDrafts(nurse.actor));
    expect(draft.detail.items[0]).toMatchObject({ name: 'Paracetamol 500mg', suggestedQty: 36 });
    // Somebody it is not addressed to cannot act on it.
    await expect(oak(() => service.confirmDraft(school.people.TEACHER.actor, draft.id))).rejects.toThrow(/not found/i);
    const done = await oak(() => service.confirmDraft(nurse.actor, draft.id));
    expect(done.status).toBe('CONFIRMED');
    const pr = await oak(() => PurchaseRequest.findOne().lean());
    expect(pr.status).toBe('DRAFT');
    await expect(oak(() => service.confirmDraft(nurse.actor, draft.id))).rejects.toThrow(/already confirmed/);
    // Same week: not drafted again.
    await oak(() => jobs.runLowStockDrafts(IST(MONDAY, 10, 0), { force: true }));
    expect(await oak(() => AutomationDraft.countDocuments())).toBe(1);
  });
});

describe('personal reminders and reports', () => {
  it('sends a reminder at its time, once, and moves to the next week', async () => {
    const teacher = school.people.TEACHER.actor;
    const saved = await oak(() => personal.createMine(teacher, { kind: 'REMINDER', text: 'submit lesson plans', frequency: 'WEEKLY', weekdays: [5], hour: 16 }, { now: IST(MONDAY, 9, 0) }));
    expect(new Date(saved.nextRunAt).toISOString()).toBe(IST('2026-10-23', 16, 0).toISOString());
    expect((await oak(() => personal.runPersonalDue({ now: IST('2026-10-23', 15, 59) }))).sent).toBe(0);
    expect((await oak(() => personal.runPersonalDue({ now: IST('2026-10-23', 16, 5) }))).sent).toBe(1);
    expect((await oak(() => personal.runPersonalDue({ now: IST('2026-10-23', 16, 20) }))).sent).toBe(0);
    const row = await oak(() => PersonalAutomation.findById(saved.id).lean());
    expect(row.nextRunAt.toISOString()).toBe(IST('2026-10-30', 16, 0).toISOString());
    const [msg] = await outbox({ templateKey: 'PERSONAL_REMINDER' });
    expect(String(msg.recipientProfileId)).toBe(teacher.profileId);
    expect(msg.preview).toContain('submit lesson plans');
  });

  it('a report is built as its owner and stops if they may no longer see it', async () => {
    const now = new Date();
    now.setUTCHours(3, 0, 0, 0); // 08:30 in India today: the day Rahul is marked absent
    const teacher = school.people.TEACHER.actor;
    await oak(() => PersonalAutomation.create({ profileId: teacher.profileId, kind: 'REPORT', reportKey: 'ABSENT_STUDENTS', text: 'Absent students today', schedule: { frequency: 'DAILY', hour: 8 }, nextRunAt: new Date(now.getTime() - 60_000) }));
    await oak(() => personal.runPersonalDue({ now }));
    const [msg] = await outbox({ templateKey: 'PERSONAL_REPORT' });
    expect(msg.preview).toMatch(/1 student\(s\) absent in your classes today: Rahul Sharma/);

    // A teacher cannot set up the school-wide absent staff report.
    expect(() => personal.prepareCreate(teacher, { kind: 'REPORT', reportKey: 'ABSENT_STAFF', frequency: 'DAILY', hour: 8 })).toThrow(/not something your account can see/);
    // A report whose owner lost the permission stops instead of widening.
    await oak(() => PersonalAutomation.create({ profileId: teacher.profileId, kind: 'REPORT', reportKey: 'ABSENT_STAFF', text: 'Absent staff today', schedule: { frequency: 'DAILY', hour: 8 }, nextRunAt: new Date(now.getTime() - 60_000) }));
    const out = await oak(() => personal.runPersonalDue({ now: new Date(now.getTime() + 60_000) }));
    expect(out.stopped).toBe(1);
  });

  it('reads schedules from words', () => {
    const now = IST('2026-10-18', 11, 0);
    expect(personal.parsePersonalRequest('remind me every Friday to submit lesson plans', now)).toMatchObject({ kind: 'REMINDER', text: 'submit lesson plans', frequency: 'WEEKLY', weekdays: [5] });
    expect(personal.parsePersonalRequest('every morning send me the list of absent staff', now)).toMatchObject({ kind: 'REPORT', reportKey: 'ABSENT_STAFF', frequency: 'DAILY', hour: 8 });
    expect(personal.parsePersonalRequest('remind me tomorrow at 3pm to call the transport office', now)).toMatchObject({ frequency: 'ONCE', onDate: '2026-10-19', hour: 15, text: 'call the transport office' });
    expect(personal.parsePersonalRequest('send me the list of absent staff', now)).toBe(null);
    expect(personal.parsePersonalRequest('remind me to water the plants', now).ask).toMatch(/When should I remind you/);
  });
});

describe('scheduler wiring', () => {
  it('lists the two automation jobs', () => {
    expect(JOBS.map((j) => j.key)).toEqual(expect.arrayContaining(['automations.school', 'automations.personal']));
  });

  it('the settings list shows every automation with a preview and the built-in ones', async () => {
    const out = await oak(() => service.listAutomations(school.people.ADMIN.actor));
    expect(out.automations.length).toBeGreaterThanOrEqual(11);
    expect(out.automations.every((a) => a.preview && a.schedule)).toBe(true);
    expect(out.automations.find((a) => a.key === 'feeReminders').enabled).toBe(false);
    expect(out.builtIn.some((b) => b.key === 'absenteeAlerts')).toBe(true);
    expect(out.canManage).toBe(true);
    expect((await oak(() => service.listAutomations(school.people.TEACHER.actor))).canManage).toBe(false);
  });
});

void todayKey;
