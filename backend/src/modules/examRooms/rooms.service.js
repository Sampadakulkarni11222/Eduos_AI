import mongoose from 'mongoose';
import { Facility } from '../../models/facility.model.js';
import { Section } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { Enrollment } from '../../models/student.model.js';
import { ExamRoomSettings, RoomShift, SectionRoomChange } from '../../models/examRoom.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { notify } from '../notifications/notification.service.js';
import { ownStudentIds } from '../safety/shared.js';
import { assertObjectId, nextRef, optionalText, profileNames, profilesWithRoles, pushHistory, requireProfile } from '../ops/common.js';
import { dowOfYmd, hhmm, localParts, toMin } from '../campus/day-plan.js';
import {
  TEACHING_KINDS, addDays, dayCache, loadDay, dayKey, datesBetween, effectiveRoom, facilityIndex, matchFacility, parseYmd, roomConflicts,
  sectionLabel, shiftFor, sittingWindow, todayYmd, ymdOf,
} from './occupancy.js';
import { notifyRoomShift } from './notify.js';

/**
 * Rooms & Classes: each class's home room (with its history), each room's
 * occupant and capacity against class strength, and room shifts.
 *
 * Who may do what:
 *   - change a home room, apply or decide a shift: facilities.manage or
 *     timetable.manage at school-wide scope (administrator, principal);
 *   - request a shift: a teacher (facilities.request) for a class they are
 *     class teacher of (any period) or for the periods they teach in it. With
 *     the school's self-shift setting on, a request for one period on one day
 *     into a room that is free is applied at once;
 *   - read: staff see every class; parents and students their own class.
 *
 * A temporary shift never rewrites the base timetable: it is an override read
 * wherever the effective room of a period is asked for (timetable views, the
 * campus map, the live room page, the exam-room clash checks). A permanent
 * shift changes the home room (with history) and the slots that named the old
 * room.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const MAX_SHIFT_DAYS = 31;
const hasAll = (actor, key) => actor?.permissions?.[key] === 'ALL';
export const canManageRooms = (actor) => hasAll(actor, 'facilities.manage') || hasAll(actor, 'timetable.manage');
const fail = (msg, status = 400, code = 'BAD_REQUEST', details = []) => new AppError(msg, status, details, code);
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const shortDate = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${DOW[dowOfYmd(ymd)]} ${d} ${MONTH[m - 1]}`; };

// ── Finding things by what people call them ─────────────────────────────

/** A class by id or by what people call it: "7B", "Class 7 B", "7-B", "class 10 a". */
export async function resolveSection(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw fail('Which class? e.g. "7B".', 400, 'AGENT_NEEDS_INPUT');
  if (mongoose.isValidObjectId(raw)) {
    const s = await Section.findById(raw).populate('gradeId', 'name level').lean();
    if (s) return s;
  }
  const m = /(?:class|grade|std\.?)?\s*([0-9]{1,2}|[ivx]{1,4})\s*[- ]?\s*([a-z])\b/i.exec(raw);
  if (m) {
    const all = await Section.find({ name: new RegExp(`^${m[2]}$`, 'i') }).populate('gradeId', 'name level').lean();
    const hit = all.find((s) => new RegExp(`(^|\\s)${m[1]}$`, 'i').test(String(s.gradeId?.name ?? '')) || String(s.gradeId?.level ?? '') === m[1]);
    if (hit) return hit;
  }
  throw fail(`I could not find the class "${raw}".`, 404, 'NOT_FOUND');
}

/** A room by id, code or name ("204", "R204", "the science lab", "auditorium"). */
export async function resolveFacility(value, index = null) {
  const raw = String(value ?? '').trim().replace(/^(?:the|room)\s+/i, '');
  if (!raw) throw fail('Which room?', 400, 'AGENT_NEEDS_INPUT');
  const idx = index ?? await facilityIndex();
  const visible = idx.list.filter((f) => !f.restricted);
  let f = matchFacility(visible, raw) ?? matchFacility(visible, `room ${raw}`);
  if (!f) {
    const words = raw.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !['lab', 'room', 'hall'].includes(w));
    const kindWord = /\blab\b/i.test(raw) ? 'LAB' : /\bauditorium\b/i.test(raw) ? 'AUDITORIUM' : /\blibrary\b/i.test(raw) ? 'LIBRARY' : /\bhall\b/i.test(raw) ? null : null;
    const pool = visible.filter((x) => !kindWord || x.kind === kindWord);
    f = pool.find((x) => words.length && words.every((w) => x.name.toLowerCase().includes(w)))
      ?? pool.find((x) => /^\d+$/.test(raw) && (x.code.endsWith(raw) || x.name.endsWith(raw)))
      ?? (kindWord && pool.length === 1 ? pool[0] : null)
      ?? (kindWord === 'AUDITORIUM' && pool.length ? pool[0] : null);
  }
  if (!f) throw fail(`I could not find a room called "${raw}".`, 404, 'NOT_FOUND');
  return f;
}

async function strengthOf(sectionId) {
  return Enrollment.countDocuments({ sectionId, status: 'ACTIVE' });
}

async function familySectionIds(actor) {
  const kids = await ownStudentIds(actor);
  if (!kids.length) return new Set();
  return new Set((await Enrollment.find({ studentId: { $in: kids }, status: 'ACTIVE' }).select('sectionId').lean()).map((e) => String(e.sectionId)));
}

// ── Settings ─────────────────────────────────────────────────────────────

export async function getSettings() {
  const row = await ExamRoomSettings.findOne({ key: 'default' }).lean();
  return { teacherSelfShift: Boolean(row?.teacherSelfShift), changedAt: row?.changedAt ?? null };
}

export async function setSettings(actor, body = {}) {
  if (!(canManageRooms(actor) || hasAll(actor, 'settings.manage'))) throw fail('Only the administrator or principal can change this.', 403, 'FORBIDDEN');
  if (typeof body.teacherSelfShift !== 'boolean') throw fail('teacherSelfShift must be true or false');
  await ExamRoomSettings.findOneAndUpdate({ key: 'default' }, { $set: { teacherSelfShift: body.teacherSelfShift, changedByProfileId: actor.profileId, changedAt: new Date() } }, { upsert: true });
  return getSettings();
}

// ── Home rooms ───────────────────────────────────────────────────────────

const roomOut = (f) => (f ? { id: String(f._id), code: f.code, name: f.name, kind: f.kind, capacity: f.capacity ?? null } : null);

/**
 * Makes a facility a class's home room (or clears it with facility null),
 * keeping the history, moving the timetable slots that named the old room,
 * and refusing a room another class calls home unless `displace` is given.
 */
async function applyHomeRoom({ section, facility, reason, actor, via = 'ASSIGN', shiftId = null, displace = false }) {
  const old = await Facility.findOne({ sectionId: section._id });
  if (facility && old && String(old._id) === String(facility._id)) return { section, from: old, to: old, unchanged: true };
  let displaced = null;
  if (facility?.sectionId && String(facility.sectionId) !== String(section._id)) {
    const occupant = await Section.findById(facility.sectionId).populate('gradeId', 'name').lean();
    if (!displace) {
      throw fail(`${facility.name} is already the home room of ${sectionLabel(occupant)}. Choose another room, or confirm moving ${sectionLabel(occupant)} out.`, 409, 'ROOM_TAKEN', [{ occupant: sectionLabel(occupant), sectionId: String(facility.sectionId) }]);
    }
    displaced = occupant;
  }
  if (old) { old.sectionId = null; await old.save(); }
  if (facility) {
    await Facility.updateOne({ _id: facility._id }, { $set: { sectionId: section._id } });
    if (displaced) {
      await SectionRoomChange.create({ sectionId: displaced._id, facilityId: null, previousFacilityId: facility._id, reason: `Room given to ${sectionLabel(section)}${reason ? `: ${reason}` : ''}`, via: 'DISPLACED', changedByProfileId: actor.profileId, changedByName: actor.displayName ?? null });
    }
  }
  // Slots that named the old home room now name the new one (or fall back to the home room).
  if (old) {
    await TimetableSlot.updateMany({ sectionId: section._id, room: { $in: [old.code, old.name].filter(Boolean) } }, { $set: { room: facility ? facility.code : null } });
  }
  await SectionRoomChange.create({ sectionId: section._id, facilityId: facility?._id ?? null, previousFacilityId: old?._id ?? null, reason: reason ?? null, via, roomShiftId: shiftId, changedByProfileId: actor.profileId, changedByName: actor.displayName ?? null });
  return { section, from: old, to: facility, displaced };
}

export async function assignHomeRoom(actor, body = {}) {
  requireProfile(actor);
  if (!canManageRooms(actor)) throw fail('Only the administrator or principal can change a class\'s home room.', 403, 'FORBIDDEN');
  const section = await resolveSection(body.sectionId ?? body.className);
  const facility = body.facilityId === null || body.room === null ? null : await resolveFacility(body.facilityId ?? body.room);
  if (facility && !TEACHING_KINDS.includes(facility.kind)) throw fail(`${facility.name} is a ${facility.kind.toLowerCase().replace(/_/g, ' ')}, not a room a class can call home.`);
  const reason = optionalText(body.reason, { max: 300 }) || null;
  const out = await applyHomeRoom({ section, facility, reason, actor, displace: body.displace === true });
  const strength = await strengthOf(section._id);
  return {
    sectionId: String(section._id), className: sectionLabel(section), strength,
    from: roomOut(out.from), to: roomOut(out.to), unchanged: Boolean(out.unchanged),
    displaced: out.displaced ? sectionLabel(out.displaced) : null,
    fits: out.to?.capacity ? strength <= out.to.capacity : null,
  };
}

/** Rooms & Classes: every class's home room against its strength, and every room's occupant. */
export async function roomsAndClasses(actor, { date = null } = {}) {
  const ymd = date ? parseYmd(date) : todayYmd();
  const family = FAMILY.has(actor.roleKey);
  const own = family ? await familySectionIds(actor) : null;
  const [sections, idx, counts, shifts, pending, settings] = await Promise.all([
    Section.find({}).populate('gradeId', 'name level').populate('classTeacherId', 'displayName').lean(),
    facilityIndex(),
    Enrollment.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
    RoomShift.find({ status: 'APPLIED', kind: 'TEMPORARY', startDate: { $lte: dayKey(ymd) }, endDate: { $gte: dayKey(ymd) } }).lean(),
    canManageRooms(actor) ? RoomShift.countDocuments({ status: 'REQUESTED' }) : RoomShift.countDocuments({ status: 'REQUESTED', requestedByProfileId: actor.profileId }),
    getSettings(),
  ]);
  const strength = new Map(counts.map((c) => [String(c._id), c.n]));
  const visible = sections.filter((s) => !own || own.has(String(s._id)))
    .sort((a, b) => (a.gradeId?.level ?? 0) - (b.gradeId?.level ?? 0) || String(a.name).localeCompare(String(b.name)));
  const rows = visible.map((s) => {
    const sid = String(s._id);
    const home = idx.homeOf.get(sid) ?? null;
    const n = strength.get(sid) ?? 0;
    const today = shifts.filter((x) => String(x.sectionId) === sid).map((x) => ({ refNo: x.refNo, room: idx.byId.get(String(x.toFacilityId))?.name ?? 'another room', periods: x.periods ?? [], reason: x.reason }));
    return {
      sectionId: sid, className: sectionLabel(s), strength: n, classTeacher: family ? null : s.classTeacherId?.displayName ?? null,
      homeRoom: roomOut(home), fits: home?.capacity ? n <= home.capacity : null, spare: home?.capacity ? home.capacity - n : null,
      shiftedToday: today,
    };
  });
  const rooms = family ? [] : idx.list.filter((f) => TEACHING_KINDS.includes(f.kind) && !f.restricted)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .map((f) => {
      const occ = f.sectionId ? sections.find((s) => String(s._id) === String(f.sectionId)) : null;
      const n = occ ? strength.get(String(occ._id)) ?? 0 : null;
      const movedIn = shifts.filter((x) => String(x.toFacilityId) === String(f._id)).map((x) => ({ className: sectionLabel(sections.find((s) => String(s._id) === String(x.sectionId))), periods: x.periods ?? [], reason: x.reason }));
      return { ...roomOut(f), status: f.status, occupant: occ ? { sectionId: String(occ._id), className: sectionLabel(occ), strength: n } : null, fits: occ && f.capacity ? n <= f.capacity : null, movedInToday: movedIn };
    });
  return {
    date: ymd, sections: rows, rooms,
    totals: { classes: rows.length, withoutRoom: rows.filter((r) => !r.homeRoom).length, overCapacity: rows.filter((r) => r.fits === false).length, freeRooms: rooms.filter((r) => !r.occupant && r.kind === 'CLASSROOM').length, shiftedToday: shifts.length, pendingRequests: family ? 0 : pending },
    canManage: canManageRooms(actor), settings,
  };
}

/** A class's home-room history, newest first. */
export async function sectionHistory(actor, sectionRef) {
  const section = await resolveSection(sectionRef);
  if (FAMILY.has(actor.roleKey) && !(await familySectionIds(actor)).has(String(section._id))) throw fail('You can see your own class only.', 403, 'FORBIDDEN');
  const rows = await SectionRoomChange.find({ sectionId: section._id }).sort({ at: -1 }).limit(100).lean();
  const ids = [...new Set(rows.flatMap((r) => [r.facilityId, r.previousFacilityId]).filter(Boolean).map(String))];
  const facs = new Map((await Facility.find({ _id: { $in: ids } }).select('code name').lean()).map((f) => [String(f._id), f]));
  return {
    sectionId: String(section._id), className: sectionLabel(section),
    items: rows.map((r) => ({ id: String(r._id), at: r.at, to: facs.get(String(r.facilityId))?.name ?? null, from: facs.get(String(r.previousFacilityId))?.name ?? null, reason: r.reason, via: r.via, by: FAMILY.has(actor.roleKey) ? null : r.changedByName })),
  };
}

// ── Room shifts ──────────────────────────────────────────────────────────

function whenText(kind, startDate, endDate, periods) {
  const p = periods?.length ? `, period${periods.length > 1 ? 's' : ''} ${periods.join(', ')}` : '';
  if (kind === 'PERMANENT') return `from ${shortDate(startDate)} onwards (permanent)`;
  if (startDate === endDate) return `on ${shortDate(startDate)}${p || ' (all day)'}`;
  return `from ${shortDate(startDate)} to ${shortDate(endDate)}${p || ' (all day)'}`;
}

/** Reads a shift request into dates, periods and rooms; no database writes. */
async function readShift(actor, body) {
  const section = await resolveSection(body.sectionId ?? body.className);
  const idx = await facilityIndex();
  const to = await resolveFacility(body.toFacilityId ?? body.toRoom ?? body.room, idx);
  const kind = body.kind === 'PERMANENT' ? 'PERMANENT' : 'TEMPORARY';
  const startDate = parseYmd(body.startDate ?? body.date ?? todayYmd(), 'startDate');
  const endDate = kind === 'PERMANENT' ? startDate : parseYmd(body.endDate ?? startDate, 'endDate');
  if (endDate < startDate) throw fail('The end date is before the start date.');
  if (datesBetween(startDate, endDate, MAX_SHIFT_DAYS + 1).length > MAX_SHIFT_DAYS) throw fail(`A temporary shift can cover at most ${MAX_SHIFT_DAYS} days; make it permanent instead.`);
  if (startDate < todayYmd()) throw fail('That date has already passed.');
  const periods = [...new Set((Array.isArray(body.periods) ? body.periods : body.periodNo ? [body.periodNo] : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20))].sort((a, b) => a - b);
  if (kind === 'PERMANENT' && periods.length) throw fail('A permanent shift moves the class for every period; leave the periods out.');
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 3) throw fail('Give a reason for the move (e.g. "painting").', 400, 'AGENT_NEEDS_INPUT');
  if (!TEACHING_KINDS.includes(to.kind)) throw fail(`${to.name} is a ${to.kind.toLowerCase().replace(/_/g, ' ')}; choose a classroom, lab, library, hall or auditorium.`);
  return { section, to, idx, kind, startDate, endDate, periods, reason: reason.slice(0, 300) };
}

/**
 * Checks a shift against the timetable, exams, bookings and maintenance for
 * every affected lesson, and the room's size against the class.
 */
async function planShift(input, { ignoreShiftId = null, getDay = dayCache() } = {}) {
  const { section, to, kind, startDate, endDate, periods } = input;
  const sid = String(section._id);
  const dates = kind === 'PERMANENT' ? datesBetween(startDate, addDays(startDate, 6), 7) : datesBetween(startDate, endDate, MAX_SHIFT_DAYS);
  const strength = await strengthOf(section._id);
  const lessons = [];
  const conflicts = [];
  const warnings = [];
  const home = input.idx.homeOf.get(sid) ?? null;
  for (const ymd of dates) {
    // eslint-disable-next-line no-await-in-loop -- one cached snapshot per date
    const day = await getDay(ymd);
    const mine = day.lessons.filter((l) => l.sectionId === sid && (!periods.length || periods.includes(l.periodNo)));
    for (const l of mine) {
      lessons.push({ date: ymd, periodNo: l.periodNo, start: l.start, end: l.end, teacherId: l.teacherId, subject: l.subject, offeringId: l.slot.subjectOfferingId?._id ? String(l.slot.subjectOfferingId._id) : null, current: l.facilityId });
      for (const c of roomConflicts(day, to._id, l.start, l.end, { sectionIds: [sid], ignoreShiftId })) conflicts.push({ date: ymd, periodNo: l.periodNo, ...c });
      const ownExam = day.sittings.find((s) => (s.sectionIds ?? []).map(String).includes(sid) && sittingWindow(s).start < l.end && l.start < sittingWindow(s).end);
      if (ownExam) warnings.push(`${shortDate(ymd)} period ${l.periodNo}: ${sectionLabel(section)} is sitting ${ownExam.title} then.`);
    }
  }
  if (!lessons.length) {
    throw fail(periods.length
      ? `${sectionLabel(section)} has no period ${periods.join(', ')} on ${dates.length === 1 ? shortDate(dates[0]) : 'those days'}.`
      : `${sectionLabel(section)} has no lessons on ${dates.length === 1 ? shortDate(dates[0]) : 'those days'}.`, 400, 'NO_LESSONS');
  }
  if (to.capacity && strength > to.capacity) warnings.push(`${to.name} seats ${to.capacity}; ${sectionLabel(section)} has ${strength} pupils.`);
  if (kind === 'PERMANENT' && to.sectionId && String(to.sectionId) !== sid) {
    const occ = await Section.findById(to.sectionId).populate('gradeId', 'name').lean();
    conflicts.push({ date: startDate, periodNo: null, kind: 'HOME_ROOM', detail: `${to.name} is the home room of ${sectionLabel(occ)}` });
  }
  if (lessons.every((l) => l.current === String(to._id))) warnings.push(`${sectionLabel(section)} is already in ${to.name} then.`);
  // A slot that ends as a free period still counts once per lesson; dedupe identical clashes.
  const seen = new Set();
  const uniq = conflicts.filter((c) => { const k = `${c.date}|${c.periodNo}|${c.kind}|${c.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { section, to, home, strength, kind, startDate, endDate, periods, dates, lessons, conflicts: uniq, warnings, getDay };
}

/** Rooms free for every lesson of the plan, big enough for the class, closest fit first. */
async function suggestRooms(plan, limit = 5) {
  const candidates = plan.getDay ? (await plan.getDay(plan.dates[0])).index.list : [];
  const out = [];
  for (const f of candidates) {
    if (!TEACHING_KINDS.includes(f.kind) || f.restricted || f.status !== 'ACTIVE' || String(f._id) === String(plan.to._id)) continue;
    if (f.capacity && f.capacity < plan.strength) continue;
    if (plan.kind === 'PERMANENT' && f.sectionId && String(f.sectionId) !== String(plan.section._id)) continue;
    let free = true;
    for (const l of plan.lessons) {
      // eslint-disable-next-line no-await-in-loop -- cached per date
      const day = await plan.getDay(l.date);
      if (l.current === String(f._id) || roomConflicts(day, f._id, l.start, l.end, { sectionIds: [String(plan.section._id)] }).length) { free = false; break; }
    }
    if (free) out.push(f);
  }
  return out.sort((a, b) => (a.capacity ?? 9999) - (b.capacity ?? 9999)).slice(0, limit).map((f) => ({ ...roomOut(f), fits: f.capacity ? plan.strength <= f.capacity : null }));
}

const planOut = (plan) => ({
  className: sectionLabel(plan.section), sectionId: String(plan.section._id), strength: plan.strength,
  from: roomOut(plan.home), to: roomOut(plan.to), kind: plan.kind, startDate: plan.startDate, endDate: plan.endDate, periods: plan.periods,
  when: whenText(plan.kind, plan.startDate, plan.endDate, plan.periods),
  lessons: plan.lessons.length, conflicts: plan.conflicts.map(({ date, periodNo, kind, detail }) => ({ date, periodNo, kind, detail })), warnings: plan.warnings,
  fits: plan.to.capacity ? plan.strength <= plan.to.capacity : null,
});

/** What a teacher may move: their own class (any period) or the periods they teach. */
async function teacherMayShift(actor, plan) {
  const sid = String(plan.section._id);
  if (!(await getTeacherSectionIds(actor.profileId)).includes(sid)) throw fail(`You do not teach ${sectionLabel(plan.section)}.`, 403, 'FORBIDDEN');
  if (String(plan.section.classTeacherId ?? '') === String(actor.profileId)) return true;
  const notMine = plan.lessons.filter((l) => l.teacherId !== String(actor.profileId));
  if (notMine.length) throw fail(`You can move only the periods you teach in ${sectionLabel(plan.section)}${plan.periods.length ? '' : ': name the period'} (period ${[...new Set(notMine.map((l) => l.periodNo))].join(', ')} is taught by a colleague).`, 403, 'FORBIDDEN');
  return true;
}

/** Checks a shift without saving it: conflicts, warnings and free rooms that fit. */
export async function checkShift(actor, body = {}) {
  requireProfile(actor);
  const input = await readShift(actor, body);
  const plan = await planShift(input);
  if (!canManageRooms(actor)) await teacherMayShift(actor, plan);
  return { ...planOut(plan), suggestions: await suggestRooms(plan), canApply: canManageRooms(actor) };
}

function presentShift(s, { idx, sections, names } = {}) {
  const sec = sections?.get(String(s.sectionId));
  return {
    id: String(s._id), refNo: s.refNo, sectionId: String(s.sectionId), className: sec ? sectionLabel(sec) : null,
    kind: s.kind, status: s.status, startDate: ymdOf(s.startDate), endDate: ymdOf(s.endDate), periods: s.periods ?? [],
    when: whenText(s.kind, ymdOf(s.startDate), ymdOf(s.endDate), s.periods),
    from: roomOut(idx?.byId.get(String(s.fromFacilityId)) ?? null), to: roomOut(idx?.byId.get(String(s.toFacilityId)) ?? null),
    reason: s.reason, requestedBy: s.requestedByName ?? names?.get(String(s.requestedByProfileId)) ?? null, requestedByProfileId: String(s.requestedByProfileId),
    selfApplied: Boolean(s.selfApplied), decidedBy: names?.get(String(s.decidedByProfileId)) ?? null, decidedAt: s.decidedAt, decisionNote: s.decisionNote,
    createdAt: s.createdAt, history: s.history ?? [],
  };
}

async function presentShifts(rows) {
  const idx = await facilityIndex();
  const sections = new Map((await Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).populate('gradeId', 'name').lean()).map((s) => [String(s._id), s]));
  const names = await profileNames(rows.map((r) => r.decidedByProfileId));
  return rows.map((r) => presentShift(r, { idx, sections, names }));
}

/** Puts an applied shift into effect: a permanent one changes the home room; both tell the people affected. */
async function putIntoEffect(doc, plan, actor) {
  if (doc.kind === 'PERMANENT') {
    await applyHomeRoom({ section: plan.section, facility: plan.to, reason: doc.reason, actor, via: 'SHIFT', shiftId: doc._id, displace: false });
  }
  const offeringIds = doc.periods?.length ? [...new Set(plan.lessons.map((l) => l.offeringId).filter(Boolean))] : null;
  const told = await notifyRoomShift(doc, { className: sectionLabel(plan.section), room: plan.to.name, when: whenText(doc.kind, plan.startDate, plan.endDate, plan.periods), offeringIds });
  doc.notifiedAt = new Date();
  await doc.save();
  return told;
}

/**
 * Moves a class to another room. An administrator or principal applies it at
 * once; a teacher's request waits for them, unless the self-shift setting is
 * on and it is one period on one day into a free room. A room that is busy is
 * refused with free rooms that fit the class.
 */
export async function createShift(actor, body = {}) {
  requireProfile(actor);
  const manager = canManageRooms(actor);
  if (!manager && !actor.permissions?.['facilities.request']) throw fail('You cannot move classes between rooms.', 403, 'FORBIDDEN');
  const input = await readShift(actor, body);
  const plan = await planShift(input);
  if (!manager) await teacherMayShift(actor, plan);
  if (plan.conflicts.length) {
    const suggestions = await suggestRooms(plan);
    throw fail(`${plan.to.name} is not free: ${plan.conflicts.slice(0, 3).map((c) => `${shortDate(c.date)}${c.periodNo ? ` P${c.periodNo}` : ''}: ${c.detail}`).join('; ')}.${suggestions.length ? ` Free rooms that fit: ${suggestions.map((s) => s.name).join(', ')}.` : ''}`, 409, 'ROOM_CLASH', [{ conflicts: planOut(plan).conflicts, suggestions }]);
  }
  const settings = await getSettings();
  const selfShift = !manager && settings.teacherSelfShift && plan.kind === 'TEMPORARY' && plan.startDate === plan.endDate && plan.periods.length === 1;
  const status = manager || selfShift ? 'APPLIED' : 'REQUESTED';
  const doc = new RoomShift({
    refNo: await nextRef('RSH'), sectionId: plan.section._id, kind: plan.kind, fromFacilityId: plan.home?._id ?? null, toFacilityId: plan.to._id,
    startDate: dayKey(plan.startDate), endDate: dayKey(plan.endDate), periods: plan.periods, reason: input.reason, status,
    requestedByProfileId: actor.profileId, requestedByName: actor.displayName ?? null, selfApplied: selfShift,
    ...(status === 'APPLIED' ? { decidedByProfileId: actor.profileId, decidedAt: new Date() } : {}),
  });
  pushHistory(doc, actor, status === 'APPLIED' ? (selfShift ? 'self_applied' : 'applied') : 'requested', { to: status, note: input.reason });
  await doc.save();
  let told = null;
  if (status === 'APPLIED') told = await putIntoEffect(doc, plan, actor);
  else {
    const approvers = (await profilesWithRoles(['ADMIN', 'PRINCIPAL'])).map((p) => String(p._id));
    await notify({ recipientProfileIds: approvers, title: `Room shift request: ${sectionLabel(plan.section)} to ${plan.to.name}`, body: `${actor.displayName ?? 'A teacher'} asks to move ${sectionLabel(plan.section)} to ${plan.to.name} ${whenText(plan.kind, plan.startDate, plan.endDate, plan.periods)} (${input.reason}). ${doc.refNo}`, link: '/rooms-classes?tab=shifts' });
  }
  const [out] = await presentShifts([doc.toObject()]);
  return { ...out, applied: status === 'APPLIED', warnings: plan.warnings, notified: told };
}

/** The administrator or principal applies or turns down a teacher's request (on the screen). */
export async function decideShift(actor, id, body = {}) {
  requireProfile(actor);
  if (!canManageRooms(actor)) throw fail('Only the administrator or principal can decide room shift requests.', 403, 'FORBIDDEN');
  const doc = await RoomShift.findById(assertObjectId(id));
  if (!doc) throw fail('Room shift not found', 404, 'NOT_FOUND');
  if (doc.status !== 'REQUESTED') throw fail(`This shift is already ${doc.status.toLowerCase()}.`, 409, 'INVALID_TRANSITION');
  const action = String(body.action ?? '').toUpperCase();
  const note = optionalText(body.note, { max: 300 }) || null;
  if (action === 'REJECT') {
    if (!note) throw fail('Say why the request is turned down.');
    doc.status = 'REJECTED'; doc.decidedByProfileId = actor.profileId; doc.decidedAt = new Date(); doc.decisionNote = note;
    pushHistory(doc, actor, 'rejected', { from: 'REQUESTED', to: 'REJECTED', note });
    await doc.save();
    await notify({ recipientProfileIds: [String(doc.requestedByProfileId)], title: `Room shift ${doc.refNo} turned down`, body: note, link: '/rooms-classes?tab=shifts' });
    return (await presentShifts([doc.toObject()]))[0];
  }
  if (action !== 'APPROVE') throw fail('action must be APPROVE or REJECT');
  const input = await readShift(actor, { sectionId: String(doc.sectionId), toFacilityId: String(doc.toFacilityId), kind: doc.kind, startDate: ymdOf(doc.startDate) < todayYmd() ? todayYmd() : ymdOf(doc.startDate), endDate: ymdOf(doc.endDate), periods: doc.periods, reason: doc.reason });
  const plan = await planShift(input, { ignoreShiftId: doc._id });
  if (plan.conflicts.length) throw fail(`${plan.to.name} is no longer free: ${plan.conflicts.slice(0, 3).map((c) => c.detail).join('; ')}.`, 409, 'ROOM_CLASH', [{ conflicts: planOut(plan).conflicts, suggestions: await suggestRooms(plan) }]);
  doc.status = 'APPLIED'; doc.decidedByProfileId = actor.profileId; doc.decidedAt = new Date(); doc.decisionNote = note;
  pushHistory(doc, actor, 'applied', { from: 'REQUESTED', to: 'APPLIED', note });
  await doc.save();
  const told = await putIntoEffect(doc, plan, actor);
  await notify({ recipientProfileIds: [String(doc.requestedByProfileId)], title: `Room shift ${doc.refNo} applied`, body: `${sectionLabel(plan.section)} moves to ${plan.to.name} ${whenText(doc.kind, plan.startDate, plan.endDate, plan.periods)}.`, link: '/rooms-classes?tab=shifts' });
  return { ...(await presentShifts([doc.toObject()]))[0], notified: told };
}

/** Withdraw a request, or end an applied temporary shift early (the class goes back to its room). */
export async function cancelShift(actor, id, body = {}) {
  requireProfile(actor);
  const doc = await RoomShift.findById(assertObjectId(id));
  if (!doc) throw fail('Room shift not found', 404, 'NOT_FOUND');
  const mine = String(doc.requestedByProfileId) === String(actor.profileId);
  if (!canManageRooms(actor) && !(mine && (doc.status === 'REQUESTED' || doc.selfApplied))) throw fail('You can cancel only your own requests.', 403, 'FORBIDDEN');
  if (!['REQUESTED', 'APPLIED'].includes(doc.status)) throw fail(`This shift is already ${doc.status.toLowerCase()}.`, 409, 'INVALID_TRANSITION');
  if (doc.status === 'APPLIED' && doc.kind === 'PERMANENT') throw fail('A permanent move is undone by assigning the home room again.', 409, 'INVALID_TRANSITION');
  const wasApplied = doc.status === 'APPLIED';
  const reason = optionalText(body.reason, { max: 300 }) || 'Cancelled';
  pushHistory(doc, actor, 'cancelled', { from: doc.status, to: 'CANCELLED', note: reason });
  doc.status = 'CANCELLED';
  await doc.save();
  if (wasApplied && ymdOf(doc.endDate) >= todayYmd()) {
    const section = await Section.findById(doc.sectionId).populate('gradeId', 'name').lean();
    const home = await Facility.findOne({ sectionId: doc.sectionId }).select('name').lean();
    await notifyRoomShift(doc, { className: sectionLabel(section), room: home?.name ?? 'its usual room', when: whenText(doc.kind, ymdOf(doc.startDate), ymdOf(doc.endDate), doc.periods), reason: `room change cancelled: ${reason}`, key: 'cancelled' });
  }
  return (await presentShifts([doc.toObject()]))[0];
}

export async function listShifts(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status && query.status !== 'ALL') filter.status = String(query.status).toUpperCase();
  if (query.from) filter.endDate = { $gte: dayKey(parseYmd(query.from, 'from')) };
  if (query.to) filter.startDate = { $lte: dayKey(parseYmd(query.to, 'to')) };
  if (query.sectionId) filter.sectionId = assertObjectId(query.sectionId, 'sectionId');
  if (FAMILY.has(actor.roleKey)) {
    filter.sectionId = { $in: [...(await familySectionIds(actor))] };
    filter.status = 'APPLIED';
  } else if (!canManageRooms(actor)) {
    const mine = await getTeacherSectionIds(actor.profileId);
    filter.$or = [{ requestedByProfileId: actor.profileId }, { sectionId: { $in: mine } }];
  }
  const rows = await RoomShift.find(filter).sort({ startDate: -1, createdAt: -1 }).limit(200).lean();
  const out = await presentShifts(rows);
  return FAMILY.has(actor.roleKey) ? out.map((r) => ({ ...r, requestedBy: null, requestedByProfileId: null, decidedBy: null, history: [] })) : out;
}

// ── Where is a class, and which rooms are free ──────────────────────────

/** "Which room is 7B in today?" — every lesson of the day in its effective room, and any paper it sits. */
export async function sectionRoomOn(actor, { className = null, sectionId = null, date = null } = {}) {
  const section = await resolveSection(sectionId ?? className);
  if (FAMILY.has(actor.roleKey) && !(await familySectionIds(actor)).has(String(section._id))) throw fail('You can ask about your own class only.', 403, 'FORBIDDEN');
  const ymd = date ? parseYmd(date) : todayYmd();
  const getDay = dayCache();
  const day = await getDay(ymd);
  const sid = String(section._id);
  const home = day.index.homeOf.get(sid) ?? null;
  const periods = day.lessons.filter((l) => l.sectionId === sid).sort((a, b) => a.start - b.start).map((l) => {
    const f = day.index.byId.get(l.facilityId);
    return { periodNo: l.periodNo, startTime: hhmm(l.start), endTime: hhmm(l.end), subject: l.subject, room: f?.name ?? null, roomCode: f?.code ?? null, facilityId: l.facilityId, moved: l.shift ? { refNo: l.shift.refNo, reason: l.shift.reason } : null };
  });
  const exams = day.sittings.filter((s) => (s.sectionIds ?? []).map(String).includes(sid)).map((s) => {
    const w = sittingWindow(s);
    return { title: s.title, startTime: hhmm(w.start), endTime: hhmm(w.end), rooms: (s.venues ?? []).map((v) => day.index.byId.get(String(v.facilityId))?.name).filter(Boolean) };
  });
  const now = localParts(new Date());
  const current = ymd === now.ymd ? periods.find((p) => toMin(p.startTime) <= now.minutes && toMin(p.endTime) > now.minutes) ?? null : null;
  return { date: ymd, className: sectionLabel(section), sectionId: sid, homeRoom: roomOut(home), now: current, periods, exams, moved: periods.some((p) => p.moved) };
}

/** Rooms free for a window (or for some periods of a class), big enough when a size is given. */
export async function freeRooms(actor, { date = null, startTime = null, endTime = null, sectionId = null, className = null, periods = null, minCapacity = null } = {}) {
  const ymd = date ? parseYmd(date) : todayYmd();
  const getDay = dayCache();
  const day = await getDay(ymd);
  let windows = [];
  let need = Number(minCapacity) || 0;
  let section = null;
  if (sectionId || className) {
    section = await resolveSection(sectionId ?? className);
    need = Math.max(need, day.strength.get(String(section._id)) ?? 0);
    const want = (Array.isArray(periods) ? periods : periods ? [periods] : []).map(Number);
    windows = day.lessons.filter((l) => l.sectionId === String(section._id) && (!want.length || want.includes(l.periodNo))).map((l) => [l.start, l.end]);
  }
  if (startTime && endTime) windows.push([toMin(startTime), toMin(endTime)]);
  if (!windows.length) throw fail('Say when: a time window, or a class and its periods.', 400, 'AGENT_NEEDS_INPUT');
  const rooms = day.index.list.filter((f) => TEACHING_KINDS.includes(f.kind) && !f.restricted && f.status === 'ACTIVE' && (!need || !f.capacity || f.capacity >= need))
    .filter((f) => windows.every(([s, e]) => !roomConflicts(day, f._id, s, e, { sectionIds: section ? [String(section._id)] : [] }).length));
  return {
    date: ymd, windows: windows.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`), minCapacity: need || null,
    rooms: rooms.sort((a, b) => (a.capacity ?? 9999) - (b.capacity ?? 9999)).map(roomOut),
  };
}

// ── For other modules: the effective room of a period ───────────────────

/** Monday of the school week containing a date. */
const mondayOf = (ymd) => addDays(ymd, 1 - dowOfYmd(ymd));

/**
 * The effective room for this week's lessons, for timetable views: a Map of
 * slot id → { room, roomCode, date, refNo, reason } for slots a shift moves.
 */
export async function weekOverrides(slots, { weekOf = null } = {}) {
  const out = new Map();
  if (!slots?.length) return out;
  const monday = mondayOf(weekOf ? parseYmd(weekOf) : todayYmd());
  const sunday = addDays(monday, 6);
  const shifts = await RoomShift.find({ status: 'APPLIED', kind: 'TEMPORARY', startDate: { $lte: dayKey(sunday) }, endDate: { $gte: dayKey(monday) } }).sort({ createdAt: -1 }).lean();
  if (!shifts.length) return out;
  const idx = await facilityIndex();
  for (const s of slots) {
    const ymd = addDays(monday, Number(s.dayOfWeek) - 1);
    const onDay = shifts.filter((x) => ymdOf(x.startDate) <= ymd && ymdOf(x.endDate) >= ymd);
    const hit = shiftFor(onDay, s.sectionId?._id ?? s.sectionId, s.periodNo);
    if (!hit) continue;
    const f = idx.byId.get(String(hit.toFacilityId));
    out.set(String(s._id), { room: f?.name ?? null, roomCode: f?.code ?? null, date: ymd, refNo: hit.refNo, reason: hit.reason });
  }
  return out;
}

/** Today's slots of one class, each carrying its effective room (for the live class page). */
export async function withEffectiveRooms(slots, ymd = todayYmd()) {
  if (!slots?.length) return slots;
  const shifts = await RoomShift.find({ status: 'APPLIED', kind: 'TEMPORARY', startDate: { $lte: dayKey(ymd) }, endDate: { $gte: dayKey(ymd) } }).sort({ createdAt: -1 }).lean();
  if (!shifts.length) return slots;
  const idx = await facilityIndex();
  for (const s of slots) {
    const { facility, shift } = effectiveRoom(idx, shifts, s);
    if (shift && facility) { s.room = facility.code; s.roomShift = { refNo: shift.refNo, reason: shift.reason, room: facility.name }; }
  }
  return slots;
}

/** What is in a room at an instant beyond the timetable: an exam, a class moved in, a class moved out. */
export async function roomActivityAt(facilityId, at = new Date()) {
  const { ymd, minutes } = localParts(at);
  const day = await loadDay(ymd);
  const fid = String(facilityId);
  const exams = day.sittings.filter((s) => { const w = sittingWindow(s); return w.start <= minutes && w.end > minutes && (s.venues ?? []).some((v) => String(v.facilityId) === fid); });
  const movedIn = day.lessons.filter((l) => l.shift && l.facilityId === fid && l.start <= minutes && l.end > minutes);
  const movedOut = day.lessons.filter((l) => l.shift && l.facilityId !== fid && l.start <= minutes && l.end > minutes && (day.index.homeOf.get(l.sectionId) && String(day.index.homeOf.get(l.sectionId)._id) === fid));
  return { day, exams, movedIn, movedOut };
}

export const __test = { readShift, planShift, whenText };
