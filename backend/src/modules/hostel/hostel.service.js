import {
  HostelRoom, HostelAllocation, HostelInquiry, ROOM_TYPES, ROOM_CAPACITY_MIN, ROOM_CAPACITY_MAX,
} from '../../models/hostel.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { Student } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { decrypt } from '../../utils/crypto.js';
import { recordPiiRead } from '../../utils/auditTrail.js';
import { assertCanAccess as assertCanAccessMedical } from '../medical/medical.service.js';
import { insertRows, rowError } from '../../utils/csvImport.js';

// ─── Dashboard Summary ──────────────────────────────────────
export async function getSummary() {
  const [
    totalRooms,
    occupiedBeds,
    openInquiries,
    maintenanceTickets,
  ] = await Promise.all([
    HostelRoom.countDocuments({ status: { $ne: 'CLOSED' } }),
    HostelAllocation.countDocuments({ status: 'ACTIVE' }),
    HostelInquiry.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
    Ticket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] }, routedToRoleKey: 'WARDEN' }),
  ]);

  // Total capacity of all active rooms
  const capacityAgg = await HostelRoom.aggregate([
    { $match: { status: { $ne: 'CLOSED' } } },
    { $group: { _id: null, totalCapacity: { $sum: '$capacity' } } },
  ]);
  const totalCapacity = capacityAgg[0]?.totalCapacity ?? 0;

  return {
    totalRooms,
    totalCapacity,
    occupiedBeds,
    availableBeds: Math.max(0, totalCapacity - occupiedBeds),
    occupancyRate: totalCapacity > 0 ? Math.round((occupiedBeds / totalCapacity) * 100) : 0,
    hostelInquiries: openInquiries,
    maintenanceRequests: maintenanceTickets,
  };
}

// ─── Rooms ───────────────────────────────────────────────────
export async function listRooms({ type, status } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const rooms = await HostelRoom.find(filter).sort({ block: 1, roomNo: 1 }).lean();

  // Attach occupancy to each room
  const roomIds = rooms.map((r) => r._id);
  const allocations = await HostelAllocation.aggregate([
    { $match: { roomId: { $in: roomIds }, status: 'ACTIVE' } },
    { $group: { _id: '$roomId', occupied: { $sum: 1 } } },
  ]);
  const occupancyMap = Object.fromEntries(allocations.map((a) => [a._id.toString(), a.occupied]));

  return rooms.map((r) => ({
    ...r,
    occupied: occupancyMap[r._id.toString()] ?? 0,
    available: r.capacity - (occupancyMap[r._id.toString()] ?? 0),
  }));
}

export async function getRoomById(id) {
  const room = await HostelRoom.findById(id);
  if (!room) throw new AppError('Room not found', 404);
  return room;
}

/**
 * A bed count as a whole number within the room limits, or null. Numeric
 * strings are accepted because forms and CSV rows send them; anything else
 * (booleans, "", "abc", "2.5") is not a capacity.
 */
function parseCapacity(value) {
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) n = Number(value);
  return Number.isInteger(n) && n >= ROOM_CAPACITY_MIN && n <= ROOM_CAPACITY_MAX ? n : null;
}

const CAPACITY_RULE = `capacity must be a whole number of beds from ${ROOM_CAPACITY_MIN} to ${ROOM_CAPACITY_MAX}`;

/**
 * Checks the room fields a create or update carries. The model alone was the
 * only check, and it had no bounds on capacity, so -1 or 2.5 beds were stored.
 * On an update only the fields present are checked.
 */
function checkRoomFields(data, { partial }) {
  const checked = {};
  if (!partial || data.capacity !== undefined) {
    const capacity = parseCapacity(data.capacity);
    if (capacity === null) throw new AppError(CAPACITY_RULE, 400, [], 'INVALID_ROOM_CAPACITY');
    checked.capacity = capacity;
  }
  if (data.type !== undefined && !ROOM_TYPES.includes(data.type)) {
    throw new AppError(`type must be one of: ${ROOM_TYPES.join(', ')}`, 400, [], 'INVALID_ROOM_TYPE');
  }
  return checked;
}

export async function createRoom(data) {
  return HostelRoom.create({ ...data, ...checkRoomFields(data, { partial: false }) });
}

export async function bulkCreateRooms(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const VALID_TYPES = new Set(ROOM_TYPES);
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const roomNo = row.roomno?.trim();
    const capacity = parseCapacity(row.capacity);
    if (!roomNo || capacity === null) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !roomNo ? 'roomNo' : 'capacity',
        value: !roomNo ? row.roomno : row.capacity,
        problem: !roomNo || !row.capacity?.trim() ? 'is required' : 'is not a valid number of beds',
        suggestion: `${CAPACITY_RULE}, e.g. 4`,
      }));
      continue;
    }
    const type = row.type?.trim().toUpperCase() || 'GENERAL';
    if (!VALID_TYPES.has(type)) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'type',
        value: row.type,
        problem: 'is not a room type',
        suggestion: 'use one of: BOYS, GIRLS, STAFF, GENERAL',
      }));
      continue;
    }
    docs.push({
      rowNo,
      roomNo,
      block: row.block?.trim() || 'Main',
      floor: row.floor?.trim() || null,
      capacity,
      type,
    });
  }

  const inserted = await insertRows(
    HostelRoom,
    docs.map(({ rowNo, ...doc }) => ({ rowNo, doc })),
    { dupField: 'roomNo', dupLabel: 'roomNo' },
  );

  return {
    imported: results.imported + inserted.imported,
    failed: results.failed + inserted.failed,
    errors: [...results.errors, ...inserted.errors],
  };
}

/**
 * Bulk-allocates students to rooms from CSV rows: admissionNo, roomNo. Each
 * row calls the existing allocate() (not a bulk insert) so the
 * capacity/duplicate-active-allocation checks stay enforced per row.
 */
export async function bulkAllocate(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  const admissionNos = rows.map((r) => r.admissionno?.trim()).filter(Boolean);
  const students = await Student.find({ admissionNo: { $in: admissionNos }, deletedAt: null }).select('_id admissionNo').lean();
  const studentIdByAdmissionNo = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s._id]));

  const roomNos = rows.map((r) => r.roomno?.trim()).filter(Boolean);
  const rooms = await HostelRoom.find({ roomNo: { $in: roomNos } }).select('_id roomNo').lean();
  const roomIdByRoomNo = new Map(rooms.map((r) => [r.roomNo.toLowerCase(), r._id]));

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const admissionNo = row.admissionno?.trim();
    const roomNo = row.roomno?.trim();

    if (!admissionNo || !roomNo) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !admissionNo ? 'admissionNo' : 'roomNo',
        problem: 'is required',
        suggestion: 'both columns name existing records — the student, and the room to put them in',
      }));
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'admissionNo',
        value: admissionNo,
        problem: 'does not match any student in this school',
        suggestion: 'check the admission number, or import the student first',
      }));
      continue;
    }

    const roomId = roomIdByRoomNo.get(roomNo.toLowerCase());
    if (!roomId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'roomNo',
        value: roomNo,
        problem: 'does not match any hostel room',
        suggestion: 'create the room first, or correct the room number',
      }));
      continue;
    }

    try {
      await allocate({ roomId: roomId.toString(), studentId: studentId.toString() });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push(rowError(rowNo, { problem: err.message }));
    }
  }

  return results;
}

/** Room fields an edit may change. */
const ROOM_EDITABLE = ['roomNo', 'block', 'floor', 'capacity', 'type', 'status', 'amenities'];

/**
 * The gender a student record names, as MALE / FEMALE, or null when it names
 * neither (blank, OTHER, or something unrecognised).
 */
export function studentGender(value) {
  const g = String(value ?? '').trim().toUpperCase();
  if (['MALE', 'M', 'BOY'].includes(g)) return 'MALE';
  if (['FEMALE', 'F', 'GIRL'].includes(g)) return 'FEMALE';
  return null;
}

const ROOM_GENDER = { BOYS: 'MALE', GIRLS: 'FEMALE' };

/**
 * Throws 409 when a student may not live in a room of this type: a BOYS room
 * takes male students only and a GIRLS room female students only. A student
 * whose gender is not recorded cannot be placed in either until it is.
 */
function assertGenderFits(roomType, student) {
  const needed = ROOM_GENDER[roomType];
  if (!needed) return; // GENERAL and STAFF rooms are not gendered
  const name = [student.firstName, student.lastName].filter(Boolean).join(' ') || 'This student';
  const gender = studentGender(student.gender);
  if (!gender) {
    throw new AppError(`${name} has no gender on record, so cannot be placed in a ${roomType.toLowerCase()} room. Update the student record first.`, 409, [], 'ROOM_GENDER_MISMATCH');
  }
  if (gender !== needed) {
    throw new AppError(`${name} cannot be placed in a ${roomType.toLowerCase()} room.`, 409, [], 'ROOM_GENDER_MISMATCH');
  }
}

export async function updateRoom(id, updates = {}) {
  const room = await HostelRoom.findById(id);
  if (!room) throw new AppError('Room not found', 404);
  const checked = checkRoomFields(updates, { partial: true });
  for (const key of ROOM_EDITABLE) {
    if (updates[key] !== undefined) room[key] = key in checked ? checked[key] : updates[key];
  }

  // Residents are not moved by editing a room: it cannot shrink below them,
  // close on them, or change to a type they cannot live in. (The room page
  // showed "available -2" after a 3-bed room with 3 residents went to 1 bed.)
  const residents = await HostelAllocation.find({ roomId: room._id, status: 'ACTIVE' })
    .populate('studentId', 'firstName lastName gender').lean();
  if (residents.length) {
    if (room.capacity < residents.length) {
      throw new AppError(`${residents.length} students live in this room, so it cannot have fewer than ${residents.length} beds. Move or vacate residents first.`, 409, [], 'ROOM_OCCUPIED');
    }
    if (room.status === 'CLOSED') {
      throw new AppError(`${residents.length} ${residents.length === 1 ? 'student lives' : 'students live'} in this room. Move or vacate them before closing it.`, 409, [], 'ROOM_OCCUPIED');
    }
    if (room.isModified('type')) {
      for (const r of residents) if (r.studentId) assertGenderFits(room.type, r.studentId);
    }
  }
  await room.save();
  return room;
}

// ─── Allocations ─────────────────────────────────────────────
export async function listAllocations({ roomId, status = 'ACTIVE' } = {}) {
  const filter = { status };
  if (roomId) filter.roomId = roomId;
  return HostelAllocation.find(filter)
    .populate('roomId', 'roomNo block floor type')
    .populate('studentId', 'firstName lastName admissionNo gender')
    .sort({ allottedAt: -1 });
}

export async function allocate({ roomId, studentId, allottedAt, academicYearId }) {
  if (!mongoose.isValidObjectId(roomId)) throw new AppError('Room not found', 404);
  if (!mongoose.isValidObjectId(studentId)) throw new AppError('Student not found', 404);

  // One transaction per allotment, and its first write touches the room. Two
  // allotments to the same room therefore conflict on that write, and the
  // loser is retried after the winner commits -- so it counts the winner's
  // bed. Count-then-create on its own let two requests both take the last bed.
  return runInAmbientTransaction(async () => {
    const room = await HostelRoom.findOneAndUpdate({ _id: roomId }, { $set: { updatedAt: new Date() } }, { new: true });
    if (!room) throw new AppError('Room not found', 404);
    if (room.status !== 'ACTIVE') {
      throw new AppError(`Room ${room.roomNo} is ${room.status.toLowerCase()} and cannot take residents.`, 409, [], 'ROOM_NOT_ACTIVE');
    }

    const student = await Student.findById(studentId);
    if (!student || student.deletedAt) throw new AppError('Student not found', 404);
    assertGenderFits(room.type, student);

    // Check if already allocated
    const existing = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
    if (existing) throw new AppError('Student already has an active hostel allocation', 409);

    // Check room capacity
    const occupied = await HostelAllocation.countDocuments({ roomId, status: 'ACTIVE' });
    if (occupied >= room.capacity) throw new AppError('Room is at full capacity', 409);

    const [allocation] = await HostelAllocation.create([{
      roomId,
      studentId,
      allottedAt: allottedAt ? new Date(allottedAt) : new Date(),
      academicYearId: academicYearId ?? null,
      status: 'ACTIVE',
    }]);

    // Belt and braces for a server without transactions (a standalone mongod,
    // where runInAmbientTransaction runs this unprotected): if a parallel
    // allotment slipped in, give the bed back rather than over-fill the room.
    const after = await HostelAllocation.countDocuments({ roomId, status: 'ACTIVE' });
    if (after > room.capacity) {
      await HostelAllocation.deleteOne({ _id: allocation._id });
      throw new AppError('Room is at full capacity', 409);
    }
    return allocation;
  });
}

export async function vacate(allocationId) {
  const allocation = await HostelAllocation.findById(allocationId);
  if (!allocation) throw new AppError('Allocation not found', 404);
  if (allocation.status === 'VACATED') throw new AppError('Already vacated', 409);
  allocation.status = 'VACATED';
  allocation.vacatedAt = new Date();
  await allocation.save();
  return allocation;
}

// ─── Hostel Students Directory ────────────────────────────────
export async function listHostelStudents() {
  const rows = await HostelAllocation.find({ status: 'ACTIVE' })
    .populate('roomId', 'roomNo block floor type')
    .populate('studentId', 'firstName lastName admissionNo gender dob photoUrl');
  // Sorted here, after populate: a sort on 'studentId.lastName' in the query is
  // on a path the allocation does not have, so Mongo silently ignored it.
  const key = (r) => [r.studentId?.lastName ?? '', r.studentId?.firstName ?? ''].map((x) => String(x).toLowerCase());
  return rows.sort((a, b) => {
    const [al, af] = key(a);
    const [bl, bf] = key(b);
    return al.localeCompare(bl) || af.localeCompare(bf);
  });
}

// ─── Emergency Medical Lookup ─────────────────────────────────
// A second door onto the same medical records the medical module serves, so it
// enforces the same gate: the route now also demands `medical.read` (which the
// WARDEN role already holds at ALL scope), and an OWN-scoped holder is narrowed
// by the medical module's own rules rather than seeing every resident. The
// residency check stays on top of that, and every use is audited.
//
// `scope` is medical.read's scope, not hostel.read's — see hostel.routes.js.
export async function getMedicalRecord(actor, scope, studentId) {
  // Authorisation before existence, so an unauthorised caller can't use the
  // 404s below to probe who is enrolled or resident.
  await assertCanAccessMedical(actor, scope, studentId, { via: 'hostel.medical_lookup' });

  const student = await Student.findById(studentId);
  if (!student) throw new AppError('Student not found', 404);

  // Verify they are a hostel student
  const allocation = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
  if (!allocation) throw new AppError('Student is not a current hostel resident', 404);

  // A record the office removed reads as absent here too (it is kept for the audit, not shown).
  const record = await MedicalRecord.findOne({ studentId, deletedAt: null });
  if (!record) {
    // Still an access attempt against a named resident, so it belongs in the
    // trail even though nothing was disclosed.
    await recordPiiRead({
      actor,
      action: 'medical.emergency_lookup',
      entityType: 'MedicalRecord',
      entityId: studentId,
      via: 'hostel.medical_lookup',
      fields: [],
    });
    return { studentId, message: 'No medical record on file' };
  }

  const obj = record.toObject();

  // Decrypt the encrypted fields and expose with cleaner names
  const encFields = {
    emergencyContact: 'emergencyContactEnc',
    allergies: 'allergiesEnc',
    medications: 'medicationsEnc',
    history: 'historyEnc',
  };

  for (const [cleanKey, encKey] of Object.entries(encFields)) {
    if (obj[encKey]) {
      try {
        obj[cleanKey] = decrypt(obj[encKey]);
      } catch {
        obj[cleanKey] = null;
      }
      delete obj[encKey];
    }
  }

  await recordPiiRead({
    actor,
    action: 'medical.emergency_lookup',
    entityType: 'MedicalRecord',
    entityId: studentId,
    via: 'hostel.medical_lookup',
    fields: Object.keys(encFields).filter((k) => obj[k] != null),
  });

  return obj;
}


// ─── Inquiries ────────────────────────────────────────────────
export async function listInquiries({ status } = {}) {
  const filter = {};
  if (status) filter.status = status;
  return HostelInquiry.find(filter)
    .populate('studentId', 'firstName lastName admissionNo')
    .populate('raisedByProfileId', 'displayName')
    .sort({ createdAt: -1 });
}

/**
 * A new inquiry, always OPEN and always raised by whoever is signed in. The
 * body used to be stored as sent, so a caller could file one as somebody else
 * or as already RESOLVED. `actor` is the signed-in person; a trusted internal
 * caller with no actor may name raisedByProfileId itself.
 */
export async function createInquiry(data = {}, actor = null) {
  if (data.studentId && !mongoose.isValidObjectId(data.studentId)) throw new AppError('studentId is not a valid id', 400);
  return HostelInquiry.create({
    studentId: data.studentId || null,
    subject: data.subject,
    description: data.description,
    raisedByProfileId: actor?.profileId ?? data.raisedByProfileId ?? null,
    status: 'OPEN',
    resolvedAt: null,
  });
}

export async function updateInquiry(id, { status }) {
  const inquiry = await HostelInquiry.findById(id);
  if (!inquiry) throw new AppError('Inquiry not found', 404);
  if (status) {
    inquiry.status = status;
    if (status === 'RESOLVED') inquiry.resolvedAt = new Date();
  }
  await inquiry.save();
  return inquiry;
}
