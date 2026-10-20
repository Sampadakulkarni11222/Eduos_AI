import { PtmRound, PtmSlot, PtmBooking, PtmWaitlist, PtmLock, PTM_MODES } from '../../models/ptm.model.js';
import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { Section } from '../../models/academics.model.js';
import { Student } from '../../models/student.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { createParentMeeting, cancelParentMeeting, whenText } from '../lectures/lecture.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, parseDate, requireText, optionalText, oneOf, dto, profileNames,
} from '../ops/common.js';
import {
  istInstant, istDay, istYmd, istHm, childrenOf, isGuardianOf, teachersOfSection, activeEnrollment, loadStudent, studentLabel, classLabel,
  assertStaffProfile,
} from './relations.js';
import { childBriefing } from './briefing.js';

/**
 * PTM booking.
 *
 * A round says when the PTM runs and for which classes. Teachers (class and
 * subject teachers) give their availability; slots are generated from it at
 * the round's slot length plus buffer. Families book a slot for each child
 * with each of that child's teachers; staff can book on a family's behalf.
 *
 * Two rules are enforced by the database, not by a read-then-write:
 *  - a slot holds at most one active booking (unique partial index), so two
 *    families racing for the last slot get one winner and one clear refusal;
 *  - a child has at most one active meeting per teacher per round.
 * A parent cannot be in two meetings at once: their bookings are checked one
 * at a time under a short per-parent lease, then for overlap.
 *
 * Meetings and calls are never recorded. A meeting's outcome holds a summary
 * and agreed actions (which become tasks); a safeguarding concern is not a PTM
 * note and is refused here, with a pointer to the safeguarding module.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OFFER_HOLD_HOURS = 12;
const LOCK_MS = 15_000;
const SAFEGUARDING_HINT = 'A safeguarding concern is not written into PTM notes. Raise it through "Report a safeguarding concern", which goes straight to the designated safeguarding lead.';


// ── presenters ─────────────────────────────────────────────────────────

function presentRound(r, extra = {}) {
  const d = dto(r);
  const now = Date.now();
  return {
    id: d.id, refNo: d.refNo, title: d.title, description: d.description ?? null,
    startsOn: istYmd(d.startsOn), endsOn: istYmd(d.endsOn), mode: d.mode, sectionIds: (d.sectionIds ?? []).map(String),
    slotMinutes: d.slotMinutes, bufferMinutes: d.bufferMinutes, bookingOpensAt: d.bookingOpensAt, bookingClosesAt: d.bookingClosesAt,
    changeCutoffHours: d.changeCutoffHours, defaultVenue: d.defaultVenue ?? null, status: d.status, calendarEventId: d.calendarEventId ? String(d.calendarEventId) : null,
    bookingOpen: d.status === 'OPEN' && now >= new Date(d.bookingOpensAt).getTime() && now <= new Date(d.bookingClosesAt).getTime(),
    ...extra,
  };
}

function presentSlot(s) {
  return {
    id: String(s._id), roundId: String(s.roundId), teacherProfileId: String(s.teacherProfileId), teacherName: s.teacherName ?? null,
    startsAt: s.startsAt, endsAt: s.endsAt, date: istYmd(s.startsAt), time: `${istHm(s.startsAt)}–${istHm(s.endsAt)}`, when: whenText(s.startsAt),
    mode: s.mode, venue: s.venue ?? null, status: s.status, heldUntil: s.heldUntil ?? null,
  };
}

function presentBooking(b, { names = new Map(), students = new Map(), staffView = false } = {}) {
  const out = {
    id: String(b._id), refNo: b.refNo, roundId: String(b.roundId), slotId: String(b.slotId),
    teacherProfileId: String(b.teacherProfileId), teacherName: names.get(String(b.teacherProfileId)) ?? null,
    parentProfileId: String(b.parentProfileId), parentName: names.get(String(b.parentProfileId)) ?? null,
    studentId: String(b.studentId), studentName: students.get(String(b.studentId)) ?? null,
    startsAt: b.startsAt, endsAt: b.endsAt, when: whenText(b.startsAt), time: `${istHm(b.startsAt)}–${istHm(b.endsAt)}`, date: istYmd(b.startsAt),
    mode: b.mode, venue: b.venue ?? null, online: Boolean(b.onlineClassId), onlineClassId: b.onlineClassId ? String(b.onlineClassId) : null,
    status: b.status, active: b.active, assisted: b.assisted, preferences: b.preferences ?? {}, parentNote: b.parentNote ?? null,
    checkedInAt: b.checkedInAt ?? null, cancelReason: b.cancelReason ?? null,
    outcome: b.outcome?.recordedAt ? {
      summary: b.outcome.summary, nextFollowUpOn: b.outcome.nextFollowUpOn ?? null, recordedAt: b.outcome.recordedAt,
      actions: (b.outcome.actions ?? []).map((a) => ({ id: String(a._id), title: a.title, ownerType: a.ownerType, ownerName: a.ownerName, dueOn: a.dueOn, status: a.status, taskId: a.taskId ? String(a.taskId) : null })),
    } : null,
  };
  if (staffView) out.history = b.history ?? [];
  return out;
}

async function decorate(bookings, opts = {}) {
  const names = await profileNames(bookings.flatMap((b) => [b.teacherProfileId, b.parentProfileId]));
  const studs = await Student.find({ _id: { $in: bookings.map((b) => b.studentId) } }).select('firstName lastName').lean();
  const students = new Map(studs.map((s) => [String(s._id), studentLabel(s)]));
  return bookings.map((b) => presentBooking(b, { names, students, ...opts }));
}

// ── rounds ─────────────────────────────────────────────────────────────

async function loadRound(id) {
  const r = await PtmRound.findById(assertObjectId(id, 'roundId'));
  if (!r) throw new AppError('PTM round not found', 404);
  return r;
}

function roundFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  if (body.description !== undefined) out.description = optionalText(body.description, { max: 2000 }) || null;
  if (!partial || body.startsOn !== undefined) out.startsOn = istDay(istInstant(body.startsOn, '12:00'));
  if (!partial || body.endsOn !== undefined) out.endsOn = istDay(istInstant(body.endsOn ?? body.startsOn, '12:00'));
  if (body.mode !== undefined || !partial) out.mode = oneOf(body.mode, PTM_MODES, 'mode', 'IN_PERSON');
  if (body.slotMinutes !== undefined) {
    const n = Number(body.slotMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 120) throw new AppError('A slot is 5 to 120 minutes.', 400);
    out.slotMinutes = n;
  }
  if (body.bufferMinutes !== undefined) {
    const n = Number(body.bufferMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new AppError('The buffer is 0 to 60 minutes.', 400);
    out.bufferMinutes = n;
  }
  if (body.changeCutoffHours !== undefined) {
    const n = Number(body.changeCutoffHours);
    if (!Number.isFinite(n) || n < 0 || n > 168) throw new AppError('The change cut-off is 0 to 168 hours.', 400);
    out.changeCutoffHours = n;
  }
  if (body.bookingOpensAt !== undefined || !partial) out.bookingOpensAt = parseDate(body.bookingOpensAt, 'bookingOpensAt') ?? new Date();
  if (body.bookingClosesAt !== undefined || !partial) out.bookingClosesAt = parseDate(body.bookingClosesAt, 'bookingClosesAt');
  if (body.defaultVenue !== undefined) out.defaultVenue = optionalText(body.defaultVenue, { max: 200 }) || null;
  return out;
}

export async function createRound(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the principal or administration can set up a PTM round.', 403, [], 'FORBIDDEN');
  const f = roundFields(body);
  if (f.endsOn < f.startsOn) throw new AppError('The round ends before it starts.', 400, [], 'BAD_DATES');
  // Booking closes by default the evening before the first day.
  if (!f.bookingClosesAt) f.bookingClosesAt = new Date(f.startsOn.getTime() - (5.5 + 6) * HOUR);
  if (f.bookingClosesAt <= f.bookingOpensAt) throw new AppError('Booking must open before it closes.', 400, [], 'BAD_DATES');
  const sectionIds = [...new Set((Array.isArray(body.sectionIds) ? body.sectionIds : []).map((s) => assertObjectId(s, 'sectionId')))];
  if (sectionIds.length && (await Section.countDocuments({ _id: { $in: sectionIds } })) !== sectionIds.length) throw new AppError('One of the classes was not found.', 404);
  const round = new PtmRound({ ...f, sectionIds, refNo: await nextRef('PTM'), status: 'OPEN', createdByProfileId: actor.profileId, history: [] });
  // The PTM appears on the school calendar.
  const event = await CalendarEvent.create({
    title: round.title, description: round.description ?? 'Parent–teacher meeting. Book your slots in EduOS.', type: 'PTM',
    startsAt: istInstant(istYmd(round.startsOn), '08:00'), endsAt: istInstant(istYmd(round.endsOn), '18:00'),
    audience: sectionIds.length ? { sectionIds } : { all: true }, createdByProfileId: actor.profileId,
  });
  round.calendarEventId = event._id;
  pushHistory(round, actor, 'CREATED', { to: 'OPEN' });
  await round.save();
  return presentRound(round.toObject());
}

export async function updateRound(actor, scope, id, body = {}) {
  if (scope !== 'ALL') throw new AppError('Only the principal or administration can change a PTM round.', 403, [], 'FORBIDDEN');
  const round = await loadRound(id);
  if (['CANCELLED'].includes(round.status)) throw new AppError('This round is cancelled.', 409, [], 'ROUND_CLOSED');
  const f = roundFields(body, { partial: true });
  Object.assign(round, f);
  if (body.status !== undefined) round.status = oneOf(body.status, ['DRAFT', 'OPEN', 'CLOSED'], 'status');
  pushHistory(round, actor, 'UPDATED');
  await round.save();
  if (round.calendarEventId) await CalendarEvent.updateOne({ _id: round.calendarEventId }, { $set: { title: round.title, startsAt: istInstant(istYmd(round.startsOn), '08:00'), endsAt: istInstant(istYmd(round.endsOn), '18:00') } });
  return presentRound(round.toObject());
}

export async function cancelRound(actor, scope, id, body = {}) {
  if (scope !== 'ALL') throw new AppError('Only the principal or administration can cancel a PTM round.', 403, [], 'FORBIDDEN');
  const reason = requireText(body.reason, 'reason', { max: 300 });
  const round = await loadRound(id);
  if (round.status === 'CANCELLED') throw new AppError('This round is already cancelled.', 409, [], 'ROUND_CLOSED');
  const active = await PtmBooking.find({ roundId: round._id, active: true, status: 'BOOKED' });
  for (const b of active) {
    // eslint-disable-next-line no-await-in-loop
    await releaseBooking(b, actor, { reason, status: 'CANCELLED', reoffer: false });
  }
  await PtmSlot.updateMany({ roundId: round._id, status: { $in: ['OPEN', 'HELD'] } }, { $set: { status: 'CANCELLED' } });
  await PtmWaitlist.updateMany({ roundId: round._id, status: { $in: ['WAITING', 'OFFERED'] } }, { $set: { status: 'CANCELLED' } });
  round.status = 'CANCELLED';
  pushHistory(round, actor, 'CANCELLED', { to: 'CANCELLED', note: reason });
  await round.save();
  if (round.calendarEventId) await CalendarEvent.updateOne({ _id: round.calendarEventId }, { $set: { deletedAt: new Date() } });
  return { ...presentRound(round.toObject()), bookingsCancelled: active.length };
}

/** Rounds the caller can see: all for managers, the rounds covering a teacher's or a family's classes otherwise. */
export async function listRounds(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status) filter.status = oneOf(query.status, ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'], 'status');
  else if (scope !== 'ALL') filter.status = { $in: ['OPEN', 'CLOSED'] };
  if (scope !== 'ALL') {
    const sections = actor.roleKey === 'TEACHER' ? await getTeacherSectionIds(actor.profileId) : (await childrenOf(actor.profileId)).map((c) => c.sectionId).filter(Boolean);
    filter.$or = [{ sectionIds: { $size: 0 } }, { sectionIds: { $in: sections } }];
  }
  const rounds = await PtmRound.find(filter).sort({ startsOn: -1 }).limit(50).lean();
  const counts = await PtmBooking.aggregate([{ $match: { roundId: { $in: rounds.map((r) => r._id) }, active: true } }, { $group: { _id: '$roundId', n: { $sum: 1 } } }]);
  const slotCounts = await PtmSlot.aggregate([{ $match: { roundId: { $in: rounds.map((r) => r._id) }, status: { $ne: 'CANCELLED' } } }, { $group: { _id: '$roundId', n: { $sum: 1 }, open: { $sum: { $cond: [{ $eq: ['$status', 'OPEN'] }, 1, 0] } } } }]);
  const byRound = new Map(counts.map((c) => [String(c._id), c.n]));
  const slotsBy = new Map(slotCounts.map((c) => [String(c._id), c]));
  return rounds.map((r) => presentRound(r, scope === 'ALL' || actor.roleKey === 'TEACHER' ? { bookings: byRound.get(String(r._id)) ?? 0, slots: slotsBy.get(String(r._id))?.n ?? 0, openSlots: slotsBy.get(String(r._id))?.open ?? 0 } : {}));
}

export async function getRound(actor, scope, id) {
  const round = await loadRound(id);
  const visible = (await listRounds(actor, scope, { status: round.status })).some((r) => r.id === String(round._id));
  if (!visible) throw new AppError('PTM round not found', 404);
  return presentRound(round.toObject());
}

// ── availability and slots ─────────────────────────────────────────────

/** Whether a teacher meets families in this round (teaches one of its classes, or is the principal). */
async function teacherInRound(round, teacherProfileId) {
  const person = await assertStaffProfile(teacherProfileId, 'teacher');
  if (person.roleKey === 'PRINCIPAL') return person;
  const mine = await getTeacherSectionIds(teacherProfileId);
  if (!mine.length) throw new AppError('That person does not teach a class.', 400, [], 'NOT_A_TEACHER');
  if (round.sectionIds.length && !round.sectionIds.some((s) => mine.includes(String(s)))) {
    throw new AppError('That teacher does not teach any class in this PTM round.', 400, [], 'NOT_IN_ROUND');
  }
  return person;
}

/**
 * Adds availability windows and generates the slots inside them. Slots are
 * `slotMinutes` long with `bufferMinutes` between them; a window that does
 * not fit a whole slot at its end leaves that remainder unused. A slot that
 * would overlap one the teacher already has is skipped and reported.
 */
export async function addAvailability(actor, scope, roundId, body = {}) {
  requireProfile(actor);
  const round = await loadRound(roundId);
  if (!['OPEN', 'DRAFT'].includes(round.status)) throw new AppError('This round is not open.', 409, [], 'ROUND_CLOSED');
  const teacherId = scope === 'ALL' && body.teacherProfileId ? assertObjectId(body.teacherProfileId, 'teacherProfileId') : actor.profileId;
  const teacher = await teacherInRound(round, teacherId);
  const windows = Array.isArray(body.windows) ? body.windows.slice(0, 20) : [];
  if (!windows.length) throw new AppError('Give at least one window: a date, a start and an end time.', 400, [], 'NO_WINDOWS');
  const first = round.startsOn.getTime(); const last = round.endsOn.getTime();
  const existing = await PtmSlot.find({ teacherProfileId: teacherId, status: { $ne: 'CANCELLED' } }).select('startsAt endsAt').lean();
  const created = []; const skipped = [];
  for (const w of windows) {
    const from = istInstant(w.date, w.from);
    const to = istInstant(w.date, w.to);
    const day = istDay(from).getTime();
    if (day < first || day > last) throw new AppError(`${w.date} is outside this round (${istYmd(round.startsOn)} to ${istYmd(round.endsOn)}).`, 400, [], 'OUTSIDE_ROUND');
    if (to <= from) throw new AppError('A window must end after it starts.', 400, [], 'BAD_WINDOW');
    let mode = round.mode === 'BOTH' ? oneOf(w.mode, PTM_MODES, 'mode', 'BOTH') : round.mode;
    if (round.mode !== 'BOTH' && w.mode && w.mode !== round.mode) mode = round.mode;
    const venue = optionalText(w.venue, { max: 200 }) || round.defaultVenue || null;
    const step = (round.slotMinutes + round.bufferMinutes) * 60_000;
    for (let t = from.getTime(); t + round.slotMinutes * 60_000 <= to.getTime(); t += step) {
      const startsAt = new Date(t); const endsAt = new Date(t + round.slotMinutes * 60_000);
      if (existing.some((e) => e.startsAt < endsAt && e.endsAt > startsAt)) { skipped.push({ startsAt, reason: 'overlaps an existing slot' }); continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        const slot = await PtmSlot.create({ roundId: round._id, teacherProfileId: teacherId, teacherName: teacher.name, startsAt, endsAt, mode, venue, status: 'OPEN' });
        existing.push({ startsAt, endsAt });
        created.push(presentSlot(slot));
      } catch (err) {
        if (err?.code !== 11000) throw err;
        skipped.push({ startsAt, reason: 'already exists' });
      }
    }
  }
  return { created: created.length, skipped, slots: created };
}

async function loadSlot(id) {
  const s = await PtmSlot.findById(assertObjectId(id, 'slotId'));
  if (!s) throw new AppError('Slot not found', 404);
  return s;
}

/** Takes an unbooked slot out of use (a teacher's break, a clash). */
export async function blockSlot(actor, scope, slotId) {
  const slot = await loadSlot(slotId);
  if (scope !== 'ALL' && String(slot.teacherProfileId) !== String(actor.profileId)) throw new AppError('Slot not found', 404);
  const done = await PtmSlot.findOneAndUpdate({ _id: slot._id, status: { $in: ['OPEN'] } }, { $set: { status: 'BLOCKED' } }, { new: true });
  if (!done) throw new AppError('Only an open, unbooked slot can be blocked. Cancel the booking first.', 409, [], 'SLOT_IN_USE');
  return presentSlot(done.toObject());
}

export async function unblockSlot(actor, scope, slotId) {
  const slot = await loadSlot(slotId);
  if (scope !== 'ALL' && String(slot.teacherProfileId) !== String(actor.profileId)) throw new AppError('Slot not found', 404);
  const done = await PtmSlot.findOneAndUpdate({ _id: slot._id, status: 'BLOCKED' }, { $set: { status: 'OPEN' } }, { new: true });
  if (!done) throw new AppError('That slot is not blocked.', 409, [], 'NOT_BLOCKED');
  await offerFreedSlot(done);
  return presentSlot(done.toObject());
}

/** A teacher's slots in a round (their own; any teacher's for a manager). */
export async function listSlots(actor, scope, roundId, query = {}) {
  requireProfile(actor);
  await loadRound(roundId);
  const teacherId = scope === 'ALL' && query.teacherProfileId ? assertObjectId(query.teacherProfileId, 'teacherProfileId') : actor.profileId;
  const slots = await PtmSlot.find({ roundId, teacherProfileId: teacherId, status: { $ne: 'CANCELLED' } }).sort({ startsAt: 1 }).lean();
  return slots.map(presentSlot);
}

// ── what a family can book ─────────────────────────────────────────────

/**
 * For a family (or staff booking for one): each child in the round, each of
 * the child's teachers with their free slots, and the bookings already made.
 */
export async function bookingOptions(actor, scopes, roundId, query = {}) {
  requireProfile(actor);
  const round = await loadRound(roundId);
  let parentId = actor.profileId;
  let children;
  if (scopes['ptm.book'] && !scopes['ptm.manage']) {
    children = await childrenOf(actor.profileId);
  } else {
    if (!query.studentId) throw new AppError('Choose the student you are booking for.', 400, [], 'STUDENT_REQUIRED');
    const student = await loadStudent(query.studentId);
    const e = await activeEnrollment(student._id);
    children = [{ studentId: String(student._id), name: studentLabel(student), sectionId: e ? String(e.sectionId?._id ?? e.sectionId) : null, className: classLabel(e?.sectionId) }];
    parentId = query.parentProfileId ? assertObjectId(query.parentProfileId, 'parentProfileId') : null;
  }
  const inRound = children.filter((c) => c.sectionId && (!round.sectionIds.length || round.sectionIds.map(String).includes(c.sectionId)));
  const now = new Date();
  const out = [];
  for (const c of inRound) {
    // eslint-disable-next-line no-await-in-loop
    const teachers = await teachersOfSection(c.sectionId);
    // eslint-disable-next-line no-await-in-loop
    const slots = await PtmSlot.find({ roundId: round._id, teacherProfileId: { $in: teachers.map((t) => t.profileId) }, startsAt: { $gt: now }, status: { $in: ['OPEN', 'HELD'] } }).sort({ startsAt: 1 }).lean();
    // eslint-disable-next-line no-await-in-loop
    const booked = await PtmBooking.find({ roundId: round._id, studentId: c.studentId, active: true }).lean();
    // eslint-disable-next-line no-await-in-loop
    const waiting = await PtmWaitlist.find({ roundId: round._id, studentId: c.studentId, status: { $in: ['WAITING', 'OFFERED'] } }).lean();
    // eslint-disable-next-line no-await-in-loop
    const bookings = await decorate(booked);
    const withSlots = teachers.map((t) => {
      const mine = slots.filter((s) => String(s.teacherProfileId) === t.profileId
        && (s.status === 'OPEN' || (s.status === 'HELD' && parentId && String(s.heldForProfileId) === String(parentId) && s.heldUntil > now)));
      const anyFree = slots.some((s) => String(s.teacherProfileId) === t.profileId && s.status === 'OPEN');
      const total = slots.filter((s) => String(s.teacherProfileId) === t.profileId).length;
      const w = waiting.find((x) => String(x.teacherProfileId) === t.profileId);
      return {
        ...t, slots: mine.map(presentSlot), hasSlots: total > 0 || bookings.some((b) => b.teacherProfileId === t.profileId),
        full: !anyFree, booking: bookings.find((b) => b.teacherProfileId === t.profileId) ?? null,
        waitlist: w ? { id: String(w._id), status: w.status, offeredSlotId: w.offeredSlotId ? String(w.offeredSlotId) : null, offerExpiresAt: w.offerExpiresAt } : null,
      };
    });
    out.push({ ...c, teachers: withSlots });
  }
  return { round: presentRound(round.toObject()), children: out };
}

// ── booking ────────────────────────────────────────────────────────────

/** A short lease so one parent's bookings are checked and written one at a time. */
async function withParentLock(parentProfileId, fn) {
  const key = `ptm:parent:${parentProfileId}`;
  const now = new Date();
  try {
    const got = await PtmLock.findOneAndUpdate({ key, lockedUntil: { $lt: now } }, { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } }, { upsert: true, new: true });
    if (!got) throw new AppError('Another booking for this family is being saved. Try again in a moment.', 409, [], 'BOOKING_BUSY');
  } catch (err) {
    if (err?.code === 11000) throw new AppError('Another booking for this family is being saved. Try again in a moment.', 409, [], 'BOOKING_BUSY');
    throw err;
  }
  try { return await fn(); } finally { await PtmLock.updateOne({ key }, { $set: { lockedUntil: new Date(0) } }); }
}

/** Who the booking is for, and whether the caller may make it. */
async function resolveBooker(actor, scopes, body, slot) {
  const studentId = assertObjectId(body.studentId, 'studentId');
  if (scopes['ptm.book'] && !scopes['ptm.manage']) {
    if (!(await isGuardianOf(actor.profileId, studentId))) throw new AppError('You can only book for your own child.', 403, [], 'NOT_YOUR_CHILD');
    return { parentId: actor.profileId, studentId, assisted: false };
  }
  // Staff booking on a family's behalf.
  if (!scopes['ptm.manage']) throw new AppError('Missing permission: ptm.manage', 403);
  if (scopes['ptm.manage'] !== 'ALL' && String(slot.teacherProfileId) !== String(actor.profileId)) {
    throw new AppError('You can book families only into your own slots.', 403, [], 'NOT_YOUR_SLOT');
  }
  const parentId = assertObjectId(body.parentProfileId, 'parentProfileId');
  if (!(await isGuardianOf(parentId, studentId))) throw new AppError('That parent is not a guardian of this student.', 400, [], 'NOT_GUARDIAN');
  return { parentId, studentId, assisted: true };
}

async function assertParentFree(parentId, startsAt, endsAt, excludeBookingId = null) {
  const clash = await PtmBooking.findOne({
    parentProfileId: parentId, active: true, status: { $in: ['BOOKED', 'CHECKED_IN'] },
    startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt }, ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  }).lean();
  if (clash) {
    const [teacher] = (await profileNames([clash.teacherProfileId])).values();
    throw new AppError(`You already have a meeting${teacher ? ` with ${teacher}` : ''} at ${whenText(clash.startsAt)}. A parent cannot be in two meetings at once; choose another time.`, 409, [], 'PARENT_CLASH');
  }
}

async function claimSlot(actor, { slot, round, parentId, studentId, assisted, body, excludeBookingId = null }) {
  const now = new Date();
  if (round.status !== 'OPEN') throw new AppError('This PTM round is not open for booking.', 409, [], 'ROUND_CLOSED');
  if (!assisted && (now < round.bookingOpensAt || now > round.bookingClosesAt)) throw new AppError(`Booking ${now < round.bookingOpensAt ? `opens ${whenText(round.bookingOpensAt)}` : 'has closed'}. The school office can still book for you.`, 409, [], 'BOOKING_WINDOW');
  if (slot.startsAt <= now) throw new AppError('That slot has already started.', 409, [], 'SLOT_PAST');
  if (!['OPEN', 'HELD'].includes(slot.status)) throw new AppError('That slot is no longer available.', 409, [], 'SLOT_TAKEN');
  if (slot.status === 'HELD' && slot.heldUntil > now && String(slot.heldForProfileId) !== String(parentId)) throw new AppError('That slot is held for a family on the waiting list.', 409, [], 'SLOT_HELD');

  const student = await loadStudent(studentId);
  const enrol = await activeEnrollment(student._id);
  const sectionId = enrol ? String(enrol.sectionId?._id ?? enrol.sectionId) : null;
  if (!sectionId || (round.sectionIds.length && !round.sectionIds.map(String).includes(sectionId))) throw new AppError('This child\'s class is not part of this PTM round.', 400, [], 'NOT_IN_ROUND');
  const teachers = await teachersOfSection(sectionId);
  if (!teachers.some((t) => t.profileId === String(slot.teacherProfileId))) throw new AppError('That teacher does not teach this child.', 400, [], 'NOT_CHILDS_TEACHER');

  let mode = slot.mode;
  if (mode === 'BOTH') mode = oneOf(body.mode, ['IN_PERSON', 'ONLINE'], 'mode', 'IN_PERSON');
  if (mode === 'ONLINE' && body.mode === 'IN_PERSON' && slot.mode !== 'BOTH') throw new AppError('This slot is online only.', 400);

  await assertParentFree(parentId, slot.startsAt, slot.endsAt, excludeBookingId);

  let booking;
  try {
    booking = await PtmBooking.create({
      refNo: await nextRef('PTB'), roundId: round._id, slotId: slot._id, teacherProfileId: slot.teacherProfileId, parentProfileId: parentId,
      studentId: student._id, enrollmentId: enrol?._id ?? null, sectionId, startsAt: slot.startsAt, endsAt: slot.endsAt, mode,
      venue: mode === 'IN_PERSON' ? slot.venue : null, active: true, status: 'BOOKED', bookedByProfileId: actor.profileId, assisted,
      preferences: {
        language: optionalText(body.preferences?.language, { max: 60 }) || null,
        interpreter: body.preferences?.interpreter === true,
        accessibility: optionalText(body.preferences?.accessibility, { max: 300 }) || null,
      },
      parentNote: optionalText(body.parentNote, { max: 1000 }) || null,
      history: [{ action: assisted ? 'BOOKED_BY_STAFF' : 'BOOKED', actorProfileId: actor.profileId, actorName: actor.displayName ?? null, to: 'BOOKED' }],
    });
  } catch (err) {
    if (err?.code === 11000) {
      if (String(err.message).includes('slotId')) throw new AppError('Someone else has just booked that slot. Please choose another.', 409, [], 'SLOT_TAKEN');
      throw new AppError('This child already has a meeting with that teacher in this round. Reschedule it instead.', 409, [], 'ALREADY_BOOKED');
    }
    throw err;
  }
  const marked = await PtmSlot.findOneAndUpdate({ _id: slot._id, status: { $in: ['OPEN', 'HELD'] } }, { $set: { status: 'BOOKED', bookingId: booking._id, heldForProfileId: null, heldForWaitlistId: null, heldUntil: null } });
  if (!marked) {
    // The slot was blocked or cancelled between the read and the claim.
    await PtmBooking.updateOne({ _id: booking._id }, { $set: { active: false, status: 'CANCELLED', cancelReason: 'Slot withdrawn' } });
    throw new AppError('That slot is no longer available.', 409, [], 'SLOT_TAKEN');
  }
  if (mode === 'ONLINE') {
    const teacherName = slot.teacherName ?? null;
    const cls = await createParentMeeting({ hostProfileId: slot.teacherProfileId, hostName: teacherName, parentProfileId: parentId, title: `PTM: ${studentLabel(student)}`, startsAt: slot.startsAt, endsAt: slot.endsAt, actor });
    booking.onlineClassId = cls._id;
    await booking.save();
  }
  await PtmWaitlist.updateMany({ roundId: round._id, teacherProfileId: slot.teacherProfileId, studentId: student._id, status: { $in: ['WAITING', 'OFFERED'] } }, { $set: { status: 'BOOKED' } });
  await sendOperational({
    templateKey: 'PTM_BOOKED', recipientProfileIds: [String(parentId)], channels: ['EMAIL', 'WHATSAPP'],
    variables: { teacher: slot.teacherName ?? 'the teacher', student: studentLabel(student), when: whenText(slot.startsAt), venue: mode === 'ONLINE' ? 'online, join from EduOS' : slot.venue },
    link: '/ptm', idempotencyKey: `ptm:${booking._id}:booked`, relatedEntityType: 'PtmBooking', relatedEntityId: booking._id, requestedBy: actor.profileId,
  });
  return booking;
}

export async function book(actor, scopes, body = {}) {
  requireProfile(actor);
  const slot = await loadSlot(body.slotId);
  const round = await loadRound(slot.roundId);
  const who = await resolveBooker(actor, scopes, body, slot);
  const booking = await withParentLock(who.parentId, () => claimSlot(actor, { slot, round, ...who, body }));
  return (await decorate([booking.toObject()]))[0];
}

async function loadBooking(id) {
  const b = await PtmBooking.findById(assertObjectId(id, 'bookingId'));
  if (!b) throw new AppError('Booking not found', 404);
  return b;
}

/** Who may act on a booking: its family, its teacher, or a manager. */
function bookingRole(actor, scopes, b) {
  if (scopes['ptm.manage'] === 'ALL') return 'MANAGER';
  if (scopes['ptm.manage'] && String(b.teacherProfileId) === String(actor.profileId)) return 'TEACHER';
  if (scopes['ptm.book'] && String(b.parentProfileId) === String(actor.profileId)) return 'FAMILY';
  if (scopes['ptm.read'] === 'ALL') return 'VIEWER';
  return null;
}

function assertCutoff(role, b, round) {
  if (role !== 'FAMILY') return;
  const cutoff = new Date(b.startsAt).getTime() - (round.changeCutoffHours ?? 12) * HOUR;
  if (Date.now() > cutoff) throw new AppError(`Changes close ${round.changeCutoffHours} hours before the meeting. Please contact the school office.`, 409, [], 'CHANGE_CUTOFF');
}

/** Frees a booking's slot; a cancelled online meeting room goes with it. */
async function releaseBooking(b, actor, { reason, status = 'CANCELLED', reoffer = true, notify = true } = {}) {
  b.active = false;
  b.status = status;
  b.cancelReason = reason;
  b.cancelledAt = new Date();
  pushHistory(b, actor, status, { from: 'BOOKED', to: status, note: reason });
  await b.save();
  if (b.onlineClassId) await cancelParentMeeting(b.onlineClassId, { reason, actor });
  const slot = await PtmSlot.findOneAndUpdate({ _id: b.slotId, bookingId: b._id }, { $set: { status: 'OPEN', bookingId: null } }, { new: true });
  if (notify && status === 'CANCELLED') {
    const student = await Student.findById(b.studentId).select('firstName lastName').lean();
    const [teacher] = (await profileNames([b.teacherProfileId])).values();
    const recipients = [String(b.parentProfileId), String(b.teacherProfileId)].filter((id) => id !== String(actor?.profileId));
    await sendOperational({
      templateKey: 'PTM_CANCELLED', recipientProfileIds: recipients, channels: ['EMAIL', 'WHATSAPP'],
      variables: { teacher: teacher ?? 'the teacher', student: studentLabel(student), when: whenText(b.startsAt), reason },
      link: '/ptm', idempotencyKey: `ptm:${b._id}:cancelled`, relatedEntityType: 'PtmBooking', relatedEntityId: b._id, requestedBy: actor?.profileId ?? null,
    });
  }
  if (slot && reoffer) await offerFreedSlot(slot);
}

export async function cancelBooking(actor, scopes, id, body = {}) {
  requireProfile(actor);
  const b = await loadBooking(id);
  const role = bookingRole(actor, scopes, b);
  if (!role || role === 'VIEWER') throw new AppError('Booking not found', 404);
  if (b.status !== 'BOOKED') throw new AppError(`This booking is ${b.status.toLowerCase().replace('_', ' ')} and cannot be cancelled.`, 409, [], 'BOOKING_LOCKED');
  const reason = requireText(body.reason, 'reason', { max: 300 });
  assertCutoff(role, b, await loadRound(b.roundId));
  await releaseBooking(b, actor, { reason });
  return (await decorate([b.toObject()]))[0];
}

/** Moves a booking to another slot with the same teacher, keeping the family clash-free throughout. */
export async function reschedule(actor, scopes, id, body = {}) {
  requireProfile(actor);
  const b = await loadBooking(id);
  const role = bookingRole(actor, scopes, b);
  if (!role || role === 'VIEWER') throw new AppError('Booking not found', 404);
  if (b.status !== 'BOOKED') throw new AppError('Only a booked meeting can be moved.', 409, [], 'BOOKING_LOCKED');
  const reason = requireText(body.reason, 'reason', { max: 300 });
  const round = await loadRound(b.roundId);
  assertCutoff(role, b, round);
  const slot = await loadSlot(body.slotId);
  if (String(slot.roundId) !== String(b.roundId) || String(slot.teacherProfileId) !== String(b.teacherProfileId)) throw new AppError('Choose another slot with the same teacher in this round.', 400, [], 'SAME_TEACHER');
  const next = await withParentLock(String(b.parentProfileId), async () => {
    // The old booking stops counting toward the child-per-teacher rule only once the new one exists, so free it first inside the lease.
    b.active = false;
    await b.save();
    try {
      return await claimSlot(actor, { slot, round, parentId: String(b.parentProfileId), studentId: String(b.studentId), assisted: role !== 'FAMILY', body: { mode: body.mode ?? b.mode, preferences: b.preferences, parentNote: b.parentNote }, excludeBookingId: b._id });
    } catch (err) {
      b.active = true;
      await b.save();
      throw err;
    }
  });
  b.active = true; // releaseBooking sets it false again with the history entry
  b.rescheduledToId = next._id;
  await releaseBooking(b, actor, { reason, status: 'RESCHEDULED', notify: false });
  return (await decorate([next.toObject()]))[0];
}

// ── waitlist ───────────────────────────────────────────────────────────

export async function joinWaitlist(actor, scopes, body = {}) {
  requireProfile(actor);
  const round = await loadRound(body.roundId);
  const teacherId = assertObjectId(body.teacherProfileId, 'teacherProfileId');
  const studentId = assertObjectId(body.studentId, 'studentId');
  let parentId = actor.profileId;
  if (scopes['ptm.book'] && !scopes['ptm.manage']) {
    if (!(await isGuardianOf(actor.profileId, studentId))) throw new AppError('You can only book for your own child.', 403, [], 'NOT_YOUR_CHILD');
  } else {
    parentId = assertObjectId(body.parentProfileId, 'parentProfileId');
    if (!(await isGuardianOf(parentId, studentId))) throw new AppError('That parent is not a guardian of this student.', 400, [], 'NOT_GUARDIAN');
  }
  if (round.status !== 'OPEN') throw new AppError('This PTM round is not open.', 409, [], 'ROUND_CLOSED');
  const enrol = await activeEnrollment(studentId);
  const teachers = enrol ? await teachersOfSection(enrol.sectionId?._id ?? enrol.sectionId) : [];
  if (!teachers.some((t) => t.profileId === String(teacherId))) throw new AppError('That teacher does not teach this child.', 400, [], 'NOT_CHILDS_TEACHER');
  if (await PtmSlot.exists({ roundId: round._id, teacherProfileId: teacherId, status: 'OPEN', startsAt: { $gt: new Date() } })) throw new AppError('This teacher still has free slots. Book one of those.', 409, [], 'SLOTS_AVAILABLE');
  if (await PtmBooking.exists({ roundId: round._id, teacherProfileId: teacherId, studentId, active: true })) throw new AppError('This child already has a meeting with that teacher.', 409, [], 'ALREADY_BOOKED');
  try {
    const w = await PtmWaitlist.create({ roundId: round._id, teacherProfileId: teacherId, parentProfileId: parentId, studentId, status: 'WAITING' });
    return { id: String(w._id), status: w.status, position: await PtmWaitlist.countDocuments({ roundId: round._id, teacherProfileId: teacherId, status: 'WAITING', createdAt: { $lte: w.createdAt } }) };
  } catch (err) {
    if (err?.code === 11000) throw new AppError('This child is already on the waiting list for that teacher.', 409, [], 'ALREADY_WAITING');
    throw err;
  }
}

export async function leaveWaitlist(actor, scopes, id) {
  const w = await PtmWaitlist.findById(assertObjectId(id));
  if (!w || (String(w.parentProfileId) !== String(actor.profileId) && scopes['ptm.manage'] !== 'ALL')) throw new AppError('Waiting-list entry not found', 404);
  if (!['WAITING', 'OFFERED'].includes(w.status)) throw new AppError('This entry is closed.', 409);
  const offered = w.status === 'OFFERED' ? w.offeredSlotId : null;
  w.status = 'CANCELLED';
  await w.save();
  if (offered) {
    const slot = await PtmSlot.findOneAndUpdate({ _id: offered, status: 'HELD', heldForWaitlistId: w._id }, { $set: { status: 'OPEN', heldForWaitlistId: null, heldForProfileId: null, heldUntil: null } }, { new: true });
    if (slot) await offerFreedSlot(slot);
  }
  return { id: String(w._id), status: w.status };
}

/**
 * A slot became free: hold it for the first family waiting for that teacher,
 * for up to 12 hours (never past an hour before the meeting). Too close to the
 * meeting, it simply reopens to everyone.
 */
export async function offerFreedSlot(slot, now = new Date()) {
  if (slot.status !== 'OPEN' || slot.startsAt.getTime() - now.getTime() < 2 * HOUR) return null;
  const w = await PtmWaitlist.findOneAndUpdate(
    { roundId: slot.roundId, teacherProfileId: slot.teacherProfileId, status: 'WAITING' },
    { $set: { status: 'OFFERED', offeredSlotId: slot._id, offerExpiresAt: null }, $inc: { offersMade: 1 } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!w) return null;
  const until = new Date(Math.min(now.getTime() + OFFER_HOLD_HOURS * HOUR, slot.startsAt.getTime() - HOUR));
  const held = await PtmSlot.findOneAndUpdate({ _id: slot._id, status: 'OPEN' }, { $set: { status: 'HELD', heldForWaitlistId: w._id, heldForProfileId: w.parentProfileId, heldUntil: until } }, { new: true });
  if (!held) { await PtmWaitlist.updateOne({ _id: w._id }, { $set: { status: 'WAITING', offeredSlotId: null } }); return null; }
  w.offerExpiresAt = until;
  await w.save();
  await sendOperational({
    templateKey: 'PTM_SLOT_OFFERED', recipientProfileIds: [String(w.parentProfileId)], channels: ['EMAIL', 'WHATSAPP'],
    variables: { teacher: slot.teacherName ?? 'the teacher', when: whenText(slot.startsAt), until: whenText(until) },
    link: '/ptm', idempotencyKey: `ptm:waitlist:${w._id}:offer:${slot._id}`, relatedEntityType: 'PtmWaitlist', relatedEntityId: w._id, now,
  });
  return w;
}

/** The family accepts the slot held for them. */
export async function acceptOffer(actor, scopes, waitlistId, body = {}) {
  requireProfile(actor);
  const w = await PtmWaitlist.findById(assertObjectId(waitlistId));
  if (!w || String(w.parentProfileId) !== String(actor.profileId)) throw new AppError('Waiting-list entry not found', 404);
  if (w.status !== 'OFFERED' || !w.offeredSlotId || (w.offerExpiresAt && w.offerExpiresAt < new Date())) throw new AppError('This offer has expired.', 409, [], 'OFFER_EXPIRED');
  return book(actor, scopes, { ...body, slotId: String(w.offeredSlotId), studentId: String(w.studentId) });
}

/** Offers that ran out pass to the next family; slots held for nobody reopen. */
export async function expireOffers(now = new Date()) {
  const stale = await PtmSlot.find({ status: 'HELD', heldUntil: { $lt: now } });
  for (const slot of stale) {
    // eslint-disable-next-line no-await-in-loop
    await PtmWaitlist.updateOne({ _id: slot.heldForWaitlistId, status: 'OFFERED' }, { $set: { status: 'EXPIRED' } });
    // eslint-disable-next-line no-await-in-loop
    const open = await PtmSlot.findOneAndUpdate({ _id: slot._id, status: 'HELD' }, { $set: { status: 'OPEN', heldForWaitlistId: null, heldForProfileId: null, heldUntil: null } }, { new: true });
    // eslint-disable-next-line no-await-in-loop
    if (open) await offerFreedSlot(open, now);
  }
  return stale.length;
}

// ── on the day ─────────────────────────────────────────────────────────

async function staffBooking(actor, scopes, id) {
  const b = await loadBooking(id);
  const role = bookingRole(actor, scopes, b);
  if (!['MANAGER', 'TEACHER'].includes(role)) throw new AppError('Booking not found', 404);
  return b;
}

export async function checkIn(actor, scopes, id) {
  const b = await staffBooking(actor, scopes, id);
  if (b.status !== 'BOOKED') throw new AppError(`This meeting is ${b.status.toLowerCase().replace('_', ' ')}.`, 409, [], 'BOOKING_LOCKED');
  if (b.startsAt.getTime() - Date.now() > 2 * HOUR) throw new AppError('Check-in opens two hours before the meeting.', 409, [], 'TOO_EARLY');
  b.status = 'CHECKED_IN'; b.checkedInAt = new Date();
  pushHistory(b, actor, 'CHECKED_IN', { from: 'BOOKED', to: 'CHECKED_IN' });
  await b.save();
  return (await decorate([b.toObject()], { staffView: true }))[0];
}

export async function markNoShow(actor, scopes, id) {
  const b = await staffBooking(actor, scopes, id);
  if (b.status !== 'BOOKED') throw new AppError('Only a booked meeting nobody checked in to can be marked as a no-show.', 409, [], 'BOOKING_LOCKED');
  if (b.startsAt.getTime() > Date.now()) throw new AppError('A meeting can be marked as a no-show only after its start time.', 409, [], 'TOO_EARLY');
  b.status = 'NO_SHOW';
  pushHistory(b, actor, 'NO_SHOW', { from: 'BOOKED', to: 'NO_SHOW' });
  await b.save();
  return (await decorate([b.toObject()], { staffView: true }))[0];
}

/**
 * The meeting record: a summary, agreed actions and the next follow-up. Staff
 * actions become tasks (PTM follow-up, Engagement) owned by the person named;
 * the follow-up date becomes a task for the teacher. A safeguarding concern is
 * refused here: it belongs in the safeguarding module.
 */
export async function recordOutcome(actor, scopes, id, body = {}) {
  const b = await staffBooking(actor, scopes, id);
  if (!['CHECKED_IN', 'COMPLETED', 'BOOKED'].includes(b.status)) throw new AppError('This meeting did not take place.', 409, [], 'BOOKING_LOCKED');
  if (b.startsAt.getTime() - Date.now() > 15 * 60_000) throw new AppError('Record the outcome after the meeting.', 409, [], 'TOO_EARLY');
  if (body.safeguarding || body.safeguardingConcern) throw new AppError(SAFEGUARDING_HINT, 400, [], 'USE_SAFEGUARDING');
  const summary = requireText(body.summary, 'summary', { max: 4000 });
  const nextFollowUpOn = parseDate(body.nextFollowUpOn, 'nextFollowUpOn');
  const student = await Student.findById(b.studentId).select('firstName lastName').lean();
  const name = studentLabel(student);
  const actions = [];
  const given = Array.isArray(body.actions) ? body.actions.slice(0, 10) : [];
  for (const [i, a] of given.entries()) {
    const title = requireText(a.title, 'action title', { max: 200 });
    const ownerType = oneOf(a.ownerType, ['STAFF', 'PARENT'], 'ownerType', 'STAFF');
    const dueOn = parseDate(a.dueOn, 'action dueOn', { required: ownerType === 'STAFF' });
    let ownerProfileId = null; let ownerName = null;
    if (ownerType === 'STAFF') {
      // eslint-disable-next-line no-await-in-loop
      const owner = await assertStaffProfile(a.ownerProfileId ?? actor.profileId, 'action owner');
      ownerProfileId = owner.profileId; ownerName = owner.name;
    } else {
      ownerName = 'Parent';
    }
    const sourceKey = `ptm:${b._id}:action:${i}`;
    let taskId = null;
    if (ownerType === 'STAFF') {
      // eslint-disable-next-line no-await-in-loop
      const task = await upsertFromSource({
        sourceKey, title: `PTM follow-up (${name}): ${title}`, department: 'ENGAGEMENT', category: 'PTM_FOLLOWUP', dueAt: dueOn,
        ownerProfileId, leadDays: [3, 1, 0], source: { entityType: 'PtmBooking', entityId: b._id, link: `/ptm?booking=${b._id}` },
        description: 'Agreed at a parent–teacher meeting.',
      });
      taskId = task.id;
    }
    actions.push({ title, ownerType, ownerProfileId, ownerName, dueOn, taskId, sourceKey, status: 'OPEN' });
  }
  // Replacing the outcome: actions no longer listed are cancelled at the source.
  for (const old of b.outcome?.actions ?? []) {
    if (old.sourceKey && !actions.some((a) => a.sourceKey === old.sourceKey)) {
      // eslint-disable-next-line no-await-in-loop
      await DueItem.updateOne({ sourceKey: old.sourceKey, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }, { $set: { status: 'CANCELLED' }, $push: { history: { at: new Date(), action: 'CANCELLED', note: 'Removed from the PTM outcome' } } });
    }
  }
  let followUpTaskId = null;
  if (nextFollowUpOn) {
    const t = await upsertFromSource({
      sourceKey: `ptm:${b._id}:followup`, title: `Follow up with the family of ${name}`, department: 'ENGAGEMENT', category: 'PTM_FOLLOWUP',
      dueAt: nextFollowUpOn, ownerProfileId: b.teacherProfileId, leadDays: [3, 0], source: { entityType: 'PtmBooking', entityId: b._id, link: `/ptm?booking=${b._id}` },
    });
    followUpTaskId = t.id;
  } else {
    await resolveSource(`ptm:${b._id}:followup`, { note: 'Follow-up removed from the PTM outcome' });
  }
  const from = b.status;
  b.outcome = { summary, actions, nextFollowUpOn, followUpTaskId, recordedAt: new Date(), recordedByProfileId: actor.profileId };
  b.status = 'COMPLETED';
  pushHistory(b, actor, 'OUTCOME_RECORDED', { from, to: 'COMPLETED' });
  await b.save();
  return { ...(await decorate([b.toObject()], { staffView: true }))[0], safeguardingNote: SAFEGUARDING_HINT };
}

/** The briefing for the meeting's child: only for the meeting's teacher or a manager. */
export async function briefing(actor, scopes, id) {
  const b = await staffBooking(actor, scopes, id);
  const data = await childBriefing(actor, b.studentId, { purpose: 'PTM' });
  const previous = await PtmBooking.find({ studentId: b.studentId, _id: { $ne: b._id }, 'outcome.recordedAt': { $ne: null } }).sort({ startsAt: -1 }).limit(3).lean();
  data.previousMeetings = (await decorate(previous)).map((p) => ({ when: p.when, teacherName: p.teacherName, summary: p.outcome?.summary ?? null, openActions: (p.outcome?.actions ?? []).filter((a) => a.status === 'OPEN').length }));
  data.booking = (await decorate([b.toObject()]))[0];
  data.safeguardingNote = SAFEGUARDING_HINT;
  return data;
}

/** The teacher's sheet for a round: every slot in time order, with who is coming and what they asked for. */
export async function meetingSheet(actor, scopes, roundId, query = {}) {
  requireProfile(actor);
  const round = await loadRound(roundId);
  const teacherId = scopes['ptm.manage'] === 'ALL' && query.teacherProfileId ? assertObjectId(query.teacherProfileId, 'teacherProfileId') : actor.profileId;
  if (!scopes['ptm.manage']) throw new AppError('Missing permission: ptm.manage', 403);
  const [slots, bookings] = await Promise.all([
    PtmSlot.find({ roundId: round._id, teacherProfileId: teacherId, status: { $ne: 'CANCELLED' } }).sort({ startsAt: 1 }).lean(),
    PtmBooking.find({ roundId: round._id, teacherProfileId: teacherId, active: true }).lean(),
  ]);
  const rows = await decorate(bookings, { staffView: true });
  const bySlot = new Map(rows.map((r) => [r.slotId, r]));
  const enrolments = new Map();
  for (const b of bookings) {
    // eslint-disable-next-line no-await-in-loop
    if (!enrolments.has(String(b.studentId))) enrolments.set(String(b.studentId), classLabel((await activeEnrollment(b.studentId))?.sectionId));
  }
  const sheet = slots.map((s) => {
    const booking = bySlot.get(String(s._id)) ?? null;
    return { slot: presentSlot(s), booking: booking ? { ...booking, className: enrolments.get(booking.studentId) ?? null } : null };
  });
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    round: presentRound(round.toObject()), teacherProfileId: String(teacherId), rows: sheet,
    totals: { slots: slots.length, booked: rows.length, checkedIn: count('CHECKED_IN'), completed: count('COMPLETED'), noShow: count('NO_SHOW'), free: slots.filter((s) => s.status === 'OPEN').length },
  };
}

/** A family's bookings (or a teacher's meetings) across rounds. */
export async function myBookings(actor, scopes, query = {}) {
  requireProfile(actor);
  const filter = scopes['ptm.book'] && !scopes['ptm.manage'] ? { parentProfileId: actor.profileId } : { teacherProfileId: actor.profileId };
  if (query.roundId) filter.roundId = assertObjectId(query.roundId, 'roundId');
  if (query.when === 'upcoming' || !query.when) { filter.active = true; filter.endsAt = { $gte: new Date(Date.now() - 12 * HOUR) }; }
  const rows = await PtmBooking.find(filter).sort({ startsAt: 1 }).limit(200).lean();
  return decorate(rows);
}

// ── reminders and measures ─────────────────────────────────────────────

/** Day-before and hour-before reminders to the family (once each), and expiry of waiting-list offers. */
export async function runReminders({ now = new Date() } = {}) {
  const expired = await expireOffers(now);
  const due = await PtmBooking.find({ active: true, status: 'BOOKED', startsAt: { $gt: now, $lte: new Date(now.getTime() + DAY) } }).limit(2000);
  let sent = 0;
  const names = await profileNames(due.map((b) => b.teacherProfileId));
  const studs = new Map((await Student.find({ _id: { $in: due.map((b) => b.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentLabel(s)]));
  for (const b of due) {
    const left = b.startsAt.getTime() - now.getTime();
    const kinds = new Set((b.remindersSent ?? []).map((r) => r.kind));
    const kind = left <= HOUR ? 'HOUR' : 'DAY';
    if (kinds.has(kind) || (kind === 'DAY' && kinds.has('HOUR'))) continue;
    // A booking made within the last day gets no day-before reminder: the confirmation was just sent.
    if (kind === 'DAY' && now.getTime() - b.createdAt.getTime() < 2 * HOUR) continue;
    // eslint-disable-next-line no-await-in-loop
    await sendOperational({
      templateKey: 'PTM_REMINDER', recipientProfileIds: [String(b.parentProfileId)], channels: ['EMAIL', 'WHATSAPP'],
      variables: { teacher: names.get(String(b.teacherProfileId)) ?? 'the teacher', student: studs.get(String(b.studentId)) ?? 'your child', when: whenText(b.startsAt), lead: kind === 'HOUR' ? 'within the hour' : 'tomorrow' },
      link: '/ptm', idempotencyKey: `ptm:${b._id}:reminder:${kind}`, relatedEntityType: 'PtmBooking', relatedEntityId: b._id, now,
    });
    b.remindersSent.push({ kind, at: now });
    // eslint-disable-next-line no-await-in-loop
    await b.save();
    sent += 1;
  }
  return { reminded: sent, offersExpired: expired };
}

/** How a round went: booked, met, missed, and the follow-up actions still open. */
export async function metrics(actor, scopes, query = {}) {
  requireProfile(actor);
  const match = {};
  if (query.roundId) match.roundId = assertObjectId(query.roundId, 'roundId');
  if (scopes['ptm.manage'] !== 'ALL' && scopes['ptm.read'] !== 'ALL') match.teacherProfileId = actor.profileId;
  const rows = await PtmBooking.find({ ...match, status: { $ne: 'RESCHEDULED' } }).select('status studentId parentProfileId outcome.actions roundId').lean();
  const count = (s) => rows.filter((r) => r.status === s).length;
  const actions = rows.flatMap((r) => r.outcome?.actions ?? []).filter((a) => a.ownerType === 'STAFF' && a.sourceKey);
  const tasks = actions.length ? await DueItem.find({ sourceKey: { $in: actions.map((a) => a.sourceKey) } }).select('status dueAt sourceKey').lean() : [];
  const now = new Date();
  const openTasks = tasks.filter((t) => ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'].includes(t.status));
  const met = count('COMPLETED') + count('CHECKED_IN');
  const held = met + count('NO_SHOW');
  return {
    booked: rows.filter((r) => r.status !== 'CANCELLED').length, cancelled: count('CANCELLED'), completed: count('COMPLETED'), noShow: count('NO_SHOW'),
    families: new Set(rows.filter((r) => r.status !== 'CANCELLED').map((r) => String(r.parentProfileId))).size,
    attendancePct: held ? Math.round((met / held) * 100) : null,
    actionsAgreed: actions.length, actionsOpen: openTasks.length, actionsOverdue: openTasks.filter((t) => t.dueAt < now).length,
    actionsDone: tasks.filter((t) => t.status === 'DONE').length,
    waiting: await PtmWaitlist.countDocuments({ ...(match.roundId ? { roundId: match.roundId } : {}), status: { $in: ['WAITING', 'OFFERED'] } }),
    definition: 'Attendance is meetings that took place out of meetings that were due (cancelled and moved meetings excluded). Actions are the staff actions agreed in meeting outcomes, tracked in Tasks.',
    asOf: now.toISOString(),
  };
}

/** Families of a class in a round who have not booked any meeting yet (for staff to help). */
export async function unbookedFamilies(actor, scopes, roundId, query = {}) {
  requireProfile(actor);
  const round = await loadRound(roundId);
  let sectionIds = round.sectionIds.map(String);
  if (scopes['ptm.manage'] !== 'ALL') {
    const mine = await getTeacherSectionIds(actor.profileId);
    sectionIds = sectionIds.length ? sectionIds.filter((s) => mine.includes(s)) : mine;
  } else if (!sectionIds.length) {
    sectionIds = (await Section.find({}).select('_id').lean()).map((s) => String(s._id));
  }
  if (query.sectionId) sectionIds = sectionIds.filter((s) => s === String(query.sectionId));
  const { Enrollment, StudentGuardian } = await import('../../models/student.model.js');
  const enrolments = await Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).populate('studentId', 'firstName lastName').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const booked = new Set((await PtmBooking.find({ roundId: round._id, active: true }).select('studentId').lean()).map((b) => String(b.studentId)));
  const missing = enrolments.filter((e) => e.studentId && !booked.has(String(e.studentId._id)));
  const links = await StudentGuardian.find({ studentId: { $in: missing.map((e) => e.studentId._id) } }).select('studentId guardianProfileId').lean();
  const names = await profileNames(links.map((l) => l.guardianProfileId));
  return missing.map((e) => ({
    studentId: String(e.studentId._id), studentName: studentLabel(e.studentId), className: classLabel(e.sectionId),
    guardians: links.filter((l) => String(l.studentId) === String(e.studentId._id)).map((l) => ({ profileId: String(l.guardianProfileId), name: names.get(String(l.guardianProfileId)) ?? null })),
  })).sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.studentName.localeCompare(b.studentName));
}

export { SAFEGUARDING_HINT };
