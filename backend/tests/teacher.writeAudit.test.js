import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Section, Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { Document } from '../src/models/document.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { Ticket, TicketMessage } from '../src/models/ticket.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import { CoCurricularActivity } from '../src/models/coCurricular.model.js';
import { Role } from '../src/models/role.model.js';
import * as registrations from '../src/modules/registrations/registration.service.js';
import * as cocurricular from '../src/modules/studentRequests/cocurricular.service.js';
import * as profileEdit from '../src/modules/studentRequests/profileEdit.service.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent, parseIntentWithLlm } from '../src/modules/ai/agent/intent.js';
import { capabilityIndex } from '../src/modules/ai/mcp/capabilities.js';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, seedPerson, inSchool, actorForRole, todayKey, OAK } from './support/mcpSchool.js';

/**
 * Teacher writes, through the real Ask AI route.
 *
 * The manual audit behind this file sent every Teacher CREATE, UPDATE, DELETE
 * and ACTION through POST /ai/agent and the signed WhatsApp webhook, and
 * followed each one to the database and the audit trail. What it found was in
 * the SHARED readers -- none of it was Teacher-specific, and none of the fixes
 * is a rule for one sentence:
 *
 *   names       "Mark Diya Kumar's attendance as present" marked a pupil called
 *               "Diya Kumar's attendance": the attendance rule kept its own
 *               name regex instead of the shared reader
 *   pupils      a capability that names pupils in a LIST (the register, the
 *               marks sheet) could not take one pupil named in a sentence
 *   records     a record named after its noun ("the course material Test
 *               notes", "the Bus timing ticket") was not read at all
 *   renames     "rename X to Y" was proposed as "Change nothing on X"
 *   tickets     the ticket resolver read the service's rows as tickets, so no
 *               ticket could ever be named
 *   answers     with no model, the answer to "Tell me a title." started a new
 *               request instead of finishing the one asked about
 *   refusals    "edit my announcement" and a named tool the teacher is not
 *               offered reached the server and came back as a scope error
 *
 * Every assertion is on a property: which capability, what was proposed, what
 * was written, what was audited, and that both channels agree.
 */

let api;
let school;
let world;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

/**
 * A teacher's week: Mathematics, Science and an Art elective in Class 6 A
 * (theirs, with Diya Kumar added to the register), Science in Class 6 B
 * (another teacher's), homework with Priya's submission, a Unit Test 2 paper,
 * two course materials, and one of each request a teacher decides.
 */
async function seedTeacherWorld() {
  const other = await seedPerson({ roleKey: 'TEACHER', roleId: school.roleIds.TEACHER, displayName: 'Other teacher' });
  return inSchool(OAK, async () => {
    const me = school.people.TEACHER.profile._id;
    await Section.updateOne({ _id: school.sectionB._id }, { classTeacherId: other.profile._id });
    const diya = await Student.create({ admissionNo: 'OAK-4', firstName: 'Diya', lastName: 'Kumar' });
    const diyaEnrollment = await Enrollment.create({ studentId: diya._id, sectionId: school.sectionA._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo: 4 });
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31') });
    const maths = await Subject.create({ name: 'Mathematics' });
    const science = await Subject.create({ name: 'Science' });
    const art = await Subject.create({ name: 'Art' });
    const mathsA = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: maths._id, termId: term._id, teacherId: me });
    await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: science._id, termId: term._id, teacherId: me });
    const scienceB = await SubjectOffering.create({ sectionId: school.sectionB._id, subjectId: science._id, termId: term._id, teacherId: other.profile._id });
    const artA = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: art._id, termId: term._id, teacherId: me, isElective: true, capacity: 30 });
    const homework = await Assignment.create({ subjectOfferingId: mathsA._id, title: 'Fractions worksheet', type: 'HOMEWORK', dueAt: new Date(Date.now() + 5 * 864e5) });
    await Assignment.create({ subjectOfferingId: scienceB._id, title: 'Plant cell diagram', dueAt: new Date(Date.now() + 3 * 864e5) });
    await Submission.create({ assignmentId: homework._id, enrollmentId: school.priya.enrollment._id, status: 'SUBMITTED', submittedAt: new Date() });
    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date(Date.now() + 10 * 864e5), endsOn: new Date(Date.now() + 14 * 864e5) });
    const paper = await ExamSubject.create({ examId: exam._id, subjectOfferingId: mathsA._id, maxMarks: 50 });
    const notes = await Document.create({ title: 'Fractions notes', type: 'CUSTOM', fileUrl: '/uploads/fractions.pdf', authorProfileId: me, sectionId: school.sectionA._id });
    const testNotes = await Document.create({ title: 'Test notes', type: 'CUSTOM', fileUrl: '/uploads/test.pdf', authorProfileId: me, sectionId: school.sectionA._id });
    const leave = await LeaveApplication.create({ enrollmentId: school.rahul.enrollment._id, fromDate: new Date(Date.now() + 20 * 864e5), toDate: new Date(Date.now() + 21 * 864e5), reason: 'Fever' });
    await registrations.register(school.people.STUDENT.actor, String(artA._id));
    await cocurricular.request(school.people.STUDENT.actor, { name: 'Science fair', activityDate: '2026-08-10' });
    await profileEdit.request(school.people.STUDENT.actor, { changes: { address: '22 Lake Road' } });
    const ticket = await Ticket.create({ subject: 'Bus timing', raisedByProfileId: school.people.PARENT.profile._id, routedToRoleKey: 'CLASS_TEACHER', assigneeProfileId: me, studentId: school.rahul.student._id });
    return { diyaEnrollment, homework, paper, notes, testNotes, leave, ticket };
  });
}

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
  world = await seedTeacherWorld();
});

const teacher = () => school.people.TEACHER;
const actor = () => teacher().actor;
const count = (Model, filter = {}) => inSchool(OAK, () => Model.countDocuments(filter));
const auditOf = (tool, status) => inSchool(OAK, () => AuditLog.findOne({ action: `agent.${tool}`, 'after.status': status }).lean());
const WA_FOOTER = /\.?\s*Reply YES to confirm or NO to cancel\. \(Expires in \d+ minutes\.\)$/;
const webWords = (reply) => String(reply ?? '').replace(/\.?\s*Shall I go ahead\?$/, '');
const waWords = (reply) => String(reply ?? '').replace(WA_FOOTER, '');

/** One request on the website and on WhatsApp; the WhatsApp proposal is withdrawn. */
async function bothChannels(message) {
  resetAgentThrottle();
  const web = await api.ask(teacher(), message);
  web.reply = web.reply ?? web.body?.message;
  resetAgentThrottle();
  const wa = await api.whatsapp(teacher(), message);
  if (WA_FOOTER.test(wa.reply ?? '')) await api.whatsapp(teacher(), 'NO');
  if (web.action?.confirmToken) await api.confirm(teacher(), web.action.confirmToken, false);
  return { web, wa };
}

/** A conversation, with the transcript the website client sends. */
async function converse(turns) {
  const history = [];
  let last = null;
  for (const message of turns) {
    resetAgentThrottle();
    last = await api.post(teacher(), '/ai/agent', { message, source: 'WEB', history: [...history] });
    last = { status: last.status, ...(last.body.data ?? {}), reply: last.body.data?.reply ?? last.body.message };
    history.push({ role: 'user', text: message }, { role: 'assistant', text: String(last.reply ?? '') });
  }
  return last;
}

/* ── 1. The surface ───────────────────────────────────────── */

describe('1. every Teacher write the Web offers is exposed, and nothing else', () => {
  const WRITES = [
    'create_assignment', 'create_announcement', 'create_course_material', 'update_course_material', 'delete_document',
    'mark_attendance', 'bulk_mark_attendance', 'enter_marks', 'publish_marks', 'grade_submission',
    'review_leave', 'decide_registration', 'decide_cocurricular', 'decide_profile_edit', 'reply_to_ticket',
  ];

  it('3 CREATE, 1 UPDATE, 1 DELETE, 10 ACTION -- 15 writes', () => {
    const offered = mcpToolsFor(actorForRole('TEACHER')).map((t) => t.name);
    const index = Object.fromEntries(capabilityIndex().map((c) => [c.name, c]));
    const writes = offered.filter((name) => index[name].operation !== 'GET').sort();
    expect(writes).toEqual([...WRITES].sort());
    const by = (op) => writes.filter((name) => index[name].operation === op).length;
    expect([by('CREATE'), by('UPDATE'), by('DELETE'), by('ACTION')]).toEqual([3, 1, 1, 10]);
    expect(offered).toHaveLength(56);
    // Every one of them asks before it writes.
    for (const name of writes) expect(index[name].confirms, name).toBe(true);
  });
});

/* ── 2. What each sentence is read as ─────────────────────── */

describe('2. the sentence is read into the right capability and arguments', () => {
  const today = () => todayKey().toISOString().slice(0, 10);
  const READINGS = [
    // Attendance: the person is the person, never "<name>'s attendance".
    ["Mark Diya Kumar's attendance as present for today.", 'mark_attendance', { students: [{ studentName: 'Diya Kumar', status: 'PRESENT' }] }],
    ["Mark Diya Kumar's attendance as absent for today.", 'mark_attendance', { students: [{ studentName: 'Diya Kumar', status: 'ABSENT' }] }],
    ["Mark Rahul Sharma's attendance as present today.", 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }],
    ['Record Rahul Sharma as present today.', 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }],
    ["Set Rahul Sharma's attendance to present for today.", 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }],
    ['Mark attendance for Rahul Sharma today.', 'mark_attendance', { students: [{ studentName: 'Rahul Sharma' }] }],
    ['Mark attendance of Rahul Sharma as present today.', 'mark_attendance', { students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }],
    ["Correct Rahul Sharma's attendance for 5 August 2026.", 'mark_attendance', { students: [{ studentName: 'Rahul Sharma' }], date: '2026-08-05' }],
    ['Mark all present in Class 6-A today.', 'mark_attendance', { className: 'Class 6-A', everyone: { status: 'PRESENT' } }],
    ['Mark everyone in Class 6-A present except Rahul Sharma.', 'mark_attendance', { everyone: { status: 'PRESENT' }, students: [{ studentName: 'Rahul Sharma', status: 'ABSENT' }] }],
    ['Mark the whole class present.', 'mark_attendance', { everyone: { status: 'PRESENT' } }],
    // Announcements: the audience and the words, kept apart.
    ["Announce that tomorrow's Mathematics class starts at 9 AM to Class 6-A.", 'create_announcement', { className: 'Class 6-A', title: "Tomorrow's Mathematics class starts at 9 AM" }],
    ['Create an announcement saying "Unit test is on Friday" for Class 6-A.', 'create_announcement', { className: 'Class 6-A', title: 'Unit test is on Friday' }],
    ['Send this announcement to Class 6-A: "Bring your practical file tomorrow."', 'create_announcement', { className: 'Class 6-A', title: 'Bring your practical file tomorrow.' }],
    ['Post an announcement to my Class 6-A.', 'create_announcement', { className: 'Class 6-A' }],
    // Homework: create_assignment, never generate_homework; a quoted "3" is a title.
    ['Create Mathematics homework for Class 6-A about fractions.', 'create_assignment', { className: 'Class 6-A', subject: 'Mathematics', title: 'fractions' }],
    ['Create an assignment for Class 6-A titled "Chapter 3".', 'create_assignment', { className: 'Class 6-A', title: 'Chapter 3' }],
    ['Give Class 6-A an assignment on algebra.', 'create_assignment', { className: 'Class 6-A', title: 'algebra' }],
    ['Create homework for my Science class.', 'create_assignment', { subject: 'Science' }],
    // Marks: one pupil, one number that IS marks.
    ['Enter marks for Rahul Sharma.', 'enter_marks', { students: [{ studentName: 'Rahul Sharma' }] }],
    ['Give Rahul Sharma 8 marks in Mathematics.', 'enter_marks', { subject: 'Mathematics', students: [{ studentName: 'Rahul Sharma', marks: 8 }] }],
    ["Record Rahul Sharma's Mathematics marks.", 'enter_marks', { subject: 'Mathematics', students: [{ studentName: 'Rahul Sharma' }] }],
    ["Update Rahul Sharma's Mathematics marks.", 'enter_marks', { subject: 'Mathematics', students: [{ studentName: 'Rahul Sharma' }] }],
    ['Publish Mathematics marks for Class 6-A.', 'publish_marks', { className: 'Class 6-A', subject: 'Mathematics' }],
    // Grading: the owner is not part of the title; marks for an assignment are a grade.
    ["Grade Priya Verma's Mathematics submission.", 'grade_submission', { studentName: 'Priya Verma', subject: 'Mathematics' }],
    ['Give Priya 8 marks for her Mathematics assignment.', 'grade_submission', { studentName: 'Priya', subject: 'Mathematics', marks: 8 }],
    // Course material: the record by its name, and a rename as two names.
    ['Update the course material Fractions notes.', 'update_course_material', { title: 'Fractions notes' }],
    ["Change the title of the course material 'Fractions notes' to 'Fractions notes v2'.", 'update_course_material', { title: 'Fractions notes', newTitle: 'Fractions notes v2' }],
    ['Rename course material Fractions notes to Fraction basics.', 'update_course_material', { title: 'Fractions notes', newTitle: 'Fraction basics' }],
    ['Delete the course material Test notes.', 'delete_document', { title: 'Test notes' }],
    // Tickets: the ticket by its headline, the reply by what it says.
    ['Reply to the Bus timing ticket: We will check the bus schedule.', 'reply_to_ticket', { subject: 'Bus timing', body: 'We will check the bus schedule' }],
    ['Reply to the ticket about bus timing saying we will check.', 'reply_to_ticket', { subject: 'bus timing', body: 'we will check' }],
    // Decisions.
    ["Approve Rahul Sharma's leave.", 'review_leave', { studentName: 'Rahul Sharma', status: 'APPROVED' }],
    ["Approve Priya Verma's elective registration.", 'decide_registration', { studentName: 'Priya Verma', status: 'APPROVED' }],
    ["Approve Priya Verma's co-curricular request.", 'decide_cocurricular', { studentName: 'Priya Verma', status: 'APPROVED' }],
    ["Approve Priya Verma's profile edit request.", 'decide_profile_edit', { studentName: 'Priya Verma', status: 'APPROVED' }],
  ];

  for (const [message, tool, args] of READINGS) {
    it(`"${message}" → ${tool}`, () => {
      const step = parseIntent(message, actor());
      expect(step?.tool).toBe(tool);
      expect(step.args).toMatchObject(args);
    });
  }

  it('a single pupil is never widened to the whole register', () => {
    for (const message of ["Mark Diya Kumar's attendance as present for today.", 'Mark Rahul Sharma present today.', 'Record Rahul Sharma as present today.']) {
      expect(parseIntent(message, actor()).args.everyone, message).toBeUndefined();
    }
  });

  it('a relative day is written as a date', () => {
    expect(parseIntent("Mark Diya Kumar's attendance as present for today.", actor()).args.date).toBe(today());
  });
});

/* ── 3. Both channels, same capability, same words ────────── */

describe('3. the website and WhatsApp propose the same write in the same words', () => {
  const PROPOSED = [
    ["Mark Diya Kumar's attendance as present for today.", 'mark_attendance', /Diya Kumar → PRESENT in Class 6 - A/],
    ['Record Rahul Sharma as present today.', 'mark_attendance', /Rahul Sharma → PRESENT/],
    ['Mark all present in Class 6-A today.', 'mark_attendance', /everyone \(4\) → PRESENT in Class 6 A/],
    ["Announce that tomorrow's Mathematics class starts at 9 AM to Class 6-A.", 'create_announcement', /"Tomorrow's Mathematics class starts at 9 AM" to Class 6 A/],
    ['Give Rahul Sharma 8 marks in Mathematics.', 'enter_marks', /Mathematics \(Unit Test 2\) for Class 6 A: Rahul Sharma 8/],
    ['Give Priya 8 marks for her Mathematics assignment.', 'grade_submission', /Priya Verma's submission for "Fractions worksheet" with 8 mark/],
    ['Rename course material Fractions notes to Fraction basics.', 'update_course_material', /Rename course material "Fractions notes" to "Fraction basics"/],
    ['Delete the course material Test notes.', 'delete_document', /delete the custom "Test notes"/],
    ['Reply to the Bus timing ticket: We will check the bus schedule.', 'reply_to_ticket', /"Bus timing" ticket: "We will check the bus schedule"/],
    ["Approve Priya Verma's co-curricular request.", 'decide_cocurricular', /co-curricular request from Priya Verma/],
  ];

  for (const [message, tool, summary] of PROPOSED) {
    it(`"${message}"`, async () => {
      const { web, wa } = await bothChannels(message);
      expect(web.action?.tool).toBe(tool);
      expect(web.action.summary).toMatch(summary);
      expect(waWords(wa.reply)).toBe(webWords(web.reply));
    }, 60000);
  }

  it('what is missing is asked for by name, and nothing is proposed', async () => {
    for (const [message, asks] of [
      ['Mark attendance for Rahul Sharma today.', /Tell me the status/],
      ['Create Mathematics homework for Class 6-A about fractions.', /Tell me the due date/],
      ['Create an assignment.', /Tell me a title and the due date/],
      ['Send an announcement to Class 6-A.', /Tell me a title/],
      ['Enter marks for Rahul Sharma.', /Tell me the marks/],
      ["Grade Priya's submission.", /Tell me the marks/],
      ['Add course material for Class 6-A.', /Tell me a title and the uploaded file/],
      ['Update the course material Fractions notes.', /What should change: its title, its file or its class/],
    ]) {
      const { web, wa } = await bothChannels(message);
      expect(web.reply, message).toMatch(asks);
      expect(wa.reply, message).toBe(web.reply);
      expect(web.action ?? null, message).toBeNull();
    }
  }, 120000);
});

/* ── 4. Confirmed, written, audited ───────────────────────── */

describe('4. each write is written only on confirmation, and audited', () => {
  const WRITES = [
    ["Mark Diya Kumar's attendance as present for today.", 'mark_attendance',
      async () => (await inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: world.diyaEnrollment._id, date: todayKey() }).lean()))?.status, 'PRESENT'],
    ["Correct Rahul Sharma's attendance to present for 5 August 2026.", 'mark_attendance',
      async () => (await inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.rahul.enrollment._id, date: new Date(Date.UTC(2026, 7, 5)) }).lean()))?.status, 'PRESENT'],
    ["Announce that tomorrow's Mathematics class starts at 9 AM to Class 6-A.", 'create_announcement',
      async () => (await inSchool(OAK, () => Announcement.findOne({ title: /class starts at 9 AM/ }).lean()))?.audience.sectionIds.map(String), () => [String(school.sectionA._id)]],
    ['Create Mathematics homework for Class 6-A about fractions due 2026-10-05.', 'create_assignment',
      () => count(Assignment, { title: 'fractions', dueAt: new Date('2026-10-05') }), 1],
    ['Give Rahul Sharma 44 marks in Mathematics Unit Test 2.', 'enter_marks',
      async () => (await inSchool(OAK, () => Mark.findOne({ examSubjectId: world.paper._id, enrollmentId: school.rahul.enrollment._id }).lean()))?.marks, 44],
    ['Give Priya 8 marks for her Mathematics assignment.', 'grade_submission',
      async () => (await inSchool(OAK, () => Submission.findOne({ assignmentId: world.homework._id }).lean()))?.marks, 8],
    ["Rename the course material 'Fractions notes' to 'Fraction basics'.", 'update_course_material',
      async () => (await inSchool(OAK, () => Document.findById(world.notes._id).lean()))?.title, 'Fraction basics'],
    ['Delete the course material Test notes.', 'delete_document',
      () => count(Document, { _id: world.testNotes._id }), 0],
    ["Approve Rahul Sharma's leave.", 'review_leave',
      async () => (await inSchool(OAK, () => LeaveApplication.findById(world.leave._id).lean()))?.status, 'APPROVED'],
    ["Approve Priya Verma's elective registration.", 'decide_registration',
      async () => (await inSchool(OAK, () => SubjectRegistration.findOne({}).lean()))?.status, 'APPROVED'],
    ["Approve Priya Verma's co-curricular request.", 'decide_cocurricular',
      async () => (await inSchool(OAK, () => CoCurricularActivity.findOne({}).lean()))?.status, 'APPROVED'],
    ["Approve Priya Verma's profile edit request.", 'decide_profile_edit',
      async () => (await inSchool(OAK, () => Student.findById(school.priya.student._id).lean()))?.address, '22 Lake Road'],
    ['Reply to the Bus timing ticket: We will check the bus schedule.', 'reply_to_ticket',
      () => count(TicketMessage, { ticketId: world.ticket._id }), 1],
  ];

  for (const [message, tool, read, expected] of WRITES) {
    it(`${tool}: "${message}"`, async () => {
      const before = await read();
      const res = await api.ask(teacher(), message);
      expect(res.action?.tool).toBe(tool);
      // Nothing is written by the proposal.
      expect(await read()).toEqual(before);
      const done = await api.confirm(teacher(), res.action.confirmToken);
      expect(done.status).toBe(200);
      expect(done.executed).toBe(true);
      expect(await read()).toEqual(typeof expected === 'function' ? expected() : expected);
      expect((await auditOf(tool, 'EXECUTED'))?.after.confirmed).toBe(true);
    }, 60000);
  }

  it('the whole register: every pupil gets the status, the named exception gets the other', async () => {
    const res = await api.ask(teacher(), 'Mark everyone in Class 6-A present except Rahul Sharma.');
    expect(res.action.summary).toMatch(/Rahul Sharma → ABSENT, everyone else \(3\) → PRESENT in Class 6 A/);
    await api.confirm(teacher(), res.action.confirmToken);
    const rows = await inSchool(OAK, () => AttendanceRecord.find({ date: todayKey(), periodNo: null }).lean());
    const byEnrollment = Object.fromEntries(rows.map((r) => [String(r.enrollmentId), r.status]));
    expect(byEnrollment[String(school.rahul.enrollment._id)]).toBe('ABSENT');
    for (const e of [school.priya.enrollment, school.aman.enrollment, world.diyaEnrollment]) {
      expect(byEnrollment[String(e._id)]).toBe('PRESENT');
    }
    // Class 6 B's register is untouched.
    expect(byEnrollment[String(school.riya.enrollment._id)]).toBeUndefined();
  }, 60000);

  it('publishing makes the entered marks visible', async () => {
    await inSchool(OAK, () => Mark.create({ examSubjectId: world.paper._id, enrollmentId: school.rahul.enrollment._id, marks: 41, status: 'DRAFT' }));
    const res = await api.ask(teacher(), 'Publish Mathematics marks for Class 6-A.');
    expect(res.action.tool).toBe('publish_marks');
    await api.confirm(teacher(), res.action.confirmToken);
    expect(await count(Mark, { examSubjectId: world.paper._id, status: 'PUBLISHED' })).toBe(1);
  }, 60000);

  it('WhatsApp: "Mark Rahul Sharma present today." then "Yes" writes and audits', async () => {
    const proposal = await api.whatsapp(teacher(), 'Mark Rahul Sharma present today.');
    expect(proposal.reply).toMatch(/Rahul Sharma → PRESENT[\s\S]*Reply YES/);
    const yes = await api.whatsapp(teacher(), 'Yes');
    expect(yes.reply).toMatch(/Attendance recorded: Rahul Sharma → PRESENT/);
    const row = await inSchool(OAK, () => AttendanceRecord.findOne({ enrollmentId: school.rahul.enrollment._id, date: todayKey() }).lean());
    expect(row.status).toBe('PRESENT');
    expect(await auditOf('mark_attendance', 'EXECUTED')).not.toBeNull();
  }, 60000);

  it('a permission withdrawn between the proposal and the yes stops the write', async () => {
    const res = await api.ask(teacher(), 'Send an announcement to Class 6-A: Bring your practical file tomorrow.');
    expect(res.action.tool).toBe('create_announcement');
    await Role.updateOne({ key: 'TEACHER' }, { $pull: { permissions: { key: 'announcements.publish' } } });
    const done = await api.confirm(teacher(), res.action.confirmToken);
    expect(done.status).toBe(403);
    expect(await count(Announcement, { title: /practical file/ })).toBe(0);
    expect(await auditOf('create_announcement', 'FORBIDDEN')).not.toBeNull();
  }, 60000);
});

/* ── 5. Answering the question the assistant asked ────────── */

describe('5. an answer finishes the request it answers', () => {
  it('homework: title, then due date, then a proposal', async () => {
    const last = await converse(['Create Mathematics homework for Class 6-A.', 'Fractions and decimals.', '5 October 2026']);
    expect(last.action?.tool).toBe('create_assignment');
    expect(last.action.summary).toMatch(/"Fractions and decimals" \(Mathematics\) for Class 6 A, due 2026-10-05/);
    await api.confirm(teacher(), last.action.confirmToken);
    expect(await count(Assignment, { title: 'Fractions and decimals' })).toBe(1);
  }, 90000);

  it('an announcement: the words, then a proposal to the class named first', async () => {
    const last = await converse(['Send an announcement to Class 6-A.', 'Bring your practical file tomorrow.']);
    expect(last.action?.tool).toBe('create_announcement');
    expect(last.action.summary).toMatch(/"Bring your practical file tomorrow" to Class 6 A/);
    await api.confirm(teacher(), last.action.confirmToken);
    const posted = await inSchool(OAK, () => Announcement.findOne({ title: 'Bring your practical file tomorrow' }).lean());
    expect(posted.audience.sectionIds.map(String)).toEqual([String(school.sectionA._id)]);
  }, 90000);

  it('a subject and class, then a title, then a date', async () => {
    const last = await converse(['Create an assignment.', 'Mathematics for Class 6-A', 'Algebra basics', '2026-10-09']);
    expect(last.action?.summary).toMatch(/"Algebra basics" \(Mathematics\) for Class 6 A, due 2026-10-09/);
  }, 90000);

  it('a status, a marks sheet, a number of marks, a grade', async () => {
    expect((await converse(['Mark attendance for Rahul Sharma today.', 'present'])).action?.summary).toMatch(/Rahul Sharma → PRESENT/);
    expect((await converse(['Record marks for Class 6-A Mathematics Unit Test 2.', 'Rahul Sharma 44'])).action?.summary).toMatch(/Rahul Sharma 44/);
    expect((await converse(["Update Rahul Sharma's Mathematics marks.", '45'])).action?.summary).toMatch(/Rahul Sharma 45/);
    expect((await converse(["Grade Priya Verma's Fractions worksheet.", '9'])).action?.summary).toMatch(/with 9 mark/);
  }, 120000);

  it('WhatsApp finishes the same request from its own transcript', async () => {
    for (const turn of ['Create an assignment.', 'Mathematics for Class 6-A', 'Algebra basics']) {
      resetAgentThrottle();
      await api.whatsapp(teacher(), turn);
    }
    resetAgentThrottle();
    const last = await api.whatsapp(teacher(), '2026-10-09');
    expect(last.reply).toMatch(/"Algebra basics" \(Mathematics\) for Class 6 A, due 2026-10-09[\s\S]*Reply YES/);
    await api.whatsapp(teacher(), 'YES');
    expect(await count(Assignment, { title: 'Algebra basics' })).toBe(1);
  }, 120000);

  it('a new request is a new request, not an answer', async () => {
    const last = await converse(['Create an announcement for Class 6-A.', 'Show my timetable for today.']);
    expect(last.action ?? null).toBeNull();
    expect(await count(Announcement, { title: /timetable/i })).toBe(0);
  }, 90000);

  it('a proposal already made is not reopened by the next message', async () => {
    const history = [
      { role: 'user', text: 'Send an announcement to Class 6-A: Sports day on Friday' },
      { role: 'assistant', text: 'Post the announcement "Sports day on Friday" to Class 6 A. Shall I go ahead?' },
    ];
    const step = await parseIntentWithLlm('Fractions and decimals.', actor(), { history });
    expect(step?.tool).not.toBe('create_announcement');
  });

  it('the answer names only what the teacher wrote; nothing is taken from the assistant', async () => {
    const history = [
      { role: 'user', text: 'Send an announcement to Class 6-A.' },
      { role: 'assistant', text: 'I need a bit more to do that. Tell me a title. (Class 6 B also has a trip.)' },
    ];
    const step = await parseIntentWithLlm('Bring the trip form.', actor(), { history });
    expect(step).toMatchObject({ tool: 'create_announcement', args: { className: 'Class 6-A', title: 'Bring the trip form' } });
  });
});

/* ── 6. Not offered: said so, and nothing runs ────────────── */

describe('6. writes the Web does not offer a teacher are declined before any capability runs', () => {
  const DECLINED = [
    ['Edit my previous announcement.', /can't edit an announcement/],
    ['Generate AI homework using generate_homework.', /can't generate homework/],
    ['Create a calendar event for sports day on 10 October 2026.', /can't create the calendar/],
    ['Delete all assignments.', /can't delete homework/],
    ['Delete the test assignment.', /can't delete homework/],
    ['Delete all students.', /can't delete a student/],
    ['Update the homework deadline.', /can't update homework/],
    ['Deleting or updating homework', /can't delete homework/],
  ];

  for (const [message, reply] of DECLINED) {
    it(`"${message}"`, async () => {
      const since = new Date();
      const { web, wa } = await bothChannels(message);
      expect(web.reply).toMatch(reply);
      expect(wa.reply).toBe(web.reply);
      expect(web.action ?? null).toBeNull();
      // Declined before any capability was chosen: no MCP call on either channel.
      expect(await count(AuditLog, { 'after.via': 'MCP', createdAt: { $gte: since } })).toBe(0);
    }, 60000);
  }
});
