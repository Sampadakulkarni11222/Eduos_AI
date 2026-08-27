import {
  AcademicYear,
  Term,
  Grade,
  Section,
  Subject,
  SubjectOffering,
} from '../../models/academics.model.js';
import { Account } from '../../models/account.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { Enrollment } from '../../models/student.model.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { runInTransaction } from '../../utils/transaction.js';
import { SubjectRegistration } from '../../models/subjectRegistration.model.js';

const CHUNK_SIZE = 100;

/** Chunked insertMany with per-chunk error collection, shared by the bulk importers below. */
async function chunkedInsert(Model, validRows, dupField) {
  const results = { imported: 0, failed: 0, errors: [] };
  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      await runInTransaction(async (session) => {
        await Model.insertMany(chunk.map((c) => c.doc), { session });
      });
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach((c) => {
        const msg = err.code === 11000 && dupField
          ? `"${c.doc[dupField]}" already exists`
          : err.message;
        results.errors.push({ row: c.rowNo, error: msg });
      });
    }
  }
  return results;
}

// ── Academic Years ──
export const listYears = () => AcademicYear.find().sort({ startsOn: -1 });
export const createYear = (data = {}) => AcademicYear.create({
  ...data,
  name: requireText(data.name, 'Academic year name'),
  ...assertDateRange(data.startsOn, data.endsOn, 'Academic year'),
});

// ── Terms ──
export const listTerms = (academicYearId) =>
  Term.find(academicYearId ? { academicYearId } : {}).sort({ startsOn: 1 });
export const createTerm = (data = {}) => Term.create({
  ...data,
  name: requireText(data.name, 'Term name'),
  ...assertDateRange(data.startsOn, data.endsOn, 'Term'),
});

// ── Grades ──
export const listGrades = () => Grade.find().sort({ level: 1 });
/**
 * Validation at the service boundary. The controllers pass `req.body`
 * straight through and there is no schema-validation middleware, so a raw
 * `Model.create(data)` accepted anything Mongoose's own types allowed — a
 * grade with `level: -1` was written happily. These checks reject bad input
 * with a 400 before it reaches the database.
 */
function requireText(value, field, { max = 120 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new AppError(`${field} is required`, 400);
  if (v.length > max) throw new AppError(`${field} must be ${max} characters or fewer`, 400);
  return v;
}

function requireInt(value, field, { min, max } = {}) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isInteger(n)) {
    throw new AppError(`${field} must be a whole number`, 400);
  }
  if (min !== undefined && n < min) throw new AppError(`${field} must be at least ${min}`, 400);
  if (max !== undefined && n > max) throw new AppError(`${field} must be at most ${max}`, 400);
  return n;
}

/** Both dates must parse and end must not precede start. */
function assertDateRange(startsOn, endsOn, label) {
  const start = new Date(startsOn);
  const end = new Date(endsOn);
  if (Number.isNaN(start.getTime())) throw new AppError(`${label} start date is invalid`, 400);
  if (Number.isNaN(end.getTime())) throw new AppError(`${label} end date is invalid`, 400);
  if (end < start) throw new AppError(`${label} end date cannot be before the start date`, 400);
  return { startsOn: start, endsOn: end };
}

export const createGrade = (data = {}) => Grade.create({
  name: requireText(data.name, 'Grade name'),
  level: requireInt(data.level, 'Grade level', { min: 1, max: 20 }),
});

export async function bulkCreateGrades(rows) {
  const validRows = [];
  const results = { imported: 0, failed: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const name = row.name?.trim();
    const level = Number(row.level);
    if (!name || !Number.isFinite(level)) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'name and a numeric level are required' });
      continue;
    }
    validRows.push({ rowNo, doc: { name, level } });
  }
  const chunked = await chunkedInsert(Grade, validRows, 'name');
  return {
    imported: results.imported + chunked.imported,
    failed: results.failed + chunked.failed,
    errors: [...results.errors, ...chunked.errors],
  };
}

// ── Sections ──
export const listSections = (gradeId) =>
  Section.find(gradeId ? { gradeId } : {}).populate('gradeId classTeacherId classRepresentativeId').sort({ name: 1 });

/**
 * Returns sections the actor is directly linked to:
 * - TEACHER: sections they are classTeacher of + sections they have offerings in
 * - ALL other roles: all sections (unscoped)
 */
/**
 * Section IDs a student or parent is actually attached to — the student's own
 * enrolled sections, or every section their children are enrolled in.
 *
 * Returns null for any other role, meaning "not a family member", so callers
 * can tell an empty result apart from a role this does not apply to.
 */
async function getFamilySectionIds(actor) {
  let studentIds;
  if (actor.roleKey === 'STUDENT') {
    const own = await getOwnStudentId(actor.profileId);
    studentIds = own ? [own] : [];
  } else if (actor.roleKey === 'PARENT') {
    studentIds = await getGuardianStudentIds(actor.profileId);
  } else {
    return null;
  }

  if (!studentIds.length) return [];
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('sectionId');
  return [...new Set(enrollments.map((e) => e.sectionId?.toString()).filter(Boolean))];
}

/**
 * Returns the sections the actor is attached to.
 *
 * These `/mine` endpoints are the ones open to any authenticated user, so they
 * must genuinely be own-scoped. They used to fall through to the *full* section
 * list for every role except TEACHER, which meant a student or parent could
 * read the school's entire section roster from `/academics/sections/mine` —
 * gating `/academics/sections` alone would just have moved that one URL over.
 *
 * Staff still get the full list: they hold `academics.read` for it anyway.
 */
export async function getMySections(actor) {
  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    return Section.find({ _id: { $in: sectionIds } }).populate('gradeId classTeacherId classRepresentativeId').sort({ name: 1 });
  }

  const familySectionIds = await getFamilySectionIds(actor);
  if (familySectionIds) {
    return Section.find({ _id: { $in: familySectionIds } })
      .populate('gradeId classTeacherId classRepresentativeId')
      .sort({ name: 1 });
  }

  return listSections();
}

/**
 * Returns subject offerings the actor can see:
 * - TEACHER: only their own offerings
 * - STUDENT/PARENT: offerings for their own (or their children's) sections
 * - staff: unscoped offerings
 */
export async function getMyOfferings(actor) {
  if (actor.roleKey === 'TEACHER') {
    return SubjectOffering.find({ teacherId: actor.profileId })
      .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
      .populate('subjectId termId teacherId');
  }

  const familySectionIds = await getFamilySectionIds(actor);
  if (familySectionIds) {
    return SubjectOffering.find({ sectionId: { $in: familySectionIds } })
      .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
      .populate('subjectId termId teacherId');
  }

  return listOfferings();
}

export async function createSection(data) {
  const grade = await Grade.findById(data.gradeId);
  if (!grade) throw new AppError('Grade not found', 404);
  return Section.create(data);
}

export async function updateSection(id, updates) {
  const section = await Section.findById(id);
  if (!section) throw new AppError('Section not found', 404);
  
  if (updates.name !== undefined) section.name = updates.name;
  if (updates.gradeId !== undefined) section.gradeId = updates.gradeId;
  if (updates.classTeacherId !== undefined) section.classTeacherId = updates.classTeacherId;
  if (updates.classRepresentativeId !== undefined) section.classRepresentativeId = updates.classRepresentativeId;
  
  await section.save();
  return section;
}

export async function bulkCreateSections(rows) {
  const grades = await Grade.find().lean();
  const gradeMap = new Map(grades.map((g) => [g.name.toLowerCase(), g._id]));

  const validRows = [];
  const results = { imported: 0, failed: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const gradeName = row.gradename?.trim();
    const name = row.name?.trim();
    if (!gradeName || !name) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'gradeName and name are required' });
      continue;
    }
    const gradeId = gradeMap.get(gradeName.toLowerCase());
    if (!gradeId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Grade "${gradeName}" not found` });
      continue;
    }

    let classTeacherId;
    const phone = row.classteacherphone?.trim();
    if (phone) {
      const account = await Account.findOne({ phoneE164: phone });
      const profile = account ? await Profile.findOne({ accountId: account._id, deletedAt: null }) : null;
      if (!profile) {
        results.failed++;
        results.errors.push({ row: rowNo, error: `No profile found for phone "${phone}"` });
        continue;
      }
      classTeacherId = profile._id;
    }

    validRows.push({ rowNo, doc: { gradeId, name, classTeacherId } });
  }
  const chunked = await chunkedInsert(Section, validRows);
  return {
    imported: results.imported + chunked.imported,
    failed: results.failed + chunked.failed,
    errors: [...results.errors, ...chunked.errors],
  };
}

// ── Subjects ──
export const listSubjects = () => Subject.find().sort({ name: 1 });
export const createSubject = (data = {}) => Subject.create({
  name: requireText(data.name, 'Subject name'),
  ...(data.code ? { code: String(data.code).trim().slice(0, 20) } : {}),
});

export async function bulkCreateSubjects(rows) {
  const validRows = [];
  const results = { imported: 0, failed: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const name = row.name?.trim();
    if (!name) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'name is required' });
      continue;
    }
    validRows.push({ rowNo, doc: { name, code: row.code?.trim() || undefined } });
  }
  const chunked = await chunkedInsert(Subject, validRows, 'name');
  return {
    imported: results.imported + chunked.imported,
    failed: results.failed + chunked.failed,
    errors: [...results.errors, ...chunked.errors],
  };
}

// ── Subject Offerings ──
export const listOfferings = (filter = {}) =>
  SubjectOffering.find(filter)
    .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
    .populate('subjectId termId teacherId');

/**
 * Updates an existing offering. Exists so staff can mark a subject elective and
 * set its seat cap from the UI — previously those two fields were reachable
 * only by creating the offering with them, or by re-seeding the database.
 *
 * Only the fields an admin screen should own are accepted; sectionId/subjectId/
 * termId are the offering's identity and changing them would silently move
 * every timetable slot and registration attached to it.
 */
export async function updateOffering(id, data = {}) {
  const offering = await SubjectOffering.findById(id);
  if (!offering) throw new AppError('Subject offering not found', 404);

  if (data.teacherId !== undefined) offering.teacherId = data.teacherId || null;
  if (data.isElective !== undefined) offering.isElective = Boolean(data.isElective);

  if (data.capacity !== undefined) {
    if (data.capacity === null || data.capacity === '') {
      offering.capacity = null; // uncapped
    } else {
      const cap = Number(data.capacity);
      if (!Number.isInteger(cap) || cap < 1) {
        throw new AppError('capacity must be a whole number of seats, or empty for unlimited', 400, [], 'INVALID_CAPACITY');
      }
      // Lowering the cap below what is already taken would leave the offering
      // over-subscribed with no way for the UI to explain it.
      const taken = await SubjectRegistration.countDocuments({
        subjectOfferingId: offering._id,
        status: { $in: ['PENDING', 'APPROVED'] },
      });
      if (cap < taken) {
        throw new AppError(
          `${taken} seat(s) are already taken — set the capacity to ${taken} or more, or reject requests first.`,
          409, [], 'CAPACITY_BELOW_TAKEN'
        );
      }
      offering.capacity = cap;
    }
  }

  await offering.save();
  return offering;
}

export async function createOffering(data) {
  const [section, subject, term] = await Promise.all([
    Section.findById(data.sectionId),
    Subject.findById(data.subjectId),
    Term.findById(data.termId),
  ]);
  if (!section) throw new AppError('Section not found', 404);
  if (!subject) throw new AppError('Subject not found', 404);
  if (!term) throw new AppError('Term not found', 404);
  return SubjectOffering.create(data);
}
