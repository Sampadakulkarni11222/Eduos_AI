import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { detectOperation, detectEntity, subjectFromText, topicFromText } from '../src/modules/ai/agent/entityIntent.js';
import { nameFromText, nameSimilarity } from '../src/utils/peopleNames.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, todayKey, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Teacher Ask AI: operation × entity × scope, end to end.
 *
 * Six manual-testing failures, each a different way the sentence was taken
 * apart and half of it thrown away:
 *
 *   "Show attendance for July"            → "Which student?"
 *   "Arav Mishra"                          → generic fallback
 *   "Show marks for Class 5-A"             → ONE pupil's report card
 *   "Show Mathematics homework"            → the caller's pending work
 *   "Add Mathematics homework for 5-A: …"  → a list of existing homework
 *   "Aarav Mishra's attendance"            → matched the surname only
 *
 * These tests are written per DIMENSION — operation, entity, scope, argument —
 * not per sentence, and every block includes wordings that appear nowhere in
 * the implementation.
 */

let api;
let school;
let extra;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();

  extra = await inSchool(OAK, async () => {
    const teacherId = school.people.TEACHER.profile._id;

    const grade5 = await Grade.create({ name: 'Class 5', level: 5 });
    const c5a = await Section.create({ gradeId: grade5._id, name: 'A', classTeacherId: teacherId });
    // A real class this teacher has nothing to do with.
    const grade9 = await Grade.create({ name: 'Class 9', level: 9 });
    const c9b = await Section.create({ gradeId: grade9._id, name: 'B' });

    const enrol = async (admissionNo, firstName, lastName, section, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };

    // Two Mishras, so a surname alone is genuinely ambiguous and an exact full
    // name has to win.
    const aarav = await enrol('OAK-51', 'Aarav', 'Mishra', c5a, 1);
    const ananya = await enrol('OAK-52', 'Ananya', 'Mishra', c5a, 2);
    const kabir = await enrol('OAK-53', 'Kabir', 'Rao', c5a, 3);
    const outsider = await enrol('OAK-91', 'Ishaan', 'Bose', c9b, 1);

    await AttendanceRecord.create({ enrollmentId: aarav.enrollment._id, date: todayKey(), periodNo: null, status: 'PRESENT' });
    await AttendanceRecord.create({ enrollmentId: ananya.enrollment._id, date: todayKey(), periodNo: null, status: 'ABSENT' });

    // Mathematics and Science, both taught by this teacher in Class 5 A.
    const term = await Term.create({
      academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
    });
    const maths = await Subject.create({ name: 'Mathematics' });
    const science = await Subject.create({ name: 'Science' });
    const mathsOffering = await SubjectOffering.create({ sectionId: c5a._id, subjectId: maths._id, termId: term._id, teacherId });
    const scienceOffering = await SubjectOffering.create({ sectionId: c5a._id, subjectId: science._id, termId: term._id, teacherId });

    await Assignment.create({ subjectOfferingId: mathsOffering._id, title: 'Fractions worksheet', dueAt: new Date(Date.now() + 6 * 864e5) });
    await Assignment.create({ subjectOfferingId: scienceOffering._id, title: 'Plant cell diagram', dueAt: new Date(Date.now() + 3 * 864e5) });

    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-09-05') });
    const mathsPaper = await ExamSubject.create({ examId: exam._id, subjectOfferingId: mathsOffering._id, maxMarks: 50 });
    await Mark.create({ examSubjectId: mathsPaper._id, enrollmentId: aarav.enrollment._id, marks: 45, status: 'PUBLISHED' });
    await Mark.create({ examSubjectId: mathsPaper._id, enrollmentId: ananya.enrollment._id, marks: 30, status: 'PUBLISHED' });

    return { grade5, c5a, c9b, aarav, ananya, kabir, outsider, mathsOffering, mathsPaper };
  });
});

const teacher = () => school.people.TEACHER;
const asTeacher = (msg) => parseIntent(msg, teacher().actor);

async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return { tool: entry?.action?.replace(/^agent\./, '') ?? null, args: entry?.after?.request ?? null, status: entry?.after?.status ?? null };
}

function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [/read-only/i, /\bget_[a-z_]+\b/, /\bgenerate_homework\b/, /inputSchema/i, /additionalProperties/i, /subjectOfferingId/i, /enrollmentId/i]) {
    expect(reply, `leaked catalog metadata: ${leak}`).not.toMatch(leak);
  }
}

/* ── 1. The dimensions themselves ─────────────────────────── */

describe('1. operation, entity, subject and topic are read from the sentence', () => {
  it('reads the operation from verb stems, including inflections', () => {
    for (const [msg, op] of [
      ['Add Mathematics homework for Class 5-A', 'CREATE'],
      ['adding homework tomorrow', 'CREATE'],
      ['Assign Mathematics homework to Class 5-A', 'CREATE'],
      ['Create Mathematics homework', 'CREATE'],
      ['Show Mathematics homework', 'GET'],
      ['What Mathematics homework did I give Class 5-A?', 'GET'],
      ['change the homework', 'UPDATE'],
      ['delete that homework', 'DELETE'],
    ]) {
      expect(detectOperation(msg), msg).toBe(op);
    }
  });

  it('reads the entity', () => {
    expect(detectEntity('show attendance for July')).toBe('attendance');
    expect(detectEntity('show marks for Class 5-A')).toBe('marks');
    expect(detectEntity('Class 5-A Mathematics results')).toBe('marks');
    expect(detectEntity('show Mathematics homework')).toBe('homework');
    expect(detectEntity('what assignments have I given')).toBe('homework');
    expect(detectEntity('who is my class teacher')).toBeNull();
  });

  it('reads the subject without a list of subject names', () => {
    expect(subjectFromText('Show Mathematics homework', 'homework')).toBe('Mathematics');
    expect(subjectFromText('Show Mathematics marks for Class 5-A', 'marks')).toBe('Mathematics');
    expect(subjectFromText('Show Class 5-A Mathematics results', 'marks')).toBe('Mathematics');
    expect(subjectFromText('show marks in Geography', 'marks')).toBe('Geography');
    // Not a subject: a month, a class, or a filler word.
    expect(subjectFromText('Show July attendance', 'attendance')).toBeNull();
    expect(subjectFromText('Show the marks of students in Class 5-A', 'marks')).toBeNull();
  });

  it('reads the homework topic from a colon, quotes or "on"', () => {
    expect(topicFromText('Add Mathematics homework for Class 5-A: Solve the linear equations examples.'))
      .toBe('Solve the linear equations examples');
    expect(topicFromText('Assign homework on photosynthesis')).toBe('photosynthesis');
    expect(topicFromText('Create Mathematics homework for Class 5-A')).toBeNull();
  });
});

/* ── 2. Identity ──────────────────────────────────────────── */

describe('2. a full name is captured whole, and a near miss is offered', () => {
  it('captures the full name, not the surname', () => {
    expect(nameFromText("Show Aarav Mishra's attendance for today.")).toBe('Aarav Mishra');
    expect(nameFromText("Show Aarav's attendance today")).toBe('Aarav');
    expect(nameFromText('Show attendance for student Aarav Mishra')).toBe('Aarav Mishra');
    expect(nameFromText('Arav Mishra')).toBe('Arav Mishra');
  });

  it('does not mistake a pronoun, a month or a class for a name', () => {
    for (const msg of ['show my attendance', "show today's attendance", 'Show July attendance', 'Show attendance for Class 5-A']) {
      expect(nameFromText(msg), msg).toBeNull();
    }
  });

  it('scores a one-letter typo as close and a bare surname as not', () => {
    expect(nameSimilarity('Arav Mishra', 'Aarav Mishra')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Aarav Mishra', 'Ananya Mishra')).toBeLessThan(0.72);
  });

  it('an exact full name wins even when the surname is shared', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_student_attendance', { studentName: 'Aarav Mishra' });
    expect(res.success).toBe(true);
    expect(String(res.data.enrollmentId)).toBe(String(extra.aarav.enrollment._id));
  });

  it('a shared surname alone is refused as ambiguous, naming the candidates', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_student_attendance', { studentName: 'Mishra' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/more than one student matches/i);
    expect(res.error.message).toContain('Aarav Mishra');
    expect(res.error.message).toContain('Ananya Mishra');
  });

  it('a misspelling offers candidates and selects nobody', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_student_attendance', { studentName: 'Arav Mishra' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/did you mean/i);
    expect(res.error.message).toContain('Aarav Mishra');
    // Nothing was answered for anybody.
    expect(res.data ?? null).toBeNull();
  });

  it('a misspelling is never silently used for a WRITE', async () => {
    const res = await mcp(OAK, teacher().actor, 'mark_attendance', {
      students: [{ studentName: 'Arav Mishra', status: 'ABSENT' }],
    });
    expect(res.success).toBe(false);
    expect(res.action?.status).not.toBe('confirmation_required');
    const marked = await inSchool(OAK, () => AttendanceRecord.countDocuments({ enrollmentId: extra.aarav.enrollment._id, status: 'ABSENT' }));
    expect(marked).toBe(0);
  });

  it('an ambiguous surname is never used for a WRITE either', async () => {
    const res = await mcp(OAK, teacher().actor, 'mark_attendance', {
      students: [{ studentName: 'Mishra', status: 'ABSENT' }],
    });
    expect(res.success).toBe(false);
    expect(res.action?.status).not.toBe('confirmation_required');
  });

  it('a student outside the teacher\'s classes is not found', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_student_attendance', { studentName: 'Ishaan Bose' });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('OAK-91');
  });
});

/* ── 3. Attendance ────────────────────────────────────────── */

describe('3. attendance: month, class and student scopes stay distinct', () => {
  it('a month with no student is not a per-student question', () => {
    for (const msg of ['Show attendance for July', 'Show attendance in July', 'Show July attendance']) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).not.toBe('get_student_attendance');
      expect(intent?.tool, msg).toBe('get_attendance_statistics');
      expect(intent.args.month, msg).toMatch(/^\d{4}-07$/);
    }
  });

  it('a named class keeps the class, whether a month or a day is given', () => {
    // A class question stays class-level: routing this to the school/own-scope
    // summary would drop "Class 5-A" and answer something broader than asked.
    const monthly = asTeacher('Show July attendance for Class 5-A');
    expect(monthly.tool).toBe('get_attendance_roster');
    expect(monthly.args.className).toMatch(/5-?A/i);
    expect(monthly.args.month).toMatch(/^\d{4}-07$/);

    const daily = asTeacher('Show attendance for Class 5-A today');
    expect(daily.tool).toBe('get_attendance_roster');
    expect(daily.args.className).toMatch(/5-?A/i);
    expect(daily.args.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a named student keeps the per-student tool, with the date', () => {
    const intent = asTeacher("Show Aarav Mishra's attendance today.");
    expect(intent.tool).toBe('get_student_attendance');
    expect(intent.args.studentName).toBe('Aarav Mishra');
    // The day is carried in the arguments this tool actually declares.
    // get_student_attendance takes month/from/to and has no `date` property, so
    // one named day is the one-day range from..to. This used to assert `date`,
    // which the tool does not accept: validateArgs enforces
    // additionalProperties, so that call was refused outright as
    // "date is not a parameter of this tool" (INVALID_INPUT) rather than
    // answering about the wrong period. The resolver now fills the arguments a
    // capability declares rather than a fixed name.
    expect(intent.args.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(intent.args.to).toBe(intent.args.from);

    expect(asTeacher("Show Aarav's attendance today").args.studentName).toBe('Aarav');
  });

  it('answers a teacher\'s month question from their own classes', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_statistics', {});
    expect(res.success).toBe(true);
    expect(res.data.basis).toBe('MY_CLASSES');
    expect(res.data.marked).toBeGreaterThan(0);
    expect(res.speak).toMatch(/Across your classes/);
    expect(res.speak).not.toMatch(/which student/i);
    expectNoCatalogLeak(res.speak);
  });

  it('leaves the caller\'s own attendance alone', () => {
    expect(asTeacher('What is my attendance?')?.tool).toBe('get_attendance');
    expect(asTeacher('show my attendance for july')?.tool).toBe('get_attendance');
  });
});

/* ── 4. Class marks ───────────────────────────────────────── */

describe('4. marks for a class are class-level, never one pupil', () => {
  it('routes every class-marks phrasing to the class tool', () => {
    for (const msg of [
      'Show marks for Class 5-A',
      'Show Mathematics marks for Class 5-A',
      'Show Class 5-A Mathematics results',
      'Show the marks of students in Class 5-A',
      'Which students scored highest in Mathematics in Class 5-A?',
    ]) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('get_class_marks');
      expect(intent.args.className, msg).toBeTruthy();
    }
  });

  it('returns the class, with every student and the aggregate', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className: 'Class 5-A' });
    expect(res.success).toBe(true);
    expect(res.data.class).toBe('Class 5 A');
    const paper = res.data.subjects[0];
    expect(paper.subject).toBe('Mathematics');
    expect(paper.students).toBe(3);
    expect(paper.marked).toBe(2);
    expect(paper.highest).toBe(45);
    expect(paper.lowest).toBe(30);
    // Class-level: the answer names the class and an average, not one child.
    expect(res.speak).toMatch(/^Class 5 A —/);
    expect(res.speak).toMatch(/average/);
    expectNoCatalogLeak(res.speak);
  });

  it('never answers a class question with a single report card', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className: 'Class 5-A' });
    // The old failure read "Diya Sharma: 86% overall, grade A2, GPA 9."
    expect(res.speak).not.toMatch(/overall, grade/);
    expect(res.speak).not.toMatch(/GPA/);
  });

  it('narrows to one subject', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className: '5-A', subject: 'Mathematics' });
    expect(res.success).toBe(true);
    expect(res.data.subjects.map((s) => s.subject)).toEqual(['Mathematics']);

    const none = await mcp(OAK, teacher().actor, 'get_class_marks', { className: '5-A', subject: 'Geography' });
    expect(none.success).toBe(true);
    expect(none.data.subjects).toEqual([]);
    expect(none.speak).toMatch(/no exam papers/i);
  });

  it('resolves every spelling of the class to the same answer', async () => {
    for (const className of ['Class 5-A', 'Class 5 A', '5-A', 'class 5-a']) {
      const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className });
      expect(res.success, className).toBe(true);
      expect(res.data.class, className).toBe('Class 5 A');
    }
  });

  it('refuses a class the teacher does not teach, and leaks nothing about it', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className: 'Class 9-B' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('Class 9 B is not one of your classes.');
    expect(JSON.stringify(res)).not.toContain('Ishaan');
  });

  it('says so for a class that does not exist', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_class_marks', { className: 'Class 12-Z' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/could not find a class called/i);
  });

  it('cannot reach another school', async () => {
    const res = await mcp(RIVER, teacher().actor, 'get_class_marks', { className: 'Class 6-A' });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('Riverside');
  });

  it('leaves the per-student report card exactly as it was', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_report_card', { studentName: 'Aarav Mishra' });
    expect(res.success).toBe(true);
    expect(asTeacher("Show Aarav Mishra's marks")?.tool).toBe('get_report_card');
  });
});

/* ── 5. Homework ──────────────────────────────────────────── */

describe('5. homework: a teacher sees what they set, filtered', () => {
  it('routes subject and class homework reads to the assignments tool', () => {
    for (const [msg, expected] of [
      ['Show Mathematics homework', { subject: 'Mathematics' }],
      ['Show Mathematics homework for Class 5-A', { subject: 'Mathematics', className: /5-?A/i }],
      ['What Mathematics assignments have I given Class 5-A?', { subject: 'Mathematics' }],
      ['What Mathematics homework did I give Class 5-A?', { subject: 'Mathematics' }],
      ['Show assignments for Class 5-A', { className: /5-?A/i }],
    ]) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('get_assignments');
      if (expected.subject) expect(intent.args.subject, msg).toBe(expected.subject);
      if (expected.className) expect(intent.args.className, msg).toMatch(expected.className);
    }
  });

  it('gives a teacher the work they set in that subject, not another subject', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_assignments', { subject: 'Mathematics' });
    expect(res.success).toBe(true);
    expect(res.data.assignments.map((a) => a.title)).toEqual(['Fractions worksheet']);
    expect(JSON.stringify(res.data)).not.toContain('Plant cell diagram');
    expectNoCatalogLeak(res.speak);
  });

  it('filters by class as well', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_assignments', { className: 'Class 5-A' });
    expect(res.success).toBe(true);
    expect(res.data.class).toBe('Class 5 A');
    expect(res.data.count).toBe(2);
  });

  it('refuses a class the teacher does not teach', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_assignments', { className: 'Class 9-B' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/not one of your classes/i);
  });

  it('leaves the student\'s unfiltered pending list unchanged', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_assignments', {});
    expect(res.success).toBe(true);
    // Still the "what do I owe" shape: a status per row.
    for (const row of res.data.assignments) expect(row).toHaveProperty('status');
  });
});

describe('6. homework CREATE goes through the confirmation flow', () => {
  it('routes create verbs, including "add", to the create tool', () => {
    for (const msg of [
      'Add Mathematics homework for Class 5-A: Solve the linear equations examples.',
      'Create Mathematics homework for Class 5-A.',
      'Assign Mathematics homework to Class 5-A: Solve the linear equations examples.',
    ]) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('generate_homework');
      expect(intent.args.subject, msg).toBe('Mathematics');
      expect(intent.args.className, msg).toMatch(/5-?A/i);
    }
  });

  it('carries the topic through', () => {
    const intent = asTeacher('Add Mathematics homework for Class 5-A: Solve the linear equations examples.');
    expect(intent.args.topic).toBe('Solve the linear equations examples');
  });

  it('proposes before writing, and writes only after confirmation', async () => {
    const before = await inSchool(OAK, () => Assignment.countDocuments());
    const proposal = await mcp(OAK, teacher().actor, 'generate_homework', {
      subject: 'Mathematics', className: 'Class 5-A', topic: 'Solve the linear equations examples', dueAt: '2026-10-02',
    });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(await inSchool(OAK, () => Assignment.countDocuments())).toBe(before);

    const done = await mcp(OAK, teacher().actor, 'generate_homework', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success).toBe(true);
    expect(await inSchool(OAK, () => Assignment.countDocuments())).toBe(before + 1);

    const entry = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.generate_homework', 'after.status': 'EXECUTED' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.after.confirmed).toBe(true);
  });

  it('resolves the class canonically before finding the offering', async () => {
    for (const className of ['Class 5-A', 'class 5a', '5-A']) {
      const res = await mcp(OAK, teacher().actor, 'generate_homework', {
        subject: 'Mathematics', className, topic: 'Practice sums', dueAt: '2026-10-03',
      });
      expect(res.action?.status, className).toBe('confirmation_required');
    }
  });

  it('refuses a class the teacher does not teach, and writes nothing', async () => {
    const before = await inSchool(OAK, () => Assignment.countDocuments());
    const res = await mcp(OAK, teacher().actor, 'generate_homework', {
      subject: 'Mathematics', className: 'Class 9-B', topic: 'Anything', dueAt: '2026-10-04',
    });
    expect(res.success).toBe(false);
    expect(await inSchool(OAK, () => Assignment.countDocuments())).toBe(before);
  });

  it('is refused to a student', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'generate_homework', {
      subject: 'Mathematics', className: 'Class 5-A', topic: 'Anything', dueAt: '2026-10-05',
    });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
  });
});

/* ── 7. End to end ────────────────────────────────────────── */

describe('7. the six reported questions, over HTTP', () => {
  it('1 — "Show attendance for July" does not ask which student', async () => {
    const res = await api.ask(teacher(), 'Show attendance for July');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/which student/i);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall()).tool).toBe('get_attendance_statistics');
  });

  it('3 — "Show marks for Class 5-A." answers at class level', async () => {
    const res = await api.ask(teacher(), 'Show marks for Class 5-A.');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Class 5 A/);
    expect(res.reply).not.toMatch(/GPA/);
    expect((await lastCall()).tool).toBe('get_class_marks');
  });

  it('4 — "Show Mathematics homework." answers about Mathematics', async () => {
    const res = await api.ask(teacher(), 'Show Mathematics homework.');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Fractions worksheet/);
    expect(res.reply).not.toMatch(/Plant cell/);
    expect((await lastCall())).toMatchObject({ tool: 'get_assignments' });
  });

  it('5 — "Add Mathematics homework for Class 5-A: …" proposes a write', async () => {
    const res = await api.ask(teacher(), 'Add Mathematics homework for Class 5-A: Solve the linear equations examples.');
    expect(res.status).toBe(200);
    // Either a proposal, or a question about the due date — never a list of
    // existing homework.
    expect(res.reply).not.toMatch(/Plant cell|Fractions worksheet/);
    expect((await lastCall()).tool).toBe('generate_homework');
    expectNoCatalogLeak(res.reply);
  });

  it('6 — "Show Aarav Mishra\'s attendance for today." answers for Aarav', async () => {
    const res = await api.ask(teacher(), "Show Aarav Mishra's attendance for today.");
    expect(res.status).toBe(200);
    const call = await lastCall();
    expect(call.tool).toBe('get_student_attendance');
    expect(call.args.studentName).toBe('Aarav Mishra');
    expect(res.reply).not.toMatch(/more than one student/i);
  });

  it('2 — a bare misspelled name is looked up and offers candidates', async () => {
    const res = await api.ask(teacher(), 'Arav Mishra');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/I'?m not sure what you need/i);
    expect((await lastCall()).tool).toBe('search_students');
    expectNoCatalogLeak(res.reply);
  });

  it('2 — an exact bare name finds that student', async () => {
    const res = await api.ask(teacher(), 'Aarav Mishra');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Aarav Mishra/);
    expect((await lastCall()).tool).toBe('search_students');
  });
});
