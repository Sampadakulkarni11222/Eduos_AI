import mongoose from 'mongoose';
import { Facility } from '../../models/facility.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import { CalendarEvent } from '../../models/calendarEvent.model.js';
import { Enrollment } from '../../models/student.model.js';
import { ExamSubject } from '../../models/exam.model.js';
import { SchoolShift } from '../../models/schoolShift.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { featuresFor } from '../../utils/features.js';
import { logger } from '../../utils/logger.js';
import { shortCache } from '../../utils/shortCache.js';
import { DEFAULT_TZ } from '../../utils/periods.js';
import { startOfDayUtc } from '../ops/common.js';
import { liveBySection } from './live.service.js';
import { loadOptional } from './layers.service.js';
import { campusDayExtras } from '../examRooms/campus.js';
import { shiftFor } from '../examRooms/occupancy.js';
import {
  addDaysYmd, bannerFor, bellsFromSlots, dayKindFor, dowOfYmd, hhmm, instantOf, isOutdoorSubject, localParts, nextOpening, phaseOf, toMin,
} from './day-plan.js';

/**
 * What is happening on the campus at a moment — now, or any date and time a
 * viewer picks — computed from the records that plan the school day, never
 * from the clock alone:
 *   - the calendar (holidays, vacations, closures, exam-only days),
 *   - the shifts and their bell schedules (or, with no shifts set up, the
 *     bells read off the timetable), and which sections belong to each,
 *   - the timetable (which class is in which room for each period, and with
 *     whom), exam papers, club sessions and the day's bus trips,
 *   - today's attendance register for headcounts once it has been taken;
 *     before that, and for any other day, the class strength (scheduled).
 *
 * The answer places anonymous groups: "a class of 34 in Room 101", "lunch in
 * the canteen", "buses departing". Nobody is located or tracked. Families get
 * the same picture with counts only for their own child's class.
 */

const DAY_CACHE_MS = Number(process.env.CAMPUS_DAY_CACHE_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 60_000));
const STAFF_MAX_DAYS = 120;
const OUTDOOR = ['GROUND', 'COURT'];

/** A date and time the viewer asked for, as an instant; null for "now". Dates are kept within a sensible window. */
export function momentFromQuery({ date = null, at = null, now = new Date(), tz = DEFAULT_TZ } = {}) {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(at ?? ''));
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!t && !d) return null;
  const today = localParts(now, tz);
  let ymd = today.ymd;
  if (d) {
    const probe = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
    if (probe.getUTCMonth() !== +d[2] - 1) return null;
    const diff = Math.round((probe - new Date(`${today.ymd}T00:00:00Z`)) / 86_400_000);
    if (Math.abs(diff) > STAFF_MAX_DAYS) return null;
    ymd = date;
  }
  const minutes = t ? Number(t[1]) * 60 + Number(t[2]) : today.minutes;
  return instantOf(ymd, minutes, tz);
}

/** Everything about one school day that does not change minute by minute, read once and shared. */
async function loadDay(ymd, tz) {
  const dow = dowOfYmd(ymd);
  const dayStart = new Date(`${ymd}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [shiftsRaw, events, sections, slots, facilities, counts, papers, features] = await Promise.all([
    SchoolShift.find({ active: true }).lean(),
    // Wide enough to find when the school next opens (a long vacation included).
    CalendarEvent.find({ deletedAt: null, startsAt: { $lt: new Date(dayStart.getTime() + 62 * 86_400_000) }, endsAt: { $gte: new Date(dayStart.getTime() - 86_400_000) } }).select('title type startsAt endsAt deletedAt').lean(),
    Section.find({}).select('name gradeId classTeacherId').populate('gradeId', 'name level').lean(),
    TimetableSlot.find({ dayOfWeek: dow }).select('sectionId periodNo startTime endTime subjectOfferingId room')
      .populate({ path: 'subjectOfferingId', select: 'subjectId teacherId', populate: [{ path: 'subjectId', select: 'name' }, { path: 'teacherId', select: 'displayName' }] }).lean(),
    Facility.find({ kind: { $nin: ['CAMPUS', 'FLOOR', 'BUILDING'] } }).select('code name kind sectionId restricted status capacity').lean(),
    Enrollment.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]),
    ExamSubject.find({ examDate: { $gte: dayStart, $lt: dayEnd } }).select('subjectOfferingId').lean(),
    featuresFor().catch(() => ({})),
  ]);
  const paperOfferings = papers.map((p) => p.subjectOfferingId);
  const examSections = paperOfferings.length
    ? new Set((await SubjectOffering.find({ _id: { $in: paperOfferings } }).select('sectionId').lean()).map((o) => String(o.sectionId)))
    : new Set();
  const teacherIds = await SubjectOffering.distinct('teacherId', { teacherId: { $ne: null } });
  let trips = 0;
  if (features.fleet !== false) {
    try {
      const { Trip } = await import('../../models/fleet.model.js');
      trips = await Trip.countDocuments({ date: dayStart, status: { $ne: 'CANCELLED' } });
    } catch (err) { logger.warn(`Campus moment trips unavailable: ${err.message}`); }
  }
  let clubs = [];
  if (features.clubs !== false) {
    const fn = await loadOptional('clubs', ['../clubs/sessions.service.js'], 'clubsActivityFor');
    if (fn) clubs = (await fn(ymd).catch(() => [])).filter((c) => c.venue?.facilityId);
  }
  // With no shift set up, the whole school runs on the bells its timetable implies
  // (read from the whole week, so a Sunday still knows when Monday starts).
  const shifts = shiftsRaw.map((s) => ({ id: String(s._id), code: s.code, name: s.name, color: s.color ?? null, daysOfWeek: s.daysOfWeek, bells: s.bells, sectionIds: (s.sectionIds ?? []).map(String) }));
  const assigned = new Set(shifts.flatMap((s) => s.sectionIds));
  const unassigned = sections.filter((s) => !assigned.has(String(s._id)));
  if (!shifts.length || unassigned.length) {
    const ids = unassigned.map((s) => s._id);
    const match = shifts.length ? { sectionId: { $in: ids } } : {};
    const [days, triples] = await Promise.all([
      TimetableSlot.distinct('dayOfWeek', match),
      TimetableSlot.aggregate([{ $match: match }, { $group: { _id: { periodNo: '$periodNo', startTime: '$startTime', endTime: '$endTime' } } }]),
    ]);
    shifts.push({
      id: null, code: shifts.length ? 'UNASSIGNED' : 'SCHOOL', name: shifts.length ? 'Classes without a shift' : 'School day', color: null,
      daysOfWeek: [...new Set(days.map(Number))].filter((n) => n >= 1 && n <= 7).sort(), bells: bellsFromSlots(triples.map((t) => t._id)),
      sectionIds: shifts.length ? ids.map(String) : null, implied: true,
    });
  }
  // Part 8: papers with their rooms and invigilators, and room shifts applied for the day.
  const examRooms = await campusDayExtras(ymd).catch((err) => { logger.warn(`Campus moment exam rooms unavailable: ${err.message}`); return { sittings: [], shifts: [] }; });
  return { ymd, dow, tz, shifts, events, sections, slots, facilities, counts: new Map(counts.map((c) => [String(c._id), c.n])), examSections, teachers: teacherIds.length, trips, clubs, examRooms };
}

const labelOf = (sec) => `${sec?.gradeId?.name ?? ''} ${sec?.name ?? ''}`.trim();

/**
 * The campus at one instant. `viewer`: { family: boolean, ownSectionIds: Set }.
 * `registerToday`: whether to use today's attendance register for headcounts
 * (only when the moment is today).
 */
export async function campusMoment({ at = new Date(), now = new Date(), viewer = { family: false, ownSectionIds: new Set() }, tz = DEFAULT_TZ } = {}) {
  const { ymd, minutes } = localParts(at, tz);
  const day = await shortCache(`campus-day:${currentTenantId() ?? ''}:${ymd}`, DAY_CACHE_MS, () => loadDay(ymd, tz));
  const today = localParts(now, tz).ymd === ymd;
  const kind = dayKindFor({ ymd, events: day.events, shifts: day.shifts, tz });
  const sectionShift = new Map();
  for (const s of day.shifts) for (const id of s.sectionIds ?? []) sectionShift.set(id, s);
  const fallback = day.shifts.find((s) => s.implied) ?? null;
  const runsToday = (s) => (s.daysOfWeek?.length ? s.daysOfWeek : [1, 2, 3, 4, 5, 6]).includes(day.dow);
  const phases = kind.open ? day.shifts.filter(runsToday).map((s) => ({ ...phaseOf(s, minutes), color: s.color, sections: s.sectionIds ? s.sectionIds.length : day.sections.length })) : [];
  const phaseByShift = new Map(phases.map((p) => [p.code, p]));
  const next = nextOpening({ ymd, minutes, events: day.events, shifts: day.shifts, tz });
  const banner = bannerFor({ day: kind, phases, next });

  // Headcounts: today's register once taken, otherwise the class strength.
  let register = new Map();
  if (today && kind.open) {
    register = await liveBySection(day.sections.map((s) => s._id), now).catch(() => new Map());
  }
  const facilities = day.facilities.filter((f) => !f.restricted);
  const byCode = new Map();
  for (const f of facilities) for (const k of [f.code, f.name]) if (k && !byCode.has(k)) byCode.set(k, f);
  const homeOf = new Map(facilities.filter((f) => f.sectionId).map((f) => [String(f.sectionId), f]));
  const firstOf = (...kinds) => kinds.map((k) => facilities.find((f) => f.kind === k)).find(Boolean) ?? null;
  const ground = firstOf(...OUTDOOR);
  const canteen = firstOf('CANTEEN');
  const hall = firstOf('AUDITORIUM');
  const gate = firstOf('GATE');
  const bay = firstOf('TRANSPORT_BAY');
  const staffRoom = firstOf('STAFF_ROOM');
  const slotOf = new Map();
  for (const s of day.slots) slotOf.set(`${s.sectionId}|${s.periodNo}`, s);

  const crowd = new Map();
  const add = (f, students, activity, label, teachers = 0) => {
    if (!f || !(students > 0 || students === null || teachers > 0)) return;
    const k = String(f._id);
    const c = crowd.get(k) ?? { facilityId: k, students: 0, teachers: 0, activity, labels: [], hidden: false };
    if (students === null) c.hidden = true; else c.students += students;
    c.teachers += teachers;
    if (label && !c.labels.includes(label)) c.labels.push(label);
    // A room's activity is the most specific one in it.
    if (['EXAM', 'CLASS', 'SPORTS'].includes(activity) || !c.activity) c.activity = activity;
    crowd.set(k, c);
  };
  const sectionsOut = [];
  let teaching = 0;
  let onCampus = 0;
  // Part 8: a paper with a sitting runs on its own times and rooms (with any delay); a class
  // moved by a room shift is in its new room. Papers without a sitting keep the old estimate.
  const examRooms = day.examRooms ?? { sittings: [], shifts: [] };
  const examNow = kind.open ? examRooms.sittings.filter((x) => x.start <= minutes && x.end > minutes) : [];
  const examBySection = new Map();
  for (const x of examNow) for (const id of x.sectionIds) examBySection.set(id, x);
  const sittingToday = new Set(examRooms.sittings.flatMap((x) => x.sectionIds));
  for (const sec of day.sections) {
    const sid = String(sec._id);
    const shift = sectionShift.get(sid) ?? fallback;
    const p = shift ? phaseByShift.get(shift.code) : null;
    const strength = day.counts.get(sid) ?? 0;
    const reg = register.get(sid);
    const present = reg?.registerTaken ? reg.present : null;
    const own = viewer.ownSectionIds?.has(sid);
    const n = present ?? strength;
    // Families: anonymous groups everywhere, a number only for their own class.
    const shown = viewer.family && !own ? null : n;
    const label = viewer.family && !own ? null : labelOf(sec);
    let activity = null; let place = null; let slot = null; let moved = null;
    const examHere = examBySection.get(sid) ?? null;
    if (examHere) {
      activity = 'EXAM';
      place = facilities.find((f) => String(f._id) === examHere.venues[0]?.facilityId) ?? homeOf.get(sid) ?? null;
    } else if (kind.open && p && !['BEFORE', 'AFTER'].includes(p.phase)) {
      const examOnly = kind.kind === 'EXAM_ONLY';
      const sitting = day.examSections.has(sid) && !sittingToday.has(sid);
      if (examOnly && !sitting) activity = null;
      else if (p.phase === 'PERIOD' || p.phase === 'PASSING') {
        const no = p.phase === 'PERIOD' ? p.periodNo : (p.nextPeriodNo ?? p.prevPeriodNo);
        slot = slotOf.get(`${sid}|${no}`) ?? null;
        if (examOnly) { activity = no <= 3 ? 'EXAM' : null; place = activity ? homeOf.get(sid) : null; }
        else if (sitting && p.phase === 'PERIOD' && no <= 2) { activity = 'EXAM'; place = homeOf.get(sid); }
        else if (slot?.subjectOfferingId && isOutdoorSubject(slot.subjectOfferingId.subjectId?.name)) { activity = 'SPORTS'; place = ground; }
        else if (slot?.subjectOfferingId) { activity = p.phase === 'PASSING' ? 'CHANGEOVER' : 'CLASS'; place = (slot.room && byCode.get(slot.room)) || homeOf.get(sid); }
        else { activity = 'STUDY'; place = homeOf.get(sid); }
        if (['CLASS', 'CHANGEOVER', 'STUDY'].includes(activity) && no) {
          moved = shiftFor(examRooms.shifts, sid, no);
          if (moved) place = facilities.find((f) => String(f._id) === String(moved.toFacilityId)) ?? place;
        }
      } else if (p.phase === 'ASSEMBLY') { activity = 'ASSEMBLY'; place = ground ?? hall; }
      else if (p.phase === 'BREAK') { activity = 'BREAK'; place = ground; }
      else if (p.phase === 'LUNCH') { activity = 'LUNCH'; place = canteen ?? ground; }
      else if (p.phase === 'ARRIVAL') { activity = 'ARRIVAL'; place = gate; }
      else if (p.phase === 'DISPERSAL') { activity = 'DISPERSAL'; place = bay ?? gate; }
      else if (p.phase === 'CLUBS') { activity = null; }
    }
    const shownLabel = moved && label ? `${label} (moved here: ${moved.reason})` : label;
    if (activity === 'EXAM' && examHere) {
      // Counted per exam room below, with the seats and the invigilators.
      onCampus += n;
    } else if (activity) {
      onCampus += n;
      const teacherHere = ['CLASS', 'EXAM', 'SPORTS'].includes(activity) ? 1 : 0;
      teaching += teacherHere;
      if (activity === 'LUNCH' && canteen && ground) {
        // Lunch: most in the canteen, the rest out on the ground.
        const inHall = Math.round(n * 0.65);
        add(canteen, shown === null ? null : inHall, 'LUNCH', label);
        add(ground, shown === null ? null : n - inHall, 'BREAK', label);
      } else if ((activity === 'ARRIVAL' || activity === 'DISPERSAL') && gate && bay) {
        const byBus = Math.round(n * 0.5);
        add(bay, shown === null ? null : byBus, activity, label);
        add(gate, shown === null ? null : n - byBus, activity, label);
      } else add(place, shown, activity, shownLabel, teacherHere);
    }
    if (!viewer.family || own) {
      const subj = slot?.subjectOfferingId?.subjectId?.name ?? null;
      sectionsOut.push({
        sectionId: sid, className: labelOf(sec), shift: shift ? { code: shift.code, name: shift.name } : null,
        phase: p?.phase ?? (kind.open ? 'AFTER' : 'CLOSED'), activity, facilityId: place ? String(place._id) : null, place: place?.name ?? null,
        students: activity ? n : 0, strength, headcountFrom: present !== null ? 'REGISTER' : 'STRENGTH',
        periodNo: p?.phase === 'PERIOD' ? p.periodNo : null, subject: activity === 'CLASS' || activity === 'SPORTS' ? subj : null,
        // Teacher names stay with staff here; families see their own class's teacher in their own panel.
        teacher: !viewer.family && (activity === 'CLASS' || activity === 'SPORTS') ? slot?.subjectOfferingId?.teacherId?.displayName ?? null : null,
        teacherProfileId: !viewer.family && (activity === 'CLASS' || activity === 'SPORTS') && slot?.subjectOfferingId?.teacherId?._id ? String(slot.subjectOfferingId.teacherId._id) : null,
        until: p?.until ?? null,
        exam: examHere ? { title: examHere.title, subject: examHere.subject, rooms: examHere.venues.map((v) => facilities.find((f) => String(f._id) === v.facilityId)?.name).filter(Boolean) } : null,
        movedTo: moved ? { room: place?.name ?? null, reason: moved.reason } : null,
      });
    }
  }
  // Exam rooms: the seats taken and the invigilators, per room. Families get a number for their own class only.
  for (const x of examNow) {
    for (const v of x.venues) {
      const f = facilities.find((ff) => String(ff._id) === v.facilityId);
      const own = Object.entries(v.bySection).filter(([id]) => viewer.ownSectionIds?.has(id)).reduce((t, [, c]) => t + c, 0);
      add(f, viewer.family ? (own || null) : v.seated, 'EXAM', viewer.family ? null : v.label, viewer.family ? 0 : v.invigilators.length);
      teaching += v.invigilators.length;
    }
  }
  // Club sessions running now, at their venues.
  const clubsNow = day.clubs.filter((c) => new Date(c.startsAt) <= at && new Date(c.endsAt) > at);
  for (const c of clubsNow) {
    const f = facilities.find((x) => String(x._id) === c.venue.facilityId);
    add(f, viewer.family ? null : 12, 'CLUB', viewer.family ? null : c.clubName);
  }
  // Staff not teaching this period are in the staff room during school hours.
  const schoolHours = phases.some((p) => !['BEFORE', 'AFTER', 'CLUBS'].includes(p.phase));
  if (schoolHours && staffRoom) {
    const free = Math.max(0, day.teachers - teaching);
    if (free) add(staffRoom, 0, 'STAFF', viewer.family ? null : `${free} teachers free this period`, free);
  }
  // Buses: coming in at arrival, parked through the day, leaving at dispersal.
  const anyPhase = (k) => phases.some((p) => p.phase === k);
  const busPhase = !kind.open || !day.trips ? 'AWAY'
    : anyPhase('ARRIVAL') ? 'ARRIVING'
      : anyPhase('DISPERSAL') ? 'DEPARTING'
        : phases.some((p) => !['BEFORE', 'AFTER'].includes(p.phase)) ? 'PARKED' : 'AWAY';
  const busLabel = { AWAY: day.trips ? 'Buses are out on their routes or parked off site' : 'No bus trips on this day', ARRIVING: 'Buses arriving with students', DEPARTING: 'Buses departing with students', PARKED: 'Buses parked in the bay' }[busPhase];
  const walkers = !banner.motion ? 'NONE'
    : phases.some((p) => ['ARRIVAL', 'DISPERSAL', 'BREAK', 'LUNCH', 'PASSING'].includes(p.phase)) ? 'BUSY' : 'FEW';
  const register0 = [...register.values()];
  return {
    date: ymd, time: hhmm(minutes), dayOfWeek: day.dow, timezone: tz,
    isToday: today, live: Math.abs(at.getTime() - now.getTime()) < 90_000,
    day: { kind: kind.kind, title: kind.title, open: kind.open },
    banner, nextOpen: next,
    shifts: phases.map((p) => ({ code: p.code, name: p.name, color: p.color ?? null, phase: p.phase, label: p.label, periodNo: p.periodNo ?? null, periodsTotal: p.periodsTotal, minutesLeft: p.minutesLeft, opensAt: p.opensAt, closesAt: p.closesAt, sections: p.sections })),
    sections: sectionsOut,
    crowd: [...crowd.values()].map((c) => ({ facilityId: c.facilityId, students: c.hidden ? null : c.students, teachers: c.teachers, activity: c.activity, labels: viewer.family ? [] : c.labels.slice(0, 4) })),
    buses: { phase: busPhase, trips: viewer.family ? null : day.trips, label: busLabel },
    walkers,
    totals: viewer.family ? null : { onCampus, sectionsInSession: sectionsOut.filter((s) => s.activity).length, sections: day.sections.length, registerTaken: register0.filter((r) => r.registerTaken).length },
    source: `Calendar, ${day.shifts.some((s) => s.implied) ? 'the bells implied by the timetable' : 'shift bell schedules'} and the timetable for ${ymd}; headcounts from ${today ? "today's attendance register where taken, otherwise class strength" : 'class strength (scheduled)'}. Figures are anonymous and illustrative: nobody is located.`,
  };
}

/** "Which shift is Class 7 B in?" — a section's shift and its bells, from the records. */
export async function shiftOfSection(sectionIdOrName) {
  let sec = null;
  if (mongoose.isValidObjectId(sectionIdOrName)) sec = await Section.findById(sectionIdOrName).populate('gradeId', 'name').lean();
  if (!sec) {
    const m = /^(?:class|grade)?\s*([0-9a-z]+)\s*[- ]?\s*([a-z])$/i.exec(String(sectionIdOrName ?? '').trim());
    if (m) {
      const all = await Section.find({ name: new RegExp(`^${m[2]}$`, 'i') }).populate('gradeId', 'name').lean();
      sec = all.find((s) => new RegExp(`(^|\\s)${m[1]}$`, 'i').test(String(s.gradeId?.name ?? ''))) ?? null;
    }
  }
  if (!sec) return null;
  const shift = await SchoolShift.findOne({ active: true, sectionIds: sec._id }).lean();
  return {
    sectionId: String(sec._id), className: labelOf(sec),
    shift: shift ? { id: String(shift._id), code: shift.code, name: shift.name, daysOfWeek: shift.daysOfWeek, bells: shift.bells } : null,
    note: shift ? null : 'This class is not assigned to a shift; it follows the school day implied by its timetable.',
  };
}

export const __test = { loadDay, addDaysYmd, toMin, startOfDayUtc };
