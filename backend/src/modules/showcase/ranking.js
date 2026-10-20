import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { Term, Section, SubjectOffering } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId } from '../ops/common.js';

/**
 * Ranks from published exam results, and the tie rule.
 *
 * TIE RULE (standard competition ranking): students are ordered by their
 * percentage over every paper of the exam, rounded to two decimals. Equal
 * percentages share a rank and the next rank skips: 95, 95, 93 rank 1, 1, 3.
 *
 * WHO IS RANKED: a student with a published, numeric mark in every paper the
 * exam set for their class. An absence (AB/ML) or a paper with no mark leaves
 * the student unranked; it is never counted as zero.
 *
 * WHEN: only once every mark entered for those papers is PUBLISHED. A paper
 * still in draft or review, or reopened for correction, means the ranking is
 * refused (RESULTS_NOT_PUBLISHED) rather than computed from part of it.
 */

/** Two-decimal percentage key used for comparing (and so for ties). */
export const scoreKey = (pct) => Math.round(pct * 100);

/**
 * Assigns competition ranks. `rows` need a `percentage`; returns new rows
 * sorted best first, each with `rank`.
 */
export function competitionRanks(rows) {
  const sorted = [...rows].sort((a, b) => scoreKey(b.percentage) - scoreKey(a.percentage));
  let lastKey = null;
  let rank = 0;
  return sorted.map((r, i) => {
    const k = scoreKey(r.percentage);
    if (k !== lastKey) { rank = i + 1; lastKey = k; }
    return { ...r, rank };
  });
}

/** Keeps only ranks 1..cutoff (ties at the cut-off are all kept). */
export const withinCutoff = (ranked, cutoff) => ranked.filter((r) => r.rank <= cutoff);

async function sectionResults(exam, sectionId, yearId) {
  const offerings = await SubjectOffering.find({ sectionId }).select('_id').lean();
  const papers = await ExamSubject.find({ examId: exam._id, subjectOfferingId: { $in: offerings.map((o) => o._id) } }).select('_id maxMarks').lean();
  if (!papers.length) return { papers: 0, rows: [] };
  const paperIds = papers.map((p) => p._id);
  const unpublished = await Mark.countDocuments({ examSubjectId: { $in: paperIds }, status: { $ne: 'PUBLISHED' } });
  const published = await Mark.countDocuments({ examSubjectId: { $in: paperIds }, status: 'PUBLISHED' });
  if (unpublished > 0 || published === 0) {
    throw new AppError('Every paper of this exam must be published for the class before ranks can be drawn.', 409, [], 'RESULTS_NOT_PUBLISHED');
  }
  const enrolments = await Enrollment.find({ sectionId, ...(yearId ? { academicYearId: yearId } : {}) }).select('_id studentId').lean();
  const marks = await Mark.find({ examSubjectId: { $in: paperIds }, enrollmentId: { $in: enrolments.map((e) => e._id) }, status: 'PUBLISHED' }).select('examSubjectId enrollmentId marks absence').lean();
  const byEnrolment = new Map();
  for (const m of marks) {
    if (!byEnrolment.has(String(m.enrollmentId))) byEnrolment.set(String(m.enrollmentId), new Map());
    byEnrolment.get(String(m.enrollmentId)).set(String(m.examSubjectId), m);
  }
  const maxOf = new Map(papers.map((p) => [String(p._id), p.maxMarks ?? 100]));
  const rows = [];
  for (const e of enrolments) {
    const got = byEnrolment.get(String(e._id));
    if (!got) continue;
    let total = 0; let max = 0; let complete = true;
    for (const p of papers) {
      const m = got.get(String(p._id));
      if (!m || m.absence || typeof m.marks !== 'number') { complete = false; break; }
      total += m.marks; max += maxOf.get(String(p._id));
    }
    if (!complete || max <= 0) continue;
    rows.push({ studentId: String(e.studentId), enrollmentId: String(e._id), sectionId: String(sectionId), percentage: (total / max) * 100 });
  }
  return { papers: papers.length, rows, unranked: enrolments.length - rows.length };
}

/**
 * Ranks for one exam in one class (section) or across a grade.
 * @returns {{ exam, scope: 'SECTION'|'GRADE', ranked: Array<{studentId, sectionId, percentage, rank}>, unranked: number }}
 */
export async function examRanks({ examId, sectionId = null, gradeId = null }) {
  const exam = await Exam.findById(assertObjectId(examId, 'examId')).lean();
  if (!exam) throw new AppError('Exam not found', 404);
  const term = await Term.findById(exam.termId).select('academicYearId').lean();
  const yearId = term?.academicYearId ?? null;
  let sections;
  let scope;
  if (sectionId) {
    const s = await Section.findById(assertObjectId(sectionId, 'sectionId')).select('_id gradeId').lean();
    if (!s) throw new AppError('Class not found', 404);
    sections = [s]; scope = 'SECTION';
  } else if (gradeId) {
    sections = await Section.find({ gradeId: assertObjectId(gradeId, 'gradeId') }).select('_id gradeId').lean();
    if (!sections.length) throw new AppError('Grade not found', 404);
    scope = 'GRADE';
  } else {
    throw new AppError('Choose a class or a grade.', 400, [], 'SCOPE_REQUIRED');
  }
  const all = [];
  let unranked = 0;
  let papers = 0;
  for (const s of sections) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sectionResults(exam, s._id, yearId);
    if (!r.papers) continue;
    papers += r.papers;
    all.push(...r.rows);
    unranked += r.unranked ?? 0;
  }
  if (!papers) throw new AppError('This exam has no papers for that class.', 409, [], 'RESULTS_NOT_PUBLISHED');
  return { exam, scope, ranked: competitionRanks(all), unranked };
}
