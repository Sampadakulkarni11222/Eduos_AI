import mongoose from 'mongoose';
import { HostelAllocation } from '../../models/hostel.model.js';
import { HostelRollCall, MessMenu, HostelIncident, ROLL_STATUSES, ROLL_SESSIONS, INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, CONTACT_CHANNELS, MEALS } from '../../models/supportRoles.model.js';
import { OutPass } from '../../models/safety.model.js';
import { Student } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { decrypt } from '../../utils/crypto.js';
import { recordAudit, recordPiiRead } from '../../utils/auditTrail.js';
import { nextRef, pushHistory } from '../ops/common.js';
import { profilesWithPermission } from '../safety/shared.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';

/**
 * Hostel life, part 4: the warden's evening and morning beyond rooms and
 * out-passes.
 *
 *   roll call   one per block per session (NIGHT / MORNING); residents out on an
 *               out-pass are pre-marked ON_LEAVE with the pass reference; on
 *               submit, anyone not accounted for raises an urgent task and tells
 *               every warden and the principal at once (in the app; WhatsApp when
 *               the school's messaging is connected)
 *   mess        the week's menu, tonight's headcount, and the allergy list the
 *               kitchen needs (read from the medical record; every read audited)
 *   incidents   hostel incidents and discipline notes with the parent-contact log;
 *               a safeguarding concern is referred to the designated officer, and
 *               only the fact of the referral is kept here
 *   briefing    the night in numbers, with the records behind each number
 *
 * Nothing here messages parents by itself: contacting a family is the
 * warden's call, logged in the incident.
 */

const IST = 330 * 60_000;
const DAY = 86_400_000;
const ymd = (d = new Date()) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const name = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : null);
const actorRef = (a) => ({ profileId: a?.profileId ?? null, name: a?.displayName ?? null });
const oid = (v, label) => {
  if (!v || !mongoose.isValidObjectId(String(v))) throw new AppError(`Invalid ${label}`, 400, [], 'INVALID_ID');
  return String(v);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v) => {
  if (v === undefined || v === null || v === '') return ymd();
  if (!DATE_RE.test(String(v))) throw new AppError('date must look like 2026-10-16', 400, [], 'BAD_DATE');
  return String(v);
};

/** Current residents, with room and block. */
export async function residents({ block } = {}) {
  const rows = await HostelAllocation.find({ status: 'ACTIVE' }).populate('roomId', 'roomNo block').populate('studentId', 'firstName lastName admissionNo deletedAt').lean();
  return rows.filter((r) => r.studentId && !r.studentId.deletedAt && (!block || block === 'ALL' || r.roomId?.block === block))
    .map((r) => ({ studentId: String(r.studentId._id), name: name(r.studentId), admissionNo: r.studentId.admissionNo, roomNo: r.roomId?.roomNo ?? null, block: r.roomId?.block ?? null }))
    .sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

async function outNow(studentIds, at = new Date(), { planned = false } = {}) {
  // For the roll call only a resident who has actually left through the gate (OUT) is away: an APPROVED pass
  // not yet used may still be inside, and pre-marking them would hide someone who is missing. For planning
  // meals, an approved pass covering the time counts too.
  const filter = planned ? { $or: [{ status: 'OUT' }, { status: 'APPROVED', fromAt: { $lte: at }, toAt: { $gte: at } }] } : { status: 'OUT' };
  const passes = await OutPass.find({ studentId: { $in: studentIds }, ...filter }).select('studentId refNo status toAt').lean();
  return new Map(passes.map((p) => [String(p.studentId), p]));
}

/* ── Roll call ────────────────────────────────────────────── */

function rollDto(r) {
  const counts = Object.fromEntries(ROLL_STATUSES.map((s) => [s, 0]));
  for (const e of r.entries ?? []) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return {
    id: String(r._id), date: r.date, session: r.session, block: r.block, submittedAt: r.submittedAt, takenBy: r.takenBy?.name ?? null,
    counts, total: r.entries?.length ?? 0, unaccounted: counts.ABSENT + (r.submittedAt ? counts.UNMARKED : 0),
    entries: (r.entries ?? []).map((e) => ({ studentId: String(e.studentId), name: e.name, roomNo: e.roomNo, status: e.status, outPassRef: e.outPassRef, note: e.note, markedAt: e.markedAt })),
  };
}

/** Opens tonight's (or the given) roll call, or returns the one already open. */
export async function startRollCall(actor, { date, session = 'NIGHT', block = 'ALL' } = {}) {
  const day = dayOf(date);
  if (!ROLL_SESSIONS.includes(session)) throw new AppError(`session must be ${ROLL_SESSIONS.join(' or ')}`, 400);
  const b = String(block || 'ALL').slice(0, 40);
  const existing = await HostelRollCall.findOne({ date: day, session, block: b }).lean();
  if (existing) return rollDto(existing);
  const people = await residents({ block: b });
  if (!people.length) throw new AppError('No residents are allocated a bed in that block.', 404, [], 'NO_RESIDENTS');
  const out = await outNow(people.map((p) => p.studentId));
  const entries = people.map((p) => {
    const pass = out.get(p.studentId);
    return { studentId: p.studentId, name: p.name, roomNo: p.roomNo, status: pass ? 'ON_LEAVE' : 'UNMARKED', outPassRef: pass?.refNo ?? null, markedAt: pass ? new Date() : null };
  });
  try {
    const r = await HostelRollCall.create({ date: day, session, block: b, entries, takenBy: actorRef(actor) });
    return rollDto(r.toObject());
  } catch (err) {
    if (err?.code === 11000) return rollDto(await HostelRollCall.findOne({ date: day, session, block: b }).lean());
    throw err;
  }
}

export async function getRollCall(id) {
  const r = await HostelRollCall.findById(oid(id, 'roll call id')).lean();
  if (!r) throw new AppError('Roll call not found', 404);
  return rollDto(r);
}

export async function listRollCalls({ from, to, limit = 30 } = {}) {
  const filter = {};
  if (from || to) filter.date = { ...(from ? { $gte: dayOf(from) } : {}), ...(to ? { $lte: dayOf(to) } : {}) };
  const rows = await HostelRollCall.find(filter).sort({ date: -1, session: 1 }).limit(Math.min(Number(limit) || 30, 120)).lean();
  return rows.map((r) => { const d = rollDto(r); delete d.entries; return d; });
}

/** Marks some or all residents. Allowed until submitted; after that only a late arrival may be marked. */
export async function markRollCall(actor, id, { entries = [], allPresent = false } = {}) {
  const r = await HostelRollCall.findById(oid(id, 'roll call id'));
  if (!r) throw new AppError('Roll call not found', 404);
  const now = new Date();
  if (allPresent) {
    if (r.submittedAt) throw new AppError('This roll call is already submitted.', 409, [], 'ROLL_SUBMITTED');
    for (const e of r.entries) if (e.status === 'UNMARKED') { e.status = 'PRESENT'; e.markedAt = now; }
  }
  for (const m of Array.isArray(entries) ? entries : []) {
    const e = r.entries.find((x) => String(x.studentId) === String(m.studentId));
    if (!e) throw new AppError('That student is not on this roll call.', 404, [], 'NOT_ON_ROLL');
    if (!ROLL_STATUSES.includes(m.status) || m.status === 'UNMARKED') throw new AppError(`status must be one of ${ROLL_STATUSES.filter((s) => s !== 'UNMARKED').join(', ')}`, 400);
    if (r.submittedAt && !(m.status === 'LATE' && ['ABSENT', 'UNMARKED'].includes(e.status))) {
      throw new AppError('This roll call is submitted; only a resident who was missing can now be marked as arrived late.', 409, [], 'ROLL_SUBMITTED');
    }
    e.status = m.status;
    e.note = m.note ? String(m.note).slice(0, 200) : e.note;
    e.markedAt = now;
  }
  r.markModified('entries');
  await r.save();
  const dto = rollDto(r.toObject());
  if (r.submittedAt && dto.unaccounted === 0) await resolveSource(`hostel-roll:${r._id}`, { note: 'Everyone accounted for' }).catch(() => {});
  return dto;
}

/**
 * Submits the roll call. Unmarked residents count as not accounted for; if
 * any are, every warden and the principal are told at once and an urgent task
 * is opened until each is found (marked LATE) — the warden then calls the
 * family; nothing here contacts them.
 */
export async function submitRollCall(actor, id) {
  const r = await HostelRollCall.findById(oid(id, 'roll call id'));
  if (!r) throw new AppError('Roll call not found', 404);
  if (r.submittedAt) throw new AppError('This roll call is already submitted.', 409, [], 'ROLL_SUBMITTED');
  r.submittedAt = new Date();
  r.submittedBy = actorRef(actor);
  await r.save();
  const dto = rollDto(r.toObject());
  const missing = dto.entries.filter((e) => ['ABSENT', 'UNMARKED'].includes(e.status));
  if (missing.length) {
    const wardens = (await profilesWithPermission('hostel.manage')).map((p) => String(p._id));
    await sendOperational({
      templateKey: 'HOSTEL_ROLL_UNACCOUNTED', recipientProfileIds: wardens, urgency: 'URGENT',
      variables: { session: r.session.toLowerCase(), date: r.date, count: missing.length },
      link: '/warden/hostel-life', idempotencyKey: `hostel-roll:${r._id}`, relatedEntityType: 'HostelRollCall', relatedEntityId: r._id,
    }).catch(() => {});
    await upsertFromSource({
      sourceKey: `hostel-roll:${r._id}`, title: `Find ${missing.length} resident(s) not accounted for at ${r.session.toLowerCase()} roll call ${r.date}`,
      department: 'HOSTEL', category: 'OTHER', severity: 'CRITICAL', dueAt: new Date(Date.now() + 30 * 60_000),
      description: missing.map((m) => `${m.name} (room ${m.roomNo ?? '—'})`).join(', '), ownerProfileId: actor?.profileId ?? null,
      source: { entityType: 'HostelRollCall', entityId: r._id, link: '/warden/hostel-life' },
    }).catch(() => {});
  }
  await recordAudit({ actor, action: 'hostel.rollcall.submit', entityType: 'HostelRollCall', entityId: r._id, after: { date: r.date, session: r.session, counts: dto.counts } });
  return dto;
}

/* ── Mess ─────────────────────────────────────────────────── */

/** The Monday (school time) of the week a date falls in. */
export function weekStartOf(day = ymd()) {
  const d = new Date(`${dayOf(day)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}

export async function getMenu({ week } = {}) {
  const weekStart = weekStartOf(week);
  const m = await MessMenu.findOne({ weekStart }).lean();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = m?.days?.find((x) => x.day === i) ?? {};
    return { day: i, date: new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + i * DAY).toISOString().slice(0, 10), ...Object.fromEntries(MEALS.map((k) => [k, d[k] ?? ''])) };
  });
  return { weekStart, days, notes: m?.notes ?? null, updatedBy: m?.updatedBy?.name ?? null, updatedAt: m?.updatedAt ?? null, saved: Boolean(m) };
}

export async function saveMenu(actor, { week, days = [], notes } = {}) {
  const weekStart = weekStartOf(week);
  const clean = (Array.isArray(days) ? days : []).filter((d) => Number.isInteger(d?.day) && d.day >= 0 && d.day <= 6)
    .map((d) => ({ day: d.day, ...Object.fromEntries(MEALS.map((k) => [k, d[k] ? String(d[k]).slice(0, 200) : ''])) }));
  await MessMenu.findOneAndUpdate({ weekStart }, { $set: { days: clean, notes: notes ? String(notes).slice(0, 500) : null, updatedBy: actorRef(actor) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await recordAudit({ actor, action: 'hostel.mess.menu', entityType: 'MessMenu', after: { weekStart, days: clean.length } });
  return getMenu({ week: weekStart });
}

/** Meals to cook on a date: residents less those out on an out-pass then. */
export async function headcount({ date } = {}) {
  const day = dayOf(date);
  const people = await residents();
  const at = new Date(new Date(`${day}T19:00:00Z`).getTime() - IST); // 7 pm school time, dinner
  const out = await outNow(people.map((p) => p.studentId), at, { planned: true });
  return { date: day, residents: people.length, away: out.size, meals: people.length - out.size };
}

/**
 * Residents with an allergy on their medical record, for the kitchen. Medical
 * data: needs medical.read (the warden holds it) and every read is audited.
 */
export async function dietList(actor) {
  if (!actor?.permissions?.['medical.read']) throw new AppError('Missing permission: medical.read', 403);
  const people = await residents();
  const recs = await MedicalRecord.find({ studentId: { $in: people.map((p) => p.studentId) }, deletedAt: null, allergiesEnc: { $ne: null } }).select('studentId allergiesEnc').lean();
  const byId = new Map(people.map((p) => [p.studentId, p]));
  const rows = [];
  for (const r of recs) {
    let allergies = null;
    try { allergies = decrypt(r.allergiesEnc); } catch { allergies = null; }
    const list = Array.isArray(allergies) ? allergies : (allergies ? [String(allergies)] : []);
    if (!list.length) continue;
    const p = byId.get(String(r.studentId));
    rows.push({ studentId: String(r.studentId), name: p?.name, roomNo: p?.roomNo, allergies: list });
  }
  await recordPiiRead({ actor, action: 'medical.diet_list', entityType: 'MedicalRecord', entityId: null, via: 'hostel.mess.diet', fields: ['allergies'], count: rows.length }).catch(() => {});
  return { residents: people.length, withAllergies: rows.length, rows: rows.sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true })) };
}

/* ── Incidents ────────────────────────────────────────────── */

function incidentDto(i) {
  return {
    id: String(i._id), refNo: i.refNo, students: (i.studentIds ?? []).map((id, k) => ({ id: String(id), name: i.studentNames?.[k] ?? null })),
    category: i.category, severity: i.severity, occurredAt: i.occurredAt, location: i.location, description: i.description, actionTaken: i.actionTaken,
    status: i.status, resolvedAt: i.resolvedAt, resolution: i.resolution, referredToSafeguarding: i.referredToSafeguarding,
    parentContacts: (i.parentContacts ?? []).map((c) => ({ id: String(c._id), at: c.at, guardianName: c.guardianName, channel: c.channel, summary: c.summary, by: c.by?.name ?? null })),
    reportedBy: i.reportedBy?.name ?? null, history: i.history ?? [],
  };
}

export async function createIncident(actor, { studentIds = [], category = 'OTHER', severity = 'LOW', occurredAt, location, description, actionTaken, referredToSafeguarding = false } = {}) {
  if (!String(description ?? '').trim()) throw new AppError('Describe what happened.', 400, [], 'DESCRIPTION_REQUIRED');
  if (!INCIDENT_CATEGORIES.includes(category)) throw new AppError(`category must be one of ${INCIDENT_CATEGORIES.join(', ')}`, 400);
  if (!INCIDENT_SEVERITIES.includes(severity)) throw new AppError(`severity must be ${INCIDENT_SEVERITIES.join(', ')}`, 400);
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).map((x) => oid(x, 'student id')))];
  if (!ids.length) throw new AppError('Name at least one resident.', 400, [], 'STUDENT_REQUIRED');
  const students = await Student.find({ _id: { $in: ids }, deletedAt: null }).select('firstName lastName').lean();
  if (students.length !== ids.length) throw new AppError('A student named is not in this school.', 404, [], 'STUDENT_NOT_FOUND');
  const at = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(at.getTime())) throw new AppError('occurredAt is not a valid time', 400);
  const i = new HostelIncident({
    refNo: await nextRef('HIN'), studentIds: students.map((s) => s._id), studentNames: students.map(name), category, severity, occurredAt: at,
    location: location ? String(location).slice(0, 120) : null, description: String(description).slice(0, 2000), actionTaken: actionTaken ? String(actionTaken).slice(0, 1000) : null,
    referredToSafeguarding: Boolean(referredToSafeguarding), reportedBy: actorRef(actor),
  });
  pushHistory(i, actor, 'CREATED');
  await i.save();
  if (severity === 'HIGH') {
    await upsertFromSource({ sourceKey: `hostel-incident:${i._id}`, title: `Hostel incident ${i.refNo}: follow up and close`, department: 'HOSTEL', severity: 'HIGH', dueAt: new Date(Date.now() + DAY), ownerProfileId: actor?.profileId ?? null, source: { entityType: 'HostelIncident', entityId: i._id, link: '/warden/hostel-life?tab=incidents' } }).catch(() => {});
  }
  await recordAudit({ actor, action: 'hostel.incident.create', entityType: 'HostelIncident', entityId: i._id, after: { refNo: i.refNo, category, severity } });
  return incidentDto(i.toObject());
}

export async function listIncidents({ status = 'OPEN', studentId, limit = 100 } = {}) {
  const filter = {};
  if (status && status !== 'ALL') filter.status = status;
  if (studentId) filter.studentIds = oid(studentId, 'student id');
  const rows = await HostelIncident.find(filter).sort({ occurredAt: -1 }).limit(Math.min(Number(limit) || 100, 300)).lean();
  return rows.map(incidentDto);
}

export async function getIncident(id) {
  const i = await HostelIncident.findById(oid(id, 'incident id')).lean();
  if (!i) throw new AppError('Incident not found', 404);
  return incidentDto(i);
}

/** The warden logs a conversation with a family (they made the call; this records it). */
export async function logParentContact(actor, id, { guardianName, channel = 'CALL', summary } = {}) {
  if (!String(summary ?? '').trim()) throw new AppError('Summarise what was said.', 400, [], 'SUMMARY_REQUIRED');
  if (!CONTACT_CHANNELS.includes(channel)) throw new AppError(`channel must be one of ${CONTACT_CHANNELS.join(', ')}`, 400);
  const i = await HostelIncident.findById(oid(id, 'incident id'));
  if (!i) throw new AppError('Incident not found', 404);
  i.parentContacts.push({ at: new Date(), guardianName: guardianName ? String(guardianName).slice(0, 80) : null, channel, summary: String(summary).slice(0, 1000), by: actorRef(actor) });
  pushHistory(i, actor, 'PARENT_CONTACTED', { note: channel });
  await i.save();
  await recordAudit({ actor, action: 'hostel.incident.parent_contact', entityType: 'HostelIncident', entityId: i._id, after: { channel } });
  return incidentDto(i.toObject());
}

export async function resolveIncident(actor, id, { resolution } = {}) {
  if (!String(resolution ?? '').trim()) throw new AppError('Say how it was resolved.', 400, [], 'RESOLUTION_REQUIRED');
  const i = await HostelIncident.findById(oid(id, 'incident id'));
  if (!i) throw new AppError('Incident not found', 404);
  if (i.status === 'RESOLVED') throw new AppError('This incident is already resolved.', 409, [], 'ALREADY_RESOLVED');
  i.status = 'RESOLVED';
  i.resolvedAt = new Date();
  i.resolution = String(resolution).slice(0, 1000);
  pushHistory(i, actor, 'RESOLVED', { from: 'OPEN', to: 'RESOLVED' });
  await i.save();
  await resolveSource(`hostel-incident:${i._id}`, { note: 'Incident resolved' }).catch(() => {});
  await recordAudit({ actor, action: 'hostel.incident.resolve', entityType: 'HostelIncident', entityId: i._id, after: { status: 'RESOLVED' } });
  return incidentDto(i.toObject());
}

/* ── Briefing ─────────────────────────────────────────────── */

export async function briefing({ now = new Date() } = {}) {
  const today = ymd(now);
  const [people, last, openIncidents, count] = await Promise.all([
    residents(),
    HostelRollCall.findOne({}).sort({ date: -1, createdAt: -1 }).lean(),
    HostelIncident.countDocuments({ status: 'OPEN' }),
    headcount({ date: today }),
  ]);
  const late = await OutPass.find({ status: 'OUT', toAt: { $lt: now } }).select('refNo studentId toAt').lean();
  const pending = await OutPass.countDocuments({ status: 'PENDING_WARDEN' });
  const lastDto = last ? rollDto(last) : null;
  const lines = [
    `${people.length} resident(s); ${count.away} away on an out-pass tonight; ${count.meals} dinner(s) to cook.`,
    lastDto ? `Last roll call: ${lastDto.session.toLowerCase()} ${lastDto.date}${lastDto.submittedAt ? `, ${lastDto.counts.PRESENT + lastDto.counts.LATE} present, ${lastDto.unaccounted} not accounted for` : ', still open (not submitted)'}.` : 'No roll call has been taken yet.',
    `${late.length} out-pass(es) past their return time; ${pending} waiting for your decision.`,
    `${openIncidents} open incident(s).`,
  ];
  const tonightTaken = Boolean(last && last.date === today && last.session === 'NIGHT');
  return { lines, tonightTaken, evidence: { residents: people.length, away: count.away, meals: count.meals, lateReturns: late.length, outpassesPending: pending, openIncidents, lastRollCallId: lastDto?.id ?? null } };
}
