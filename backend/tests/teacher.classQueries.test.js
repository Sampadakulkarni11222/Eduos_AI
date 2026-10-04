import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { classKey, classFromText } from '../src/utils/classNames.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, todayKey, OAK, RIVER } from './support/mcpSchool.js';

/**
 * A teacher asking about a class.
 *
 * Manual staging testing found every class-level question falling through to a
 * per-student tool, a subject lookup, or the student directory:
 *
 *   "How many students are in Class 5-A?"   → No students match "Class 5-A"
 *   "Show me the students in Class 5-A."    → tool descriptions
 *   "What classes do I teach?"              → "You have 7 subject(s): ..."
 *   "Show the attendance of Class 5-A."     → "Which student?"
 *   "Who is absent in Class 5-A today?"     → tool descriptions
 *
 * Three separate causes, all pinned below: the class rules did not exist (so a
 * named class reached the student directory), `get_subjects` owned the phrase
 * "what classes", and nothing normalised a class name — the hyphen in
 * "Class 5-A" alone was enough to match nothing against the stored "Class 5 A".
 *
 * For each question this checks the whole chain: the intent the rules pick, the
 * MCP tool and arguments that actually ran (read back from the server's own
 * audit entry), the scope enforced, the database result, and the sentence the
 * teacher sees. Authorization is never relaxed to make a case pass: an
 * out-of-scope class is refused by name, and nothing about it is disclosed.
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
    const enrol = async (admissionNo, firstName, lastName, section, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };

    // Class 5 A — this teacher is the class teacher, mirroring the staging UI.
    const grade5 = await Grade.create({ name: 'Class 5', level: 5 });
    const c5a = await Section.create({
      gradeId: grade5._id, name: 'A', classTeacherId: school.people.TEACHER.profile._id,
    });
    const five = [
      await enrol('OAK-51', 'Aarav', 'Nair', c5a, 1),
      await enrol('OAK-52', 'Diya', 'Sharma', c5a, 2),
      await enrol('OAK-53', 'Kabir', 'Rao', c5a, 3),
    ];
    // Today's register for Class 5 A: one absent, one present, one unmarked.
    await AttendanceRecord.create({ enrollmentId: five[1].enrollment._id, date: todayKey(), periodNo: null, status: 'ABSENT' });
    await AttendanceRecord.create({ enrollmentId: five[0].enrollment._id, date: todayKey(), periodNo: null, status: 'PRESENT' });

    // Class 9 B — a real class this teacher has nothing to do with.
    const grade9 = await Grade.create({ name: 'Class 9', level: 9 });
    const c9b = await Section.create({ gradeId: grade9._id, name: 'B' });
    const nine = [await enrol('OAK-91', 'Ishaan', 'Bose', c9b, 1)];

    return { grade5, c5a, five, grade9, c9b, nine };
  });
});

const teacher = () => school.people.TEACHER;

/** The newest MCP call: the tool that ran, its arguments and how it ended. */
async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return {
    tool: entry?.action?.replace(/^agent\./, '') ?? null,
    args: entry?.after?.request ?? null,
    status: entry?.after?.status ?? null,
    actor: String(entry?.actorProfileId ?? ''),
  };
}

/**
 * Nothing in a reply may come from the tool catalog.
 *
 * These are the exact fragments that reached the chat window: descriptions end
 * in "Read-only.", name other tools, and enumerate `include` fields and id
 * shapes.
 */
function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [
    /read-only/i, /\bget_[a-z_]+\b/, /\bsearch_students\b/, /\binputSchema\b/,
    /enrolment id/i, /enrollment id/i, /admission number or name/i,
    /\binclude\b\s*[`:]/i, /personal-data access/i, /narrower tool/i,
  ]) {
    expect(reply, `leaked catalog metadata: ${leak}`).not.toMatch(leak);
  }
}

/* ── 1. Intent ────────────────────────────────────────────── */

describe('1. intent — a class question is a class question', () => {
  const asTeacher = (msg) => parseIntent(msg, teacher().actor);

  it('routes the roll-count and student-list questions to the student tool with the class as the query', () => {
    for (const msg of ['How many students are in Class 5-A?', 'Show me the students in Class 5-A.']) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('search_students');
      expect(classKey(intent.args.query), msg).toBe('5 a');
    }
  });

  it('routes "what classes do I teach" to the classes tool, NOT subjects', () => {
    for (const msg of ['What classes do I teach?', 'Which classes am I assigned to?', 'what classes do i handle']) {
      expect(asTeacher(msg)?.tool, msg).toBe('get_my_classes');
    }
  });

  it('keeps the subjects question distinct', () => {
    expect(asTeacher('What subjects do I teach?')?.tool).toBe('get_subjects');
    expect(asTeacher('what do i study')?.tool).toBe('get_subjects');
  });

  it('routes class attendance and class absence to the class register', () => {
    for (const msg of ['Show the attendance of Class 5-A.', 'Who is absent in Class 5-A today?']) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('get_attendance_roster');
      expect(classKey(intent.args.className), msg).toBe('5 a');
    }
  });

  it('understands every way a teacher writes the class name', () => {
    for (const written of ['Class 5-A', 'Class 5 A', 'class 5-a', '5-A', 'CLASS 5-A', 'Class 5 Section A']) {
      const intent = asTeacher(`how many students are in ${written}?`);
      expect(intent?.tool, written).toBe('search_students');
      expect(classKey(intent.args.query), written).toBe('5 a');
    }
  });

  it('handles "my class" and "my classes"', () => {
    for (const msg of ['students in my class', 'show me the students in my classes']) {
      const intent = asTeacher(msg);
      expect(intent?.tool, msg).toBe('search_students');
      expect(intent.args.query, msg).toBe('my classes');
    }
  });

  it('leaves school-wide questions alone', () => {
    // No class named, so the class rules must not claim these.
    expect(asTeacher('how many students are in the school?')?.tool).not.toBe('get_attendance_roster');
    // get_absent_students, not who_is_absent_today: the catalog derives that
    // the two front the same service (attendance.getDailyAbsenceSummary) and
    // marks the wrapped legacy name as superseded by the native one. Routing
    // now honours that, so the canonical capability is what a school-wide
    // absence question reaches. Same service, same figures, one name.
    expect(parseIntent('who is absent today?', school.people.ADMIN.actor)?.tool).toBe('get_absent_students');
  });

  it('canonicalises class names', () => {
    for (const written of ['Class 5-A', 'class 5a', '5-A', 'Class 5 A', ' CLASS  5  -  A ']) {
      expect(classKey(written), written).toBe('5 a');
    }
    expect(classFromText('How many students are in Class 10-A?').key).toBe('10 a');
    // Not a class reference at all.
    expect(classFromText('show my attendance')).toBeNull();
    expect(classKey('Rahul Sharma')).toBe('rahul sharma');
  });
});

/* ── 2. Through MCP, as the teacher ───────────────────────── */

describe('2. the class roll, through MCP', () => {
  it('counts Class 5 A at the teacher\'s own scope', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'Class 5-A' });
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(3);
    expect(res.data.class).toBe('Class 5 A');
    expect(res.speak).toMatch(/^Class 5 A has 3 student\(s\)/);
    expectNoCatalogLeak(res.speak);
  });

  it('answers the same for every spelling of the class', async () => {
    for (const written of ['Class 5-A', 'Class 5 A', 'class 5-a', '5-A']) {
      const res = await mcp(OAK, teacher().actor, 'search_students', { query: written });
      expect(res.success, written).toBe(true);
      expect(res.data.total, written).toBe(3);
      expect(res.data.class, written).toBe('Class 5 A');
    }
  });

  it('lists the students of the class', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'students in Class 5-A' });
    expect(res.success).toBe(true);
    expect(res.data.students.map((s) => s.admissionNo).sort()).toEqual(['OAK-51', 'OAK-52', 'OAK-53']);
  });

  it('answers "my classes" with the teacher\'s own students and nobody else\'s', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'my classes' });
    expect(res.success).toBe(true);
    // Class 5 A (3) plus the fixture's Class 6 A (3) — never Class 9 B.
    const admissionNos = res.data.students.map((s) => s.admissionNo);
    expect(admissionNos).toContain('OAK-51');
    expect(admissionNos).toContain('OAK-1');
    expect(admissionNos).not.toContain('OAK-91');
  });
});

describe('3. the class register, through MCP', () => {
  it('answers class attendance without asking which student', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { className: 'Class 5-A' });
    expect(res.success).toBe(true);
    expect(res.data.count).toBe(3);
    expect(res.data.marked).toBe(2);
    expect(res.data.class).toBe('Class 5 A');
    expect(res.speak).not.toMatch(/which student/i);
    expectNoCatalogLeak(res.speak);
  });

  it('names who is absent', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { className: '5-A' });
    expect(res.success).toBe(true);
    expect(res.data.absent).toEqual(['Diya Sharma']);
    expect(res.speak).toMatch(/1 absent — Diya Sharma/);
  });

  it('still accepts a section id, as it always did', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { sectionId: String(school.sectionA._id) });
    expect(res.success).toBe(true);
    expect(res.data.count).toBe(3);
  });

  it('asks which class when none is named, in plain words', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', {});
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('Which class? Name it, for example "Class 5 A".');
    expectNoCatalogLeak(res.error.message);
  });
});

/* ── 4. Scope and existence ───────────────────────────────── */

describe('4. a class the teacher does not teach', () => {
  it('is refused by name, and nothing about it is disclosed', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'Class 9-B' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('Class 9 B is not one of your classes.');
    // No roll count, no student, no ids.
    const body = JSON.stringify(res);
    expect(body).not.toContain('Ishaan');
    expect(body).not.toContain('OAK-91');
    expect(body).not.toContain(String(extra.c9b._id));
  });

  it('is refused for the register too', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { className: 'Class 9-B' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('Class 9 B is not one of your classes.');
    expect(JSON.stringify(res)).not.toContain('Ishaan');
  });

  it('is refused when the section id is supplied directly', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { sectionId: String(extra.c9b._id) });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('Ishaan');
  });

  it('but an administrator may read it', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'search_students', { query: 'Class 9-B' });
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(1);
  });
});

describe('5. a class that does not exist', () => {
  it('says so, rather than claiming the class is empty', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'Class 10-A' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('I could not find a class called "Class 10-A".');
    // The reported wording, which blamed the roll for a resolution failure.
    expect(res.error.message).not.toMatch(/no students match/i);
  });

  it('says so for the register too', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_attendance_roster', { className: 'Class 12-Z' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/could not find a class called/i);
  });

  it('a name that is not a class still searches for a person', async () => {
    const res = await mcp(OAK, teacher().actor, 'search_students', { query: 'Nobody' });
    expect(res.success).toBe(true);
    expect(res.data.students).toEqual([]);
    expect(res.speak).toMatch(/no students match/i);
  });
});

describe('6. tenant isolation is unchanged', () => {
  it('a teacher cannot reach another school\'s class', async () => {
    // Riverside has its own Class 6 A; the Oakridge teacher must not resolve it.
    const res = await mcp(RIVER, teacher().actor, 'search_students', { query: 'Class 6-A' });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('Riverside');
  });
});

/* ── 7. End to end, the six reported questions ────────────── */

describe('7. the six reported questions, over HTTP', () => {
  it('A — "How many students are in Class 5-A?" answers the roll', async () => {
    const res = await api.ask(teacher(), 'How many students are in Class 5-A?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/^\*\*Class 5 A has 3 students\*\*/);
    expectNoCatalogLeak(res.reply);
    const call = await lastCall();
    expect(call).toMatchObject({ tool: 'search_students', status: 'READ', actor: teacher().actor.profileId });
  });

  it('B — "Show me the students in Class 5-A." lists them', async () => {
    const res = await api.ask(teacher(), 'Show me the students in Class 5-A.');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Aarav|Diya|Kabir/);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall()).tool).toBe('search_students');
  });

  it('C — "What classes do I teach?" answers with classes, not subjects', async () => {
    const res = await api.ask(teacher(), 'What classes do I teach?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Class 5 A/);
    expect(res.reply).not.toMatch(/subject/i);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall()).tool).toBe('get_my_classes');
  });

  it('D — "Which classes am I assigned to?" likewise', async () => {
    const res = await api.ask(teacher(), 'Which classes am I assigned to?');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/subject/i);
    expect((await lastCall()).tool).toBe('get_my_classes');
  });

  it('E — "What subjects do I teach?" still answers with subjects', async () => {
    const res = await api.ask(teacher(), 'What subjects do I teach?');
    expect(res.status).toBe(200);
    expect((await lastCall()).tool).toBe('get_subjects');
  });

  it('F — "Show the attendance of Class 5-A." answers at class level', async () => {
    const res = await api.ask(teacher(), 'Show the attendance of Class 5-A.');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/which student/i);
    expect(res.reply).toMatch(/Class 5 A/);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall()).tool).toBe('get_attendance_roster');
  });

  it('G — "Who is absent in Class 5-A today?" names the absentee', async () => {
    const res = await api.ask(teacher(), 'Who is absent in Class 5-A today?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/Diya Sharma/);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall()).tool).toBe('get_attendance_roster');
  });

  it('H — an out-of-scope class is refused without leaking it', async () => {
    const res = await api.ask(teacher(), 'How many students are in Class 9-B?');
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/not one of your classes/);
    expect(body).not.toContain('Ishaan');
  });

  it('I — a class that does not exist is reported as missing', async () => {
    const res = await api.ask(teacher(), 'How many students are in Class 10-A?');
    expect(JSON.stringify(res.body)).toMatch(/could not find a class called/i);
    expect(JSON.stringify(res.body)).not.toMatch(/no students match/i);
  });

  it('each of the teacher\'s real classes answers', async () => {
    for (const [written, expected] of [['Class 5-A', 3], ['Class 6-A', 3]]) {
      const res = await api.ask(teacher(), `How many students are in ${written}?`);
      expect(res.reply, written).toMatch(new RegExp(`has ${expected} student`));
    }
  });
});

/* ── 8. The catalog never reaches the user ────────────────── */

describe('8. tool descriptions stay internal', () => {
  it('a question that routes nowhere offers topics, not the catalog', async () => {
    const res = await api.ask(teacher(), 'qwerty zxcvbn plugh');
    expect(res.status).toBe(200);
    expectNoCatalogLeak(res.reply);
    // Still useful: it says what it can help with, in ordinary words.
    expect(res.reply).toMatch(/attendance|students|classes/i);
  });

  it('"for which class am I class teacher?" does not dump the catalog', async () => {
    // The exact question from the report that produced paragraphs of
    // descriptions.
    const res = await api.ask(teacher(), 'for which class i am classteacher?');
    expect(res.status).toBe(200);
    expectNoCatalogLeak(res.reply);
  });

  it('the reply never contains a tool name', async () => {
    for (const msg of ['How many students are in Class 5-A?', 'What classes do I teach?', 'Show the attendance of Class 5-A.']) {
      const res = await api.ask(teacher(), msg);
      expect(res.reply, msg).not.toMatch(/\b(search_students|get_my_classes|get_attendance_roster|get_student_overview)\b/);
    }
  });
});
