import { SanitationDuty, SanitationCheck, SustainabilityZone, DUTY_KINDS } from '../../models/sustainability.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { AppError } from '../../utils/AppError.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { requireProfile, assertObjectId, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, profileNames } from '../ops/common.js';
import { requireStaff } from './sustainability.access.js';

/**
 * Sanitation duties: toilet cleaning per block, sanitary-pad dispensers and
 * incinerators (stock and service), drinking-water tank cleaning.
 *
 * Each duty's next occurrence is a task in the tasks engine (one source key
 * per occurrence), so it gets the same reminders, escalation and evidence
 * rules as everything else that is due. Recording a check here closes that
 * occurrence and announces the next; completing the task from the Tasks
 * screen counts as a check too (the next sync picks it up).
 */

const DAY = 86_400_000;
const DEFAULT_CHECKLISTS = {
  TOILET_CLEANING: ['Floor and pans cleaned', 'Water supply working', 'Soap available', 'Bins emptied', 'No foul smell'],
  PAD_DISPENSER: ['Dispenser working', 'Stock refilled', 'Area clean'],
  INCINERATOR: ['Incinerator serviced', 'Ash removed safely', 'Area clean'],
  WATER_TANK_CLEANING: ['Tank drained and scrubbed', 'Disinfected', 'Lid secured', 'Water sample sent for testing'],
};
const CATEGORY = { TOILET_CLEANING: 'SANITATION', PAD_DISPENSER: 'SANITATION', INCINERATOR: 'SANITATION', WATER_TANK_CLEANING: 'WATER_TEST' };

export const occurrenceKey = (duty, dueAt = duty.nextDueAt) => `sanitation:${duty._id}:${new Date(dueAt).toISOString().slice(0, 10)}`;
const stockKey = (duty) => `sanitation:${duty._id}:restock`;

function advance(dueAt, duty, from = new Date()) {
  const step = (d) => {
    const n = new Date(d);
    if (duty.frequency === 'DAY') n.setTime(n.getTime() + duty.every * DAY);
    else if (duty.frequency === 'WEEK') n.setTime(n.getTime() + duty.every * 7 * DAY);
    else n.setUTCMonth(n.getUTCMonth() + duty.every);
    return n;
  };
  let next = step(dueAt);
  // A long gap does not produce a backlog of tasks: the next one is the first after now.
  while (next <= from) next = step(next);
  return next;
}

async function announce(duty) {
  const zone = duty.zoneId ? await SustainabilityZone.findById(duty.zoneId).select('name').lean() : null;
  return upsertFromSource({
    sourceKey: occurrenceKey(duty), title: `${duty.title}${zone ? ` (${zone.name})` : duty.blockLabel ? ` (${duty.blockLabel})` : ''}`,
    department: 'SUSTAINABILITY', category: CATEGORY[duty.kind], dueAt: duty.nextDueAt, ownerProfileId: duty.ownerProfileId ?? null,
    severity: duty.kind === 'WATER_TANK_CLEANING' ? 'HIGH' : 'NORMAL', leadDays: duty.frequency === 'DAY' ? [0] : [3, 1, 0],
    requiresEvidence: true, source: { entityType: 'SanitationDuty', entityId: duty._id, link: '/sustainability?tab=sanitation' },
    description: `Checklist: ${duty.checklist.join('; ')}. Record the check with a photo in Sustainability → Sanitation.`,
  });
}

async function announceStock(duty) {
  if (duty.reorderLevel === null || duty.stockLevel === null) return;
  if (duty.stockLevel <= duty.reorderLevel) {
    await upsertFromSource({
      sourceKey: stockKey(duty), title: `Restock: ${duty.title} (${duty.stockLevel} left)`, department: 'SUSTAINABILITY', category: 'SANITATION',
      dueAt: new Date(Date.now() + 2 * DAY), ownerProfileId: duty.ownerProfileId ?? null, severity: 'HIGH', leadDays: [1, 0], requiresEvidence: false,
      source: { entityType: 'SanitationDuty', entityId: duty._id, link: '/sustainability?tab=sanitation' },
    });
  } else {
    await resolveSource(stockKey(duty), { note: 'Stock above the reorder level' });
  }
}

async function dutyDtos(rows) {
  const zones = new Map((await SustainabilityZone.find({ _id: { $in: rows.map((d) => d.zoneId).filter(Boolean) } }).select('name').lean()).map((z) => [String(z._id), z.name]));
  const owners = await profileNames(rows.map((d) => d.ownerProfileId));
  const open = await DueItem.find({ sourceKey: { $in: rows.map((d) => occurrenceKey(d)) }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }).select('sourceKey refNo dueAt').lean();
  const openBy = new Map(open.map((t) => [t.sourceKey, t]));
  return rows.map((d) => ({
    ...dto(d), zoneName: d.zoneId ? zones.get(String(d.zoneId)) ?? null : null, ownerName: d.ownerProfileId ? owners.get(String(d.ownerProfileId)) ?? null : null,
    overdue: new Date(d.nextDueAt) < new Date(), lowStock: d.reorderLevel !== null && d.stockLevel !== null && d.stockLevel <= d.reorderLevel,
    openTask: openBy.get(occurrenceKey(d)) ? { refNo: openBy.get(occurrenceKey(d)).refNo, dueAt: openBy.get(occurrenceKey(d)).dueAt } : null,
  }));
}

export async function listDuties(actor) {
  requireStaff(actor);
  return dutyDtos(await SanitationDuty.find({}).sort({ active: -1, nextDueAt: 1 }).lean());
}

export async function createDuty(actor, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, DUTY_KINDS, 'kind');
  const checklist = (Array.isArray(body.checklist) && body.checklist.length ? body.checklist : DEFAULT_CHECKLISTS[kind])
    .map((s) => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, 20);
  const stock = (v) => (v === undefined || v === null || v === '' ? null : Math.max(0, Number.parseInt(v, 10) || 0));
  const duty = await SanitationDuty.create({
    kind, title: requireText(body.title, 'title', { max: 160 }), zoneId: body.zoneId ? assertObjectId(body.zoneId, 'zoneId') : null,
    blockLabel: optionalText(body.blockLabel, { max: 80 }) || null, checklist,
    frequency: oneOf(body.frequency, ['DAY', 'WEEK', 'MONTH'], 'frequency', kind === 'WATER_TANK_CLEANING' ? 'MONTH' : 'DAY'),
    every: Math.max(1, Math.min(Number.parseInt(body.every, 10) || (kind === 'WATER_TANK_CLEANING' ? 6 : 1), 365)),
    ownerProfileId: body.ownerProfileId ? assertObjectId(body.ownerProfileId, 'ownerProfileId') : null,
    nextDueAt: parseDate(body.firstDueAt, 'firstDueAt') ?? new Date(Date.now() + DAY),
    stockLevel: ['PAD_DISPENSER', 'INCINERATOR'].includes(kind) ? stock(body.stockLevel) : null,
    reorderLevel: ['PAD_DISPENSER', 'INCINERATOR'].includes(kind) ? stock(body.reorderLevel) : null,
  });
  await announce(duty);
  await announceStock(duty);
  return (await dutyDtos([duty.toObject()]))[0];
}

export async function updateDuty(actor, id, body = {}) {
  requireProfile(actor);
  const duty = await SanitationDuty.findById(assertObjectId(id));
  if (!duty) throw new AppError('Sanitation duty not found', 404);
  if (body.title !== undefined) duty.title = requireText(body.title, 'title', { max: 160 });
  if (body.ownerProfileId !== undefined) duty.ownerProfileId = body.ownerProfileId ? assertObjectId(body.ownerProfileId, 'ownerProfileId') : null;
  if (body.reorderLevel !== undefined) duty.reorderLevel = body.reorderLevel === null ? null : Math.max(0, Number.parseInt(body.reorderLevel, 10) || 0);
  if (body.active !== undefined) {
    duty.active = body.active === true;
    if (!duty.active) await resolveSource(occurrenceKey(duty), { note: 'Duty paused' });
  }
  await duty.save();
  if (duty.active) await announce(duty);
  return (await dutyDtos([duty.toObject()]))[0];
}

/** Records a check (with photo evidence), closes this occurrence's task and announces the next. */
export async function recordCheck(actor, scope, id, body = {}) {
  requireProfile(actor);
  const duty = await SanitationDuty.findById(assertObjectId(id));
  // At OWN scope a person records checks only for the duties they own.
  if (!duty || (scope !== 'ALL' && String(duty.ownerProfileId) !== String(actor.profileId))) throw new AppError('Sanitation duty not found', 404);
  if (!duty.active) throw new AppError('This duty is paused.', 409, [], 'PAUSED');
  const evidence = cleanAttachments(body.evidence, actor);
  if (!evidence.length) throw new AppError('Attach a photo (or the service slip) as evidence of the check.', 400, [], 'EVIDENCE_REQUIRED');
  const done = new Set((Array.isArray(body.itemsDone) ? body.itemsDone : []).map(String));
  const items = duty.checklist.map((item) => ({ item, ok: done.has(item) }));
  const allOk = items.every((i) => i.ok);
  const note = optionalText(body.note, { max: 1000 }) || null;
  if (!allOk && !note) throw new AppError('Say what was not done (a note) when an item on the checklist is unticked.', 400, [], 'NOTE_REQUIRED');
  let stockAfter = null;
  if (body.stockAfter !== undefined && body.stockAfter !== null && body.stockAfter !== '') {
    stockAfter = Number.parseInt(body.stockAfter, 10);
    if (!Number.isInteger(stockAfter) || stockAfter < 0) throw new AppError('stockAfter must be a whole number', 400);
  }
  const check = await SanitationCheck.create({
    dutyId: duty._id, items, allOk, stockAfter, serviced: body.serviced === true, note, evidence, byProfileId: actor.profileId, byName: actor.displayName ?? null,
  });
  await resolveSource(occurrenceKey(duty), { note: `Check recorded${allOk ? '' : ' with gaps'}${note ? `: ${note}` : ''}` });
  duty.lastDoneAt = check.at;
  duty.nextDueAt = advance(duty.nextDueAt, duty);
  if (stockAfter !== null) duty.stockLevel = stockAfter;
  await duty.save();
  await announce(duty);
  await announceStock(duty);
  return { check: dto(check), duty: (await dutyDtos([duty.toObject()]))[0] };
}

export async function listChecks(actor, id) {
  requireStaff(actor);
  return (await SanitationCheck.find({ dutyId: assertObjectId(id) }).sort({ at: -1 }).limit(100).lean()).map(dto);
}

/**
 * Scheduler: every active duty has its current occurrence announced; an
 * occurrence completed from the Tasks screen is taken as a check and the duty
 * moves on.
 */
export async function syncDuties({ now = new Date() } = {}) {
  const duties = await SanitationDuty.find({ active: true });
  let announced = 0; let advanced = 0;
  for (const duty of duties) {
    // eslint-disable-next-line no-await-in-loop
    const task = await DueItem.findOne({ sourceKey: occurrenceKey(duty) }).lean();
    if (task?.status === 'DONE') {
      // eslint-disable-next-line no-await-in-loop
      await SanitationCheck.create({
        dutyId: duty._id, at: task.completedAt ?? now, items: duty.checklist.map((item) => ({ item, ok: true })), allOk: true,
        note: task.completionNote ?? 'Completed from the Tasks screen', evidence: task.evidence ?? [], byProfileId: task.completedByProfileId ?? null,
      });
      duty.lastDoneAt = task.completedAt ?? now;
      duty.nextDueAt = advance(duty.nextDueAt, duty, now);
      // eslint-disable-next-line no-await-in-loop
      await duty.save();
      advanced += 1;
    }
    // eslint-disable-next-line no-await-in-loop
    await announce(duty);
    announced += 1;
  }
  return { duties: duties.length, announced, advanced };
}

/** Open sanitation occurrences (for the map and the overview). */
export async function openSanitationTasks({ limit = 50 } = {}) {
  const rows = await DueItem.find({ sourceKey: { $regex: '^sanitation:' }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } })
    .sort({ dueAt: 1 }).limit(limit).select('refNo title dueAt status source').lean();
  return rows.map((t) => ({ id: String(t._id), refNo: t.refNo, title: t.title, dueAt: t.dueAt, status: t.status, overdue: new Date(t.dueAt) < new Date(), dutyId: t.source?.entityId ? String(t.source.entityId) : null }));
}
