/**
 * Grading scale: percentage → letter grade + grade point.
 *
 * Modelled on the CBSE 10-point scale, which is what Indian schools most
 * commonly report against. Kept as data (not scattered conditionals) so a
 * school can be given its own scale later without touching the callers —
 * that is a per-tenant setting the moment multi-school ships.
 */
export const DEFAULT_GRADING_SCALE = [
  { min: 91, max: 100, label: 'A1', points: 10, descriptor: 'Outstanding' },
  { min: 81, max: 90.99, label: 'A2', points: 9, descriptor: 'Excellent' },
  { min: 71, max: 80.99, label: 'B1', points: 8, descriptor: 'Very Good' },
  { min: 61, max: 70.99, label: 'B2', points: 7, descriptor: 'Good' },
  { min: 51, max: 60.99, label: 'C1', points: 6, descriptor: 'Above Average' },
  { min: 41, max: 50.99, label: 'C2', points: 5, descriptor: 'Average' },
  { min: 33, max: 40.99, label: 'D', points: 4, descriptor: 'Below Average' },
  { min: 0, max: 32.99, label: 'E', points: 0, descriptor: 'Needs Improvement' },
];

/** Percentage at or above which a subject counts as passed. */
export const PASS_PERCENTAGE = 33;

/**
 * Resolves a percentage to its band. Returns null for a null/undefined
 * percentage so "not yet marked" stays distinguishable from "scored zero" —
 * conflating those would show an absent student as having failed.
 */
export function gradeForPercentage(percentage, scale = DEFAULT_GRADING_SCALE) {
  if (percentage === null || percentage === undefined || Number.isNaN(Number(percentage))) return null;
  const pct = Math.max(0, Math.min(100, Number(percentage)));
  return scale.find((b) => pct >= b.min && pct <= b.max) ?? scale[scale.length - 1];
}

export function percentage(marks, maxMarks) {
  if (marks === null || marks === undefined || !maxMarks) return null;
  return Number(((Number(marks) / Number(maxMarks)) * 100).toFixed(2));
}

/**
 * Aggregates per-subject results into a report-card summary.
 *
 * `subjects` items: { marks, maxMarks, … }. Unmarked subjects are excluded
 * from every total rather than counted as zero, so a partially-marked exam
 * reports an honest interim GPA instead of a misleadingly low one.
 */
export function summarise(subjects, scale = DEFAULT_GRADING_SCALE) {
  const marked = subjects.filter((s) => s.marks !== null && s.marks !== undefined && s.maxMarks);

  if (!marked.length) {
    return {
      totalMarks: 0, totalMaxMarks: 0, percentage: null, grade: null,
      gpa: null, subjectsMarked: 0, subjectsTotal: subjects.length,
      passed: null, failedSubjects: [],
    };
  }

  const totalMarks = marked.reduce((sum, s) => sum + Number(s.marks), 0);
  const totalMaxMarks = marked.reduce((sum, s) => sum + Number(s.maxMarks), 0);
  const pct = percentage(totalMarks, totalMaxMarks);

  const points = marked.map((s) => gradeForPercentage(percentage(s.marks, s.maxMarks), scale)?.points ?? 0);
  const gpa = Number((points.reduce((a, b) => a + b, 0) / points.length).toFixed(2));

  const failedSubjects = marked
    .filter((s) => percentage(s.marks, s.maxMarks) < PASS_PERCENTAGE)
    .map((s) => s.subject ?? s.subjectName ?? 'Unknown');

  return {
    totalMarks,
    totalMaxMarks,
    percentage: pct,
    grade: gradeForPercentage(pct, scale),
    gpa,
    subjectsMarked: marked.length,
    subjectsTotal: subjects.length,
    passed: failedSubjects.length === 0,
    failedSubjects,
  };
}
