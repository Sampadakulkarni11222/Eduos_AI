import { StaffLeave, StaffAbsence, CoverAssignment, CoverRule } from '../../models/staffLeave.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  requireProfile, assertObjectId, optionalText, requireText, profileNames, profilesWithRoles,
} from '../ops/common.js';
import { istDay, istYmd, classLabel } from '../ptm/relations.js';
import { hasConfirmedCover } from './coverAccess.js';

/**
 * Substitute cover.
 *
 * Who is away on a day comes from approved leave and from absences the
 * coordinator marks that morning. Their timetabled periods that day are the
 * cover needs. For each period the candidates are teachers who are in school,
 * free in that period (no lesson of their own, no other cover overlapping it)
 * and under the school's workload limits; the same subject and the same class
 * rank first. The coordinator confirms one; a period is covered once and a
 * substitute covers one class at a time (unique indexes, so two coordinators
 * confirming at once cannot double-book). The absent teacher, the substitute
 * and the class are told once. The substitute may then mark that period's
 * attendance (see attendance.service assertMarkAccess).
 */

const MIDDAY = '12:30';
const DAY = 86_400_000;

const ymdDay = (value, label = 'date') => {
  if (!value) return istDay(new Date());
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new AppError(`${label} must be a date like 2026-10-20`, 400);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};
const dowOf = (day) => (day.getUTCDay() === 0 ? 7 : day.getUTCDay());
const overlaps = (a, b) => a.startTime < b.endTime && a.endTime > b.startTime;
const inHalf = (half, startTime) => !half || (half === 'FIRST_HALF' ? startTime < MIDDAY : startTime >= MIDDAY);

export async function rules() {
  const r = await CoverRule.findOne({ key: 'default' }).lean();
  return { maxPerDay: r?.maxPerDay ?? 2, maxPerWeek: r?.maxPerWeek ?? 6 };
}

export async function setRules(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the cover coordinator can change cover limits.', 403);
  const set = {};
  for (const [k, max] of [['maxPerDay', 10], ['maxPerWeek', 40]]) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 0 || n > max) throw new AppError(`${k} is a whole number from 0 to ${max}.`, 400);
      set[k] = n;
    }
  }
  await CoverRule.findOneAndUpdate({ key: 'default' }, { $set: set }, { upsert: true });
  return rules();
}

/** Who is away on a day, and for which half (null = all day). */
export async function absentOn(day) {
  const [leaves, absences] = await Promise.all([
    StaffLeave.find({ status: 'APPROVED', fromDate: { $lte: day }, toDate: { $gte: day } }).select('profileId halfDay code refNo').lean(),
    StaffAbsence.find({ status: 'ACTIVE', date: day }).select('profileId halfDay reason').lean(),
  ]);
  const map = new Map();
  for (const l of leaves) map.set(String(l.profileId), { profileId: String(l.profileId), half: l.halfDay ?? null, source: 'LEAVE', ref: l.refNo, code: l.code });
  for (const a of absences) if (!map.has(String(a.profileId))) map.set(String(a.profileId), { profileId: String(a.profileId), half: a.halfDay ?? null, source: 'ABSENCE', ref: null, reason: a.reason ?? null });
  return map;
}

/** Every timetabled lesson on a weekday, with its teacher. */
async function lessonsOn(dow) {
  const slots = await TimetableSlot.find({ dayOfWeek: dow, subjectOfferingId: { $ne: null } })
    .populate({ path: 'subjectOfferingId', select: 'teacherId subjectId sectionId', populate: { path: 'subjectId', select: 'name' } })
    .populate({ path: 'sectionId', select: 'name gradeId classTeacherId', populate: { path: 'gradeId', select: 'name' } })
    .lean();
  return slots.filter((s) => s.subjectOfferingId).map((s) => ({
    slotId: String(s._id), sectionId: String(s.sectionId?._id ?? s.sectionId), className: classLabel(s.sectionId), classTeacherId: s.sectionId?.classTeacherId ? String(s.sectionId.classTeacherId) : null,
    periodNo: s.periodNo, startTime: s.startTime, endTime: s.endTime, room: s.room ?? null,
    offeringId: String(s.subjectOfferingId._id), subjectId: s.subjectOfferingId.subjectId ? String(s.subjectOfferingId.subjectId._id) : null, subject: s.subjectOfferingId.subjectId?.name ?? null,
    teacherId: s.subjectOfferingId.teacherId ? String(s.subjectOfferingId.teacherId) : null,
  }));
}

/**
 * The day's absences and the lessons they leave uncovered (or covered), for
 * the coordinator's screen.
 */
export async function needs(actor, scope, query = {}) {
  requireProfile(actor);
  const day = ymdDay(query.date);
  const [absent, lessons, covers] = await Promise.all([absentOn(day), lessonsOn(dowOf(day)), CoverAssignment.find({ date: day, status: 'CONFIRMED' }).lean()]);
  const names = await profileNames([...absent.keys(), ...covers.map((c) => c.substituteProfileId)]);
  const coverBy = new Map(covers.map((c) => [`${c.sectionId}:${c.periodNo}`, c]));
  const people = [...absent.values()].map((a) => {
    const periods = lessons.filter((l) => l.teacherId === a.profileId && inHalf(a.half, l.startTime)).sort((x, y) => x.startTime.localeCompare(y.startTime)).map((l) => {
      const c = coverBy.get(`${l.sectionId}:${l.periodNo}`);
      return { ...l, cover: c ? { id: String(c._id), substituteProfileId: String(c.substituteProfileId), substituteName: names.get(String(c.substituteProfileId)) ?? null } : null };
    });
    return { ...a, name: names.get(a.profileId) ?? null, periods, uncovered: periods.filter((p) => !p.cover).length };
  }).filter((p) => p.periods.length || query.all === 'true');
  return {
    date: istYmd(day), rules: await rules(), absent: people,
    totals: { absentTeachers: people.length, periods: people.reduce((n, p) => n + p.periods.length, 0), uncovered: people.reduce((n, p) => n + p.uncovered, 0) },
  };
}

function weekRange(day) {
  const dow = dowOf(day);
  const from = new Date(day.getTime() - (dow - 1) * DAY);
  return { from, to: new Date(from.getTime() + 6 * DAY) };
}

/**
 * Ranked substitutes for one period: free, in school and within limits first;
 * the same subject, then the same class, then the lightest day.
 */
export async function candidates(actor, scope, query = {}) {
  requireProfile(actor);
  const day = ymdDay(query.date);
  const sectionId = assertObjectId(query.sectionId, 'sectionId');
  const periodNo = Number(query.periodNo);
  if (!Number.isInteger(periodNo)) throw new AppError('periodNo is required', 400);
  const lessons = await lessonsOn(dowOf(day));
  const target = lessons.find((l) => l.sectionId === String(sectionId) && l.periodNo === periodNo);
  if (!target) throw new AppError('No lesson is timetabled for that class and period on that day.', 404, [], 'NO_LESSON');
  const [absent, limits, teachers] = await Promise.all([absentOn(day), rules(), profilesWithRoles(['TEACHER'])]);
  const week = weekRange(day);
  const [todayCovers, weekCovers, offerings] = await Promise.all([
    CoverAssignment.find({ date: day, status: 'CONFIRMED' }).lean(),
    CoverAssignment.find({ date: { $gte: week.from, $lte: week.to }, status: 'CONFIRMED' }).select('substituteProfileId').lean(),
    SubjectOffering.find({ teacherId: { $in: teachers.map((t) => t._id) } }).select('teacherId subjectId sectionId').lean(),
  ]);
  const out = [];
  for (const t of teachers) {
    const id = String(t._id);
    if (id === target.teacherId) continue;
    const reasons = [];
    const away = absent.get(id);
    if (away && inHalf(away.half, target.startTime)) reasons.push(away.source === 'LEAVE' ? 'On leave' : 'Absent today');
    const own = lessons.filter((l) => l.teacherId === id);
    if (own.some((l) => overlaps(l, target))) reasons.push('Teaching their own class then');
    const mine = todayCovers.filter((c) => String(c.substituteProfileId) === id);
    if (mine.some((c) => overlaps({ startTime: c.startTime, endTime: c.endTime }, target) && !(String(c.sectionId) === target.sectionId && c.periodNo === target.periodNo))) reasons.push('Already covering another class then');
    const today = mine.length; const thisWeek = weekCovers.filter((c) => String(c.substituteProfileId) === id).length;
    const overLimit = today >= limits.maxPerDay || thisWeek >= limits.maxPerWeek;
    const sameSubject = Boolean(target.subjectId) && offerings.some((o) => String(o.teacherId) === id && String(o.subjectId) === target.subjectId);
    const sameClass = offerings.some((o) => String(o.teacherId) === id && String(o.sectionId) === target.sectionId);
    out.push({
      profileId: id, name: t.displayName, eligible: reasons.length === 0 && !overLimit, blocked: reasons, overLimit,
      sameSubject, sameClass, lessonsToday: own.length, coversToday: today, coversThisWeek: thisWeek,
    });
  }
  out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.sameSubject) - Number(a.sameSubject) || Number(b.sameClass) - Number(a.sameClass)
    || (a.lessonsToday + a.coversToday) - (b.lessonsToday + b.coversToday) || String(a.name).localeCompare(String(b.name)));
  return { date: istYmd(day), lesson: target, rules: limits, candidates: out };
}

/** The coordinator confirms a substitute for one period. */
export async function assign(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the cover coordinator can arrange cover.', 403);
  const day = ymdDay(body.date);
  if (day < istDay(new Date())) throw new AppError('Cover can be arranged for today or a later day.', 400, [], 'PAST_DATE');
  const { lesson, candidates: list } = await candidates(actor, scope, { date: istYmd(day), sectionId: body.sectionId, periodNo: body.periodNo });
  const subId = assertObjectId(body.substituteProfileId, 'substituteProfileId');
  const absent = await absentOn(day);
  const away = absent.get(lesson.teacherId);
  const absentProfileId = body.absentProfileId ? assertObjectId(body.absentProfileId, 'absentProfileId') : lesson.teacherId;
  if (!away && !body.absentProfileId) throw new AppError('The teacher of this lesson is not recorded as away that day. Mark the absence first.', 409, [], 'NOT_ABSENT');
  const cand = list.find((c) => c.profileId === String(subId));
  if (!cand) throw new AppError('That person is not a teacher who can cover this lesson.', 400, [], 'NOT_A_CANDIDATE');
  if (cand.blocked.length) throw new AppError(`${cand.name} cannot cover this lesson: ${cand.blocked.join('; ')}.`, 409, [], 'SUBSTITUTE_BUSY');
  let overrideReason = null;
  if (cand.overLimit) {
    overrideReason = optionalText(body.overrideReason, { max: 300 }) || null;
    if (!overrideReason) throw new AppError(`${cand.name} has reached the cover limit (${cand.coversToday} today, ${cand.coversThisWeek} this week). Give a reason to go over it.`, 409, [], 'OVER_LIMIT');
  }
  let cover;
  try {
    cover = await CoverAssignment.create({
      date: day, sectionId: lesson.sectionId, periodNo: lesson.periodNo, startTime: lesson.startTime, endTime: lesson.endTime,
      timetableSlotId: lesson.slotId, subjectOfferingId: lesson.offeringId, absentProfileId, substituteProfileId: subId, room: lesson.room,
      note: optionalText(body.note, { max: 500 }) || null, overrideReason, status: 'CONFIRMED', confirmedByProfileId: actor.profileId,
    });
  } catch (err) {
    if (err?.code === 11000) {
      if (String(err.message).includes('sectionId')) throw new AppError('This period already has cover confirmed.', 409, [], 'ALREADY_COVERED');
      throw new AppError(`${cand.name} is already covering another class in this period.`, 409, [], 'SUBSTITUTE_DOUBLE_BOOKED');
    }
    throw err;
  }
  await notifyCover(cover, lesson);
  return presentCover(cover.toObject());
}

/** One message to the absent teacher, the substitute and the class teacher; an in-app note to the class. */
async function notifyCover(cover, lesson) {
  const names = await profileNames([cover.absentProfileId, cover.substituteProfileId]);
  const vars = {
    className: lesson.className, period: lesson.periodNo, time: `${lesson.startTime}–${lesson.endTime}`, date: istYmd(cover.date),
    substitute: names.get(String(cover.substituteProfileId)) ?? 'a colleague', absent: names.get(String(cover.absentProfileId)) ?? 'the class teacher',
  };
  const staff = [...new Set([String(cover.absentProfileId), String(cover.substituteProfileId), lesson.classTeacherId].filter(Boolean))];
  await sendOperational({ templateKey: 'COVER_ASSIGNED', recipientProfileIds: staff, channels: ['EMAIL'], variables: vars, link: '/cover', idempotencyKey: `cover:${cover._id}:staff`, relatedEntityType: 'CoverAssignment', relatedEntityId: cover._id });
  const enrolled = await Enrollment.find({ sectionId: cover.sectionId, status: 'ACTIVE' }).select('studentId').lean();
  const students = await Student.find({ _id: { $in: enrolled.map((e) => e.studentId) }, profileId: { $ne: null } }).select('profileId').lean();
  if (students.length) await sendOperational({ templateKey: 'COVER_ASSIGNED', recipientProfileIds: students.map((s) => String(s.profileId)), channels: [], variables: vars, link: null, idempotencyKey: `cover:${cover._id}:class`, relatedEntityType: 'CoverAssignment', relatedEntityId: cover._id });
  await CoverAssignment.updateOne({ _id: cover._id }, { $set: { notifiedAt: new Date() } });
}

function presentCover(c, names = new Map(), sections = new Map()) {
  return {
    id: String(c._id), date: istYmd(c.date), sectionId: String(c.sectionId), className: sections.get(String(c.sectionId)) ?? null, periodNo: c.periodNo,
    startTime: c.startTime, endTime: c.endTime, room: c.room ?? null, status: c.status,
    absentProfileId: String(c.absentProfileId), absentName: names.get(String(c.absentProfileId)) ?? null,
    substituteProfileId: String(c.substituteProfileId), substituteName: names.get(String(c.substituteProfileId)) ?? null,
    note: c.note ?? null, overrideReason: c.overrideReason ?? null, cancelReason: c.cancelReason ?? null,
  };
}

export async function cancelCover(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the cover coordinator can cancel cover.', 403);
  const reason = requireText(body.reason, 'reason', { max: 300 });
  const c = await CoverAssignment.findOneAndUpdate({ _id: assertObjectId(id), status: 'CONFIRMED' }, { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } }, { new: true });
  if (!c) throw new AppError('Cover not found or already cancelled', 404);
  return presentCover(c.toObject());
}

/** Marks a member of staff absent for a day (an unplanned absence), so their lessons need cover. */
export async function markAbsent(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the cover coordinator can mark staff absent.', 403);
  const day = ymdDay(body.date);
  const profileId = assertObjectId(body.profileId, 'profileId');
  const halfDay = body.halfDay ? String(body.halfDay) : null;
  if (halfDay && !['FIRST_HALF', 'SECOND_HALF'].includes(halfDay)) throw new AppError('halfDay is FIRST_HALF or SECOND_HALF', 400);
  try {
    const a = await StaffAbsence.create({ profileId, date: day, halfDay, reason: optionalText(body.reason, { max: 300 }) || null, lop: body.lop === true, markedByProfileId: actor.profileId });
    const [name] = (await profileNames([profileId])).values();
    return { id: String(a._id), profileId: String(profileId), name: name ?? null, date: istYmd(day), halfDay, reason: a.reason, lop: a.lop };
  } catch (err) {
    if (err?.code === 11000) throw new AppError('That person is already marked absent that day.', 409, [], 'ALREADY_ABSENT');
    throw err;
  }
}

export async function withdrawAbsence(actor, scope, id) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only the cover coordinator can change absences.', 403);
  const a = await StaffAbsence.findOneAndUpdate({ _id: assertObjectId(id), status: 'ACTIVE' }, { $set: { status: 'WITHDRAWN' } }, { new: true });
  if (!a) throw new AppError('Absence not found', 404);
  await CoverAssignment.updateMany({ absentProfileId: a.profileId, date: a.date, status: 'CONFIRMED' }, { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Absence withdrawn' } });
  return { id: String(a._id), status: a.status };
}

export async function listAbsences(actor, scope, query = {}) {
  requireProfile(actor);
  const day = ymdDay(query.date);
  const rows = await StaffAbsence.find({ date: day, status: 'ACTIVE' }).lean();
  const names = await profileNames(rows.map((r) => r.profileId));
  return rows.map((a) => ({ id: String(a._id), profileId: String(a.profileId), name: names.get(String(a.profileId)) ?? null, date: istYmd(a.date), halfDay: a.halfDay, reason: a.reason, lop: a.lop }));
}

/** A teacher's own covers (what they are taking today and coming up). */
export async function myCovers(actor, query = {}) {
  requireProfile(actor);
  const from = ymdDay(query.from);
  const rows = await CoverAssignment.find({ substituteProfileId: actor.profileId, status: 'CONFIRMED', date: { $gte: from } }).sort({ date: 1, startTime: 1 }).limit(50).lean();
  return decorateCovers(rows);
}

async function decorateCovers(rows) {
  const names = await profileNames(rows.flatMap((r) => [r.absentProfileId, r.substituteProfileId]));
  const sections = await Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).select('name gradeId').populate('gradeId', 'name').lean();
  const labels = new Map(sections.map((s) => [String(s._id), classLabel(s)]));
  return rows.map((r) => presentCover(r, names, labels));
}

/**
 * Cover on a day, keyed for the campus map and timetable: for each class and
 * period with confirmed cover, who is taking it in place of whom.
 * Exported for other modules (campus map) as well as served at GET /staff/cover/for.
 */
export async function coverFor(date) {
  const day = date instanceof Date ? istDay(date) : ymdDay(date);
  const rows = await CoverAssignment.find({ date: day, status: 'CONFIRMED' }).lean();
  const list = await decorateCovers(rows);
  return list.map((c) => ({
    key: `${c.sectionId}:${c.periodNo}`, sectionId: c.sectionId, className: c.className, periodNo: c.periodNo, startTime: c.startTime, endTime: c.endTime, room: c.room,
    substituteProfileId: c.substituteProfileId, substituteName: c.substituteName, absentProfileId: c.absentProfileId, absentName: c.absentName,
  }));
}

export async function coverForRoute(actor, query = {}) {
  requireProfile(actor);
  return { date: istYmd(ymdDay(query.date)), covers: await coverFor(query.date ?? null) };
}

export { hasConfirmedCover };
