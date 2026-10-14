import { registerMetric } from '../catalogue.js';
import { Section, Grade, Subject, SubjectOffering } from '../../../models/academics.model.js';
import { AttendanceRecord } from '../../../models/attendanceRecord.model.js';
import { Exam, ExamSubject, Mark } from '../../../models/exam.model.js';
import { CourseModule } from '../../../models/courseModule.model.js';
import { Assignment, Submission } from '../../../models/assignment.model.js';
import { DAY, earliest, pct, oid, asOf, onRollAt, enrolmentIdsForSections } from './helpers.js';

/**
 * Academics. Every metric here is scope-aware: a teacher holding the
 * workspace at OWN scope sees only the sections they teach or lead.
 */

/** Attendance is stored per local calendar day at UTC midnight; the period's local dates map onto those keys. */
const dayKeys = (p) => {
  const [fy, fm, fd] = p.from.split('-').map(Number);
  const [ty, tm, td] = p.to.split('-').map(Number);
  return { $gte: new Date(Date.UTC(fy, fm - 1, fd)), $lt: new Date(Date.UTC(ty, tm - 1, td) + DAY) };
};

const ATTENDED = { PRESENT: 1, LATE: 1, HALF_DAY: 0.5, ABSENT: 0 };
const ATTENDANCE_RULE = 'Day registers only. Present and late count as attended, half day as half; absent counts against; excused days and unmarked days are left out of both numerator and denominator.';

async function attendanceRows(ctx, p = ctx.period) {
  const ids = await enrolmentIdsForSections(ctx, ctx.scope.sectionIds);
  const filter = { periodNo: null, date: dayKeys(p), ...(ids ? { enrollmentId: { $in: ids } } : {}) };
  return ctx.memo(`att:${p.from}:${p.to}`, () => AttendanceRecord.find(filter).select('enrollmentId date status').lean());
}

const attendanceSince = (ctx) => ctx.memo('attSince', () => earliest(AttendanceRecord, 'date'));

function rate(rows) {
  let attended = 0; let eligible = 0;
  for (const r of rows) {
    if (!(r.status in ATTENDED)) continue;
    eligible += 1; attended += ATTENDED[r.status];
  }
  return { attended, eligible, value: pct(attended, eligible) };
}

registerMetric({
  key: 'academics.attendance_rate', department: 'academics', label: 'Attendance rate', headline: true, trend: true, scopeAware: true,
  definition: `Attended pupil-days divided by eligible pupil-days. ${ATTENDANCE_RULE}`,
  numerator: 'Attended pupil-days', denominator: 'Eligible (marked, not excused) pupil-days',
  unit: 'percent', kind: 'flow', dateBasis: 'Register date', sources: ['AttendanceRecord'], link: '/attendance', version: 1,
  since: attendanceSince,
  compute: async (ctx) => {
    const rows = await attendanceRows(ctx);
    const r = rate(rows);
    return { value: r.value, records: rows.length, detail: { attended: r.attended, eligible: r.eligible }, note: r.eligible ? null : 'No registers marked in the period.' };
  },
  series: async (ctx, list) => {
    const rows = await attendanceRows(ctx);
    return list.map((b) => {
      const k = dayKeys(b);
      return rate(rows.filter((r) => r.date >= k.$gte && r.date < k.$lt)).value;
    });
  },
});

registerMetric({
  key: 'academics.chronic_absence', department: 'academics', label: 'Pupils below 90% attendance', scopeAware: true,
  definition: `Pupils with at least 5 eligible register days in the period whose attendance rate was below 90%. ${ATTENDANCE_RULE}`,
  numerator: 'Pupils under 90%', denominator: 'Pupils with 5 or more eligible days',
  unit: 'count', kind: 'flow', dateBasis: 'Register date', sources: ['AttendanceRecord'], link: '/attendance', version: 1,
  since: attendanceSince,
  compute: async (ctx) => {
    const rows = await attendanceRows(ctx);
    const by = new Map();
    for (const r of rows) { const k = String(r.enrollmentId); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    let counted = 0; let below = 0;
    for (const list of by.values()) {
      const r = rate(list);
      if (r.eligible < 5) continue;
      counted += 1;
      if (r.value < 90) below += 1;
    }
    return { value: counted ? below : null, records: rows.length, detail: { pupilsCounted: counted, sharePct: pct(below, counted) }, note: counted ? null : 'No pupil has 5 marked days in the period.' };
  },
});

async function offeringLabels(ctx) {
  return ctx.memo('offeringLabels', async () => {
    const [offerings, subjects, sections, grades] = await Promise.all([
      SubjectOffering.find({}).select('sectionId subjectId').lean(), Subject.find({}).select('name').lean(),
      Section.find({}).select('gradeId name').lean(), Grade.find({}).select('name').lean(),
    ]);
    const sub = new Map(subjects.map((s) => [String(s._id), s.name]));
    const gr = new Map(grades.map((g) => [String(g._id), g.name]));
    const sec = new Map(sections.map((s) => [String(s._id), `${gr.get(String(s.gradeId)) ?? ''} ${s.name}`.trim()]));
    return new Map(offerings.map((o) => [String(o._id), { subject: sub.get(String(o.subjectId)) ?? 'Subject', class: sec.get(String(o.sectionId)) ?? 'Class', sectionId: String(o.sectionId) }]));
  });
}

registerMetric({
  key: 'academics.exam_average', department: 'academics', label: 'Average exam score', headline: true, scopeAware: true,
  definition: 'Mean percentage (marks ÷ maximum marks) over published marks of exam papers sat in the period. Draft and in-review marks are excluded, as are absentees. The breakdown is by class and subject; it is not a teacher ranking.',
  numerator: 'Sum of percentage scores', denominator: 'Published, non-absent marks',
  unit: 'percent', kind: 'flow', dateBasis: 'Paper date (or the exam start when a paper has no date)', sources: ['Exam', 'ExamSubject', 'Mark'], link: '/exams', version: 1,
  since: (ctx) => ctx.memo('examSince', () => earliest(Exam, 'startsOn')),
  compute: async (ctx) => {
    const exams = await Exam.find({ startsOn: { $lt: ctx.period.end } }).select('startsOn').lean();
    const examStart = new Map(exams.map((e) => [String(e._id), e.startsOn]));
    const papers = (await ExamSubject.find({ examId: { $in: exams.map((e) => e._id) } }).select('examId subjectOfferingId examDate maxMarks').lean())
      .filter((p) => { const d = new Date(p.examDate ?? examStart.get(String(p.examId))); return d >= ctx.period.start && d < ctx.period.end; });
    const labels = await offeringLabels(ctx);
    const scoped = ctx.scope.sectionIds ? papers.filter((p) => ctx.scope.sectionIds.includes(labels.get(String(p.subjectOfferingId))?.sectionId)) : papers;
    if (!scoped.length) return { value: null, records: 0, note: 'No exam papers in the period.' };
    const marks = await Mark.find({ examSubjectId: { $in: scoped.map((p) => p._id) }, status: 'PUBLISHED', absence: null, marks: { $ne: null } }).select('examSubjectId marks').lean();
    const paper = new Map(scoped.map((p) => [String(p._id), p]));
    let total = 0;
    const groups = new Map();
    for (const m of marks) {
      const p = paper.get(String(m.examSubjectId));
      const score = (m.marks / (p.maxMarks || 100)) * 100;
      total += score;
      const l = labels.get(String(p.subjectOfferingId));
      const key = `${l?.class ?? '?'} · ${l?.subject ?? '?'}`;
      const g = groups.get(key) ?? { sum: 0, n: 0 };
      g.sum += score; g.n += 1; groups.set(key, g);
    }
    return {
      value: marks.length ? Math.round((total / marks.length) * 10) / 10 : null, records: marks.length,
      breakdown: [...groups.entries()].map(([label, g]) => ({ label, value: Math.round((g.sum / g.n) * 10) / 10, count: g.n })).sort((a, b) => a.label.localeCompare(b.label)),
      note: marks.length ? null : 'No published marks for the papers in the period.',
    };
  },
});

registerMetric({
  key: 'academics.syllabus_coverage', department: 'academics', label: 'Syllabus topics covered', scopeAware: true,
  definition: 'Topics recorded as done by the end of the period, divided by all topics in modules planned to start by then. Taken from what teachers record, never inferred from the timetable.',
  numerator: 'Topics done by the cut-off', denominator: 'Topics in modules planned to start by the cut-off',
  unit: 'percent', kind: 'stock', dateBasis: 'Topic completion date, as of the period end', sources: ['CourseModule'], link: '/syllabus', version: 1,
  since: (ctx) => ctx.memo('modSince', () => earliest(CourseModule, 'plannedStart')),
  compute: async (ctx) => {
    const filter = { plannedStart: { $lt: ctx.period.end }, ...(ctx.scope.sectionIds ? { sectionId: { $in: ctx.scope.sectionIds.map(oid) } } : {}) };
    const mods = await CourseModule.find(filter).select('topics').lean();
    const cut = asOf(ctx.period);
    let total = 0; let done = 0;
    for (const m of mods) for (const t of m.topics ?? []) { total += 1; if (t.done && (!t.doneAt || new Date(t.doneAt) <= cut)) done += 1; }
    return { value: pct(done, total), records: mods.length, detail: { topicsDone: done, topicsPlanned: total }, note: total ? null : 'No modules planned yet.' };
  },
});

registerMetric({
  key: 'academics.assignment_completion', department: 'academics', label: 'Homework completion', scopeAware: true,
  definition: 'Submissions handed in (submitted, late or graded) for assignments due in the period, divided by the pupils on roll in each class on the due date, less exemptions.',
  numerator: 'Submitted, late or graded submissions', denominator: 'Pupils on roll at the due date, minus exempt',
  unit: 'percent', kind: 'flow', dateBasis: 'Assignment due date', sources: ['Assignment', 'Submission', 'Enrollment'], link: '/assignments', version: 1,
  since: (ctx) => ctx.memo('asgSince', () => earliest(Assignment, 'dueAt')),
  compute: async (ctx) => {
    const labels = await offeringLabels(ctx);
    let list = await Assignment.find({ deletedAt: null, dueAt: { $gte: ctx.period.start, $lt: ctx.period.end } }).select('subjectOfferingId dueAt').lean();
    if (ctx.scope.sectionIds) list = list.filter((a) => ctx.scope.sectionIds.includes(labels.get(String(a.subjectOfferingId))?.sectionId));
    if (!list.length) return { value: null, records: 0, note: 'No assignments due in the period.' };
    const subs = await Submission.find({ assignmentId: { $in: list.map((a) => a._id) } }).select('assignmentId status').lean();
    let expected = 0; let done = 0;
    for (const a of list) {
      const sectionId = labels.get(String(a.subjectOfferingId))?.sectionId;
      // eslint-disable-next-line no-await-in-loop -- memoised per academic year
      const { rows } = await onRollAt(ctx, new Date(a.dueAt), { sectionIds: sectionId ? [sectionId] : [] });
      const mine = subs.filter((s) => String(s.assignmentId) === String(a._id));
      expected += Math.max(0, rows.length - mine.filter((s) => s.status === 'EXEMPT').length);
      done += mine.filter((s) => ['SUBMITTED', 'LATE', 'GRADED'].includes(s.status)).length;
    }
    return { value: pct(Math.min(done, expected), expected), records: subs.length, detail: { assignments: list.length, expected, handedIn: done } };
  },
});
