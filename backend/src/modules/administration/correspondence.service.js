import { Correspondence, COUNTERPARTY_TYPES } from '../../models/administration.model.js';
import { AppError } from '../../utils/AppError.js';
import { createRequest, registerApprovalHandler } from '../approvals/approval.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, cleanAttachments,
  parseDate, requireText, optionalText, oneOf, dto, pageArgs, escapeRegex, startOfDayUtc, isObjectId,
} from '../ops/common.js';

/**
 * The inward/outward correspondence register.
 *
 * Inward: a circular from the board, a letter from the district education
 * office, a notice from the university is registered with its reference, date,
 * deadline and source; assigned to an owner; acknowledged; worked; replied to
 * (the reply needs principal approval before it goes); dispatched with
 * tracking; and closed only with evidence (delivery/acknowledgement) or an
 * explicit "no action needed" reason.
 *
 * Outward: a letter the institution originates follows the same draft →
 * approval → dispatch → acknowledgement path.
 */

const MACHINE = {
  DRAFT: ['AWAITING_APPROVAL', 'CLOSED'],
  RECEIVED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'NO_ACTION', 'REPLY_DRAFTED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'NO_ACTION', 'REPLY_DRAFTED'],
  IN_PROGRESS: ['REPLY_DRAFTED', 'NO_ACTION', 'CLOSED'],
  REPLY_DRAFTED: ['AWAITING_APPROVAL', 'IN_PROGRESS', 'REPLY_DRAFTED'],
  AWAITING_APPROVAL: ['APPROVED', 'REPLY_DRAFTED', 'DRAFT'],
  APPROVED: ['DISPATCHED', 'REPLY_DRAFTED', 'DRAFT'],
  DISPATCHED: ['CLOSED'],
  CLOSED: [],
  NO_ACTION: [],
};

const OPEN = ['DRAFT', 'RECEIVED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REPLY_DRAFTED', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHED'];

/** Who may see an item: ALL scope sees everything except RESTRICTED items they are not party to. */
function visibilityFilter(actor, scope) {
  const me = actor.profileId;
  const party = [{ ownerProfileId: me }, { assigneeProfileIds: me }];
  if (scope === 'ALL') {
    if (actor.roleKey === 'PRINCIPAL') return {};
    return { $or: [{ confidentiality: { $ne: 'RESTRICTED' } }, ...party] };
  }
  return { $or: party };
}

function canSee(doc, actor, scope) {
  const me = String(actor.profileId);
  const isParty = String(doc.ownerProfileId ?? '') === me || (doc.assigneeProfileIds ?? []).some((x) => String(x) === me);
  if (scope === 'ALL') return doc.confidentiality !== 'RESTRICTED' || isParty || actor.roleKey === 'PRINCIPAL';
  return isParty;
}

function present(doc) {
  const out = dto(doc);
  const now = new Date();
  out.isOpen = OPEN.includes(out.status);
  out.isOverdue = out.isOpen && out.dueOn ? new Date(out.dueOn) < startOfDayUtc(now) : false;
  out.daysToDue = out.dueOn ? Math.round((startOfDayUtc(new Date(out.dueOn)) - startOfDayUtc(now)) / 86_400_000) : null;
  out.latestDraft = out.drafts?.length ? out.drafts[out.drafts.length - 1] : null;
  return out;
}

async function load(id, actor, scope) {
  const doc = await Correspondence.findById(assertObjectId(id));
  if (!doc || !canSee(doc, actor, scope)) throw new AppError('Correspondence not found', 404);
  return doc;
}

function move(doc, actor, to, note) {
  assertTransition(MACHINE, doc.status, to, 'letter');
  const from = doc.status;
  doc.status = to;
  pushHistory(doc, actor, to, { from, to, note });
}

export async function register(actor, body = {}) {
  requireProfile(actor);
  const direction = oneOf(body.direction, ['INWARD', 'OUTWARD'], 'direction');
  const doc = new Correspondence({
    refNo: await nextRef(direction === 'INWARD' ? 'INW' : 'OUT'),
    direction,
    channel: oneOf(body.channel, ['POST', 'EMAIL', 'PORTAL', 'HAND', 'WHATSAPP', 'COURIER', 'OTHER'], 'channel', 'POST'),
    counterpartyType: oneOf(body.counterpartyType, COUNTERPARTY_TYPES, 'counterpartyType'),
    counterpartyName: requireText(body.counterpartyName, 'counterpartyName', { max: 200 }),
    theirReference: optionalText(body.theirReference, { max: 120 }) || null,
    subject: requireText(body.subject, 'subject', { max: 300 }),
    summary: optionalText(body.summary, { max: 10000 }) ?? '',
    topic: optionalText(body.topic, { max: 80 }) || null,
    receivedOn: direction === 'INWARD' ? (parseDate(body.receivedOn, 'receivedOn') ?? new Date()) : null,
    issuedOn: parseDate(body.issuedOn, 'issuedOn'),
    dueOn: parseDate(body.dueOn, 'dueOn'),
    campusCodes: Array.isArray(body.campusCodes) ? body.campusCodes.map((c) => String(c).slice(0, 20)) : [],
    confidentiality: oneOf(body.confidentiality, ['NORMAL', 'CONFIDENTIAL', 'RESTRICTED'], 'confidentiality', 'NORMAL'),
    attachments: cleanAttachments(body.attachments, actor),
    ownerProfileId: body.ownerProfileId && isObjectId(String(body.ownerProfileId)) ? body.ownerProfileId : actor.profileId,
    status: direction === 'INWARD' ? 'RECEIVED' : 'DRAFT',
    retentionUntil: parseDate(body.retentionUntil, 'retentionUntil'),
  });
  if (body.source && typeof body.source === 'object' && body.source.verified) {
    doc.source = { verified: true, method: optionalText(body.source.method, { max: 80 }) || 'unspecified', note: optionalText(body.source.note, { max: 500 }) || null, verifiedByProfileId: actor.profileId };
  }
  if (direction === 'OUTWARD' && body.body) {
    doc.drafts.push({ version: 1, body: optionalText(body.body, { max: 20000 }), byProfileId: actor.profileId, byName: actor.displayName });
  }
  if (body.inReplyToId) {
    const parent = await Correspondence.findById(assertObjectId(body.inReplyToId, 'inReplyToId'));
    if (parent) { doc.relatedIds.push(parent._id); parent.relatedIds.push(doc._id); await parent.save(); }
  }
  pushHistory(doc, actor, 'REGISTERED', { to: doc.status });
  await doc.save();
  if (String(doc.ownerProfileId) !== String(actor.profileId)) {
    await notify({ recipientProfileIds: [String(doc.ownerProfileId)], type: 'SYSTEM', title: `Letter assigned: ${doc.subject}`, body: `${doc.refNo} from ${doc.counterpartyName}`, link: `/correspondence?id=${doc._id}` });
  }
  return present(doc.toObject());
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = { ...visibilityFilter(actor, scope) };
  const and = [];
  if (query.direction) filter.direction = String(query.direction).toUpperCase();
  if (query.status === 'OPEN') filter.status = { $in: OPEN };
  else if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.counterpartyType) filter.counterpartyType = String(query.counterpartyType).toUpperCase();
  if (query.overdue === 'true') { filter.status = { $in: OPEN }; filter.dueOn = { $lt: startOfDayUtc() }; }
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q).slice(0, 100)), 'i');
    and.push({ $or: [{ subject: rx }, { summary: rx }, { counterpartyName: rx }, { refNo: rx }, { theirReference: rx }] });
  }
  if (and.length) filter.$and = and;
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    Correspondence.find(filter).sort({ dueOn: 1, createdAt: -1 }).skip(skip).limit(pageSize).select('-drafts -history').lean(),
    Correspondence.countDocuments(filter),
  ]);
  return { items: rows.map(present), total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function get(actor, scope, id) {
  requireProfile(actor);
  return present((await load(id, actor, scope)).toObject());
}

export async function assign(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  if (body.ownerProfileId) doc.ownerProfileId = assertObjectId(body.ownerProfileId, 'ownerProfileId');
  if (Array.isArray(body.assigneeProfileIds)) doc.assigneeProfileIds = body.assigneeProfileIds.map((x) => assertObjectId(x, 'assigneeProfileIds')).slice(0, 20);
  if (body.dueOn !== undefined) doc.dueOn = parseDate(body.dueOn, 'dueOn');
  pushHistory(doc, actor, 'ASSIGNED', { note: optionalText(body.note, { max: 500 }) });
  await doc.save();
  const who = [String(doc.ownerProfileId), ...doc.assigneeProfileIds.map(String)].filter((x) => x !== String(actor.profileId));
  await notify({ recipientProfileIds: who, type: 'SYSTEM', title: `Letter assigned: ${doc.subject}`, body: `${doc.refNo}${doc.dueOn ? ` · due ${doc.dueOn.toISOString().slice(0, 10)}` : ''}`, link: `/correspondence?id=${doc._id}` });
  return present(doc.toObject());
}

export async function verifySource(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  doc.source = { verified: true, method: requireText(body.method, 'method', { max: 80 }), note: optionalText(body.note, { max: 500 }) || null, verifiedByProfileId: actor.profileId };
  pushHistory(doc, actor, 'SOURCE_VERIFIED', { note: `${doc.source.method}${doc.source.note ? `: ${doc.source.note}` : ''}` });
  await doc.save();
  return present(doc.toObject());
}

export async function transition(actor, scope, id, { to, note } = {}) {
  const doc = await load(id, actor, scope);
  const target = oneOf(to, ['ACKNOWLEDGED', 'IN_PROGRESS', 'NO_ACTION'], 'to');
  if (target === 'NO_ACTION' && !optionalText(note)) throw new AppError('Say why no action is needed.', 400, [], 'REASON_REQUIRED');
  move(doc, actor, target, note);
  if (target === 'NO_ACTION') doc.resolution = optionalText(note, { max: 2000 });
  await doc.save();
  return present(doc.toObject());
}

/** Save a new version of the reply (inward) or the letter (outward). */
export async function saveDraft(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  const text = requireText(body.body, 'body', { max: 20000 });
  const next = doc.direction === 'INWARD' ? 'REPLY_DRAFTED' : 'DRAFT';
  if (doc.status === 'AWAITING_APPROVAL') throw new AppError('This reply is with the approver. Wait for a decision before editing it.', 409, [], 'IN_APPROVAL');
  // Editing an approved text voids the approval: what goes out must be what was approved.
  if (doc.status === 'APPROVED') doc.approvalRequestId = null;
  if (doc.status !== next) move(doc, actor, next, 'Draft saved');
  doc.drafts.push({ version: (doc.drafts.at(-1)?.version ?? 0) + 1, body: text, byProfileId: actor.profileId, byName: actor.displayName, aiAssisted: body.aiAssisted === true });
  await doc.save();
  return present(doc.toObject());
}

export async function submitForApproval(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  if (!doc.drafts.length) throw new AppError('Write the reply before sending it for approval.', 400);
  move(doc, actor, 'AWAITING_APPROVAL');
  await doc.save();
  const req = await createRequest(actor, {
    category: 'CORRESPONDENCE_REPLY',
    title: `${doc.direction === 'INWARD' ? 'Reply to' : 'Letter to'} ${doc.counterpartyName}: ${doc.subject}`.slice(0, 200),
    summary: `${doc.refNo}${doc.theirReference ? ` (their ref ${doc.theirReference})` : ''}\n\n${doc.drafts.at(-1).body}`.slice(0, 5000),
    dueAt: doc.dueOn ? new Date(doc.dueOn.getTime() - 86_400_000).toISOString() : undefined,
    priority: body.priority,
    attachments: doc.attachments.map((a) => ({ name: a.name, url: a.url })),
  }, { entityType: 'Correspondence', entityId: doc._id });
  doc.approvalRequestId = req.id;
  await doc.save();
  return present(doc.toObject());
}

registerApprovalHandler('Correspondence', {
  async onApproved(req, actor) {
    const doc = await Correspondence.findById(req.entityId);
    if (!doc) return;
    move(doc, actor, 'APPROVED', 'Approved for dispatch');
    await doc.save();
  },
  async onRejected(req, actor) {
    const doc = await Correspondence.findById(req.entityId);
    if (!doc) return;
    move(doc, actor, doc.direction === 'INWARD' ? 'REPLY_DRAFTED' : 'DRAFT', `Not approved: ${req.stages[req.currentStage]?.comment ?? ''}`);
    doc.approvalRequestId = null;
    await doc.save();
  },
  async onReturned(req, actor) {
    const doc = await Correspondence.findById(req.entityId);
    if (!doc) return;
    move(doc, actor, doc.direction === 'INWARD' ? 'REPLY_DRAFTED' : 'DRAFT', `Returned: ${req.stages[req.currentStage]?.comment ?? ''}`);
    doc.approvalRequestId = null;
    await doc.save();
  },
});

/** Record that the approved reply/letter went out. */
export async function dispatch(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  if (doc.status !== 'APPROVED') throw new AppError('Only an approved reply or letter can be dispatched.', 409, [], 'NOT_APPROVED');
  move(doc, actor, 'DISPATCHED', optionalText(body.note, { max: 500 }));
  doc.dispatch = {
    channel: oneOf(body.channel, ['POST', 'EMAIL', 'PORTAL', 'HAND', 'WHATSAPP', 'COURIER', 'OTHER'], 'channel'),
    at: parseDate(body.at, 'at') ?? new Date(),
    byProfileId: actor.profileId,
    trackingNo: optionalText(body.trackingNo, { max: 120 }) || null,
    deliveredAt: null,
    acknowledgement: null,
  };
  if (Array.isArray(body.attachments)) doc.attachments.push(...cleanAttachments(body.attachments, actor));
  await doc.save();
  return present(doc.toObject());
}

/** Delivery or acknowledgement evidence; closing needs this or an explicit resolution. */
export async function recordAcknowledgement(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  if (doc.status !== 'DISPATCHED') throw new AppError('Record an acknowledgement after dispatch.', 409);
  const ack = requireText(body.acknowledgement, 'acknowledgement', { max: 500 });
  doc.dispatch.deliveredAt = parseDate(body.deliveredAt, 'deliveredAt') ?? new Date();
  doc.dispatch.acknowledgement = ack;
  if (Array.isArray(body.attachments)) doc.attachments.push(...cleanAttachments(body.attachments, actor));
  pushHistory(doc, actor, 'ACKNOWLEDGED_BY_RECIPIENT', { note: ack });
  doc.markModified('dispatch');
  await doc.save();
  return present(doc.toObject());
}

export async function close(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  const resolution = requireText(body.resolution, 'resolution', { max: 2000 });
  if (doc.status === 'DISPATCHED' && !doc.dispatch?.acknowledgement && body.withoutAcknowledgement !== true) {
    throw new AppError('No delivery acknowledgement is recorded. Record it, or confirm closing without one.', 409, [], 'NO_ACKNOWLEDGEMENT');
  }
  move(doc, actor, 'CLOSED', resolution);
  doc.resolution = resolution;
  await doc.save();
  return present(doc.toObject());
}

export async function addReminder(actor, scope, id, body = {}) {
  const doc = await load(id, actor, scope);
  const at = parseDate(body.at, 'at', { required: true });
  doc.reminders.push({ at, note: optionalText(body.note, { max: 300 }) || null });
  pushHistory(doc, actor, 'REMINDER_SET', { note: at.toISOString().slice(0, 10) });
  await doc.save();
  return present(doc.toObject());
}

export async function setLegalHold(actor, scope, id, { hold } = {}) {
  const doc = await load(id, actor, scope);
  doc.legalHold = hold === true;
  pushHistory(doc, actor, doc.legalHold ? 'LEGAL_HOLD_ON' : 'LEGAL_HOLD_OFF');
  await doc.save();
  return present(doc.toObject());
}

/**
 * Sends reminders for open items due within `withinDays` (and overdue ones)
 * plus any explicit reminders whose time has come. Idempotent per item per
 * day, so running it twice (or on a schedule) does not double-send.
 */
export async function sendDueReminders(actor, { withinDays = 3, now = new Date() } = {}) {
  const horizon = new Date(startOfDayUtc(now).getTime() + (withinDays + 1) * 86_400_000);
  const due = await Correspondence.find({ status: { $in: OPEN }, dueOn: { $ne: null, $lt: horizon } }).lean();
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const doc of due) {
    const who = [doc.ownerProfileId, ...(doc.assigneeProfileIds ?? [])].filter(Boolean).map(String);
    // eslint-disable-next-line no-await-in-loop
    const r = await sendOperational({
      templateKey: 'DEADLINE_REMINDER', recipientProfileIds: who,
      variables: { title: `${doc.refNo} ${doc.subject}`.slice(0, 120), dueOn: doc.dueOn.toISOString().slice(0, 10) },
      link: `/correspondence?id=${doc._id}`, idempotencyKey: `corr-due:${doc._id}:${day}`,
      relatedEntityType: 'Correspondence', relatedEntityId: doc._id, requestedBy: actor?.profileId ?? null,
    });
    sent += r.filter((x) => !x.duplicate).length;
  }
  const explicit = await Correspondence.find({ 'reminders.at': { $lte: now }, 'reminders.sentAt': null });
  for (const doc of explicit) {
    for (const rem of doc.reminders) {
      if (rem.sentAt || rem.at > now) continue;
      const who = [doc.ownerProfileId, ...(doc.assigneeProfileIds ?? [])].filter(Boolean).map(String);
      // eslint-disable-next-line no-await-in-loop
      await notify({ recipientProfileIds: who, type: 'SYSTEM', title: `Reminder: ${doc.subject}`, body: rem.note ?? doc.refNo, link: `/correspondence?id=${doc._id}` });
      rem.sentAt = now;
      sent += who.length;
    }
    // eslint-disable-next-line no-await-in-loop
    await doc.save();
  }
  return { itemsDue: due.length, notified: sent };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ACTION_RX = /\b(shall|must|are (?:hereby )?(?:directed|requested|required)|is (?:hereby )?(?:directed|requested|required)|submit|furnish|upload|ensure|send|comply|report|attend|conduct|organi[sz]e|deposit|update)\b/i;

/**
 * Pulls candidate deadlines and action sentences out of a letter's text.
 * Deterministic and offline — it suggests, a person decides what to apply.
 */
export function extractTasks(text, receivedOn = new Date()) {
  const src = String(text ?? '').slice(0, 50000);
  const deadlines = [];
  const add = (date, match, index) => {
    if (!date || Number.isNaN(date.getTime())) return;
    const context = src.slice(Math.max(0, index - 80), Math.min(src.length, index + match.length + 80)).replace(/\s+/g, ' ').trim();
    deadlines.push({ date: date.toISOString().slice(0, 10), text: match, context });
  };
  for (const m of src.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    // Indian letters write day first.
    add(new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]))), m[0], m.index);
  }
  for (const m of src.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b/gi)) {
    add(new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]))), m[0], m.index);
  }
  for (const m of src.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) {
    add(new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]))), m[0], m.index);
  }
  for (const m of src.matchAll(/\bwithin\s+(\d{1,3})\s+(working\s+)?days\b/gi)) {
    add(new Date(startOfDayUtc(receivedOn).getTime() + Number(m[1]) * 86_400_000), m[0], m.index);
  }
  const actions = src.split(/(?<=[.;])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 15 && s.length < 400 && ACTION_RX.test(s)).slice(0, 15);
  const seen = new Set();
  const uniq = deadlines.filter((d) => { const k = `${d.date}|${d.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const today = startOfDayUtc(new Date());
  const upcoming = uniq.filter((d) => new Date(d.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
  return { deadlines: uniq, suggestedDueOn: upcoming[0]?.date ?? null, actions, method: 'pattern-matching (no AI); review before applying' };
}

export async function suggest(actor, scope, id) {
  const doc = await load(id, actor, scope);
  return extractTasks(`${doc.subject}\n${doc.summary}`, doc.receivedOn ?? doc.createdAt);
}

export async function stats(actor, scope) {
  const base = visibilityFilter(actor, scope);
  const today = startOfDayUtc();
  const in7 = new Date(today.getTime() + 8 * 86_400_000);
  const [open, overdue, dueSoon, awaitingApproval, toDispatch] = await Promise.all([
    Correspondence.countDocuments({ ...base, status: { $in: OPEN } }),
    Correspondence.countDocuments({ ...base, status: { $in: OPEN }, dueOn: { $lt: today } }),
    Correspondence.countDocuments({ ...base, status: { $in: OPEN }, dueOn: { $gte: today, $lt: in7 } }),
    Correspondence.countDocuments({ ...base, status: 'AWAITING_APPROVAL' }),
    Correspondence.countDocuments({ ...base, status: 'APPROVED' }),
  ]);
  return { open, overdue, dueSoon, awaitingApproval, toDispatch };
}
