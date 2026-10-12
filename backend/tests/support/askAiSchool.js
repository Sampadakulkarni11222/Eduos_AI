import { Student, Enrollment } from '../../src/models/student.model.js';
import { Grade, Section, Subject, SubjectOffering, Term } from '../../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../../src/models/exam.model.js';
import { Assignment } from '../../src/models/assignment.model.js';
import { AttendanceRecord } from '../../src/models/attendanceRecord.model.js';
import { TimetableSlot } from '../../src/models/timetableSlot.model.js';
import { Book, BookIssue } from '../../src/models/library.model.js';
import { HostelRoom, HostelAllocation } from '../../src/models/hostel.model.js';
import { AuditLog } from '../../src/models/auditLog.model.js';
import { runAgentSafely } from '../../src/modules/ai/agent/orchestrator.js';
import { resetAgentThrottle } from '../../src/modules/ai/agent/throttle.js';
import { seedSchool, inSchool, todayKey, OAK } from './mcpSchool.js';

/**
 * The school the reported-defect suites share: seedSchool() (see mcpSchool.js)
 * plus the classes, subjects, timetable, marks, homework, library and hostel
 * the reported conversations are about. Written through the real models, so
 * every tool under test reads what a real school would hold.
 *
 * On top of seedSchool()'s Class 6 A / 6 B:
 *
 *   Class 5 A   class teacher TEACHER — Aarav Mishra (OAK-51), Ananya Mishra (OAK-52)
 *   Class 10 A  no class teacher      — Tara Iyer (admission no "1024"), Dev Sharma (OAK-102)
 *   Class 10 B                        — Meera Nair (OAK-103), Rohan Desai (OAK-104)
 *   Class 9 B   nothing to do with TEACHER — Ishaan Bose (OAK-91)
 *
 *   TEACHER teaches   Mathematics + Science in 5 A, Science in 6 B, Mathematics in 6 A
 *   PRINCIPAL teaches English in 6 B, Mathematics in 10 A and 9 B  (so "not the
 *                     teacher's" classes have real work in them)
 *
 * Attendance (day-level), the 19 days before today and today:
 *   Aarav 100%, Ananya alternating (absent today), Tara 100%, Dev absent every third day,
 *   Meera alternating, Rohan absent every day  → Class 10 B is clearly lowest.
 */
export async function seedAskAiSchool() {
  const school = await seedSchool();
  const extra = await inSchool(OAK, async () => {
    const teacherId = school.people.TEACHER.profile._id;
    const principalId = school.people.PRINCIPAL.profile._id;
    const section = async (gradeName, level, name, classTeacherId) => {
      const grade = (await Grade.findOne({ name: gradeName })) ?? (await Grade.create({ name: gradeName, level }));
      return Section.create({ gradeId: grade._id, name, ...(classTeacherId && { classTeacherId }) });
    };
    const c5a = await section('Class 5', 5, 'A', teacherId);
    const c10a = await section('Class 10', 10, 'A');
    const c10b = await section('Class 10', 10, 'B');
    const c9b = await section('Class 9', 9, 'B');

    const enrol = async (admissionNo, firstName, lastName, sec, rollNo) => {
      const student = await Student.create({ admissionNo, firstName, lastName });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: sec._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };
    const aarav = await enrol('OAK-51', 'Aarav', 'Mishra', c5a, 1);
    const ananya = await enrol('OAK-52', 'Ananya', 'Mishra', c5a, 2);
    const tara = await enrol('1024', 'Tara', 'Iyer', c10a, 1);
    const dev = await enrol('OAK-102', 'Dev', 'Sharma', c10a, 2);
    const meera = await enrol('OAK-103', 'Meera', 'Nair', c10b, 1);
    const rohan = await enrol('OAK-104', 'Rohan', 'Desai', c10b, 2);
    const ishaan = await enrol('OAK-91', 'Ishaan', 'Bose', c9b, 1);

    const day = 86_400_000;
    const mark = (who, date, status) => AttendanceRecord.create({ enrollmentId: who.enrollment._id, date, periodNo: null, status });
    const marks = [];
    for (let back = 0; back < 20; back += 1) {
      const date = new Date(todayKey().getTime() - back * day);
      marks.push(
        mark(aarav, date, 'PRESENT'),
        mark(ananya, date, back % 2 ? 'PRESENT' : 'ABSENT'),
        mark(tara, date, 'PRESENT'),
        mark(dev, date, back % 3 ? 'PRESENT' : 'ABSENT'),
        mark(meera, date, back % 2 ? 'PRESENT' : 'ABSENT'),
        mark(rohan, date, 'ABSENT'),
      );
    }
    await Promise.all(marks);

    const term = await Term.create({
      academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
    });
    const maths = await Subject.create({ name: 'Mathematics' });
    const science = await Subject.create({ name: 'Science' });
    const english = await Subject.create({ name: 'English' });
    const offer = (sec, subject, who) => SubjectOffering.create({ sectionId: sec._id, subjectId: subject._id, termId: term._id, teacherId: who });
    const m5 = await offer(c5a, maths, teacherId);
    const s5 = await offer(c5a, science, teacherId);
    const s6b = await offer(school.sectionB, science, teacherId);
    const m6a = await offer(school.sectionA, maths, teacherId);
    const e6b = await offer(school.sectionB, english, principalId);
    const m10a = await offer(c10a, maths, principalId);
    const m9b = await offer(c9b, maths, principalId);

    const due = (days) => new Date(Date.now() + days * day);
    await Assignment.create({ subjectOfferingId: s5._id, title: 'Plant cell diagram', dueAt: due(1) });
    await Assignment.create({ subjectOfferingId: m5._id, title: 'Fractions worksheet', dueAt: due(2) });
    await Assignment.create({ subjectOfferingId: m6a._id, title: 'Algebra set 1', dueAt: due(3) });
    await Assignment.create({ subjectOfferingId: m9b._id, title: 'UNRELATED class 9 work', dueAt: due(1) });
    await Assignment.create({ subjectOfferingId: m10a._id, title: 'UNRELATED class 10 work', dueAt: due(1) });

    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-09-05') });
    const paper = (offering) => ExamSubject.create({ examId: exam._id, subjectOfferingId: offering._id, maxMarks: 50 });
    const score = (p, who, marks) => Mark.create({ examSubjectId: p._id, enrollmentId: who.enrollment._id, marks, status: 'PUBLISHED' });
    const p5 = await paper(m5);
    await score(p5, aarav, 45);
    await score(p5, ananya, 30);
    const p10 = await paper(m10a);
    await score(p10, tara, 48);
    await score(p10, dev, 21);
    const p6 = await paper(m6a);
    await score(p6, school.priya, 40);
    await score(p6, school.rahul, 35);

    // The same grid every day of the week, so a test does not depend on which
    // weekday it runs on. TEACHER: 5 A P1, 6 B P2, 6 A P6.
    const slots = [];
    for (let dow = 1; dow <= 7; dow += 1) {
      const slot = (sec, periodNo, startTime, endTime, offering) => TimetableSlot.create({
        sectionId: sec._id, dayOfWeek: dow, periodNo, startTime, endTime, subjectOfferingId: offering._id,
      });
      slots.push(
        slot(c5a, 1, '09:00', '09:45', m5),
        slot(school.sectionB, 2, '09:45', '10:30', s6b),
        slot(school.sectionA, 6, '14:00', '14:45', m6a),
        slot(school.sectionB, 3, '10:30', '11:15', e6b),
        slot(c10a, 1, '09:00', '09:45', m10a),
      );
    }
    await Promise.all(slots);

    const cleanCode = await Book.create({ title: 'Clean Code', author: 'Robert Martin', totalCopies: 3, availableCopies: 2 });
    const wings = await Book.create({ title: 'Wings of Fire', author: 'APJ Abdul Kalam', totalCopies: 2, availableCopies: 1 });
    // Priya (the STUDENT profile) is late with Clean Code; the due date has
    // passed but the row is still ACTIVE, as it is until something re-marks it.
    await BookIssue.create({
      bookId: cleanCode._id, borrowerProfileId: school.people.STUDENT.profile._id, borrowerName: 'Priya Verma',
      dueDate: new Date(Date.now() - 5 * day), status: 'ACTIVE',
    });
    await BookIssue.create({
      bookId: wings._id, borrowerProfileId: school.people.TEACHER.profile._id, borrowerName: 'TEACHER user',
      dueDate: new Date(Date.now() + 5 * day), status: 'ACTIVE',
    });

    const room = await HostelRoom.create({ roomNo: 'H-101', capacity: 4, type: 'BOYS' });
    await HostelAllocation.create({ roomId: room._id, studentId: school.rahul.student._id, academicYearId: school.year._id });

    return {
      c5a, c10a, c10b, c9b, aarav, ananya, tara, dev, meera, rohan, ishaan, term,
      maths, science, english, offerings: { m5, s5, s6b, m6a, e6b, m10a, m9b }, cleanCode, wings, room,
    };
  });
  return { ...school, ...extra };
}

/**
 * One person's conversation with the assistant, on one channel.
 *
 * `say()` runs a turn through the shared orchestrator -- the function both the
 * website route and the WhatsApp bridge call -- carrying the transcript so far
 * exactly as each channel does, and returns what the person would see plus the
 * MCP calls the turn made (read from the audit trail, not from the reply).
 */
export function conversationAs(school, roleKey, { source = 'WEB', tenant = OAK } = {}) {
  const actor = school.people[roleKey].actor;
  const history = [];
  return {
    actor,
    history,
    async say(message) {
      resetAgentThrottle();
      const before = await inSchool(tenant, () => AuditLog.countDocuments({}));
      let result = null;
      let error = null;
      try {
        result = await inSchool(tenant, () => runAgentSafely({ message, actor, source, history: [...history] }));
      } catch (err) {
        error = err;
      }
      const entries = await inSchool(tenant, () => AuditLog.find({}).sort({ _id: 1 }).skip(before).lean());
      const calls = entries
        .filter((e) => e.after?.via === 'MCP')
        .map((e) => ({ tool: e.action.replace(/^agent\./, ''), args: e.after?.request ?? {}, status: e.after?.status }));
      const reply = String(result?.reply ?? error?.message ?? '');
      history.push({ role: 'user', text: message }, { role: 'assistant', text: reply });
      return {
        reply,
        result,
        error,
        status: error?.statusCode ?? 200,
        calls,
        tool: calls.at(-1)?.tool ?? null,
        args: calls.at(-1)?.args ?? null,
        tools: calls.map((c) => c.tool),
        action: result?.action ?? null,
        refused: result?.refused ?? null,
      };
    },
  };
}

/** Text that must never reach a person: tool names, schema words, ids, stack traces, file paths. */
export const INTERNAL_LEAKS = [
  /\bget_[a-z_]+\b/, /\blist_[a-z_]+\b/, /\bcreate_[a-z_]+\b/, /inputSchema/i, /additionalProperties/i,
  /subjectOfferingId/i, /enrollmentId/i, /\b[a-f0-9]{24}\b/, /\bat\s+\S+\s+\(.*:\d+:\d+\)/, /node_modules/i,
  /[A-Za-z]:\\[\w\\ .-]+\.js/, /\/src\/modules\//, /MongoServerError|MongooseError|ECONNREFUSED/i,
];
