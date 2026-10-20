import { ReviewCase, REVIEW_REASONS, CALL_CHANNELS } from '../../models/ptm.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getClassTeacherSectionIds } from '../../utils/scope.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, parseDate, requireText, optionalText, oneOf, profileNames, pageArgs,
} from '../ops/common.js';
import { activeEnrollment, loadStudent, studentLabel, classLabel, assertStaffProfile, isClassTeacherOfSection, guardiansOf } from './relations.js';
import { childBriefing } from './briefing.js';

/**
 * Parent review calls.
 *
 * A case is opened for a child for a reason (attendance, academics, behaviour
 * support, fees where the opener may see fees, wellbeing, other) and assigned
 * to a member of staff. They schedule the call, log every attempt (channel,
 * reached or not), keep private structured notes, agree actions with owners
 * and deadlines (which become tasks and escalate through the tasks engine when
 * overdue), set the next follow-up and finally close the case with an outcome.
 *
 * Notes are private: the assigned person, the class teacher of the child's
 * class and school-wide managers see them; other teachers do not see the case
 * at all. Calls are never recorded. A safeguarding concern is raised through
 * the safeguarding module, not written here.
 */

const OPEN = ['OPEN', 'SCHEDULED', 'IN_PROGRESS'];
const TASK_OPEN = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];
const SAFEGUARDING_HINT = 'A safeguarding concern does not go in review-call notes. Use "Report a safeguarding concern".';
const managesAll = (actor) => actor?.permissions?.['reviewcalls.manage'] === 'ALL';

async function visibleFilter(actor) {
  if (managesAll(actor)) return {};
  const classSections = await getClassTeacherSectionIds(actor.profileId);
  return { $or: [{ assignedProfileId: actor.profileId }, { createdByProfileId: actor.profileId }, { sectionId: { $in: classSections } }] };
}

async function load(actor, id) {
  const c = await ReviewCase.findOne({ _id: assertObjectId(id), ...(await visibleFilter(actor)) });
  if (!c) throw new AppError('Review call not found', 404);
  return c;
}

async function canWork(actor, c) {
  if (managesAll(actor)) return true;
  if (String(c.assignedProfileId) === String(actor.profileId)) return true;
  return isClassTeacherOfSection(actor.profileId, c.sectionId);
}

async function present(c, { detail = false } = {}) {
  const names = await profileNames([c.assignedProfileId, c.createdByProfileId, ...(c.actions ?? []).map((a) => a.ownerProfileId)]);
  const student = await Student.findById(c.studentId).select('firstName lastName admissionNo').lean();
  const enrol = await activeEnrollment(c.studentId);
  const taskIds = (c.actions ?? []).map((a) => a.sourceKey).filter(Boolean);
  const tasks = taskIds.length ? new Map((await DueItem.find({ sourceKey: { $in: taskIds } }).select('sourceKey status dueAt completedAt').lean()).map((t) => [t.sourceKey, t])) : new Map();
  const now = new Date();
  const actions = (c.actions ?? []).map((a) => {
    const t = tasks.get(a.sourceKey);
    const status = a.status === 'CANCELLED' ? 'CANCELLED' : t ? (t.status === 'DONE' ? 'DONE' : t.status === 'CANCELLED' ? 'CANCELLED' : 'OPEN') : a.status;
    return { id: String(a._id), title: a.title, ownerType: a.ownerType, ownerName: a.ownerName ?? names.get(String(a.ownerProfileId)) ?? null, ownerProfileId: a.ownerProfileId ? String(a.ownerProfileId) : null, dueOn: a.dueOn, status, overdue: status === 'OPEN' && a.dueOn && new Date(a.dueOn) < now, taskId: a.taskId ? String(a.taskId) : null };
  });
  const attempts = c.attempts ?? [];
  const lastReached = [...attempts].reverse().find((a) => a.reached) ?? null;
  const out = {
    id: String(c._id), refNo: c.refNo, studentId: String(c.studentId), studentName: studentLabel(student), admissionNo: student?.admissionNo ?? null,
    className: classLabel(enrol?.sectionId), reason: c.reason, summary: c.summary ?? null, priority: c.priority, status: c.status,
    assignedProfileId: String(c.assignedProfileId), assignedName: names.get(String(c.assignedProfileId)) ?? null,
    scheduledAt: c.scheduledAt ?? null, scheduledChannel: c.scheduledChannel ?? null, contactPreferences: c.contactPreferences ?? {},
    attemptsCount: attempts.length, notReachedStreak: notReachedStreak(attempts), lastReachedAt: lastReached?.at ?? null,
    nextFollowUpOn: c.nextFollowUpOn ?? null, followUpOverdue: Boolean(OPEN.includes(c.status) && c.nextFollowUpOn && new Date(c.nextFollowUpOn) < now),
    actions, openActions: actions.filter((a) => a.status === 'OPEN').length, overdueActions: actions.filter((a) => a.overdue).length,
    outcome: c.outcome ?? null, closureNote: c.closureNote ?? null, closedAt: c.closedAt ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
  if (detail) {
    out.attempts = attempts.map((a) => ({ at: a.at, channel: a.channel, reached: a.reached, note: a.note ?? null, byName: a.byName ?? null }));
    out.notes = (c.notes ?? []).map((n) => ({ at: n.at, kind: n.kind, text: n.text, byName: n.byName ?? null }));
    out.history = c.history ?? [];
    out.suggestion = suggestion(attempts);
    out.safeguardingNote = SAFEGUARDING_HINT;
  }
  return out;
}

function notReachedStreak(attempts = []) {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0 && !attempts[i].reached; i -= 1) n += 1;
  return n;
}

/** After repeated failed attempts, suggest a channel not yet tried. */
function suggestion(attempts = [], threshold = 3) {
  const streak = notReachedStreak(attempts);
  if (streak < threshold) return null;
  const tried = new Set(attempts.slice(-streak).map((a) => a.channel));
  const order = ['WHATSAPP', 'PHONE', 'SMS', 'EMAIL', 'IN_PERSON', 'VIDEO'];
  const next = order.filter((c) => !tried.has(c));
  return { notReached: streak, tried: [...tried], tryNext: next.slice(0, 2), text: `Not reached after ${streak} attempts by ${[...tried].map((c) => c.toLowerCase().replace('_', ' ')).join(', ')}. Try ${next.slice(0, 2).map((c) => c.toLowerCase().replace('_', ' ')).join(' or ') || 'a home visit or a letter'}.` };
}

async function syncFollowUp(c, name) {
  if (OPEN.includes(c.status) && c.nextFollowUpOn) {
    const t = await upsertFromSource({
      sourceKey: `reviewcall:${c._id}:followup`, title: `Review call follow-up: ${name} (${c.refNo})`, department: 'ENGAGEMENT', category: 'PTM_FOLLOWUP',
      dueAt: c.nextFollowUpOn, ownerProfileId: c.assignedProfileId, severity: c.priority === 'URGENT' ? 'HIGH' : 'NORMAL', leadDays: [1, 0],
      source: { entityType: 'ReviewCase', entityId: c._id, link: `/review-calls?id=${c._id}` },
    });
    c.followUpTaskId = t.id;
  } else {
    await resolveSource(`reviewcall:${c._id}:followup`, { note: c.status === 'CLOSED' ? 'Case closed' : 'Follow-up date cleared' });
  }
}

export async function create(actor, scope, body = {}) {
  requireProfile(actor);
  const student = await loadStudent(body.studentId);
  const enrol = await activeEnrollment(student._id);
  if (!enrol) throw new AppError('This student has no current class.', 400, [], 'NO_ENROLMENT');
  const sectionId = enrol.sectionId?._id ?? enrol.sectionId;
  if (scope !== 'ALL') {
    const mine = await getTeacherSectionIds(actor.profileId);
    if (!mine.includes(String(sectionId))) throw new AppError('You can open a review call only for a pupil you teach.', 403, [], 'NOT_YOUR_PUPIL');
  }
  const reason = oneOf(body.reason, REVIEW_REASONS, 'reason');
  if (reason === 'FEES' && !actor.permissions?.['fees.read']) throw new AppError('A fees review call needs permission to see fees. Ask the finance office to open it.', 403, [], 'FEES_NOT_PERMITTED');
  if (body.safeguarding) throw new AppError(SAFEGUARDING_HINT, 400, [], 'USE_SAFEGUARDING');
  let assigned = actor.profileId;
  if (body.assignedProfileId && String(body.assignedProfileId) !== String(actor.profileId)) {
    // A teacher may hand a case to the class teacher; managers to anyone on staff.
    const person = await assertStaffProfile(body.assignedProfileId, 'assignee');
    if (scope !== 'ALL' && !(await isClassTeacherOfSection(person.profileId, sectionId))) throw new AppError('You can assign a case to yourself or the class teacher.', 403, [], 'ASSIGN_FORBIDDEN');
    assigned = person.profileId;
  }
  const c = new ReviewCase({
    refNo: await nextRef('RVC'), studentId: student._id, enrollmentId: enrol._id, sectionId, reason,
    summary: optionalText(body.summary, { max: 2000 }) || null, priority: oneOf(body.priority, ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'priority', 'NORMAL'),
    assignedProfileId: assigned, status: 'OPEN', nextFollowUpOn: parseDate(body.nextFollowUpOn, 'nextFollowUpOn'),
    contactPreferences: { language: optionalText(body.contactPreferences?.language, { max: 60 }) || null, accessibility: optionalText(body.contactPreferences?.accessibility, { max: 300 }) || null },
    createdByProfileId: actor.profileId, history: [],
  });
  if (body.ptmBookingId) c.ptmBookingId = assertObjectId(body.ptmBookingId, 'ptmBookingId');
  pushHistory(c, actor, 'OPENED', { to: 'OPEN' });
  await syncFollowUp(c, studentLabel(student));
  await c.save();
  if (String(assigned) !== String(actor.profileId)) {
    await sendOperational({ templateKey: 'REVIEW_CALL_ASSIGNED', recipientProfileIds: [String(assigned)], channels: ['EMAIL'], variables: { ref: c.refNo }, link: `/review-calls?id=${c._id}`, idempotencyKey: `reviewcall:${c._id}:assigned:${assigned}`, relatedEntityType: 'ReviewCase', relatedEntityId: c._id });
  }
  return present(c.toObject(), { detail: true });
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = { ...(await visibleFilter(actor)) };
  const status = query.status ?? 'open';
  if (status === 'open') filter.status = { $in: OPEN };
  else if (status !== 'all') filter.status = oneOf(status, ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'CLOSED'], 'status');
  if (query.reason) filter.reason = oneOf(query.reason, REVIEW_REASONS, 'reason');
  if (query.mine === 'true' || query.mine === true) filter.assignedProfileId = actor.profileId;
  if (query.studentId) filter.studentId = assertObjectId(query.studentId, 'studentId');
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    ReviewCase.find(filter).sort({ status: 1, nextFollowUpOn: 1, createdAt: -1 }).skip(skip).limit(pageSize),
    ReviewCase.countDocuments(filter),
  ]);
  const items = [];
  // eslint-disable-next-line no-await-in-loop
  for (const r of rows) items.push(await present(r.toObject()));
  return { items, total, page, pageSize };
}

export async function get(actor, scope, id) {
  const c = await load(actor, id);
  return present(c.toObject(), { detail: true });
}

async function workable(actor, id) {
  const c = await load(actor, id);
  if (!(await canWork(actor, c))) throw new AppError('Only the assigned person, the class teacher or a manager can work on this case.', 403, [], 'NOT_ASSIGNED');
  if (c.status === 'CLOSED') throw new AppError('This case is closed. Reopen it first.', 409, [], 'CASE_CLOSED');
  return c;
}

export async function schedule(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  c.scheduledAt = parseDate(body.scheduledAt, 'scheduledAt', { required: true });
  c.scheduledChannel = oneOf(body.channel, CALL_CHANNELS, 'channel', 'PHONE');
  const from = c.status;
  if (c.status === 'OPEN') c.status = 'SCHEDULED';
  pushHistory(c, actor, 'SCHEDULED', { from, to: c.status, note: `${c.scheduledChannel.toLowerCase()} on ${c.scheduledAt.toISOString().slice(0, 16)}` });
  if (!c.nextFollowUpOn || c.nextFollowUpOn > c.scheduledAt) c.nextFollowUpOn = c.scheduledAt;
  const s = await Student.findById(c.studentId).select('firstName lastName').lean();
  await syncFollowUp(c, studentLabel(s));
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function logAttempt(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  const channel = oneOf(body.channel, CALL_CHANNELS, 'channel');
  if (typeof body.reached !== 'boolean') throw new AppError('Say whether the family was reached.', 400, [], 'REACHED_REQUIRED');
  c.attempts.push({ at: parseDate(body.at, 'at') ?? new Date(), channel, reached: body.reached, note: optionalText(body.note, { max: 500 }) || null, byProfileId: actor.profileId, byName: actor.displayName ?? null });
  const from = c.status;
  if (body.reached && c.status !== 'IN_PROGRESS') c.status = 'IN_PROGRESS';
  pushHistory(c, actor, body.reached ? 'REACHED' : 'NOT_REACHED', { from, to: c.status, note: channel });
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function addNote(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  if (body.safeguarding) throw new AppError(SAFEGUARDING_HINT, 400, [], 'USE_SAFEGUARDING');
  c.notes.push({ kind: oneOf(body.kind, ['CONTEXT', 'DISCUSSION', 'PARENT_VIEW', 'AGREEMENT', 'OTHER'], 'kind', 'DISCUSSION'), text: requireText(body.text, 'text', { max: 4000 }), byProfileId: actor.profileId, byName: actor.displayName ?? null });
  pushHistory(c, actor, 'NOTE_ADDED');
  await c.save();
  return present(c.toObject(), { detail: true });
}

/** Agreed actions: staff actions become tasks owned by the person named, due on the date agreed. */
export async function addAction(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  const title = requireText(body.title, 'title', { max: 200 });
  const ownerType = oneOf(body.ownerType, ['STAFF', 'PARENT'], 'ownerType', 'STAFF');
  const dueOn = parseDate(body.dueOn, 'dueOn', { required: true });
  const s = await Student.findById(c.studentId).select('firstName lastName').lean();
  const action = { title, ownerType, dueOn, status: 'OPEN' };
  if (ownerType === 'STAFF') {
    const owner = await assertStaffProfile(body.ownerProfileId ?? actor.profileId, 'action owner');
    action.ownerProfileId = owner.profileId; action.ownerName = owner.name;
  } else {
    action.ownerName = 'Parent';
  }
  c.actions.push(action);
  const added = c.actions[c.actions.length - 1];
  if (ownerType === 'STAFF') {
    added.sourceKey = `reviewcall:${c._id}:action:${added._id}`;
    const task = await upsertFromSource({
      sourceKey: added.sourceKey, title: `Review call action (${studentLabel(s)}): ${title}`, department: 'ENGAGEMENT', category: 'PTM_FOLLOWUP',
      dueAt: dueOn, ownerProfileId: action.ownerProfileId, leadDays: [3, 1, 0], severity: c.priority === 'URGENT' ? 'HIGH' : 'NORMAL',
      source: { entityType: 'ReviewCase', entityId: c._id, link: `/review-calls?id=${c._id}` },
    });
    added.taskId = task.id;
  }
  pushHistory(c, actor, 'ACTION_AGREED', { note: title });
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function completeAction(actor, scope, id, actionId, body = {}) {
  const c = await workable(actor, id);
  const a = c.actions.id(assertObjectId(actionId, 'actionId'));
  if (!a) throw new AppError('Action not found', 404);
  a.status = 'DONE';
  if (a.sourceKey) await resolveSource(a.sourceKey, { note: optionalText(body.note, { max: 500 }) || 'Done (recorded on the review call)' });
  pushHistory(c, actor, 'ACTION_DONE', { note: a.title });
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function update(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  if (body.nextFollowUpOn !== undefined) c.nextFollowUpOn = parseDate(body.nextFollowUpOn, 'nextFollowUpOn');
  if (body.priority !== undefined) c.priority = oneOf(body.priority, ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'priority');
  if (body.summary !== undefined) c.summary = optionalText(body.summary, { max: 2000 }) || null;
  if (body.assignedProfileId !== undefined && String(body.assignedProfileId) !== String(c.assignedProfileId)) {
    const person = await assertStaffProfile(body.assignedProfileId, 'assignee');
    if (!managesAll(actor) && !(await isClassTeacherOfSection(person.profileId, c.sectionId))) throw new AppError('You can hand a case only to the class teacher.', 403, [], 'ASSIGN_FORBIDDEN');
    pushHistory(c, actor, 'REASSIGNED', { from: String(c.assignedProfileId), to: person.profileId });
    c.assignedProfileId = person.profileId;
    await sendOperational({ templateKey: 'REVIEW_CALL_ASSIGNED', recipientProfileIds: [person.profileId], channels: ['EMAIL'], variables: { ref: c.refNo }, link: `/review-calls?id=${c._id}`, idempotencyKey: `reviewcall:${c._id}:assigned:${person.profileId}`, relatedEntityType: 'ReviewCase', relatedEntityId: c._id });
  }
  const s = await Student.findById(c.studentId).select('firstName lastName').lean();
  await syncFollowUp(c, studentLabel(s));
  pushHistory(c, actor, 'UPDATED');
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function close(actor, scope, id, body = {}) {
  const c = await workable(actor, id);
  c.outcome = oneOf(body.outcome, ['RESOLVED', 'IMPROVING', 'REFERRED', 'NO_CONTACT', 'OTHER'], 'outcome');
  c.closureNote = requireText(body.note, 'note', { max: 2000 });
  const from = c.status;
  c.status = 'CLOSED';
  c.closedAt = new Date();
  pushHistory(c, actor, 'CLOSED', { from, to: 'CLOSED', note: c.outcome });
  await syncFollowUp(c, '');
  await c.save();
  return present(c.toObject(), { detail: true });
}

export async function reopen(actor, scope, id, body = {}) {
  const c = await load(actor, id);
  if (!(await canWork(actor, c))) throw new AppError('Only the assigned person, the class teacher or a manager can reopen this case.', 403, [], 'NOT_ASSIGNED');
  if (c.status !== 'CLOSED') throw new AppError('This case is open.', 409);
  c.status = 'IN_PROGRESS';
  c.closedAt = null;
  pushHistory(c, actor, 'REOPENED', { from: 'CLOSED', to: 'IN_PROGRESS', note: requireText(body.reason, 'reason', { max: 500 }) });
  await c.save();
  return present(c.toObject(), { detail: true });
}

/** The child briefing, for someone who can work on the case. */
export async function briefing(actor, scope, id) {
  const c = await load(actor, id);
  if (!(await canWork(actor, c))) throw new AppError('Only the assigned person, the class teacher or a manager can see the briefing.', 403, [], 'NOT_ASSIGNED');
  const out = await childBriefing(actor, c.studentId, { purpose: 'REVIEWCALL' });
  out.guardianCount = (await guardiansOf(c.studentId)).length;
  return out;
}

/**
 * The follow-up picture: open cases, overdue actions and families not reached
 * after N attempts (with the channel to try next).
 */
export async function metrics(actor, scope, query = {}) {
  requireProfile(actor);
  const threshold = Math.min(Math.max(Number.parseInt(query.attempts, 10) || 3, 1), 10);
  const filter = { ...(await visibleFilter(actor)), status: { $in: OPEN } };
  const open = await ReviewCase.find(filter).lean();
  const now = new Date();
  const keys = open.flatMap((c) => (c.actions ?? []).map((a) => a.sourceKey)).filter(Boolean);
  const tasks = keys.length ? await DueItem.find({ sourceKey: { $in: keys }, status: { $in: TASK_OPEN } }).select('sourceKey dueAt').lean() : [];
  const overdue = tasks.filter((t) => t.dueAt < now);
  const notReached = [];
  for (const c of open) {
    const s = suggestion(c.attempts ?? [], threshold);
    if (s) {
      // eslint-disable-next-line no-await-in-loop
      const st = await Student.findById(c.studentId).select('firstName lastName').lean();
      notReached.push({ id: String(c._id), refNo: c.refNo, studentName: studentLabel(st), ...s });
    }
  }
  const byReason = Object.fromEntries(REVIEW_REASONS.map((r) => [r, open.filter((c) => c.reason === r).length]));
  const closedRecently = await ReviewCase.find({ ...(await visibleFilter(actor)), status: 'CLOSED', closedAt: { $gte: new Date(now.getTime() - 90 * 86_400_000) } }).select('outcome').lean();
  return {
    openCases: open.length, byReason, overdueActions: overdue.length, openActions: tasks.length,
    followUpsOverdue: open.filter((c) => c.nextFollowUpOn && c.nextFollowUpOn < now).length,
    notReachedThreshold: threshold, familiesNotReached: notReached,
    closedLast90Days: closedRecently.length, resolvedLast90Days: closedRecently.filter((c) => ['RESOLVED', 'IMPROVING'].includes(c.outcome)).length,
    definition: `Overdue actions are agreed staff actions past their due date and not done in Tasks. A family is "not reached" after ${threshold} unsuccessful attempts in a row.`,
    asOf: now.toISOString(),
  };
}
