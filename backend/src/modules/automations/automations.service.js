import { AutomationSetting, AutomationDraft, AutomationOptIn, PersonalAutomation, AutomationRun } from '../../models/automation.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { Enrollment } from '../../models/student.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { Assignment, Submission } from '../../models/assignment.model.js';

import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { featureEnabled } from '../../utils/features.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { getClassTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import * as approvals from '../approvals/approval.service.js';
import * as cover from '../staff/cover.service.js';
import * as procurement from '../finance-ops/procurement.service.js';
import * as insights from '../insights/insights.service.js';
import { AUTOMATIONS, BUILT_IN, automationDef, QUIET_START, QUIET_END, weekdayName } from './automations.catalogue.js';
import { settingFor, localClock, addDays } from './automations.runtime.js';
import { RUNNERS, unmarkedSections, childWeek } from './automations.jobs.js';
import { describeSchedule } from './personal.js';

/**
 * The Automations page and the assistant's view of it: the school's settings
 * (with a preview of each message), drafts waiting on a person, opt-ins, and
 * "what needs you today".
 */

const requireActor = (actor) => { if (!actor?.profileId) throw new AppError('Select a profile first', 403); return actor; };
// School settings (settings.manage) or the head of the institution (institution.manage), school-wide.
export const canManage = (actor) => actor?.permissions?.['settings.manage'] === 'ALL' || actor?.permissions?.['institution.manage'] === 'ALL';

/** Every automation with this school's setting, last run and a sample message. */
export async function listAutomations(actor) {
  requireActor(actor);
  const tenant = currentTenantId() ?? 'platform';
  const rows = [];
  for (const def of AUTOMATIONS) {
    /* eslint-disable no-await-in-loop */
    const s = await settingFor(def.key);
    const last = await AutomationRun.findOne({ automation: def.key, tenantId: tenant, ok: true }).sort({ startedAt: -1 }).select('startedAt result').lean();
    const featureOn = def.feature ? await featureEnabled(def.feature) : true;
    /* eslint-enable no-await-in-loop */
    rows.push({
      key: def.key, label: def.label, description: def.description,
      enabled: s.enabled, effective: s.enabled && featureOn, featureOn, feature: def.feature ?? null,
      cadence: def.cadence, hour: s.hour, weekday: s.weekday, schedule: scheduleText(def, s),
      audience: s.audience, audiences: def.audiences, familyFacing: def.familyFacing, optIn: Boolean(def.optIn),
      channels: def.channels, preview: def.preview(), defaultEnabled: def.defaultEnabled, customised: s.customised,
      lastRun: last ? { at: last.startedAt, result: last.result ?? null } : null,
    });
  }
  return { automations: rows, builtIn: BUILT_IN, quietHours: { from: QUIET_START, to: QUIET_END }, canManage: canManage(actor) };
}

function scheduleText(def, s) {
  const time = `${String(s.hour).padStart(2, '0')}:00`;
  if (def.cadence === 'WEEKLY') return `Every ${weekdayName(s.weekday)} from ${time}`;
  return `${def.schoolDaysOnly ? 'Every school day' : 'Every day'} from ${time}`;
}

/** Checks a change to one automation; returns the cleaned change (for the assistant's draft too). */
export function cleanChange(key, body = {}) {
  const def = automationDef(key);
  if (!def) throw new AppError(`Unknown automation: ${key}`, 404, [], 'NOT_FOUND');
  const change = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new AppError('enabled must be true or false', 400);
    change.enabled = body.enabled;
  }
  if (body.hour !== undefined && body.hour !== null) {
    const h = Number(body.hour);
    if (!Number.isInteger(h) || h < QUIET_END || h >= QUIET_START) throw new AppError(`Choose an hour from ${QUIET_END}:00 to ${QUIET_START - 1}:00; nothing is sent in the quiet hours.`, 400, [], 'QUIET_HOURS');
    change.hour = h;
  }
  if (body.weekday !== undefined && body.weekday !== null) {
    if (def.cadence !== 'WEEKLY') throw new AppError(`${def.label} runs daily, not on a weekday.`, 400);
    const d = Number(body.weekday);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new AppError('weekday must be 0 (Sunday) to 6 (Saturday)', 400);
    change.weekday = d;
  }
  if (body.audience !== undefined) {
    const list = [...new Set((Array.isArray(body.audience) ? body.audience : []).map((a) => String(a).toUpperCase()))];
    const bad = list.filter((a) => !def.audiences.includes(a));
    if (bad.length) throw new AppError(`${def.label} can reach only: ${def.audiences.join(', ')}.`, 400);
    if (!list.length) throw new AppError('Choose at least one group, or switch the automation off.', 400);
    change.audience = list;
  }
  if (!Object.keys(change).length) throw new AppError('Nothing to change.', 400, [], 'AGENT_NEEDS_INPUT');
  return { def, change };
}

export async function updateAutomation(actor, key, body = {}) {
  requireActor(actor);
  if (!canManage(actor)) throw new AppError('Only someone who manages school settings can change automations.', 403);
  const { def, change } = cleanChange(key, body);
  const before = await settingFor(key);
  const row = await AutomationSetting.findOne({ key });
  const doc = row ?? new AutomationSetting({ key, enabled: before.enabled });
  Object.assign(doc, change);
  doc.updatedByProfileId = actor.profileId;
  doc.history.push({ at: new Date(), byProfileId: actor.profileId, change });
  await doc.save();
  await recordAudit({ actor, action: 'automation.update', entityType: 'AutomationSetting', entityId: doc._id, before: { enabled: before.enabled, hour: before.hour, weekday: before.weekday, audience: before.audience }, after: change });
  return { key, label: def.label, ...(await settingFor(key)) };
}

/** Runs one automation now (a manager's "Run now"), still once per day and through the same outbox rules. */
export async function runNow(actor, key, { now = new Date() } = {}) {
  requireActor(actor);
  if (!canManage(actor)) throw new AppError('Only someone who manages school settings can run an automation.', 403);
  const run = RUNNERS[key];
  if (!run) throw new AppError(`Unknown automation: ${key}`, 404);
  const result = await run(now, { force: true });
  await recordAudit({ actor, action: 'automation.runNow', entityType: 'Automation', after: { key, result } });
  return result;
}

/* ── Drafts ─────────────────────────────────────────────────────────────── */

const presentDraft = (d) => ({ id: String(d._id), automationKey: d.automationKey, title: d.title, detail: d.detail, link: d.link, status: d.status, createdAt: d.createdAt, decidedAt: d.decidedAt ?? null });

export async function listDrafts(actor, { status = 'DRAFT' } = {}) {
  requireActor(actor);
  const filter = { ...(status && status !== 'ALL' && { status }), ...(canManage(actor) ? {} : { ownerProfileIds: actor.profileId }) };
  return (await AutomationDraft.find(filter).sort({ createdAt: -1 }).limit(100).lean()).map(presentDraft);
}

async function loadDraft(actor, id) {
  const d = await AutomationDraft.findById(id);
  if (!d || !(canManage(actor) || d.ownerProfileIds.map(String).includes(String(actor.profileId)))) throw new AppError('Draft not found', 404, [], 'NOT_FOUND');
  if (d.status !== 'DRAFT') throw new AppError(`This draft was already ${d.status.toLowerCase()}.`, 409, [], 'CONFLICT');
  return d;
}

/** What confirming a draft will do, in words (the assistant's draft summary uses this). */
export function draftAction(d) {
  if (d.detail?.kind === 'COVER') {
    const ok = (d.detail.periods ?? []).filter((p) => p.suggested);
    return `assign cover for ${ok.length} period(s) on ${d.detail.date}: ${ok.map((p) => `period ${p.periodNo} ${p.class} → ${p.suggested.name}`).join('; ') || 'none has a free substitute'}`;
  }
  if (d.detail?.kind === 'PURCHASE') return `create a DRAFT purchase request for ${(d.detail.items ?? []).map((i) => `${i.suggestedQty} ${i.unit} ${i.name}`).join(', ')} (it still goes for approval)`;
  return `mark "${d.title}" as done`;
}

export async function previewDraft(actor, id) {
  requireActor(actor);
  const d = await loadDraft(actor, id);
  return { ...presentDraft(d.toObject()), willDo: draftAction(d) };
}

export async function confirmDraft(actor, id) {
  requireActor(actor);
  const d = await loadDraft(actor, id);
  const outcome = { created: [], failed: [] };
  if (d.detail?.kind === 'COVER') {
    if (actor.permissions?.['cover.manage'] !== 'ALL') throw new AppError('Only the cover coordinator can confirm cover.', 403);
    for (const p of (d.detail.periods ?? []).filter((x) => x.suggested)) {
      try {
        // eslint-disable-next-line no-await-in-loop -- each cover is checked against the ones just made
        const made = await cover.assign(actor, 'ALL', { date: d.detail.date, sectionId: p.sectionId, periodNo: p.periodNo, substituteProfileId: p.suggested.profileId });
        outcome.created.push({ periodNo: p.periodNo, class: p.class, substitute: p.suggested.name, id: made?.id ?? null });
      } catch (err) {
        outcome.failed.push({ periodNo: p.periodNo, class: p.class, reason: err.message });
      }
    }
  } else if (d.detail?.kind === 'PURCHASE') {
    if (!actor.permissions?.['procurement.request']) throw new AppError('Your account cannot raise purchase requests; ask the office to confirm this draft.', 403);
    const pr = await procurement.createRequestDraft(actor, {
      title: d.title.replace(/^Purchase request:\s*/i, 'Restock: '), department: d.detail.department ?? null,
      items: (d.detail.items ?? []).map((i) => ({ description: i.name, qty: i.suggestedQty, unit: String(i.unit ?? 'nos').slice(0, 20), estUnitPaise: 0 })),
      justification: 'Prepared by the low-stock automation from items at or below their reorder level; quantities can be changed before submitting.',
    });
    outcome.created.push({ purchaseRequest: pr.refNo ?? pr.id ?? null });
  }
  d.status = 'CONFIRMED'; d.decidedByProfileId = actor.profileId; d.decidedAt = new Date();
  await d.save();
  await recordAudit({ actor, action: 'automation.draft.confirm', entityType: 'AutomationDraft', entityId: d._id, after: outcome });
  return { ...presentDraft(d.toObject()), outcome };
}

export async function dismissDraft(actor, id) {
  requireActor(actor);
  const d = await loadDraft(actor, id);
  d.status = 'DISMISSED'; d.decidedByProfileId = actor.profileId; d.decidedAt = new Date();
  await d.save();
  await recordAudit({ actor, action: 'automation.draft.dismiss', entityType: 'AutomationDraft', entityId: d._id });
  return presentDraft(d.toObject());
}

/* ── Opt-ins ────────────────────────────────────────────────────────────── */

export const OPT_IN_KEYS = AUTOMATIONS.filter((a) => a.optIn).map((a) => a.key);

export async function myOptIns(actor) {
  requireActor(actor);
  const rows = await AutomationOptIn.find({ profileId: actor.profileId }).lean();
  const by = new Map(rows.map((r) => [r.key, r.enabled]));
  const out = [];
  for (const key of OPT_IN_KEYS) {
    const def = automationDef(key);
    if (!def.roles.includes(actor.roleKey)) continue;
    // eslint-disable-next-line no-await-in-loop
    const s = await settingFor(key);
    out.push({ key, label: def.label, optedIn: by.get(key) === true, schoolEnabled: s.enabled, preview: def.preview() });
  }
  return out;
}

export async function setMyOptIn(actor, key, enabled) {
  requireActor(actor);
  const def = automationDef(key);
  if (!def?.optIn) throw new AppError('That is not something you opt in to.', 400);
  if (!def.roles.includes(actor.roleKey)) throw new AppError(`${def.label} is for ${def.roles.map((r) => r.toLowerCase()).join(' and ')} accounts.`, 403);
  await AutomationOptIn.findOneAndUpdate({ profileId: actor.profileId, key }, { $set: { enabled: Boolean(enabled) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const s = await settingFor(key);
  return { key, label: def.label, optedIn: Boolean(enabled), schoolEnabled: s.enabled };
}

/* ── What needs you today ──────────────────────────────────────────────── */

const SUBMITTED = ['SUBMITTED', 'LATE', 'GRADED', 'EXEMPT'];

async function homeworkDueSoon(enrollment, clock) {
  const offerings = await SubjectOffering.find({ sectionId: enrollment.sectionId }).select('_id').lean();
  const due = await Assignment.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) }, deletedAt: null, dueAt: { $gte: clock.day, $lt: addDays(clock.day, 3) } }).select('_id title dueAt').lean();
  const done = new Set((await Submission.find({ assignmentId: { $in: due.map((a) => a._id) }, enrollmentId: enrollment._id, status: { $in: SUBMITTED } }).select('assignmentId').lean()).map((s) => String(s.assignmentId)));
  return due.filter((a) => !done.has(String(a._id)));
}

/**
 * The caller's day in one list, from what already exists: their tasks,
 * decisions waiting, registers still to take, drafts to check, their own
 * reminders, and -- for a family -- each child's homework and fees. Only
 * reads the caller may already make; counts and titles come from records.
 */
export async function whatNeedsMe(actor, { now = new Date() } = {}) {
  requireActor(actor);
  const clock = localClock(now);
  const perms = actor.permissions ?? {};
  const items = [];
  const push = (kind, title, extra = {}) => items.push({ kind, title, ...extra });
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  const tasks = await DueItem.find({ status: { $in: ['OPEN', 'ACKNOWLEDGED'] }, dueAt: { $lt: addDays(clock.day, 1) }, $or: [{ ownerProfileId: actor.profileId }, { delegateProfileId: actor.profileId }] }).select('title dueAt').sort({ dueAt: 1 }).limit(50).lean();
  if (tasks.length) push('TASKS', `${tasks.length} task(s) due today or overdue`, { count: tasks.length, examples: tasks.slice(0, 3).map((t) => t.title), link: '/tasks', ask: 'show my tasks' });

  if (perms['approvals.read']) {
    const inbox = await safe(() => approvals.inbox(actor));
    const list = Array.isArray(inbox) ? inbox : (inbox?.items ?? inbox?.rows ?? []);
    if (list.length) push('DECISIONS', `${list.length} approval(s) waiting on you`, { count: list.length, link: '/approvals', ask: 'show my pending approvals' });
  }

  if (actor.roleKey === 'TEACHER') {
    const mine = new Set((await safe(() => getClassTeacherSectionIds(actor.profileId)) ?? []).map(String));
    if (mine.size) {
      const open = (await unmarkedSections(clock.day)).filter((s) => mine.has(s.sectionId));
      if (open.length) push('REGISTER', `Attendance not marked yet for ${open.map((s) => s.class).join(', ')}`, { count: open.length, link: '/attendance', ask: `mark attendance for ${open[0].class}` });
    }
  } else if (perms['attendance.read'] === 'ALL' && ['PRINCIPAL', 'ADMIN'].includes(actor.roleKey)) {
    const open = await safe(() => unmarkedSections(clock.day));
    if (open?.length && clock.hour >= 10) push('REGISTER', `${open.length} class register(s) not marked yet`, { count: open.length, link: '/attendance', ask: 'which registers are not marked today' });
  }

  if (perms['cover.manage'] === 'ALL') {
    const needs = await safe(() => cover.needs(actor, 'ALL', { date: clock.ymd }));
    const uncovered = needs?.totals?.uncovered ?? 0;
    if (uncovered) push('COVER', `${uncovered} period(s) without cover today`, { count: uncovered, link: '/cover', ask: 'show cover needs for today' });
  }

  const drafts = await AutomationDraft.countDocuments({ status: 'DRAFT', ownerProfileIds: actor.profileId });
  if (drafts) push('DRAFTS', `${drafts} automation draft(s) to confirm or dismiss`, { count: drafts, link: '/automations', ask: 'show my automation drafts' });

  const reminders = await PersonalAutomation.find({ profileId: actor.profileId, active: true, nextRunAt: { $gte: now, $lt: addDays(clock.day, 1) } }).select('text schedule').lean();
  for (const r of reminders) push('REMINDER', `Reminder: ${r.text} (${describeSchedule(r.schedule)})`, { link: '/automations' });

  if (actor.roleKey === 'STUDENT') {
    const sid = await safe(() => getOwnStudentId(actor.profileId));
    const enr = sid ? await Enrollment.findOne({ studentId: sid, status: 'ACTIVE' }).select('_id sectionId').lean() : null;
    const hw = enr ? await homeworkDueSoon(enr, clock) : [];
    if (hw.length) push('HOMEWORK', `${hw.length} homework due in the next 2 days`, { count: hw.length, examples: hw.slice(0, 3).map((a) => a.title), link: '/assignments', ask: 'show my pending homework' });
  }
  if (actor.roleKey === 'PARENT') {
    for (const sid of (await safe(() => getGuardianStudentIds(actor.profileId))) ?? []) {
      // eslint-disable-next-line no-await-in-loop
      const week = await safe(() => childWeek(sid, clock));
      if (week && (week.homework || week.feeDue)) push('CHILD', `${week.studentName}: ${week.homework} homework due this week${week.feeDue ? ', a fee is due' : ''}`, { link: '/parent', ask: `how is ${week.studentName.split(' ')[0]} doing` });
    }
  }

  if (perms['institution.read'] && !['TEACHER', 'PARENT', 'STUDENT'].includes(actor.roleKey)) {
    const home = await safe(() => insights.home(actor));
    const deadlines = home?.deadlines ?? [];
    if (deadlines.length) push('DEADLINES', `${deadlines.length} deadline(s) coming up`, { count: deadlines.length, examples: deadlines.slice(0, 3).map((d) => d.title), link: '/today' });
  }

  return { date: clock.ymd, items };
}
