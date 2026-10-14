import { DueItem, DEPARTMENTS, CATEGORIES, SEVERITIES } from '../../models/dueItem.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, profilesWithRoles, pageArgs,
} from '../ops/common.js';

/**
 * Tasks and reminders: one queue for everything that is due.
 *
 * Modules announce their due dates with upsertFromSource() (a bill, a licence,
 * a vehicle's fitness certificate, a chemical's expiry); people can also add
 * items by hand. Each item has an owner (and an optional delegate), a due
 * date, lead times for reminders, a severity, optional recurrence and the
 * evidence that closed it. Overdue items escalate: first to the people who
 * run the department, then to the principal. Completing a recurring item
 * creates the next one and keeps the history of both.
 */

const DAY = 86_400_000;
const OPEN_STATES = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];

/** Who runs each department, for escalation and for items whose owner left. */
export const DEPARTMENT_LEADS = {
  ADMINISTRATION: ['ADMIN'], FINANCE: ['FINANCE'], ACADEMICS: ['PRINCIPAL'], LABS: ['ADMIN'], TRANSPORT: ['ADMIN'],
  FACILITIES: ['ADMIN'], COMPLIANCE: ['COMPLIANCE'], HR: ['HR'], HOSTEL: ['WARDEN'], LIBRARY: ['LIBRARIAN'],
  ENGAGEMENT: ['PRINCIPAL'], SUSTAINABILITY: ['ADMIN'], HEALTH: ['ADMIN'], IT: ['ADMIN'], OTHER: ['ADMIN'],
};

function present(d, now = new Date()) {
  const out = dto(d);
  const due = new Date(d.dueAt).getTime();
  out.overdue = OPEN_STATES.includes(d.status) && due < now.getTime() && !(d.status === 'SNOOZED' && d.snoozedUntil && new Date(d.snoozedUntil) > now);
  out.daysLeft = Math.ceil((due - now.getTime()) / DAY);
  return out;
}

function recurrenceOf(body) {
  const r = body?.recurrence;
  if (!r || !r.unit) return { unit: null, every: null };
  return { unit: oneOf(r.unit, ['DAY', 'WEEK', 'MONTH', 'YEAR'], 'recurrence.unit'), every: Math.max(1, Math.min(Number.parseInt(r.every, 10) || 1, 365)) };
}

function leadDaysOf(value) {
  if (!Array.isArray(value)) return undefined;
  const days = [...new Set(value.map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
  return days.length ? days.slice(0, 8) : undefined;
}

async function assertSchoolProfile(id, label) {
  if (!id) return null;
  const p = await Profile.findOne({ _id: assertObjectId(id, label), deletedAt: null }).select('_id status').lean();
  if (!p) throw new AppError(`That ${label === 'delegateProfileId' ? 'delegate' : 'owner'} is not a person in this school.`, 404, [], 'NOT_FOUND');
  return p._id;
}

function fieldsFrom(body, actor, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  if (!partial || body.department !== undefined) out.department = oneOf(body.department, DEPARTMENTS, 'department');
  if (!partial || body.dueAt !== undefined) out.dueAt = parseDate(body.dueAt, 'dueAt', { required: true });
  if (body.description !== undefined) out.description = optionalText(body.description, { max: 4000 }) ?? '';
  if (body.category !== undefined) out.category = oneOf(body.category, CATEGORIES, 'category', 'OTHER');
  if (body.severity !== undefined) out.severity = oneOf(body.severity, SEVERITIES, 'severity', 'NORMAL');
  const lead = leadDaysOf(body.leadDays);
  if (lead) out.leadDays = lead;
  if (body.recurrence !== undefined) out.recurrence = recurrenceOf(body);
  if (body.amountPaise !== undefined) {
    const n = Number(body.amountPaise);
    if (body.amountPaise !== null && (!Number.isInteger(n) || n < 0)) throw new AppError('amountPaise must be whole paise', 400);
    out.amountPaise = body.amountPaise === null ? null : n;
  }
  if (body.requiresEvidence !== undefined) out.requiresEvidence = body.requiresEvidence === true;
  if (body.source && typeof body.source === 'object') {
    out.source = {
      entityType: optionalText(body.source.entityType, { max: 60 }) || null,
      entityId: body.source.entityId ? assertObjectId(body.source.entityId, 'source.entityId') : null,
      link: optionalText(body.source.link, { max: 300 }) || null,
    };
  }
  void actor;
  return out;
}

function canTouch(actor, scope, item) {
  if (scope === 'ALL') return true;
  const me = String(actor.profileId);
  return String(item.ownerProfileId) === me || String(item.delegateProfileId) === me || String(item.createdByProfileId) === me;
}

async function load(actor, scope, id) {
  const item = await DueItem.findById(assertObjectId(id));
  if (!item || !canTouch(actor, scope, item)) throw new AppError('Task not found', 404);
  return item;
}

export async function createItem(actor, scope, body = {}) {
  requireProfile(actor);
  const fields = fieldsFrom(body, actor);
  // A person holding the permission only for themselves creates items they own.
  const owner = scope === 'ALL' && body.ownerProfileId ? await assertSchoolProfile(body.ownerProfileId, 'ownerProfileId') : actor.profileId;
  const delegate = body.delegateProfileId ? await assertSchoolProfile(body.delegateProfileId, 'delegateProfileId') : null;
  const item = new DueItem({ ...fields, refNo: await nextRef('TSK'), ownerProfileId: owner, delegateProfileId: delegate, createdByProfileId: actor.profileId });
  pushHistory(item, actor, 'CREATED');
  await item.save();
  return present(item.toObject());
}

/**
 * For modules: creates or updates the open item for a source (sourceKey is the
 * module's stable key, e.g. `licence:<id>:expiry`). A completed item is left
 * alone; a changed due date updates the open one rather than adding another.
 * Returns the item. Runs inside the caller's school.
 */
export async function upsertFromSource({ sourceKey, title, department, category = 'OTHER', dueAt, ownerProfileId = null, severity = 'NORMAL', leadDays, amountPaise = null, source = {}, description = '', recurrence = null, requiresEvidence = false }) {
  if (!sourceKey) throw new AppError('sourceKey is required', 500);
  const existing = await DueItem.findOne({ sourceKey });
  if (existing && !OPEN_STATES.includes(existing.status)) return present(existing.toObject());
  const owner = ownerProfileId ?? (await profilesWithRoles(DEPARTMENT_LEADS[department] ?? ['ADMIN']))[0]?._id ?? null;
  const fields = {
    title: String(title).slice(0, 200), department, category, dueAt: new Date(dueAt), severity, description,
    amountPaise, requiresEvidence, ...(leadDaysOf(leadDays) ? { leadDays: leadDaysOf(leadDays) } : {}),
    recurrence: recurrence?.unit ? recurrence : { unit: null, every: null },
    source: { entityType: source.entityType ?? null, entityId: source.entityId ?? null, link: source.link ?? null },
  };
  if (existing) {
    const moved = new Date(existing.dueAt).getTime() !== fields.dueAt.getTime();
    Object.assign(existing, fields);
    if (!existing.ownerProfileId && owner) existing.ownerProfileId = owner;
    if (moved) { existing.remindersSent = []; existing.escalationLevel = 0; pushHistory(existing, null, 'DUE_DATE_CHANGED'); }
    await existing.save();
    return present(existing.toObject());
  }
  try {
    const item = await DueItem.create({ ...fields, sourceKey, refNo: await nextRef('TSK'), ownerProfileId: owner, history: [{ action: 'CREATED', note: `From ${source.entityType ?? 'a module'}` }] });
    return present(item.toObject());
  } catch (err) {
    // Two announcements at once: the other one won; return it.
    if (err?.code === 11000) return present((await DueItem.findOne({ sourceKey }).lean()));
    throw err;
  }
}

/** Closes a source's open item (the module resolved it itself, e.g. the licence was renewed). */
export async function resolveSource(sourceKey, { note = 'Resolved in its module' } = {}) {
  const item = await DueItem.findOne({ sourceKey, status: { $in: OPEN_STATES } });
  if (!item) return null;
  item.status = 'DONE';
  item.completedAt = new Date();
  item.completionNote = note;
  pushHistory(item, null, 'RESOLVED_AT_SOURCE', { note });
  await item.save();
  return present(item.toObject());
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const now = new Date();
  const filter = {};
  const view = query.view ?? (scope === 'ALL' ? 'all' : 'mine');
  const me = actor.profileId;
  if (scope !== 'ALL' || view === 'mine') filter.$or = [{ ownerProfileId: me }, { delegateProfileId: me }];
  if (typeof query.department === 'string' && DEPARTMENTS.includes(query.department)) filter.department = query.department;
  if (typeof query.category === 'string' && CATEGORIES.includes(query.category)) filter.category = query.category;
  const status = typeof query.status === 'string' ? query.status : 'open';
  if (status === 'open') filter.status = { $in: OPEN_STATES };
  else if (status === 'done') filter.status = 'DONE';
  else if (status === 'all') { /* every status */ } else filter.status = oneOf(status, ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'DONE', 'CANCELLED'], 'status');
  if (view === 'exceptions') {
    // Overdue, or critical and due within a week: what the principal and admin must see.
    filter.status = { $in: OPEN_STATES };
    filter.$and = [{ $or: [{ dueAt: { $lt: now } }, { severity: 'CRITICAL', dueAt: { $lt: new Date(now.getTime() + 7 * DAY) } }] }];
  }
  const to = parseDate(query.to, 'to');
  if (to) filter.dueAt = { ...(filter.dueAt ?? {}), $lte: to };
  const { page, pageSize, skip } = pageArgs(query);
  const [items, total] = await Promise.all([
    DueItem.find(filter).sort({ dueAt: 1 }).skip(skip).limit(pageSize).lean(),
    DueItem.countDocuments(filter),
  ]);
  const people = await Profile.find({ _id: { $in: items.flatMap((i) => [i.ownerProfileId, i.delegateProfileId]).filter(Boolean) } }).select('displayName').lean();
  const name = new Map(people.map((p) => [String(p._id), p.displayName]));
  return {
    items: items.map((i) => ({ ...present(i, now), ownerName: name.get(String(i.ownerProfileId)) ?? null, delegateName: name.get(String(i.delegateProfileId)) ?? null })),
    total, page, pageSize,
  };
}

/** Counts and forecast cost: overdue, due this week and month, by department; the principal's and admin's overview. */
export async function summary(actor, scope) {
  requireProfile(actor);
  const now = new Date();
  const base = { status: { $in: OPEN_STATES } };
  if (scope !== 'ALL') base.$or = [{ ownerProfileId: actor.profileId }, { delegateProfileId: actor.profileId }];
  const rows = await DueItem.aggregate([
    { $match: base },
    { $group: {
      _id: '$department',
      open: { $sum: 1 },
      overdue: { $sum: { $cond: [{ $lt: ['$dueAt', now] }, 1, 0] } },
      week: { $sum: { $cond: [{ $and: [{ $gte: ['$dueAt', now] }, { $lt: ['$dueAt', new Date(now.getTime() + 7 * DAY)] }] }, 1, 0] } },
      month: { $sum: { $cond: [{ $and: [{ $gte: ['$dueAt', now] }, { $lt: ['$dueAt', new Date(now.getTime() + 30 * DAY)] }] }, 1, 0] } },
      quarterCostPaise: { $sum: { $cond: [{ $lt: ['$dueAt', new Date(now.getTime() + 90 * DAY)] }, { $ifNull: ['$amountPaise', 0] }, 0] } },
      critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
      unassigned: { $sum: { $cond: [{ $eq: ['$ownerProfileId', null] }, 1, 0] } },
    } },
    { $sort: { overdue: -1, open: -1 } },
  ]);
  const total = rows.reduce((t, r) => ({
    open: t.open + r.open, overdue: t.overdue + r.overdue, week: t.week + r.week, month: t.month + r.month,
    quarterCostPaise: t.quarterCostPaise + r.quarterCostPaise, critical: t.critical + r.critical, unassigned: t.unassigned + r.unassigned,
  }), { open: 0, overdue: 0, week: 0, month: 0, quarterCostPaise: 0, critical: 0, unassigned: 0 });
  return { byDepartment: rows.map(({ _id, ...r }) => ({ department: _id, ...r })), total, asOf: now.toISOString(), definition: 'Open = not done or cancelled. Forecast cost is the expected amount of items due in the next 90 days, where one was recorded.' };
}

export async function acknowledge(actor, scope, id) {
  const item = await load(actor, scope, id);
  if (!OPEN_STATES.includes(item.status)) throw new AppError('This task is closed.', 409, [], 'TASK_CLOSED');
  item.status = 'ACKNOWLEDGED';
  pushHistory(item, actor, 'ACKNOWLEDGED');
  await item.save();
  return present(item.toObject());
}

export async function snooze(actor, scope, id, body = {}) {
  const item = await load(actor, scope, id);
  if (!OPEN_STATES.includes(item.status)) throw new AppError('This task is closed.', 409, [], 'TASK_CLOSED');
  const until = parseDate(body.until, 'until', { required: true });
  const reason = requireText(body.reason, 'reason', { max: 500 });
  if (until <= new Date()) throw new AppError('Snooze until a future date.', 400, [], 'BAD_SNOOZE');
  // A critical item can be put off by a day at most; anything else by a month.
  const maxDays = item.severity === 'CRITICAL' ? 1 : 30;
  if (until.getTime() - Date.now() > maxDays * DAY) throw new AppError(`A ${item.severity.toLowerCase()} task can be snoozed for at most ${maxDays} day(s).`, 400, [], 'SNOOZE_TOO_LONG');
  item.status = 'SNOOZED';
  item.snoozedUntil = until;
  item.snoozeReason = reason;
  pushHistory(item, actor, 'SNOOZED', { note: `${reason} (until ${until.toISOString().slice(0, 10)})` });
  await item.save();
  return present(item.toObject());
}

function nextDue(date, { unit, every }) {
  const d = new Date(date);
  if (unit === 'DAY') d.setUTCDate(d.getUTCDate() + every);
  if (unit === 'WEEK') d.setUTCDate(d.getUTCDate() + 7 * every);
  if (unit === 'MONTH') d.setUTCMonth(d.getUTCMonth() + every);
  if (unit === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + every);
  return d;
}

export async function complete(actor, scope, id, body = {}) {
  const item = await load(actor, scope, id);
  if (!OPEN_STATES.includes(item.status)) throw new AppError('This task is already closed.', 409, [], 'TASK_CLOSED');
  const evidence = cleanAttachments(body.evidence, actor);
  const note = optionalText(body.note, { max: 2000 }) || null;
  if (item.requiresEvidence && !evidence.length && !note) throw new AppError('Attach the evidence (a receipt, a certificate, a photo) or describe it.', 400, [], 'EVIDENCE_REQUIRED');
  item.status = 'DONE';
  item.completedAt = new Date();
  item.completedByProfileId = actor.profileId;
  item.completionNote = note;
  item.evidence.push(...evidence);
  pushHistory(item, actor, 'COMPLETED', { note });
  let next = null;
  if (item.recurrence?.unit) {
    // The next instance is a new record; this one keeps its history.
    next = new DueItem({
      refNo: await nextRef('TSK'), title: item.title, description: item.description, department: item.department, category: item.category,
      source: item.source, ownerProfileId: item.ownerProfileId, delegateProfileId: item.delegateProfileId,
      dueAt: nextDue(item.dueAt, item.recurrence), severity: item.severity, leadDays: item.leadDays, recurrence: item.recurrence,
      amountPaise: item.amountPaise, requiresEvidence: item.requiresEvidence, previousId: item._id, createdByProfileId: actor.profileId,
      history: [{ action: 'CREATED', actorProfileId: actor.profileId, actorName: actor.displayName, note: `Next after ${item.refNo}` }],
    });
    // A source key belongs to the open instance.
    if (item.sourceKey) { next.sourceKey = item.sourceKey; item.sourceKey = null; }
    item.nextId = next._id;
  }
  await item.save();
  if (next) await next.save();
  return { ...present(item.toObject()), next: next ? present(next.toObject()) : null };
}

export async function reassign(actor, scope, id, body = {}) {
  if (scope !== 'ALL') throw new AppError('Only someone who manages every task can reassign one.', 403, [], 'FORBIDDEN');
  const item = await load(actor, scope, id);
  const owner = await assertSchoolProfile(body.ownerProfileId, 'ownerProfileId');
  const delegate = body.delegateProfileId === null ? null : body.delegateProfileId ? await assertSchoolProfile(body.delegateProfileId, 'delegateProfileId') : item.delegateProfileId;
  pushHistory(item, actor, 'REASSIGNED', { from: String(item.ownerProfileId ?? ''), to: String(owner), note: optionalText(body.note, { max: 500 }) || null });
  item.ownerProfileId = owner;
  item.delegateProfileId = delegate;
  item.escalationLevel = 0;
  await item.save();
  return present(item.toObject());
}

export async function cancel(actor, scope, id, body = {}) {
  const item = await load(actor, scope, id);
  if (!OPEN_STATES.includes(item.status)) throw new AppError('This task is already closed.', 409, [], 'TASK_CLOSED');
  const reason = requireText(body.reason, 'reason', { max: 500 });
  item.status = 'CANCELLED';
  pushHistory(item, actor, 'CANCELLED', { note: reason });
  await item.save();
  return present(item.toObject());
}

/**
 * The reminder and escalation pass (scheduled). For each open item:
 *  - a reminder at each lead day, once (the outbox's idempotency key keeps a
 *    rerun from sending it twice);
 *  - a snoozed item wakes when its snooze ends;
 *  - overdue for a day: the department's leads are told; overdue a week: the
 *    principal is told;
 *  - an item with no active owner goes to the department's leads, so work
 *    never sits with nobody.
 */
export async function runReminders({ now = new Date() } = {}) {
  let reminded = 0; let escalated = 0; let reassigned = 0;
  await DueItem.updateMany({ status: 'SNOOZED', snoozedUntil: { $lte: now } }, { $set: { status: 'OPEN' }, $push: { history: { at: now, action: 'SNOOZE_ENDED' } } });
  const items = await DueItem.find({ status: { $in: ['OPEN', 'ACKNOWLEDGED'] }, dueAt: { $lt: new Date(now.getTime() + 366 * DAY) } }).limit(5000);
  const ownerIds = [...new Set(items.map((i) => String(i.ownerProfileId)).filter((x) => x !== 'null'))];
  const activeOwners = new Set((await Profile.find({ _id: { $in: ownerIds }, status: 'ACTIVE', deletedAt: null }).select('_id').lean()).map((p) => String(p._id)));
  const leadsCache = new Map();
  const leadsOf = async (dept) => {
    if (!leadsCache.has(dept)) leadsCache.set(dept, (await profilesWithRoles(DEPARTMENT_LEADS[dept] ?? ['ADMIN'])).map((p) => String(p._id)));
    return leadsCache.get(dept);
  };
  const principals = (await profilesWithRoles(['PRINCIPAL'])).map((p) => String(p._id));
  for (const item of items) {
    let changed = false;
    // eslint-disable-next-line no-await-in-loop
    const leads = await leadsOf(item.department);
    if (!item.ownerProfileId || !activeOwners.has(String(item.ownerProfileId))) {
      const fallback = leads[0] ?? principals[0] ?? null;
      if (fallback && String(fallback) !== String(item.ownerProfileId)) {
        pushHistory(item, null, 'OWNER_UNAVAILABLE_REASSIGNED', { from: String(item.ownerProfileId ?? ''), to: fallback });
        item.ownerProfileId = fallback;
        changed = true; reassigned += 1;
      }
    }
    const recipients = [item.ownerProfileId, item.delegateProfileId].filter(Boolean).map(String);
    const daysLeft = Math.ceil((new Date(item.dueAt).getTime() - now.getTime()) / DAY);
    const sent = new Set((item.remindersSent ?? []).map((r) => r.lead));
    const lead = [...item.leadDays].sort((a, b) => a - b).find((l) => daysLeft <= l && !sent.has(l));
    if (lead !== undefined && daysLeft >= 0 && recipients.length) {
      // eslint-disable-next-line no-await-in-loop
      await sendOperational({
        templateKey: 'TASK_DUE', recipientProfileIds: recipients, channels: ['EMAIL'],
        variables: { title: item.title, when: new Date(item.dueAt).toISOString().slice(0, 10), days: daysLeft },
        link: '/tasks', idempotencyKey: `task:${item._id}:lead:${lead}`, relatedEntityType: 'DueItem', relatedEntityId: item._id, now,
      });
      // Every lead day already passed counts as sent, so a late start does not fire a backlog.
      for (const l of item.leadDays) if (daysLeft <= l && !sent.has(l)) item.remindersSent.push({ lead: l, at: now });
      changed = true; reminded += 1;
    }
    const overdueDays = Math.floor((now.getTime() - new Date(item.dueAt).getTime()) / DAY);
    const wantLevel = overdueDays >= 7 ? 2 : overdueDays >= 1 ? 1 : 0;
    if (wantLevel > item.escalationLevel) {
      const to = wantLevel === 2 ? [...new Set([...principals, ...leads])] : leads;
      const fresh = to.filter((id) => !recipients.includes(id));
      if (fresh.length) {
        // eslint-disable-next-line no-await-in-loop
        await sendOperational({
          templateKey: 'TASK_OVERDUE', recipientProfileIds: fresh, channels: ['EMAIL'],
          variables: { title: item.title, days: overdueDays, department: item.department.toLowerCase() },
          link: '/tasks?view=exceptions', idempotencyKey: `task:${item._id}:esc:${wantLevel}`, relatedEntityType: 'DueItem', relatedEntityId: item._id, now,
        });
      }
      item.escalationLevel = wantLevel;
      item.escalatedAt = now;
      pushHistory(item, null, `ESCALATED_${wantLevel}`, { note: `${overdueDays} day(s) overdue` });
      changed = true; escalated += 1;
    }
    // eslint-disable-next-line no-await-in-loop
    if (changed) await item.save();
  }
  return { checked: items.length, reminded, escalated, reassigned };
}
