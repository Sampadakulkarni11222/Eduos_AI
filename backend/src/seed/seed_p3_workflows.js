import mongoose from 'mongoose';
import { Grade, Subject, SubjectOffering, AcademicYear } from '../models/academics.model.js';
import { Student, StudentGuardian } from '../models/student.model.js';
import { Profile } from '../models/profile.model.js';
import { Ticket, TicketMessage } from '../models/ticket.model.js';
import { LeaveApplication } from '../models/leaveApplication.model.js';
import { SubjectRegistration } from '../models/subjectRegistration.model.js';
import { CoCurricularActivity } from '../models/coCurricular.model.js';
import { ProfileEditRequest } from '../models/profileEditRequest.model.js';
import { DocumentType, DocumentRequest } from '../models/documentRequest.model.js';
import { Quiz, QuizAttempt } from '../models/quiz.model.js';
import { Book, BookIssue } from '../models/library.model.js';
import { BookRequest } from '../models/bookRequest.model.js';
import { HostelRoom, HostelAllocation, HostelInquiry } from '../models/hostel.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../models/transport.model.js';
import { TransportRequest } from '../models/transportRequest.model.js';
import { Announcement } from '../models/announcement.model.js';
import { CalendarEvent } from '../models/calendarEvent.model.js';
import { Lead } from '../models/lead.model.js';
import { currentTenantId } from '../tenancy/tenantContext.js';

/**
 * Part-3 sample data, second half (all FICTIONAL): the everyday workflows of
 * every portal — help-desk tickets, student requests, quizzes, library
 * circulation, hostel and transport, notices and events, eighteen months of
 * enquiries, alumni, staff leave, payslips, tasks for each role, approvals in
 * every state, policies in force, repairs, a board meeting held, mentoring and
 * digest interests. Called from seed_p3_sampledata.js; each section checks its
 * own marker so a second run adds nothing.
 */
const DAY = 86_400_000;
const { ObjectId } = mongoose.Types;
const utcDay = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const ymdOf = (d) => d.toISOString().slice(0, 10);
const atIst = (day, hour = 10, minute = 0) => new Date(day.getTime() + (hour * 60 + minute - 330) * 60_000);

async function bulk(Model, docs, { chunk = 2000 } = {}) {
  const tenantId = currentTenantId();
  for (let i = 0; i < docs.length; i += chunk) {
    const part = docs.slice(i, i + chunk);
    if (tenantId) for (const d of part) d.tenantId = tenantId;
    // eslint-disable-next-line no-await-in-loop
    await Model.insertMany(part, { ordered: false, timestamps: false });
  }
  return docs.length;
}

export async function seedP3Workflows({ section, attempt, who, teachers = [], actorOf, roleByKey }, base) {
  const { ADMIN, PRINCIPAL, TEACHER, FINANCE, HR, MARKETING, COMPLIANCE, LIBRARIAN, WARDEN, STUDENT, PARENT, TRUSTEE, ALUMNUS } = who;
  const { enrolments, bySection, sections, sectionLabel, coreOfferings, today, random, pick, year } = base;
  const now = new Date();
  const daysAgo = (n, hour = 11) => atIst(new Date(today.getTime() - n * DAY), hour);
  const daysAhead = (n, hour = 11) => atIst(new Date(today.getTime() + n * DAY), hour);
  const students = await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) } }).select('_id firstName lastName admissionNo gender profileId').lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const nameOf = (sid) => { const s = studentById.get(String(sid)); return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Student'; };
  const enrolmentOf = new Map(enrolments.map((e) => [String(e.studentId), e]));
  const guardians = await StudentGuardian.find({ studentId: { $in: enrolments.map((e) => e.studentId) } }).select('studentId guardianProfileId').lean();
  const guardianOf = new Map(guardians.map((g) => [String(g.studentId), g.guardianProfileId]));
  const demoStudent = STUDENT ? await Student.findOne({ profileId: STUDENT.profile._id }).lean() : null;
  const demoChildIds = PARENT ? (await StudentGuardian.find({ guardianProfileId: PARENT.profile._id }).lean()).map((g) => String(g.studentId)) : [];
  // The demo teacher's own classes (taught or led), so their queues are not empty.
  const teacherSectionIds = TEACHER ? [...new Set([
    ...coreOfferings.filter((o) => String(o.teacherId) === TEACHER.id).map((o) => String(o.sectionId)),
    ...sections.filter((s) => String(s.classTeacherId ?? '') === TEACHER.id).map((s) => String(s._id)),
  ])] : [];
  const fromSections = (ids, n) => {
    const pool = ids.flatMap((id) => bySection.get(String(id)) ?? []);
    const out = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool[Math.floor(random() * pool.length)]);
    return out;
  };
  const staffList = [ADMIN, PRINCIPAL, FINANCE, HR, MARKETING, COMPLIANCE, LIBRARIAN, WARDEN, TEACHER].filter(Boolean);

  // ── Help desk ────────────────────────────────────────────────────────────
  await section('Help-desk tickets (every route, every state)', null, async () => {
    if (await Ticket.exists({ subject: /\(sample\)$/ })) return 'kept';
    const plan = [
      // [raisedBy, routedTo, assignee, subject, status, priority, daysAgo, studentId]
      [PARENT, 'ADMIN', ADMIN, 'Fee receipt for the annual charges not received (sample)', 'OPEN', 'NORMAL', 3, demoChildIds[0]],
      [PARENT, 'CLASS_TEACHER', null, 'Homework diary not signed last week (sample)', 'RESOLVED', 'LOW', 12, demoChildIds[0]],
      [PARENT, 'LIBRARIAN', LIBRARIAN, 'Lost library book: how do we pay? (sample)', 'WAITING', 'NORMAL', 6, demoChildIds[0]],
      [PARENT, 'WARDEN', WARDEN, 'Laundry not returned on Sunday (sample)', 'NEW', 'NORMAL', 1, demoChildIds[0]],
      [PARENT, 'ADMIN', ADMIN, 'Change of address for school records (sample)', 'CLOSED', 'LOW', 40, demoChildIds[0]],
      [STUDENT, 'LIBRARIAN', LIBRARIAN, 'Request to extend my loan by a week (sample)', 'OPEN', 'LOW', 2, demoStudent?._id],
      [STUDENT, 'ADMIN', ADMIN, 'ID card photo is blurred (sample)', 'NEW', 'NORMAL', 0, demoStudent?._id],
      [STUDENT, 'WARDEN', WARDEN, 'Fan in room A02 makes a noise (sample)', 'RESOLVED', 'NORMAL', 9, demoStudent?._id],
      [STUDENT, 'CLASS_TEACHER', null, 'Missed the science practical: can I redo it? (sample)', 'OPEN', 'NORMAL', 4, demoStudent?._id],
    ];
    // Other families' tickets, so each queue has a realistic volume.
    const others = fromSections(sections.map((s) => s._id), 26);
    const subjects = [
      ['ADMIN', 'Bus pass not issued yet (sample)'], ['ADMIN', 'Transfer certificate needed urgently (sample)'], ['ADMIN', 'Concession form submitted, no reply (sample)'],
      ['CLASS_TEACHER', 'Child feels unwell after lunch, please watch (sample)'], ['CLASS_TEACHER', 'Request for extra maths practice (sample)'], ['CLASS_TEACHER', 'Seat change request (sample)'],
      ['LIBRARIAN', 'Book damaged when issued (sample)'], ['LIBRARIAN', 'Fine charged twice (sample)'],
      ['WARDEN', 'Weekend visit timing (sample)'], ['WARDEN', 'Mess food too spicy (sample)'],
    ];
    const statuses = ['NEW', 'OPEN', 'OPEN', 'WAITING', 'RESOLVED', 'RESOLVED', 'CLOSED'];
    for (const [i, e] of others.entries()) {
      const [route, subject] = subjects[i % subjects.length];
      const gp = guardianOf.get(String(e.studentId));
      if (!gp) continue;
      const assignee = route === 'LIBRARIAN' ? LIBRARIAN : route === 'WARDEN' ? WARDEN : route === 'ADMIN' ? (i % 2 ? ADMIN : null) : null;
      plan.push([{ id: String(gp) }, route, assignee, subject, statuses[i % statuses.length], i % 9 === 0 ? 'HIGH' : 'NORMAL', 1 + (i * 3) % 45, e.studentId]);
    }
    const tickets = []; const messages = [];
    for (const [by, route, assignee, subject, status, priority, ago, studentId] of plan) {
      if (!by) continue;
      let assigneeId = assignee?.id ?? null;
      if (route === 'CLASS_TEACHER' && studentId) {
        const e = enrolmentOf.get(String(studentId));
        const sec = e && sections.find((s) => String(s._id) === String(e.sectionId));
        assigneeId = sec?.classTeacherId ? String(sec.classTeacherId) : TEACHER?.id ?? null;
      }
      const at = daysAgo(ago, 9 + (ago % 8));
      const t = { _id: new ObjectId(), subject, status, priority, raisedByProfileId: new ObjectId(by.id), routedToRoleKey: route, assigneeProfileId: assigneeId ? new ObjectId(assigneeId) : null, studentId: studentId ? new ObjectId(String(studentId)) : null, documentUrl: null, documentName: null, createdAt: at, updatedAt: new Date(Math.min(now.getTime(), at.getTime() + DAY)) };
      tickets.push(t);
      messages.push({ ticketId: t._id, authorProfileId: t.raisedByProfileId, body: `${subject.replace(/ \(sample\)$/, '')}. Please help. (Sample message.)`, channel: 'WEB', createdAt: at, updatedAt: at });
      if (status !== 'NEW' && assigneeId) {
        const r = new Date(Math.min(now.getTime(), at.getTime() + 5 * 3_600_000));
        messages.push({ ticketId: t._id, authorProfileId: new ObjectId(assigneeId), body: status === 'WAITING' ? 'Could you share a photo or the receipt number? (Sample reply.)' : status === 'RESOLVED' || status === 'CLOSED' ? 'This is sorted now. Thank you for letting us know. (Sample reply.)' : 'Thank you, we are looking into it today. (Sample reply.)', channel: 'WEB', createdAt: r, updatedAt: r });
      }
    }
    await bulk(Ticket, tickets);
    await bulk(TicketMessage, messages);
    const by = (s) => tickets.filter((t) => t.status === s).length;
    return `${tickets.length} tickets (${by('NEW')} new, ${by('OPEN')} open, ${by('WAITING')} waiting, ${by('RESOLVED')} resolved, ${by('CLOSED')} closed) to the office, class teachers, library and hostel, with ${messages.length} messages`;
  });

  // ── Student requests: leave, electives, activities, profile edits, certificates ──
  await section('Student requests (leave, electives, activities, profile edits, certificates)', null, async () => {
    if (await LeaveApplication.exists({ reason: /\(sample\)$/ })) return 'kept';
    const mine = [demoStudent?._id, ...demoChildIds].filter(Boolean).map(String);
    const reviewPool = [...new Set([...teacherSectionIds, ...sections.map((s) => String(s._id))])];
    const leavePeople = [...mine.map((sid) => enrolmentOf.get(sid)).filter(Boolean), ...fromSections(teacherSectionIds, 10), ...fromSections(reviewPool, 14)];
    const reasons = ['Fever and cold (sample)', 'Family wedding out of town (sample)', 'Medical check-up (sample)', 'Grandparent unwell (sample)', 'Inter-school sports meet (sample)'];
    const leaves = leavePeople.map((e, i) => {
      const from = i % 3 === 0 ? daysAhead(2 + (i % 6), 0) : daysAgo(4 + i * 3, 0);
      const status = from > now ? 'PENDING' : i % 5 === 4 ? 'REJECTED' : i % 4 === 1 ? 'PENDING' : 'APPROVED';
      const sec = sections.find((s) => String(s._id) === String(e.sectionId));
      const created = new Date(Math.min(now.getTime() - 3_600_000, from.getTime() - 2 * DAY));
      return { enrollmentId: e._id, fromDate: from, toDate: new Date(from.getTime() + (i % 3) * DAY), reason: reasons[i % reasons.length], documentUrl: null, documentName: null, status, reviewedByProfileId: status === 'PENDING' ? null : (sec?.classTeacherId ?? TEACHER?.profile._id ?? null), reviewedAt: status === 'PENDING' ? null : new Date(created.getTime() + DAY), remarks: status === 'REJECTED' ? 'Please apply with a doctor\'s note (sample).' : status === 'APPROVED' ? 'Approved (sample).' : null, createdAt: created, updatedAt: created };
    });
    await bulk(LeaveApplication, leaves);

    // Elective registrations: a queue for each elective teacher and the demo student's own.
    const electives = await SubjectOffering.find({ isElective: true }).lean();
    const regs = []; const taken = new Set();
    const addReg = (e, o, status, ago) => {
      const k = `${e.studentId}:${o._id}`; if (taken.has(k)) return; taken.add(k);
      const at = daysAgo(ago);
      regs.push({ studentId: e.studentId, subjectOfferingId: o._id, academicYearId: year._id, status, decidedByProfileId: status === 'PENDING' ? null : o.teacherId, decidedAt: status === 'PENDING' ? null : new Date(at.getTime() + DAY), decisionNote: status === 'REJECTED' ? 'The class is full this term (sample).' : null, createdAt: at, updatedAt: at });
    };
    if (demoStudent) {
      const e = enrolmentOf.get(String(demoStudent._id));
      const own = electives.filter((o) => String(o.sectionId) === String(e?.sectionId));
      if (own[0]) addReg(e, own[0], 'APPROVED', 60);
      if (own[1]) addReg(e, own[1], 'PENDING', 2);
    }
    for (const o of electives) {
      const pool = (bySection.get(String(o.sectionId)) ?? []);
      const n = Math.min(o.capacity ?? 10, 8);
      for (let i = 0; i < n; i++) { const e = pool[(i * 7 + 3) % pool.length]; if (e) addReg(e, o, i < 5 ? 'APPROVED' : i === 7 ? 'REJECTED' : 'PENDING', 10 + i * 4); }
    }
    await bulk(SubjectRegistration, regs);

    // Co-curricular record requests.
    const acts = [['Inter-house football final', 'SPORTS', 'INTER_SCHOOL', 'Runners-up'], ['District science quiz', 'SCIENCE', 'DISTRICT', 'Second place'], ['Annual day dance', 'DANCE', 'SCHOOL', 'Performed'], ['Debate competition', 'LITERARY', 'INTER_SCHOOL', 'Best speaker'], ['Beach clean-up drive', 'SOCIAL_SERVICE', 'SCHOOL', 'Volunteer'], ['State chess championship', 'OTHER', 'STATE', 'Participated']];
    const actPeople = [...mine.map((sid) => enrolmentOf.get(sid)).filter(Boolean), ...fromSections(teacherSectionIds, 8), ...fromSections(reviewPool, 8)];
    const activities = actPeople.map((e, i) => {
      const [name, category, level, achievement] = acts[i % acts.length];
      const at = daysAgo(5 + i * 4);
      const status = i % 4 === 1 ? 'PENDING' : i % 7 === 6 ? 'REJECTED' : 'APPROVED';
      const sec = sections.find((s) => String(s._id) === String(e.sectionId));
      return { studentId: e.studentId, enrollmentId: e._id, sectionId: e.sectionId, academicYearId: year._id, name: `${name} (sample)`, category, description: 'Recorded for the student profile. (Sample.)', activityDate: new Date(at.getTime() - 3 * DAY), achievement, level, documentUrl: null, documentName: null, status, requestedByProfileId: studentById.get(String(e.studentId))?.profileId ?? null, reviewedByProfileId: status === 'PENDING' ? null : (sec?.classTeacherId ?? null), reviewedAt: status === 'PENDING' ? null : new Date(at.getTime() + DAY), rejectionReason: status === 'REJECTED' ? 'Please attach the certificate (sample).' : null, createdAt: at, updatedAt: at };
    });
    await bulk(CoCurricularActivity, activities);

    // Profile corrections.
    const edits = [...mine.map((sid) => enrolmentOf.get(sid)).filter(Boolean), ...fromSections(teacherSectionIds, 4)].map((e, i) => {
      const at = daysAgo(3 + i * 6);
      const status = i === 0 ? 'PENDING' : i % 3 === 2 ? 'REJECTED' : i % 2 ? 'PENDING' : 'APPROVED';
      return { studentId: e.studentId, enrollmentId: e._id, sectionId: e.sectionId, changes: [i % 2 ? { field: 'address', label: 'Address', oldValue: '12 Sample Street', newValue: '45 Sample Avenue' } : { field: 'bloodGroup', label: 'Blood group', oldValue: null, newValue: 'B+' }], note: 'Please update the record. (Sample.)', documentUrl: null, documentName: null, status, requestedByProfileId: studentById.get(String(e.studentId))?.profileId ?? null, requestedAt: at, reviewedByProfileId: status === 'PENDING' ? null : ADMIN.profile._id, reviewedAt: status === 'PENDING' ? null : new Date(at.getTime() + DAY), rejectionReason: status === 'REJECTED' ? 'The proof attached does not match (sample).' : null, createdAt: at, updatedAt: at };
    });
    await bulk(ProfileEditRequest, edits);

    // Certificate requests in every state.
    const types = await DocumentType.find({ isActive: true }).lean();
    const certPeople = [...mine.map((sid) => enrolmentOf.get(sid)).filter(Boolean), ...fromSections(reviewPool, 16)];
    const certStatuses = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'READY', 'COMPLETED', 'COMPLETED', 'REJECTED', 'PENDING'];
    const purposes = ['Passport application', 'Scholarship application', 'Bank account opening', 'Sports trials', 'Visa application'];
    const seenCert = new Set();
    const certs = [];
    certPeople.forEach((e, i) => {
      const t = types[i % Math.max(1, types.length)];
      if (!t) return;
      const key = `${e.studentId}:${t._id}`; if (seenCert.has(key)) return; seenCert.add(key);
      const status = certStatuses[i % certStatuses.length];
      const at = daysAgo(2 + i * 3);
      const s = studentById.get(String(e.studentId));
      const sec = sections.find((x) => String(x._id) === String(e.sectionId));
      certs.push({ studentId: e.studentId, enrollmentId: e._id, sectionId: e.sectionId, documentTypeId: t._id, documentTypeName: t.name, studentName: nameOf(e.studentId), admissionNo: s?.admissionNo ?? null, className: sec ? sectionLabel(sec) : null, status, purpose: `${purposes[i % purposes.length]} (sample)`, additionalInformation: null, requiredBy: daysAhead(10 + i), requestData: [], requestedByProfileId: s?.profileId ?? null, reviewedByProfileId: status === 'PENDING' ? null : ADMIN.profile._id, reviewedAt: status === 'PENDING' ? null : new Date(at.getTime() + DAY), approvedByProfileId: ['APPROVED', 'READY', 'COMPLETED'].includes(status) ? PRINCIPAL.profile._id : null, approvedAt: ['APPROVED', 'READY', 'COMPLETED'].includes(status) ? new Date(at.getTime() + 2 * DAY) : null, rejectedByProfileId: status === 'REJECTED' ? ADMIN.profile._id : null, rejectedAt: status === 'REJECTED' ? new Date(at.getTime() + DAY) : null, rejectionReason: status === 'REJECTED' ? 'Fees for the term are pending (sample).' : null, adminRemarks: null, cancelledAt: null, issuedAt: status === 'COMPLETED' ? new Date(at.getTime() + 3 * DAY) : null, completedAt: status === 'COMPLETED' ? new Date(at.getTime() + 3 * DAY) : null, files: [], createdAt: at, updatedAt: at });
    });
    await bulk(DocumentRequest, certs);
    return `${leaves.length} leave requests, ${regs.length} elective registrations, ${activities.length} co-curricular records, ${edits.length} profile corrections and ${certs.length} certificate requests, in every state (the demo student and the demo teacher's classes included)`;
  });

  // ── Quizzes ───────────────────────────────────────────────────────────────
  await section('Quizzes with attempts', null, async () => {
    if (await Quiz.exists({ title: /\(sample\)$/ })) return 'kept';
    const subjects = new Map((await Subject.find({}).lean()).map((s) => [String(s._id), s]));
    const bank = {
      MATH: [['What is 15% of 200?', ['30', '15', '20', '25'], 0], ['Solve 2x + 6 = 14', ['4', '8', '3', '10'], 0], ['Sum of angles in a triangle', ['180°', '90°', '360°', '270°'], 0], ['Next prime after 7', ['11', '9', '13', '10'], 0]],
      SCI: [['Unit of force', ['Newton', 'Joule', 'Watt', 'Pascal'], 0], ['Powerhouse of the cell', ['Mitochondria', 'Nucleus', 'Ribosome', 'Golgi body'], 0], ['Water boils at (sea level)', ['100 °C', '90 °C', '120 °C', '80 °C'], 0], ['Gas plants take in', ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'], 0]],
      ENG: [['Plural of "child"', ['children', 'childs', 'childes', 'child'], 0], ['Opposite of "ancient"', ['modern', 'old', 'antique', 'early'], 0], ['A word that describes a noun', ['adjective', 'verb', 'adverb', 'pronoun'], 0], ['Past tense of "go"', ['went', 'goed', 'gone', 'going'], 0]],
      SOC: [['Capital of India', ['New Delhi', 'Mumbai', 'Kolkata', 'Chennai'], 0], ['Longest river in India', ['Ganga', 'Yamuna', 'Godavari', 'Narmada'], 0], ['Our Constitution came into force in', ['1950', '1947', '1949', '1952'], 0], ['Lines of latitude run', ['East to west', 'North to south', 'Diagonally', 'In circles round the poles'], 0]],
      COMP: [['CPU stands for', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit'], 0], ['1 byte equals', ['8 bits', '4 bits', '16 bits', '2 bits'], 0], ['A safe password has', ['Letters, numbers and symbols', 'Only your name', 'Your birthday', '1234'], 0], ['Which is an input device?', ['Keyboard', 'Monitor', 'Printer', 'Speaker'], 0]],
    };
    const chosen = [...coreOfferings.filter((o) => teacherSectionIds.includes(String(o.sectionId)) && String(o.teacherId) === TEACHER?.id), ...coreOfferings.filter((_, i) => i % 4 === 0)];
    const demoSec = demoStudent ? String(enrolmentOf.get(String(demoStudent._id))?.sectionId ?? '') : '';
    chosen.push(...coreOfferings.filter((o) => String(o.sectionId) === demoSec));
    const seen = new Set(); let quizzes = 0; let attempts = 0;
    for (const o of chosen) {
      if (seen.has(String(o._id))) continue; seen.add(String(o._id));
      const code = subjects.get(String(o.subjectId))?.code ?? 'MATH';
      const qs = bank[code] ?? bank.MATH;
      for (const [k, draft] of [[0, false], [1, k2draft(o)]]) {
        const published = !draft;
        const pubAt = daysAgo(k === 0 ? 20 : 4);
        // eslint-disable-next-line no-await-in-loop
        const quiz = await Quiz.create({ subjectOffering: undefined, subjectOfferingId: o._id, sectionId: o.sectionId, subjectId: o.subjectId, teacherId: o.teacherId ?? TEACHER.profile._id, title: `${subjects.get(String(o.subjectId))?.name ?? 'Subject'} quick check ${k + 1} (sample)`, description: 'Four questions on this week\'s lessons. (Sample quiz.)', durationMinutes: 10, status: published ? 'PUBLISHED' : 'DRAFT', publishedAt: published ? pubAt : null, questions: qs.map(([text, opts], qi) => ({ text, marks: 1, order: qi + 1, options: opts.map((t, oi) => ({ text: t, order: oi + 1, isCorrect: oi === 0 })) })), totalMarks: qs.length });
        quizzes += 1;
        if (!published) continue;
        const docs = [];
        for (const e of bySection.get(String(o.sectionId)) ?? []) {
          if (random() < 0.25 && String(e.studentId) !== String(demoStudent?._id ?? '')) continue;
          if (k === 1 && String(e.studentId) === String(demoStudent?._id ?? '')) continue; // one left for the demo student to take
          let correct = 0;
          const answers = quiz.questions.map((q) => {
            const right = random() < 0.72;
            const opt = right ? q.options.find((x) => x.isCorrect) : q.options.find((x) => !x.isCorrect);
            if (right) correct += 1;
            return { questionId: q._id, selectedOptionId: opt._id, isCorrect: right, marksAwarded: right ? q.marks : 0 };
          });
          const started = new Date(pubAt.getTime() + (1 + random() * 48) * 3_600_000);
          docs.push({ quizId: quiz._id, studentId: e.studentId, enrollmentId: e._id, status: 'SUBMITTED', startedAt: started, submittedAt: new Date(started.getTime() + 6 * 60_000), score: correct, totalMarks: quiz.totalMarks, correctCount: correct, wrongCount: quiz.questions.length - correct, unansweredCount: 0, answers, createdAt: started, updatedAt: started });
        }
        // eslint-disable-next-line no-await-in-loop
        attempts += await bulk(QuizAttempt, docs);
      }
    }
    function k2draft(o) { return String(o.teacherId) === TEACHER?.id && teacherSectionIds[0] === String(o.sectionId); }
    return `${quizzes} quizzes (published and draft) with ${attempts} submitted attempts; one open for the demo student`;
  });

  // ── Library ───────────────────────────────────────────────────────────────
  await section('Library catalogue and circulation', null, async () => {
    if (await Book.exists({ title: 'The Jungle Book' })) return 'kept';
    const catalogue = [
      ['The Jungle Book', 'Rudyard Kipling', 'Fiction'], ['Treasure Island', 'Robert Louis Stevenson', 'Fiction'], ['Alice\'s Adventures in Wonderland', 'Lewis Carroll', 'Fiction'], ['Little Women', 'Louisa May Alcott', 'Fiction'],
      ['The Adventures of Tom Sawyer', 'Mark Twain', 'Fiction'], ['Black Beauty', 'Anna Sewell', 'Fiction'], ['Heidi', 'Johanna Spyri', 'Fiction'], ['The Secret Garden', 'Frances Hodgson Burnett', 'Fiction'],
      ['Gulliver\'s Travels', 'Jonathan Swift', 'Fiction'], ['Around the World in Eighty Days', 'Jules Verne', 'Fiction'], ['The Wind in the Willows', 'Kenneth Grahame', 'Fiction'], ['Panchatantra Tales (retold)', 'Sample Editor', 'Fiction'],
      ['Wings of Fire (sample edition)', 'Sample Author', 'Biography'], ['Great Indian Scientists', 'Sample Author', 'Biography'], ['Lives of the Freedom Fighters', 'Sample Author', 'Biography'],
      ['Illustrated Atlas of India', 'Sample Cartographers', 'Reference'], ['Children\'s Encyclopaedia, Vol. 1', 'Sample Editors', 'Reference'], ['Oxford-style School Dictionary (sample)', 'Sample Editors', 'Reference'],
      ['Fun with Mathematics', 'Sample Author', 'Mathematics'], ['Puzzles and Brain Teasers', 'Sample Author', 'Mathematics'], ['Physics Made Simple', 'Sample Author', 'Science'], ['Chemistry in Everyday Life', 'Sample Author', 'Science'],
      ['The Human Body', 'Sample Author', 'Science'], ['Our Solar System', 'Sample Author', 'Science'], ['Coding for Young Minds', 'Sample Author', 'Computers'], ['History of Ancient India', 'Sample Author', 'History'],
      ['Indian Art and Culture', 'Sample Author', 'History'], ['Environmental Studies Workbook', 'Sample Author', 'Environment'], ['Poems for Children', 'Sample Anthology', 'Poetry'], ['Short Stories from Around the World', 'Sample Anthology', 'Fiction'],
    ];
    const books = catalogue.map(([title, author, category], i) => { const total = 2 + (i % 5); return { _id: new ObjectId(), title, author, isbn: null, category, resourceType: 'PHYSICAL', resourceKind: 'BOOK', resourceUrl: null, publisher: 'Sample Publishers', publishedYear: 1990 + (i * 3) % 34, subjectId: null, gradeId: null, academicYearId: null, resourceLanguage: 'English', examType: null, body: null, uploadedByProfileId: LIBRARIAN?.profile._id ?? null, totalCopies: total, availableCopies: total, coverUrl: null, deletedAt: null, createdAt: daysAgo(300), updatedAt: daysAgo(300) }; });
    // Notes and question papers, by class and subject, for the notes and papers shelves.
    const subjectsList = await Subject.find({ code: { $in: ['MATH', 'SCI', 'ENG', 'SOC', 'COMP'] } }).lean();
    const gradeList = await Grade.find({}).sort({ level: 1 }).lean();
    const lastYear = await AcademicYear.findOne({ name: '2025-26' }).lean();
    for (const [gi, g] of gradeList.entries()) {
      for (const [si, s] of subjectsList.entries()) {
        if ((gi + si) % 2) continue;
        books.push({ _id: new ObjectId(), title: `${s.name} revision notes: ${g.name} (sample)`, author: 'Subject department', category: s.name, resourceType: 'DIGITAL', resourceKind: 'NOTE', resourceUrl: null, publisher: null, publishedYear: 2026, subjectId: s._id, gradeId: g._id, academicYearId: year._id, resourceLanguage: 'English', examType: null, body: `Key points for ${s.name}, ${g.name}:\n\n1. Read each chapter summary.\n2. Practise the worked examples.\n3. Revise the definitions list.\n\n(Sample notes.)`, uploadedByProfileId: TEACHER?.profile._id ?? null, totalCopies: 0, availableCopies: 0, coverUrl: null, deletedAt: null, createdAt: daysAgo(30 + si), updatedAt: daysAgo(30 + si) });
        books.push({ _id: new ObjectId(), title: `${s.name} ${g.name}: Annual Examination 2025-26 paper (sample)`, author: 'Examination cell', category: s.name, resourceType: 'DIGITAL', resourceKind: 'QUESTION_PAPER', resourceUrl: null, publisher: null, publishedYear: 2026, subjectId: s._id, gradeId: g._id, academicYearId: lastYear?._id ?? year._id, resourceLanguage: 'English', examType: 'ANNUAL', body: `Section A: answer all questions (1 mark each).\nSection B: answer any five (3 marks each).\nSection C: answer any two (5 marks each).\n\n(Sample paper for ${g.name} ${s.name}.)`, uploadedByProfileId: LIBRARIAN?.profile._id ?? null, totalCopies: 0, availableCopies: 0, coverUrl: null, deletedAt: null, createdAt: daysAgo(150), updatedAt: daysAgo(150) });
      }
    }
    await bulk(Book, books);
    // Circulation over the year: returned loans (some late, with fines), current loans and overdue ones.
    const lending = await Book.find({ resourceKind: { $in: ['BOOK', null] }, resourceType: 'PHYSICAL', deletedAt: null }).lean();
    const borrowers = fromSections(sections.map((s) => s._id), 220);
    if (demoStudent) borrowers.unshift(enrolmentOf.get(String(demoStudent._id)));
    const issues = []; const out = new Map();
    borrowers.filter(Boolean).forEach((e, i) => {
      const book = lending[(i * 7) % lending.length];
      const issued = daysAgo(2 + Math.floor(random() * 200));
      const due = new Date(issued.getTime() + 14 * DAY);
      let status = 'RETURNED'; let returnedAt = new Date(issued.getTime() + (5 + random() * 14) * DAY); let fine = 0;
      if (returnedAt > now) { status = due < now ? 'OVERDUE' : 'ACTIVE'; returnedAt = null; }
      else if (returnedAt > due) fine = Math.ceil((returnedAt - due) / DAY) * 2;
      if (status !== 'RETURNED') {
        const used = out.get(String(book._id)) ?? 0;
        if (used >= book.availableCopies) { status = 'RETURNED'; returnedAt = new Date(Math.min(now.getTime() - DAY, due.getTime())); } else out.set(String(book._id), used + 1);
      }
      if (status === 'OVERDUE') fine = Math.ceil((now - due) / DAY) * 2;
      issues.push({ bookId: book._id, borrowerProfileId: e.studentId, borrowerName: nameOf(e.studentId), issuedAt: issued, dueDate: due, returnedAt, status, fineAmount: fine, createdAt: issued, updatedAt: returnedAt ?? issued });
    });
    await bulk(BookIssue, issues);
    for (const [bookId, n] of out) {
      // eslint-disable-next-line no-await-in-loop
      await Book.updateOne({ _id: bookId }, { $inc: { availableCopies: -n } });
    }
    // Requests waiting for the librarian, and decided ones.
    const reqPeople = fromSections(sections.map((s) => s._id), 14);
    if (demoStudent) reqPeople.unshift(enrolmentOf.get(String(demoStudent._id)));
    const reqs = []; const reqSeen = new Set();
    reqPeople.filter(Boolean).forEach((e, i) => {
      const book = lending[(i * 5 + 3) % lending.length];
      const k = `${e.studentId}:${book._id}`; if (reqSeen.has(k)) return; reqSeen.add(k);
      const status = i % 4 === 0 ? 'PENDING' : i % 4 === 1 ? 'PENDING' : i % 4 === 2 ? 'APPROVED' : 'REJECTED';
      const at = daysAgo(1 + i);
      reqs.push({ bookId: book._id, studentId: e.studentId, requestedByProfileId: studentById.get(String(e.studentId))?.profileId ?? null, status, decidedByProfileId: status === 'PENDING' ? null : LIBRARIAN?.profile._id ?? null, decidedAt: status === 'PENDING' ? null : new Date(at.getTime() + DAY), decisionNote: status === 'REJECTED' ? 'All copies are reserved for the reading week (sample).' : null, issueId: null, createdAt: at, updatedAt: at });
    });
    await bulk(BookRequest, reqs);
    const by = (s) => issues.filter((x) => x.status === s).length;
    return `${catalogue.length} more titles, ${books.length - catalogue.length} notes and question papers; ${issues.length} loans over the year (${by('ACTIVE')} out, ${by('OVERDUE')} overdue, ${by('RETURNED')} returned); ${reqs.length} book requests`;
  });

  // ── Hostel ────────────────────────────────────────────────────────────────
  await section('Hostel residents and requests', null, async () => {
    if (await HostelInquiry.exists({ subject: /\(sample\)$/ })) return 'kept';
    const rooms = await HostelRoom.find({ status: 'ACTIVE' }).sort({ roomNo: 1 }).lean();
    const allocs = await HostelAllocation.find({ status: 'ACTIVE' }).lean();
    const used = new Map(); for (const a of allocs) used.set(String(a.roomId), (used.get(String(a.roomId)) ?? 0) + 1);
    const resident = new Set(allocs.map((a) => String(a.studentId)));
    // Boarders from the senior classes: boys in block A, girls in block B, about three in four beds filled.
    const senior = sections.slice(-6).flatMap((s) => bySection.get(String(s._id)) ?? []);
    const docs = [];
    for (const e of senior) {
      if (resident.has(String(e.studentId)) || random() > 0.42) continue;
      const g = studentById.get(String(e.studentId))?.gender;
      const room = rooms.find((r) => r.type === (g === 'FEMALE' ? 'GIRLS' : 'BOYS') && (used.get(String(r._id)) ?? 0) < Math.min(3, r.capacity));
      if (!room) continue;
      used.set(String(room._id), (used.get(String(room._id)) ?? 0) + 1);
      const at = atIst(utcDay(2026, 6, 1 + (docs.length % 10)), 10);
      docs.push({ roomId: room._id, studentId: e.studentId, allottedAt: at, vacatedAt: null, status: 'ACTIVE', academicYearId: year._id, createdAt: at, updatedAt: at });
    }
    // Two who left the hostel during the year.
    const leavers = docs.slice(0, 2).map((d) => ({ ...d, _id: undefined, studentId: senior[senior.length - 1 - docs.indexOf(d)]?.studentId, status: 'VACATED', vacatedAt: daysAgo(40), allottedAt: atIst(utcDay(2025, 6, 2), 10) })).filter((d) => d.studentId && !resident.has(String(d.studentId)) && !docs.some((x) => String(x.studentId) === String(d.studentId)));
    await bulk(HostelAllocation, [...docs, ...leavers.map(({ _id, ...d }) => d)]);
    const residents = [...allocs.map((a) => a.studentId), ...docs.map((d) => d.studentId)];
    const topics = [['Hot water not working in block A (sample)', 'IN_PROGRESS'], ['Request for a study lamp (sample)', 'OPEN'], ['Mess menu feedback (sample)', 'RESOLVED'], ['Room change request (sample)', 'OPEN'], ['Wi-Fi weak on the second floor (sample)', 'RESOLVED'], ['Lost and found: water bottle (sample)', 'RESOLVED'], ['Weekend outing timing (sample)', 'OPEN']];
    const inq = topics.map(([subject, status], i) => { const sid = residents[(i * 5) % residents.length]; const at = daysAgo(2 + i * 5); return { studentId: sid, raisedByProfileId: guardianOf.get(String(sid)) ?? WARDEN?.profile._id, subject, description: 'Raised with the warden. (Sample.)', status, resolvedAt: status === 'RESOLVED' ? new Date(at.getTime() + 2 * DAY) : null, createdAt: at, updatedAt: at }; });
    await bulk(HostelInquiry, inq);
    // A few more out-passes through the out-pass rules (approved, refused, waiting).
    const outpass = await import('../modules/hostel/outpass.service.js');
    const W = WARDEN?.actor ?? ADMIN.actor;
    let passes = 0;
    for (const [i, sid] of residents.slice(3, 9).entries()) {
      // eslint-disable-next-line no-await-in-loop
      const p = await attempt('out-pass', () => outpass.request(W, 'ALL', { studentId: String(sid), fromAt: daysAhead(3 + i, 16).toISOString(), toAt: daysAhead(5 + i, 18).toISOString(), reason: ['Sister\'s engagement (sample)', 'Medical appointment (sample)', 'Festival at home (sample)', 'Sports trials in the city (sample)', 'Family visit (sample)', 'Passport appointment (sample)'][i], destination: 'Home town (sample)', escort: { name: 'Parent (sample)', relationship: 'Parent' } }));
      if (!p) continue;
      passes += 1;
      // eslint-disable-next-line no-await-in-loop
      if (i % 3 === 0) await attempt('approve', () => outpass.wardenDecision(W, p.id, { decision: 'APPROVED', note: 'Approved (sample)' }));
      // eslint-disable-next-line no-await-in-loop
      else if (i % 3 === 1) await attempt('refuse', () => outpass.wardenDecision(W, p.id, { decision: 'REJECTED', note: 'Clashes with the unit test (sample)' }));
    }
    return `${docs.length} more boarders (${allocs.length + docs.length} in all), ${leavers.length} who left during the year, ${inq.length} hostel requests, ${passes} more out-passes (approved, refused, waiting)`;
  });

  // ── Transport ─────────────────────────────────────────────────────────────
  await section('Transport routes, riders and trips', null, async () => {
    if (await TransportRoute.exists({ name: /^South Route/ })) return 'kept';
    const main = await TransportRoute.findOne({}).sort({ createdAt: 1 }).lean();
    const plans = [
      [main, null, [['Lake View Colony', 12.9789, 77.5917], ['Maple Heights', 12.9846, 77.6021], ['Green Park', 12.9902, 77.6105]]],
      [null, { name: 'South Route - Bus 7', operatorName: 'SafeTravels Corp', vehicleNo: 'KA-01-MC-4512', driverName: 'Suresh Naik (sample)', driverPhone: '+919900001112', fareAmountPaise: 900000 }, [['Sunrise Nagar', 12.9352, 77.6245], ['Silver Oak Layout', 12.9279, 77.6271], ['Rosewood Society', 12.9201, 77.6312], ['Hillcrest Gardens', 12.9116, 77.6389]]],
      [null, { name: 'East Route - Minibus 3', operatorName: 'Oakridge Transport (owned)', vehicleNo: 'KA-01-MC-2290', driverName: 'Imran Shaikh (sample)', driverPhone: '+919900001113', fareAmountPaise: 800000 }, [['Palm Grove', 12.9698, 77.7499], ['Cedar Residency', 12.9784, 77.7312], ['Riverdale Enclave', 12.9851, 77.7101]]],
      [null, { name: 'West Route - Van 1', operatorName: 'Oakridge Transport (owned)', vehicleNo: 'KA-01-MC-0077', driverName: 'Joseph D\'Souza (sample)', driverPhone: '+919900001114', fareAmountPaise: 700000 }, [['Station Road', 12.9767, 77.5713], ['Market Square', 12.9719, 77.5590]]],
    ];
    const ridden = new Set((await BusEnrollment.find({}).select('studentId').lean()).map((b) => String(b.studentId)));
    const boarders = new Set((await HostelAllocation.find({ status: 'ACTIVE' }).select('studentId').lean()).map((a) => String(a.studentId)));
    let riders = 0; let stopsMade = 0;
    const pool = enrolments.filter((e) => !ridden.has(String(e.studentId)) && !boarders.has(String(e.studentId)));
    let cursor = 0;
    for (const [i, [existing, def, stops]] of plans.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const route = existing ?? (await TransportRoute.create({ ...def, status: 'ACTIVE' })).toObject();
      const startSeq = existing ? ((await TransportStop.countDocuments({ routeId: route._id })) + 1) : 1;
      if (existing) await TransportStop.updateMany({ routeId: route._id, lat: null }, { $set: { lat: 12.9716, lng: 77.5946 } });
      const madeStops = [];
      for (const [k, [name, lat, lng]] of stops.entries()) {
        // eslint-disable-next-line no-await-in-loop
        madeStops.push(await TransportStop.create({ routeId: route._id, name, sequenceNo: startSeq + k, etaMinutesFromStart: 8 + k * 7, lat, lng }));
      }
      stopsMade += madeStops.length;
      const cap = [24, 26, 14, 9][i];
      const docs = [];
      for (let n = 0; n < cap && cursor < pool.length; n++, cursor += 3) {
        const e = pool[cursor];
        docs.push({ studentId: e.studentId, routeId: route._id, stopId: madeStops[n % madeStops.length]._id, direction: n % 9 === 0 ? 'PICKUP' : 'BOTH', academicYearId: year._id, createdAt: atIst(utcDay(2026, 6, 5), 10), updatedAt: atIst(utcDay(2026, 6, 5), 10) });
      }
      // eslint-disable-next-line no-await-in-loop
      riders += await bulk(BusEnrollment, docs);
    }
    // Requests for a seat waiting for the office, and one refused.
    const routes = await TransportRoute.find({ status: 'ACTIVE' }).lean();
    const reqs = [];
    for (let i = 0; i < 6 && cursor < pool.length; i++, cursor += 5) {
      const e = pool[cursor]; const r = routes[i % routes.length];
      // eslint-disable-next-line no-await-in-loop
      const stop = await TransportStop.findOne({ routeId: r._id }).lean();
      if (!stop) continue;
      const status = i === 5 ? 'REJECTED' : 'PENDING';
      reqs.push({ studentId: e.studentId, routeId: r._id, stopId: stop._id, direction: 'BOTH', academicYearId: year._id, requestedByProfileId: guardianOf.get(String(e.studentId)) ?? null, status, decidedByProfileId: status === 'REJECTED' ? ADMIN.profile._id : null, decidedAt: status === 'REJECTED' ? daysAgo(1) : null, decisionNote: status === 'REJECTED' ? 'This bus is full; we will offer the next free seat (sample).' : null, busEnrollmentId: null, invoiceId: null, fareAmountPaise: r.fareAmountPaise ?? 0, createdAt: daysAgo(3 + i), updatedAt: daysAgo(3 + i) });
    }
    await bulk(TransportRequest, reqs);
    // Trips: today's for the new routes, and the last school day's, completed.
    const trips = await import('../modules/fleet/trips.service.js');
    const A = ADMIN.actor;
    await attempt('today\'s trips (new routes)', () => trips.planDay(A, { attendant: TEACHER ? { profileId: TEACHER.id } : undefined }));
    let done = 0;
    for (let back = 1, made = 0; made < 1 && back < 8; back++) {
      const d = new Date(today.getTime() - back * DAY);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      made += 1;
      // eslint-disable-next-line no-await-in-loop
      const out = await attempt('past trips', () => trips.planDay(A, { date: ymdOf(d) })) ?? [];
      for (const o of out.filter((x) => x.tripId)) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await attempt('start', () => trips.start(A, 'ALL', o.tripId)))) continue;
        // eslint-disable-next-line no-await-in-loop
        const t = await attempt('get', () => trips.get(A, 'ALL', o.tripId));
        // Boarding is recorded for the first few seats; the rest are accounted for in the completion note.
        for (const a of (t?.allocations ?? []).filter((x) => x.status === 'ALLOCATED').slice(0, 4)) {
          // eslint-disable-next-line no-await-in-loop
          await attempt('board', () => trips.board(A, 'ALL', o.tripId, { studentId: a.studentId }));
        }
        // eslint-disable-next-line no-await-in-loop
        if (await attempt('complete', () => trips.complete(A, 'ALL', o.tripId, { note: 'Completed; every student accounted for (sample).' }))) done += 1;
      }
    }
    return `${routes.length} routes with ${stopsMade} more stops, ${riders} more riders, ${reqs.length} seat requests; today's trips for every route and ${done} completed trips on the last school day`;
  });

  // ── Notices and calendar ─────────────────────────────────────────────────
  await section('Notices and calendar events', null, async () => {
    if (await Announcement.exists({ title: /^Monsoon safety/ })) return 'kept';
    const gradeIds = (await Grade.find({}).sort({ level: 1 }).lean()).map((g) => g._id);
    const demoSecId = demoStudent ? enrolmentOf.get(String(demoStudent._id))?.sectionId : null;
    const notices = [
      ['Welcome back: session 2026-27 begins', 'Classes begin on 1 June. Timetables are on the portal. (Sample notice.)', 137, {}],
      ['Monsoon safety reminders', 'Please send children with raincoats; buses may run 10 minutes late on heavy-rain days. (Sample notice.)', 100, {}],
      ['Periodic Test 1 results published', 'Results are on the Performance page. Teachers are available on Saturday for questions. (Sample notice.)', 80, { roleKeys: ['STUDENT', 'PARENT'] }],
      ['Independence Day celebrations', 'Flag hoisting at 8:00 on the main ground, followed by a cultural programme. (Sample notice.)', 63, {}],
      ['Inter-house sports week', 'Heats run all week; finals on Saturday. Wear house colours. (Sample notice.)', 45, {}],
      ['Staff meeting on Friday', 'All teaching staff: 3:30 pm in the staff room to plan the half-yearly examinations. (Sample notice.)', 30, { roleKeys: ['TEACHER', 'PRINCIPAL', 'ADMIN'] }],
      ['Midterm results and report cards', 'Midterm results are published; report cards follow after the PTM. (Sample notice.)', 22, { roleKeys: ['STUDENT', 'PARENT', 'TEACHER'] }],
      ['Class 10: board registration forms', 'Please check spellings and dates of birth and return the forms by Friday. (Sample notice.)', 12, { gradeIds: gradeIds.slice(-1) }],
      ['Science exhibition: projects due', 'Teams submit project titles to their science teacher this week. (Sample notice.)', 6, { gradeIds: gradeIds.slice(-4) }],
      ['Library reading week', 'Every class gets a library period each day this week. Borrow two books! (Sample notice.)', 3, {}],
      ['Your class: field trip permission slips', 'Please return the signed slips for the planetarium trip. (Sample notice.)', 2, demoSecId ? { sectionIds: [demoSecId] } : {}],
      ['Hostel: weekend visiting hours', 'Visitors are welcome 10:00–12:00 and 16:00–18:00 on Sundays. (Sample notice.)', 1, { roleKeys: ['STUDENT', 'PARENT', 'WARDEN'] }],
    ];
    const docs = notices.map(([title, content, ago, aud]) => ({ title, content, audience: { all: !Object.keys(aud).length, gradeIds: aud.gradeIds ?? [], sectionIds: aud.sectionIds ?? [], subjectIds: [], roleKeys: aud.roleKeys ?? [] }, channels: { app: true, email: false, whatsapp: false }, attachments: [], publishedAt: daysAgo(ago, 9), createdByProfileId: (aud.roleKeys?.includes('WARDEN') ? WARDEN : PRINCIPAL)?.profile._id ?? ADMIN.profile._id, deletedAt: null, createdAt: daysAgo(ago, 9), updatedAt: daysAgo(ago, 9) }));
    await bulk(Announcement, docs);
    // School events across the year (holidays belong to the Campus World calendar).
    const ev = [
      ['Investiture ceremony', 'EVENT', utcDay(2026, 7, 3)], ['Van Mahotsav tree planting', 'EVENT', utcDay(2026, 7, 10)], ['Periodic Test 1', 'EXAM', utcDay(2026, 7, 20), utcDay(2026, 7, 24)],
      ['Inter-house quiz', 'EVENT', utcDay(2026, 8, 7)], ['Teachers\' Day celebration', 'EVENT', utcDay(2026, 9, 5)], ['Inter-house sports week', 'SPORTS', utcDay(2026, 9, 28), utcDay(2026, 10, 3)],
      ['Class Test (October)', 'EXAM', utcDay(2026, 10, 5), utcDay(2026, 10, 9)], ['Parent-Teacher Meeting (Term 1 review)', 'PTM', utcDay(2026, 10, 24)], ['Planetarium field trip (Class 6)', 'EVENT', utcDay(2026, 10, 29)],
      ['Children\'s Day carnival', 'EVENT', utcDay(2026, 11, 14)], ['Half-yearly examinations', 'EXAM', utcDay(2026, 12, 1), utcDay(2026, 12, 12)], ['Annual day', 'EVENT', utcDay(2026, 12, 19)],
      ['Republic Day assembly', 'EVENT', utcDay(2027, 1, 26)], ['Science Olympiad (school round)', 'EXAM', utcDay(2027, 2, 6)], ['Annual examinations', 'EXAM', utcDay(2027, 3, 1), utcDay(2027, 3, 15)],
    ].map(([title, type, from, to]) => ({ title, description: `${title}. (Sample event.)`, type, startsAt: atIst(from, 9), endsAt: atIst(to ?? from, 15), audience: { all: true }, createdByProfileId: ADMIN.profile._id, deletedAt: null, createdAt: daysAgo(140), updatedAt: daysAgo(140) }));
    await bulk(CalendarEvent, ev);
    return `${docs.length} notices over the term (school-wide, by role, by class and for the demo student's class) and ${ev.length} calendar events through the year`;
  });

  // ── Admissions pipeline: eighteen months of enquiries ────────────────────
  await section('Admission enquiries (eighteen months)', null, async () => {
    if (await Lead.exists({ sourceDetail: 'p3-sample' })) return 'kept';
    const first = ['Aarav', 'Vihaan', 'Advik', 'Anaya', 'Saanvi', 'Myra', 'Reyansh', 'Ayaan', 'Ishita', 'Kavya', 'Rudra', 'Pari', 'Arnav', 'Navya', 'Shaurya', 'Aadhya', 'Krish', 'Avni', 'Laksh', 'Tanvi'];
    const last = ['Menon', 'Desai', 'Chopra', 'Pillai', 'Agarwal', 'Bajaj', 'Hegde', 'Kamath', 'Malhotra', 'Pandey'];
    const sources = ['WEB', 'WEB', 'WALK_IN', 'REFERRAL', 'WHATSAPP', 'WEB', 'EVENT', 'REFERRAL'];
    const grades = ['Nursery', 'Class 1', 'Class 1', 'Class 2', 'Class 5', 'Class 6', 'Class 6', 'Class 8', 'Class 9', 'Class 11'];
    const docs = [];
    // Enquiries peak from November to February, ahead of the new session.
    const weight = { 1: 1.6, 2: 1.4, 3: 1.1, 4: 0.8, 5: 0.6, 6: 0.5, 7: 0.4, 8: 0.4, 9: 0.6, 10: 0.9, 11: 1.4, 12: 1.6 };
    let n = 0;
    for (let t = utcDay(2025, 4, 1).getTime(); t < now.getTime(); t += DAY) {
      const d = new Date(t);
      const thisCycle = d >= utcDay(2026, 9, 1);
      if (random() > 0.32 * weight[d.getUTCMonth() + 1]) continue;
      const ageDays = (now - d) / DAY;
      const r = random();
      // Older enquiries have finished their journey; recent ones are still open.
      const stage = ageDays > 120 ? (r < 0.34 ? 'ENROLLED' : r < 0.78 ? 'LOST' : 'APPLICATION') : ageDays > 30 ? (r < 0.15 ? 'ENROLLED' : r < 0.35 ? 'APPLICATION' : r < 0.55 ? 'TOUR_SCHEDULED' : r < 0.75 ? 'CONTACTED' : 'LOST') : (r < 0.45 ? 'NEW' : r < 0.75 ? 'CONTACTED' : r < 0.9 ? 'TOUR_SCHEDULED' : 'APPLICATION');
      n += 1;
      const at = atIst(d, 9 + Math.floor(random() * 9));
      const child = `${first[n % first.length]} ${last[(n * 3) % last.length]}`;
      docs.push({ childName: `${child} (sample)`, guardianName: `Parent of ${child.split(' ')[0]} (sample)`, phone: `+9100000${String(70000 + n).padStart(5, '0')}`, email: `family${n}@family.example`, gradeApplying: grades[n % grades.length], source: sources[n % sources.length], stage, assigneeProfileId: MARKETING?.profile._id ?? null, notes: 'Fictional enquiry.', nextActionAt: ['NEW', 'CONTACTED', 'TOUR_SCHEDULED'].includes(stage) ? daysAhead(1 + (n % 7)) : null, campaignId: null, sourceDetail: 'p3-sample', academicYear: thisCycle ? '2027-28' : '2026-27', programme: null, contactConsent: { given: true, channels: ['PHONE', 'EMAIL'], at, withdrawnAt: null }, firstResponseAt: stage === 'NEW' ? null : new Date(at.getTime() + (2 + random() * 30) * 3_600_000), lostReason: stage === 'LOST' ? pick(['Chose a school nearer home', 'Fees above budget', 'No seat in the class', 'Relocated']) : null, createdAt: at, updatedAt: new Date(Math.min(now.getTime(), at.getTime() + 10 * DAY)) });
    }
    // Two families who enquired twice, for the duplicates check.
    for (const k of [3, 9]) if (docs[k]) docs.push({ ...docs[k], childName: docs[k].childName.replace(' (sample)', ' (sample, second enquiry)'), source: 'WHATSAPP', stage: 'NEW', createdAt: daysAgo(2 + k), updatedAt: daysAgo(2 + k) });
    await bulk(Lead, docs);
    const by = (s) => docs.filter((x) => x.stage === s).length;
    return `${docs.length} enquiries since April 2025 (${by('ENROLLED')} enrolled, ${by('LOST')} lost, ${docs.length - by('ENROLLED') - by('LOST')} open), so last year's cycle can be compared with this one`;
  });

  // ── Alumni ────────────────────────────────────────────────────────────────
  await section('Alumni network', null, async () => {
    const { AlumniProfile } = await import('../models/alumni.model.js');
    if (await AlumniProfile.exists({ displayName: /^Sample Batch / })) return 'kept';
    const professions = ['Engineer', 'Doctor', 'Teacher', 'Architect', 'Chartered accountant', 'Designer', 'Lawyer', 'Researcher', 'Entrepreneur', 'Nurse', 'Civil servant', 'Journalist'];
    const cities = ['Pune', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Delhi', 'Chennai', 'London', 'Toronto', 'Singapore'];
    const houses = ['Tagore', 'Raman', 'Kalam', 'Sarojini'];
    const first = ['Aditi', 'Rahul', 'Sneha', 'Varun', 'Pooja', 'Nikhil', 'Shreya', 'Karan', 'Divya', 'Manish', 'Ritika', 'Siddharth', 'Neha', 'Akash', 'Priya', 'Gaurav'];
    const docs = [];
    for (let i = 0; i < 48; i++) {
      const batch = 2008 + (i % 18);
      const consent = i % 3 !== 0;
      docs.push({ kind: 'FORMER_STUDENT', displayName: `Sample Batch ${batch}: ${first[i % first.length]} ${['Rao', 'Shah', 'Iyer', 'Gupta', 'Nair', 'Joshi'][i % 6]}`, batchYear: batch, section: `Class 12 ${'ABC'[i % 3]}`, house: houses[i % 4], leftReason: 'GRADUATED', verified: i % 11 !== 0, listed: true, profession: consent ? `${professions[i % professions.length]} (sample)` : null, city: consent ? cities[i % cities.length] : null, links: {}, consent: { profession: consent, city: consent, links: false, at: consent ? daysAgo(100 + i) : null }, status: 'ACTIVE', transitionedAt: atIst(utcDay(batch, 4, 30), 10), transitionedByProfileId: HR?.profile._id ?? null, history: [], createdAt: daysAgo(200 - i), updatedAt: daysAgo(200 - i) });
    }
    for (const [i, [name, role, from, to, reason]] of [['Sample Mrs. R. Banerjee (former English teacher)', 'TEACHER', 1999, 2019, 'RETIRED'], ['Sample Mr. P. Shetty (former accountant)', 'FINANCE', 2005, 2022, 'RESIGNED'], ['Sample Ms. L. Fernandes (former librarian)', 'LIBRARIAN', 2001, 2020, 'RETIRED']].entries()) {
      docs.push({ kind: 'FORMER_STAFF', displayName: name, formerRole: role, servedFrom: from, servedTo: to, leftReason: reason, verified: true, listed: true, links: {}, consent: { profession: false, city: false, links: false, at: null }, status: 'ACTIVE', transitionedAt: atIst(utcDay(to, 5, 31), 10), transitionedByProfileId: HR?.profile._id ?? null, history: [], createdAt: daysAgo(150 - i), updatedAt: daysAgo(150 - i) });
    }
    await bulk(AlumniProfile, docs);
    return `${docs.length - 3} more alumni across batches 2008–2025 (consent respected: profession and city only where given) and 3 former staff`;
  });

  // ── People: leave, payslips, tasks, approvals, policies, repairs ─────────
  await section('Staff leave history', null, async () => {
    const { StaffLeave } = await import('../models/staffLeave.model.js');
    if (await StaffLeave.exists({ reason: /\(sample history\)$/ })) return 'kept';
    const staffLeave = await import('../modules/staff/staffLeave.service.js');
    await attempt('balances', () => staffLeave.initBalances(HR?.actor ?? PRINCIPAL.actor, 'ALL', {}));
    const people = [...staffList, ...teachers.slice(1, 9).map((t) => ({ profile: t, actor: actorOf(t, 'TEACHER'), id: String(t._id) }))];
    const plan = [['CL', -60, 0, 'APPROVE'], ['SL', -25, 1, 'APPROVE'], ['CL', 12, 0, null], ['EL', -100, 2, 'REJECT']];
    let n = 0;
    for (const [i, p] of people.entries()) {
      for (const [k, [code, offset, extra, decision]] of plan.entries()) {
        if ((i + k) % 3 === 2) continue;
        let from = new Date(today.getTime() + (offset - (i % 9)) * DAY);
        while (from.getUTCDay() === 0 || from.getUTCDay() === 6) from = new Date(from.getTime() + DAY);
        if (from < utcDay(2026, 4, 1)) continue;
        const to = new Date(from.getTime() + extra * DAY);
        // eslint-disable-next-line no-await-in-loop
        const leave = await attempt(`leave ${p.profile.displayName}`, () => staffLeave.apply(p.actor, 'OWN', { code, fromDate: ymdOf(from), toDate: ymdOf(to), reason: `${code === 'SL' ? 'Unwell' : code === 'EL' ? 'Family travel' : 'Personal work'} (sample history)` }));
        if (!leave) continue;
        n += 1;
        const decider = p.id === HR?.id ? PRINCIPAL.actor : HR?.actor ?? PRINCIPAL.actor;
        // eslint-disable-next-line no-await-in-loop
        if (decision) await attempt('decide leave', () => staffLeave.decide(decider, 'ALL', leave.id, { action: decision, note: decision === 'REJECT' ? 'Clashes with the examination duty roster (sample).' : 'Approved (sample).' }));
      }
    }
    return `${n} leave applications for every member of staff (approved, refused and waiting)`;
  });

  await section('Payslips (June to August payroll, paid)', null, async () => {
    const payroll = await import('../modules/finance-ops/payroll.service.js');
    const { PayrollRun } = await import('../models/finance.model.js').catch(() => ({}));
    const existing = PayrollRun ? await PayrollRun.find({ period: { $in: ['2026-06', '2026-07', '2026-08'] } }).countDocuments() : 0;
    if (existing) return 'kept';
    const made = [];
    for (const period of ['2026-06', '2026-07', '2026-08']) {
      if (period >= ymdOf(today).slice(0, 7)) continue;
      // eslint-disable-next-line no-await-in-loop
      const run = await attempt(`run ${period}`, () => payroll.createRun(FINANCE.actor, { period }));
      if (!run) continue;
      // eslint-disable-next-line no-await-in-loop
      await attempt('calculate', () => payroll.calculate(FINANCE.actor, run.id));
      // eslint-disable-next-line no-await-in-loop
      const sent = await attempt('submit', () => payroll.submitRun(FINANCE.actor, run.id, { acknowledgeUnverifiedRules: true }));
      if (!sent?.approvalRequestId) continue;
      const approvals = await import('../modules/approvals/approval.service.js');
      // eslint-disable-next-line no-await-in-loop
      if (!(await attempt('approve', () => approvals.decide(PRINCIPAL.actor, String(sent.approvalRequestId), { action: 'APPROVE', comment: 'Approved (sample).' })))) continue;
      // eslint-disable-next-line no-await-in-loop
      const file = await attempt('bank file', () => payroll.bankFile(FINANCE.actor, run.id));
      // eslint-disable-next-line no-await-in-loop
      if (file && await attempt('initiate', () => payroll.markPaymentInitiated(FINANCE.actor, run.id, { bankReference: `BATCH-${period}-SAMPLE` }))) {
        // eslint-disable-next-line no-await-in-loop
        await attempt('confirm', () => payroll.confirmPayment(ADMIN.actor, run.id, { confirmedAmountPaise: file.totalPaise }));
      }
      made.push(period);
    }
    return made.length ? `payroll for ${made.join(', ')} approved and paid, so every member of staff has payslips` : 'skipped (no salary structures)';
  });

  await section('Tasks for every role', null, async () => {
    const { DueItem } = await import('../models/dueItem.model.js');
    if (await DueItem.exists({ title: /\(sample task\)$/ })) return 'kept';
    const tasks = await import('../modules/tasks/tasks.service.js');
    const plan = [
      [PRINCIPAL, 'Review Term 1 results with heads of department', 'ACADEMICS', 'OTHER', 3, 'HIGH'], [PRINCIPAL, 'Sign the board meeting minutes', 'ADMINISTRATION', 'OTHER', -1, 'NORMAL'], [PRINCIPAL, 'Approve the annual day budget', 'FINANCE', 'OTHER', 6, 'NORMAL'],
      [ADMIN, 'Renew the CCTV maintenance contract', 'FACILITIES', 'RENEWAL', 14, 'NORMAL'], [ADMIN, 'Update emergency contact list', 'ADMINISTRATION', 'OTHER', 2, 'NORMAL'],
      [TEACHER, 'Enter Unit Test 1 marks', 'ACADEMICS', 'OTHER', 5, 'HIGH'], [TEACHER, 'Call parents of pupils absent three days running', 'ACADEMICS', 'PTM_FOLLOWUP', 1, 'NORMAL'], [TEACHER, 'Prepare science exhibition teams', 'ACADEMICS', 'OTHER', 9, 'LOW'],
      [FINANCE, 'Send reminders for overdue annual charges', 'FINANCE', 'OTHER', -2, 'HIGH'], [FINANCE, 'Reconcile September bank statement', 'FINANCE', 'OTHER', 4, 'NORMAL'],
      [HR, 'Collect police verification for new drivers', 'HR', 'OTHER', 7, 'HIGH'], [HR, 'Probation review: two new teachers', 'HR', 'OTHER', 12, 'NORMAL'],
      [MARKETING, 'Follow up open-house enquiries', 'ENGAGEMENT', 'OTHER', 1, 'HIGH'], [MARKETING, 'Plan the admissions brochure for 2027-28', 'ENGAGEMENT', 'OTHER', 15, 'NORMAL'],
      [COMPLIANCE, 'File the UDISE+ annual return', 'COMPLIANCE', 'OTHER', 18, 'CRITICAL'], [COMPLIANCE, 'Fire drill report to the authority', 'COMPLIANCE', 'INSPECTION', -3, 'HIGH'],
      [LIBRARIAN, 'Stock-take of the reference section', 'LIBRARY', 'OTHER', 8, 'NORMAL'], [LIBRARIAN, 'Chase overdue loans before the reading week', 'LIBRARY', 'OTHER', 1, 'HIGH'], [LIBRARIAN, 'Order new titles from the wish-list', 'LIBRARY', 'OTHER', 20, 'LOW'],
      [WARDEN, 'Weekly room inspection, block A', 'HOSTEL', 'INSPECTION', 2, 'NORMAL'], [WARDEN, 'Pest control in the mess', 'HOSTEL', 'SERVICE', -1, 'HIGH'], [WARDEN, 'Update the out-pass register for Diwali', 'HOSTEL', 'OTHER', 10, 'NORMAL'],
      [TRUSTEE, 'Read the quarterly report before the board meeting', 'ADMINISTRATION', 'OTHER', 7, 'NORMAL'],
    ];
    let n = 0; let done = 0;
    for (const [i, [p, title, department, category, days, severity]] of plan.entries()) {
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      const t = await attempt(title, () => tasks.createItem(PRINCIPAL.actor, 'ALL', { title: `${title} (sample task)`, department, category, severity, dueAt: daysAhead(days, 10).toISOString(), ownerProfileId: p.id, description: 'Fictional sample task.' }));
      if (!t) continue;
      n += 1;
      // A finished one for most people, so "done" lists are not empty.
      if (i % 3 === 2) {
        // eslint-disable-next-line no-await-in-loop
        if (await attempt('complete', () => tasks.complete(PRINCIPAL.actor, 'ALL', t.id, { note: 'Done (sample).' }))) done += 1;
      }
    }
    return `${n} tasks across ${new Set(plan.map((x) => x[0]?.id)).size} people (${done} done, some overdue)`;
  });

  await section('Approvals in every state', null, async () => {
    const { ApprovalRequest } = await import('../models/approval.model.js');
    if (await ApprovalRequest.exists({ title: /\(sample request\)$/ })) return 'kept';
    const approvals = await import('../modules/approvals/approval.service.js');
    const plan = [
      [LIBRARIAN, 'PROCUREMENT', 'New books for the reading week', 4500000, 'APPROVE_ALL'], [WARDEN, 'PAYMENT', 'Hostel mattress replacement', 1800000, 'APPROVE_ALL'], [MARKETING, 'EVENT', 'Open house refreshments', 2500000, null],
      [TEACHER, 'TRAVEL', 'Planetarium field trip bus hire', 1200000, 'REJECT'], [ADMIN, 'CAPEX', 'Smart boards for two classrooms', 32000000, null], [HR, 'RECRUITMENT', 'Hire a counsellor (part-time)', 0, 'RETURN'],
      [COMPLIANCE, 'REGULATORY_SUBMISSION', 'Submit the fire safety audit report', 0, 'APPROVE_ALL'], [MARKETING, 'PUBLIC_COMMUNICATION', 'Press note on sports week results', 0, 'WITHDRAW'], [FINANCE, 'PAYMENT', 'Advance to the annual day vendor', 6000000, null],
      [WARDEN, 'OTHER', 'Extend Sunday visiting hours', 0, null], [LIBRARIAN, 'OTHER', 'Library open on two Saturdays a month', 0, 'REJECT'],
    ];
    const deciderFor = (stage) => ({ FINANCE, PRINCIPAL, TRUSTEE, ADMIN, HR, COMPLIANCE }[stage.approverRole]);
    const counts = {};
    for (const [p, category, title, amountPaise, outcome] of plan) {
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      const req = await attempt(title, () => approvals.createRequest(p.actor, { category, title: `${title} (sample request)`, amountPaise, summary: 'Fictional sample request.', department: null }));
      if (!req) continue;
      let status = 'PENDING';
      if (outcome === 'WITHDRAW') {
        // eslint-disable-next-line no-await-in-loop
        if (await attempt('withdraw', () => approvals.withdraw(p.actor, req.id, { reason: 'No longer needed (sample).' }))) status = 'WITHDRAWN';
      } else if (outcome) {
        for (let guard = 0; guard < 4; guard++) {
          // eslint-disable-next-line no-await-in-loop
          const cur = await ApprovalRequest.findById(req.id).lean();
          if (cur.status !== 'PENDING') { status = cur.status; break; }
          const stage = cur.stages[cur.currentStage];
          const d = deciderFor(stage);
          if (!d || d.id === p.id) break;
          const last = cur.currentStage === cur.stages.length - 1;
          const action = outcome === 'APPROVE_ALL' || !last ? 'APPROVE' : outcome;
          // eslint-disable-next-line no-await-in-loop
          if (!(await attempt(`${action} ${title}`, () => approvals.decide(d.actor, req.id, { action, comment: action === 'APPROVE' ? 'Approved (sample).' : action === 'REJECT' ? 'Not in this year\'s budget (sample).' : 'Please add two quotes (sample).' })))) break;
        }
        // eslint-disable-next-line no-await-in-loop
        status = (await ApprovalRequest.findById(req.id).lean()).status;
      }
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return `requests raised by every department: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}`;
  });

  await section('Policies in force and acknowledgements', null, async () => {
    const compliance = await import('../modules/compliance/compliance.service.js');
    const approvals = await import('../modules/approvals/approval.service.js');
    const { Policy, PolicyAcknowledgement } = await import('../models/compliance.model.js');
    if (await Policy.exists({ code: 'STAFF-CONDUCT' })) return 'kept';
    if (!COMPLIANCE) return 'skipped (no compliance officer)';
    const allStaff = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN'];
    const defs = [
      ['STAFF-CONDUCT', 'Staff Code of Conduct', 'CONDUCT', allStaff, true, 'Sample policy text. Staff treat every child with dignity, keep professional boundaries and declare conflicts of interest.'],
      ['DATA-PRIVACY', 'Data Protection and Privacy Policy', 'IT_DATA', [...allStaff, 'TRUSTEE'], true, 'Sample policy text. Personal data is used only for school purposes, shared on a need-to-know basis and never sent to personal accounts.'],
      ['STUDENT-CONDUCT', 'Student Code of Conduct', 'CONDUCT', ['STUDENT', 'PARENT', 'TEACHER'], false, 'Sample policy text. Be punctual, respect others, keep the campus clean; phones stay switched off during school hours.'],
      ['FEE-REFUND', 'Fee Payment and Refund Policy', 'FINANCE', ['PARENT', 'FINANCE', 'ADMIN'], false, 'Sample policy text. Fees are due by the date on the invoice; refunds follow the published schedule.'],
      ['HOSTEL-RULES', 'Hostel Rules', 'CONDUCT', ['WARDEN', 'STUDENT', 'PARENT'], true, 'Sample policy text. Lights out at 22:00; out-passes need the guardian\'s and the warden\'s approval.'],
      ['LIBRARY-RULES', 'Library Rules', 'ACADEMIC', ['LIBRARIAN', 'STUDENT', 'TEACHER'], false, 'Sample policy text. Two books for two weeks; a fine of ₹2 a day after the due date.'],
      ['EXAM-CONDUCT', 'Examination Conduct Policy', 'EXAMINATION', ['TEACHER', 'STUDENT', 'PARENT', 'PRINCIPAL'], false, 'Sample policy text. No electronic devices in the hall; malpractice is reported to the principal the same day.'],
      ['POSH', 'Prevention of Sexual Harassment Policy', 'POSH', [...allStaff, 'TRUSTEE'], true, 'Sample policy text. The internal committee hears complaints in confidence and acts within the statutory time.'],
    ];
    let inForce = 0;
    for (const [code, title, category, audienceRoles, ack, body] of defs) {
      // eslint-disable-next-line no-await-in-loop
      const p = await attempt(code, () => compliance.createPolicy(COMPLIANCE.actor, { code, title, category, audienceRoles, requiresAcknowledgement: ack, body }));
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      const sent = await attempt('submit', () => compliance.submitPolicy(COMPLIANCE.actor, p.id, {}));
      const reqId = sent?.versions?.find?.((v) => v.status === 'AWAITING_APPROVAL')?.approvalRequestId ?? (await Policy.findById(p.id).lean())?.versions?.find((v) => v.status === 'AWAITING_APPROVAL')?.approvalRequestId;
      // eslint-disable-next-line no-await-in-loop
      if (reqId && await attempt('approve policy', () => approvals.decide(PRINCIPAL.actor, String(reqId), { action: 'APPROVE', comment: 'Approved (sample).' }))) inForce += 1;
    }
    // Most staff have read and acknowledged them; a few have not yet.
    const people = await Profile.find({ tenantId: currentTenantId(), deletedAt: null, roleId: { $in: allStaff.map((k) => roleByKey.get(k)?._id).filter(Boolean) } }).select('_id').lean();
    const policies = await Policy.find({ currentVersion: { $ne: null }, requiresAcknowledgement: true }).lean();
    const acks = [];
    for (const p of policies) for (const [i, person] of people.entries()) if ((i + p.code.length) % 4 !== 0) acks.push({ policyId: p._id, version: p.currentVersion, profileId: person._id, at: daysAgo(1 + (i % 20)) });
    if (acks.length) await PolicyAcknowledgement.insertMany(acks, { ordered: false }).catch(() => {});
    return `${inForce} policies approved and in force (staff, students, parents, hostel, library, exams), ${acks.length} acknowledgements recorded`;
  });

  await section('Repairs history and everyone\'s own reports', null, async () => {
    const { WorkOrder, Facility } = await import('../models/facility.model.js');
    if (await WorkOrder.exists({ title: /\(sample history\)$/ })) return 'kept';
    const facilities = await import('../modules/administration/facility.service.js');
    const rooms = await Facility.find({}).limit(40).lean();
    const jobs = [['Projector bulb fused', 'ELECTRICAL'], ['Water cooler leaking', 'PLUMBING'], ['Window latch broken', 'CIVIL'], ['Printer jams every page', 'IT'], ['Door closer loose', 'FURNITURE'], ['Washroom tap dripping', 'PLUMBING'], ['Tube light flickering', 'ELECTRICAL'], ['Wi-Fi access point down', 'IT'], ['Desk wobbly', 'FURNITURE'], ['AC not cooling', 'HVAC']];
    const people = [PRINCIPAL, FINANCE, HR, MARKETING, COMPLIANCE, LIBRARIAN, WARDEN, TEACHER, ADMIN].filter(Boolean);
    let open = 0; let resolved = 0;
    for (const [i, p] of people.entries()) {
      for (let k = 0; k < 2; k++) {
        const [title, category] = jobs[(i * 2 + k) % jobs.length];
        const f = rooms[(i * 3 + k) % Math.max(1, rooms.length)];
        // eslint-disable-next-line no-await-in-loop
        const wo = await attempt(title, () => facilities.reportIssue(p.actor, { facilityId: f ? String(f._id) : undefined, title: `${title} (sample history)`, category, priority: k ? 'NORMAL' : 'HIGH', description: 'Reported through the portal. (Sample.)' }));
        if (!wo) continue;
        if (k === 1) {
          // eslint-disable-next-line no-await-in-loop
          await attempt('resolve', () => facilities.updateWorkOrder(ADMIN.actor, wo.id, { status: 'RESOLVED', resolution: 'Fixed by the maintenance team (sample).', costPaise: 150000 + i * 25000 }));
          const created = daysAgo(10 + i * 4);
          // eslint-disable-next-line no-await-in-loop
          await WorkOrder.updateOne({ _id: wo.id }, { $set: { createdAt: created, resolvedAt: new Date(created.getTime() + (1 + (i % 3)) * DAY) } }, { timestamps: false });
          resolved += 1;
        } else open += 1;
      }
    }
    // A year of resolved jobs (for the resolution-time trend and last year's comparison).
    const history = [];
    for (let i = 0; i < 90; i++) {
      const created = new Date(today.getTime() - (5 + i * 5) * DAY);
      const [title, category] = jobs[i % jobs.length];
      const resolvedAt = new Date(created.getTime() + (0.5 + random() * 5) * DAY);
      history.push({ refNo: `WO/HIST/${String(i + 1).padStart(4, '0')}`, facilityId: rooms[i % Math.max(1, rooms.length)]?._id ?? null, assetTag: null, title: `${title} (sample history)`, description: 'Closed job from the maintenance register. (Sample.)', category, priority: i % 6 === 0 ? 'HIGH' : 'NORMAL', kind: i % 10 === 0 ? 'PREVENTIVE' : 'REACTIVE', reportedByProfileId: pick(people).profile._id, reportedByName: 'Sample reporter', status: i % 4 === 0 ? 'CLOSED' : 'RESOLVED', resolution: 'Fixed (sample).', resolvedAt, costPaise: Math.round(50000 + random() * 600000), slaHours: 48, dueAt: new Date(created.getTime() + 2 * DAY), attachments: [], history: [], createdAt: created, updatedAt: resolvedAt });
    }
    await bulk(WorkOrder, history);
    return `${open} open and ${resolved} resolved repair requests reported by each member of staff, plus ${history.length} closed jobs over the year`;
  });

  await section('Board meeting held, with minutes and actions', null, async () => {
    const { BoardMeeting } = await import('../models/governance.model.js');
    if (await BoardMeeting.exists({ title: 'Annual general meeting of the trust (sample)' })) return 'kept';
    const governance = await import('../modules/governance/governance.service.js');
    const members = [TRUSTEE, PRINCIPAL, ADMIN, FINANCE].filter(Boolean);
    const m = await governance.create(PRINCIPAL.actor, { body: 'TRUST_BOARD', title: 'Annual general meeting of the trust (sample)', quorum: 2, mode: 'IN_PERSON', location: 'Board Room', durationMinutes: 120, memberProfileIds: members.map((x) => x.id), memberRoles: { [PRINCIPAL.id]: 'SECRETARY', ...(TRUSTEE ? { [TRUSTEE.id]: 'CHAIR' } : {}) }, proposedSlots: [daysAgo(35, 11).toISOString()] });
    await governance.schedule(PRINCIPAL.actor, 'ALL', m.id, { scheduledAt: daysAgo(30, 11).toISOString() });
    // Members had accepted before the meeting (the list otherwise read "0/4 accepted" for a meeting everyone attended).
    for (const p of members) {
      // eslint-disable-next-line no-await-in-loop
      await attempt('rsvp', () => governance.rsvp(p.actor, 'ALL', m.id, { rsvp: 'ACCEPTED' }));
    }
    await attempt('agenda', () => governance.setAgenda(PRINCIPAL.actor, 'ALL', m.id, { items: [{ title: 'Annual accounts 2025-26', decisionNeeded: true }, { title: 'Fee revision for 2027-28', decisionNeeded: true }, { title: 'New science block: progress', decisionNeeded: false }] }));
    const full = await governance.get(PRINCIPAL.actor, 'ALL', m.id);
    const attendance = (full.members ?? []).map((x) => ({ memberId: x.id ?? x._id, attended: true }));
    await attempt('record', () => governance.record(PRINCIPAL.actor, 'ALL', m.id, {
      attendance,
      minutes: 'The board adopted the audited accounts for 2025-26, approved a 6% fee revision for 2027-28 and reviewed the science block. (Sample minutes.)',
      resolutions: [{ text: 'The audited accounts for 2025-26 are adopted.', votesFor: 2, votesAgainst: 0, outcome: 'PASSED' }, { text: 'Fees for 2027-28 are revised by 6%.', votesFor: 2, votesAgainst: 0, outcome: 'PASSED' }],
      actions: [
        { title: 'Publish the revised fee schedule to parents', ownerProfileId: FINANCE?.id ?? PRINCIPAL.id, dueOn: daysAhead(10).toISOString(), status: 'OPEN' },
        { title: 'Obtain three quotes for the science block furniture', ownerProfileId: ADMIN.id, dueOn: daysAgo(5).toISOString(), status: 'OPEN' },
        { title: 'File the accounts with the registrar', ownerProfileId: PRINCIPAL.id, dueOn: daysAgo(10).toISOString(), status: 'DONE' },
      ],
    }));
    const approver = TRUSTEE?.actor ?? PRINCIPAL.actor;
    await attempt('approve minutes', () => governance.approveMinutes(approver, 'ALL', m.id));
    return 'a meeting held 30 days ago with attendance, two resolutions passed, approved minutes and three actions (two open)';
  });

  await section('Mentoring (supervised)', null, async () => {
    const { MentorProfile } = await import('../models/community.model.js');
    if (await MentorProfile.exists({ headline: /olympiad coach \(sample\)$/ })) return 'kept';
    const community = await import('../modules/community/community.service.js');
    const mentors = [];
    const offer = [[ALUMNUS, 'Software engineer; happy to talk about careers in tech (sample)', ['Careers', 'Coding', 'College applications'], '2018'], ...teachers.slice(0, 3).map((t, i) => [{ actor: actorOf(t, 'TEACHER'), id: String(t._id) }, `${['Maths olympiad coach', 'Science fair mentor', 'Debate and public speaking'][i]} (sample)`, [['Olympiads', 'Problem solving'], ['Science projects'], ['Debate', 'Public speaking']][i], null])];
    for (const [p, headline, topics, batch] of offer) {
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      const m = await attempt('mentor', () => community.upsertMentorProfile(p.actor, { headline, topics, batch, availability: 'Saturday mornings', optedIn: true }));
      if (!m) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!m.verified && !m.verifiedAffiliation) await attempt('verify', () => community.verifyMentor(ADMIN.actor, m.id));
      mentors.push(m);
    }
    let reqs = 0;
    if (STUDENT && mentors.length) {
      for (const [i, m] of mentors.slice(0, 3).entries()) {
        // eslint-disable-next-line no-await-in-loop
        const r = await attempt('request', () => community.requestMentoring(STUDENT.actor, { mentorId: m.id, topic: ['Choosing a stream after Class 10', 'Preparing for the maths olympiad', 'Science fair project idea'][i], message: 'Could we talk in a group session? (Sample.)' }));
        if (!r) continue;
        reqs += 1;
        // eslint-disable-next-line no-await-in-loop
        if (i === 0) await attempt('supervise', () => community.respondMentoring(ADMIN.actor, r.id, { action: 'ASSIGN_SUPERVISOR' }));
      }
    }
    return `${mentors.length} verified mentors (the demo alumnus and three teachers), ${reqs} supervised requests from the demo student`;
  });

  await section('Report cards published for the demo class', null, async () => {
    const rcModels = await import('../models/reportCard.model.js');
    const rc = await import('../modules/reportcards/reportcards.service.js');
    if (await rcModels.ReportCardVersion.exists({})) return 'kept';
    const tpl = await rcModels.ReportCardTemplate.findOne({ name: 'Oakridge term report (sample)' }).lean() ?? await rcModels.ReportCardTemplate.findOne({}).lean();
    if (!tpl) return 'skipped (no template)';
    const demoSec = demoStudent ? String(enrolmentOf.get(String(demoStudent._id))?.sectionId ?? '') : '';
    // The demo student's class is published; the demo teacher's first class gets drafts to work on.
    const targets = [...new Set([demoSec, ...teacherSectionIds.slice(0, 1)].filter(Boolean))];
    let drafts = 0; let publishedN = 0;
    for (const sid of targets) {
      // eslint-disable-next-line no-await-in-loop
      const out = await attempt(`report cards ${sid}`, () => rc.generate(PRINCIPAL.actor, 'ALL', { sectionId: sid, termKey: 'TERM_1', templateId: String(tpl._id) }));
      drafts += out?.created ?? 0;
      if (sid !== demoSec) continue;
      const sec = sections.find((x) => String(x._id) === sid);
      const ct = sec?.classTeacherId ? actorOf(await Profile.findById(sec.classTeacherId).lean(), 'TEACHER') : TEACHER.actor;
      const cards = await rcModels.TermReportCard.find({ sectionId: sid, termKey: 'TERM_1' }).select('_id').lean();
      for (const c of cards.slice(0, 15)) {
        // eslint-disable-next-line no-await-in-loop
        await attempt('fill', () => rc.update(ct, 'OWN', String(c._id), { coScholastic: { WORK_EDUCATION: pick(['A', 'B']), ART_EDUCATION: pick(['A', 'B', 'C']), HEALTH_PE: pick(['A', 'B']) }, discipline: pick(['A', 'A', 'B']), classTeacherRemarks: pick(['Attentive in class and helpful to others. (Sample remark.)', 'Works steadily; should read more at home. (Sample remark.)', 'Asks good questions; keep practising written answers. (Sample remark.)']) }));
      }
      await attempt('class teacher approval', () => rc.bulk(ct, 'OWN', { action: 'CLASS_TEACHER_APPROVE', sectionId: sid, termKey: 'TERM_1', allowIncomplete: true }));
      await attempt('principal approval', () => rc.bulk(PRINCIPAL.actor, 'ALL', { action: 'PRINCIPAL_APPROVE', sectionId: sid, termKey: 'TERM_1' }));
      const pub = await attempt('publish', () => rc.bulk(PRINCIPAL.actor, 'ALL', { action: 'PUBLISH', sectionId: sid, termKey: 'TERM_1' }));
      publishedN += pub?.done ?? 0;
    }
    return `${publishedN} Term 1 report cards published for the demo student's class${drafts > publishedN ? `; ${drafts - publishedN} draft cards for the demo teacher's class` : ''}`;
  });

  await section('Support plan shared with the demo family', null, async () => {
    const { SupportPlan } = await import('../models/supportPlan.model.js');
    if (!demoStudent || await SupportPlan.exists({ studentId: demoStudent._id })) return 'kept';
    const plans = await import('../modules/support/support.service.js');
    const p = await plans.create(PRINCIPAL.actor, 'ALL', {
      studentId: String(demoStudent._id), concernArea: 'ACADEMIC', riskType: 'LOW_MARKS', ownerProfileId: TEACHER?.id,
      summary: 'Mathematics marks dipped in the October class test. Together we will practise the weaker topics with short weekly goals.',
      goals: [{ title: 'Raise the maths class-test score', measure: 'Average of the next three class tests', unit: '%', baseline: 52, target: 70, reviewOn: ymdOf(new Date(today.getTime() + 28 * DAY)) }],
      actions: [{ title: 'Two extra practice sheets each week', ownerKind: 'STAFF', ownerProfileId: TEACHER?.id, dueOn: ymdOf(new Date(today.getTime() + 7 * DAY)) }, { title: 'Twenty minutes of revision each evening', ownerKind: 'FAMILY' }],
    });
    await attempt('share', () => plans.share(PRINCIPAL.actor, 'ALL', p.id));
    return 'an academic support plan for the demo student, shared with the family';
  });

  await section('Budgets: this year with the trustees, last year approved', null, async () => {
    const { ApprovalRequest } = await import('../models/approval.model.js');
    const approvals = await import('../modules/approvals/approval.service.js');
    const procurement = await import('../modules/finance-ops/procurement.service.js');
    const { Budget } = await import('../models/finance.model.js');
    if (await Budget.exists({ fiscalYear: '2025-26' })) return 'kept';
    const note = [];
    const open = await ApprovalRequest.findOne({ entityType: 'Budget', status: 'PENDING', currentStage: 0 }).lean();
    if (open && await attempt('principal stage', () => approvals.decide(PRINCIPAL.actor, String(open._id), { action: 'APPROVE', comment: 'Recommended to the board (sample).' }))) note.push('this year\'s budget passed by the principal and now with the trustees');
    const prev = await attempt('last year budget', () => procurement.createBudget(FINANCE.actor, { fiscalYear: '2025-26', name: 'Annual budget 2025-26', lines: [
      { code: 'IT', head: 'Computers and IT', kind: 'CAPEX', plannedPaise: 1_000_000_00 }, { code: 'FURN', head: 'Furniture', kind: 'CAPEX', plannedPaise: 350_000_00 },
      { code: 'LAB', head: 'Laboratory supplies', kind: 'OPEX', plannedPaise: 220_000_00 }, { code: 'EVT', head: 'Events and fests', kind: 'OPEX', plannedPaise: 280_000_00 },
      { code: 'MKT', head: 'Marketing and admissions', kind: 'OPEX', plannedPaise: 300_000_00 }, { code: 'MNT', head: 'Repairs and maintenance', kind: 'OPEX', plannedPaise: 450_000_00 },
    ] }));
    if (prev && await attempt('submit', () => procurement.submitBudget(FINANCE.actor, prev.id))) {
      for (const d of [PRINCIPAL, TRUSTEE].filter(Boolean)) {
        // eslint-disable-next-line no-await-in-loop
        const req = await ApprovalRequest.findOne({ entityType: 'Budget', entityId: String(prev.id), status: 'PENDING' }).lean();
        // eslint-disable-next-line no-await-in-loop
        if (req) await attempt('approve last year', () => approvals.decide(d.actor, String(req._id), { action: 'APPROVE', comment: 'Approved (sample).' }));
      }
      note.push('the 2025-26 budget approved');
      // Last year's outturn, so budget-versus-actual has something to show (sample figures).
      const outturn = { IT: 0.97, FURN: 1.12, LAB: 0.88, EVT: 1.04, MKT: 0.91, MNT: 1.18 };
      const b = await Budget.findById(prev.id);
      if (b) {
        for (const l of b.lines) { l.actualPaise = Math.round(l.plannedPaise * (outturn[l.code] ?? 1)); l.committedPaise = 0; }
        const mnt = b.lines.find((l) => l.code === 'MNT');
        if (mnt) mnt.varianceExplanation = 'Roof waterproofing after the July rains (sample).';
        b.markModified('lines');
        await b.save();
        note.push('with last year’s actual spend by line');
      }
    }
    return note.join('; ') || 'nothing to do';
  });

  await section('Staff meetings, webinars, purchase requests and moderation queues', null, async () => {
    const { OnlineClass } = await import('../models/onlineClass.model.js');
    if (await OnlineClass.exists({ kind: 'STAFF_MEETING' })) return 'kept';
    const lectures = await import('../modules/lectures/lecture.service.js');
    const notes = [];
    // A weekly staff meeting for everyone on staff: three already held, the rest ahead.
    const staffRoles = ['ADMIN', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE'];
    const meet = await attempt('staff meeting', () => lectures.create(PRINCIPAL.actor, { title: 'Weekly staff meeting', kind: 'STAFF_MEETING', inviteeRoles: staffRoles, startsAt: daysAhead(1, 15).toISOString(), durationMinutes: 45, repeatWeekly: 6, provider: 'JITSI', description: 'Updates from each department. (Sample.)' }));
    if (meet) {
      const series = await OnlineClass.find({ kind: 'STAFF_MEETING', hostProfileId: PRINCIPAL.profile._id }).sort({ startsAt: 1 }).lean();
      // The first three dates are moved into the past and marked held.
      for (const [i, c] of series.slice(0, 3).entries()) {
        const startsAt = new Date(c.startsAt.getTime() - (3 + i) * 7 * DAY);
        const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
        // eslint-disable-next-line no-await-in-loop
        await OnlineClass.updateOne({ _id: c._id }, { $set: { startsAt, endsAt, status: 'ENDED', endedAt: endsAt, summary: 'Minutes shared on the notice board. (Sample.)' } });
      }
      notes.push(`a weekly staff meeting (${series.length} dates, 3 held)`);
    }
    const seniors = sections.slice(-3).map((x) => String(x._id));
    // Hosted by a teacher of the senior classes (classes are scheduled by those who teach them).
    const seniorOffering = coreOfferings.find((o) => seniors.includes(String(o.sectionId)) && o.teacherId);
    const host = seniorOffering ? actorOf(await Profile.findById(seniorOffering.teacherId).lean(), 'TEACHER') : TEACHER.actor;
    const hostSections = seniorOffering ? coreOfferings.filter((o) => String(o.teacherId) === String(seniorOffering.teacherId) && seniors.includes(String(o.sectionId))).map((o) => String(o.sectionId)) : [];
    if (await attempt('careers webinar', () => lectures.create(host, { title: 'Careers webinar with our alumni', kind: 'WEBINAR', sectionIds: [...new Set(hostSections)], inviteeProfileIds: ALUMNUS ? [ALUMNUS.id] : [], startsAt: daysAhead(6, 17).toISOString(), durationMinutes: 60, provider: 'JITSI', description: 'Alumni talk about their work and answer questions. (Sample.)' }))) notes.push('an alumni careers webinar for the senior classes');

    // A purchase request from each department (drafts and submitted).
    const procurement = await import('../modules/finance-ops/procurement.service.js');
    const { Budget } = await import('../models/finance.model.js');
    const budget = await Budget.findOne({ fiscalYear: '2026-27' }).lean();
    let prs = 0;
    for (const [p, title, line, desc, qty, unit, submit] of [
      [HR, 'Training workbooks for the induction programme', 'EVT', 'Induction workbook', 30, 25000, true], [MARKETING, 'Printed brochures for admissions 2027-28', 'MKT', 'A4 brochure, 8 pages', 2000, 1800, true],
      [COMPLIANCE, 'Fire extinguisher refills', 'MNT', 'ABC extinguisher refill', 24, 90000, false], [WARDEN, 'Study lamps for the hostel', 'FURN', 'LED study lamp', 40, 65000, true], [ADMIN, 'Water purifier service kit', 'MNT', 'RO service kit', 4, 350000, false],
    ]) {
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      const pr = await attempt(title, () => procurement.createRequestDraft(p.actor, { title: `${title} (sample)`, justification: 'Needed this term. (Sample.)', ...(budget ? { budgetId: String(budget._id), budgetLineCode: line } : {}), items: [{ description: desc, qty, estUnitPaise: unit, isAsset: false }] }));
      if (!pr) continue;
      prs += 1;
      // eslint-disable-next-line no-await-in-loop
      if (submit) await attempt('submit request', () => procurement.submit(p.actor, 'OWN', pr.id));
    }
    notes.push(`${prs} purchase requests from five departments`);

    // Comments waiting for a moderator, and a report to review.
    const community = await import('../modules/community/community.service.js');
    const { CommunityPost } = await import('../models/community.model.js');
    const posts = await CommunityPost.find({ status: 'PUBLISHED' }).sort({ createdAt: -1 }).limit(3).lean();
    let comments = 0;
    for (const [i, post] of posts.entries()) {
      for (const [p, body] of [[PARENT, 'Lovely to see this, thank you to the teachers! (Sample comment.)'], [STUDENT, 'This was the best day of the term. (Sample comment.)']]) {
        if (!p) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await attempt('comment', () => community.comment(p.actor, String(post._id), { body }))) comments += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      if (i === 0 && PARENT) await attempt('report', () => community.report(PARENT.actor, { targetType: 'POST', targetId: String(post._id), reason: 'PRIVACY', detail: 'Please check whether my child should be in this photo. (Sample report.)' }));
    }
    notes.push(`${comments} comments (some waiting for a moderator) and a privacy report to review`);
    return notes.join('; ');
  });

  await section('Digest interests for every staff role', null, async () => {
    const { DigestPreference } = await import('../models/digest.model.js');
    const people = [ADMIN, FINANCE, HR, MARKETING, COMPLIANCE, LIBRARIAN, WARDEN, TRUSTEE].filter(Boolean);
    const interests = { ADMIN: ['EDUCATION_POLICY', 'TECHNOLOGY'], FINANCE: ['EDUCATION_POLICY'], HR: ['CAREERS', 'EDUCATION_POLICY'], MARKETING: ['EDUCATION_POLICY', 'TECHNOLOGY'], COMPLIANCE: ['EDUCATION_POLICY'], LIBRARIAN: ['SCIENCE', 'TECHNOLOGY', 'CAREERS'], WARDEN: ['SPORTS', 'ENVIRONMENT'], TRUSTEE: ['EDUCATION_POLICY'] };
    let n = 0;
    for (const p of people) {
      // eslint-disable-next-line no-await-in-loop
      const r = await DigestPreference.updateOne({ profileId: p.profile._id }, { $setOnInsert: { profileId: p.profile._id, interests: interests[p.actor.roleKey] ?? ['EDUCATION_POLICY'], emailOptIn: false } }, { upsert: true });
      n += r.upsertedCount ?? 0;
    }
    // More of today's headlines, so each interest has a few.
    const { DigestItem, DigestSource } = await import('../models/digest.model.js');
    let items = 0;
    if (!(await DigestItem.exists({ title: /^Term-time reading:/ }))) {
      const sources = await DigestSource.find({}).lean();
      const extra = [
        ['EDUCATION_POLICY', 'Term-time reading: how schools are using competency-based assessment (sample)'], ['EDUCATION_POLICY', 'Term-time reading: a plain guide to the new board exam calendar (sample)'],
        ['TECHNOLOGY', 'Term-time reading: keeping children safe online (sample)'], ['CAREERS', 'Term-time reading: apprenticeships after Class 12 (sample)'],
        ['SCIENCE', 'Term-time reading: a meteor shower to watch this month (sample)'], ['SPORTS', 'Term-time reading: school football league fixtures (sample)'],
        ['ENVIRONMENT', 'Term-time reading: composting at school, step by step (sample)'], ['MATHEMATICS', 'Term-time reading: why a pizza slice explains pi (sample)'],
      ];
      const at = Date.now();
      if (sources.length) {
        await DigestItem.insertMany(extra.map(([topic, title], i) => {
          const src = sources[i % sources.length];
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          return { sourceId: src._id, sourceTitle: src.title, link: `https://example.org/sample/${slug}`, title, summary: 'A short sample summary for the daily digest.', interests: [topic], publishedAt: new Date(at - (i + 2) * 3_600_000), fetchedAt: new Date(at) };
        }));
        items = extra.length;
      }
    }
    return `${n} more people follow topics; ${items} more headlines today`;
  });
}
