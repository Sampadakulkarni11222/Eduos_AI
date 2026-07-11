import { HostelRoom, HostelAllocation, HostelInquiry } from '../../models/hostel.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { Student } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { decrypt } from '../../utils/crypto.js';

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
export async function getMedicalRecord(studentId) {
  const student = await Student.findById(studentId);
  if (!student) throw new AppError('Student not found', 404);

  // Verify they are a hostel student
  const allocation = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
  if (!allocation) throw new AppError('Student is not a current hostel resident', 404);

  const record = await MedicalRecord.findOne({ studentId });
  if (!record) return { studentId, message: 'No medical record on file' };

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
