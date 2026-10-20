import * as exams from '../exams/exam.service.js';
import { AppError } from '../../utils/AppError.js';
import { assertObjectId } from '../ops/common.js';

/**
 * One paper's class result, for the teacher who set it (and the principal):
 * how far marks entry has got, average / highest / lowest, the share at or
 * above the pass mark, the CBSE eight-point grade spread, and the pupils below
 * the pass mark as a suggested remedial group. Read from the same marks grid
 * the marks-entry screen uses, so the teacher-owns-the-paper check is the same.
 * The remedial group is a suggestion for the teacher, not a label on a child.
 */

export const CBSE_BANDS = [['A1', 91], ['A2', 81], ['B1', 71], ['B2', 61], ['C1', 51], ['C2', 41], ['D', 33], ['E', 0]];
const PASS_PCT = 33;

export function analyseGrid(grid) {
  const max = grid.examSubject.maxMarks || 100;
  const rows = grid.rows;
  const scored = rows.filter((r) => typeof r.marks === 'number');
  const absent = rows.filter((r) => r.absence === 'AB').length;
  const medical = rows.filter((r) => r.absence === 'ML').length;
  const pending = rows.length - scored.length - absent - medical;
  const pcts = scored.map((r) => (r.marks / max) * 100);
  const round1 = (x) => Math.round(x * 10) / 10;
  const avg = pcts.length ? round1(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const bands = CBSE_BANDS.map(([grade, lo], i) => {
    const hi = i === 0 ? 101 : CBSE_BANDS[i - 1][1];
    return { grade, count: pcts.filter((p) => p >= lo && p < hi).length };
  });
  const below = scored.filter((r) => (r.marks / max) * 100 < PASS_PCT)
    .map((r) => ({ rollNo: r.rollNo, name: r.studentName, marks: r.marks, pct: round1((r.marks / max) * 100) }))
    .sort((a, b) => a.pct - b.pct);
  const notes = [];
  if (pending) notes.push(`${pending} pupil${pending === 1 ? ' has' : 's have'} no mark yet: these figures will change.`);
  if (below.length) notes.push(`${below.length} below ${PASS_PCT}%: a suggested remedial group for the next week.`);
  if (avg !== null && avg >= 75 && !below.length) notes.push('The class did well on this paper.');
  return {
    paper: grid.examSubject, total: rows.length, entered: scored.length, absent, medical, pending,
    average: avg, averageMarks: avg === null ? null : round1((avg / 100) * max),
    highest: scored.length ? Math.max(...scored.map((r) => r.marks)) : null,
    lowest: scored.length ? Math.min(...scored.map((r) => r.marks)) : null,
    passPct: scored.length ? Math.round((scored.filter((r) => (r.marks / max) * 100 >= PASS_PCT).length / scored.length) * 100) : null,
    bands, remedial: below, notes,
    published: rows.some((r) => r.status === 'PUBLISHED'),
  };
}

export async function paperResults(actor, scope, examSubjectId) {
  if (!examSubjectId) throw new AppError('examSubjectId is required', 400);
  const grid = await exams.getMarksGrid(actor, scope, assertObjectId(examSubjectId, 'examSubjectId'));
  return analyseGrid(grid);
}
