import { createLedger } from '../../agent/calc.js';

/**
 * METRIC DEFINITION: the student performance score.
 *
 * One place that says what the score IS -- its components, their weights,
 * the formula for each in code and in words, and the bands -- versioned, so
 * a score can always be traced to the definition it was computed under. The
 * MCP tool get_student_performance (tools/p7Multi.js) gathers the records and
 * calls scorePerformance(); nothing else computes the score, and the language
 * model never does: when one is configured it may only phrase the explanation
 * around the figures this returns.
 *
 * Rules the definition holds to (the product owner's):
 *   - a component with no data is EXCLUDED, never guessed or counted as zero,
 *     and the remaining weights are renormalised -- which the output says;
 *   - the class average is shown only when at least CLASS_AVERAGE_MIN
 *     classmates have a mark for that paper (never for a tiny group, where an
 *     average would identify individuals);
 *   - no behaviour or discipline score, and no ranking against named
 *     classmates: the only comparison is the anonymous class average;
 *   - only published marks and published report cards count.
 *
 * Changing a weight, a formula or a band means a NEW version: bump VERSION and
 * describe the change in CHANGELOG.
 */

export const METRIC_ID = 'student-performance';
export const VERSION = '1.0.0';
export const CHANGELOG = [
  { version: '1.0.0', date: '2026-10-18', change: 'First definition: attendance, marks, progress, assignments, consistency, co-scholastic, clubs.' },
];

/** The fewest classmates with a mark on a paper before its class average is shown. */
export const CLASS_AVERAGE_MIN = 5;

/**
 * The components, in the order they are reported. Weights sum to 1.
 * `formula` is the sentence shown under "How it's calculated".
 */
export const COMPONENTS = [
  {
    key: 'attendance', label: 'Attendance', weight: 0.25, link: '/attendance',
    formula: 'Attendance % = (days present + late + excused + half of half-days) ÷ days marked × 100.',
  },
  {
    key: 'marks', label: 'Marks', weight: 0.30, link: '/exams',
    formula: 'Marks = the average of the percentage scored in each published test paper in the period.',
  },
  {
    key: 'progress', label: 'Progress (marks trend)', weight: 0.10, link: '/exams',
    formula: 'Progress = 50 + 2.5 × (average % in the latest test − average % in the previous test), kept between 0 and 100; needs two tests.',
  },
  {
    key: 'assignments', label: 'Assignments', weight: 0.20, link: '/assignments',
    formula: 'Assignments = the average of the completion rate (submitted ÷ due) and the on-time rate (on time ÷ submitted).',
  },
  {
    key: 'consistency', label: 'Consistency across tests', weight: 0.05, link: '/exams',
    formula: 'Consistency = 100 − 2 × the spread (standard deviation) of the test percentages, kept between 0 and 100; needs two papers.',
  },
  {
    key: 'coScholastic', label: 'Co-scholastic grades', weight: 0.05, link: '/report-cards',
    formula: 'Co-scholastic = the average grade on the published report card, the top grade of the scale counting 100 and each step down an equal share less.',
  },
  {
    key: 'clubs', label: 'Club participation', weight: 0.05, link: '/clubs',
    formula: 'Clubs = club sessions attended ÷ club sessions held × 100.',
  },
];

/** Bands, highest first: the first whose floor the score reaches. */
export const BANDS = [
  { min: 85, label: 'Excellent' },
  { min: 70, label: 'Good' },
  { min: 55, label: 'Satisfactory' },
  { min: 40, label: 'Developing' },
  { min: 0, label: 'Needs support' },
];

export const bandOf = (score) => (score == null ? null : BANDS.find((b) => score >= b.min)?.label ?? BANDS.at(-1).label);

/**
 * The score, from the gathered records. Pure: same inputs, same output.
 *
 * @param {object} input
 * @param {{from: string, to: string}} input.period
 * @param {object|null} input.attendance  attendanceFigures() output, or null
 * @param {Array<{exam: string, subject: string, date: string|null, marks: number, maxMarks: number, classAverage: number|null, classMarked: number}>} input.assessments
 *   the student's published papers in the period
 * @param {number} input.papersSet  papers set for the student's class in the period
 * @param {{due: number, submitted: number, onTime: number, late: number, upcoming: number}|null} input.assignments
 * @param {{grades: Array<{area: string, grade: string}>, scale: string[]}|null} input.coScholastic
 * @param {{memberships: number, held: number, attended: number}|null} input.clubs
 */
export function scorePerformance(input) {
  const ledger = createLedger('perf');
  const parts = {};

  // Attendance.
  const att = input.attendance;
  if (att && att.workingDays > 0) {
    const attended = (att.PRESENT ?? 0) + (att.LATE ?? 0) + (att.EXCUSED ?? 0) + (att.HALF_DAY ?? 0) * 0.5;
    const score = ledger.pct({ value: attended, source: 'attendance records' }, { value: att.workingDays, source: 'days marked' }, { label: 'attendance %' });
    parts.attendance = { score, value: `${score}%`, detail: `${attended} of ${att.workingDays} day(s) attended`, coverage: `${att.workingDays} school day(s) marked` };
  } else {
    parts.attendance = { excluded: 'no attendance has been marked in this period' };
  }

  // Marks: one percentage per published paper.
  const papers = (input.assessments ?? []).filter((a) => Number.isFinite(a.marks) && a.maxMarks > 0);
  const paperPct = papers.map((a) => ledger.pct(a.marks, a.maxMarks, { label: `${a.subject} ${a.exam} %` }));
  const coverage = `${papers.length} of ${Math.max(input.papersSet ?? 0, papers.length)} test paper(s) recorded`;
  if (papers.length) {
    const score = ledger.mean(paperPct, { label: 'marks average %' });
    parts.marks = { score, value: `${score}%`, detail: `average of ${papers.length} paper(s)`, coverage };
  } else {
    parts.marks = { excluded: 'no published test marks in this period', coverage };
  }

  // Progress: the latest test (exam) against the one before, by date.
  const byExam = new Map();
  papers.forEach((a, i) => {
    const key = `${a.exam}|${a.date ?? ''}`;
    if (!byExam.has(key)) byExam.set(key, { exam: a.exam, date: a.date, pcts: [] });
    byExam.get(key).pcts.push(paperPct[i]);
  });
  const exams = [...byExam.values()].sort((x, y) => String(x.date ?? '').localeCompare(String(y.date ?? '')));
  if (exams.length >= 2) {
    const latest = exams.at(-1);
    const previous = exams.at(-2);
    const latestAvg = ledger.mean(latest.pcts, { label: `${latest.exam} average %` });
    const previousAvg = ledger.mean(previous.pcts, { label: `${previous.exam} average %` });
    const change = ledger.diff(latestAvg, previousAvg, { label: 'change in points' });
    const raw = ledger.linear(change, 2.5, 50, { label: 'progress before limits' });
    const score = ledger.clamp(raw, 0, 100, { label: 'progress score' });
    parts.progress = {
      score,
      value: `${change >= 0 ? '+' : ''}${change} points`,
      detail: `${latest.exam} ${latestAvg}% against ${previous.exam} ${previousAvg}%`,
      coverage: `${exams.length} test(s) compared`,
    };
  } else {
    parts.progress = { excluded: exams.length ? 'only one test recorded, so there is no trend yet' : 'no published test marks in this period' };
  }

  // Assignments.
  const asg = input.assignments;
  if (asg && asg.due > 0) {
    const completion = ledger.pct(asg.submitted, asg.due, { label: 'completion rate %' });
    const onTime = asg.submitted > 0 ? ledger.pct(asg.onTime, asg.submitted, { label: 'on-time rate %' }) : null;
    const score = onTime == null ? completion : ledger.mean([completion, onTime], { label: 'assignments score' });
    parts.assignments = {
      score,
      value: `${completion}% completed${onTime == null ? '' : `, ${onTime}% on time`}`,
      detail: `${asg.submitted} of ${asg.due} submitted (${asg.onTime} on time, ${asg.late} late)${asg.upcoming ? `; ${asg.upcoming} not yet due` : ''}`,
      coverage: `${asg.due} assignment(s) due`,
    };
  } else {
    parts.assignments = { excluded: asg?.upcoming ? `nothing was due yet (${asg.upcoming} not yet due)` : 'no assignments were due in this period' };
  }

  // Consistency.
  if (paperPct.length >= 2) {
    const spread = ledger.stdev(paperPct, { label: 'spread of test %' });
    const raw = ledger.linear(spread, -2, 100, { label: 'consistency before limits' });
    const score = ledger.clamp(raw, 0, 100, { label: 'consistency score' });
    parts.consistency = { score, value: `spread ${spread} points`, detail: `across ${paperPct.length} paper(s)`, coverage: `${paperPct.length} paper(s)` };
  } else {
    parts.consistency = { excluded: 'needs at least two published papers' };
  }

  // Co-scholastic.
  const co = input.coScholastic;
  const scale = (co?.scale ?? []).map((g) => String(g).toUpperCase());
  const graded = (co?.grades ?? []).filter((g) => scale.includes(String(g.grade).toUpperCase()));
  if (graded.length && scale.length) {
    const points = graded.map((g) => ledger.pct(scale.length - scale.indexOf(String(g.grade).toUpperCase()), scale.length, { label: `${g.area} grade ${g.grade}` }));
    const score = ledger.mean(points, { label: 'co-scholastic score' });
    parts.coScholastic = { score, value: graded.map((g) => `${g.area} ${g.grade}`).join(', '), detail: `scale ${scale.join('/')}`, coverage: `${graded.length} area(s) graded` };
  } else {
    parts.coScholastic = { excluded: 'no co-scholastic grades on a published report card' };
  }

  // Clubs.
  const clubs = input.clubs;
  if (clubs && clubs.held > 0) {
    const score = ledger.pct(clubs.attended, clubs.held, { label: 'club session attendance %' });
    parts.clubs = { score, value: `${score}% of sessions`, detail: `${clubs.attended} of ${clubs.held} session(s) attended in ${clubs.memberships} club(s)`, coverage: `${clubs.held} session(s) recorded` };
  } else {
    parts.clubs = { excluded: clubs?.memberships ? `member of ${clubs.memberships} club(s), but no session attendance is recorded` : 'no club participation recorded' };
  }

  const components = COMPONENTS.map((c) => ({ key: c.key, label: c.label, weight: c.weight, weightPct: Math.round(c.weight * 100), link: c.link, formula: c.formula, ...parts[c.key] }));
  const included = components.filter((c) => c.excluded == null && c.score != null);
  const usedWeight = ledger.sum(included.map((c) => c.weight), { label: 'weight of the components with data', dp: 4 });
  const overall = included.length ? ledger.weightedMean(included.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score: c.score })), { label: 'overall score' }) : null;
  for (const c of components) {
    c.included = c.excluded == null && c.score != null;
    c.effectiveWeight = c.included && usedWeight ? Math.round((c.weight / usedWeight) * 1000) / 1000 : 0;
  }

  const renormalised = included.length < COMPONENTS.length;
  return {
    metric: { id: METRIC_ID, version: VERSION },
    period: input.period,
    overall: { score: overall, band: bandOf(overall) },
    components,
    excluded: components.filter((c) => !c.included).map((c) => ({ key: c.key, label: c.label, reason: c.excluded })),
    weighting: {
      renormalised,
      usedWeight,
      note: renormalised
        ? `${COMPONENTS.length - included.length} component(s) had no data and were left out; the other ${included.length} were re-weighted to add up to 100% (they carried ${Math.round(usedWeight * 100)}% of the full weight).`
        : 'Every component had data; the standard weights apply.',
    },
    coverage: {
      tests: coverage,
      attendance: parts.attendance.coverage ?? 'no days marked',
      assignments: parts.assignments.coverage ?? 'none due',
    },
    howCalculated: [
      'Overall = the weighted average of the components that have data: Σ(weight × component score) ÷ Σ(weights used).',
      ...included.map((c) => c.formula),
      `Bands: ${BANDS.map((b) => `${b.label} ${b.min}+`).join(', ')}.`,
    ],
    calculations: ledger.entries,
  };
}
