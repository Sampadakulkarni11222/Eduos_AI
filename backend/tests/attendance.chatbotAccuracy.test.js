import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * A student's attendance, as the assistant answers it.
 *
 * The report this exists for: with no attendance marked, the assistant still
 * gave a percentage ("Attendance is 0% (0 present of 0 working days)"), because
 * the service computed `workingDays > 0 ? … : 0` and every tool read any
 * non-null number as a real figure. The rule now lives in the service and the
 * MCP tools, so the website, WhatsApp and a direct MCP call all agree:
 *
 *   a percentage exists only when at least one valid mark exists
 *   a month is answered from that month's marks only, never the overall figure
 *   nobody reads another student's record by naming them
 *   the reply is formatted (headings, labels, tables) and never raw JSON
 *
 * Priya Verma (OAK-2) is the student. Dates are relative to "now" so the suite
 * does not rot with the calendar.
 */

const failure = vi.hoisted(() => ({ error: null }));

vi.mock('../src/modules/attendance/attendance.service.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getSummary: vi.fn(async (...args) => {
      if (failure.error) throw failure.error;
      return real.getSummary(...args);
    }),
  };
});

const { parseIntent } = await import('../src/modules/ai/agent/intent.js');
const {
  attendanceAnswer, renderView, toWhatsAppText, formatPercent, formatMonth, isFutureMonth,
} = await import('../src/modules/ai/agent/present.js');
const { attendanceFigures, getSummary } = await import('../src/modules/attendance/attendance.service.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { Student } = await import('../src/models/student.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, seedPerson, mcp, inSchool, todayKey, OAK } = await import('./support/mcpSchool.js');

const now = new Date();
/** "YYYY-MM" `offset` months from the current one. */
const ym = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** A stored attendance date: day `day` of the month `offset` months away, at UTC midnight. */
const dayIn = (offset, day) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), day));
};
const LAST = ym(-1);
const TWO_AGO = ym(-2);
const monthWords = (m) => formatMonth(m, 'en', now);
/** The full English name, as a person would type it. */
const monthName = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)
  .toLocaleString('en', { month: 'long' });

let api;
let school;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});

beforeEach(async () => {
  resetAgentThrottle();
  failure.error = null;
  school = await seedSchool();
  // Priya: today's PRESENT (from the fixture) plus last month 3 present, 1 absent.
  // Nothing two months ago.
  await inSchool(OAK, async () => {
    const enrollmentId = school.priya.enrollment._id;
    for (const [day, status] of [[3, 'PRESENT'], [4, 'PRESENT'], [5, 'PRESENT'], [6, 'ABSENT']]) {
      await AttendanceRecord.create({ enrollmentId, date: dayIn(-1, day), periodNo: null, status });
    }
  });
});

const priya = () => school.people.STUDENT;

/** A student account linked to Aman Gupta, who has no attendance at all. */
async function studentWithNoAttendance() {
  const person = await seedPerson({ roleKey: 'STUDENT', roleId: school.roleIds.STUDENT, displayName: 'Aman Gupta' });
  await inSchool(OAK, () => Student.updateOne({ _id: school.aman.student._id }, { profileId: person.profile._id }));
  return person;
}

const PERCENT = /\d+(?:\.\d+)?\s?%/;
const RAW = /[{}[\]]|enrollmentId|"PRESENT"|workingDays|pctPresent|ObjectId/;

const say = async (person, message) => {
  const res = await api.ask(person, message);
  expect(res.status, `${message}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.reply ?? '';
};

describe('overall attendance', () => {
  it('is calculated from the student\'s own valid marks, with present and absent counts', async () => {
    const reply = await say(priya(), 'What is my attendance?');
    // 4 present (3 last month + today) and 1 absent: 4 / 5 = 80%.
    expect(reply).toMatch(/\*\*Attendance Summary\*\*/);
    expect(reply).toMatch(/\*\*Attendance:\*\* 80%/);
    expect(reply).toMatch(/\*\*Present:\*\* 4 days/);
    expect(reply).toMatch(/\*\*Absent:\*\* 1 day\b/);
    expect(reply).toMatch(/\*\*Total Marked:\*\* 5 days/);
    expect(reply).not.toMatch(RAW);
  });

  it('every phrasing of the question reaches the same figures', async () => {
    for (const message of [
      'What is my attendance percentage?', 'Show my attendance.', 'Show my attendance percentage.',
      'How much attendance do I have?', 'How many days was I present?', 'How many days was I absent?',
      'What percentage of attendance do I have?',
    ]) {
      const reply = await say(priya(), message);
      expect(reply, message).toMatch(/Attendance:\*\* 80%/);
      expect(reply, message).toMatch(/Present:\*\* 4 days/);
    }
  });

  it('with NO records marked there is no percentage at all — not 0%, not 100%', async () => {
    const aman = await studentWithNoAttendance();
    for (const message of ['What is my attendance?', 'What is my attendance percentage?', 'How many days was I present?']) {
      const reply = await say(aman, message);
      expect(reply, message).toMatch(/Attendance Not Available/);
      expect(reply, message).toMatch(/No attendance records have been marked for you yet, so an attendance percentage cannot be calculated/);
      expect(reply, message).not.toMatch(PERCENT);
    }
  });

  it('the MCP tools themselves return no percentage for an unmarked student (any consumer)', async () => {
    const aman = await studentWithNoAttendance();
    for (const name of ['get_attendance', 'get_attendance_statistics', 'get_student_attendance']) {
      const res = await mcp(OAK, aman.actor, name, {});
      expect(res.success, `${name}: ${JSON.stringify(res.error ?? {})}`).toBe(true);
      expect(res.data?.pctPresent ?? null, name).toBeNull();
      expect(res.view?.type, name).toBe('attendance.none');
      expect(res.speakKey, name).not.toBe('attendance.summary');
    }
  });

  it('records with an invalid status are not counted', async () => {
    await inSchool(OAK, () => AttendanceRecord.collection.insertOne({
      tenantId: OAK, enrollmentId: school.priya.enrollment._id, date: dayIn(-1, 9), periodNo: null, status: 'BOGUS',
    }));
    const reply = await say(priya(), 'What is my attendance?');
    expect(reply).toMatch(/Total Marked:\*\* 5 days/);
    expect(reply).toMatch(/Attendance:\*\* 80%/);
  });
});

describe('monthly attendance', () => {
  it('is calculated from that month\'s marks only, and names the month', async () => {
    const reply = await say(priya(), `Show my attendance for ${monthName(LAST)}.`);
    expect(reply).toContain(`**${monthWords(LAST)} Attendance**`);
    expect(reply).toMatch(/\| Present \| 3 \|/);
    expect(reply).toMatch(/\| Absent \| 1 \|/);
    expect(reply).toMatch(/\| Total Marked \| 4 \|/);
    expect(reply).toMatch(/\| Attendance \| \*\*75%\*\* \|/);
  });

  it('"last month" is the previous calendar month', async () => {
    const reply = await say(priya(), 'What was my attendance last month?');
    expect(reply).toContain(`**${monthWords(LAST)} Attendance**`);
    expect(reply).toMatch(/\*\*75%\*\*/);
  });

  it('a month with no marks says so — it does not fall back to the overall figure', async () => {
    const reply = await say(priya(), `Show my attendance for ${monthName(TWO_AGO)}.`);
    expect(reply).toContain(`**${monthWords(TWO_AGO)} Attendance**`);
    expect(reply).toContain(`No attendance records have been marked for ${monthWords(TWO_AGO)}, so an attendance percentage cannot be calculated.`);
    expect(reply).not.toMatch(PERCENT);
  });

  it('a future month is said to be in the future, with no percentage', async () => {
    const future = `${now.getFullYear() + 1}-12`;
    expect(isFutureMonth(future, now)).toBe(true);
    const reply = await say(priya(), `Show my attendance for December ${now.getFullYear() + 1}`);
    expect(reply).toMatch(/hasn't started yet/);
    expect(reply).not.toMatch(PERCENT);
  });

  it('an invalid month is reported as unreadable, not answered for some other period', async () => {
    const reply = await say(priya(), `Show my attendance for ${now.getFullYear()}-13`);
    expect(reply).toMatch(/could not read .*as a month/i);
    expect(reply).not.toMatch(PERCENT);
  });

  it('month-wise / history lists each month, unmarked months without a percentage', async () => {
    for (const message of ['Give me the attendance percentage month wise.', 'Show my attendance history.', 'Give me my monthly attendance.']) {
      const reply = await say(priya(), message);
      expect(reply, message).toMatch(/\*\*Monthly Attendance\*\*/);
      expect(reply, message).toMatch(new RegExp(`\\| ${monthWords(LAST)} \\| 3 \\| 1 \\| 4 \\| \\*\\*75%\\*\\* \\|`));
      expect(reply, message).toMatch(new RegExp(`\\| ${monthWords(TWO_AGO)} \\| — \\| — \\| 0 \\| Not marked \\|`));
      expect(reply, message).not.toMatch(/\b0%/);
    }
  });
});

describe('division by zero and the shared figures', () => {
  it('attendanceFigures gives null, never 0, when nothing is marked', () => {
    expect(attendanceFigures({})).toMatchObject({ workingDays: 0, pctPresent: null, pctExact: null });
    expect(attendanceFigures(undefined).pctPresent).toBeNull();
    expect(attendanceFigures({ PRESENT: 'x', ABSENT: NaN }).pctPresent).toBeNull();
    expect(attendanceFigures({ PRESENT: 18, ABSENT: 4 })).toMatchObject({ workingDays: 22, pctPresent: 82, pctExact: 81.82 });
  });

  it('the service returns a null percentage for a student with no marks', async () => {
    const aman = await studentWithNoAttendance();
    const summary = await inSchool(OAK, () => getSummary(aman.actor, 'OWN', {}));
    expect(summary.workingDays).toBe(0);
    expect(summary.pctPresent).toBeNull();
  });

  it('a missing percentage is never formatted as a number', () => {
    for (const missing of [null, undefined, NaN, '']) expect(formatPercent(missing)).toBe('—');
    expect(formatPercent(81.818181)).toBe('81.82%');
    expect(formatPercent(82)).toBe('82%');
    expect(attendanceAnswer({ workingDays: 0, pctPresent: 0 }).view.type).toBe('attendance.none');
  });
});

describe('another student\'s attendance', () => {
  it('a student cannot read a classmate by name, admission number or enrolment id', async () => {
    const student = priya().actor;
    for (const args of [{ studentName: 'Rahul Sharma' }, { admissionNo: 'OAK-1' }, { enrollmentId: String(school.rahul.enrollment._id) }]) {
      const res = await mcp(OAK, student, 'get_student_attendance', args);
      expect(res.success, JSON.stringify(args)).toBe(false);
    }
    const trend = await mcp(OAK, student, 'get_attendance_trend', { enrollmentId: String(school.rahul.enrollment._id) });
    expect(trend.success).toBe(false);
  });

  it('asked in words, the reply carries none of the classmate\'s figures', async () => {
    const reply = await say(priya(), "Show Rahul Sharma's attendance");
    expect(reply).not.toMatch(/Rahul Sharma — /);
    expect(reply).not.toMatch(/Attendance:\*\* 0%/);
  });
});

describe('routing', () => {
  const STUDENT_QUERIES = {
    get_attendance_summary: [
      'What is my attendance?', 'What is my attendance percentage?', 'Show my attendance.', 'Show my attendance percentage.',
      'How much attendance do I have?', 'How many days was I present?', 'How many days was I absent?',
      'What percentage of attendance do I have?',
    ],
    month: ['Show my attendance for September.', 'What was my attendance last month?', 'Show my attendance for this month.', 'Show attendance for September.'],
    trend: ['Give me my monthly attendance.', 'Give me the attendance percentage month wise.', 'Show my attendance history.', 'Give me monthly attendance.'],
  };
  const SUMMARY_TOOLS = ['get_attendance', 'get_attendance_statistics'];

  it('every phrasing of "my attendance" reaches an own-attendance summary tool', () => {
    for (const message of STUDENT_QUERIES.get_attendance_summary) {
      const step = parseIntent(message, priya().actor);
      expect(SUMMARY_TOOLS, message).toContain(step?.tool);
      expect(step.args?.month, message).toBeUndefined();
    }
  });

  it('a named or relative month is carried as that month', () => {
    for (const message of STUDENT_QUERIES.month) {
      const step = parseIntent(message, priya().actor);
      expect(SUMMARY_TOOLS, message).toContain(step?.tool);
      expect(step.args?.month, message).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('month-wise, monthly and history reach the month-by-month tool', () => {
    for (const message of STUDENT_QUERIES.trend) {
      expect(parseIntent(message, priya().actor)?.tool, message).toBe('get_attendance_trend');
    }
  });

  it('a teacher asking for "attendance history" is not answered about an arbitrary pupil', async () => {
    expect(parseIntent('Show my attendance history.', school.people.TEACHER.actor)?.tool).not.toBe('get_attendance_trend');
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_attendance_trend', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NEEDS_INPUT');
  });

  it('existing routes for other questions are unchanged', () => {
    expect(parseIntent('am I absent today?', priya().actor)?.tool).toBe('get_attendance');
    // Either name for the school-wide snapshot (the catalogue canonicalises one to the other).
    expect(['who_is_absent_today', 'get_absent_students']).toContain(parseIntent('Who is absent today?', school.people.ADMIN.actor)?.tool);
    expect(parseIntent('Show the attendance of Class 6-A', school.people.TEACHER.actor)?.tool).toBe('get_attendance_roster');
  });
});

describe('formatting', () => {
  const sept = {
    enrollmentId: 'abc', PRESENT: 18, ABSENT: 4, LATE: 0, EXCUSED: 0, HALF_DAY: 0, workingDays: 22, pctPresent: 82, pctExact: 81.82,
  };

  it('a month renders as a titled table with a two-decimal percentage', () => {
    const md = renderView(attendanceAnswer(sept, { month: `${now.getFullYear()}-09`, now }).view);
    expect(md).toBe([
      '**September Attendance**',
      '',
      '| Status | Days |',
      '| --- | ---: |',
      '| Present | 18 |',
      '| Absent | 4 |',
      '| Total Marked | 22 |',
      '| Attendance | **81.82%** |',
    ].join('\n'));
  });

  it('an overall summary renders as labelled bullets', () => {
    const md = renderView(attendanceAnswer({ ...sept, PRESENT: 41, ABSENT: 9, workingDays: 50, pctExact: 82 }).view);
    expect(md).toBe([
      '**Attendance Summary**',
      '',
      '- **Attendance:** 82%',
      '- **Present:** 41 days',
      '- **Absent:** 9 days',
      '- **Total Marked:** 50 days',
    ].join('\n'));
  });

  it('late and excused days are shown, and the counting rule is stated', () => {
    const md = renderView(attendanceAnswer({ ...sept, LATE: 2, workingDays: 24, pctExact: 83.33 }).view);
    expect(md).toMatch(/\*\*Late:\*\* 2 days/);
    expect(md).toMatch(/Late and excused days count as attended/);
  });

  it('no view leaks an internal id', () => {
    const { view } = attendanceAnswer(sept, { month: '2026-09' });
    expect(JSON.stringify(view)).not.toMatch(/abc|enrollmentId/);
  });

  it('WhatsApp gets its own dialect: no ** and no table pipes', () => {
    const md = renderView(attendanceAnswer(sept, { month: `${now.getFullYear()}-09`, now }).view);
    const wa = toWhatsAppText(md);
    expect(wa).not.toMatch(/\*\*|\|/);
    expect(wa).toContain('*September Attendance*');
    expect(wa).toContain('• Present: 18');
    expect(wa).toContain('• Attendance: *81.82%*');
    expect(toWhatsAppText('Plain sentence.')).toBe('Plain sentence.');
  });

  it('the WhatsApp channel delivers the converted reply', async () => {
    const res = await api.whatsapp(priya(), 'What is my attendance?');
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/\*Attendance:\* 80%/);
    expect(res.reply).not.toMatch(/\*\*|\|/);
  });
});

describe('failures', () => {
  it('a service failure is answered in plain words, with no internal detail', async () => {
    failure.error = Object.assign(new Error('E11000 internal pipeline exploded at attendance.service.js:440'), { stack: 'Error: at getSummary (attendance.service.js:440:9)' });
    const reply = await say(priya(), 'What is my attendance?');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/E11000|pipeline|attendance\.service|\bat getSummary\b|stack/i);
    expect(reply).not.toMatch(PERCENT);
  });

  it('a database outage is reported as such through MCP, never as a percentage', async () => {
    failure.error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:27017'), { name: 'MongoNetworkError' });
    const res = await mcp(OAK, priya().actor, 'get_attendance', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('DATABASE_ERROR');
    expect(res.error.message).not.toMatch(/ECONNREFUSED|27017/);
  });

  it('a student with no enrolment is told so, without a percentage', async () => {
    const orphan = await seedPerson({ roleKey: 'STUDENT', roleId: school.roleIds.STUDENT, displayName: 'No enrolment' });
    const reply = await say(orphan, 'What is my attendance?');
    expect(reply).toMatch(/no student enrolment/i);
    expect(reply).not.toMatch(PERCENT);
  });
});

it('today is still counted (fixture sanity)', async () => {
  const rows = await inSchool(OAK, () => AttendanceRecord.countDocuments({ enrollmentId: school.priya.enrollment._id, date: todayKey() }));
  expect(rows).toBe(1);
});
