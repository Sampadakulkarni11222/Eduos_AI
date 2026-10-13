import { BoardMeeting } from '../../models/governance.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto,
} from '../ops/common.js';

/**
 * Governance meetings: scheduling by availability, agenda and papers, RSVPs,
 * quorum, attendance, conflict declarations, minutes, resolutions with votes,
 * and the actions that follow — with WhatsApp updates to members who opted in.
 *
 * Visibility: governance.read at ALL scope sees every meeting; at OWN scope (a
 * trustee) only meetings they are a member of. Papers are links into the ERP,
 * never attached to WhatsApp messages.
 */

const BODIES = ['TRUST_BOARD', 'SCHOOL_MANAGEMENT_COMMITTEE', 'GOVERNING_BODY', 'ACADEMIC_COUNCIL', 'IQAC', 'FINANCE_COMMITTEE', 'PURCHASE_COMMITTEE', 'PTA_EXECUTIVE', 'OTHER'];
const BODY_LABEL = { TRUST_BOARD: 'Board', SCHOOL_MANAGEMENT_COMMITTEE: 'SMC', GOVERNING_BODY: 'Governing Body', ACADEMIC_COUNCIL: 'Academic Council', IQAC: 'IQAC', FINANCE_COMMITTEE: 'Finance Committee', PURCHASE_COMMITTEE: 'Purchase Committee', PTA_EXECUTIVE: 'PTA', OTHER: 'Committee' };
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');

function isMember(m, actor) {
  return (m.members ?? []).some((x) => String(x.profileId ?? '') === String(actor.profileId));
}

function present(m, actor) {
  const out = dto(m);
  const present = (m.members ?? []).filter((x) => x.attended === true && x.voting).length;
  out.presentVoting = present;
  out.quorumMet = m.quorum ? present >= m.quorum : null;
  out.accepted = (m.members ?? []).filter((x) => x.rsvp === 'ACCEPTED').length;
  out.openActions = (m.actions ?? []).filter((a) => a.status === 'OPEN').length;
  out.isMember = actor ? isMember(m, actor) : false;
  return out;
}

async function load(id, actor, scope) {
  const m = await BoardMeeting.findById(assertObjectId(id));
  if (!m || (scope !== 'ALL' && !isMember(m, actor))) throw new AppError('Meeting not found', 404);
  return m;
}

const memberIds = (m) => (m.members ?? []).map((x) => x.profileId).filter(Boolean).map(String);

export async function create(actor, body = {}) {
  requireProfile(actor);
  const tenantId = currentTenantId();
  const memberProfileIds = Array.isArray(body.memberProfileIds) ? body.memberProfileIds.map((x) => assertObjectId(x, 'memberProfileIds')) : [];
  const people = await Profile.find({ _id: { $in: memberProfileIds }, ...(tenantId ? { tenantId } : {}) }).select('_id displayName').lean();
  if (people.length !== memberProfileIds.length) throw new AppError('Some members are not people in this school', 404);
  const roles = body.memberRoles ?? {};
  const m = new BoardMeeting({
    refNo: await nextRef('MTG'),
    body: oneOf(body.body, BODIES, 'body'),
    title: requireText(body.title, 'title', { max: 200 }),
    durationMinutes: Math.max(15, Math.min(Number.parseInt(body.durationMinutes, 10) || 90, 600)),
    mode: oneOf(body.mode, ['IN_PERSON', 'ONLINE', 'HYBRID'], 'mode', 'IN_PERSON'),
    location: optionalText(body.location, { max: 200 }) || null,
    meetingLink: optionalText(body.meetingLink, { max: 500 }) || null,
    quorum: body.quorum ? Math.max(1, Number.parseInt(body.quorum, 10) || 1) : null,
    members: [
      ...people.map((p) => ({ profileId: p._id, name: p.displayName, role: oneOf(roles[String(p._id)], ['CHAIR', 'SECRETARY', 'MEMBER', 'INVITEE'], 'member role', 'MEMBER'), voting: roles[String(p._id)] !== 'INVITEE' })),
      ...(Array.isArray(body.externalMembers) ? body.externalMembers.slice(0, 30).map((x) => ({ name: requireText(x.name, 'member name', { max: 120 }), role: oneOf(x.role, ['CHAIR', 'SECRETARY', 'MEMBER', 'INVITEE'], 'member role', 'MEMBER'), voting: x.voting !== false })) : []),
    ],
    proposedSlots: Array.isArray(body.proposedSlots) ? body.proposedSlots.slice(0, 10).map((s) => ({ at: parseDate(s, 'proposedSlots', { required: true }), available: [] })) : [],
    organiserProfileId: actor.profileId,
  });
  if (body.scheduledAt) { m.scheduledAt = parseDate(body.scheduledAt, 'scheduledAt'); m.status = 'SCHEDULED'; }
  pushHistory(m, actor, 'CREATED');
  await m.save();
  const ids = memberIds(m).filter((x) => x !== String(actor.profileId));
  if (m.status === 'SCHEDULED') {
    await sendOperational({ templateKey: 'MEETING_SCHEDULED', recipientProfileIds: ids, variables: { body: BODY_LABEL[m.body], title: m.title, when: fmt(m.scheduledAt) }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:scheduled:${m.scheduledAt.toISOString()}`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id, requestedBy: actor.profileId });
  } else if (m.proposedSlots.length) {
    await notify({ recipientProfileIds: ids, type: 'SYSTEM', title: `When can you attend? ${m.title}`, body: `${m.proposedSlots.length} proposed times`, link: `/governance?id=${m._id}` });
  }
  return present(m.toObject(), actor);
}

export async function markAvailability(actor, scope, id, { slotIndexes = [] } = {}) {
  const m = await load(id, actor, scope);
  if (!isMember(m, actor)) throw new AppError('Only members mark availability.', 403);
  m.proposedSlots.forEach((s, i) => {
    s.available = s.available.filter((x) => String(x) !== String(actor.profileId));
    if (slotIndexes.includes(i)) s.available.push(actor.profileId);
  });
  m.markModified('proposedSlots');
  await m.save();
  return present(m.toObject(), actor);
}

export async function schedule(actor, scope, id, body = {}) {
  const m = await load(id, actor, scope);
  const at = body.slotIndex !== undefined ? m.proposedSlots[Number(body.slotIndex)]?.at : parseDate(body.scheduledAt, 'scheduledAt', { required: true });
  if (!at) throw new AppError('Choose a slot or a time.', 400);
  const changed = m.scheduledAt && m.scheduledAt.getTime() !== new Date(at).getTime();
  m.scheduledAt = at;
  m.status = 'SCHEDULED';
  if (body.location !== undefined) m.location = optionalText(body.location, { max: 200 }) || null;
  if (body.meetingLink !== undefined) m.meetingLink = optionalText(body.meetingLink, { max: 500 }) || null;
  pushHistory(m, actor, changed ? 'RESCHEDULED' : 'SCHEDULED', { note: fmt(at) });
  await m.save();
  await sendOperational({ templateKey: 'MEETING_SCHEDULED', recipientProfileIds: memberIds(m).filter((x) => x !== String(actor.profileId)), variables: { body: BODY_LABEL[m.body], title: m.title, when: fmt(at) }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:scheduled:${new Date(at).toISOString()}`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id, requestedBy: actor.profileId });
  return present(m.toObject(), actor);
}

export async function setAgenda(actor, scope, id, body = {}) {
  const m = await load(id, actor, scope);
  if (m.agendaStatus === 'CIRCULATED' && body.force !== true) throw new AppError('The agenda has been circulated. Re-circulate with changes explicitly.', 409, [], 'AGENDA_CIRCULATED');
  if (Array.isArray(body.items)) {
    m.agenda = body.items.slice(0, 40).map((it, i) => ({
      order: i + 1, title: requireText(it.title, 'agenda item', { max: 300 }), presenter: optionalText(it.presenter, { max: 120 }) || null,
      decisionNeeded: it.decisionNeeded === true, papers: cleanAttachments(it.papers, actor), notes: optionalText(it.notes, { max: 4000 }) || null,
    }));
    m.agendaStatus = 'DRAFT';
  }
  if (body.status) {
    const to = oneOf(body.status, ['APPROVED', 'CIRCULATED'], 'status');
    if (!m.agenda.length) throw new AppError('Add agenda items first.', 400);
    m.agendaStatus = to;
    if (to === 'CIRCULATED') {
      await sendOperational({ templateKey: 'MEETING_REMINDER', recipientProfileIds: memberIds(m).filter((x) => x !== String(actor.profileId)), variables: { title: `${m.title} — agenda`, when: fmt(m.scheduledAt) || 'date to be confirmed' }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:agenda:${m.agenda.length}:${Date.now() - (Date.now() % 60_000)}`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id, requestedBy: actor.profileId });
    }
  }
  pushHistory(m, actor, `AGENDA_${m.agendaStatus}`);
  await m.save();
  return present(m.toObject(), actor);
}

export async function rsvp(actor, scope, id, body = {}) {
  const m = await load(id, actor, scope);
  const me = m.members.find((x) => String(x.profileId ?? '') === String(actor.profileId));
  if (!me) throw new AppError('Only members can respond.', 403);
  me.rsvp = oneOf(body.rsvp, ['ACCEPTED', 'DECLINED', 'TENTATIVE'], 'rsvp');
  if (Array.isArray(body.conflicts)) {
    me.conflicts = body.conflicts.slice(0, 20).map((c) => ({ agendaOrder: Number(c.agendaOrder), declaration: requireText(c.declaration, 'declaration', { max: 1000 }) }));
  }
  m.markModified('members');
  await m.save();
  return present(m.toObject(), actor);
}

/** Attendance, minutes, resolutions and actions — recorded by the secretary/organiser. */
export async function record(actor, scope, id, body = {}) {
  const m = await load(id, actor, scope);
  if (m.status === 'CANCELLED') throw new AppError('This meeting was cancelled.', 409);
  if (Array.isArray(body.attendance)) {
    for (const a of body.attendance) {
      const mem = m.members.id(a.memberId);
      if (mem) mem.attended = a.attended === true;
    }
    if (m.status === 'SCHEDULED') { m.status = 'HELD'; pushHistory(m, actor, 'HELD'); }
  }
  if (body.minutes !== undefined) {
    if (m.minutes.status === 'APPROVED') throw new AppError('Approved minutes cannot be edited.', 409, [], 'MINUTES_LOCKED');
    m.minutes.body = requireText(body.minutes, 'minutes', { max: 100000 });
    m.minutes.status = 'DRAFT';
  }
  if (Array.isArray(body.resolutions)) {
    if (m.quorum && m.members.filter((x) => x.attended && x.voting).length < m.quorum) {
      throw new AppError('Quorum was not met; resolutions cannot be recorded as passed.', 409, [], 'NO_QUORUM');
    }
    m.resolutions = body.resolutions.slice(0, 50).map((r, i) => {
      const forV = Math.max(0, Number(r.votesFor) || 0);
      const against = Math.max(0, Number(r.votesAgainst) || 0);
      const outcome = oneOf(r.outcome, ['PASSED', 'FAILED', 'DEFERRED', 'WITHDRAWN'], 'outcome', forV > against ? 'PASSED' : 'FAILED');
      if (outcome === 'PASSED' && forV <= against) throw new AppError(`Resolution ${i + 1} cannot pass with ${forV} for and ${against} against.`, 400);
      return { number: optionalText(r.number, { max: 30 }) || `${m.refNo}/R${i + 1}`, agendaOrder: r.agendaOrder ? Number(r.agendaOrder) : null, text: requireText(r.text, 'resolution text', { max: 4000 }), proposer: optionalText(r.proposer, { max: 120 }) || null, seconder: optionalText(r.seconder, { max: 120 }) || null, votesFor: forV, votesAgainst: against, abstentions: Math.max(0, Number(r.abstentions) || 0), outcome };
    });
  }
  if (Array.isArray(body.actions)) {
    m.actions = body.actions.slice(0, 100).map((a) => ({ title: requireText(a.title, 'action', { max: 300 }), ownerProfileId: a.ownerProfileId ? assertObjectId(a.ownerProfileId) : null, ownerName: optionalText(a.ownerName, { max: 120 }) || null, dueOn: parseDate(a.dueOn, 'action dueOn'), status: oneOf(a.status, ['OPEN', 'DONE', 'DROPPED'], 'action status', 'OPEN'), resolutionNumber: optionalText(a.resolutionNumber, { max: 30 }) || null }));
  }
  pushHistory(m, actor, 'RECORDED');
  m.markModified('members');
  await m.save();
  return present(m.toObject(), actor);
}

/** Minutes are approved by the chair (or the principal), not by whoever drafted them. */
export async function approveMinutes(actor, scope, id) {
  const m = await load(id, actor, scope);
  if (m.minutes.status !== 'DRAFT') throw new AppError('There are no draft minutes to approve.', 409);
  const chair = m.members.find((x) => x.role === 'CHAIR');
  const isChair = chair && String(chair.profileId ?? '') === String(actor.profileId);
  if (!isChair && actor.roleKey !== 'PRINCIPAL') throw new AppError('The chair or the principal approves minutes.', 403);
  m.minutes.status = 'APPROVED';
  m.minutes.approvedByProfileId = actor.profileId;
  m.minutes.approvedAt = new Date();
  pushHistory(m, actor, 'MINUTES_APPROVED');
  await m.save();
  await sendOperational({ templateKey: 'MEETING_MINUTES', recipientProfileIds: memberIds(m).filter((x) => x !== String(actor.profileId)), variables: { title: m.title, actions: m.actions.filter((a) => a.status === 'OPEN').length }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:minutes`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id, requestedBy: actor.profileId });
  const owners = m.actions.filter((a) => a.status === 'OPEN' && a.ownerProfileId).map((a) => String(a.ownerProfileId));
  if (owners.length) await notify({ recipientProfileIds: owners, type: 'SYSTEM', title: `Action from ${m.title}`, body: 'See the approved minutes', link: `/governance?id=${m._id}` });
  return present(m.toObject(), actor);
}

export async function updateAction(actor, scope, id, actionId, body = {}) {
  const m = await load(id, actor, scope);
  const a = m.actions.id(actionId);
  if (!a) throw new AppError('Action not found', 404);
  const isOwner = String(a.ownerProfileId ?? '') === String(actor.profileId);
  if (!isOwner && !actor.permissions?.['governance.manage']) throw new AppError('Only the action owner or the secretariat can update it.', 403);
  a.status = oneOf(body.status, ['OPEN', 'DONE', 'DROPPED'], 'status');
  pushHistory(m, actor, `ACTION_${a.status}`, { note: a.title });
  await m.save();
  return present(m.toObject(), actor);
}

export async function cancel(actor, scope, id, { reason } = {}) {
  const m = await load(id, actor, scope);
  m.status = 'CANCELLED';
  pushHistory(m, actor, 'CANCELLED', { note: requireText(reason, 'reason', { max: 500 }) });
  await m.save();
  await sendOperational({ templateKey: 'GENERAL_NOTICE', recipientProfileIds: memberIds(m).filter((x) => x !== String(actor.profileId)), variables: { title: `"${m.title}" is cancelled` }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:cancelled`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id });
  return present(m.toObject(), actor);
}

/** Sends a reminder to members of meetings in the next `hours` hours (idempotent per meeting). */
export async function sendReminders(actor, { hours = 48 } = {}) {
  const now = new Date();
  const upcoming = await BoardMeeting.find({ status: 'SCHEDULED', scheduledAt: { $gte: now, $lte: new Date(now.getTime() + hours * 3600_000) } }).lean();
  let n = 0;
  for (const m of upcoming) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendOperational({ templateKey: 'MEETING_REMINDER', recipientProfileIds: memberIds(m), variables: { title: m.title, when: fmt(m.scheduledAt) }, link: `/governance?id=${m._id}`, idempotencyKey: `mtg:${m._id}:reminder:${m.scheduledAt.toISOString()}`, relatedEntityType: 'BoardMeeting', relatedEntityId: m._id, requestedBy: actor?.profileId ?? null });
    n += r.filter((x) => !x.duplicate).length;
  }
  return { meetings: upcoming.length, messages: n };
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = scope === 'ALL' ? {} : { 'members.profileId': actor.profileId };
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await BoardMeeting.find(filter).sort({ scheduledAt: -1, createdAt: -1 }).limit(200).select('-history').lean();
  return rows.map((m) => present(m, actor));
}

export async function get(actor, scope, id) {
  requireProfile(actor);
  return present((await load(id, actor, scope)).toObject(), actor);
}

/** Open actions across all meetings (for the principal's and trustees' dashboards). */
export async function openActions(actor, scope) {
  const filter = { 'actions.status': 'OPEN', ...(scope === 'ALL' ? {} : { 'members.profileId': actor.profileId }) };
  const rows = await BoardMeeting.find(filter).select('refNo title actions').lean();
  const now = new Date();
  return rows.flatMap((m) => m.actions.filter((a) => a.status === 'OPEN').map((a) => ({ meetingId: String(m._id), meeting: m.title, actionId: String(a._id), title: a.title, ownerName: a.ownerName, dueOn: a.dueOn, overdue: a.dueOn ? a.dueOn < now : false })))
    .sort((a, b) => new Date(a.dueOn ?? 8.64e15) - new Date(b.dueOn ?? 8.64e15));
}
