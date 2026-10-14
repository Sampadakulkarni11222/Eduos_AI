import { Facility, FacilityBooking, WorkOrder, FACILITY_KINDS } from '../../models/facility.model.js';
import { TimetableSlot } from '../../models/timetableSlot.model.js';
import '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, cleanAttachments, asPaise,
  parseDate, requireText, optionalText, oneOf, dto, pageArgs, profilesWithRoles,
} from '../ops/common.js';

/**
 * Facilities, room bookings and maintenance work orders.
 *
 * Scheduled use of a room comes from the real timetable: a slot whose `room`
 * names the facility (by code or name), or any slot of the section the room is
 * home to. That is *scheduled* use — the map and the room panel label it so,
 * and never present it as measured occupancy.
 */

const SLA_HOURS = { URGENT: 4, HIGH: 24, NORMAL: 72, LOW: 168 };
const WO_MACHINE = {
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED', 'RESOLVED'],
  ASSIGNED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'RESOLVED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
  CANCELLED: [],
};
const OPEN_WO = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];

/** Strips what an ordinary viewer may not see of a restricted space. */
export function presentFacility(f, { manage = false } = {}) {
  const out = dto(f);
  if (f.restricted && !manage) {
    return { id: out.id, code: out.code, name: 'Restricted area', kind: out.kind, parentId: out.parentId ? String(out.parentId) : null, campusCode: out.campusCode, floorNo: out.floorNo, restricted: true, status: out.status, layout: out.layout, sampleLayout: out.sampleLayout };
  }
  out.parentId = out.parentId ? String(out.parentId) : null;
  return out;
}

export async function listFacilities(actor, { kind, parentId, campusCode } = {}) {
  const manage = Boolean(actor.permissions?.['facilities.manage']);
  const filter = {};
  if (kind) filter.kind = String(kind).toUpperCase();
  if (parentId) filter.parentId = parentId === 'root' ? null : assertObjectId(parentId, 'parentId');
  if (campusCode) filter.campusCode = String(campusCode);
  const rows = await Facility.find(filter).sort({ kind: 1, code: 1 }).limit(3000).lean();
  return rows.map((f) => presentFacility(f, { manage }));
}

function facilityFields(body, partial = false) {
  const out = {};
  if (!partial || body.code !== undefined) out.code = requireText(body.code, 'code', { max: 30 }).toUpperCase();
  if (!partial || body.name !== undefined) out.name = requireText(body.name, 'name', { max: 120 });
  if (!partial || body.kind !== undefined) out.kind = oneOf(body.kind, FACILITY_KINDS, 'kind');
  for (const f of ['campusCode', 'department']) if (body[f] !== undefined) out[f] = optionalText(body[f], { max: 80 }) || null;
  for (const f of ['floorNo', 'capacity', 'areaSqm']) {
    if (body[f] !== undefined) {
      const n = body[f] === null || body[f] === '' ? null : Number(body[f]);
      if (n !== null && !Number.isFinite(n)) throw new AppError(`${f} must be a number`, 400);
      out[f] = n;
    }
  }
  for (const f of ['accessible', 'bookable', 'restricted']) if (body[f] !== undefined) out[f] = body[f] === true;
  if (Array.isArray(body.equipment)) out.equipment = body.equipment.map((e) => String(e).slice(0, 80)).slice(0, 50);
  if (body.status !== undefined) out.status = oneOf(body.status, ['ACTIVE', 'UNDER_MAINTENANCE', 'CLOSED'], 'status');
  if (body.parentId !== undefined) out.parentId = body.parentId ? assertObjectId(body.parentId, 'parentId') : null;
  if (body.sectionId !== undefined) out.sectionId = body.sectionId ? assertObjectId(body.sectionId, 'sectionId') : null;
  if (body.inChargeProfileId !== undefined) out.inChargeProfileId = body.inChargeProfileId ? assertObjectId(body.inChargeProfileId, 'inChargeProfileId') : null;
  if (body.layout && typeof body.layout === 'object') {
    const L = {};
    for (const k of ['x', 'z', 'w', 'd', 'h', 'rotation']) if (Number.isFinite(Number(body.layout[k]))) L[k] = Number(body.layout[k]);
    if (typeof body.layout.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.layout.color)) L.color = body.layout.color;
    out.layout = L;
    out.sampleLayout = false;
  }
  return out;
}

export async function createFacility(body = {}) {
  const fields = facilityFields(body);
  if (fields.parentId && !(await Facility.exists({ _id: fields.parentId }))) throw new AppError('Parent facility not found', 404);
  try {
    return dto(await Facility.create(fields));
  } catch (err) {
    if (err?.code === 11000) throw new AppError(`Facility code ${fields.code} already exists`, 409);
    throw err;
  }
}

export async function updateFacility(id, body = {}) {
  const f = await Facility.findById(assertObjectId(id));
  if (!f) throw new AppError('Facility not found', 404);
  const fields = facilityFields(body, true);
  if (fields.parentId && String(fields.parentId) === String(f._id)) throw new AppError('A facility cannot contain itself', 400);
  Object.assign(f, fields);
  await f.save();
  return dto(f);
}

const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const minutesIst = (d) => { const t = new Date(d.getTime() + 330 * 60_000); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const dowIst = (d) => { const t = new Date(d.getTime() + 330 * 60_000); const w = t.getUTCDay(); return w === 0 ? 7 : w; };

/** Timetable slots that schedule this room (by room code/name, or as a section's home room). */
export async function scheduledSlots(facility, dayOfWeek) {
  const names = [facility.code, facility.name].filter(Boolean);
  const or = [{ room: { $in: names } }];
  if (facility.sectionId) or.push({ sectionId: facility.sectionId, $or: [{ room: null }, { room: '' }] });
  return TimetableSlot.find({ dayOfWeek, $or: or })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } })
    .populate({ path: 'subjectOfferingId', select: 'subjectId teacherId', populate: [{ path: 'subjectId', select: 'name' }, { path: 'teacherId', select: 'displayName' }] })
    .sort({ startTime: 1 })
    .lean();
}

async function conflictsFor(facilityId, startsAt, endsAt, excludeBookingId = null) {
  const f = await Facility.findById(facilityId).lean();
  const bookings = await FacilityBooking.find({
    facilityId, status: { $in: ['REQUESTED', 'CONFIRMED'] }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt },
    ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  }).lean();
  const out = bookings.map((b) => ({ type: b.status === 'CONFIRMED' ? 'BOOKING' : 'REQUESTED_BOOKING', title: b.title, startsAt: b.startsAt, endsAt: b.endsAt }));
  // Same-day timetable clash (bookings longer than a day are checked for their first day only).
  const slots = await scheduledSlots(f, dowIst(startsAt));
  const s = minutesIst(startsAt);
  const e = startsAt.toDateString() === endsAt.toDateString() ? minutesIst(endsAt) : 24 * 60;
  for (const slot of slots) {
    if (toMinutes(slot.startTime) < e && toMinutes(slot.endTime) > s && slot.subjectOfferingId) {
      out.push({ type: 'TIMETABLE', title: `${slot.sectionId?.gradeId?.name ?? ''} ${slot.sectionId?.name ?? ''} · ${slot.subjectOfferingId?.subjectId?.name ?? 'class'}`.trim(), startTime: slot.startTime, endTime: slot.endTime });
    }
  }
  return out;
}

export async function requestBooking(actor, body = {}) {
  requireProfile(actor);
  const facilityId = assertObjectId(body.facilityId, 'facilityId');
  const f = await Facility.findById(facilityId).lean();
  if (!f) throw new AppError('Facility not found', 404);
  if (!f.bookable || f.status !== 'ACTIVE') throw new AppError(`${f.name} cannot be booked right now (${f.status.toLowerCase().replace('_', ' ')}).`, 409, [], 'FACILITY_UNAVAILABLE');
  const startsAt = parseDate(body.startsAt, 'startsAt', { required: true });
  const endsAt = parseDate(body.endsAt, 'endsAt', { required: true });
  if (endsAt <= startsAt) throw new AppError('endsAt must be after startsAt', 400);
  const attendees = body.attendees ? Number(body.attendees) : null;
  if (attendees && f.capacity && attendees > f.capacity) throw new AppError(`${f.name} holds ${f.capacity}; ${attendees} requested.`, 409, [], 'OVER_CAPACITY');
  const conflicts = await conflictsFor(facilityId, startsAt, endsAt);
  const hard = conflicts.filter((c) => c.type === 'BOOKING');
  if (hard.length) throw new AppError(`${f.name} is already booked: ${hard[0].title}.`, 409, [conflicts], 'BOOKING_CONFLICT');
  const manage = Boolean(actor.permissions?.['facilities.manage']);
  const booking = await FacilityBooking.create({
    facilityId, title: requireText(body.title, 'title', { max: 160 }), purpose: optionalText(body.purpose, { max: 1000 }) || null,
    startsAt, endsAt, attendees, bookedByProfileId: actor.profileId, bookedByName: actor.displayName,
    // Facilities staff confirm their own bookings directly unless they clash with a class.
    status: manage && !conflicts.length ? 'CONFIRMED' : 'REQUESTED',
    eventId: body.eventId ?? null,
  });
  if (booking.status === 'REQUESTED') {
    const managers = await profilesWithRoles(['ADMIN']);
    await notify({ recipientProfileIds: managers.map((p) => String(p._id)), type: 'SYSTEM', title: `Booking request: ${f.name}`, body: `${booking.title} · ${startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, link: '/facilities?tab=bookings' });
  }
  return { ...dto(booking), facilityName: f.name, conflicts };
}

export async function decideBooking(actor, id, { decision, note } = {}) {
  const b = await FacilityBooking.findById(assertObjectId(id));
  if (!b) throw new AppError('Booking not found', 404);
  if (b.status !== 'REQUESTED') throw new AppError('Only a requested booking can be decided.', 409);
  const d = oneOf(decision, ['CONFIRMED', 'REJECTED'], 'decision');
  if (d === 'CONFIRMED') {
    const clash = (await conflictsFor(b.facilityId, b.startsAt, b.endsAt, b._id)).filter((c) => c.type === 'BOOKING');
    if (clash.length) throw new AppError(`Already booked: ${clash[0].title}`, 409, [], 'BOOKING_CONFLICT');
  }
  b.status = d; b.decidedByProfileId = actor.profileId; b.decisionNote = optionalText(note, { max: 500 }) || null;
  await b.save();
  await notify({ recipientProfileIds: [String(b.bookedByProfileId)], type: 'SYSTEM', title: `Booking ${d.toLowerCase()}: ${b.title}`, body: b.decisionNote ?? '', link: '/facilities?tab=bookings' });
  return dto(b);
}

export async function cancelBooking(actor, id) {
  const b = await FacilityBooking.findById(assertObjectId(id));
  if (!b) throw new AppError('Booking not found', 404);
  const mine = String(b.bookedByProfileId) === String(actor.profileId);
  if (!mine && !actor.permissions?.['facilities.manage']) throw new AppError('Booking not found', 404);
  if (!['REQUESTED', 'CONFIRMED'].includes(b.status)) throw new AppError('This booking is already closed.', 409);
  b.status = 'CANCELLED';
  await b.save();
  return dto(b);
}

export async function listBookings(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (!actor.permissions?.['facilities.manage'] && query.all !== 'true') filter.bookedByProfileId = actor.profileId;
  if (query.facilityId) filter.facilityId = assertObjectId(query.facilityId, 'facilityId');
  if (query.status) filter.status = String(query.status).toUpperCase();
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.startsAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const rows = await FacilityBooking.find(filter).sort({ startsAt: 1 }).limit(500).populate('facilityId', 'name code restricted').lean();
  return rows.map((b) => ({ ...dto(b), facilityId: String(b.facilityId?._id ?? b.facilityId), facilityName: b.facilityId?.restricted && !actor.permissions?.['facilities.manage'] ? 'Restricted area' : b.facilityId?.name ?? null }));
}

export async function reportIssue(actor, body = {}) {
  requireProfile(actor);
  const priority = oneOf(body.priority, ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'priority', 'NORMAL');
  const facilityId = body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : null;
  if (facilityId && !(await Facility.exists({ _id: facilityId }))) throw new AppError('Facility not found', 404);
  const wo = new WorkOrder({
    refNo: await nextRef('WO'),
    facilityId, assetTag: optionalText(body.assetTag, { max: 60 }) || null,
    title: requireText(body.title, 'title', { max: 160 }), description: optionalText(body.description, { max: 4000 }) ?? '',
    category: oneOf(body.category, ['ELECTRICAL', 'PLUMBING', 'IT', 'CLEANING', 'CIVIL', 'FURNITURE', 'SAFETY', 'HVAC', 'OTHER'], 'category'),
    priority, kind: oneOf(body.kind, ['REACTIVE', 'PREVENTIVE', 'INSPECTION'], 'kind', 'REACTIVE'),
    reportedByProfileId: actor.profileId, reportedByName: actor.displayName,
    slaHours: SLA_HOURS[priority], dueAt: new Date(Date.now() + SLA_HOURS[priority] * 3600_000),
    attachments: cleanAttachments(body.attachments, actor),
  });
  pushHistory(wo, actor, 'REPORTED', { to: 'OPEN' });
  await wo.save();
  const managers = await profilesWithRoles(['ADMIN']);
  await notify({ recipientProfileIds: managers.map((p) => String(p._id)), type: 'SYSTEM', title: `${priority === 'URGENT' ? 'URGENT ' : ''}Maintenance: ${wo.title}`, body: wo.refNo, link: `/facilities?tab=work&id=${wo._id}` });
  return dto(wo);
}

export async function updateWorkOrder(actor, id, body = {}) {
  const wo = await WorkOrder.findById(assertObjectId(id));
  if (!wo) throw new AppError('Work order not found', 404);
  if (body.assigneeProfileId !== undefined) wo.assigneeProfileId = body.assigneeProfileId ? assertObjectId(body.assigneeProfileId) : null;
  if (body.vendorName !== undefined) wo.vendorName = optionalText(body.vendorName, { max: 160 }) || null;
  if (body.costPaise !== undefined) wo.costPaise = asPaise(body.costPaise, 'costPaise');
  if (body.closesFacility !== undefined) wo.closesFacility = body.closesFacility === true;
  if (body.status) {
    const to = oneOf(body.status, Object.keys(WO_MACHINE), 'status');
    assertTransition(WO_MACHINE, wo.status, to, 'work order');
    if (to === 'RESOLVED') {
      wo.resolution = requireText(body.resolution, 'resolution', { max: 2000 });
      wo.resolvedAt = new Date();
    }
    pushHistory(wo, actor, to, { from: wo.status, to, note: body.note ?? body.resolution });
    wo.status = to;
  } else if (wo.status === 'OPEN' && wo.assigneeProfileId) {
    pushHistory(wo, actor, 'ASSIGNED', { from: 'OPEN', to: 'ASSIGNED' });
    wo.status = 'ASSIGNED';
  }
  await wo.save();
  // Keep the facility's own status in step with hazards that close it.
  if (wo.facilityId) {
    const closing = await WorkOrder.exists({ facilityId: wo.facilityId, closesFacility: true, status: { $in: OPEN_WO } });
    await Facility.updateOne({ _id: wo.facilityId, status: { $ne: 'CLOSED' } }, { $set: { status: closing ? 'UNDER_MAINTENANCE' : 'ACTIVE' } });
  }
  if (wo.status === 'RESOLVED') {
    await notify({ recipientProfileIds: [String(wo.reportedByProfileId)], type: 'SYSTEM', title: `Resolved: ${wo.title}`, body: wo.resolution ?? '', link: `/facilities?tab=work&id=${wo._id}` });
  }
  return dto(wo);
}

export async function listWorkOrders(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (!actor.permissions?.['facilities.manage']) filter.reportedByProfileId = actor.profileId;
  if (query.status === 'OPEN') filter.status = { $in: OPEN_WO };
  else if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.facilityId) filter.facilityId = assertObjectId(query.facilityId, 'facilityId');
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    WorkOrder.find(filter).sort({ dueAt: 1 }).skip(skip).limit(pageSize).populate('facilityId', 'name code').lean(),
    WorkOrder.countDocuments(filter),
  ]);
  const now = new Date();
  return {
    items: rows.map((w) => ({ ...dto(w), facilityId: w.facilityId?._id ? String(w.facilityId._id) : null, facilityName: w.facilityId?.name ?? null, isOverdue: OPEN_WO.includes(w.status) && w.dueAt && w.dueAt < now })),
    total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export async function stats() {
  const now = new Date();
  const [open, overdue, urgent, pendingBookings, closed] = await Promise.all([
    WorkOrder.countDocuments({ status: { $in: OPEN_WO } }),
    WorkOrder.countDocuments({ status: { $in: OPEN_WO }, dueAt: { $lt: now } }),
    WorkOrder.countDocuments({ status: { $in: OPEN_WO }, priority: 'URGENT' }),
    FacilityBooking.countDocuments({ status: 'REQUESTED' }),
    Facility.countDocuments({ status: { $ne: 'ACTIVE' } }),
  ]);
  return { openWorkOrders: open, overdueWorkOrders: overdue, urgentWorkOrders: urgent, pendingBookings, facilitiesOutOfUse: closed };
}

/**
 * A labelled SAMPLE campus for a school that has not mapped its buildings yet,
 * so the map has something to show. Every record is flagged `sampleLayout`, and
 * the map tells viewers it is a sample, not a survey. Refuses if any facility
 * already exists.
 */
export async function createSampleCampus({ institutionType = 'SCHOOL', campusCode = 'MAIN' } = {}) {
  if (await Facility.exists({})) throw new AppError('Facilities already exist; the sample is only for an empty campus.', 409, [], 'FACILITIES_EXIST');
  const college = institutionType === 'COLLEGE';
  const S = { sampleLayout: true, campusCode };
  const campus = await Facility.create({ ...S, code: campusCode, name: college ? 'Main Campus' : 'School Campus', kind: 'CAMPUS', layout: { x: 0, z: 0, w: 220, d: 160, h: 0 }, bookable: false });
  const building = async (code, name, x, z, w, d, floors, color) => {
    const b = await Facility.create({ ...S, code, name, kind: 'BUILDING', parentId: campus._id, layout: { x, z, w, d, h: floors * 4, color }, bookable: false });
    const fl = [];
    for (let i = 0; i < floors; i++) {
      // eslint-disable-next-line no-await-in-loop
      fl.push(await Facility.create({ ...S, code: `${code}-F${i}`, name: `${name} · ${i === 0 ? 'Ground floor' : `Floor ${i}`}`, kind: 'FLOOR', parentId: b._id, floorNo: i, layout: { x, z, w, d, h: 4 }, bookable: false }));
    }
    return { b, fl };
  };
  const rooms = async (floor, prefix, kind, count, { x, z, w, d }, capacity, extra = {}) => {
    const rw = w / count;
    const docs = [];
    for (let i = 0; i < count; i++) {
      docs.push({ ...S, ...extra, code: `${prefix}${String(i + 1).padStart(2, '0')}`, name: extra.names?.[i] ?? `${extra.label ?? (kind === 'LAB' ? 'Lab' : kind === 'LECTURE_HALL' ? 'Lecture Hall' : 'Room')} ${prefix}${String(i + 1).padStart(2, '0')}`, kind, parentId: floor._id, floorNo: floor.floorNo, capacity, layout: { x: x - w / 2 + rw * (i + 0.5), z, w: rw - 1, d: d - 2, h: 3.6 } });
    }
    delete docs.label;
    await Facility.insertMany(docs.map(({ label: _l, names: _n, ...r }) => r));
  };
  const academic = await building('ACB', college ? 'Academic Block' : 'Main Block', -50, -30, 80, 26, 3, '#E9DFC9');
  await rooms(academic.fl[0], 'G', college ? 'LECTURE_HALL' : 'CLASSROOM', 5, { x: -50, z: -30, w: 80, d: 26 }, college ? 60 : 40, { department: 'Academics' });
  await rooms(academic.fl[1], '1', college ? 'LECTURE_HALL' : 'CLASSROOM', 5, { x: -50, z: -30, w: 80, d: 26 }, college ? 60 : 40, { department: 'Academics' });
  await rooms(academic.fl[2], '2', 'LAB', 4, { x: -50, z: -30, w: 80, d: 26 }, 30, { department: 'Academics', names: ['Physics Lab', 'Chemistry Lab', 'Computer Lab', 'Art & Music Room'] });
  const admin = await building('ADM', 'Administration Block', 40, -40, 50, 22, 2, '#DCCFB6');
  await Facility.insertMany([
    { ...S, code: 'ADM-OFF', name: 'Administration Office', kind: 'OFFICE', department: 'Administration', parentId: admin.fl[0]._id, floorNo: 0, capacity: 12, layout: { x: 24, z: -42, w: 15, d: 14, h: 3.6 } },
    { ...S, code: 'ADM-FIN', name: 'Accounts Office', kind: 'OFFICE', department: 'Finance & Accounts', parentId: admin.fl[0]._id, floorNo: 0, capacity: 8, layout: { x: 40.5, z: -42, w: 15, d: 14, h: 3.6 } },
    { ...S, code: 'ADM-ADM', name: 'Admissions & Marketing Desk', kind: 'OFFICE', department: 'Admissions & Marketing', parentId: admin.fl[0]._id, floorNo: 0, capacity: 8, layout: { x: 56.5, z: -42, w: 14, d: 14, h: 3.6 } },
    { ...S, code: 'ADM-PRN', name: "Principal's Office", kind: 'OFFICE', department: "Principal's Office", parentId: admin.fl[1]._id, floorNo: 1, capacity: 6, layout: { x: 22, z: -40, w: 12, d: 18, h: 3.6 }, bookable: false },
    { ...S, code: 'ADM-HR', name: 'HR Office', kind: 'OFFICE', department: 'Human Resources', parentId: admin.fl[1]._id, floorNo: 1, capacity: 6, layout: { x: 34.5, z: -40, w: 11, d: 18, h: 3.6 } },
    { ...S, code: 'ADM-CMP', name: 'Compliance & Safeguarding Cell', kind: 'OFFICE', department: 'Compliance & Safeguarding', parentId: admin.fl[1]._id, floorNo: 1, capacity: 6, layout: { x: 46, z: -40, w: 10, d: 18, h: 3.6 } },
    { ...S, code: 'ADM-STF', name: 'Staff Room', kind: 'STAFF_ROOM', department: 'Academics', parentId: admin.fl[1]._id, floorNo: 1, capacity: 40, layout: { x: 58, z: -40, w: 12, d: 18, h: 3.6 } },
    { ...S, code: 'ADM-SRV', name: 'Server Room', kind: 'SERVER_ROOM', parentId: admin.fl[0]._id, floorNo: 0, restricted: true, bookable: false, layout: { x: 40, z: -31.5, w: 6, d: 4, h: 3 } },
  ]);
  const lib = await building('LIB', 'Library', 40, 10, 34, 24, 1, '#E6D7BC');
  await Facility.create({ ...S, code: 'LIB-RR', name: 'Reading Room', kind: 'LIBRARY', department: 'Library', parentId: lib.fl[0]._id, floorNo: 0, capacity: 80, layout: { x: 40, z: 10, w: 32, d: 22, h: 3.6 } });
  const aud = await building('AUD', 'Auditorium', -60, 25, 40, 30, 1, '#D9C7A4');
  await Facility.create({ ...S, code: 'AUD-HALL', name: 'Main Auditorium', kind: 'AUDITORIUM', department: 'Events & Sports', parentId: aud.fl[0]._id, floorNo: 0, capacity: 400, layout: { x: -60, z: 25, w: 38, d: 28, h: 8 } });
  const can = await building('CAN', 'Canteen', 85, 10, 22, 18, 1, '#EADBC0');
  await Facility.create({ ...S, code: 'CAN-1', name: 'Canteen Hall', kind: 'CANTEEN', department: 'Canteen', parentId: can.fl[0]._id, floorNo: 0, capacity: 150, bookable: false, layout: { x: 85, z: 10, w: 20, d: 16, h: 3.6 } });
  const med = await building('MED', 'Health Centre', 85, -15, 16, 12, 1, '#F0E4CF');
  await Facility.create({ ...S, code: 'MED-1', name: 'Sick Room', kind: 'CLINIC', department: 'Health Centre', parentId: med.fl[0]._id, floorNo: 0, capacity: 4, bookable: false, restricted: true, layout: { x: 85, z: -15, w: 14, d: 10, h: 3.4 } });
  await Facility.insertMany([
    { ...S, code: 'GRD-1', name: college ? 'Sports Ground' : 'Playground', kind: 'GROUND', department: 'Events & Sports', parentId: campus._id, capacity: 600, layout: { x: -5, z: 55, w: 90, d: 45, h: 0 } },
    { ...S, code: 'CRT-1', name: 'Basketball Court', kind: 'COURT', department: 'Events & Sports', parentId: campus._id, capacity: 40, layout: { x: 70, z: 55, w: 28, d: 16, h: 0 } },
    { ...S, code: 'BUS-1', name: 'Bus Bay', kind: 'TRANSPORT_BAY', department: 'Transport', parentId: campus._id, bookable: false, layout: { x: -95, z: -10, w: 18, d: 60, h: 0 } },
    { ...S, code: 'PRK-1', name: 'Parking', kind: 'PARKING', parentId: campus._id, bookable: false, layout: { x: -95, z: 50, w: 18, d: 40, h: 0 } },
    { ...S, code: 'GATE-1', name: 'Main Gate', kind: 'GATE', parentId: campus._id, bookable: false, layout: { x: 0, z: -78, w: 14, d: 4, h: 3 } },
  ]);
  const hostel = await building('HST', 'Hostel', -10, -62, 40, 14, college ? 3 : 2, '#E2D4B8');
  await Facility.insertMany([
    { ...S, code: 'HST-1', name: 'Hostel Block A', kind: 'HOSTEL', department: 'Hostel', parentId: hostel.fl[0]._id, floorNo: 0, capacity: college ? 120 : 100, bookable: false, layout: { x: -10, z: -62, w: 38, d: 12, h: 3.6 } },
    { ...S, code: 'HST-2', name: 'Hostel Block B', kind: 'HOSTEL', department: 'Hostel', parentId: hostel.fl[1]._id, floorNo: 1, capacity: college ? 120 : 100, bookable: false, layout: { x: -10, z: -62, w: 38, d: 12, h: 3.6 } },
  ]);
  const store = await building('STR', 'Stores', 88, -42, 14, 12, 1, '#DDD0B4');
  await Facility.create({ ...S, code: 'STR-1', name: 'Central Store', kind: 'STORE', department: 'Administration', parentId: store.fl[0]._id, floorNo: 0, bookable: false, layout: { x: 88, z: -42, w: 12, d: 10, h: 3.4 } });
  return { created: await Facility.countDocuments({ sampleLayout: true }) };
}
