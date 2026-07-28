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
import { getTeacherSectionIds } from '../../utils/scope.js';
import { runInTransaction } from '../../utils/transaction.js';

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
export const createYear = (data) => AcademicYear.create(data);

// ── Terms ──
export const listTerms = (academicYearId) =>
  Term.find(academicYearId ? { academicYearId } : {}).sort({ startsOn: 1 });
export const createTerm = (data) => Term.create(data);

// ── Grades ──
export const listGrades = () => Grade.find().sort({ level: 1 });
export const createGrade = (data) => Grade.create(data);

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
export async function getMySections(actor) {
  if (actor.roleKey === 'TEACHER') {
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    return Section.find({ _id: { $in: sectionIds } }).populate('gradeId classTeacherId classRepresentativeId').sort({ name: 1 });
  }
  return listSections();
}

/**
 * Returns subject offerings the actor can see:
 * - TEACHER: only their own offerings
 * - ALL other roles: unscoped offerings
 */
export async function getMyOfferings(actor) {
  if (actor.roleKey === 'TEACHER') {
    return SubjectOffering.find({ teacherId: actor.profileId })
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
export const createSubject = (data) => Subject.create(data);

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
