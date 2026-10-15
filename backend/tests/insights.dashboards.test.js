import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { seedSchool, inSchool, OAK, todayKey } from './support/mcpSchool.js';
import express from 'express';
import { insightsRouter } from '../src/modules/campus/campus.routes.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { CourseModule } from '../src/models/courseModule.model.js';
import { roleDashboard, weekBuckets, MIN_CLASS_FOR_AVERAGE } from '../src/modules/insights/dashboards.service.js';

/**
 * Role dashboards: who sees what (own classes, own child, own record), the
 * class-average privacy floor, and that each figure is the one the records give.
 *
 * Fixture (support/mcpSchool.js): Class 6 A has Rahul (PARENT's son, absent
 * today), Priya (the STUDENT, present today) and Aman; TEACHER leads 6 A.
 * Class 6 B has Riya, who is nobody's child here and nobody's class.
 */

let school;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const chartOf = (d, key) => d.charts.find((c) => c.key === key);
const listOf = (d, key) => d.lists.find((l) => l.key === key);
const kpiOf = (d, key) => d.kpis.find((k) => k.key === key);

beforeEach(async () => { school = await seedSchool(); });

/** Two more pupils in 6 A, so the class reaches the size where an average may be shown. */
async function fillClassA() {
  return inOak(async () => {
    const out = [];
    for (const [no, first] of [['OAK-4', 'Kabir'], ['OAK-5', 'Meera']]) {
      const student = await Student.create({ admissionNo: no, firstName: first, lastName: 'Test' });
      out.push(await Enrollment.create({ studentId: student._id, sectionId: school.sectionA._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo: out.length + 4 }));
    }
    return out;
  });
}

/** One subject taught by TEACHER in 6 A, with one published test. */
async function mathsTest(scores) {
  return inOak(async () => {
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
    const subject = await Subject.create({ name: 'Maths' });
    const offering = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
    const exam = await Exam.create({ termId: term._id, name: 'PT1', startsOn: new Date(Date.now() - 10 * DAY), endsOn: new Date(Date.now() - 9 * DAY) });
    const paper = await ExamSubject.create({ examId: exam._id, subjectOfferingId: offering._id, maxMarks: 50, examDate: new Date(Date.now() - 10 * DAY) });
    for (const [enrollmentId, marks] of scores) await Mark.create({ examSubjectId: paper._id, enrollmentId, marks, status: 'PUBLISHED', publishedAt: new Date() });
    return { term, subject, offering, exam, paper };
  });
}

describe('parent: one child at a time, never another family\'s', () => {
  it('shows the linked child by default and lists only their own children', async () => {
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    expect(d.view).toBe('parent');
    expect(d.child).toMatchObject({ id: String(school.rahul.student._id), name: 'Rahul Sharma', className: 'Class 6 A' });
    expect(d.children.map((c) => c.name)).toEqual(['Rahul Sharma']);
    // Rahul was absent on the only register taken.
    expect(kpiOf(d, 'attendance')).toMatchObject({ value: 0, unit: 'percent' });
  });

  it('refuses a child who is not linked to the parent', async () => {
    await expect(inOak(() => roleDashboard(school.people.PARENT.actor, { child: String(school.riya.student._id) })))
      .rejects.toMatchObject({ statusCode: 403, code: 'CHILD_NOT_LINKED' });
  });

  it('switches between the parent\'s own children', async () => {
    await inOak(() => StudentGuardian.create({ studentId: school.riya.student._id, guardianProfileId: school.people.PARENT.profile._id, relation: 'FATHER' }));
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, { child: String(school.riya.student._id) }));
    expect(d.child.name).toBe('Riya Kapoor');
    expect(d.children.map((c) => c.name).sort()).toEqual(['Rahul Sharma', 'Riya Kapoor']);
  });

  it('hides the class average below five students and never names a classmate', async () => {
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    const att = chartOf(d, 'attendance');
    expect(att.compare).toBeNull();
    expect(att.compareNote).toMatch(/at least 5 students/);
    expect(d.child.classSize).toBeNull();
    const text = JSON.stringify(d);
    for (const other of ['Priya', 'Aman', 'Riya']) expect(text).not.toContain(other);
  });

  it('shows the class average once the class has five students, from the class register', async () => {
    const [kabir, meera] = await fillClassA();
    await inOak(() => AttendanceRecord.create([
      { enrollmentId: kabir._id, date: todayKey(), periodNo: null, status: 'PRESENT' },
      { enrollmentId: meera._id, date: todayKey(), periodNo: null, status: 'LATE' },
    ]));
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    expect(MIN_CLASS_FOR_AVERAGE).toBe(5);
    // Today: Rahul absent, Priya present, Kabir present, Meera late; Aman unmarked → 3 of 4.
    expect(chartOf(d, 'attendance').compare.label).toBe('Class average');
    expect(chartOf(d, 'attendance').compare.points.at(-1).value).toBe(75);
    expect(kpiOf(d, 'attendance').detail).toBe('class average 75%');
    expect(JSON.stringify(d)).not.toMatch(/Kabir|Meera|Priya/);
  });

  it('compares marks by subject with the class average only when five marks exist', async () => {
    const [kabir, meera] = await fillClassA();
    // Four marks: no class average even though the class has five students.
    const four = await mathsTest([[school.rahul.enrollment._id, 20], [school.priya.enrollment._id, 40], [school.aman.enrollment._id, 30], [kabir._id, 50]]);
    let d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    expect(chartOf(d, 'marksBySubject').points).toEqual([expect.objectContaining({ label: 'Maths', value: 40 })]);
    expect(chartOf(d, 'marksBySubject').compare).toBeNull();
    // The fifth mark: average of 20,40,30,50,10 = 30/50 = 60%.
    await inOak(() => Mark.create({ examSubjectId: four.paper._id, enrollmentId: meera._id, marks: 10, status: 'PUBLISHED' }));
    d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    expect(chartOf(d, 'marksBySubject').compare.points).toEqual([{ label: 'Maths', value: 60 }]);
    expect(chartOf(d, 'marksTrend').points).toEqual([expect.objectContaining({ label: 'PT1', value: 40 })]);
    expect(chartOf(d, 'marksTrend').variants.map((v) => v.label)).toEqual(['All subjects', 'Maths']);
    expect(kpiOf(d, 'marks').value).toBe(40);
  });

  it('ignores marks that are not published', async () => {
    const t = await mathsTest([]);
    await inOak(() => Mark.create({ examSubjectId: t.paper._id, enrollmentId: school.rahul.enrollment._id, marks: 45, status: 'DRAFT' }));
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    expect(chartOf(d, 'marksBySubject').status).toBe('EMPTY');
  });

  it('counts the child\'s assignments as on time, late, missing and due', async () => {
    const t = await mathsTest([]);
    await inOak(async () => {
      const mk = (title, days) => Assignment.create({ subjectOfferingId: t.offering._id, title, dueAt: new Date(Date.now() + days * DAY) });
      const onTime = await mk('Fractions', -5); const late = await mk('Decimals', -4);
      await mk('Ratios', -3); await mk('Angles', 3);
      await Submission.create({ assignmentId: onTime._id, enrollmentId: school.rahul.enrollment._id, status: 'GRADED', submittedAt: new Date(Date.now() - 6 * DAY) });
      await Submission.create({ assignmentId: late._id, enrollmentId: school.rahul.enrollment._id, status: 'LATE', submittedAt: new Date(Date.now() - DAY) });
    });
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    const pts = Object.fromEntries(chartOf(d, 'assignments').points.map((p) => [p.label, p.value]));
    expect(pts).toMatchObject({ 'Handed in on time': 1, 'Handed in late': 1, Missing: 1, 'Due in the next 2 weeks': 1 });
    expect(listOf(d, 'assignmentsDue').items.map((i) => i.badge)).toEqual(['Missing', 'Due']);
  });

  it('shows the child\'s own fees: ₹8,000 overdue for Rahul, nothing of Aman\'s', async () => {
    const d = await inOak(() => roleDashboard(school.people.PARENT.actor, {}));
    const pts = Object.fromEntries(chartOf(d, 'fees').points.map((p) => [p.label, p.value]));
    expect(pts).toEqual({ Paid: 0, 'Due later': 0, Overdue: 800000 });
    expect(kpiOf(d, 'fees')).toMatchObject({ value: 800000, tone: 'bad' });
    expect(JSON.stringify(d)).not.toContain('INV-1002');
  });
});

describe('student: their own record', () => {
  it('shows only the student\'s own figures, with a present streak and no fees', async () => {
    const d = await inOak(() => roleDashboard(school.people.STUDENT.actor, {}));
    expect(d.view).toBe('student');
    expect(d.child.name).toBe('Priya Verma');
    expect(kpiOf(d, 'attendance').value).toBe(100);
    expect(kpiOf(d, 'streak')).toMatchObject({ value: 1, unit: 'days' });
    expect(chartOf(d, 'fees')).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/Rahul|Aman/);
  });

  it('ignores a child id: a student cannot ask for someone else', async () => {
    const d = await inOak(() => roleDashboard(school.people.STUDENT.actor, { child: String(school.rahul.student._id) }));
    expect(d.child.name).toBe('Priya Verma');
  });
});

describe('teacher: their own classes', () => {
  it('counts students in classes they lead or teach, not other classes', async () => {
    const d = await inOak(() => roleDashboard(school.people.TEACHER.actor, {}));
    expect(d.view).toBe('teacher');
    expect(kpiOf(d, 'students')).toMatchObject({ value: 3, detail: '1 class' });
    expect(kpiOf(d, 'today')).toMatchObject({ value: 50, detail: '1 of 2 present' });
    expect(JSON.stringify(d)).not.toContain('Riya');
  });

  it('flags a student whose attendance is below the risk threshold, and only theirs', async () => {
    await inOak(async () => {
      for (let i = 1; i <= 5; i += 1) {
        await AttendanceRecord.create({ enrollmentId: school.aman.enrollment._id, date: new Date(todayKey().getTime() - i * DAY), periodNo: null, status: 'ABSENT' });
        await AttendanceRecord.create({ enrollmentId: school.riya.enrollment._id, date: new Date(todayKey().getTime() - i * DAY), periodNo: null, status: 'ABSENT' });
      }
    });
    const d = await inOak(() => roleDashboard(school.people.TEACHER.actor, {}));
    const items = listOf(d, 'attention').items;
    expect(items.map((i) => i.text)).toEqual(['Aman Gupta']);
    expect(items[0].sub).toMatch(/attendance 0% in 30 days/);
    expect(kpiOf(d, 'attention').value).toBe(1);
    expect(chartOf(d, 'attentionReasons').points[0]).toMatchObject({ label: 'Low attendance', value: 1 });
  });

  it('gives each assignment its hand-in rate from the class roll', async () => {
    const t = await mathsTest([]);
    await inOak(async () => {
      const a = await Assignment.create({ subjectOfferingId: t.offering._id, title: 'Fractions', dueAt: new Date(Date.now() - DAY) });
      await Submission.create({ assignmentId: a._id, enrollmentId: school.rahul.enrollment._id, status: 'SUBMITTED', submittedAt: new Date() });
      await Submission.create({ assignmentId: a._id, enrollmentId: school.priya.enrollment._id, status: 'GRADED', submittedAt: new Date() });
    });
    const d = await inOak(() => roleDashboard(school.people.TEACHER.actor, {}));
    expect(chartOf(d, 'submissions').points).toEqual([expect.objectContaining({ label: 'Fractions', value: 66.7, detail: expect.stringMatching(/^2 of 3 handed in · 0 late/) })]);
    expect(kpiOf(d, 'toGrade').value).toBe(1);
  });

  it('bands a test\'s marks', async () => {
    await mathsTest([[school.rahul.enrollment._id, 10], [school.priya.enrollment._id, 46], [school.aman.enrollment._id, 30]]);
    const d = await inOak(() => roleDashboard(school.people.TEACHER.actor, {}));
    const dist = chartOf(d, 'marksDistribution');
    expect(dist.variants).toHaveLength(1);
    expect(dist.variants[0].label).toBe('PT1 · Maths · Class 6 A');
    const band = Object.fromEntries(dist.points.map((p) => [p.label, p.value]));
    // 20%, 92%, 60%
    expect(band).toMatchObject({ 'Below 33%': 1, '50–64%': 1, '90% and above': 1, '33–49%': 0 });
  });

  it('measures syllabus coverage against the plan', async () => {
    const t = await mathsTest([]);
    await inOak(() => CourseModule.create({
      subjectOfferingId: t.offering._id, sectionId: school.sectionA._id, teacherId: school.people.TEACHER.profile._id, order: 1, title: 'Numbers',
      plannedStart: new Date(Date.now() - 20 * DAY), plannedEnd: new Date(Date.now() + 20 * DAY),
      topics: [{ title: 'a', done: true }, { title: 'b', done: false }, { title: 'c', done: false }, { title: 'd', done: false }], status: 'IN_PROGRESS',
    }));
    const d = await inOak(() => roleDashboard(school.people.TEACHER.actor, {}));
    const s = chartOf(d, 'syllabus');
    expect(s.points[0]).toMatchObject({ label: 'Maths · Class 6 A', value: 25 });
    expect(s.compare.points[0].value).toBeGreaterThan(40);
    expect(kpiOf(d, 'syllabus').value).toBe(25);
  });
});

describe('staff roles', () => {
  it('ages finance\'s outstanding invoices', async () => {
    const d = await inOak(() => roleDashboard(school.people.FINANCE.actor, {}));
    expect(d.view).toBe('finance');
    expect(d.period.options.map((o) => o.days)).toEqual([90, 180, 365]);
    const age = Object.fromEntries(chartOf(d, 'ageing').points.map((p) => [p.label, p.value]));
    expect(age).toMatchObject({ 'Not yet due': 500000, '1–30 days': 800000, '31–60 days': 0 });
    expect(kpiOf(d, 'overdue')).toMatchObject({ value: 800000 });
    // Riverside's invoice is another school's.
    expect(kpiOf(d, 'outstanding').value).toBe(1300000);
  });

  it('gives principal and admin no extra dashboard (they have the pulse board)', async () => {
    for (const r of ['PRINCIPAL', 'ADMIN']) {
      const d = await inOak(() => roleDashboard(school.people[r].actor, {}));
      expect(d.view).toBeNull();
    }
  });

  it('gives the librarian and warden their own queues', async () => {
    const lib = await inOak(() => roleDashboard(school.people.LIBRARIAN.actor, { days: 90 }));
    expect(lib.view).toBe('librarian');
    expect(lib.period.days).toBe(90);
    expect(chartOf(lib, 'issues').points).toHaveLength(13);
    const w = await inOak(() => roleDashboard(school.people.WARDEN.actor, {}));
    expect(w.view).toBe('warden');
    expect(chartOf(w, 'occupancy').status).toBe('EMPTY');
  });
});

describe('weeks', () => {
  it('covers the period in whole weeks ending today', () => {
    const today = new Date(Date.UTC(2026, 9, 15));
    const b = weekBuckets(30, today);
    expect(b).toHaveLength(5);
    expect(b.at(-1).end.getTime()).toBe(today.getTime() + DAY);
    expect(b[0].start.getTime()).toBe(today.getTime() + DAY - 35 * DAY);
  });
});

describe('over HTTP', () => {
  // Only the insights router, mounted as routes/index.js mounts it, behind a real socket.
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/insights', insightsRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  const get = async (person, path) => {
    const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': OAK } });
    return { status: res.status, body: await res.json() };
  };

  it('answers the parent for their child and refuses another child', async () => {
    const ok = await get(school.people.PARENT, '/insights/dashboard?days=90');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ view: 'parent', period: { days: 90 } });
    const no = await get(school.people.PARENT, `/insights/dashboard?child=${school.riya.student._id}`);
    expect(no.status).toBe(403);
    const bad = await get(school.people.PARENT, '/insights/dashboard?child=not-an-id');
    expect(bad.status).toBe(400);
  });
});
