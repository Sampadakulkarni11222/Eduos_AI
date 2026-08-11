import { HostelRoom, HostelAllocation, HostelInquiry, HostelPass } from '../../models/hostel.model.js';
import { Ticket } from '../../models/ticket.model.js';
import { Student, StudentGuardian } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { Notification } from '../../models/notification.model.js';
import { AppError } from '../../utils/AppError.js';
import { decrypt } from '../../utils/crypto.js';

// ─── Helper DTO Mapper for HostelPass ───────────────────────
function toPassDto(pass) {
  const raw = pass.toObject ? pass.toObject() : pass;
  const student = raw.studentId;
  const now = new Date();
  const toDate = new Date(raw.toDate);
  const isOverdue = raw.status === 'OUT' && !raw.actualReturnTime && now > toDate;
  const overdueHours = isOverdue
    ? Math.max(1, Math.floor((now.getTime() - toDate.getTime()) / (1000 * 60 * 60)))
    : 0;

  return {
    id: raw._id,
    studentId: student?._id ?? raw.studentId,
    studentName: student
      ? [student.firstName, student.lastName].filter(Boolean).join(' ')
      : 'Unknown Student',
    admissionNo: student?.admissionNo ?? '—',
    applicantProfileId: raw.applicantProfileId,
    passType: raw.passType,
    fromDate: raw.fromDate,
    toDate: raw.toDate,
    reason: raw.reason,
    destination: raw.destination,
    emergencyContact: raw.emergencyContact,
    parentApprovalStatus: raw.parentApprovalStatus,
    parentReviewedAt: raw.parentReviewedAt ?? null,
    parentRemarks: raw.parentRemarks ?? null,
    status: raw.status,
    reviewedAt: raw.reviewedAt ?? null,
    remarks: raw.remarks ?? null,
    actualExitTime: raw.actualExitTime ?? null,
    actualReturnTime: raw.actualReturnTime ?? null,
    createdAt: raw.createdAt,
    isOverdue,
    overdueHours,
  };
}

// ─── Dashboard Summary ──────────────────────────────────────
export async function getSummary() {
  const [
    totalRooms,
    occupiedBeds,
    openInquiries,
    maintenanceTickets,
    pendingPasses,
    overduePasses,
  ] = await Promise.all([
    HostelRoom.countDocuments({ status: { $ne: 'CLOSED' } }),
    HostelAllocation.countDocuments({ status: 'ACTIVE' }),
    HostelInquiry.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
    Ticket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] }, routedToRoleKey: 'WARDEN' }),
    HostelPass.countDocuments({ status: 'PENDING' }),
    HostelPass.countDocuments({ status: 'OUT', actualReturnTime: null, toDate: { $lt: new Date() } }),
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
    pendingPasses,
    overduePasses,
  };
}

// ─── Rooms ───────────────────────────────────────────────────
export async function listRooms({ type, status } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const rooms = await HostelRoom.find(filter).sort({ block: 1, roomNo: 1 }).lean();

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
    const rowNo = i + 2;
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

  const existing = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
  if (existing) throw new AppError('Student already has an active hostel allocation', 409);

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

  const allocation = await HostelAllocation.findOne({ studentId, status: 'ACTIVE' });
  if (!allocation) throw new AppError('Student is not a current hostel resident', 404);

  const record = await MedicalRecord.findOne({ studentId });
  if (!record) return { studentId, message: 'No medical record on file' };

  const obj = record.toObject();

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

// ─── Hostel Passes (Feature 12) ──────────────────────────────
export async function applyHostelPass(actor, passData) {
  let student = null;

  if (actor.roleKey === 'STUDENT') {
    student = await Student.findOne({ profileId: actor.profileId, deletedAt: null });
  } else if (passData.studentId) {
    student = await Student.findById(passData.studentId);
  }

  if (!student) throw new AppError('Student record not found', 404);

  // Validate student has an active hostel allocation
  const allocation = await HostelAllocation.findOne({ studentId: student._id, status: 'ACTIVE' });
  if (!allocation) {
    throw new AppError('Only active hostel residents can apply for a hostel pass', 400);
  }

  // Validate dates
  const fromDate = new Date(passData.fromDate);
  const toDate = new Date(passData.toDate);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new AppError('Invalid fromDate or toDate format', 400);
  }
  if (toDate <= fromDate) {
    throw new AppError('Return date/time (toDate) must be after departure date/time (fromDate)', 400);
  }

  // Check if linked guardians exist
  const guardians = await StudentGuardian.find({ studentId: student._id }).lean();
  const parentApprovalStatus = guardians.length > 0 ? 'PENDING' : 'NOT_REQUIRED';

  const pass = await HostelPass.create({
    studentId: student._id,
    applicantProfileId: actor.profileId,
    passType: passData.passType || 'DAY_PASS',
    fromDate,
    toDate,
    reason: passData.reason.trim(),
    destination: passData.destination.trim(),
    emergencyContact: passData.emergencyContact.trim(),
    parentApprovalStatus,
    status: 'PENDING',
  });

  // Notify parent(s) if approval is required
  if (guardians.length > 0) {
    for (const g of guardians) {
      if (g.guardianProfileId) {
        try {
          await Notification.create({
            recipientProfileId: g.guardianProfileId,
            type: 'HOSTEL',
            title: `Hostel Pass Request - ${student.firstName}`,
            body: `${student.firstName} has requested a ${pass.passType.replace('_', ' ')} to ${pass.destination}. Please review and approve.`,
            link: '/parent/hostel-pass',
            meta: { passId: pass._id, studentId: student._id },
          });
        } catch (e) {
          // Ignore notification failures
        }
      }
    }
  }

  const populated = await HostelPass.findById(pass._id).populate('studentId', 'firstName lastName admissionNo');
  return toPassDto(populated);
}

export async function listMyHostelPasses(actor) {
  let filter = {};

  if (actor.roleKey === 'STUDENT') {
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null });
    if (!student) return [];
    filter = { studentId: student._id };
  } else if (actor.roleKey === 'PARENT') {
    const guardians = await StudentGuardian.find({ guardianProfileId: actor.profileId }).lean();
    const studentIds = guardians.map((g) => g.studentId);
    filter = { studentId: { $in: studentIds } };
  } else {
    // Other roles default to own applicant passes
    filter = { applicantProfileId: actor.profileId };
  }

  const passes = await HostelPass.find(filter)
    .populate('studentId', 'firstName lastName admissionNo')
    .sort({ createdAt: -1 });

  return passes.map(toPassDto);
}

export async function listHostelPasses({ status, passType, studentId, parentApprovalStatus } = {}) {
  const filter = {};
  if (status === 'OVERDUE') {
    filter.status = 'OUT';
    filter.actualReturnTime = null;
    filter.toDate = { $lt: new Date() };
  } else if (status) {
    filter.status = status;
  }

  if (passType) filter.passType = passType;
  if (studentId) filter.studentId = studentId;
  if (parentApprovalStatus) filter.parentApprovalStatus = parentApprovalStatus;

  const passes = await HostelPass.find(filter)
    .populate('studentId', 'firstName lastName admissionNo')
    .sort({ createdAt: -1 });

  return passes.map(toPassDto);
}

export async function parentReviewHostelPass(actor, passId, { status, remarks }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('Invalid parent review status. Must be APPROVED or REJECTED', 400);
  }

  const pass = await HostelPass.findById(passId);
  if (!pass) throw new AppError('Hostel pass not found', 404);

  // Security: Check parent linkage
  const isLinked = await StudentGuardian.exists({
    guardianProfileId: actor.profileId,
    studentId: pass.studentId,
  });
  if (!isLinked) {
    throw new AppError('Unauthorized: You are not a linked guardian of this student', 403);
  }

  pass.parentApprovalStatus = status;
  pass.parentReviewedByProfileId = actor.profileId;
  pass.parentReviewedAt = new Date();
  pass.parentRemarks = remarks ?? null;

  // If parent rejects, overall pass is rejected
  if (status === 'REJECTED') {
    pass.status = 'REJECTED';
    pass.remarks = remarks || 'Rejected by Parent';
  }

  await pass.save();

  const student = await Student.findById(pass.studentId).lean();
  if (student?.profileId) {
    try {
      await Notification.create({
        recipientProfileId: student.profileId,
        type: 'HOSTEL',
        title: `Hostel Pass Parent Review: ${status}`,
        body: `Your parent has ${status.toLowerCase()} your ${pass.passType.replace('_', ' ')} request.`,
        link: '/student/hostel-pass',
        meta: { passId: pass._id },
      });
    } catch (e) {}
  }

  const populated = await HostelPass.findById(passId).populate('studentId', 'firstName lastName admissionNo');
  return toPassDto(populated);
}

export async function wardenReviewHostelPass(actor, passId, { status, remarks }) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('Invalid warden review status. Must be APPROVED or REJECTED', 400);
  }

  const pass = await HostelPass.findById(passId);
  if (!pass) throw new AppError('Hostel pass not found', 404);

  // Enforcement: Cannot approve if parent approval is pending or rejected
  if (status === 'APPROVED') {
    if (pass.parentApprovalStatus === 'PENDING') {
      throw new AppError('Cannot approve pass while parent approval is PENDING', 400);
    }
    if (pass.parentApprovalStatus === 'REJECTED') {
      throw new AppError('Cannot approve pass that has been REJECTED by parent', 400);
    }
  }

  pass.status = status;
  pass.reviewedByProfileId = actor.profileId;
  pass.reviewedAt = new Date();
  pass.remarks = remarks ?? null;
  await pass.save();

  // Notify student
  const student = await Student.findById(pass.studentId).lean();
  if (student?.profileId) {
    try {
      await Notification.create({
        recipientProfileId: student.profileId,
        type: 'HOSTEL',
        title: `Hostel Pass Status: ${status}`,
        body: `Your ${pass.passType.replace('_', ' ')} has been ${status.toLowerCase()} by the warden.`,
        link: '/student/hostel-pass',
        meta: { passId: pass._id },
      });
    } catch (e) {}
  }

  // Notify parent(s)
  const guardians = await StudentGuardian.find({ studentId: pass.studentId }).lean();
  for (const g of guardians) {
    if (g.guardianProfileId) {
      try {
        await Notification.create({
          recipientProfileId: g.guardianProfileId,
          type: 'HOSTEL',
          title: `Hostel Pass Update - ${student?.firstName ?? 'Child'}`,
          body: `The warden has ${status.toLowerCase()} the ${pass.passType.replace('_', ' ')} request for ${student?.firstName ?? 'your child'}.`,
          link: '/parent/hostel-pass',
          meta: { passId: pass._id },
        });
      } catch (e) {}
    }
  }

  const populated = await HostelPass.findById(passId).populate('studentId', 'firstName lastName admissionNo');
  return toPassDto(populated);
}

export async function recordGateMovement(actor, passId, { action }) {
  if (!['EXIT', 'ENTRY'].includes(action)) {
    throw new AppError('Invalid movement action. Must be EXIT or ENTRY', 400);
  }

  const pass = await HostelPass.findById(passId);
  if (!pass) throw new AppError('Hostel pass not found', 404);

  const now = new Date();

  if (action === 'EXIT') {
    if (pass.status !== 'APPROVED') {
      throw new AppError(`Cannot record EXIT for pass with status "${pass.status}". Pass must be APPROVED.`, 400);
    }
    pass.status = 'OUT';
    pass.actualExitTime = now;
  } else if (action === 'ENTRY') {
    if (pass.status !== 'OUT') {
      throw new AppError(`Cannot record ENTRY for pass with status "${pass.status}". Student must be OUT.`, 400);
    }
    pass.status = 'RETURNED';
    pass.actualReturnTime = now;
  }

  await pass.save();

  // Notify Parent on gate movement
  const student = await Student.findById(pass.studentId).lean();
  const guardians = await StudentGuardian.find({ studentId: pass.studentId }).lean();
  for (const g of guardians) {
    if (g.guardianProfileId) {
      try {
        await Notification.create({
          recipientProfileId: g.guardianProfileId,
          type: 'HOSTEL',
          title: action === 'EXIT' ? `Gate Exit Notice - ${student?.firstName}` : `Gate Return Notice - ${student?.firstName}`,
          body: action === 'EXIT'
            ? `${student?.firstName} has departed from the hostel gate at ${now.toLocaleTimeString('en-IN')}.`
            : `${student?.firstName} has returned to the hostel at ${now.toLocaleTimeString('en-IN')}.`,
          link: '/parent/hostel-pass',
          meta: { passId: pass._id },
        });
      } catch (e) {}
    }
  }

  const populated = await HostelPass.findById(passId).populate('studentId', 'firstName lastName admissionNo');
  return toPassDto(populated);
}
