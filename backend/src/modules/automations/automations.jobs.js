import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';
import { Invoice } from '../../models/fee.model.js';
import { HealthVisit, HealthStock } from '../../models/health.model.js';
import { AutomationDraft, AutomationOptIn } from '../../models/automation.model.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { upsertFromSource } from '../tasks/tasks.service.js';
import { profilesWithRoles } from '../ops/common.js';
import { getGuardianStudentIds } from '../../utils/scope.js';
import { localMidnight } from '../../utils/periods.js';
import { sendOverdueReminders } from '../library/library.desk.js';
import * as insights from '../insights/insights.service.js';
import * as cover from '../staff/cover.service.js';
import * as followups from '../marketing/followups.service.js';
import { logger } from '../../utils/logger.js';
import { School } from '../../models/school.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { runOnce, actorFromProfile, addDays, DAY_MS } from './automations.runtime.js';

/**
 * The school automations (catalogue: automations.catalogue.js). Each runner
 * is idempotent twice over: runOnce() claims the day (or week) for the school,
 * and every message, task and draft carries its own key, so a retried run
 * never repeats what already went out.
 *
 * Runners read and write only inside the current school (the scheduler runs
 * them in the school's tenant context) and never decide anything: messages
 * go through the outbox (consent, quiet hours, SIMULATED without a provider),
 * and anything that would write in a module on someone's behalf is a draft.
 */

const SYSTEM = { system: true, profileId: null, displayName: 'Automation', roleKey: 'SYSTEM', permissions: {} };
const ATTENDED = ['PRESENT', 'LATE', 'EXCUSED', 'HALF_DAY'];
const MARKS = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const display = (d) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const classLabel = (s) => `${s?.gradeId?.name ?? ''} ${s?.name ?? ''}`.trim();
const ids = (rows) => rows.map((r) => String(r._id));
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

async function profilesFor(roles) {
  return roles?.length ? profilesWithRoles(roles) : [];
}

/** Sections with pupils and no day-level mark at all on a register day. */
export async function unmarkedSections(day) {
  const sections = await Section.find({}).select('_id name gradeId classTeacherId').populate('gradeId', 'name').lean();
  const enrolments = await Enrollment.find({ status: 'ACTIVE', sectionId: { $in: sections.map((s) => s._id) } }).select('_id sectionId').lean();
  const pupils = new Map();
  for (const e of enrolments) pupils.set(String(e.sectionId), (pupils.get(String(e.sectionId)) ?? 0) + 1);
  const marked = await AttendanceRecord.distinct('enrollmentId', { date: { $gte: day, $lt: addDays(day, 1) }, periodNo: null, status: { $in: MARKS }, enrollmentId: { $in: enrolments.map((e) => e._id) } });
  const sectionOf = new Map(enrolments.map((e) => [String(e._id), String(e.sectionId)]));
  const markedSections = new Set(marked.map((id) => sectionOf.get(String(id))));
  return sections
    .filter((s) => pupils.get(String(s._id)) && !markedSections.has(String(s._id)))
    .map((s) => ({ sectionId: String(s._id), class: classLabel(s), classTeacherId: s.classTeacherId ? String(s.classTeacherId) : null, students: pupils.get(String(s._id)) }));
}

/* 1. Register not marked by the set hour: the class teacher; two hours on, the principal. */
export async function runRegisterNudge(now = new Date(), opts = {}) {
  const first = await runOnce('attendanceRegisterNudge', now, async ({ setting, clock }) => {
    if (!setting.audience.includes('TEACHER')) return { nudged: 0, note: 'teachers are not in the audience' };
    const open = await unmarkedSections(clock.day);
    const byTeacher = new Map();
    for (const s of open) if (s.classTeacherId) byTeacher.set(s.classTeacherId, [...(byTeacher.get(s.classTeacherId) ?? []), s.class]);
    for (const [teacher, classes] of byTeacher) {
      // eslint-disable-next-line no-await-in-loop -- one outbox call per teacher keeps each key separate
      await sendOperational({
        templateKey: 'REGISTER_NOT_MARKED', recipientProfileIds: [teacher], variables: { classes: classes.join(', '), time: hhmm(setting.hour) },
        link: '/attendance', idempotencyKey: `automation:register:${teacher}:${clock.ymd}`, relatedEntityType: 'Automation', relatedEntityId: null, now,
      });
    }
    return { unmarked: open.length, nudged: byTeacher.size, withoutClassTeacher: open.filter((s) => !s.classTeacherId).length };
  }, opts);
  const second = await runOnce('attendanceRegisterNudge', now, async ({ setting, clock }) => {
    if (!setting.audience.includes('PRINCIPAL')) return { escalated: 0 };
    const open = await unmarkedSections(clock.day);
    if (!open.length) return { escalated: 0, unmarked: 0 };
    const principals = ids(await profilesFor(['PRINCIPAL']));
    await sendOperational({
      templateKey: 'REGISTER_NOT_MARKED', recipientProfileIds: principals, channels: [],
      variables: { classes: open.map((s) => s.class).join(', '), time: hhmm(setting.hour + 2) },
      link: '/attendance', idempotencyKey: `automation:register:principal:${clock.ymd}`, now,
    });
    return { escalated: principals.length, unmarked: open.length };
  }, { ...opts, phase: 'escalate', hourOffset: opts.force ? 0 : 2 });
  return { ...first, escalation: second };
}

/* 2. Homework due tomorrow and not submitted: the student (and parents, if the school adds them). */
export async function runHomeworkDue(now = new Date(), opts = {}) {
  return runOnce('homeworkDueReminders', now, async ({ setting, clock }) => {
    const [y, m, d] = clock.ymd.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
    const from = localMidnight(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
    const to = new Date(from.getTime() + DAY_MS);
    const assignments = await Assignment.find({ dueAt: { $gte: from, $lt: to }, deletedAt: null }).select('_id title subjectOfferingId').limit(500).lean();
    let reminded = 0;
    for (const a of assignments) {
      /* eslint-disable no-await-in-loop -- per assignment: its class, its submissions */
      const offering = await SubjectOffering.findById(a.subjectOfferingId).select('sectionId subjectId').populate('subjectId', 'name').lean();
      if (!offering) continue;
      const enrolments = await Enrollment.find({ sectionId: offering.sectionId, status: 'ACTIVE' }).select('_id studentId').lean();
      const done = new Set((await Submission.find({ assignmentId: a._id, status: { $in: ['SUBMITTED', 'LATE', 'GRADED', 'EXEMPT'] } }).select('enrollmentId').lean()).map((s) => String(s.enrollmentId)));
      const pending = enrolments.filter((e) => !done.has(String(e._id)));
      const students = await Student.find({ _id: { $in: pending.map((e) => e.studentId) }, deletedAt: null }).select('_id profileId firstName').lean();
      const links = setting.audience.includes('PARENT') ? await StudentGuardian.find({ studentId: { $in: students.map((s) => s._id) } }).select('studentId guardianProfileId').lean() : [];
      for (const s of students) {
        const to = [
          ...(setting.audience.includes('STUDENT') && s.profileId ? [String(s.profileId)] : []),
          ...links.filter((l) => String(l.studentId) === String(s._id)).map((l) => String(l.guardianProfileId)),
        ];
        if (!to.length) continue;
        await sendOperational({
          templateKey: 'HOMEWORK_DUE', recipientProfileIds: to,
          variables: { title: a.title, subject: offering.subjectId?.name ?? 'homework', when: 'tomorrow', ...(setting.audience.includes('PARENT') && { studentName: s.firstName }) },
          link: '/assignments', idempotencyKey: `automation:homework:${a._id}:${s._id}`, relatedEntityType: 'Assignment', relatedEntityId: a._id, now,
        });
        reminded += 1;
      }
      /* eslint-enable no-await-in-loop */
    }
    return { assignments: assignments.length, reminded };
  }, opts);
}

/** Which reminder stage an unpaid invoice is at today, or null. */
export function feeStage(dueOn, today) {
  const days = Math.round((new Date(dueOn).setUTCHours(0, 0, 0, 0) - today.getTime()) / DAY_MS);
  if (days >= 0 && days <= 3) return 'due';
  if (days <= -15) return 'escalated';
  if (days <= -1) return 'overdue';
  return null;
}

/* 3. Fee due soon, overdue and escalated: families, and a finance task at 15 days. */
export async function runFeeReminders(now = new Date(), opts = {}) {
  return runOnce('feeReminders', now, async ({ setting, clock }) => {
    const invoices = await Invoice.find({
      status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, voidedAt: null, dueOn: { $lte: addDays(clock.day, 4) },
    }).select('_id invoiceNo enrollmentId totalPaise paidPaise dueOn').limit(3000).lean();
    const unpaid = invoices.filter((i) => (i.totalPaise ?? 0) > (i.paidPaise ?? 0));
    const enrolments = await Enrollment.find({ _id: { $in: unpaid.map((i) => i.enrollmentId) } }).select('_id studentId').lean();
    const studentOf = new Map(enrolments.map((e) => [String(e._id), String(e.studentId)]));
    const links = await StudentGuardian.find({ studentId: { $in: [...new Set(studentOf.values())] } }).select('studentId guardianProfileId').lean();
    const finance = setting.audience.includes('FINANCE') ? ids(await profilesFor(['FINANCE'])) : [];
    const counts = { due: 0, overdue: 0, escalated: 0, tasks: 0 };
    for (const inv of unpaid) {
      const stage = feeStage(inv.dueOn, clock.day);
      if (!stage) continue;
      const sid = studentOf.get(String(inv.enrollmentId));
      const guardians = links.filter((l) => String(l.studentId) === sid).map((l) => String(l.guardianProfileId));
      /* eslint-disable no-await-in-loop -- one key per invoice and stage */
      if (setting.audience.includes('PARENT') && guardians.length) {
        await sendOperational({
          templateKey: 'FEE_REMINDER', recipientProfileIds: guardians, variables: { dueOn: display(new Date(inv.dueOn)) },
          link: '/payments', idempotencyKey: `automation:fee:${inv._id}:${stage}`, relatedEntityType: 'Invoice', relatedEntityId: inv._id, now,
        });
        counts[stage] += 1;
      }
      if (stage === 'escalated' && finance.length) {
        await upsertFromSource({
          sourceKey: `automation:fee:${inv._id}:followup`, title: `Fee follow-up: invoice ${inv.invoiceNo} is 15+ days overdue`,
          department: 'FINANCE', category: 'OTHER', dueAt: addDays(now, 2), ownerProfileId: finance[0], severity: 'HIGH',
          source: { entityType: 'Invoice', entityId: inv._id, link: '/fees' }, description: 'Raised by the fee reminders automation. Call the family or agree a plan; close the task when done.',
        });
        counts.tasks += 1;
      }
      /* eslint-enable no-await-in-loop */
    }
    return { checked: unpaid.length, ...counts };
  }, opts);
}

/* 4. Library overdue: the librarian's own reminder routine, once a day. */
export async function runLibraryOverdue(now = new Date(), opts = {}) {
  return runOnce('libraryOverdueDaily', now, async () => {
    const out = await sendOverdueReminders(SYSTEM, { now });
    return { reminded: out.reminded ?? 0, alreadyToday: out.alreadyToday ?? 0 };
  }, opts);
}

/** "3 decisions waiting, 5 tasks (1 overdue), 2 deadlines" from a home briefing. */
export function briefingSummary(home) {
  const parts = [];
  const decisions = (home.decisions ?? []).length;
  const tasks = home.tasks ?? [];
  const overdue = tasks.filter((t) => t.overdue).length;
  const deadlines = (home.deadlines ?? []).length;
  if (decisions) parts.push(`${decisions} decision(s) waiting`);
  if (tasks.length) parts.push(`${tasks.length} task(s)${overdue ? ` (${overdue} overdue)` : ''}`);
  if (deadlines) parts.push(`${deadlines} deadline(s) coming up`);
  return parts.length ? parts.join(', ') : 'nothing is waiting on you';
}

/* 5. Daily briefing, read as each recipient (they see exactly their own Today page). */
export async function runDailyBriefing(now = new Date(), opts = {}) {
  return runOnce('principalDailyBriefing', now, async ({ setting, clock }) => {
    const people = await profilesFor(setting.audience);
    let sent = 0;
    for (const p of people) {
      /* eslint-disable no-await-in-loop */
      const actor = await actorFromProfile(p._id);
      if (!actor) continue;
      const home = await insights.home(actor).catch((err) => { logger.warn(`Briefing for ${p._id} unavailable: ${err.message}`); return null; });
      if (!home) continue;
      await sendOperational({
        templateKey: 'DAILY_BRIEFING', recipientProfileIds: [String(p._id)], channels: ['EMAIL'],
        variables: { date: display(clock.day), summary: briefingSummary(home) },
        link: '/today', idempotencyKey: `automation:briefing:${p._id}:${clock.ymd}`, now,
      });
      sent += 1;
      /* eslint-enable no-await-in-loop */
    }
    return { sent };
  }, opts);
}

async function saveDraft({ automationKey, sourceKey, title, detail, link, owners, now }) {
  try {
    const draft = await AutomationDraft.create({ automationKey, sourceKey, title, detail, link, ownerProfileIds: owners });
    await sendOperational({
      templateKey: 'AUTOMATION_DRAFT_READY', recipientProfileIds: owners, channels: [], variables: { title },
      link: '/automations', idempotencyKey: `automation:draft:${sourceKey}`, relatedEntityType: 'AutomationDraft', relatedEntityId: draft._id, now,
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // already drafted
    throw err;
  }
}

/* 6. Teachers absent today: a cover draft per teacher with the best free substitute per period. */
export async function runCoverSuggestions(now = new Date(), opts = {}) {
  return runOnce('staffCoverSuggestions', now, async ({ setting, clock }) => {
    const coordinators = (await profilesFor(setting.audience)).filter((p) => p);
    const actors = (await Promise.all(coordinators.map((p) => actorFromProfile(p._id)))).filter((a) => a?.permissions?.['cover.manage'] === 'ALL');
    if (!actors.length) return { drafts: 0, note: 'nobody in the audience arranges cover' };
    const actor = actors[0];
    const needs = await cover.needs(actor, 'ALL', { date: clock.ymd });
    let drafts = 0;
    for (const person of needs.absent ?? []) {
      const open = (person.periods ?? []).filter((p) => !p.cover).slice(0, 10);
      if (!open.length) continue;
      const periods = [];
      for (const p of open) {
        // eslint-disable-next-line no-await-in-loop
        const c = await cover.candidates(actor, 'ALL', { date: clock.ymd, sectionId: p.sectionId, periodNo: p.periodNo }).catch(() => null);
        const best = c?.candidates?.find((x) => x.eligible) ?? null;
        periods.push({ sectionId: p.sectionId, class: p.className, periodNo: p.periodNo, startTime: p.startTime, subject: p.subject ?? null, suggested: best ? { profileId: best.profileId, name: best.name, sameSubject: best.sameSubject } : null });
      }
      // eslint-disable-next-line no-await-in-loop
      const made = await saveDraft({
        automationKey: 'staffCoverSuggestions', sourceKey: `cover:${clock.ymd}:${person.profileId}`,
        title: `Cover for ${person.name ?? 'an absent teacher'} (${periods.length} period(s)) on ${clock.ymd}`,
        detail: { kind: 'COVER', date: clock.ymd, teacher: person.name ?? null, teacherProfileId: person.profileId, periods },
        link: '/cover', owners: actors.map((a) => a.profileId), now,
      });
      if (made) drafts += 1;
    }
    return { absentTeachers: (needs.absent ?? []).length, drafts };
  }, opts);
}

/** ISO-ish week key for weekly drafts. */
const weekKey = (day) => {
  const monday = addDays(day, -((day.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};

/* 7. Low stock: a purchase-request draft for the people who buy it. */
export async function runLowStockDrafts(now = new Date(), opts = {}) {
  return runOnce('lowStockPurchaseDrafts', now, async ({ setting, clock }) => {
    const stock = await HealthStock.find({ active: { $ne: false }, reorderLevel: { $gt: 0 } }).select('name quantity reorderLevel unit').lean();
    const low = stock.filter((s) => (s.quantity ?? 0) <= s.reorderLevel);
    if (!low.length) return { low: 0, drafts: 0 };
    const owners = ids(await profilesFor(setting.audience));
    if (!owners.length) return { low: low.length, drafts: 0, note: 'nobody in the audience' };
    const items = low.map((s) => ({ stockId: String(s._id), name: s.name, quantity: s.quantity ?? 0, reorderLevel: s.reorderLevel, unit: s.unit ?? 'units', suggestedQty: Math.max(s.reorderLevel * 2 - (s.quantity ?? 0), s.reorderLevel) }));
    const made = await saveDraft({
      automationKey: 'lowStockPurchaseDrafts', sourceKey: `low-stock:health:${weekKey(clock.day)}`,
      title: `Purchase request: ${items.length} health-room item(s) at reorder level`,
      detail: { kind: 'PURCHASE', department: 'Health room', items }, link: '/procurement', owners, now,
    });
    return { low: low.length, drafts: made ? 1 : 0 };
  }, opts);
}

/* 8. Admissions follow-ups due: each counsellor, their own queue. */
export async function runFollowupReminder(now = new Date(), opts = {}) {
  return runOnce('admissionsFollowupReminder', now, async ({ setting, clock }) => {
    const people = await profilesFor(setting.audience);
    let sent = 0;
    for (const p of people) {
      /* eslint-disable no-await-in-loop */
      const actor = await actorFromProfile(p._id);
      if (!actor?.permissions?.['admissions.read']) continue;
      const q = await followups.queue(actor, { mine: true, now }).catch(() => null);
      const c = q?.counts ?? {};
      const total = (c.overdue ?? 0) + (c.today ?? 0) + (c.untouched ?? 0);
      if (!total) continue;
      await sendOperational({
        templateKey: 'FOLLOWUPS_DUE', recipientProfileIds: [String(p._id)], channels: [],
        variables: { summary: `${c.overdue ?? 0} overdue, ${c.today ?? 0} due today, ${c.untouched ?? 0} never contacted` },
        link: '/followups', idempotencyKey: `automation:followups:${p._id}:${clock.ymd}`, now,
      });
      sent += 1;
      /* eslint-enable no-await-in-loop */
    }
    return { sent };
  }, opts);
}

/* 9. Sent home or referred from the health room: a follow-up task for the nurse. */
export async function runHealthFollowups(now = new Date(), opts = {}) {
  return runOnce('healthVisitFollowups', now, async ({ clock }) => {
    const visits = await HealthVisit.find({ outcome: { $in: ['SENT_HOME', 'REFERRED'] }, arrivedAt: { $gte: addDays(now, -2), $lte: now } }).select('_id refNo outcome').lean();
    if (!visits.length) return { tasks: 0 };
    const nurses = ids(await profilesFor(['NURSE']));
    const tomorrow = addDays(clock.day, 1);
    const dueAt = localMidnight(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
    for (const v of visits) {
      // eslint-disable-next-line no-await-in-loop
      await upsertFromSource({
        sourceKey: `health:visit:${v._id}:followup`, title: `Health visit follow-up (${v.refNo})`,
        department: 'HEALTH', category: 'OTHER', dueAt: new Date(dueAt.getTime() + 10 * 3600_000), ownerProfileId: nurses[0] ?? null,
        source: { entityType: 'HealthVisit', entityId: v._id, link: '/health' },
        description: `The child was ${v.outcome === 'SENT_HOME' ? 'sent home' : 'referred'}. Check in with the family and record how they are.`,
      });
    }
    return { tasks: visits.length };
  }, opts);
}

/** Opted-in profiles for an automation that needs an opt-in. */
export async function optedIn(key, profileIds = null) {
  const rows = await AutomationOptIn.find({ key, enabled: true, ...(profileIds && { profileId: { $in: profileIds } }) }).select('profileId').lean();
  return new Set(rows.map((r) => String(r.profileId)));
}

/** One child's week, for the parent digest: from what the parent may already see. */
export async function childWeek(studentId, clock) {
  const enrolment = await Enrollment.findOne({ studentId, status: 'ACTIVE' }).select('_id sectionId').lean();
  const student = await Student.findById(studentId).select('firstName lastName').lean();
  if (!enrolment || !student) return null;
  const monday = addDays(clock.day, -((clock.day.getUTCDay() + 6) % 7));
  const marks = await AttendanceRecord.find({ enrollmentId: enrolment._id, periodNo: null, date: { $gte: monday, $lt: addDays(clock.day, 1) } }).select('status').lean();
  const present = marks.filter((m) => ATTENDED.includes(m.status)).length;
  const offerings = await SubjectOffering.find({ sectionId: enrolment.sectionId }).select('_id').lean();
  const upcoming = await Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: addDays(clock.day, 1), $lt: addDays(clock.day, 8) } }).select('_id').lean();
  const submitted = new Set((await Submission.find({ assignmentId: { $in: upcoming.map((a) => a._id) }, enrollmentId: enrolment._id, status: { $in: ['SUBMITTED', 'LATE', 'GRADED', 'EXEMPT'] } }).select('assignmentId').lean()).map((s) => String(s.assignmentId)));
  const homework = upcoming.filter((a) => !submitted.has(String(a._id))).length;
  const feeDue = await Invoice.exists({ enrollmentId: enrolment._id, status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, voidedAt: null, dueOn: { $lte: addDays(clock.day, 7) } });
  return {
    studentId: String(studentId), studentName: `${student.firstName} ${student.lastName ?? ''}`.trim(), present, marked: marks.length, homework, feeDue: Boolean(feeDue),
    summary: `${marks.length ? `present ${present} of ${marks.length} day(s)` : 'no attendance marked yet'}, ${homework} homework due next week, ${feeDue ? 'a fee is due' : 'no fee due'}`,
  };
}

/* 10. Weekly digest per child, for parents who opted in. */
export async function runWeeklyDigest(now = new Date(), opts = {}) {
  return runOnce('weeklyParentDigest', now, async ({ clock }) => {
    const parents = await optedIn('weeklyParentDigest');
    let sent = 0;
    for (const parentId of parents) {
      /* eslint-disable no-await-in-loop */
      const children = await getGuardianStudentIds(parentId);
      for (const sid of children) {
        const week = await childWeek(sid, clock);
        if (!week) continue;
        await sendOperational({
          templateKey: 'WEEKLY_CHILD_DIGEST', recipientProfileIds: [parentId], variables: { studentName: week.studentName.split(' ')[0], summary: week.summary },
          link: '/parent', idempotencyKey: `automation:digest:${parentId}:${sid}:${clock.ymd}`, relatedEntityType: 'Student', relatedEntityId: sid, now,
        });
        sent += 1;
      }
      /* eslint-enable no-await-in-loop */
    }
    return { parents: parents.size, sent };
  }, opts);
}

/* 11. Birthday greetings, in the app only, for students whose family (or who themselves) opted in. */
export async function runBirthdays(now = new Date(), opts = {}) {
  return runOnce('birthdayGreetings', now, async ({ clock }) => {
    const [, m, d] = clock.ymd.split('-').map(Number);
    const students = await Student.find({ deletedAt: null, status: { $ne: 'INACTIVE' }, dob: { $ne: null }, $expr: { $and: [{ $eq: [{ $month: '$dob' }, m] }, { $eq: [{ $dayOfMonth: '$dob' }, d] }] } }).select('_id firstName profileId').lean();
    if (!students.length) return { greeted: 0 };
    const links = await StudentGuardian.find({ studentId: { $in: students.map((s) => s._id) } }).select('studentId guardianProfileId').lean();
    const opted = await optedIn('birthdayGreetings', [...students.map((s) => s.profileId).filter(Boolean), ...links.map((l) => l.guardianProfileId)]);
    const school = await School.findOne({ slug: currentTenantId() }).select('name').lean();
    let greeted = 0;
    for (const s of students) {
      const family = links.filter((l) => String(l.studentId) === String(s._id)).map((l) => String(l.guardianProfileId));
      const yes = (s.profileId && opted.has(String(s.profileId))) || family.some((g) => opted.has(g));
      if (!yes || !s.profileId) continue;
      // eslint-disable-next-line no-await-in-loop
      await sendOperational({
        templateKey: 'BIRTHDAY_GREETING', recipientProfileIds: [String(s.profileId)], channels: [],
        variables: { name: s.firstName, school: school?.name ?? '' }, link: null, idempotencyKey: `automation:birthday:${s._id}:${clock.ymd.slice(0, 4)}`, now,
      });
      greeted += 1;
    }
    return { birthdays: students.length, greeted };
  }, opts);
}

export const RUNNERS = {
  attendanceRegisterNudge: runRegisterNudge,
  homeworkDueReminders: runHomeworkDue,
  feeReminders: runFeeReminders,
  libraryOverdueDaily: runLibraryOverdue,
  principalDailyBriefing: runDailyBriefing,
  staffCoverSuggestions: runCoverSuggestions,
  lowStockPurchaseDrafts: runLowStockDrafts,
  admissionsFollowupReminder: runFollowupReminder,
  healthVisitFollowups: runHealthFollowups,
  weeklyParentDigest: runWeeklyDigest,
  birthdayGreetings: runBirthdays,
};

/** The scheduler's entry: every school automation that is due now (each decides for itself). */
export async function runSchoolAutomations({ now = new Date() } = {}) {
  const out = [];
  for (const [key, run] of Object.entries(RUNNERS)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one at a time, like the scheduler's jobs
      out.push(await run(now));
    } catch (err) {
      logger.error(`Automation ${key} crashed: ${err.message}`);
      out.push({ key, failed: err.message });
    }
  }
  return { ran: out.filter((r) => r.ran).map((r) => r.key), failed: out.filter((r) => r.failed).map((r) => r.key) };
}
