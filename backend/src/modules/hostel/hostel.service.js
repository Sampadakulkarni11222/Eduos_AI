import { HostelRoom, HostelAllocation, HostelInquiry } from '../../models/hostel.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { Student } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { decrypt } from '../../utils/crypto.js';
import { recordPiiRead } from '../../utils/auditTrail.js';
import { assertCanAccess as assertCanAccessMedical } from '../medical/medical.service.js';

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

export async function createRoom(data) {
  return HostelRoom.create(data);
}

export async function bulkCreateRooms(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const VALID_TYPES = new Set(['BOYS', 'GIRLS', 'STAFF', 'GENERAL']);
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const roomNo = row.roomno?.trim();
    const capacity = Number(row.capacity);
    if (!roomNo || !Number.isFinite(capacity) || capacity <= 0) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'roomNo and a positive capacity are required' });
      continue;
    }
    const type = row.type?.trim().toUpperCase() || 'GENERAL';
    if (!VALID_TYPES.has(type)) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid type "${row.type}" (expected BOYS, GIRLS, STAFF, or GENERAL)` });
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

  const CHUNK_SIZE = 100;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    try {
      await HostelRoom.insertMany(chunk.map(({ rowNo, ...doc }) => doc));
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach((c) => {
        const msg = err.code === 11000 ? `Room "${c.roomNo}" already exists` : err.message;
        results.errors.push({ row: c.rowNo, error: msg });
      });
    }
  }

  return results;
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
      results.errors.push({ row: rowNo, error: 'admissionNo and roomNo are required' });
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No student found with admissionNo "${admissionNo}"` });
      continue;
    }

    const roomId = roomIdByRoomNo.get(roomNo.toLowerCase());
    if (!roomId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No room found with roomNo "${roomNo}"` });
      continue;
    }

    try {
      await allocate({ roomId: roomId.toString(), studentId: studentId.toString() });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: rowNo, error: err.message });
    }
  }

  return results;
}

export async function updateRoom(id, updates) {
  const room = await HostelRoom.findById(id);
  if (!room) throw new AppError('Room not found', 404);
  Object.assign(room, updates);
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
  const room = await HostelRoom.findById(roomId);
  if (!room) throw new AppError('Room not found', 404);

  const student = await Student.findById(studentId);
  if (!student) throw new AppError('Student not found', 404);

  // Check if already allocated
  const existing = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
  if (existing) throw new AppError('Student already has an active hostel allocation', 409);

  // Check room capacity
  const occupied = await HostelAllocation.countDocuments({ roomId, status: 'ACTIVE' });
  if (occupied >= room.capacity) throw new AppError('Room is at full capacity', 409);

  return HostelAllocation.create({
    roomId,
    studentId,
    allottedAt: allottedAt ? new Date(allottedAt) : new Date(),
    academicYearId: academicYearId ?? null,
    status: 'ACTIVE',
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
  return HostelAllocation.find({ status: 'ACTIVE' })
    .populate('roomId', 'roomNo block floor type')
    .populate('studentId', 'firstName lastName admissionNo gender dob photoUrl')
    .sort({ 'studentId.lastName': 1 });
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

  const record = await MedicalRecord.findOne({ studentId });
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

export async function createInquiry(data) {
  return HostelInquiry.create(data);
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
