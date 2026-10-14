import { Facility, FacilityBooking, WorkOrder } from '../../models/facility.model.js';
import { InstitutionEvent } from '../../models/administration.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { presentFacility, scheduledSlots, scheduledSlotsForMany, createSampleCampus } from '../administration/facility.service.js';
import { assertObjectId, startOfDayUtc } from '../ops/common.js';
import { liveBySection, departments as departmentsLive } from './live.service.js';
import { currentFor as currentModules } from '../syllabus/syllabus.service.js';

/**
 * The campus world: buildings, floors and rooms with what is happening in
 * them, filtered for the viewer on the server.
 *
 * Layers and who gets them:
 *   BASE        everyone with campus.map.read — buildings, rooms, public spaces;
 *   EVENTS      everyone — events today at a venue (title only);
 *   SCHEDULE    staff — scheduled class use from the timetable (labelled
 *               SCHEDULED, never presented as live presence);
 *   BOOKINGS    staff — confirmed bookings; families see only "booked";
 *   MAINTENANCE staff with facilities.read — open work orders;
 *   RESTRICTED  facilities.manage — details of restricted spaces.
 *
 * Restricted spaces are removed entirely for families and masked for other
 * staff before the response is built, so nothing confidential is sent to a
 * browser to be "hidden" there. No person is located: decorative movement in
 * the 3D view is anonymous and labelled illustrative by the client.
 */

const STAFF = new Set(['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'SUPER_ADMIN']);
const ROOMLIKE = new Set(['CLASSROOM', 'LECTURE_HALL', 'LAB', 'LIBRARY', 'OFFICE', 'STAFF_ROOM', 'AUDITORIUM', 'CANTEEN', 'HOSTEL', 'CLINIC', 'STORE', 'SERVER_ROOM', 'OTHER']);

function layersFor(actor) {
  const staff = STAFF.has(actor.roleKey);
  return {
    base: true,
    events: true,
    schedule: staff,
    bookings: staff,
    maintenance: staff && Boolean(actor.permissions?.['facilities.read']),
    restricted: Boolean(actor.permissions?.['facilities.manage']),
    teacherNames: staff,
  };
}

const istNow = (now) => {
  const t = new Date(now.getTime() + 330 * 60_000);
  const d = t.getUTCDay();
  return { dow: d === 0 ? 7 : d, minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), hhmm: `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}` };
};
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

/**
 * A school that has not mapped its buildings yet gets the labelled sample
 * campus the first time anyone opens the map, so every profile sees the 3D
 * view from day one instead of an empty page. Every record is flagged
 * `sampleLayout` and the map says so. Two first visits at once are safe: the
 * unique facility code per school lets only one of them create it.
 */
async function ensureCampus() {
  if (await Facility.exists({})) return;
  const profile = await InstitutionProfile.findOne({}).select('institutionType').lean();
  try {
    await createSampleCampus({ institutionType: profile?.institutionType === 'COLLEGE' ? 'COLLEGE' : 'SCHOOL' });
  } catch (err) {
    if (err?.code !== 11000 && err?.code !== 'FACILITIES_EXIST') throw err;
  }
}

/**
 * A staff member may look at another time of today ("what does 10:30 look
 * like?"). The timetable, bookings and events move with it; the headcount is
 * still today's register, and the reply says it is a preview.
 */
function previewMoment(actor, at, now) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(at ?? ''));
  if (!m || !STAFF.has(actor.roleKey)) return null;
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), Number(m[1]), Number(m[2])) - 330 * 60_000);
}

export async function campusMap(actor, { campusCode, at = null, now: realNow = new Date() } = {}) {
  await ensureCampus();
  const layers = layersFor(actor);
  const preview = previewMoment(actor, at, realNow);
  const now = preview ?? realNow;
  const staff = STAFF.has(actor.roleKey);
  const filter = campusCode ? { campusCode } : {};
  let facilities = await Facility.find(filter).lean();
  // Families never receive restricted spaces at all.
  if (!staff) facilities = facilities.filter((f) => !f.restricted);
  const ids = facilities.map((f) => f._id);
  const dayStart = startOfDayUtc(now);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [bookings, workOrders, events, profile] = await Promise.all([
    FacilityBooking.find({ facilityId: { $in: ids }, status: 'CONFIRMED', startsAt: { $lt: dayEnd }, endsAt: { $gt: dayStart } }).select('facilityId title startsAt endsAt').lean(),
    layers.maintenance ? WorkOrder.find({ facilityId: { $in: ids }, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }).select('facilityId title priority status dueAt').lean() : [],
    InstitutionEvent.find({ status: { $in: ['APPROVED', 'IN_PREPARATION', 'LIVE'] }, startsAt: { $lt: dayEnd }, endsAt: { $gt: dayStart } }).select('title facilityId startsAt endsAt status audience').lean(),
    InstitutionProfile.findOne({}).select('displayName campuses institutionType').lean(),
  ]);
  const { dow, minutes, hhmm } = istNow(now);

  const byFacility = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.facilityId);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const bMap = byFacility(bookings);
  const wMap = byFacility(workOrders);
  const eMap = byFacility(events.filter((e) => e.facilityId));

  // The timetable for every room, read once: who is in which room now, and next.
  const roomSlots = new Map();
  if (layers.schedule) {
    // One query for the whole campus, not one per room.
    const rooms = facilities.filter((f) => ROOMLIKE.has(f.kind) && f.kind !== 'SERVER_ROOM' && !(f.restricted && !layers.restricted));
    for (const [id, slots] of await scheduledSlotsForMany(rooms, dow)) roomSlots.set(id, slots.filter((s) => s.subjectOfferingId));
  }
  const currentOf = (f) => (roomSlots.get(String(f._id)) ?? []).find((s) => toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes) ?? null;
  // Headcount and exams for every class that has a room or is in one now.
  const sectionIds = new Map();
  const offeringIds = new Map();
  for (const f of facilities) {
    if (f.sectionId) sectionIds.set(String(f.sectionId), f.sectionId);
    for (const s of roomSlots.get(String(f._id)) ?? []) {
      if (s.sectionId?._id) sectionIds.set(String(s.sectionId._id), s.sectionId._id);
      if (s.subjectOfferingId?._id) offeringIds.set(String(s.subjectOfferingId._id), s.subjectOfferingId._id);
    }
  }
  const [live, modules] = layers.schedule
    ? await Promise.all([liveBySection([...sectionIds.values()], now), currentModules([...offeringIds.values()])])
    : [new Map(), new Map()];
  const classLabel = (sec) => `${sec?.gradeId?.name ?? ''} ${sec?.name ?? ''}`.trim();
  // A class having its lesson in a lab or hall is away from its own room for that period.
  const awayIn = new Map();
  for (const f of facilities) {
    const c = roomSlots.has(String(f._id)) ? currentOf(f) : null;
    if (c?.sectionId?._id && String(c.sectionId._id) !== String(f.sectionId ?? '')) awayIn.set(String(c.sectionId._id), f.name);
  }
  const lessonOf = (slot) => {
    const m = modules.get(String(slot.subjectOfferingId?._id))?.current ?? null;
    return {
      periodNo: slot.periodNo, startTime: slot.startTime, endTime: slot.endTime,
      class: classLabel(slot.sectionId), subject: slot.subjectOfferingId?.subjectId?.name ?? 'Class',
      teacher: layers.teacherNames ? slot.subjectOfferingId?.teacherId?.displayName ?? null : undefined,
      module: m ? { title: m.title, nextTopic: m.nextTopic, progressPct: m.progressPct, pace: m.pace } : null,
    };
  };

  const out = [];
  let inUse = 0; let free = 0; let rooms = 0;
  let classesNow = 0; let examsNow = 0;
  for (const f of facilities) {
    const base = presentFacility(f, { manage: layers.restricted });
    const node = {
      id: base.id, code: base.code, name: base.name, kind: base.kind, parentId: base.parentId, campusCode: base.campusCode,
      floorNo: base.floorNo, capacity: f.restricted && !layers.restricted ? null : f.capacity ?? null,
      accessible: f.accessible, status: f.status, restricted: Boolean(f.restricted), layout: f.layout, sampleLayout: Boolean(f.sampleLayout),
      department: staff ? f.department ?? null : null,
      now: null,
    };
    if (ROOMLIKE.has(f.kind) && !(f.restricted && !layers.restricted)) {
      rooms += 1;
      const states = [];
      if (layers.schedule && f.kind !== 'SERVER_ROOM') {
        const slots = roomSlots.get(String(f._id)) ?? [];
        const current = currentOf(f);
        const next = slots.find((s) => toMin(s.startTime) > minutes);
        // The class in the room now, else the class whose room this is.
        const sectionId = current?.sectionId?._id ?? f.sectionId ?? null;
        const head = sectionId ? live.get(String(sectionId)) ?? null : null;
        if (head) {
          node.live = {
            class: current ? classLabel(current.sectionId) : null, homeRoom: !current,
            ...(!current && awayIn.has(String(sectionId)) ? { away: true, awayIn: awayIn.get(String(sectionId)) } : {}),
            enrolled: head.enrolled, present: head.registerTaken ? head.present : null, absent: head.registerTaken ? head.absent : null,
            registerTaken: head.registerTaken, attendancePct: head.attendancePct,
            source: "Today's attendance register",
          };
        }
        const away = !current && awayIn.has(String(sectionId));
        if (head?.exam && !away && (head.exam.paperToday || current)) {
          states.push({ type: 'EXAM', label: `${head.exam.name}${head.exam.subject ? ` · ${head.exam.subject}` : ''}`, source: 'EXAMS' });
          examsNow += 1;
        }
        if (current) {
          const lesson = lessonOf(current);
          node.lesson = lesson;
          states.push({ type: 'SCHEDULED_CLASS', label: `${lesson.class} · ${lesson.subject}`, teacher: lesson.teacher, until: current.endTime, source: 'TIMETABLE' });
          classesNow += 1;
        }
        if (next) node.nextScheduled = { label: `${classLabel(next.sectionId)} · ${next.subjectOfferingId?.subjectId?.name ?? 'Class'}`, at: next.startTime };
        node.periodsToday = slots.length;
      }
      const bk = (bMap.get(base.id) ?? []).find((b) => b.startsAt <= now && b.endsAt > now);
      if (bk) states.push({ type: 'BOOKED', label: layers.bookings ? bk.title : 'Booked', until: bk.endsAt, source: 'BOOKING' });
      const ev = (eMap.get(base.id) ?? []).find((e) => e.startsAt <= now && e.endsAt > now);
      if (ev && (staff || ['INSTITUTION', 'STUDENTS', 'PARENTS', 'PUBLIC'].includes(ev.audience))) states.push({ type: 'EVENT', label: ev.title, until: ev.endsAt, source: 'EVENT' });
      if (f.status !== 'ACTIVE') states.push({ type: f.status, label: f.status === 'UNDER_MAINTENANCE' ? 'Under maintenance' : 'Closed', source: 'FACILITY' });
      node.now = states;
      if (states.some((s) => ['SCHEDULED_CLASS', 'BOOKED', 'EVENT', 'EXAM'].includes(s.type))) inUse += 1;
      else if (f.status === 'ACTIVE') free += 1;
      if (layers.bookings) node.bookingsToday = (bMap.get(base.id) ?? []).length;
      if (layers.maintenance) {
        const wos = wMap.get(base.id) ?? [];
        node.openWorkOrders = wos.length;
        node.urgentWorkOrders = wos.filter((w) => w.priority === 'URGENT').length;
      }
    }
    out.push(node);
  }

  // The school's day in three numbers, from the register.
  const heads = [...live.values()];
  const academics = layers.schedule ? {
    classesNow,
    examsToday: heads.filter((h) => h.exam?.paperToday).length,
    studentsEnrolled: heads.reduce((n, h) => n + h.enrolled, 0),
    studentsMarked: heads.reduce((n, h) => n + h.marked, 0),
    studentsPresent: heads.reduce((n, h) => n + h.present, 0),
    sectionsMarked: heads.filter((h) => h.registerTaken).length,
    sections: heads.length,
  } : null;
  const depts = await departmentsLive(actor, { academics, now }).catch(() => []);

  return {
    institution: profile?.displayName ?? null,
    institutionType: profile?.institutionType ?? 'SCHOOL',
    campuses: (profile?.campuses ?? []).filter((c) => c.active).map((c) => ({ code: c.code, name: c.name })),
    sampleLayout: facilities.some((f) => f.sampleLayout),
    layers,
    asOf: now.toISOString(),
    preview: Boolean(preview),
    localTime: hhmm,
    kpis: {
      rooms, roomsInUse: inUse, roomsFree: free,
      ...(academics ? { classesNow: academics.classesNow, examsNow, studentsPresent: academics.studentsMarked ? academics.studentsPresent : null, studentsMarked: academics.studentsMarked, studentsEnrolled: academics.studentsEnrolled, sectionsMarked: academics.sectionsMarked, sections: academics.sections } : {}),
      outOfUse: facilities.filter((f) => f.status !== 'ACTIVE').length,
      eventsToday: events.filter((e) => staff || e.audience !== 'STAFF').length,
      ...(layers.bookings ? { bookingsToday: bookings.length } : {}),
      ...(layers.maintenance ? { openWorkOrders: workOrders.length } : {}),
      definition: 'In use = a timetabled class (SCHEDULED, from the timetable), a confirmed booking or an event right now. It is scheduled use, not measured occupancy.',
    },
    facilities: out,
    departments: depts,
    eventsToday: events.filter((e) => staff || e.audience !== 'STAFF').map((e) => ({ id: String(e._id), title: e.title, facilityId: e.facilityId ? String(e.facilityId) : null, startsAt: e.startsAt, endsAt: e.endsAt, status: e.status })),
  };
}

/** The last school days' attendance for one class, for the room panel's small trend. */
async function attendanceWeek(sectionId, now) {
  const from = new Date(startOfDayUtc(now).getTime() - 13 * 86_400_000);
  const enrolments = await Enrollment.find({ sectionId, status: 'ACTIVE' }).distinct('_id');
  const rows = await AttendanceRecord.aggregate([
    { $match: { enrollmentId: { $in: enrolments }, date: { $gte: from }, periodNo: null } },
    { $group: { _id: '$date', marked: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.slice(-7).map((r) => ({ date: r._id, present: r.present, marked: r.marked, pct: r.marked ? Math.round((r.present / r.marked) * 100) : null }));
}

/** One facility in depth: today's schedule, upcoming bookings, maintenance (as permitted). */
export async function facilityDetail(actor, id, { at = null, now: realNow = new Date() } = {}) {
  const layers = layersFor(actor);
  const now = previewMoment(actor, at, realNow) ?? realNow;
  const staff = STAFF.has(actor.roleKey);
  const f = await Facility.findById(assertObjectId(id)).lean();
  if (!f || (f.restricted && !staff)) throw new AppError('Facility not found', 404);
  const base = presentFacility(f, { manage: layers.restricted });
  const children = await Facility.find({ parentId: f._id }).lean();
  const out = {
    ...base, layers,
    children: children.filter((c) => staff || !c.restricted).map((c) => {
      const p = presentFacility(c, { manage: layers.restricted });
      return { id: p.id, name: p.name, kind: p.kind, capacity: c.restricted && !layers.restricted ? null : c.capacity, status: c.status, floorNo: c.floorNo };
    }),
  };
  if (f.restricted && !layers.restricted) return out;
  const { dow } = istNow(now);
  if (layers.schedule) {
    const slots = await scheduledSlots(f, dow);
    const taught = slots.filter((s) => s.subjectOfferingId);
    const mods = await currentModules(taught.map((s) => s.subjectOfferingId._id));
    const { minutes } = istNow(now);
    out.scheduleToday = taught.map((s) => {
      const m = mods.get(String(s.subjectOfferingId._id))?.current ?? null;
      return {
        periodNo: s.periodNo, startTime: s.startTime, endTime: s.endTime,
        section: `${s.sectionId?.gradeId?.name ?? ''} ${s.sectionId?.name ?? ''}`.trim(),
        subject: s.subjectOfferingId?.subjectId?.name ?? null, teacher: s.subjectOfferingId?.teacherId?.displayName ?? null,
        subjectOfferingId: String(s.subjectOfferingId._id),
        module: m ? { title: m.title, nextTopic: m.nextTopic, progressPct: m.progressPct, expectedPct: m.expectedPct, pace: m.pace, plannedEnd: m.plannedEnd } : null,
        isNow: toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes,
      };
    });
    out.scheduleSource = 'Timetable (scheduled use)';
    // The class whose room this is, or the one in it now: headcount from today's register.
    const nowSlot = taught.find((s) => toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes);
    const sectionId = nowSlot?.sectionId?._id ?? f.sectionId ?? null;
    if (sectionId) {
      const head = (await liveBySection([sectionId], now)).get(String(sectionId));
      const week = await attendanceWeek(sectionId, now);
      out.classToday = {
        class: nowSlot ? `${nowSlot.sectionId?.gradeId?.name ?? ''} ${nowSlot.sectionId?.name ?? ''}`.trim() : null,
        sectionId: String(sectionId), enrolled: head.enrolled,
        present: head.registerTaken ? head.present : null, absent: head.registerTaken ? head.absent : null, late: head.registerTaken ? head.late : null,
        registerTaken: head.registerTaken, attendancePct: head.attendancePct, exam: head.exam, week,
        source: "Today's attendance register; updates when the teacher marks it.",
      };
    }
  }
  const upcoming = await FacilityBooking.find({ facilityId: f._id, status: 'CONFIRMED', endsAt: { $gt: now } }).sort({ startsAt: 1 }).limit(10).lean();
  out.upcomingBookings = upcoming.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt, title: layers.bookings ? b.title : 'Booked' }));
  if (layers.maintenance) {
    const wos = await WorkOrder.find({ facilityId: f._id, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }).sort({ dueAt: 1 }).lean();
    out.workOrders = wos.map((w) => ({ id: String(w._id), refNo: w.refNo, title: w.title, priority: w.priority, status: w.status, dueAt: w.dueAt, overdue: w.dueAt && w.dueAt < now }));
  }
  out.bookable = Boolean(f.bookable && f.status === 'ACTIVE' && actor.permissions?.['facilities.request']);
  return out;
}
