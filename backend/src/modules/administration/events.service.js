import { InstitutionEvent, Contract } from '../../models/administration.model.js';
import { FacilityBooking, Facility } from '../../models/facility.model.js';
import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { AppError } from '../../utils/AppError.js';
import { createRequest, registerApprovalHandler } from '../approvals/approval.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, cleanAttachments, asPaise,
  parseDate, requireText, optionalText, oneOf, dto, pageArgs, startOfDayUtc,
} from '../ops/common.js';

/**
 * Institutional events and agreements.
 *
 * An event goes PROPOSED → (budget/principal approval) → APPROVED, at which
 * point its venue booking is confirmed and it is put on the school calendar;
 * then IN_PREPARATION (tasks), LIVE, COMPLETED (outcome recorded). A completed
 * event can seed a newsroom draft, which still goes through moderation — an
 * event outcome is never auto-published, and attendee lists never are.
 */

const EVENT_MACHINE = {
  PROPOSED: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'PROPOSED', 'REJECTED'],
  APPROVED: ['IN_PREPARATION', 'LIVE', 'CANCELLED'],
  IN_PREPARATION: ['LIVE', 'CANCELLED'],
  LIVE: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: ['PROPOSED'],
};
const EVENT_KINDS = ['FEST', 'CEREMONY', 'SPORTS', 'CULTURAL', 'COMPETITION', 'MEETING', 'PTM', 'VISIT', 'TRIP', 'WORKSHOP', 'OTHER'];

function presentEvent(e) {
  const out = dto(e);
  out.tasksDone = (out.tasks ?? []).filter((t) => t.status === 'DONE').length;
  out.tasksTotal = (out.tasks ?? []).length;
  out.readiness = out.tasksTotal ? Math.round((out.tasksDone / out.tasksTotal) * 100) : null;
  out.budgetVariancePaise = out.actualSpendPaise - out.budgetPaise;
  return out;
}

function move(ev, actor, to, note) {
  assertTransition(EVENT_MACHINE, ev.status, to, 'event');
  pushHistory(ev, actor, to, { from: ev.status, to, note });
  ev.status = to;
}

/** Same-time events and academic calendar entries (exams, holidays) to warn about. */
async function detectConflicts(startsAt, endsAt, excludeId = null) {
  const [events, calendar] = await Promise.all([
    InstitutionEvent.find({ status: { $in: ['PENDING_APPROVAL', 'APPROVED', 'IN_PREPARATION', 'LIVE'] }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('title').lean(),
    CalendarEvent.find({ deletedAt: null, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt }, type: { $in: ['EXAM', 'HOLIDAY'] } }).select('title type').lean(),
  ]);
  return [
    ...events.map((e) => `Overlaps event "${e.title}"`),
    ...calendar.map((c) => `Overlaps ${c.type.toLowerCase()} "${c.title}"`),
  ];
}

export async function proposeEvent(actor, body = {}) {
  requireProfile(actor);
  const startsAt = parseDate(body.startsAt, 'startsAt', { required: true });
  const endsAt = parseDate(body.endsAt, 'endsAt', { required: true });
  if (endsAt <= startsAt) throw new AppError('endsAt must be after startsAt', 400);
  const budgetLines = Array.isArray(body.budgetLines)
    ? body.budgetLines.slice(0, 40).map((l) => ({ head: requireText(l.head, 'budget head', { max: 80 }), amountPaise: asPaise(l.amountPaise, 'budget amount') }))
    : [];
  const facilityId = body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : null;
  if (facilityId && !(await Facility.exists({ _id: facilityId }))) throw new AppError('Venue not found', 404);
  const ev = new InstitutionEvent({
    refNo: await nextRef('EVT'),
    title: requireText(body.title, 'title', { max: 160 }),
    kind: oneOf(body.kind, EVENT_KINDS, 'kind'),
    description: optionalText(body.description, { max: 5000 }) ?? '',
    startsAt, endsAt, facilityId,
    venueText: optionalText(body.venueText, { max: 200 }) || null,
    campusCode: optionalText(body.campusCode, { max: 20 }) || null,
    audience: oneOf(body.audience, ['INSTITUTION', 'STUDENTS', 'PARENTS', 'STAFF', 'PUBLIC', 'INVITED'], 'audience', 'INSTITUTION'),
    expectedAttendance: Math.max(0, Number.parseInt(body.expectedAttendance, 10) || 0),
    budgetLines,
    budgetPaise: budgetLines.reduce((n, l) => n + l.amountPaise, 0),
    consentRequired: body.consentRequired === true,
    safetyPlan: optionalText(body.safetyPlan, { max: 4000 }) || null,
    accessibilityPlan: optionalText(body.accessibilityPlan, { max: 4000 }) || null,
    transportPlan: optionalText(body.transportPlan, { max: 2000 }) || null,
    guests: Array.isArray(body.guests) ? body.guests.slice(0, 50).map((g) => ({ name: String(g.name ?? '').slice(0, 120), organisation: String(g.organisation ?? '').slice(0, 120), role: String(g.role ?? '').slice(0, 80) })) : [],
    organiserProfileId: actor.profileId,
    organiserName: actor.displayName,
  });
  ev.conflicts = await detectConflicts(startsAt, endsAt);
  if (facilityId) {
    const f = await Facility.findById(facilityId).select('capacity name').lean();
    if (f?.capacity && ev.expectedAttendance > f.capacity) ev.conflicts.push(`${f.name} holds ${f.capacity}; ${ev.expectedAttendance} expected`);
  }
  pushHistory(ev, actor, 'PROPOSED', { to: 'PROPOSED' });
  await ev.save();
  return presentEvent(ev.toObject());
}

async function loadEvent(id) {
  const ev = await InstitutionEvent.findById(assertObjectId(id));
  if (!ev) throw new AppError('Event not found', 404);
  return ev;
}

function assertOrganiserOrManager(ev, actor) {
  if (String(ev.organiserProfileId) !== String(actor.profileId) && !actor.permissions?.['events.manage']) {
    throw new AppError('Only the organiser or the events team can change this event.', 403);
  }
}

export async function submitEvent(actor, id) {
  const ev = await loadEvent(id);
  assertOrganiserOrManager(ev, actor);
  if (ev.facilityId && !ev.bookingId) {
    const b = await FacilityBooking.create({
      facilityId: ev.facilityId, title: ev.title, purpose: `Event ${ev.refNo}`, startsAt: ev.startsAt, endsAt: ev.endsAt,
      attendees: ev.expectedAttendance || null, bookedByProfileId: actor.profileId, bookedByName: actor.displayName, status: 'REQUESTED', eventId: ev._id,
    });
    ev.bookingId = b._id;
  }
  move(ev, actor, 'PENDING_APPROVAL');
  await ev.save();
  const req = await createRequest(actor, {
    category: 'EVENT', title: `Event: ${ev.title}`, amountPaise: ev.budgetPaise,
    summary: [
      `${ev.refNo} · ${ev.kind} · ${ev.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      `Expected attendance ${ev.expectedAttendance}. Budget ₹${(ev.budgetPaise / 100).toFixed(2)}.`,
      ev.consentRequired ? 'Guardian consent required.' : '',
      ev.conflicts.length ? `Conflicts: ${ev.conflicts.join('; ')}` : 'No calendar conflicts found.',
      ev.safetyPlan ? `Safety: ${ev.safetyPlan}` : 'No safety plan recorded.',
    ].filter(Boolean).join('\n'),
    dueAt: new Date(Math.max(Date.now() + 86_400_000, ev.startsAt.getTime() - 3 * 86_400_000)).toISOString(),
  }, { entityType: 'InstitutionEvent', entityId: ev._id });
  ev.approvalRequestId = req.id;
  await ev.save();
  return presentEvent(ev.toObject());
}

registerApprovalHandler('InstitutionEvent', {
  async onApproved(req, actor) {
    const ev = await InstitutionEvent.findById(req.entityId);
    if (!ev) return;
    move(ev, actor, 'APPROVED');
    if (ev.bookingId) await FacilityBooking.updateOne({ _id: ev.bookingId, status: 'REQUESTED' }, { $set: { status: 'CONFIRMED', decidedByProfileId: actor.profileId, decisionNote: `Approved with event ${ev.refNo}` } });
    const cal = await CalendarEvent.create({
      title: ev.title, description: ev.description, type: ev.kind === 'SPORTS' ? 'SPORTS' : ev.kind === 'PTM' ? 'PTM' : 'EVENT',
      startsAt: ev.startsAt, endsAt: ev.endsAt, createdByProfileId: ev.organiserProfileId,
      audience: ev.audience === 'STAFF' ? { roles: ['ADMIN', 'PRINCIPAL', 'TEACHER'] } : { all: true },
    });
    ev.calendarEventId = cal._id;
    await ev.save();
    await notify({ recipientProfileIds: [String(ev.organiserProfileId)], type: 'SYSTEM', title: `Event approved: ${ev.title}`, body: 'Venue confirmed and added to the calendar.', link: `/events?id=${ev._id}` });
  },
  async onRejected(req, actor) {
    const ev = await InstitutionEvent.findById(req.entityId);
    if (!ev) return;
    move(ev, actor, 'REJECTED', req.stages[req.currentStage]?.comment);
    if (ev.bookingId) await FacilityBooking.updateOne({ _id: ev.bookingId, status: 'REQUESTED' }, { $set: { status: 'CANCELLED' } });
    ev.bookingId = null;
    await ev.save();
  },
  async onReturned(req, actor) {
    const ev = await InstitutionEvent.findById(req.entityId);
    if (!ev) return;
    move(ev, actor, 'PROPOSED', req.stages[req.currentStage]?.comment);
    ev.approvalRequestId = null;
    await ev.save();
  },
});

export async function updateEvent(actor, id, body = {}) {
  const ev = await loadEvent(id);
  assertOrganiserOrManager(ev, actor);
  if (['COMPLETED', 'CANCELLED'].includes(ev.status)) throw new AppError('This event is closed.', 409);
  const planningOnly = ev.status !== 'PROPOSED' && ev.status !== 'REJECTED';
  if (!planningOnly) {
    for (const f of ['title', 'description', 'venueText', 'safetyPlan', 'accessibilityPlan', 'transportPlan']) {
      if (body[f] !== undefined) ev[f] = f === 'title' ? requireText(body[f], 'title', { max: 160 }) : optionalText(body[f], { max: 5000 }) || null;
    }
    if (Array.isArray(body.budgetLines)) {
      ev.budgetLines = body.budgetLines.slice(0, 40).map((l) => ({ head: requireText(l.head, 'budget head', { max: 80 }), amountPaise: asPaise(l.amountPaise) }));
      ev.budgetPaise = ev.budgetLines.reduce((n, l) => n + l.amountPaise, 0);
    }
    if (body.expectedAttendance !== undefined) ev.expectedAttendance = Math.max(0, Number.parseInt(body.expectedAttendance, 10) || 0);
  }
  // Tasks, run sheet, consents and spend are tracked through preparation.
  if (Array.isArray(body.tasks)) {
    ev.tasks = body.tasks.slice(0, 200).map((t) => ({
      title: requireText(t.title, 'task title', { max: 160 }),
      department: optionalText(t.department, { max: 60 }) || null,
      ownerProfileId: t.ownerProfileId ? assertObjectId(t.ownerProfileId) : null,
      ownerName: optionalText(t.ownerName, { max: 120 }) || null,
      dueOn: parseDate(t.dueOn, 'task dueOn'),
      status: oneOf(t.status, ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'], 'task status', 'TODO'),
    }));
  }
  if (Array.isArray(body.runSheet)) ev.runSheet = body.runSheet.slice(0, 100).map((r) => ({ at: parseDate(r.at, 'run sheet time'), item: String(r.item ?? '').slice(0, 200), owner: String(r.owner ?? '').slice(0, 120) }));
  if (body.consentsReceived !== undefined) ev.consentsReceived = Math.max(0, Number.parseInt(body.consentsReceived, 10) || 0);
  if (body.actualSpendPaise !== undefined) ev.actualSpendPaise = asPaise(body.actualSpendPaise, 'actualSpendPaise');
  pushHistory(ev, actor, 'UPDATED');
  await ev.save();
  return presentEvent(ev.toObject());
}

export async function moveEvent(actor, id, { to, note } = {}) {
  const ev = await loadEvent(id);
  assertOrganiserOrManager(ev, actor);
  const target = oneOf(to, ['IN_PREPARATION', 'LIVE', 'CANCELLED'], 'to');
  if (target === 'CANCELLED' && !optionalText(note)) throw new AppError('Give a reason for cancelling.', 400, [], 'REASON_REQUIRED');
  move(ev, actor, target, note);
  if (target === 'CANCELLED') {
    if (ev.bookingId) await FacilityBooking.updateOne({ _id: ev.bookingId }, { $set: { status: 'CANCELLED' } });
    if (ev.calendarEventId) await CalendarEvent.updateOne({ _id: ev.calendarEventId }, { $set: { deletedAt: new Date() } });
  }
  await ev.save();
  return presentEvent(ev.toObject());
}

export async function completeEvent(actor, id, body = {}) {
  const ev = await loadEvent(id);
  assertOrganiserOrManager(ev, actor);
  move(ev, actor, 'COMPLETED');
  ev.outcome = {
    summary: requireText(body.summary, 'summary', { max: 5000 }),
    attendance: body.attendance === undefined ? null : Math.max(0, Number.parseInt(body.attendance, 10) || 0),
    highlights: Array.isArray(body.highlights) ? body.highlights.map((h) => String(h).slice(0, 300)).slice(0, 20) : [],
  };
  if (body.actualSpendPaise !== undefined) ev.actualSpendPaise = asPaise(body.actualSpendPaise);
  await ev.save();
  return presentEvent(ev.toObject());
}

export async function listEvents(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.upcoming === 'true') filter.startsAt = { $gte: startOfDayUtc() };
  if (query.mine === 'true') filter.organiserProfileId = actor.profileId;
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    InstitutionEvent.find(filter).sort({ startsAt: query.upcoming === 'true' ? 1 : -1 }).skip(skip).limit(pageSize).select('-history').lean(),
    InstitutionEvent.countDocuments(filter),
  ]);
  return { items: rows.map(presentEvent), total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function getEvent(actor, id) {
  requireProfile(actor);
  return presentEvent((await loadEvent(id)).toObject());
}

// ── Agreements ────────────────────────────────────────────────────────────

const CONTRACT_MACHINE = {
  REQUESTED: ['DRAFTING', 'REJECTED'],
  DRAFTING: ['UNDER_REVIEW', 'AWAITING_APPROVAL'],
  UNDER_REVIEW: ['DRAFTING', 'AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['APPROVED', 'DRAFTING', 'REJECTED'],
  APPROVED: ['EXECUTED', 'DRAFTING'],
  EXECUTED: ['ACTIVE'],
  ACTIVE: ['EXPIRED', 'TERMINATED'],
  EXPIRED: ['ACTIVE'],
  TERMINATED: [],
  REJECTED: ['DRAFTING'],
};

function presentContract(c, now = new Date()) {
  const out = dto(c);
  if (c.endsOn) {
    const days = Math.round((startOfDayUtc(new Date(c.endsOn)) - startOfDayUtc(now)) / 86_400_000);
    out.daysToExpiry = days;
    out.noticeDeadline = new Date(new Date(c.endsOn).getTime() - (c.noticePeriodDays ?? 0) * 86_400_000);
    out.renewalAttention = ['ACTIVE', 'EXECUTED'].includes(c.status) && days <= (c.noticePeriodDays ?? 30) + 15;
  }
  out.openObligations = (c.obligations ?? []).filter((o) => !o.done).length;
  return out;
}

function moveContract(c, actor, to, note) {
  assertTransition(CONTRACT_MACHINE, c.status, to, 'agreement');
  pushHistory(c, actor, to, { from: c.status, to, note });
  c.status = to;
}

export async function createContract(actor, body = {}) {
  requireProfile(actor);
  const c = new Contract({
    refNo: await nextRef('AGR'),
    title: requireText(body.title, 'title', { max: 200 }),
    kind: oneOf(body.kind, ['VENDOR', 'SERVICE', 'STAFF', 'LEASE', 'TRANSPORT', 'FACILITIES', 'MOU', 'PARTNERSHIP', 'OTHER'], 'kind'),
    counterparty: requireText(body.counterparty, 'counterparty', { max: 200 }),
    valuePaise: asPaise(body.valuePaise ?? 0, 'valuePaise'),
    startsOn: parseDate(body.startsOn, 'startsOn'),
    endsOn: parseDate(body.endsOn, 'endsOn'),
    noticePeriodDays: Math.max(0, Math.min(Number.parseInt(body.noticePeriodDays, 10) || 30, 365)),
    autoRenews: body.autoRenews === true,
    ownerProfileId: actor.profileId,
    attachments: cleanAttachments(body.attachments, actor),
    status: body.draft === true ? 'DRAFTING' : 'REQUESTED',
  });
  pushHistory(c, actor, 'CREATED', { to: c.status });
  await c.save();
  return presentContract(c.toObject());
}

export async function updateContract(actor, id, body = {}) {
  const c = await Contract.findById(assertObjectId(id));
  if (!c) throw new AppError('Agreement not found', 404);
  for (const f of ['title', 'counterparty']) if (body[f] !== undefined) c[f] = requireText(body[f], f, { max: 200 });
  if (body.legalReviewNote !== undefined) c.legalReviewNote = optionalText(body.legalReviewNote, { max: 4000 }) || null;
  if (body.signatureMethod !== undefined) c.signatureMethod = body.signatureMethod ? oneOf(body.signatureMethod, ['WET_INK', 'AADHAAR_ESIGN', 'DSC', 'OTHER'], 'signatureMethod') : null;
  for (const f of ['startsOn', 'endsOn']) if (body[f] !== undefined) c[f] = parseDate(body[f], f);
  if (body.noticePeriodDays !== undefined) c.noticePeriodDays = Math.max(0, Math.min(Number.parseInt(body.noticePeriodDays, 10) || 0, 365));
  if (body.valuePaise !== undefined) {
    if (['AWAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'ACTIVE'].includes(c.status)) throw new AppError('The value of an agreement in or past approval cannot change; start a new version.', 409);
    c.valuePaise = asPaise(body.valuePaise);
  }
  if (Array.isArray(body.obligations)) {
    c.obligations = body.obligations.slice(0, 100).map((o) => ({ title: requireText(o.title, 'obligation', { max: 200 }), dueOn: parseDate(o.dueOn, 'obligation due'), ownerProfileId: o.ownerProfileId ? assertObjectId(o.ownerProfileId) : null, done: o.done === true }));
  }
  if (body.newVersionUrl) {
    c.versions.push({ version: (c.versions.at(-1)?.version ?? 0) + 1, url: String(body.newVersionUrl).slice(0, 1000), note: optionalText(body.versionNote, { max: 500 }) || null });
  }
  if (Array.isArray(body.attachments)) c.attachments.push(...cleanAttachments(body.attachments, actor));
  if (body.to) {
    const to = oneOf(body.to, ['DRAFTING', 'UNDER_REVIEW', 'EXECUTED', 'ACTIVE', 'EXPIRED', 'TERMINATED'], 'to');
    if (to === 'EXECUTED') {
      if (!c.signatureMethod) throw new AppError('Record how the agreement was signed before marking it executed.', 400);
      c.executedOn = parseDate(body.executedOn, 'executedOn') ?? new Date();
    }
    if (to === 'TERMINATED') c.terminatedOn = new Date();
    moveContract(c, actor, to, body.note);
  } else pushHistory(c, actor, 'UPDATED');
  await c.save();
  return presentContract(c.toObject());
}

export async function submitContract(actor, id) {
  const c = await Contract.findById(assertObjectId(id));
  if (!c) throw new AppError('Agreement not found', 404);
  moveContract(c, actor, 'AWAITING_APPROVAL');
  await c.save();
  const req = await createRequest(actor, {
    category: 'CONTRACT', title: `Agreement: ${c.title} with ${c.counterparty}`, amountPaise: c.valuePaise,
    summary: `${c.refNo} · ${c.kind} · ${c.startsOn ? c.startsOn.toISOString().slice(0, 10) : '—'} to ${c.endsOn ? c.endsOn.toISOString().slice(0, 10) : 'open-ended'}${c.legalReviewNote ? `\nReview: ${c.legalReviewNote}` : '\nNo legal review note recorded.'}`,
    attachments: c.attachments.map((a) => ({ name: a.name, url: a.url })),
  }, { entityType: 'Contract', entityId: c._id });
  c.approvalRequestId = req.id;
  await c.save();
  return presentContract(c.toObject());
}

registerApprovalHandler('Contract', {
  async onApproved(req, actor) {
    const c = await Contract.findById(req.entityId); if (!c) return;
    moveContract(c, actor, 'APPROVED'); await c.save();
  },
  async onRejected(req, actor) {
    const c = await Contract.findById(req.entityId); if (!c) return;
    moveContract(c, actor, 'REJECTED', req.stages[req.currentStage]?.comment); await c.save();
  },
  async onReturned(req, actor) {
    const c = await Contract.findById(req.entityId); if (!c) return;
    moveContract(c, actor, 'DRAFTING', req.stages[req.currentStage]?.comment); c.approvalRequestId = null; await c.save();
  },
});

export async function listContracts(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.expiringWithinDays) {
    const days = Math.min(Number(query.expiringWithinDays) || 60, 730);
    filter.endsOn = { $lte: new Date(Date.now() + days * 86_400_000) };
    filter.status = { $in: ['ACTIVE', 'EXECUTED'] };
  }
  const rows = await Contract.find(filter).sort({ endsOn: 1 }).limit(500).select('-history').lean();
  return rows.map((c) => presentContract(c));
}

export async function getContract(actor, id) {
  requireProfile(actor);
  const c = await Contract.findById(assertObjectId(id)).lean();
  if (!c) throw new AppError('Agreement not found', 404);
  return presentContract(c);
}
