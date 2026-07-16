import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInTransaction } from '../../utils/transaction.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

/**
 * Resolves the list of student IDs the actor is allowed to see when scope is OWN.
 * - TEACHER → students enrolled in sections they teach
 * - PARENT  → their linked children
 * - STUDENT → their own record only
 */
async function resolveOwnStudentIds(actor) {
  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    const enrollments = await Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).select('studentId');
    return enrollments.map((e) => e.studentId.toString());
  }
  if (actor.roleKey === 'PARENT') {
    return getGuardianStudentIds(actor.profileId);
  }
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    return id ? [id] : [];
  }
  return [];
}

export async function list(actor, scope, query = {}) {
  const filter = { deletedAt: null };
  if (scope === 'OWN') {
    const ids = await resolveOwnStudentIds(actor);
    filter._id = { $in: ids };
  }
  if (query.search) {
    filter.$or = [
      { firstName: { $regex: query.search, $options: 'i' } },
      { lastName: { $regex: query.search, $options: 'i' } },
      { admissionNo: { $regex: query.search, $options: 'i' } },
    ];
  }
  const students = await Student.find(filter).sort({ createdAt: -1, lastName: 1, firstName: 1 });
  const studentIds = students.map((s) => s._id);

  // Get all ACTIVE enrollments for these students, sorted newest first.
  // We use a Map so we keep only the most-recent active enrollment per student.
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
    });

  // Build map: studentId → most recent active enrollment
  const enrollmentMap = new Map();
  for (const e of enrollments) {
    const sid = e.studentId.toString();
    if (!enrollmentMap.has(sid)) enrollmentMap.set(sid, e); // first = newest due to sort
  }

  return students.map((s) => {
    const enrollment = enrollmentMap.get(s._id.toString());
    return {
      id: s._id.toString(),
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName || ''}`.trim(),
      enrollment: enrollment
        ? {
            id: enrollment._id.toString(),
            rollNo: enrollment.rollNo ?? null,
            class: enrollment.sectionId
              ? `${enrollment.sectionId.gradeId?.name ?? ''} ${enrollment.sectionId.name}`.trim()
              : 'Unknown',
          }
        : null,
    };
  });
}

export async function getById(actor, scope, id) {
  const student = await Student.findOne({ _id: id, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);

  if (scope === 'OWN') {
    const ids = await resolveOwnStudentIds(actor);
    if (!ids.includes(id)) throw new AppError('Student not found', 404);
  }
  return student;
}

export const create = (data) => Student.create(data);

export async function update(id, updates) {
  const student = await Student.findOne({ _id: id, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  Object.assign(student, updates);
  await student.save();
  return student;
}

export async function softDelete(id) {
  const student = await Student.findOne({ _id: id, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  student.deletedAt = new Date();
  student.status = 'INACTIVE';
  await student.save();
}

// ── Guardians ──
export async function addGuardian(studentId, data) {
  const student = await Student.findOne({ _id: studentId, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  return StudentGuardian.create({ ...data, studentId });
}

export const listGuardians = (studentId) =>
  StudentGuardian.find({ studentId }).populate('guardianProfileId', 'displayName');

// ── Enrollments ──
export async function enroll(data) {
  const student = await Student.findOne({ _id: data.studentId, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  try {
    return await Enrollment.create(data);
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.rollNo) {
        throw new AppError(`Roll number ${data.rollNo} is already assigned in this section. Please choose a different roll number.`, 409);
      }
      throw new AppError('This student is already enrolled in the selected academic year.', 409);
    }
    throw err;
  }
}

/**
 * Bulk-assigns students to a section for an academic year from parsed CSV
 * rows (admissionNo + optional rollNo). Every row targets the same
 * sectionId/academicYearId; rows without a rollNo get the next available
 * one, assigned in file order so duplicates within the file still collide
 * predictably. Each row is inserted independently so one bad row doesn't
 * sink the whole batch.
 */
export async function bulkEnroll({ sectionId, academicYearId, rows }) {
  if (!sectionId || !academicYearId) {
    throw new AppError('sectionId and academicYearId are required', 400);
  }

  const results = { imported: 0, failed: 0, errors: [] };

  // 1. Extract and normalize all admission numbers
  const admissionNos = rows
    .map(r => r.admissionno?.trim())
    .filter(Boolean);

  // 2. Fetch all matching students in one query
  const students = await Student.find({ admissionNo: { $in: admissionNos }, deletedAt: null }).select('_id admissionNo');
  const studentMap = new Map(students.map(s => [s.admissionNo.toLowerCase(), s._id]));

  // 3. Keep track of starting suggestion roll number
  let nextSuggestedRollNo = await nextRollNo(sectionId, academicYearId);

  const validRows = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const admissionNo = row.admissionno?.trim();

    if (!admissionNo) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'admissionNo is required' });
      continue;
    }

    const studentId = studentMap.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No student found with admissionNo "${admissionNo}"` });
      continue;
    }

    let rollNo;
    if (row.rollno?.trim()) {
      rollNo = Number(row.rollno);
      if (!Number.isFinite(rollNo)) {
        results.failed++;
        results.errors.push({ row: rowNo, error: `Invalid rollNo "${row.rollno}"` });
        continue;
      }
    } else {
      rollNo = nextSuggestedRollNo++;
    }

    validRows.push({
      rowNo,
      admissionNo,
      doc: {
        studentId,
        sectionId,
        academicYearId,
        rollNo
      }
    });
  }

  // Chunk and insert
  const CHUNK_SIZE = 100;
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      await runInTransaction(async (session) => {
        const docsToInsert = chunk.map(c => c.doc);
        await Enrollment.insertMany(docsToInsert, { session });
      });
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach(c => {
        const rollNo = c.doc.rollNo;
        if (err.code === 11000 && err.keyPattern?.rollNo) {
          results.errors.push({ row: c.rowNo, error: `Roll number ${rollNo} is already assigned in this section` });
        } else if (err.code === 11000) {
          results.errors.push({ row: c.rowNo, error: `Student "${c.admissionNo}" is already enrolled in the selected academic year` });
        } else {
          results.errors.push({ row: c.rowNo, error: err.message });
        }
      });
    }
  }

  return results;
}

/** Returns the next suggested roll number for a given section+year (max existing + 1) */
export async function nextRollNo(sectionId, academicYearId) {
  const last = await Enrollment.findOne({ sectionId, academicYearId, rollNo: { $ne: null } })
    .sort({ rollNo: -1 })
    .select('rollNo');
  return (last?.rollNo ?? 0) + 1;
}

export async function listEnrollments(filter = {}) {
  const list = await Enrollment.find(filter)
    .populate('studentId')
    .populate({
      path: 'sectionId',
      populate: { path: 'gradeId' }
    })
    .populate('academicYearId');

  return list.map((e) => {
    const s = e.studentId;
    const sec = e.sectionId;
    const g = sec?.gradeId;
    return {
      id: e._id.toString(),
      studentName: s ? `${s.firstName} ${s.lastName || ''}`.trim() : 'Unknown Student',
      class: sec ? (g ? `${g.name} - ${sec.name}` : sec.name) : 'No Class',
      rollNo: e.rollNo,
      status: e.status,
    };
  });
}

export async function updateEnrollmentStatus(id, status) {
  const enrollment = await Enrollment.findById(id);
  if (!enrollment) throw new AppError('Enrollment not found', 404);
  enrollment.status = status;
  await enrollment.save();
  return enrollment;
}
