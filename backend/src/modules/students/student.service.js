import fs from 'fs';
import path from 'path';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { AuditLog } from '../../models/auditLog.model.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SubjectOffering, Section } from '../../models/academics.model.js';
import { Submission } from '../../models/assignment.model.js';
import { AppError } from '../../utils/AppError.js';
import { runInTransaction } from '../../utils/transaction.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import * as medicalService from '../medical/medical.service.js';
import { recordPiiRead } from '../../utils/auditTrail.js';
import * as attendanceService from '../attendance/attendance.service.js';
import * as examService from '../exams/exam.service.js';

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

/** Escapes a user-supplied string so it is matched literally inside a $regex. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Student IDs whose current class (grade + section name) matches the search
 * text. The student list has always let users search by class as well as by
 * name; that used to be filtered in the browser over the whole list, which is
 * no longer possible once the list is paginated server-side.
 */
async function studentIdsMatchingClass(search) {
  const rx = new RegExp(escapeRegex(search), 'i');
  // Sections are a small collection (a few dozen rows), so they are matched in
  // memory against the same "<grade> <section>" label the list renders. A pure
  // query can't do that: the label spans two collections, so "Class 10 B"
  // matches neither the grade name nor the section name on its own.
  const sections = await Section.find().select('_id name gradeId').populate('gradeId', 'name').lean();
  const matched = sections.filter((s) => {
    const gradeName = s.gradeId?.name ?? '';
    return rx.test(`${gradeName} ${s.name}`.trim()) || rx.test(s.name) || rx.test(gradeName);
  });
  if (!matched.length) return [];
  const enrollments = await Enrollment.find({
    sectionId: { $in: matched.map((s) => s._id) },
    status: 'ACTIVE',
  }).select('studentId');
  return enrollments.map((e) => e.studentId);
}

/**
 * Lists students, optionally paginated.
 *
 * Passing `page`/`pageSize` returns `{ items, total, page, pageSize, totalPages }`;
 * without them the plain array shape callers already rely on is unchanged.
 */
export async function list(actor, scope, query = {}) {
  const filter = { deletedAt: null };
  if (scope === 'OWN') {
    const ids = await resolveOwnStudentIds(actor);
    filter._id = { $in: ids };
  }
  if (query.sectionId) {
    const enrollments = await Enrollment.find({ sectionId: query.sectionId, status: 'ACTIVE' }).select('studentId');
    const ids = enrollments.map((e) => e.studentId.toString());
    filter._id = filter._id
      ? { $in: filter._id.$in.map(String).filter((id) => ids.includes(String(id))) }
      : { $in: ids };
  }
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    const classMatchIds = await studentIdsMatchingClass(query.search);
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { admissionNo: rx },
      ...(classMatchIds.length ? [{ _id: { $in: classMatchIds } }] : []),
    ];
  }

  const requestedPageSize = parseInt(query.pageSize, 10);
  const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 200) : 0;
  const paginate = pageSize > 0;
  const requestedPage = paginate ? Math.max(parseInt(query.page, 10) || 1, 1) : 1;

  // _id last so the ordering is total — otherwise equal keys let skip/limit
  // show the same student on two pages.
  const sort = { createdAt: -1, lastName: 1, firstName: 1, _id: 1 };
  const total = paginate ? await Student.countDocuments(filter) : 0;
  // Clamp out-of-range pages to the last real page rather than returning an
  // empty table (matches /users, /fees/* and /risk/scan).
  const totalPagesCalc = paginate ? Math.max(Math.ceil(total / pageSize), 1) : 1;
  const page = paginate ? Math.min(requestedPage, totalPagesCalc) : 1;
  const students = paginate
    ? await Student.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize)
    : await Student.find(filter).sort(sort);
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

  const items = students.map((s) => {
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
            sectionId: enrollment.sectionId?._id?.toString() ?? null,
            academicYearId: enrollment.academicYearId?.toString() ?? null,
          }
        : null,
    };
  });

  if (!paginate) return items;
  return { items, total, page, pageSize, totalPages: totalPagesCalc, nextCursor: null };
}

/**
 * Returns the full student document — date of birth, gender, address, photo.
 * That is personal data, so every read is audited here rather than in the
 * controller: getOverview() and getIdCardData() both come through this
 * function, and auditing at the single choke point keeps them covered.
 *
 * @param {string}  [via]   Which endpoint surfaced the record.
 * @param {boolean} [audit] Set false when the caller is only using this as an
 *   ownership check and returns none of the personal fields to the client —
 *   logging those as disclosures would bury the real reads in noise.
 */
export async function getById(actor, scope, id, { via = 'students.api', audit = true } = {}) {
  const student = await Student.findOne({ _id: id, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);

  if (scope === 'OWN') {
    const ids = await resolveOwnStudentIds(actor);
    if (!ids.includes(id)) throw new AppError('Student not found', 404);
  }

  if (audit) {
    await recordPiiRead({
      actor,
      action: 'student.pii_read',
      entityType: 'Student',
      entityId: id,
      via,
      fields: ['dob', 'gender', 'address', 'photoUrl'].filter((f) => student[f] != null),
    });
  }

  return student;
}

/**
 * Aggregates everything a "view student" panel needs in one call: profile +
 * address, guardians (with phone), medical record, this month's attendance,
 * published exam performance, and assignment submissions. Each sub-section is
 * best-effort — a section a caller isn't allowed to see (e.g. medical data for
 * a non-class-teacher) is simply omitted (null/empty) rather than failing the
 * whole request, since the underlying services already enforce their own
 * narrower visibility rules (class-teacher-only medical, subject-teacher-only
 * marks/assignments).
 */
export async function getOverview(actor, scope, id) {
  const student = await getById(actor, scope, id, { via: 'students.overview' }); // throws 404 if not visible to this actor

  // Class teacher and CR are populated the same way the parent dashboard does
  // it (dashboard.service.js), so a student sees exactly what their guardian
  // already sees — the data was on the section all along, just never read here.
  const enrollment = await Enrollment.findOne({ studentId: id, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .populate({
      path: 'sectionId',
      populate: [
        { path: 'gradeId' },
        {
          path: 'classTeacherId',
          select: 'displayName accountId',
          populate: { path: 'accountId', select: 'phoneE164 email' },
        },
        { path: 'classRepresentativeId', select: 'firstName lastName' },
      ],
    });

  const section = enrollment?.sectionId;
  const teacher = section?.classTeacherId;
  const rep = section?.classRepresentativeId;

  const enrollmentDto = enrollment
    ? {
        id: enrollment._id.toString(),
        rollNo: enrollment.rollNo ?? null,
        class: enrollment.sectionId
          ? `${enrollment.sectionId.gradeId?.name ?? ''} ${enrollment.sectionId.name}`.trim()
          : 'Unknown',
        sectionId: enrollment.sectionId?._id?.toString() ?? null,
        academicYearId: enrollment.academicYearId?.toString() ?? null,
        classTeacher: teacher
          ? {
              name: teacher.displayName ?? 'Unknown',
              phone: teacher.accountId?.phoneE164 ?? null,
              email: teacher.accountId?.email ?? null,
            }
          : null,
        classRepresentative: rep
          ? { name: `${rep.firstName} ${rep.lastName ?? ''}`.trim() }
          : null,
      }
    : null;

  const guardianLinks = await StudentGuardian.find({ studentId: id }).populate({
    path: 'guardianProfileId',
    select: 'displayName accountId',
    populate: { path: 'accountId', select: 'phoneE164 email' },
  });
  const guardians = guardianLinks.map((g) => ({
    name: g.guardianProfileId?.displayName ?? 'Unknown',
    relation: g.relation,
    phone: g.guardianProfileId?.accountId?.phoneE164 ?? null,
    email: g.guardianProfileId?.accountId?.email ?? null,
    isPrimary: g.isPrimary,
  }));

  let medical = null;
  try {
    medical = await medicalService.getByStudentId(actor, scope, id, { via: 'students.overview' });
  } catch {
    // No record, or (for a TEACHER) not this section's class teacher — omit.
  }

  let attendance = null;
  let performance = null;
  let assignments = [];
  if (enrollment) {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      attendance = await attendanceService.getSummary(actor, scope, {
        enrollmentId: enrollment._id.toString(),
        month: yearMonth,
      });
    } catch {
      // leave null
    }

    try {
      performance = await examService.getPerformance(actor, scope, { enrollmentId: enrollment._id.toString() });
    } catch {
      // leave null
    }

    // Same subject-teacher restriction exam.getPerformance applies to marks:
    // a subject teacher (not this section's class teacher) only sees
    // assignments from the offering(s) they actually teach here.
    let restrictToOfferingIds = null;
    if (scope === 'OWN' && actor.roleKey === 'TEACHER') {
      const isClassTeacher = enrollment.sectionId?.classTeacherId?.toString() === actor.profileId;
      if (!isClassTeacher) {
        const myOfferings = await SubjectOffering.find({
          sectionId: enrollment.sectionId?._id,
          teacherId: actor.profileId,
        }).select('_id');
        restrictToOfferingIds = myOfferings.map((o) => o._id.toString());
      }
    }

    const submissions = await Submission.find({ enrollmentId: enrollment._id })
      .populate({ path: 'assignmentId', populate: { path: 'subjectOfferingId', populate: { path: 'subjectId' } } })
      .sort({ createdAt: -1 });

    assignments = submissions
      .filter((sub) => {
        if (!restrictToOfferingIds) return true;
        const offeringId = sub.assignmentId?.subjectOfferingId?._id?.toString();
        return offeringId && restrictToOfferingIds.includes(offeringId);
      })
      .map((sub) => ({
        id: sub.assignmentId?._id?.toString() ?? sub._id.toString(),
        title: sub.assignmentId?.title ?? 'Untitled',
        subject: sub.assignmentId?.subjectOfferingId?.subjectId?.name ?? '—',
        dueAt: sub.assignmentId?.dueAt ?? null,
        status: sub.status,
        marks: sub.marks ?? null,
        maxMarks: sub.assignmentId?.maxMarks ?? null,
      }));
  }

  return {
    id: student._id.toString(),
    admissionNo: student.admissionNo,
    name: `${student.firstName} ${student.lastName || ''}`.trim(),
    dob: student.dob,
    gender: student.gender,
    address: student.address ?? null,
    photoUrl: student.photoUrl ?? null,
    enrollment: enrollmentDto,
    guardians,
    medical,
    attendance,
    performance,
    assignments,
  };
}

/** Loads everything needed to render a student's ID card, enforcing the same OWN/ALL visibility as getById. */
export async function getIdCardData(actor, scope, id) {
  const student = await getById(actor, scope, id, { via: 'students.id_card' });

  const enrollment = await Enrollment.findOne({ studentId: id, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
    .populate('academicYearId');

  if (!enrollment) {
    throw new AppError('Your enrollment record is incomplete — contact the school office for an ID card.', 404, [], 'ENROLLMENT_MISSING');
  }

  return {
    studentName: `${student.firstName} ${student.lastName || ''}`.trim(),
    admissionNo: student.admissionNo,
    dob: student.dob,
    gender: student.gender,
    className: enrollment.sectionId
      ? `${enrollment.sectionId.gradeId?.name ?? ''} ${enrollment.sectionId.name}`.trim()
      : null,
    rollNo: enrollment.rollNo ?? null,
    academicYear: enrollment.academicYearId?.name ?? null,
    // Carried through so the card prints the real photo instead of falling
    // back to initials whenever one has been uploaded.
    photoUrl: student.photoUrl ?? null,
  };
}

/**
 * Sets a student's profile photo.
 *
 * Separate from update() because that requires `students.manage` — staff-only.
 * A student needs to be able to supply their own photo for their ID card
 * without being handed permission to edit their admission record, so this
 * writes exactly one field and re-uses getById's OWN check to confirm the
 * caller owns (or is guardian of) the record.
 */
export async function setPhoto(actor, scope, id, photoUrl) {
  const url = String(photoUrl ?? '').trim();
  if (!url) throw new AppError('photoUrl is required', 400);

  // Only accept a path produced by our own upload endpoint. A remote URL here
  // would be fetched by the ID-card renderer, turning this into an SSRF and a
  // way to put arbitrary third-party images on a school document.
  if (!/^\/?uploads\/[A-Za-z0-9._-]+$/.test(url)) {
    throw new AppError('photoUrl must reference a file uploaded to this system', 400, [], 'INVALID_PHOTO_URL');
  }

  const student = await getById(actor, scope, id, { audit: false }); // 404s if not visible to this actor
  student.photoUrl = url.startsWith('/') ? url : `/${url}`;
  await student.save();

  return { id: student._id.toString(), photoUrl: student.photoUrl };
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

  // Cascade soft delete / deactivation to active enrollments
  await Enrollment.updateMany({ studentId: id, status: 'ACTIVE' }, { $set: { status: 'WITHDRAWN' } });
}

/**
 * Irreversibly erases a former student's personal data.
 *
 * softDelete() above sets a flag and nothing else, so a "deleted" child kept
 * their full name, date of birth, home address, gender, guardian names, phone
 * numbers, email addresses and medical records — all still queryable. That is a
 * retention decision nobody made, on minors' data.
 *
 * Erasure rather than row deletion, because a school cannot simply drop the
 * academic and financial record: attendance, marks and invoices carry statutory
 * retention and other totals reconcile against them. Those rows stay, keyed by
 * studentId, but nothing identifying survives on them.
 *
 * Removed:
 *   - name, date of birth, address, gender, and the uploaded photo (file too)
 *   - the guardian links, so no contact detail is reachable from the child
 *   - medical records, deleted outright — the most sensitive data held, with no
 *     retention basis once the child has left
 *
 * Kept deliberately:
 *   - admissionNo, so ledger and transcript history stay reconcilable
 *   - enrollment, attendance, marks, invoices — de-identified by this operation
 *     because they hold no personal data of their own
 *
 * The erasure is itself audited: who, when, which record. That entry is the
 * evidence the request was honoured, so it has to outlive the data — and it
 * records that identifying data existed, never what it was.
 */
export async function anonymiseStudent(actor, id, { reason = null } = {}) {
  const student = await Student.findById(id);
  if (!student) throw new AppError('Student not found', 404);

  if (student.anonymisedAt) {
    // Idempotent: a repeated request is not an error, and must not report
    // destroying data that was already gone.
    return { id: String(student._id), admissionNo: student.admissionNo, alreadyAnonymised: true };
  }

  const removed = {
    name: Boolean(student.firstName || student.lastName),
    dob: Boolean(student.dob),
    address: Boolean(student.address),
    photo: Boolean(student.photoUrl),
  };

  // The photo is a file on disk, not just a field — leaving it would defeat the
  // whole operation for anyone holding the URL.
  if (student.photoUrl) {
    try {
      const abs = path.resolve(process.cwd(), String(student.photoUrl).replace(/^\//, ''));
      const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
      if (abs.startsWith(uploadRoot + path.sep) && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (err) {
      logger.warn(`Could not remove photo for anonymised student ${id}: ${err.message}`);
    }
  }

  student.firstName = 'Withdrawn';
  student.lastName = 'Student';
  student.dob = null;
  student.gender = null;
  student.address = null;
  student.photoUrl = null;
  student.profileId = null; // severs the login that powered OWN scope
  student.status = 'INACTIVE';
  student.deletedAt = student.deletedAt ?? new Date();
  student.anonymisedAt = new Date();
  await student.save();

  const guardianLinks = await StudentGuardian.deleteMany({ studentId: id });
  const medical = await MedicalRecord.deleteMany({ studentId: id });
  await Enrollment.updateMany({ studentId: id, status: 'ACTIVE' }, { $set: { status: 'WITHDRAWN' } });

  await AuditLog.create({
    actorProfileId: actor?.profileId ?? null,
    action: 'student.anonymise',
    entityType: 'Student',
    entityId: String(id),
    channel: 'WEB',
    after: {
      admissionNo: student.admissionNo,
      removed: { ...removed, guardianLinks: guardianLinks.deletedCount, medicalRecords: medical.deletedCount },
      reason: reason ? String(reason).slice(0, 300) : null,
      at: new Date().toISOString(),
    },
  });

  logger.info(
    `Anonymised student ${student.admissionNo} (${id}) — guardian links:${guardianLinks.deletedCount} medical:${medical.deletedCount}`
  );

  return {
    id: String(student._id),
    admissionNo: student.admissionNo,
    anonymisedAt: student.anonymisedAt,
    removed: { ...removed, guardianLinks: guardianLinks.deletedCount, medicalRecords: medical.deletedCount },
  };
}

// ── Guardians ──
export async function addGuardian(studentId, data) {
  const student = await Student.findOne({ _id: studentId, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  return StudentGuardian.create({ ...data, studentId });
}

/**
 * List query over guardian contact details — names and relationships tied to a
 * named child, so it is audited with the row count the caller received.
 */
export async function listGuardians(actor, studentId) {
  const links = await StudentGuardian.find({ studentId }).populate('guardianProfileId', 'displayName');

  await recordPiiRead({
    actor,
    action: 'guardian.pii_read',
    entityType: 'StudentGuardian',
    entityId: studentId,
    via: 'students.guardians',
    count: links.length,
  });

  return links;
}

// ── Enrollments ──
export async function enroll(data) {
  const student = await Student.findOne({ _id: data.studentId, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);

  // Find if there is already an enrollment for this student and academic year
  const existing = await Enrollment.findOne({
    studentId: data.studentId,
    academicYearId: data.academicYearId,
  });

  try {
    if (existing) {
      existing.sectionId = data.sectionId;
      if (data.rollNo !== undefined) existing.rollNo = data.rollNo;
      existing.status = 'ACTIVE'; // Reset status if they were previously withdrawn/transferred
      await existing.save();
      return existing;
    } else {
      return await Enrollment.create(data);
    }
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
