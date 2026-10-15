import mongoose from 'mongoose';
import { CameraObservation, ClassCheckIn, OBSERVATION_TYPES, REVIEW_DECISIONS } from '../../models/safety.model.js';
import { Device, CAMERA_PURPOSES, CAMERA_LOCATIONS, FORBIDDEN_CAMERA_LOCATIONS } from '../../models/device.model.js';
import { Facility } from '../../models/facility.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { SubjectOffering, Section } from '../../models/academics.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOperational } from '../messaging/messaging.service.js';
import * as safeguarding from '../compliance/safeguarding.service.js';
import { assertObjectId, dto, oneOf, optionalText, pushHistory, requireText, profilesWithRoles } from '../ops/common.js';
import { getSettings, istMinutes, istWeekday, parseSchoolDay, profilesWithPermission, schoolDay } from './shared.js';

/**
 * Optional camera event review (pilot; the `camera` feature is off by default).
 *
 * What it is: a registry of cameras with an APPROVED location and PURPOSE, a
 * provider adapter contract, and a queue of OBSERVATIONS a provider reports —
 * "possibly unattended room", "possible aggression", "device offline" — each
 * with a confidence, a time, a room and a reference to evidence held in
 * restricted storage (never the image itself).
 *
 * What it is not: identification. No face identity, emotion, student name or
 * behaviour score is accepted (a payload carrying one is refused), nothing is
 * decided automatically, and nothing reaches feeds, the campus map, ordinary
 * analytics or parents. Every observation is UNVERIFIED until a trained
 * reviewer (camera.events.review) records CONFIRMED / FALSE_ALERT /
 * NEEDS_FOLLOW_UP. A confirmed aggression observation can be LINKED to a
 * safeguarding case (encrypted, existing service); that link is a referral to
 * the designated officer, not a finding against any child.
 *
 * A "possibly unattended room" is put next to the timetable, the teacher's
 * class check-in, cover arrangements and approved leave, which are the primary
 * record. A camera cannot tell whether good teaching happened.
 */
const FORBIDDEN_TEXT = /toilet|washroom|restroom|bathroom|lavator|urinal|shower|changing|wc\b|dorm/i;
const REFUSED_FIELDS = ['faceId', 'faces', 'personId', 'personIds', 'identity', 'identities', 'studentId', 'studentIds', 'name', 'names', 'emotion', 'emotions', 'sentiment', 'score', 'behaviourScore', 'behaviorScore', 'image', 'imageBase64', 'frame', 'snapshot', 'video'];
const TYPE_PURPOSE = { POSSIBLE_UNATTENDED_ROOM: 'UNATTENDED_CLASSROOM_CHECK', POSSIBLE_AGGRESSION: 'CORRIDOR_SAFETY', TEACHER_PRESENT_IN_ROOM: 'UNATTENDED_CLASSROOM_CHECK' };
// Observations read against the timetable (which class, which teacher) for the reviewer.
const ROOM_CONTEXT_TYPES = ['POSSIBLE_UNATTENDED_ROOM', 'TEACHER_PRESENT_IN_ROOM'];
export const CAMERA_LIMITS = 'Observations are unverified until a trained reviewer decides. No face identification, emotion inference, behaviour scores or live streams to parents. A camera cannot judge teaching.';

// ── device registry rules ────────────────────────────────────────────────

/** Validates a camera's approved purpose and location. Throws on a forbidden place. */
export async function cleanCameraConfig(input = {}, actor) {
  const purpose = oneOf(input.purpose, CAMERA_PURPOSES, 'camera.purpose');
  const locationKind = String(input.locationKind ?? '').toUpperCase().trim();
  const roomLabel = optionalText(input.roomLabel, { max: 120 }) || null;
  let facility = null;
  if (input.facilityId) {
    facility = await Facility.findById(assertObjectId(input.facilityId, 'camera.facilityId')).select('_id kind name code').lean();
    if (!facility) throw new AppError('Facility not found', 404);
  }
  if (FORBIDDEN_CAMERA_LOCATIONS.includes(locationKind) || facility?.kind === 'TOILET' || FORBIDDEN_TEXT.test(roomLabel ?? '') || FORBIDDEN_TEXT.test(facility?.name ?? '')) {
    throw new AppError('Cameras are never allowed in toilets, washrooms, changing rooms, dormitories or medical rooms.', 422, [], 'FORBIDDEN_CAMERA_LOCATION');
  }
  if (!CAMERA_LOCATIONS[purpose].includes(locationKind)) {
    throw new AppError(`A camera for ${purpose.toLowerCase().replace(/_/g, ' ')} may only be in: ${CAMERA_LOCATIONS[purpose].join(', ').toLowerCase()}.`, 422, [], 'PURPOSE_LOCATION_MISMATCH');
  }
  const retention = Number(input.retentionDays ?? 7);
  if (!Number.isInteger(retention) || retention < 1 || retention > 30) throw new AppError('camera.retentionDays must be a whole number from 1 to 30', 400);
  return {
    purpose, locationKind, facilityId: facility?._id ?? null, roomLabel: roomLabel ?? facility?.name ?? null, retentionDays: retention,
    approvedByProfileId: actor?.profileId ?? null, approvedAt: new Date(), approvalNote: requireText(input.approvalNote, 'camera.approvalNote (who approved this camera and why)', { max: 1000 }),
  };
}

// ── ingestion (device-authenticated) ─────────────────────────────────────

function cleanObservation(body) {
  for (const k of Object.keys(body ?? {})) {
    if (REFUSED_FIELDS.includes(k)) throw new AppError(`"${k}" is not accepted: EduOS takes observations only, never identities, images, emotions or scores.`, 422, [], 'FIELD_NOT_ACCEPTED');
  }
  const type = oneOf(body?.type, OBSERVATION_TYPES, 'type');
  const confidence = body?.confidence === undefined || body?.confidence === null ? null : Number(body.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new AppError('confidence must be between 0 and 1', 400);
  const observedAt = new Date(body?.timestamp ?? body?.observedAt ?? Date.now());
  if (Number.isNaN(observedAt.getTime())) throw new AppError('timestamp is not a valid time', 400);
  if (observedAt.getTime() > Date.now() + 2 * 60_000) throw new AppError('timestamp is in the future', 400);
  const evidenceRef = body?.evidenceRef === undefined || body?.evidenceRef === null ? null : String(body.evidenceRef);
  if (evidenceRef && (evidenceRef.length > 300 || /^data:/i.test(evidenceRef) || /\s/.test(evidenceRef))) {
    throw new AppError('evidenceRef must be a short reference to restricted storage (no embedded media).', 422, [], 'EVIDENCE_NOT_A_REFERENCE');
  }
  return {
    type, confidence, observedAt, evidenceRef,
    room: optionalText(body?.room, { max: 120 }) || null,
    providerEventId: body?.eventId !== undefined && body?.eventId !== null ? String(body.eventId).slice(0, 100) : null,
  };
}

async function reviewers() {
  return profilesWithPermission('camera.events.review');
}

export async function ingest(device, body = {}, now = new Date()) {
  if (device.kind !== 'CAMERA') throw new AppError('Not a camera device', 403);
  const o = cleanObservation(body);
  if (TYPE_PURPOSE[o.type] && device.camera?.purpose !== TYPE_PURPOSE[o.type]) {
    throw new AppError(`This camera is approved for ${String(device.camera?.purpose).toLowerCase().replace(/_/g, ' ')} only; ${o.type} is not accepted from it.`, 422, [], 'OUTSIDE_APPROVED_PURPOSE');
  }
  await Device.updateOne({ _id: device._id }, { $set: { 'camera.health': o.type === 'DEVICE_OFFLINE' ? 'OFFLINE' : 'ONLINE', 'camera.lastHeartbeatAt': now } });
  if (o.providerEventId) {
    const dup = await CameraObservation.findOne({ deviceId: device._id, providerEventId: o.providerEventId }).select('_id').lean();
    if (dup) return { id: String(dup._id), duplicate: true, status: 'UNVERIFIED' };
  }
  const retention = device.camera?.retentionDays ?? 7;
  const doc = {
    deviceId: device._id, deviceLabel: device.label, ...o, room: o.room ?? device.camera?.roomLabel ?? null, facilityId: device.camera?.facilityId ?? null,
    receivedAt: now, evidencePurgeAfter: o.evidenceRef ? new Date(now.getTime() + retention * 86_400_000) : null, status: 'UNVERIFIED',
  };
  if (ROOM_CONTEXT_TYPES.includes(o.type)) doc.context = await roomContext({ room: doc.room, facilityId: doc.facilityId, at: o.observedAt });
  let obs;
  try {
    obs = await CameraObservation.create(doc);
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true, status: 'UNVERIFIED' };
    throw err;
  }
  const settings = await getSettings();
  if (o.type !== 'DEVICE_OFFLINE' && (o.confidence === null || o.confidence >= settings.camera.notifyMinConfidence)) {
    const ids = (await reviewers()).map((p) => String(p._id));
    // Content-free: no room, no type, nothing about any person.
    if (ids.length) await sendOperational({ templateKey: 'CAMERA_REVIEW_PENDING', recipientProfileIds: ids, variables: {}, link: `/camera?id=${obs._id}`, idempotencyKey: `camera:${obs._id}:pending`, relatedEntityType: 'CameraObservation', relatedEntityId: obs._id });
  }
  return { id: String(obs._id), status: 'UNVERIFIED', duplicate: false };
}

export async function heartbeat(device, now = new Date()) {
  await Device.updateOne({ _id: device._id }, { $set: { 'camera.health': 'ONLINE', 'camera.lastHeartbeatAt': now } });
  return { ok: true, at: now };
}

// ── context: timetable, check-in, cover, leave ───────────────────────────

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };

/**
 * What the school's own records say about a room at a time: which class was
 * timetabled, which teacher, whether they (or a substitute) checked in, and
 * whether the teacher is on approved leave or covered. Primary record first.
 */
export async function roomContext({ room, facilityId = null, at }) {
  const day = schoolDay(at);
  const weekday = istWeekday(at);
  const minutes = istMinutes(at);
  let facility = null;
  if (facilityId) facility = await Facility.findById(facilityId).select('name code sectionId').lean();
  const labels = [room, facility?.name, facility?.code].filter(Boolean).map((x) => String(x).toLowerCase());
  const slots = await TimetableSlot.find({ dayOfWeek: weekday }).lean();
  const slot = slots.find((s) => toMin(s.startTime) <= minutes && minutes < toMin(s.endTime)
    && ((s.room && labels.includes(String(s.room).toLowerCase())) || (facility?.sectionId && String(s.sectionId) === String(facility.sectionId))));
  if (!slot) return { scheduled: false, summary: 'Nothing is timetabled in this room at this time.' };
  const [offering, section] = await Promise.all([
    slot.subjectOfferingId ? SubjectOffering.findById(slot.subjectOfferingId).populate('subjectId', 'name').lean() : null,
    Section.findById(slot.sectionId).select('name').lean(),
  ]);
  if (!offering) return { scheduled: false, periodNo: slot.periodNo, sectionName: section?.name ?? null, summary: 'A break is timetabled at this time.' };
  const teacherId = offering.teacherId ? String(offering.teacherId) : null;
  const teacher = teacherId ? await Profile.findById(teacherId).select('displayName').lean() : null;
  const checkIns = await ClassCheckIn.find({ date: day, periodNo: slot.periodNo, $or: [{ sectionId: slot.sectionId }, { slotId: slot._id }] }).lean();
  let cover = null; let leave = null;
  try {
    const m = await import('../../models/staffLeave.model.js');
    const c = await m.CoverAssignment?.findOne({ date: day, sectionId: slot.sectionId, periodNo: slot.periodNo, status: 'CONFIRMED' }).lean();
    if (c) {
      const sub = await Profile.findById(c.substituteProfileId).select('displayName').lean();
      cover = { substituteProfileId: String(c.substituteProfileId), substituteName: sub?.displayName ?? null };
    }
    if (teacherId) {
      const l = await m.StaffLeave?.findOne({ profileId: teacherId, status: 'APPROVED', fromDate: { $lte: day }, toDate: { $gte: day } }).lean();
      const a = l ? null : await m.StaffAbsence?.findOne({ profileId: teacherId, date: day, status: 'ACTIVE' }).lean();
      if (l || a) leave = { kind: l ? 'APPROVED_LEAVE' : 'MARKED_ABSENT' };
    }
  } catch { /* staff cover module not present: context shows timetable and check-in only */ }
  const checkedIn = checkIns.find((c) => String(c.profileId) === teacherId || (cover && String(c.profileId) === cover.substituteProfileId)) ?? checkIns[0] ?? null;
  const parts = [`${section?.name ?? 'A class'} has ${offering.subjectId?.name ?? 'a lesson'} (period ${slot.periodNo}) with ${teacher?.displayName ?? 'no teacher assigned'}.`];
  if (leave) parts.push(`The teacher is on ${leave.kind === 'APPROVED_LEAVE' ? 'approved leave' : 'an absence recorded'} today.`);
  if (cover) parts.push(`Cover: ${cover.substituteName ?? 'a substitute'} is assigned.`);
  else if (leave) parts.push('No cover is recorded for this period.');
  parts.push(checkedIn ? `${checkedIn.teacherName ?? 'A teacher'} checked in at ${new Date(checkedIn.checkedInAt).toISOString().slice(11, 16)} UTC.` : 'No teacher check-in is recorded for this period.');
  return {
    scheduled: true, periodNo: slot.periodNo, sectionId: String(slot.sectionId), sectionName: section?.name ?? null, subject: offering.subjectId?.name ?? null,
    teacherProfileId: teacherId, teacherName: teacher?.displayName ?? null, leave, cover,
    checkIn: checkedIn ? { profileId: String(checkedIn.profileId), name: checkedIn.teacherName, at: checkedIn.checkedInAt, covering: Boolean(checkedIn.coveringForProfileId) } : null,
    summary: parts.join(' '),
  };
}

// ── review ───────────────────────────────────────────────────────────────

function present(o, { withHistory = false } = {}) {
  const out = dto(o);
  if (!withHistory) delete out.history;
  out.evidenceAvailable = Boolean(o.evidenceRef) && !o.evidencePurgedAt;
  return out;
}

export async function queue(query = {}) {
  const filter = {};
  if (query.status && query.status !== 'ALL') filter.status = oneOf(query.status, ['UNVERIFIED', ...REVIEW_DECISIONS], 'status');
  else if (!query.status) filter.status = { $in: ['UNVERIFIED', 'NEEDS_FOLLOW_UP'] };
  if (query.type) filter.type = oneOf(query.type, OBSERVATION_TYPES, 'type');
  const rows = await CameraObservation.find(filter).sort({ observedAt: -1 }).limit(200).lean();
  return { items: rows.map((r) => present(r)), limits: CAMERA_LIMITS };
}

export async function get(actor, id) {
  const o = await CameraObservation.findById(assertObjectId(id)).lean();
  if (!o) throw new AppError('Observation not found', 404);
  // Viewing restricted evidence references is itself audited.
  await recordAudit({ actor, action: 'camera.observation.view', entityType: 'CameraObservation', entityId: o._id });
  if (ROOM_CONTEXT_TYPES.includes(o.type)) o.context = await roomContext({ room: o.room, facilityId: o.facilityId, at: o.observedAt });
  return present(o, { withHistory: true });
}

/**
 * A reviewer's decision. A second decision is a correction (or the outcome of
 * an appeal) and must say why; earlier reviews are kept.
 */
export async function review(actor, id, body = {}) {
  const o = await CameraObservation.findById(assertObjectId(id));
  if (!o) throw new AppError('Observation not found', 404);
  const decision = oneOf(body.decision, REVIEW_DECISIONS, 'decision');
  const notes = requireText(body.notes, 'notes', { max: 4000 });
  let correctionOf = null;
  if (o.reviews.length) {
    correctionOf = o.status;
    requireText(body.correctionReason, 'correctionReason (why the earlier decision is being changed)', { max: 1000 });
  }
  o.reviews.push({ byProfileId: actor.profileId, byName: actor.displayName, at: new Date(), decision, notes, correctionOf: correctionOf ? `${correctionOf}: ${body.correctionReason}` : null });
  pushHistory(o, actor, correctionOf ? 'REVIEW_CORRECTED' : 'REVIEWED', { from: o.status, to: decision });
  o.status = decision;
  await o.save();
  await recordAudit({ actor, action: 'camera.observation.review', entityType: 'CameraObservation', entityId: o._id, after: { decision } });
  const out = present(o.toObject(), { withHistory: true });
  if (o.type === 'TEACHER_PRESENT_IN_ROOM' && decision === 'CONFIRMED') out.presence = await recordReviewedPresence(actor, o);
  return out;
}

/**
 * A reviewer confirmed "teacher present in room": the class check-in for that
 * period is recorded for the teacher the timetable (or a confirmed cover)
 * names for the room, marked CAMERA_REVIEWED with the reviewer. The camera
 * never identifies who it saw; if the timetable names nobody, nothing is
 * recorded and the reviewer is told why. An existing check-in is kept.
 */
async function recordReviewedPresence(actor, o) {
  const ctx = await roomContext({ room: o.room, facilityId: o.facilityId, at: o.observedAt });
  const teacherId = ctx.cover?.substituteProfileId ?? ctx.teacherProfileId ?? null;
  if (!ctx.scheduled || !teacherId) return { recorded: false, reason: 'The timetable names no teacher for this room at that time, so no check-in was recorded.' };
  const date = schoolDay(o.observedAt);
  const existing = await ClassCheckIn.findOne({ profileId: teacherId, date, periodNo: ctx.periodNo }).lean();
  if (existing) return { recorded: false, reason: 'The teacher had already checked in for this period.', checkInId: String(existing._id) };
  const name = ctx.cover?.substituteName ?? ctx.teacherName ?? null;
  try {
    const row = await ClassCheckIn.create({
      profileId: teacherId, teacherName: name, date, periodNo: ctx.periodNo, sectionId: ctx.sectionId ?? null, room: o.room ?? null,
      coveringForProfileId: ctx.cover ? ctx.teacherProfileId : null, checkedInAt: o.observedAt, source: 'CAMERA_REVIEWED',
      reviewedByProfileId: actor.profileId, observationId: o._id, note: 'Presence confirmed by a trained reviewer from a camera observation (timetabled teacher; no identification).',
    });
    return { recorded: true, checkInId: String(row._id), teacherName: name, periodNo: ctx.periodNo };
  } catch (err) {
    if (err?.code === 11000) return { recorded: false, reason: 'The teacher had already checked in for this period.' };
    throw err;
  }
}

/**
 * Links a CONFIRMED (or follow-up) aggression observation to a safeguarding
 * case: a new case through the existing encrypted service, or a note on an
 * existing case (needs safeguarding.manage). The case text names no child; the
 * officer establishes what happened.
 */
export async function linkCase(actor, id, body = {}) {
  const o = await CameraObservation.findById(assertObjectId(id));
  if (!o) throw new AppError('Observation not found', 404);
  if (o.type !== 'POSSIBLE_AGGRESSION') throw new AppError('Only an aggression observation can be referred to safeguarding.', 409, [], 'NOT_LINKABLE');
  if (!['CONFIRMED', 'NEEDS_FOLLOW_UP'].includes(o.status)) throw new AppError('Review the observation first; only a confirmed or follow-up observation can be referred.', 409, [], 'NOT_REVIEWED');
  if (o.safeguardingCaseId) throw new AppError(`Already linked to ${o.safeguardingRef}.`, 409, [], 'ALREADY_LINKED');
  const lastReview = o.reviews[o.reviews.length - 1];
  const text = `Referral from camera observation ${o._id} (${o.room ?? 'room not recorded'}, ${o.observedAt.toISOString()}). Reviewer decision: ${o.status}. Reviewer notes: ${lastReview?.notes ?? '—'}. This is an unverified camera observation reviewed by staff; it does not identify anyone and is not a finding against any child.`;
  let caseId; let refNo;
  if (body.caseId) {
    if (!actor.permissions?.['safeguarding.manage']) throw new AppError('Adding to an existing case needs the designated safeguarding officer (safeguarding.manage). Create a new referral instead.', 403, [], 'NEEDS_SAFEGUARDING_OFFICER');
    const updated = await safeguarding.update(actor, assertObjectId(body.caseId, 'caseId'), { note: text });
    caseId = updated.id ?? body.caseId; refNo = updated.refNo;
  } else {
    const created = await safeguarding.report(actor, {
      category: oneOf(body.category, ['BULLYING', 'RAGGING', 'CHILD_PROTECTION', 'OTHER'], 'category', 'BULLYING'),
      urgency: oneOf(body.urgency, ['IMMEDIATE_DANGER', 'URGENT', 'STANDARD'], 'urgency', 'URGENT'),
      description: text,
    });
    caseId = created.id; refNo = created.refNo;
  }
  o.safeguardingCaseId = caseId;
  o.safeguardingRef = refNo ?? null;
  pushHistory(o, actor, 'LINKED_TO_SAFEGUARDING', { note: refNo ?? null });
  await o.save();
  const notified = await notifyAfterReferral(actor, o);
  const out = present(o.toObject(), { withHistory: true });
  out.notified = notified;
  return out;
}

/**
 * After a human reviewer has referred a possible bullying/aggression
 * observation to safeguarding (never before), the principal and the class
 * teacher of the class timetabled in that space are told that a reviewed
 * observation was referred. The message names no child and carries no
 * detail; the designated officer decides what happens next.
 */
async function notifyAfterReferral(actor, o) {
  const recipients = new Set((await profilesWithRoles(['PRINCIPAL'])).map((p) => String(p._id)));
  let classTeacher = null;
  const ctx = await roomContext({ room: o.room, facilityId: o.facilityId, at: o.observedAt });
  if (ctx.sectionId) {
    const section = await Section.findById(ctx.sectionId).select('classTeacherId').lean();
    if (section?.classTeacherId) { classTeacher = String(section.classTeacherId); recipients.add(classTeacher); }
  }
  recipients.delete(String(actor.profileId));
  const ids = [...recipients];
  if (ids.length) {
    await sendOperational({ templateKey: 'SAFETY_REFERRAL_FOLLOWUP', recipientProfileIds: ids, variables: {}, link: '/safeguarding', idempotencyKey: `camera:${o._id}:referred`, relatedEntityType: 'CameraObservation', relatedEntityId: o._id });
  }
  return { principal: true, classTeacher: Boolean(classTeacher), count: ids.length };
}

/**
 * A day's teacher presence by period: for each timetabled lesson, the teacher,
 * whether they (or a substitute) checked in and how (tap or a reviewed camera
 * observation). The timetable and check-ins are the record; no camera image
 * or identity is involved.
 */
export async function presenceBoard(query = {}) {
  const day = parseSchoolDay(query.date);
  const weekday = istWeekday(new Date(day.getTime() + 6 * 3_600_000));
  const slots = await TimetableSlot.find({ dayOfWeek: weekday, subjectOfferingId: { $ne: null } }).sort({ periodNo: 1 }).lean();
  const offerings = new Map((await SubjectOffering.find({ _id: { $in: slots.map((x) => x.subjectOfferingId) } }).populate('subjectId', 'name').lean()).map((x) => [String(x._id), x]));
  const sections = new Map((await Section.find({ _id: { $in: slots.map((x) => x.sectionId) } }).populate('gradeId', 'name').select('name gradeId').lean()).map((x) => [String(x._id), x]));
  const checkIns = await ClassCheckIn.find({ date: day }).lean();
  const teacherIds = [...new Set([...offerings.values()].map((x) => String(x.teacherId ?? '')).filter(Boolean))];
  const names = new Map((await Profile.find({ _id: { $in: teacherIds } }).select('displayName').lean()).map((p) => [String(p._id), p.displayName]));
  const nowMin = istMinutes(new Date());
  const today = day.getTime() === schoolDay().getTime();
  const rows = slots.map((slot) => {
    const off = offerings.get(String(slot.subjectOfferingId));
    const teacherId = off?.teacherId ? String(off.teacherId) : null;
    const sec = sections.get(String(slot.sectionId));
    const ci = checkIns.find((c) => c.periodNo === slot.periodNo && (String(c.sectionId) === String(slot.sectionId) || String(c.slotId) === String(slot._id)));
    const started = !today || toMin(slot.startTime) <= nowMin;
    return {
      periodNo: slot.periodNo, time: `${slot.startTime}-${slot.endTime}`, room: slot.room ?? null,
      sectionId: String(slot.sectionId), className: sec ? `${sec.gradeId?.name ?? ''} ${sec.name}`.trim() : null,
      subject: off?.subjectId?.name ?? null, teacherProfileId: teacherId, teacherName: teacherId ? names.get(teacherId) ?? null : null,
      status: ci ? (ci.coveringForProfileId ? 'COVER_PRESENT' : 'PRESENT') : started ? 'NOT_CHECKED_IN' : 'UPCOMING',
      checkIn: ci ? { name: ci.teacherName, at: ci.checkedInAt, source: ci.source ?? 'TAP', covering: Boolean(ci.coveringForProfileId) } : null,
    };
  });
  const counts = {
    lessons: rows.length,
    present: rows.filter((r) => r.status === 'PRESENT' || r.status === 'COVER_PRESENT').length,
    notCheckedIn: rows.filter((r) => r.status === 'NOT_CHECKED_IN').length,
    viaCamera: rows.filter((r) => r.checkIn?.source === 'CAMERA_REVIEWED').length,
  };
  return { date: day, rows, counts, note: 'From the timetable and teachers\' class check-ins (or a reviewer-confirmed camera observation). "Not checked in" means no record yet, not that the class was unattended.' };
}

/** Review performance: false-alert rate and time to decision, per type. */
export async function metrics(query = {}) {
  const since = query.from ? new Date(query.from) : new Date(Date.now() - 90 * 86_400_000);
  const rows = await CameraObservation.find({ observedAt: { $gte: since } }).select('type status reviews receivedAt').lean();
  const by = {};
  for (const t of OBSERVATION_TYPES) by[t] = { type: t, total: 0, unverified: 0, confirmed: 0, falseAlert: 0, needsFollowUp: 0, reviewMinutes: [] };
  for (const r of rows) {
    const e = by[r.type];
    e.total += 1;
    if (r.status === 'UNVERIFIED') e.unverified += 1;
    if (r.status === 'CONFIRMED') e.confirmed += 1;
    if (r.status === 'FALSE_ALERT') e.falseAlert += 1;
    if (r.status === 'NEEDS_FOLLOW_UP') e.needsFollowUp += 1;
    if (r.reviews?.[0]?.at) e.reviewMinutes.push((new Date(r.reviews[0].at) - new Date(r.receivedAt)) / 60_000);
  }
  return {
    since,
    types: Object.values(by).map((e) => {
      const reviewed = e.confirmed + e.falseAlert + e.needsFollowUp;
      const sorted = e.reviewMinutes.sort((a, b) => a - b);
      return {
        type: e.type, total: e.total, reviewed, unverified: e.unverified, confirmed: e.confirmed, falseAlert: e.falseAlert, needsFollowUp: e.needsFollowUp,
        // No reviews → no rate (not 0%).
        falseAlertRate: reviewed ? Math.round((e.falseAlert / reviewed) * 1000) / 10 : null,
        medianMinutesToReview: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
      };
    }),
    note: 'Missed incidents cannot be counted from observations alone; record them through safeguarding reports and compare during the pilot evaluation.',
  };
}

/** Drops evidence references past retention, unless linked to a safeguarding case (scheduled). */
export async function purgeEvidence({ now = new Date() } = {}) {
  const r = await CameraObservation.updateMany(
    { evidenceRef: { $ne: null }, evidencePurgeAfter: { $lt: now }, safeguardingCaseId: null },
    { $set: { evidenceRef: null, evidencePurgedAt: now } },
  );
  return { purged: r.modifiedCount ?? 0 };
}

export async function devices() {
  const rows = await Device.find({ kind: 'CAMERA' }).sort({ label: 1 }).lean();
  return rows.map((d) => { const { secretEnc: _s, history: _h, ...rest } = dto(d); return rest; });
}

// ── teacher class check-in ───────────────────────────────────────────────

/**
 * A teacher marks themselves present in class for a period. Works whether or
 * not cameras are used: it is the primary record the unattended-room
 * reconciliation reads. A substitute checks in with coveringForProfileId.
 */
export async function checkIn(actor, body = {}) {
  if (!actor?.profileId) throw new AppError('Select a profile first', 403);
  const date = parseSchoolDay(body.date);
  if (date.getTime() !== schoolDay().getTime()) throw new AppError('You can check in only for today.', 400, [], 'NOT_TODAY');
  const periodNo = Number.parseInt(body.periodNo, 10);
  if (!Number.isInteger(periodNo) || periodNo < 0) throw new AppError('periodNo is required', 400);
  const weekday = istWeekday();
  let slots = await TimetableSlot.find({ dayOfWeek: weekday, periodNo, ...(body.sectionId && mongoose.isValidObjectId(body.sectionId) ? { sectionId: body.sectionId } : {}) }).lean();
  const offerings = await SubjectOffering.find({ _id: { $in: slots.map((s) => s.subjectOfferingId).filter(Boolean) } }).select('_id teacherId').lean();
  const teacherOf = new Map(offerings.map((o) => [String(o._id), String(o.teacherId ?? '')]));
  const coveringFor = body.coveringForProfileId ? assertObjectId(body.coveringForProfileId, 'coveringForProfileId') : null;
  const mine = slots.filter((s) => teacherOf.get(String(s.subjectOfferingId)) === String(actor.profileId));
  let slot = mine[0] ?? null;
  if (!slot && coveringFor) slot = slots.find((s) => teacherOf.get(String(s.subjectOfferingId)) === String(coveringFor)) ?? null;
  if (!slot) {
    // A confirmed cover assignment also counts.
    try {
      const m = await import('../../models/staffLeave.model.js');
      const c = await m.CoverAssignment?.findOne({ date, periodNo, substituteProfileId: actor.profileId, status: 'CONFIRMED' }).lean();
      if (c) slot = slots.find((s) => String(s.sectionId) === String(c.sectionId)) ?? { _id: c.timetableSlotId, sectionId: c.sectionId, room: c.room };
    } catch { /* no cover module */ }
  }
  if (!slot) throw new AppError('You have no class timetabled (or cover assigned) in that period today.', 409, [], 'NO_CLASS');
  try {
    const row = await ClassCheckIn.create({
      profileId: actor.profileId, teacherName: actor.displayName ?? null, date, periodNo, sectionId: slot.sectionId ?? null, slotId: slot._id ?? null,
      room: slot.room ?? null, coveringForProfileId: coveringFor, note: optionalText(body.note, { max: 300 }) || null,
    });
    return dto(row.toObject());
  } catch (err) {
    if (err?.code === 11000) throw new AppError('You have already checked in for this period.', 409, [], 'ALREADY_CHECKED_IN');
    throw err;
  }
}

export async function myCheckIns(actor, query = {}) {
  const date = parseSchoolDay(query.date);
  const rows = await ClassCheckIn.find({ profileId: actor.profileId, date }).sort({ periodNo: 1 }).lean();
  return rows.map(dto);
}
