import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Role } from '../src/models/role.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { Grade, Section, Subject, SubjectOffering, AcademicYear, Term } from '../src/models/academics.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { getTool, toolsAvailableTo } from '../src/modules/ai/agent/tools.js';
import { checkAuthorization } from '../src/modules/ai/agent/orchestrator.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { getMcpTool } from '../src/modules/ai/mcp/registry.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { getDailyAbsenceSummary } from '../src/modules/attendance/attendance.service.js';

/**
 * Today as the register stores it.
 *
 * Attendance dates are UTC-midnight stamps of a local calendar day (see
 * parseDateToMidnight); a plain setHours(0,0,0,0) is local midnight, which is a
 * different instant everywhere but UTC and would not match a single row.
 */
const registerToday = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};
import '../src/models/profile.model.js';

/**
 * The hostel, library, announcement and timetable capabilities, and the
 * absence-summary routing fix.
 *
 * These are shared agent tools, so what is tested is the shared contract: the
 * permission each one demands, that it is confined to the acting school, and
 * that the rule parser sends the question a person would actually type to the
 * tool that can answer it.
 */

const OAK = 'oakridge';
const RIV = 'riverside';
const inOak = (fn) => runWithTenant(OAK, fn);
const inRiv = (fn) => runWithTenant(RIV, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const actorFor = (roleKey) => ({
  roleKey,
  profileId: new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

/** The agent's own gate: ALLOW, or the refusal code it raises. */
const gate = (roleKey, toolName) => {
  try {
    checkAuthorization(actorFor(roleKey), getTool(toolName));
    return 'ALLOW';
  } catch (err) {
    return err.code ?? `DENY_${err.statusCode}`;
  }
};

/**
 * Refused for any reason — the property that actually matters.
 *
 * Both refusal codes mean "this role cannot run this tool"; the difference is
 * whether they hold the permission at too narrow a scope or not at all, which
 * is a fact about the permission catalogue rather than about the gate. Use this
 * wherever the catalogue could reasonably grant either, and the exact code
 * where the role provably holds nothing.
 */
const refused = (roleKey, toolName) =>
  ['AGENT_FORBIDDEN', 'AGENT_FORBIDDEN_SCOPE'].includes(gate(roleKey, toolName));

const run = (toolName, roleKey, args = {}) => {
  const tool = getTool(toolName);
  const actor = actorFor(roleKey);
  const scope = checkAuthorization(actor, tool);
  return tool.execute(actor, scope, args);
};

const NEW_TOOLS = [
  'get_hostel_summary', 'get_hostel_residents',
  'get_library_summary', 'get_overdue_books',
  'get_announcements', 'get_timetable',
];

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }
});

/* ── 1. Every new tool is a read, gated on an existing permission ── */

describe('the new capabilities are shared, read-only and permission-gated', () => {
  it('registers each one as a non-mutating tool', () => {
    for (const name of NEW_TOOLS) {
      const tool = getTool(name);
      expect(tool, name).toBeTruthy();
      expect(tool.mutates, `${name} must not write`).toBeFalsy();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('admits exactly the roles holding the permission it names', () => {
    // Hostel: WARDEN and ADMIN hold hostel.read at ALL; nobody else does.
    expect(gate('WARDEN', 'get_hostel_summary')).toBe('ALLOW');
    expect(gate('ADMIN', 'get_hostel_summary')).toBe('ALLOW');
    expect(gate('SUPER_ADMIN', 'get_hostel_summary')).toBe('ALLOW');
    expect(gate('LIBRARIAN', 'get_hostel_summary')).toBe('AGENT_FORBIDDEN');
    expect(gate('STUDENT', 'get_hostel_residents')).toBe('AGENT_FORBIDDEN');
    expect(gate('TEACHER', 'get_hostel_residents')).toBe('AGENT_FORBIDDEN');

    // Library: LIBRARIAN and ADMIN.
    expect(gate('LIBRARIAN', 'get_library_summary')).toBe('ALLOW');
    expect(gate('ADMIN', 'get_overdue_books')).toBe('ALLOW');
    // Holds no library.read at all, so the refusal is the plain one.
    expect(gate('WARDEN', 'get_overdue_books')).toBe('AGENT_FORBIDDEN');
    expect(gate('PARENT', 'get_library_summary')).toBe('AGENT_FORBIDDEN');

    // A student is refused both, but *which* refusal depends on the permission
    // catalogue: where students hold library.read at OWN (so they can see their
    // own borrowings) it is a scope refusal, and where they hold nothing it is a
    // plain one. Pinning one of those was a bug in this test — it passed on a
    // branch whose catalogue withheld the grant and failed the moment it met one
    // that gives it. What must hold either way is that they are refused, so that
    // is what is asserted.
    expect(refused('STUDENT', 'get_overdue_books')).toBe(true);
    expect(refused('STUDENT', 'get_library_summary')).toBe(true);

    // Announcements: everyone who can read them, which is every shipped role.
    for (const role of ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN', 'WARDEN', 'LIBRARIAN', 'FINANCE', 'PRINCIPAL']) {
      expect(gate(role, 'get_announcements'), role).toBe('ALLOW');
    }

    // Timetable: held at OWN by students/parents/teachers, ALL by leadership.
    for (const role of ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN', 'PRINCIPAL']) {
      expect(gate(role, 'get_timetable'), role).toBe('ALLOW');
    }
    expect(gate('LIBRARIAN', 'get_timetable')).toBe('AGENT_FORBIDDEN');
    expect(gate('FINANCE', 'get_timetable')).toBe('AGENT_FORBIDDEN');
  });

  it('closes every school-wide read to an OWN-scoped holder', () => {
    // A roster is other people's records, and so is an aggregate over the whole
    // school -- neither is "your own".
    //
    // This test used to end `expect(get_hostel_summary).not.toThrow()`, on the
    // reasoning that a summary is a count rather than a list and OWN was
    // therefore enough. That held only while nobody was granted these at OWN.
    // Students hold library.read at OWN so they can see their own borrowings,
    // which under the old rule also handed them the library's totals — and,
    // because the summaries are in BRIEFING_TOOLS, pushed them into a student's
    // opening WhatsApp message unasked.
    //
    // Neither summary tool takes a scope: both call getSummary() with no filter
    // at all. So the only thing standing between an OWN grant and school-wide
    // data is minScope, and both now declare it.
    const ownHostel = { roleKey: 'CUSTOM', profileId: 'x', permissions: { 'hostel.read': 'OWN' } };
    const ownLibrary = { roleKey: 'CUSTOM', profileId: 'x', permissions: { 'library.read': 'OWN' } };

    for (const [actor, toolName] of [
      [ownHostel, 'get_hostel_residents'],
      [ownLibrary, 'get_overdue_books'],
      [ownHostel, 'get_hostel_summary'],
      [ownLibrary, 'get_library_summary'],
    ]) {
      expect(() => checkAuthorization(actor, getTool(toolName)), toolName).toThrow(
        /limited to your own records/i
      );
    }
  });

  it('gives the warden and the librarian a usable assistant at last', () => {
    const warden = toolsAvailableTo(actorFor('WARDEN')).map((t) => t.name);
    const librarian = toolsAvailableTo(actorFor('LIBRARIAN')).map((t) => t.name);

    expect(warden).toEqual(expect.arrayContaining(['get_hostel_summary', 'get_hostel_residents', 'get_announcements']));
    expect(librarian).toEqual(expect.arrayContaining(['get_library_summary', 'get_overdue_books', 'get_announcements']));
    // They each held zero tools before this change, which is why every question
    // came back "I can help with: ." with an empty list.
    expect(warden.length).toBeGreaterThan(0);
    expect(librarian.length).toBeGreaterThan(0);
    // And neither has gained anything belonging to the other.
    expect(warden).not.toContain('get_overdue_books');
    expect(librarian).not.toContain('get_hostel_residents');
  });
});

/* ── 2. Real data, confined to the acting school ── */

describe('the new tools read live ERP data, scoped to one school', () => {
  beforeEach(async () => {
    await inOak(async () => {
      const room = await HostelRoom.create({ roomNo: 'A-101', block: 'A', capacity: 4, type: 'BOYS' });
      const s1 = await Student.create({ firstName: 'Aarav', lastName: 'Sharma', admissionNo: 'OAK-1', gender: 'MALE' });
      await HostelAllocation.create({ roomId: room._id, studentId: s1._id, status: 'ACTIVE', allottedAt: new Date() });

      const book = await Book.create({ title: 'Oakridge Atlas', author: 'A', totalCopies: 2, availableCopies: 1 });
      await BookIssue.create({
        bookId: book._id, borrowerProfileId: new mongoose.Types.ObjectId(), borrowerName: 'Aarav Sharma',
        issuedAt: new Date(Date.now() - 30 * 864e5), dueDate: new Date(Date.now() - 7 * 864e5), status: 'ACTIVE',
      });

      await Announcement.create({ title: 'Oakridge sports day', content: 'ours', audience: ['ALL'], publishedAt: new Date() });
    });

    await inRiv(async () => {
      const room = await HostelRoom.create({ roomNo: 'R-1', block: 'R', capacity: 2, type: 'GIRLS' });
      const s2 = await Student.create({ firstName: 'Riya', lastName: 'Verma', admissionNo: 'RIV-1', gender: 'FEMALE' });
      await HostelAllocation.create({ roomId: room._id, studentId: s2._id, status: 'ACTIVE', allottedAt: new Date() });

      const book = await Book.create({ title: 'Riverside Reader', author: 'B', totalCopies: 1, availableCopies: 0 });
      await BookIssue.create({
        bookId: book._id, borrowerProfileId: new mongoose.Types.ObjectId(), borrowerName: 'Riya Verma',
        issuedAt: new Date(Date.now() - 30 * 864e5), dueDate: new Date(Date.now() - 3 * 864e5), status: 'ACTIVE',
      });

      await Announcement.create({ title: 'Riverside prize day', content: 'theirs', audience: ['ALL'], publishedAt: new Date() });
    });
  });

  it('reports hostel occupancy for the acting school only', async () => {
    const oak = await inOak(() => run('get_hostel_summary', 'WARDEN'));
    expect(oak.data.totalCapacity).toBe(4);
    expect(oak.data.occupiedBeds).toBe(1);
    expect(oak.speakKey).toBe('hostel.summary');

    const riv = await inRiv(() => run('get_hostel_summary', 'WARDEN'));
    expect(riv.data.totalCapacity).toBe(2);
  });

  it('lists only the acting school\'s residents', async () => {
    const oak = await inOak(() => run('get_hostel_residents', 'WARDEN'));
    expect(oak.data.residents).toHaveLength(1);
    expect(oak.data.residents[0].name).toBe('Aarav Sharma');
    expect(oak.params.list).toContain('A-101');
    expect(JSON.stringify(oak)).not.toMatch(/Riya|RIV-1/);

    const riv = await inRiv(() => run('get_hostel_residents', 'WARDEN'));
    expect(riv.data.residents[0].name).toBe('Riya Verma');
  });

  it('finds overdue books, marking them overdue on the way', async () => {
    // Both fixtures were written as ACTIVE with a due date in the past;
    // listIssues() re-marks them, so a book nobody has looked at still shows.
    const oak = await inOak(() => run('get_overdue_books', 'LIBRARIAN'));
    expect(oak.data.overdue).toHaveLength(1);
    expect(oak.data.overdue[0].bookTitle).toBe('Oakridge Atlas');
    expect(JSON.stringify(oak)).not.toMatch(/Riverside Reader/);
  });

  it('summarises the catalog for the acting school only', async () => {
    const oak = await inOak(() => run('get_library_summary', 'LIBRARIAN'));
    expect(oak.data.totalCatalogBooks).toBe(1);
    expect(oak.params.books).toBe(1);
  });

  it('returns announcements addressed to the caller, in their own school', async () => {
    const oak = await inOak(() => run('get_announcements', 'WARDEN'));
    expect(oak.params.list).toContain('Oakridge sports day');
    expect(oak.params.list).not.toContain('Riverside prize day');
  });

  it('says so plainly when there is nothing to report', async () => {
    await runWithTenant('emptyschool', async () => {
      expect((await run('get_hostel_residents', 'WARDEN')).speakKey).toBe('hostel.residents.none');
      expect((await run('get_overdue_books', 'LIBRARIAN')).speakKey).toBe('library.overdue.none');
      expect((await run('get_announcements', 'WARDEN')).speakKey).toBe('announcements.none');
    });
  });
});

/* ── 3. Timetable ── */

describe('the timetable capability', () => {
  it("returns the requested day's periods and nothing for an empty day", async () => {
    await inOak(async () => {
      const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date() });
      const term = await Term.create({ academicYearId: year._id, name: 'Term 1', startsOn: new Date(), endsOn: new Date() });
      const grade = await Grade.create({ name: 'Class 5', level: 5 });
      const section = await Section.create({ name: 'A', gradeId: grade._id });
      const subject = await Subject.create({ name: 'Mathematics', code: 'MATH' });
      const offering = await SubjectOffering.create({ sectionId: section._id, subjectId: subject._id, termId: term._id });
      // Monday, two periods.
      await TimetableSlot.create({ sectionId: section._id, dayOfWeek: 1, periodNo: 1, startTime: '09:00', endTime: '09:45', subjectOfferingId: offering._id });
      await TimetableSlot.create({ sectionId: section._id, dayOfWeek: 1, periodNo: 2, startTime: '09:45', endTime: '10:30', subjectOfferingId: offering._id });

      const monday = await run('get_timetable', 'ADMIN', { day: 'monday' });
      expect(monday.speakKey).toBe('timetable.day');
      expect(monday.params.day).toBe('Monday');
      expect(monday.params.list).toContain('P1 09:00-09:45 Mathematics');
      expect(monday.data.slots).toHaveLength(2);

      const sunday = await run('get_timetable', 'ADMIN', { day: 'sunday' });
      expect(sunday.speakKey).toBe('timetable.none');
      expect(sunday.params.day).toBe('Sunday');
    });
  });
});

/* ── 4. The absence-summary fix ── */

describe('"how many students are absent today?"', () => {
  it('routes a school-wide reader to the absence summary, not to their own record', () => {
    for (const role of ['ADMIN', 'PRINCIPAL']) {
      const intent = parseIntent('How many students are absent today?', actorFor(role));
      expect(intent?.tool, role).toBe('get_absent_students');
    }
    // SUPER_ADMIN is deliberately NOT in that list any more. It holds no
    // assistant permission, so it must route to nothing at all rather than to
    // the school-wide summary -- the exclusion is what the permission map
    // says, and it is checked here as well as in ai.superAdminExcluded.
    expect(parseIntent('How many students are absent today?', actorFor('SUPER_ADMIN'))).toBeNull();
    // Other phrasings of the same question.
    expect(parseIntent('absent count', actorFor('ADMIN'))?.tool).toBe('get_absent_students');
    expect(parseIntent('give me the absence report', actorFor('ADMIN'))?.tool).toBe('get_absent_students');
    expect(parseIntent('who is absent today', actorFor('ADMIN'))?.tool).toBe('get_absent_students');
  });

  it('still answers a student about themselves rather than refusing them', () => {
    // The regression this guards: excluding the school-wide phrasing from
    // get_attendance stranded students on it entirely -- the rule that could
    // answer was excluded and the rule that claimed it was out of their reach,
    // so the message matched nothing.
    //
    // WHY THIS ASSERTS A CONTRACT AND NOT A NAME.
    //
    // `get_attendance` and `get_attendance_statistics` are the same authorized
    // answer under two names, and the registry says so rather than this
    // comment: identical permission (attendance.read), neither declaring a
    // minScope, the same two arguments, and the same pair of services --
    // getSummary() for a caller scoped to their own records and
    // getDailyAbsenceSummary() for one who may see the school. Both branch on
    // the scope the MCP server derives from the caller's permission map, which
    // no argument can influence. For a STUDENT or a PARENT, both therefore
    // answer about the caller and cannot answer about anybody else.
    //
    // Naming one of them froze a preference between two correct answers. What
    // matters is what may be DISCLOSED, so that is what is checked here, and
    // checked again against a real database in mcp.attendanceScope.test.js.
    const OWN_SCOPED_ATTENDANCE = ['get_attendance', 'get_attendance_statistics'];

    for (const role of ['STUDENT', 'PARENT']) {
      const actor = actorFor(role);
      const intent = parseIntent('How many students are absent today?', actor);
      expect(intent?.tool, role).toBeTruthy();
      expect(OWN_SCOPED_ATTENDANCE, `${role} reached ${intent.tool}`).toContain(intent.tool);

      const tool = getMcpTool(intent.tool);
      // The capability is not one restricted to callers who may see the whole
      // school, and this caller holds attendance.read at OWN only -- so the
      // school-wide reading of the question is unreachable to them by
      // construction, whichever of the two ran.
      expect(tool.minScope ?? 'OWN', `${role}: ${intent.tool} is school-wide only`).not.toBe('ALL');
      expect(actor.permissions['attendance.read'], role).toBe('OWN');
      // And nothing in the call can say whose records, which school, or at
      // what scope: those come from the authenticated actor.
      for (const argument of Object.keys(tool.inputSchema?.properties ?? {})) {
        expect(['userId', 'profileId', 'studentId', 'tenantId', 'schoolId', 'scope'], role).not.toContain(argument);
      }
    }

    for (const message of ['am I absent today?', 'What is my attendance?']) {
      const intent = parseIntent(message, actorFor('STUDENT'));
      expect(OWN_SCOPED_ATTENDANCE, `"${message}" reached ${intent?.tool}`).toContain(intent?.tool);
    }
    expect(parseIntent('my attendance for 2026-08', actorFor('STUDENT'))?.args).toEqual({ month: '2026-08' });
  });

  it('leaves the write path alone', () => {
    expect(parseIntent('mark attendance for class 5A', actorFor('TEACHER'))?.tool).toBe('mark_attendance');
  });

  it('counts today\'s register instead of the size of the school', async () => {
    await inOak(async () => {
      const year = new mongoose.Types.ObjectId();
      const section = new mongoose.Types.ObjectId();
      const rows = [];
      for (let i = 0; i < 5; i += 1) {
        const student = await Student.create({ firstName: `Pupil${i}`, lastName: 'Bose', admissionNo: `OAK-9${i}`, gender: 'FEMALE' });
        const enrollment = await Enrollment.create({
          studentId: student._id, sectionId: section, academicYearId: year, rollNo: i + 1, status: 'ACTIVE',
        });
        rows.push({
          enrollmentId: enrollment._id,
          date: registerToday(),
          periodNo: null,
          status: i < 2 ? 'ABSENT' : 'PRESENT',
        });
      }
      await AttendanceRecord.insertMany(rows);

      const summary = await getDailyAbsenceSummary();
      expect(summary.ABSENT).toBe(2);
      expect(summary.PRESENT).toBe(3);
      expect(summary.marked).toBe(5);
      expect(summary.pctPresent).toBe(60);

      const spoken = await run('who_is_absent_today', 'ADMIN');
      expect(spoken.speakKey).toBe('absent.today');
      expect(spoken.params.absent).toBe(2);
      expect(spoken.params.marked).toBe(5);
    });
  });

  it('does not pretend an unmarked register means nobody is missing', async () => {
    await runWithTenant('unmarkedschool', async () => {
      const result = await run('who_is_absent_today', 'ADMIN');
      expect(result.speakKey).toBe('absent.notMarked');
      expect(result.data.marked).toBe(0);
    });
  });

  it('counts day-level marks only, so per-period schools are not multiplied', async () => {
    await inOak(async () => {
      const student = await Student.create({ firstName: 'Dev', lastName: 'Rao', admissionNo: 'OAK-8', gender: 'MALE' });
      const enrollment = await Enrollment.create({ studentId: student._id, sectionId: new mongoose.Types.ObjectId(), academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
      const date = registerToday();
      await AttendanceRecord.insertMany([
        { enrollmentId: enrollment._id, date, periodNo: null, status: 'ABSENT' },
        { enrollmentId: enrollment._id, date, periodNo: 1, status: 'ABSENT' },
        { enrollmentId: enrollment._id, date, periodNo: 2, status: 'ABSENT' },
      ]);

      const summary = await getDailyAbsenceSummary();
      expect(summary.ABSENT).toBe(1);
      expect(summary.marked).toBe(1);
    });
  });

  it('confines the count to the acting school', async () => {
    const date = registerToday();
    await inOak(async () => {
      const s = await Student.create({ firstName: 'O', lastName: 'One', admissionNo: 'OAK-7', gender: 'MALE' });
      const e = await Enrollment.create({ studentId: s._id, sectionId: new mongoose.Types.ObjectId(), academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
      await AttendanceRecord.create({ enrollmentId: e._id, date, periodNo: null, status: 'ABSENT' });
    });
    await inRiv(async () => {
      const s = await Student.create({ firstName: 'R', lastName: 'One', admissionNo: 'RIV-7', gender: 'MALE' });
      const e = await Enrollment.create({ studentId: s._id, sectionId: new mongoose.Types.ObjectId(), academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
      await AttendanceRecord.insertMany([
        { enrollmentId: e._id, date, periodNo: null, status: 'ABSENT' },
        { enrollmentId: e._id, date: new Date(date.getTime() - 864e5), periodNo: null, status: 'ABSENT' },
      ]);
    });

    expect((await inOak(() => getDailyAbsenceSummary())).ABSENT).toBe(1);
    expect((await inRiv(() => getDailyAbsenceSummary())).ABSENT).toBe(1);
  });
});

/* ── 5. Routing for the other new capabilities ── */

describe('rule routing for the new capabilities', () => {
  it('sends the questions each role would actually type to the right tool', () => {
    const cases = [
      ['WARDEN', 'Which students are currently assigned to my hostel?', 'get_hostel_residents'],
      ['WARDEN', 'who is in the hostel', 'get_hostel_residents'],
      ['WARDEN', 'What is the hostel occupancy?', 'get_hostel_summary'],
      ['WARDEN', 'how many beds are free', 'get_hostel_summary'],
      ['LIBRARIAN', 'Show overdue books', 'get_overdue_books'],
      ['LIBRARIAN', 'which books are late', 'get_overdue_books'],
      ['LIBRARIAN', 'How many books are in the library?', 'get_library_summary'],
      ['LIBRARIAN', 'Show me the latest announcements', 'get_announcements'],
      ['STUDENT', 'any new notices?', 'get_announcements'],
      ['TEACHER', 'Show my timetable', 'get_timetable'],
      ['STUDENT', 'what classes do I have today?', 'get_timetable'],
      ['TEACHER', 'what is my schedule on friday', 'get_timetable'],
    ];
    for (const [role, message, tool] of cases) {
      expect(parseIntent(message, actorFor(role))?.tool, `${role}: ${message}`).toBe(tool);
    }
  });

  it('picks the day out of the question, relative words included', () => {
    expect(parseIntent('what is my timetable on friday', actorFor('TEACHER'))?.args).toEqual({ day: 'friday' });
    expect(parseIntent('show my timetable', actorFor('TEACHER'))?.args).toEqual({});
    // The regression this locks in: "tomorrow" produced no day at all, so the
    // tool fell back to its default and answered with TODAY's periods under
    // today's heading -- a confidently wrong answer to a plain question.
    expect(parseIntent('what classes do I have tomorrow?', actorFor('TEACHER'))?.args).toEqual({ day: 'tomorrow' });
    expect(parseIntent('what classes do I have today?', actorFor('TEACHER'))?.args).toEqual({ day: 'today' });
    // The longer phrase must win the alternation against "tomorrow".
    expect(parseIntent('day after tomorrow timetable', actorFor('TEACHER'))?.args).toEqual({ day: 'day after tomorrow' });
  });

  it('resolves a relative day against the real calendar', async () => {
    await inOak(async () => {
      const year = await AcademicYear.create({ name: '2027-28', startsOn: new Date(), endsOn: new Date() });
      const term = await Term.create({ academicYearId: year._id, name: 'T1', startsOn: new Date(), endsOn: new Date() });
      const grade = await Grade.create({ name: 'Class 6', level: 6 });
      const section = await Section.create({ name: 'B', gradeId: grade._id });
      const subject = await Subject.create({ name: 'Geography', code: 'GEO' });
      const offering = await SubjectOffering.create({ sectionId: section._id, subjectId: subject._id, termId: term._id });

      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const tomorrowJs = (new Date().getDay() + 1) % 7;
      // Put a single period on tomorrow, and nothing on today.
      await TimetableSlot.create({
        sectionId: section._id, dayOfWeek: tomorrowJs === 0 ? 7 : tomorrowJs,
        periodNo: 4, startTime: '11:00', endTime: '11:45', subjectOfferingId: offering._id,
      });

      const result = await run('get_timetable', 'ADMIN', { day: 'tomorrow' });
      expect(result.speakKey).toBe('timetable.day');
      expect(result.params.day.toLowerCase()).toBe(DAYS[tomorrowJs]);
      expect(result.params.list).toContain('Geography');

      // And "today" must NOT pick up tomorrow's period.
      const today = await run('get_timetable', 'ADMIN', { day: 'today' });
      expect(today.speakKey).toBe('timetable.none');
    });
  });

  it('keeps reads and writes apart', () => {
    // Posting an announcement is still the write tool, not the new read one.
    expect(parseIntent('post an announcement saying school closes early', actorFor('ADMIN'))?.tool).toBe('create_announcement');
    expect(parseIntent('show me announcements', actorFor('ADMIN'))?.tool).toBe('get_announcements');
  });

  it('does not let "overdue" steal a fees question', () => {
    // Fees are overdue too, and that wording belongs to the fee tools.
    expect(parseIntent('are my fees overdue?', actorFor('STUDENT'))?.tool).toBe('get_fees');
    expect(parseIntent('do I have an overdue invoice', actorFor('PARENT'))?.tool).toBe('get_fees');
  });

  it('does not let "schedule" steal an exam question', () => {
    // There is no exam-timetable tool in the registry, so this has always
    // matched nothing. The guarantee being locked in is narrower: the new
    // timetable rule must not claim it and answer with the class schedule.
    expect(parseIntent('when is the exam schedule', actorFor('STUDENT'))?.tool).not.toBe('get_timetable');
    expect(parseIntent('exam timetable', actorFor('STUDENT'))?.tool).not.toBe('get_timetable');
  });
});
