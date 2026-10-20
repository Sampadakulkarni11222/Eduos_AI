import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { IdCard, CheckpointEvent, ReleaseLog, OutPass } from '../../models/safety.model.js';
import { CHECKPOINT_POINTS } from '../../models/device.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId, dto, oneOf, optionalText, pushHistory, requireText } from '../ops/common.js';
import { getSettings, loadStudent, ownStudentIds, parseSchoolDay, raiseAlert, schoolDay, studentName } from './shared.js';
import * as trips from '../fleet/trips.service.js';
import * as outpass from '../hostel/outpass.service.js';

/**
 * ID cards and explicit checkpoints: school gate in/out, bus door board/alight,
 * lab and library. A scan is an EVENT — "this card was presented here at this
 * time" — and never proof that the holder stayed anywhere afterwards.
 *
 *   - Lost or revoked cards are refused and raise an alert; a replacement card
 *     keeps the old card's history linked.
 *   - A repeat of the same card at the same point inside the duplicate window
 *     (and a device resending the same scan id) is ignored, so a double tap or
 *     a retried upload cannot double-count anything.
 *   - A student leaving through the gate with no recorded release and no
 *     out-pass is flagged.
 *   - Gate scans can SUGGEST attendance; they never write the teacher's register.
 */
const SCAN_ACTOR = { system: true, profileId: null, displayName: 'Card reader', roleKey: 'SYSTEM', permissions: {} };
const POINT_LABEL = { GATE_IN: 'Gate — in', GATE_OUT: 'Gate — out', BUS_BOARD: 'Bus — boarded', BUS_ALIGHT: 'Bus — got off', LAB: 'Lab', LIBRARY: 'Library' };
export const CHECKPOINT_DISCLAIMER = 'A checkpoint shows that a card was presented at that place and time. It is not proof of where the holder was before or after.';

function presentCard(c) {
  const out = dto(c);
  return out;
}

// ── cards ────────────────────────────────────────────────────────────────

export async function listCards(query = {}) {
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, ['ACTIVE', 'LOST', 'REVOKED', 'REPLACED'], 'status');
  if (query.studentId && mongoose.isValidObjectId(query.studentId)) filter.studentId = query.studentId;
  if (query.q) filter.$or = [{ holderName: { $regex: String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { code: String(query.q) }];
  const rows = await IdCard.find(filter).sort({ updatedAt: -1 }).limit(300).lean();
  return rows.map(presentCard);
}

function newCode(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

async function holderOf(body) {
  const holderType = oneOf(body.holderType, ['STUDENT', 'STAFF'], 'holderType', body.studentId ? 'STUDENT' : 'STAFF');
  if (holderType === 'STUDENT') {
    const s = await loadStudent(body.studentId);
    return { holderType, studentId: s._id, profileId: null, holderName: studentName(s), prefix: 'STU' };
  }
  const p = await Profile.findOne({ _id: assertObjectId(body.profileId, 'profileId'), deletedAt: null }).select('_id displayName').lean();
  if (!p) throw new AppError('Staff member not found', 404);
  return { holderType, studentId: null, profileId: p._id, holderName: p.displayName, prefix: 'STF' };
}

export async function issueCard(actor, body = {}) {
  const h = await holderOf(body);
  const holderFilter = h.studentId ? { studentId: h.studentId } : { profileId: h.profileId };
  if (await IdCard.exists({ ...holderFilter, status: 'ACTIVE' })) throw new AppError(`${h.holderName} already has an active card. Replace it instead.`, 409, [], 'ACTIVE_CARD_EXISTS');
  const code = optionalText(body.code, { max: 64 }) || newCode(h.prefix);
  const card = new IdCard({ holderType: h.holderType, studentId: h.studentId, profileId: h.profileId, holderName: h.holderName, code, codeType: oneOf(body.codeType, ['QR', 'RFID'], 'codeType', 'QR') });
  pushHistory(card, actor, 'ISSUED', { to: 'ACTIVE' });
  try { await card.save(); } catch (err) {
    if (err?.code === 11000) throw new AppError('That card code is already in use.', 409, [], 'DUPLICATE');
    throw err;
  }
  return presentCard(card.toObject());
}

/** Marks a card LOST or REVOKED. Scans of it are refused from now on. */
export async function blockCard(actor, id, body = {}) {
  const card = await IdCard.findById(assertObjectId(id));
  if (!card) throw new AppError('Card not found', 404);
  const to = oneOf(body.status, ['LOST', 'REVOKED'], 'status');
  if (!['ACTIVE', 'LOST'].includes(card.status) || card.status === to) throw new AppError(`A ${card.status.toLowerCase()} card cannot be marked ${to.toLowerCase()}.`, 409, [], 'INVALID_TRANSITION');
  pushHistory(card, actor, to, { from: card.status, to, note: body.reason });
  card.status = to;
  card.statusChangedAt = new Date();
  card.statusReason = optionalText(body.reason, { max: 300 }) || null;
  await card.save();
  return presentCard(card.toObject());
}

/** Issues a new card for the same holder; the old one becomes REPLACED and points to it. */
export async function replaceCard(actor, id, body = {}) {
  const old = await IdCard.findById(assertObjectId(id));
  if (!old) throw new AppError('Card not found', 404);
  if (!['ACTIVE', 'LOST', 'REVOKED'].includes(old.status)) throw new AppError('This card was already replaced.', 409, [], 'INVALID_TRANSITION');
  const reason = requireText(body.reason, 'reason', { max: 300 });
  const code = optionalText(body.code, { max: 64 }) || newCode(old.holderType === 'STUDENT' ? 'STU' : 'STF');
  const fresh = new IdCard({ holderType: old.holderType, studentId: old.studentId, profileId: old.profileId, holderName: old.holderName, code, codeType: oneOf(body.codeType, ['QR', 'RFID'], 'codeType', old.codeType), replacesCardId: old._id });
  pushHistory(fresh, actor, 'ISSUED_AS_REPLACEMENT', { to: 'ACTIVE', note: reason });
  const prev = old.status;
  old.status = 'REPLACED';
  old.statusChangedAt = new Date();
  old.statusReason = reason;
  old.replacedByCardId = fresh._id;
  pushHistory(old, actor, 'REPLACED', { from: prev, to: 'REPLACED', note: reason });
  try { await fresh.save(); } catch (err) {
    if (err?.code === 11000) throw new AppError('That card code is already in use.', 409, [], 'DUPLICATE');
    throw err;
  }
  await old.save();
  return { old: presentCard(old.toObject()), card: presentCard(fresh.toObject()) };
}

export async function cardHistory(id) {
  const card = await IdCard.findById(assertObjectId(id)).lean();
  if (!card) throw new AppError('Card not found', 404);
  const chain = [card];
  let prev = card.replacesCardId;
  while (prev && chain.length < 20) {
    // eslint-disable-next-line no-await-in-loop
    const c = await IdCard.findById(prev).lean();
    if (!c) break;
    chain.push(c);
    prev = c.replacesCardId;
  }
  const events = await CheckpointEvent.find({ cardId: { $in: chain.map((c) => c._id) } }).sort({ scannedAt: -1 }).limit(100).lean();
  return { cards: chain.map(presentCard), events: events.map(dto) };
}

// ── scans ────────────────────────────────────────────────────────────────

/** True when the student may leave now: a release at the gate today, or an out-pass in force. */
async function departureAuthorised(studentId, at) {
  const day = schoolDay(at);
  const since = new Date(day.getTime() - 330 * 60_000);
  if (await ReleaseLog.exists({ studentId, at: { $gte: since }, receivedByKind: { $ne: 'SCHOOL' } })) return 'RELEASED';
  const pass = await OutPass.findOne({ studentId, status: { $in: ['APPROVED', 'OUT'] }, fromAt: { $lte: new Date(at.getTime() + 60 * 60_000) }, toAt: { $gte: at } }).lean();
  if (pass) return 'OUTPASS';
  return null;
}

/**
 * One scan. `ctx` is { device } for a reader or { actor } for staff scanning
 * with a phone. Returns what happened, never throws for a refused card (the
 * refusal is itself the record).
 */
export async function scanOne(ctx, body = {}) {
  const settings = await getSettings();
  const device = ctx.device ?? null;
  const code = requireText(body.code, 'code', { max: 64 });
  const point = device?.checkpoint?.point ?? oneOf(body.point, CHECKPOINT_POINTS, 'point');
  const scannedAt = body.scannedAt ? new Date(body.scannedAt) : new Date();
  if (Number.isNaN(scannedAt.getTime())) throw new AppError('scannedAt is not a valid time', 400);
  if (scannedAt.getTime() > Date.now() + 2 * 60_000) throw new AppError('scannedAt is in the future', 400);
  const deviceScanId = device && body.scanId !== undefined && body.scanId !== null ? String(body.scanId).slice(0, 80) : null;

  if (deviceScanId && await CheckpointEvent.exists({ deviceId: device._id, deviceScanId })) {
    return { result: 'DUPLICATE_IGNORED', duplicate: true, message: 'This scan was already received.' };
  }
  const card = await IdCard.findOne({ code }).lean();
  const base = {
    code, point, scannedAt, receivedAt: new Date(), deviceId: device?._id ?? null, deviceScanId,
    locationLabel: device?.checkpoint?.locationLabel ?? optionalText(body.locationLabel, { max: 120 }) ?? POINT_LABEL[point],
    vehicleId: device?.checkpoint?.vehicleId ?? (body.vehicleId && mongoose.isValidObjectId(body.vehicleId) ? body.vehicleId : null),
    source: device ? 'DEVICE' : 'STAFF', scannedByProfileId: ctx.actor?.profileId ?? null,
  };
  const store = async (doc) => {
    try { return await CheckpointEvent.create(doc); } catch (err) {
      if (err?.code === 11000) return null; // the same device scan arrived twice at once
      throw err;
    }
  };

  if (!card) {
    const ev = await store({ ...base, result: 'REJECTED_UNKNOWN', flags: ['UNKNOWN_CARD'] });
    await raiseAlert({ kind: 'UNKNOWN_CARD', department: 'GATE', message: `An unknown card was presented at ${base.locationLabel}`, dedupeKey: `card:unknown:${code}:${schoolDay(scannedAt).toISOString().slice(0, 10)}`, refType: 'CheckpointEvent', refId: ev?._id ?? null, notifyPermission: 'checkpoints.manage', link: '/gate?tab=events' });
    return { result: 'REJECTED_UNKNOWN', eventId: ev ? String(ev._id) : null, message: 'Card not recognised.' };
  }
  const holder = { cardId: card._id, holderType: card.holderType, studentId: card.studentId, profileId: card.profileId, holderName: card.holderName };
  if (card.status !== 'ACTIVE') {
    const ev = await store({ ...base, ...holder, result: 'REJECTED_REVOKED', flags: [`CARD_${card.status}`] });
    await raiseAlert({
      kind: 'REVOKED_CARD_USED', severity: 'CRITICAL', department: 'GATE', studentId: card.studentId,
      message: `A ${card.status.toLowerCase()} card (${card.holderName}) was presented at ${base.locationLabel}`,
      dedupeKey: `card:${card._id}:blocked:${schoolDay(scannedAt).toISOString().slice(0, 10)}:${point}`, refType: 'CheckpointEvent', refId: ev?._id ?? null,
      notifyPermission: 'checkpoints.manage', link: '/gate?tab=events', now: scannedAt,
    });
    return { result: 'REJECTED_REVOKED', eventId: ev ? String(ev._id) : null, holderName: card.holderName, message: `This card is ${card.status.toLowerCase()} and was refused.` };
  }

  // Duplicate window: the same card at the same point a moment ago.
  const windowMs = settings.checkpoints.duplicateWindowSeconds * 1000;
  const recent = await CheckpointEvent.findOne({ cardId: card._id, point, result: 'ACCEPTED', scannedAt: { $gte: new Date(scannedAt.getTime() - windowMs), $lte: new Date(scannedAt.getTime() + windowMs) } }).lean();
  if (recent) return { result: 'DUPLICATE_IGNORED', duplicate: true, eventId: String(recent._id), holderName: card.holderName, message: 'Already recorded a moment ago.' };

  const flags = [];
  let tripId = null;
  if (card.studentId) {
    if (point === 'GATE_OUT') {
      const why = await departureAuthorised(card.studentId, scannedAt);
      if (why === 'OUTPASS') await outpass.recordGate(SCAN_ACTOR, card.studentId, 'OUT', { at: scannedAt, via: 'SCAN' }).catch(() => null);
      if (!why && settings.checkpoints.flagUnauthorisedDeparture) {
        flags.push('NO_AUTHORISED_PICKUP');
        await raiseAlert({
          kind: 'UNAUTHORISED_DEPARTURE', severity: 'CRITICAL', department: 'GATE', studentId: card.studentId,
          message: `${card.holderName} left through ${base.locationLabel} with no recorded release or out-pass`,
          dedupeKey: `gate:out:${card.studentId}:${schoolDay(scannedAt).toISOString().slice(0, 10)}`, notifyPermission: ['visitors.manage', 'checkpoints.manage'],
          link: '/gate?tab=events', now: scannedAt,
        });
      }
    }
    if (point === 'GATE_IN') await outpass.recordGate(SCAN_ACTOR, card.studentId, 'IN', { at: scannedAt, via: 'SCAN' }).catch(() => null);
    if ((point === 'BUS_BOARD' || point === 'BUS_ALIGHT') && base.vehicleId) {
      const trip = await trips.tripForVehicleToday(base.vehicleId, scannedAt);
      if (!trip) flags.push('NO_TRIP_FOR_VEHICLE');
      else {
        tripId = trip._id;
        try {
          if (point === 'BUS_BOARD') await trips.board(SCAN_ACTOR, 'ALL', trip._id, { studentId: card.studentId }, { via: 'SCAN', at: scannedAt });
          else await trips.alight(SCAN_ACTOR, 'ALL', trip._id, { studentId: card.studentId }, { via: 'SCAN', at: scannedAt });
        } catch (err) {
          flags.push(err?.code ?? 'TRIP_UPDATE_FAILED');
        }
      }
    }
  }
  const ev = await store({ ...base, ...holder, tripId, result: 'ACCEPTED', flags });
  if (!ev) return { result: 'DUPLICATE_IGNORED', duplicate: true, message: 'This scan was already received.' };
  return { result: 'ACCEPTED', eventId: String(ev._id), holderName: card.holderName, flags, message: flags.length ? `Recorded, with a flag: ${flags.join(', ').toLowerCase().replace(/_/g, ' ')}.` : 'Recorded.' };
}

/** A device may send a buffered batch: { scans: [...] }. */
export async function scan(ctx, body = {}) {
  if (Array.isArray(body.scans)) {
    if (body.scans.length > 200) throw new AppError('At most 200 scans per request', 413);
    const results = [];
    for (const s of body.scans) {
      try {
        // eslint-disable-next-line no-await-in-loop -- order matters (in before out)
        results.push(await scanOne(ctx, s));
      } catch (err) {
        results.push({ result: 'ERROR', message: err.message });
      }
    }
    return { results, accepted: results.filter((r) => r.result === 'ACCEPTED').length, duplicates: results.filter((r) => r.duplicate).length };
  }
  return scanOne(ctx, body);
}

// ── reading ──────────────────────────────────────────────────────────────

function dayRange(dateStr) {
  const day = parseSchoolDay(dateStr);
  const start = new Date(day.getTime() - 330 * 60_000);
  return { day, start, end: new Date(start.getTime() + 86_400_000) };
}

export async function events(query = {}) {
  const { start, end } = dayRange(query.date);
  const filter = { scannedAt: { $gte: start, $lt: end } };
  if (query.point) filter.point = oneOf(query.point, CHECKPOINT_POINTS, 'point');
  if (query.studentId && mongoose.isValidObjectId(query.studentId)) filter.studentId = query.studentId;
  if (query.result) filter.result = String(query.result).toUpperCase();
  if (query.flagged === 'true') filter.$or = [{ 'flags.0': { $exists: true } }, { result: { $ne: 'ACCEPTED' } }];
  const rows = await CheckpointEvent.find(filter).sort({ scannedAt: -1 }).limit(500).lean();
  return { events: rows.map((r) => ({ ...dto(r), pointLabel: POINT_LABEL[r.point] })), disclaimer: CHECKPOINT_DISCLAIMER };
}

/** A parent's view: their own children's gate and bus checkpoints for the day. */
export async function myChildren(actor, query = {}) {
  const ids = await ownStudentIds(actor);
  const { start, end } = dayRange(query.date);
  const [students, rows] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('_id firstName lastName').lean(),
    ids.length ? CheckpointEvent.find({ studentId: { $in: ids }, scannedAt: { $gte: start, $lt: end }, result: 'ACCEPTED', point: { $in: ['GATE_IN', 'GATE_OUT', 'BUS_BOARD', 'BUS_ALIGHT'] } }).sort({ scannedAt: 1 }).lean() : [],
  ]);
  return {
    children: students.map((s) => ({
      studentId: String(s._id), name: studentName(s),
      events: rows.filter((r) => String(r.studentId) === String(s._id)).map((r) => ({ id: String(r._id), point: r.point, pointLabel: POINT_LABEL[r.point], at: r.scannedAt, location: r.locationLabel })),
    })),
    disclaimer: CHECKPOINT_DISCLAIMER,
  };
}

/**
 * Attendance suggestions from gate-in scans for a day (and optionally a
 * section). They are suggestions for the teacher: nothing here writes the
 * register, and a mark the teacher already made is shown, not changed.
 */
export async function attendanceSuggestions(query = {}) {
  const { day, start, end } = dayRange(query.date);
  const enrolFilter = { status: 'ACTIVE' };
  if (query.sectionId && mongoose.isValidObjectId(query.sectionId)) enrolFilter.sectionId = query.sectionId;
  const enrolments = await Enrollment.find(enrolFilter).select('_id studentId sectionId rollNo').limit(3000).lean();
  const studentIds = enrolments.map((e) => e.studentId);
  const [scans, marks, students] = await Promise.all([
    CheckpointEvent.find({ studentId: { $in: studentIds }, point: { $in: ['GATE_IN', 'BUS_BOARD'] }, result: 'ACCEPTED', scannedAt: { $gte: start, $lt: end } }).select('studentId scannedAt point').lean(),
    AttendanceRecord.find({ enrollmentId: { $in: enrolments.map((e) => e._id) }, date: day, periodNo: null }).select('enrollmentId status').lean(),
    Student.find({ _id: { $in: studentIds } }).select('_id firstName lastName').lean(),
  ]);
  const firstScan = new Map();
  for (const s of scans) if (!firstScan.has(String(s.studentId)) || s.scannedAt < firstScan.get(String(s.studentId)).scannedAt) firstScan.set(String(s.studentId), s);
  const markBy = new Map(marks.map((m) => [String(m.enrollmentId), m.status]));
  const nameBy = new Map(students.map((s) => [String(s._id), studentName(s)]));
  const rows = [];
  for (const e of enrolments) {
    const scan = firstScan.get(String(e.studentId));
    const mark = markBy.get(String(e._id)) ?? null;
    let suggestion = null;
    if (scan && !mark) suggestion = 'SUGGEST_PRESENT';
    else if (scan && mark === 'ABSENT') suggestion = 'CHECK_MARKED_ABSENT_BUT_SCANNED_IN';
    else if (!scan && (mark === 'PRESENT' || mark === 'LATE')) suggestion = 'NO_SCAN_BUT_MARKED_PRESENT';
    if (suggestion) rows.push({ studentId: String(e.studentId), enrollmentId: String(e._id), name: nameBy.get(String(e.studentId)), rollNo: e.rollNo, sectionId: String(e.sectionId), firstScanAt: scan?.scannedAt ?? null, registerMark: mark, suggestion });
  }
  return { date: day, rows, note: 'Suggestions only. The class register is the record and is never changed from scans. ' + CHECKPOINT_DISCLAIMER };
}
