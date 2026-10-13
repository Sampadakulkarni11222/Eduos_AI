import { Facility, FacilityBooking, WorkOrder } from '../../models/facility.model.js';
import { InstitutionEvent } from '../../models/administration.model.js';
import { InstitutionProfile } from '../../models/institution.model.js';
import { AppError } from '../../utils/AppError.js';
import { presentFacility, scheduledSlots, createSampleCampus } from '../administration/facility.service.js';
import { assertObjectId, startOfDayUtc } from '../ops/common.js';

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

export async function campusMap(actor, { campusCode, now = new Date() } = {}) {
  await ensureCampus();
  const layers = layersFor(actor);
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

  const out = [];
  let inUse = 0; let free = 0; let rooms = 0;
  for (const f of facilities) {
    const base = presentFacility(f, { manage: layers.restricted });
    const node = {
      id: base.id, code: base.code, name: base.name, kind: base.kind, parentId: base.parentId, campusCode: base.campusCode,
      floorNo: base.floorNo, capacity: f.restricted && !layers.restricted ? null : f.capacity ?? null,
      accessible: f.accessible, status: f.status, restricted: Boolean(f.restricted), layout: f.layout, sampleLayout: Boolean(f.sampleLayout),
      now: null,
    };
    if (ROOMLIKE.has(f.kind) && !(f.restricted && !layers.restricted)) {
      rooms += 1;
      const states = [];
      if (layers.schedule && f.kind !== 'SERVER_ROOM') {
        // eslint-disable-next-line no-await-in-loop
        const slots = await scheduledSlots(f, dow);
        const current = slots.find((s) => s.subjectOfferingId && toMin(s.startTime) <= minutes && toMin(s.endTime) > minutes);
        const next = slots.find((s) => s.subjectOfferingId && toMin(s.startTime) > minutes);
        if (current) states.push({ type: 'SCHEDULED_CLASS', label: `${current.sectionId?.gradeId?.name ?? ''} ${current.sectionId?.name ?? ''} · ${current.subjectOfferingId?.subjectId?.name ?? 'Class'}`.trim(), teacher: layers.teacherNames ? current.subjectOfferingId?.teacherId?.displayName ?? null : undefined, until: current.endTime, source: 'TIMETABLE' });
        if (next) node.nextScheduled = { label: `${next.sectionId?.gradeId?.name ?? ''} ${next.sectionId?.name ?? ''} · ${next.subjectOfferingId?.subjectId?.name ?? 'Class'}`.trim(), at: next.startTime };
        node.periodsToday = slots.filter((s) => s.subjectOfferingId).length;
      }
      const bk = (bMap.get(base.id) ?? []).find((b) => b.startsAt <= now && b.endsAt > now);
      if (bk) states.push({ type: 'BOOKED', label: layers.bookings ? bk.title : 'Booked', until: bk.endsAt, source: 'BOOKING' });
      const ev = (eMap.get(base.id) ?? []).find((e) => e.startsAt <= now && e.endsAt > now);
      if (ev && (staff || ['INSTITUTION', 'STUDENTS', 'PARENTS', 'PUBLIC'].includes(ev.audience))) states.push({ type: 'EVENT', label: ev.title, until: ev.endsAt, source: 'EVENT' });
      if (f.status !== 'ACTIVE') states.push({ type: f.status, label: f.status === 'UNDER_MAINTENANCE' ? 'Under maintenance' : 'Closed', source: 'FACILITY' });
      node.now = states;
      if (states.some((s) => ['SCHEDULED_CLASS', 'BOOKED', 'EVENT'].includes(s.type))) inUse += 1;
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

  return {
    institution: profile?.displayName ?? null,
    institutionType: profile?.institutionType ?? 'SCHOOL',
    campuses: (profile?.campuses ?? []).filter((c) => c.active).map((c) => ({ code: c.code, name: c.name })),
    sampleLayout: facilities.some((f) => f.sampleLayout),
    layers,
    asOf: now.toISOString(),
    localTime: hhmm,
    kpis: {
      rooms, roomsInUse: inUse, roomsFree: free,
      outOfUse: facilities.filter((f) => f.status !== 'ACTIVE').length,
      eventsToday: events.filter((e) => staff || e.audience !== 'STAFF').length,
      ...(layers.bookings ? { bookingsToday: bookings.length } : {}),
      ...(layers.maintenance ? { openWorkOrders: workOrders.length } : {}),
      definition: 'In use = a timetabled class (SCHEDULED, from the timetable), a confirmed booking or an event right now. It is scheduled use, not measured occupancy.',
    },
    facilities: out,
    eventsToday: events.filter((e) => staff || e.audience !== 'STAFF').map((e) => ({ id: String(e._id), title: e.title, facilityId: e.facilityId ? String(e.facilityId) : null, startsAt: e.startsAt, endsAt: e.endsAt, status: e.status })),
  };
}

/** One facility in depth: today's schedule, upcoming bookings, maintenance (as permitted). */
export async function facilityDetail(actor, id, { now = new Date() } = {}) {
  const layers = layersFor(actor);
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
    out.scheduleToday = slots.filter((s) => s.subjectOfferingId).map((s) => ({ startTime: s.startTime, endTime: s.endTime, section: `${s.sectionId?.gradeId?.name ?? ''} ${s.sectionId?.name ?? ''}`.trim(), subject: s.subjectOfferingId?.subjectId?.name ?? null, teacher: s.subjectOfferingId?.teacherId?.displayName ?? null }));
    out.scheduleSource = 'Timetable (scheduled use)';
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
