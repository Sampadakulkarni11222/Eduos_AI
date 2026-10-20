import { Facility, FacilityBooking, WorkOrder } from '../../models/facility.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Section } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { CoverAssignment } from '../../models/staffLeave.model.js';
import { ExamSitting, RoomShift } from '../../models/examRoom.model.js';
import { AppError } from '../../utils/AppError.js';
import { DEFAULT_TZ } from '../../utils/periods.js';
import { absentOn } from '../staff/cover.service.js';
import { dowOfYmd, hhmm, instantOf, localParts, toMin } from '../campus/day-plan.js';

/**
 * Who is in which room, on one school day, from the records that plan it:
 *
 *   - the timetable, each period in its EFFECTIVE room: an applied temporary
 *     room shift first, then the room the slot names, then the class's home
 *     room (the base timetable is never rewritten for a temporary shift);
 *   - exam sittings in their rooms, with any delay announced on the day;
 *   - confirmed room bookings, and rooms out of use (closed, under
 *     maintenance, or with an open work order that takes the room out of use);
 *   - for people: lessons, confirmed cover, invigilation, approved leave and
 *     marked absences.
 *
 * loadDay() reads everything once; the checks after it are plain functions
 * over that snapshot, so a whole week of conflict checks for a dozen rooms
 * costs a handful of queries.
 */

export const TEACHING_KINDS = ['CLASSROOM', 'LECTURE_HALL', 'LAB', 'LIBRARY', 'AUDITORIUM'];
export const LIVE_SITTING = ['SCHEDULED', 'IN_PROGRESS', 'FINISHED'];
const HALF_DAY_SPLIT = 12 * 60 + 30;

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-26" → the stored day key (UTC midnight of that calendar date). */
export const dayKey = (ymd) => new Date(`${ymd}T00:00:00Z`);
export const ymdOf = (date) => new Date(date).toISOString().slice(0, 10);
/** Today in the school's time zone, "YYYY-MM-DD". */
export const todayYmd = (now = new Date(), tz = DEFAULT_TZ) => localParts(now, tz).ymd;

export function parseYmd(value, label = 'date') {
  const s = String(value ?? '').trim();
  if (!YMD_RE.test(s)) throw new AppError(`${label} must be a date (YYYY-MM-DD)`, 400, [], 'BAD_DATE');
  const d = dayKey(s);
  if (Number.isNaN(d.getTime()) || ymdOf(d) !== s) throw new AppError(`${label} is not a real date`, 400, [], 'BAD_DATE');
  return s;
}

export function parseTime(value, label = 'time') {
  const s = String(value ?? '').trim();
  if (!TIME_RE.test(s)) throw new AppError(`${label} must be a time (HH:MM, 24-hour)`, 400, [], 'BAD_TIME');
  return s;
}

export function addDays(ymd, n) {
  return ymdOf(new Date(dayKey(ymd).getTime() + n * 86_400_000));
}

/** Every date from a to b inclusive (at most `max`). */
export function datesBetween(a, b, max = 31) {
  const out = [];
  for (let d = a; d <= b && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

export const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
export const sectionLabel = (sec) => `${sec?.gradeId?.name ?? ''} ${sec?.name ?? ''}`.trim();

/** The window a sitting really occupies (its times plus any delay), in minutes. */
export function sittingWindow(s) {
  const d = Number(s.delayMinutes) || 0;
  return { start: toMin(s.startTime) + d, end: toMin(s.endTime) + d };
}

/** A facility found by its id, code or name (case-insensitive), among the given list. */
export function matchFacility(list, text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  return list.find((f) => String(f._id) === t)
    ?? list.find((f) => f.code?.toLowerCase() === t || f.name?.toLowerCase() === t)
    ?? list.find((f) => f.code?.toLowerCase().replace(/[^a-z0-9]/g, '') === t.replace(/[^a-z0-9]/g, ''))
    ?? null;
}

/** Every facility a class or exam could be in (not campus/building/floor), as an index. */
export async function facilityIndex() {
  const list = await Facility.find({ kind: { $nin: ['CAMPUS', 'BUILDING', 'FLOOR'] } })
    .select('code name kind capacity sectionId status restricted bookable').lean();
  const byId = new Map(list.map((f) => [String(f._id), f]));
  const byKey = new Map();
  for (const f of list) for (const k of [f.code, f.name]) if (k && !byKey.has(String(k).toLowerCase())) byKey.set(String(k).toLowerCase(), f);
  const homeOf = new Map(list.filter((f) => f.sectionId).map((f) => [String(f.sectionId), f]));
  return { list, byId, byKey, homeOf };
}

/** Applied temporary shifts covering a date, newest first. */
export async function shiftsOn(ymd) {
  const d = dayKey(ymd);
  return RoomShift.find({ status: 'APPLIED', kind: 'TEMPORARY', startDate: { $lte: d }, endDate: { $gte: d } }).sort({ createdAt: -1 }).lean();
}

/** The shift that moves a section in a period on that day, if any (newest wins). */
export function shiftFor(shifts, sectionId, periodNo) {
  return shifts.find((s) => String(s.sectionId) === String(sectionId) && (!s.periods?.length || s.periods.includes(Number(periodNo)))) ?? null;
}

/** The room a slot is really in on a day: { facility, shift }. */
export function effectiveRoom(index, shifts, slot) {
  const sectionId = slot.sectionId?._id ?? slot.sectionId;
  const shift = shiftFor(shifts, sectionId, slot.periodNo);
  if (shift) return { facility: index.byId.get(String(shift.toFacilityId)) ?? null, shift };
  const named = slot.room ? index.byKey.get(String(slot.room).toLowerCase()) : null;
  return { facility: named ?? index.homeOf.get(String(sectionId)) ?? null, shift: null };
}

/**
 * One school day as a snapshot: every timetabled lesson in its effective
 * room, the exam sittings, bookings, rooms out of use, cover and absences.
 */
export async function loadDay(ymd, { index = null } = {}) {
  const dow = dowOfYmd(ymd);
  const day = dayKey(ymd);
  const from = instantOf(ymd, 0);
  const to = instantOf(ymd, 24 * 60);
  const [idx, slots, shifts, sittings, bookings, closures, covers, absent, sections, counts] = await Promise.all([
    index ?? facilityIndex(),
    TimetableSlot.find({ dayOfWeek: dow, subjectOfferingId: { $ne: null } })
      .select('sectionId periodNo startTime endTime subjectOfferingId room')
      .populate({ path: 'subjectOfferingId', select: 'subjectId teacherId', populate: [{ path: 'subjectId', select: 'name' }, { path: 'teacherId', select: 'displayName' }] })
      .lean(),
    shiftsOn(ymd),
    ExamSitting.find({ date: day, status: { $in: LIVE_SITTING } }).lean(),
    FacilityBooking.find({ status: 'CONFIRMED', startsAt: { $lt: to }, endsAt: { $gt: from } }).select('facilityId title startsAt endsAt').lean(),
    WorkOrder.find({ closesFacility: true, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] }, facilityId: { $ne: null } }).select('facilityId title refNo').lean(),
    CoverAssignment.find({ date: day, status: 'CONFIRMED' }).select('sectionId periodNo startTime endTime substituteProfileId').lean(),
    absentOn(day).catch(() => new Map()),
    Section.find({}).select('name gradeId classTeacherId').populate('gradeId', 'name level').lean(),
    Enrollment.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
  ]);
  const lessons = slots.map((s) => {
    const { facility, shift } = effectiveRoom(idx, shifts, s);
    return {
      slot: s, sectionId: String(s.sectionId), periodNo: s.periodNo, start: toMin(s.startTime), end: toMin(s.endTime),
      teacherId: s.subjectOfferingId?.teacherId?._id ? String(s.subjectOfferingId.teacherId._id) : null,
      subject: s.subjectOfferingId?.subjectId?.name ?? null,
      facilityId: facility ? String(facility._id) : null, shift,
    };
  });
  return {
    ymd, dow, day, index: idx, lessons, shifts, sittings, bookings, closures, covers, absent,
    sectionById: new Map(sections.map((s) => [String(s._id), s])),
    strength: new Map(counts.map((c) => [String(c._id), c.n])),
  };
}

/** Sections sitting a paper that overlaps a window (their own lessons do not happen then). */
function sectionsInExam(day, start, end, ignoreSittingId = null) {
  const out = new Set();
  for (const s of day.sittings) {
    if (ignoreSittingId && String(s._id) === String(ignoreSittingId)) continue;
    const w = sittingWindow(s);
    if (overlaps(start, end, w.start, w.end)) for (const id of s.sectionIds ?? []) out.add(String(id));
  }
  return out;
}

/** Why a room is out of use on that day, or null. */
export function roomClosed(day, facilityId) {
  const f = day.index.byId.get(String(facilityId));
  if (f && f.status && f.status !== 'ACTIVE') return `${f.name} is ${f.status.replace(/_/g, ' ').toLowerCase()}`;
  const wo = day.closures.find((w) => String(w.facilityId) === String(facilityId));
  if (wo) return `${f?.name ?? 'The room'} is out of use for maintenance (${wo.refNo}: ${wo.title})`;
  return null;
}

/**
 * Everything already in a room during a window on that day.
 *  ignoreSittingId  the sitting being edited
 *  ignoreShiftId    the shift being checked
 *  sectionIds       the classes that will be in it (their own lessons are not a clash)
 */
export function roomConflicts(day, facilityId, start, end, { ignoreSittingId = null, ignoreShiftId = null, sectionIds = [] } = {}) {
  const fid = String(facilityId);
  const mine = new Set(sectionIds.map(String));
  const out = [];
  const closed = roomClosed(day, fid);
  if (closed) out.push({ kind: 'MAINTENANCE', detail: closed });
  for (const s of day.sittings) {
    if (ignoreSittingId && String(s._id) === String(ignoreSittingId)) continue;
    if (!(s.venues ?? []).some((v) => String(v.facilityId) === fid)) continue;
    const w = sittingWindow(s);
    if (overlaps(start, end, w.start, w.end)) out.push({ kind: 'EXAM', sittingId: String(s._id), detail: `${s.title} (${hhmm(w.start)}–${hhmm(w.end)})` });
  }
  const away = sectionsInExam(day, start, end, ignoreSittingId);
  for (const l of day.lessons) {
    if (l.facilityId !== fid || mine.has(l.sectionId) || away.has(l.sectionId)) continue;
    if (ignoreShiftId && l.shift && String(l.shift._id) === String(ignoreShiftId)) continue;
    if (!overlaps(start, end, l.start, l.end)) continue;
    out.push({ kind: 'CLASS', sectionId: l.sectionId, periodNo: l.periodNo, detail: `${sectionLabel(day.sectionById.get(l.sectionId))} ${l.subject ?? 'lesson'}, period ${l.periodNo} (${hhmm(l.start)}–${hhmm(l.end)})${l.shift ? ' (moved here)' : ''}` });
  }
  for (const b of day.bookings) {
    if (String(b.facilityId) !== fid) continue;
    const s0 = localParts(new Date(b.startsAt));
    const e0 = localParts(new Date(b.endsAt));
    const bStart = s0.ymd === day.ymd ? s0.minutes : 0;
    const bEnd = e0.ymd === day.ymd ? e0.minutes : 24 * 60;
    if (overlaps(start, end, bStart, bEnd)) out.push({ kind: 'BOOKING', detail: `Booked: ${b.title} (${hhmm(bStart)}–${hhmm(Math.min(bEnd, 1439))})` });
  }
  return out;
}

/**
 * Why a member of staff cannot be in a room during a window on that day:
 * a lesson of their own, confirmed cover, another invigilation, leave or an absence.
 *  sectionIds  the classes sitting the paper (a lesson with one of them is not a clash: the class is in the exam)
 */
export function personConflicts(day, profileId, start, end, { ignoreSittingId = null, sectionIds = [] } = {}) {
  const pid = String(profileId);
  const out = [];
  const away = day.absent.get(pid);
  if (away) {
    const hit = !away.half || (away.half === 'FIRST_HALF' ? start < HALF_DAY_SPLIT : end > HALF_DAY_SPLIT);
    if (hit) out.push({ kind: away.source === 'LEAVE' ? 'LEAVE' : 'ABSENT', detail: away.source === 'LEAVE' ? `On approved leave${away.ref ? ` (${away.ref})` : ''}${away.half ? `, ${away.half.replace(/_/g, ' ').toLowerCase()}` : ''}` : 'Marked absent that day' });
  }
  const sitting = new Set(sectionIds.map(String));
  const examSections = sectionsInExam(day, start, end, ignoreSittingId);
  for (const l of day.lessons) {
    if (l.teacherId !== pid || sitting.has(l.sectionId) || examSections.has(l.sectionId)) continue;
    if (overlaps(start, end, l.start, l.end)) out.push({ kind: 'TEACHING', detail: `Teaches ${sectionLabel(day.sectionById.get(l.sectionId))} ${l.subject ?? ''} in period ${l.periodNo} (${hhmm(l.start)}–${hhmm(l.end)})`.replace(/\s+/g, ' ') });
  }
  for (const c of day.covers) {
    if (String(c.substituteProfileId) !== pid || !c.startTime || !c.endTime) continue;
    if (overlaps(start, end, toMin(c.startTime), toMin(c.endTime))) out.push({ kind: 'COVER', detail: `Covering ${sectionLabel(day.sectionById.get(String(c.sectionId)))} in period ${c.periodNo} (${c.startTime}–${c.endTime})` });
  }
  for (const s of day.sittings) {
    if (ignoreSittingId && String(s._id) === String(ignoreSittingId)) continue;
    const w = sittingWindow(s);
    if (!overlaps(start, end, w.start, w.end)) continue;
    if ((s.venues ?? []).some((v) => (v.invigilatorProfileIds ?? []).map(String).includes(pid))) out.push({ kind: 'INVIGILATION', sittingId: String(s._id), detail: `Invigilating ${s.title} (${hhmm(w.start)}–${hhmm(w.end)})` });
  }
  return out;
}

/** Day snapshots, read once per date for the length of one request. */
export function dayCache() {
  const cache = new Map();
  let index = null;
  return async (ymd) => {
    if (!index) index = await facilityIndex();
    if (!cache.has(ymd)) cache.set(ymd, loadDay(ymd, { index }));
    return cache.get(ymd);
  };
}
