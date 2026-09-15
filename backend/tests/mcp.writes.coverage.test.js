import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import { MCP_TOOLS, mcpToolsFor, mutates, requiresConfirmation } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { env } from '../src/config/env.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Term, Subject, SubjectOffering, Section } from '../src/models/academics.model.js';
import { FeeHead, FeeStructure, Invoice, Payment, FeePlan, PaymentChangeRequest } from '../src/models/fee.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import { Notification } from '../src/models/notification.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { HostelRoom, HostelAllocation, HostelInquiry } from '../src/models/hostel.model.js';
import { Lead, LeadInteraction } from '../src/models/lead.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { SubjectRegistration } from '../src/models/subjectRegistration.model.js';
import { CoCurricularActivity } from '../src/models/coCurricular.model.js';
import { MedicalRecord } from '../src/models/medicalRecord.model.js';
import { Ticket, TicketMessage } from '../src/models/ticket.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../src/models/transport.model.js';
import { BookRequest } from '../src/models/bookRequest.model.js';
import { ProfileEditRequest } from '../src/models/profileEditRequest.model.js';
import { TransportRequest } from '../src/models/transportRequest.model.js';
import { Document } from '../src/models/document.model.js';
import * as library from '../src/modules/library/library.service.js';
import * as registrations from '../src/modules/registrations/registration.service.js';
import * as cocurricular from '../src/modules/studentRequests/cocurricular.service.js';
import * as profileEdit from '../src/modules/studentRequests/profileEdit.service.js';
import * as medical from '../src/modules/medical/medical.service.js';
import * as fees from '../src/modules/fees/fee.service.js';
import * as transport from '../src/modules/transport/transport.service.js';
import { seedSchool, seedPerson, mcp, inSchool, todayKey, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Every one of the 82 MCP write tools, executed through MCP.
 *
 * One case per tool — the role that should be able to do it (taken from the
 * real permission catalog), the records it needs, the arguments, and a
 * "footprint": a read of exactly the data the tool changes. Each case then
 * goes through the same tests:
 *
 *   executes      direct call → confirmation_required where policy says so →
 *                 nothing changed yet → confirm → the footprint changed as
 *                 expected → the MCP server's audit entry is EXECUTED, by this
 *                 person, confirmed.
 *   outsider      the same call by a role without the tool's permission (found
 *                 from the live permission map, not a role name) → FORBIDDEN,
 *                 no proposal, footprint unchanged.
 *   wrong scope   where the permission can be held at OWN, or the service has
 *                 a narrower rule — a role holding the permission but not over
 *                 this record → refused, footprint unchanged.
 *   wrong school  a Riverside administrator naming Oakridge records → refused,
 *                 footprint unchanged.
 *   battery       for every high-risk tool: no confirmation, a bogus token, a
 *                 token presented against another tool, an expired token,
 *                 another user's token, another school's session, permission
 *                 removed, then two simultaneous confirmations — exactly one
 *                 runs — and a replay. Nothing refused reaches the database.
 *
 * Results are recorded, and written out when MCP_WRITE_MATRIX names a file,
 * for the write-test matrix in docs/MCP-FINAL-READINESS.md.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});

const saved = { waId: env.WA_PHONE_NUMBER_ID, waToken: env.WA_ACCESS_TOKEN };
const toMeta = [];
afterEach(() => {
  env.WA_PHONE_NUMBER_ID = saved.waId;
  env.WA_ACCESS_TOKEN = saved.waToken;
  vi.unstubAllGlobals();
  toMeta.length = 0;
});

const matrix = {};
const record = (tool, key, value) => { (matrix[tool] ??= {})[key] = value; };
afterAll(async () => {
  await resetMcpClient();
  if (process.env.MCP_WRITE_MATRIX) fs.writeFileSync(process.env.MCP_WRITE_MATRIX, JSON.stringify(matrix, null, 2));
});

/* ── Helpers ──────────────────────────────────────────────── */

const oak = (fn) => inSchool(OAK, fn);
const days = (n) => new Date(Date.now() + n * 86_400_000);
const ymd = (d) => d.toISOString().slice(0, 10);
const idOf = (x) => String(x?._id ?? x?.id);
const executedIn = (tenant, tool) => inSchool(tenant, () => AuditLog.countDocuments({ action: `agent.${tool}`, 'after.via': 'MCP', 'after.status': 'EXECUTED' }));
/** Statuses the server recorded for a tool — "run never started" means none of EXECUTED / FAILED / ERROR. */
const ranIn = async (tenant, tool) => {
  const statuses = await inSchool(tenant, () => AuditLog.distinct('after.status', { action: `agent.${tool}`, 'after.via': 'MCP' }));
  return statuses.filter((s) => ['EXECUTED', 'FAILED', 'ERROR'].includes(s));
};

/** WhatsApp in live mode against a stubbed Graph API; the recorded sends land in `toMeta`. */
function liveWhatsapp() {
  env.WA_PHONE_NUMBER_ID = '000111222';
  env.WA_ACCESS_TOKEN = 'meta-access-token-for-tests';
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    toMeta.push({ url: String(url), body: JSON.parse(init?.body ?? 'null') });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.stub' }] }), text: async () => '{}' };
  }));
}

/** Everything the cases build on, created on demand and once per test. */
function world(s) {
  const memo = {};
  const once = (key, fn) => (memo[key] ??= fn());
  const w = {
    term: () => once('term', () => oak(() => Term.create({
      academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
    }))),
    subject: (name) => once(`subject:${name}`, () => oak(() => Subject.create({ name }))),
    offering: ({ key = 'maths', section = s.sectionA, teacher = s.people.TEACHER, subject = 'Mathematics', isElective = false, capacity } = {}) =>
      once(`offering:${key}`, async () => {
        const [term, subj] = await Promise.all([w.term(), w.subject(subject)]);
        return oak(() => SubjectOffering.create({
          sectionId: section._id, subjectId: subj._id, termId: term._id, teacherId: teacher?.profile._id ?? null,
          isElective, ...(capacity ? { capacity } : {}),
        }));
      }),
    elective: () => w.offering({ key: 'art', subject: 'Art', isElective: true, capacity: 30 }),
    exam: () => once('exam', async () => {
      const term = await w.term();
      return oak(() => Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-09-05') }));
    }),
    examSubject: () => once('examSubject', async () => {
      const [exam, off] = await Promise.all([w.exam(), w.offering()]);
      return oak(() => ExamSubject.create({ examId: exam._id, subjectOfferingId: off._id, maxMarks: 50 }));
    }),
    draftMark: () => once('draftMark', async () => {
      const es = await w.examSubject();
      return oak(() => Mark.create({ examSubjectId: es._id, enrollmentId: s.rahul.enrollment._id, marks: 40, status: 'DRAFT' }));
    }),
    assignment: () => once('assignment', async () => {
      const off = await w.offering();
      return oak(() => Assignment.create({ subjectOfferingId: off._id, title: 'Chapter 3 exercises', dueAt: days(7) }));
    }),
    submission: () => once('submission', async () => {
      const a = await w.assignment();
      return oak(() => Submission.create({ assignmentId: a._id, enrollmentId: s.priya.enrollment._id, status: 'SUBMITTED', attachments: ['https://example.org/priya.pdf'] }));
    }),
    room: () => once('room', () => oak(() => HostelRoom.create({ roomNo: 'A-101', capacity: 2 }))),
    allocation: () => once('allocation', async () => {
      const room = await w.room();
      return oak(() => HostelAllocation.create({ roomId: room._id, studentId: s.aman.student._id, status: 'ACTIVE' }));
    }),
    inquiry: () => once('inquiry', () => oak(() => HostelInquiry.create({ subject: 'Fan not working', raisedByProfileId: s.people.PARENT.profile._id }))),
    book: () => once('book', () => oak(() => library.createBook({ title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', totalCopies: 2 }, s.people.LIBRARIAN.actor))),
    issue: () => once('issue', async () => {
      const book = await w.book();
      return oak(() => library.issueBook({ bookId: idOf(book), studentId: s.rahul.student._id, dueAt: ymd(days(14)) }));
    }),
    lead: () => once('lead', () => oak(() => Lead.create({ childName: 'Kabir Kapoor', guardianName: 'Mr Kapoor', phone: '+919000033333' }))),
    ticket: () => once('ticket', () => oak(() => Ticket.create({ subject: 'Bus timing', raisedByProfileId: s.people.PARENT.profile._id }))),
    leave: (who = s.rahul) => once(`leave:${who.student.admissionNo}`, () => oak(() => LeaveApplication.create({
      enrollmentId: who.enrollment._id, fromDate: days(20), toDate: days(21), reason: 'Fever',
    }))),
    registration: () => once('registration', async () => {
      const off = await w.elective();
      return oak(() => registrations.register(s.people.STUDENT.actor, String(off._id)));
    }),
    cocurricular: () => once('co', () => oak(() => cocurricular.request(s.people.STUDENT.actor, { name: 'Science fair', activityDate: '2026-08-10' }))),
    profileEdit: () => once('pe', () => oak(() => profileEdit.request(s.people.STUDENT.actor, { changes: { address: '22 Lake Road' } }))),
    medical: () => once('medical', () => oak(() => medical.upsert(s.people.ADMIN.actor, 'ALL', String(s.rahul.student._id), { bloodGroup: 'A+' }))),
    feeStructure: () => once('structure', async () => oak(async () => {
      const head = await FeeHead.create({ name: 'Tuition' });
      return FeeStructure.create({ feeHeadId: head._id, academicYearId: s.year._id, name: 'Tuition 2026-27', amountPaise: 400000, dueOn: days(30) });
    })),
    plan: (status) => once(`plan:${status}`, () => oak(() => FeePlan.create({
      enrollmentId: s.aman.enrollment._id, studentId: s.aman.student._id, academicYearId: s.year._id,
      name: 'Aman — 2 installments', totalPaise: 500000, mode: 'INSTALLMENT', status,
      installments: [{ seq: 1, amountPaise: 250000, dueOn: days(30) }, { seq: 2, amountPaise: 250000, dueOn: days(60) }],
    }))),
    pendingPayment: () => once('pending', () => oak(async () => (await fees.recordPayment(s.people.FINANCE.actor, 'ALL', {
      invoiceId: s.inv1._id, amountPaise: 100000, mode: 'CASH',
    })).payment)),
    publishedPayment: () => once('published', () => oak(async () => (await fees.recordPayment(s.people.ADMIN.actor, 'ALL', {
      invoiceId: s.inv1._id, amountPaise: 100000, mode: 'CASH',
    })).payment)),
    changeRequest: () => once('changeRequest', async () => {
      const p = await w.publishedPayment();
      return oak(() => fees.createPaymentChangeRequest(s.people.FINANCE.actor, {
        paymentId: p._id, field: 'notes', requestedValue: 'Corrected by finance', reason: 'Receipt typo',
      }));
    }),
    route: () => once('route', () => oak(() => transport.createRoute({ name: 'Route 7' }))),
    stop: () => once('stop', async () => {
      const route = await w.route();
      return oak(() => transport.createStop({ routeId: route._id, name: 'Market', sequenceNo: 1 }));
    }),
    bookRequest: () => once('bookRequest', async () => {
      const book = await w.book();
      return oak(() => BookRequest.create({
        bookId: idOf(book), studentId: s.priya.student._id,
        requestedByProfileId: s.people.STUDENT.profile._id, status: 'PENDING',
      }));
    }),
    transportRequest: () => once('transportRequest', async () => {
      const route = await w.route();
      const stop = await w.stop();
      return oak(() => TransportRequest.create({
        studentId: s.priya.student._id, routeId: idOf(route), stopId: idOf(stop),
        academicYearId: s.year._id, requestedByProfileId: s.people.STUDENT.profile._id,
        status: 'PENDING',
      }));
    }),
    document: () => once('document', () => oak(() => Document.create({
      title: 'Old circular', type: 'CUSTOM', fileUrl: '/uploads/old.pdf', authorProfileId: s.people.ADMIN.profile._id, visibleToRoles: ['PARENT'],
    }))),
    // Authored by the administrator, so an ALL-scope publisher resolves it as
    // its own target and a teacher — who holds announcements.publish at OWN but
    // did not write it — is the natural wrong-scope case.
    announcement: () => once('announcement', () => oak(() => Announcement.create({
      title: 'Library books',
      content: 'Return the library books.',
      audience: { all: false, sectionIds: [s.sectionA._id], gradeIds: [], subjectIds: [], roleKeys: [] },
      createdByProfileId: s.people.ADMIN.profile._id,
    }))),
    secondTeacher: () => once('teacher2', () => seedPerson({ roleKey: 'TEACHER', roleId: s.roleIds.TEACHER, displayName: 'Other teacher' })),
  };
  return w;
}

const read = (fn) => oak(fn);
const count = (Model, filter = {}) => read(() => Model.countDocuments(filter));
const field = (Model, id, path) => read(() => Model.findById(id).lean()).then((d) => (d ? path.split('.').reduce((o, k) => o?.[k], d) : '(gone)'));

/* ── The 82 write tools ───────────────────────────────────── */

/**
 * role         who performs it (holds the permission at the scope it needs)
 * setup        (w, s) → ctx   records the call needs
 * args         (s, ctx) → the MCP arguments
 * footprint    (s, ctx) → what the tool changes, read from the database
 * changed      (before, after, s, ctx) → assertions that it changed correctly
 * wrongScope   { actor: (s, w) → actor, args?, codes }  — permission held, record not theirs
 * tenant       false when the tool names no existing record (a Riverside
 *              admin creating in Riverside is legitimate)
 */
const CASES = [
  /* Students */
  { tool: 'create_student', role: 'ADMIN', tenant: false,
    args: () => ({ admissionNo: 'OAK-50', firstName: 'Neha', lastName: 'Joshi' }),
    footprint: () => count(Student, { admissionNo: 'OAK-50' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'enroll_student', role: 'ADMIN',
    setup: async (_w, s) => ({ student: await oak(() => Student.create({ admissionNo: 'OAK-51', firstName: 'Ira' })) }),
    args: (s, c) => ({ studentId: idOf(c.student), sectionId: idOf(s.sectionB), academicYearId: idOf(s.year), rollNo: 7 }),
    footprint: (s, c) => read(() => Enrollment.findOne({ studentId: c.student._id }).lean()).then((e) => (e ? `${e.sectionId}:${e.rollNo}` : null)),
    changed: (b, a, s) => { expect(b).toBeNull(); expect(a).toBe(`${s.sectionB._id}:7`); } },
  { tool: 'update_student', role: 'ADMIN',
    args: () => ({ admissionNo: 'OAK-3', fields: { address: '9 Park Street' } }),
    footprint: (s) => field(Student, s.aman.student._id, 'address'),
    changed: (b, a) => { expect(a).toBe('9 Park Street'); expect(b ?? null).toBeNull(); } },
  { tool: 'update_enrollment_status', role: 'ADMIN',
    args: (s) => ({ enrollmentId: idOf(s.aman.enrollment), status: 'TRANSFERRED' }),
    footprint: (s) => field(Enrollment, s.aman.enrollment._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['ACTIVE', 'TRANSFERRED']); } },
  { tool: 'archive_student', role: 'ADMIN',
    args: () => ({ admissionNo: 'OAK-3' }),
    footprint: (s) => field(Student, s.aman.student._id, 'deletedAt').then((d) => Boolean(d)),
    changed: (b, a) => { expect([b, a]).toEqual([false, true]); } },
  { tool: 'anonymise_student', role: 'ADMIN',
    args: () => ({ admissionNo: 'OAK-3', reason: 'Family erasure request' }),
    footprint: (s) => field(Student, s.aman.student._id, 'firstName'),
    changed: (b, a) => { expect(b).toBe('Aman'); expect(a).not.toBe('Aman'); } },

  /* Attendance */
  { tool: 'mark_attendance', role: 'TEACHER',
    args: () => ({ students: [{ studentName: 'Rahul Sharma', status: 'PRESENT' }] }),
    footprint: (s) => read(() => AttendanceRecord.findOne({ enrollmentId: s.rahul.enrollment._id, date: todayKey() }).lean()).then((r) => r?.status ?? null),
    changed: (b, a) => { expect([b, a]).toEqual(['ABSENT', 'PRESENT']); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, args: () => ({ students: [{ studentName: 'Riya Kapoor', status: 'ABSENT' }] }), codes: ['NOT_FOUND', 'FORBIDDEN'] } },
  { tool: 'bulk_mark_attendance', role: 'TEACHER',
    args: (s) => ({ sectionId: idOf(s.sectionA), rows: [{ rollNo: 3, status: 'ABSENT' }] }),
    footprint: (s) => read(() => AttendanceRecord.findOne({ enrollmentId: s.aman.enrollment._id, date: todayKey() }).lean()).then((r) => r?.status ?? null),
    changed: (b, a) => { expect([b, a]).toEqual([null, 'ABSENT']); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, args: (s) => ({ sectionId: idOf(s.sectionB), rows: [{ rollNo: 1, status: 'ABSENT' }] }), codes: ['FORBIDDEN', 'NOT_FOUND'] } },

  /* Fees */
  { tool: 'create_invoice', role: 'FINANCE',
    args: (s) => ({ enrollmentId: idOf(s.aman.enrollment), invoiceNo: 'INV-2001', dueOn: ymd(days(40)), lines: [{ description: 'Lab fee', amountPaise: 150000 }] }),
    footprint: () => read(() => Invoice.findOne({ invoiceNo: 'INV-2001' }).lean()).then((i) => i?.totalPaise ?? null),
    changed: (b, a) => { expect([b, a]).toEqual([null, 150000]); } },
  { tool: 'create_fee_head', role: 'FINANCE', tenant: false,
    args: () => ({ name: 'Laboratory', category: 'TUITION' }),
    footprint: () => count(FeeHead, { name: 'Laboratory' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'create_fee_structure', role: 'FINANCE',
    setup: async (w) => ({ structure: await w.feeStructure() }),
    args: (s, c) => ({
      feeHeadId: String(c.structure.feeHeadId), academicYearId: idOf(s.year),
      name: 'Laboratory — Term 1', amountPaise: 250000, dueOn: ymd(days(45)),
    }),
    footprint: () => count(FeeStructure, { name: 'Laboratory — Term 1' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'generate_invoices', role: 'ADMIN', tenantEmptyOk: true,
    setup: (w) => w.feeStructure().then(() => ({})),
    args: (s) => ({ academicYearId: idOf(s.year) }),
    footprint: () => count(Invoice),
    changed: (b, a) => { expect(a).toBeGreaterThan(b); } },
  { tool: 'create_fee_plan', role: 'FINANCE',
    args: (s) => ({
      enrollmentId: idOf(s.aman.enrollment), mode: 'INSTALLMENT', totalPaise: 500000, name: 'Aman plan',
      installments: [{ amountPaise: 250000, dueOn: ymd(days(30)) }, { amountPaise: 250000, dueOn: ymd(days(60)) }],
    }),
    footprint: () => read(() => FeePlan.findOne({ name: 'Aman plan' }).lean()).then((p) => p?.status ?? null),
    changed: (b, a) => { expect([b, a]).toEqual([null, 'DRAFT']); } },
  { tool: 'update_fee_plan', role: 'FINANCE',
    setup: async (w) => ({ plan: await w.plan('DRAFT') }),
    args: (_s, c) => ({ planId: idOf(c.plan), notes: 'Adjusted after meeting' }),
    footprint: (_s, c) => field(FeePlan, c.plan._id, 'notes'),
    changed: (b, a) => { expect(b ?? null).toBeNull(); expect(a).toBe('Adjusted after meeting'); } },
  { tool: 'transition_fee_plan', role: 'ADMIN',
    setup: async (w) => ({ plan: await w.plan('PENDING_ADMIN_APPROVAL') }),
    args: (_s, c) => ({ planId: idOf(c.plan), step: 'approve' }),
    footprint: (_s, c) => field(FeePlan, c.plan._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING_ADMIN_APPROVAL', 'APPROVED']); },
    wrongScope: { actor: (s) => s.people.FINANCE.actor, codes: ['FORBIDDEN'] } },
  { tool: 'publish_fee_plan', role: 'ADMIN',
    setup: async (w) => ({ plan: await w.plan('APPROVED') }),
    args: (_s, c) => ({ planId: idOf(c.plan) }),
    footprint: async (_s, c) => `${await field(FeePlan, c.plan._id, 'status')}:${await count(Invoice)}`,
    changed: (b, a) => { expect(b).toBe('APPROVED:2'); expect(a).toBe('PUBLISHED:4'); } },
  { tool: 'record_payment', role: 'FINANCE',
    args: () => ({ invoiceNo: 'INV-1001', amountPaise: 100000, mode: 'CASH' }),
    footprint: (s) => count(Payment, { invoiceId: s.inv1._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    wrongScope: { actor: (s) => s.people.PARENT.actor, codes: ['FORBIDDEN_SCOPE'] } },
  { tool: 'approve_payment', role: 'ADMIN',
    setup: async (w) => ({ payment: await w.pendingPayment() }),
    args: (_s, c) => ({ paymentId: idOf(c.payment) }),
    footprint: (_s, c) => field(Payment, c.payment._id, 'recordStatus'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING_ADMIN_APPROVAL', 'PUBLISHED']); } },
  { tool: 'reject_payment', role: 'ADMIN',
    setup: async (w) => ({ payment: await w.pendingPayment() }),
    args: (_s, c) => ({ paymentId: idOf(c.payment), reason: 'Cheque bounced' }),
    footprint: (_s, c) => field(Payment, c.payment._id, 'recordStatus'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING_ADMIN_APPROVAL', 'REJECTED']); } },
  { tool: 'refund_payment', role: 'FINANCE',
    setup: async (w) => ({ payment: await w.publishedPayment() }),
    args: (_s, c) => ({ paymentId: idOf(c.payment) }),
    footprint: (_s, c) => field(Payment, c.payment._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['SUCCESS', 'REFUNDED']); } },
  { tool: 'update_payment', role: 'ADMIN',
    setup: async (w) => ({ payment: await w.publishedPayment() }),
    args: (_s, c) => ({ paymentId: idOf(c.payment), notes: 'Receipt reissued', reason: 'Typo on receipt' }),
    footprint: (_s, c) => field(Payment, c.payment._id, 'notes'),
    changed: (b, a) => { expect(b ?? null).toBeNull(); expect(a).toBe('Receipt reissued'); } },
  { tool: 'decide_payment_change_request', role: 'ADMIN',
    setup: async (w) => ({ request: await w.changeRequest(), payment: await w.publishedPayment() }),
    args: (_s, c) => ({ requestId: idOf(c.request), approve: true }),
    footprint: async (_s, c) => `${await field(PaymentChangeRequest, c.request._id, 'status')}:${await field(Payment, c.payment._id, 'notes')}`,
    changed: (b, a) => { expect(b).toBe('PENDING_ADMIN_APPROVAL:null'); expect(a).toBe('APPROVED:Corrected by finance'); } },

  /* Academics */
  { tool: 'create_section', role: 'ADMIN',
    args: (s) => ({ gradeId: idOf(s.grade), name: 'C' }),
    footprint: () => count(Section, { name: 'C' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_section', role: 'ADMIN',
    args: (s) => ({ sectionId: idOf(s.sectionB), name: 'B2' }),
    footprint: (s) => field(Section, s.sectionB._id, 'name'),
    changed: (b, a) => { expect([b, a]).toEqual(['B', 'B2']); } },
  { tool: 'assign_teacher_to_subject', role: 'ADMIN',
    setup: async (w) => ({ term: await w.term(), subject: await w.subject('Art') }),
    args: (s, c) => ({ subjectId: idOf(c.subject), sectionId: idOf(s.sectionB), termId: idOf(c.term), teacherId: s.people.TEACHER.actor.profileId }),
    footprint: (s) => count(SubjectOffering, { sectionId: s.sectionB._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_subject_offering', role: 'ADMIN',
    setup: async (w) => ({ offering: await w.offering() }),
    args: (_s, c) => ({ offeringId: idOf(c.offering), capacity: 40 }),
    footprint: (_s, c) => field(SubjectOffering, c.offering._id, 'capacity'),
    changed: (b, a) => { expect(b ?? null).toBeNull(); expect(a).toBe(40); } },
  { tool: 'upsert_timetable_slot', role: 'ADMIN',
    setup: async (w) => ({ offering: await w.offering() }),
    args: (s, c) => ({ sectionId: idOf(s.sectionA), dayOfWeek: 1, periodNo: 1, startTime: '09:00', endTime: '09:40', subjectOfferingId: idOf(c.offering) }),
    footprint: (s) => count(TimetableSlot, { sectionId: s.sectionA._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'create_exam', role: 'ADMIN',
    setup: async (w) => ({ term: await w.term() }),
    args: (_s, c) => ({ name: 'Mid Term', termId: idOf(c.term), startsOn: '2026-09-20', endsOn: '2026-09-25' }),
    footprint: () => count(Exam, { name: 'Mid Term' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'create_exam_subject', role: 'ADMIN',
    setup: async (w) => ({ exam: await w.exam(), offering: await w.offering() }),
    args: (_s, c) => ({ examId: idOf(c.exam), subjectOfferingId: idOf(c.offering), maxMarks: 50 }),
    footprint: () => count(ExamSubject),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'enter_marks', role: 'TEACHER',
    setup: async (w) => ({ examSubject: await w.examSubject() }),
    args: (s, c) => ({ examSubjectId: idOf(c.examSubject), entries: [{ enrollmentId: idOf(s.rahul.enrollment), marks: 42 }] }),
    footprint: (s, c) => read(() => Mark.findOne({ examSubjectId: c.examSubject._id, enrollmentId: s.rahul.enrollment._id }).lean()).then((m) => (m ? `${m.marks}:${m.status}` : null)),
    changed: (b, a) => { expect([b, a]).toEqual([null, '42:DRAFT']); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN', 'NOT_FOUND'] } },
  { tool: 'publish_marks', role: 'TEACHER',
    setup: async (w) => ({ examSubject: await w.examSubject(), mark: await w.draftMark() }),
    args: (_s, c) => ({ examSubjectId: idOf(c.examSubject) }),
    footprint: (_s, c) => field(Mark, c.mark._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['DRAFT', 'PUBLISHED']); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN', 'NOT_FOUND'] } },
  { tool: 'create_assignment', role: 'TEACHER',
    setup: async (w) => ({ offering: await w.offering() }),
    args: (_s, c) => ({ subjectOfferingId: idOf(c.offering), title: 'Algebra practice', dueAt: ymd(days(10)) }),
    footprint: () => count(Assignment, { title: 'Algebra practice' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN'] } },
  { tool: 'generate_homework', role: 'TEACHER',
    setup: async (w) => ({ offering: await w.offering() }),
    args: () => ({ topic: 'Fractions', dueAt: ymd(days(10)), subject: 'Mathematics' }),
    footprint: () => count(Assignment, { title: 'Fractions' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND'] } },
  { tool: 'grade_submission', role: 'TEACHER',
    setup: async (w) => ({ assignment: await w.assignment(), submission: await w.submission() }),
    args: (s, c) => ({ assignmentId: idOf(c.assignment), enrollmentId: idOf(s.priya.enrollment), marks: 8, feedback: 'Good work' }),
    footprint: (_s, c) => read(() => Submission.findById(c.submission._id).lean()).then((x) => `${x.status}:${x.marks ?? null}`),
    changed: (b, a) => { expect([b, a]).toEqual(['SUBMITTED:null', 'GRADED:8']); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN'] } },
  { tool: 'submit_assignment', role: 'STUDENT',
    setup: async (w) => ({ assignment: await w.assignment() }),
    args: (_s, c) => ({ assignmentId: idOf(c.assignment), attachments: [{ fileUrl: 'https://example.org/work.pdf', name: 'work.pdf' }] }),
    footprint: (s, c) => read(() => Submission.findOne({ assignmentId: c.assignment._id, enrollmentId: s.priya.enrollment._id }).lean()).then((x) => x?.status ?? null),
    changed: (b, a) => { expect(b).toBeNull(); expect(['SUBMITTED', 'LATE']).toContain(a); } },

  /* Admissions */
  { tool: 'create_admission_lead', role: 'ADMIN', tenant: false,
    args: () => ({ childName: 'Meera Nair', guardianName: 'Mrs Nair', phone: '+919000044444', gradeApplying: 'Class 1' }),
    footprint: () => count(Lead, { childName: 'Meera Nair' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_admission_lead', label: 'update_admission_lead — approve (ENROLLED)', role: 'ADMIN',
    setup: async (w) => ({ lead: await w.lead() }),
    args: (_s, c) => ({ leadId: idOf(c.lead), stage: 'ENROLLED' }),
    footprint: async (_s, c) => `${await field(Lead, c.lead._id, 'stage')}:${await count(LeadInteraction, { leadId: c.lead._id })}`,
    changed: (b, a) => { expect([b, a]).toEqual(['NEW:0', 'ENROLLED:1']); } },
  { tool: 'update_admission_lead', label: 'update_admission_lead — reject (LOST)', role: 'ADMIN', battery: false,
    setup: async (w) => ({ lead: await w.lead() }),
    args: (_s, c) => ({ leadId: idOf(c.lead), stage: 'LOST', notes: 'Chose another school' }),
    footprint: (_s, c) => field(Lead, c.lead._id, 'stage'),
    changed: (b, a) => { expect([b, a]).toEqual(['NEW', 'LOST']); } },

  /* Communication */
  { tool: 'create_announcement', role: 'ADMIN', tenant: false,
    args: () => ({ title: 'PTM on Saturday', content: 'Parents are invited to meet class teachers.' }),
    footprint: () => count(Announcement, { title: 'PTM on Saturday' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_announcement', role: 'ADMIN',
    setup: async (w) => ({ announcement: await w.announcement() }),
    args: (_s, c) => ({ announcementId: idOf(c.announcement), content: 'Submit the books by Friday.' }),
    footprint: (_s, c) => field(Announcement, c.announcement._id, 'content'),
    changed: (b, a) => { expect([b, a]).toEqual(['Return the library books.', 'Submit the books by Friday.']); },
    // Permission held, record not theirs: a teacher may publish to their own
    // classes but may not rewrite the office's notice.
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['FORBIDDEN', 'NOT_FOUND'] } },
  { tool: 'create_calendar_event', role: 'ADMIN', tenant: false,
    args: () => ({ title: 'Annual Day', startsAt: '2026-12-20', endsAt: '2026-12-20', type: 'EVENT' }),
    footprint: () => count(CalendarEvent, { title: 'Annual Day' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['FORBIDDEN_SCOPE'] } },
  { tool: 'notify_users', role: 'ADMIN',
    args: (s) => ({ recipientProfileIds: [s.people.PARENT.actor.profileId], title: 'Fee reminder', body: 'Term 1 fees are due.' }),
    footprint: (s) => count(Notification, { recipientProfileId: s.people.PARENT.profile._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['FORBIDDEN_SCOPE'] } },
  { tool: 'send_whatsapp_message', role: 'ADMIN', tenant: false,
    setup: async () => { liveWhatsapp(); return {}; },
    args: (s) => ({ to: s.people.PARENT.phone, text: 'The bus is late today.' }),
    footprint: () => Promise.resolve(toMeta.length),
    changed: (b, a, s) => {
      expect([b, a]).toEqual([0, 1]);
      expect(toMeta[0].body.to).toBe(s.people.PARENT.phone.replace('+', ''));
      expect(toMeta[0].body.text.body).toBe('The bus is late today.');
    },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['FORBIDDEN_SCOPE'] } },

  /* Library */
  { tool: 'create_book', role: 'LIBRARIAN', tenant: false,
    args: () => ({ title: 'The Discovery of India', author: 'Jawaharlal Nehru', totalCopies: 2 }),
    footprint: () => count(Book, { title: 'The Discovery of India' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_book', role: 'LIBRARIAN',
    setup: async (w) => ({ book: await w.book() }),
    args: (_s, c) => ({ bookId: idOf(c.book), totalCopies: 5 }),
    footprint: (_s, c) => field(Book, idOf(c.book), 'totalCopies'),
    changed: (b, a) => { expect([b, a]).toEqual([2, 5]); } },
  { tool: 'delete_book', role: 'LIBRARIAN',
    setup: async (w) => ({ book: await w.book() }),
    args: (_s, c) => ({ bookId: idOf(c.book) }),
    footprint: (_s, c) => field(Book, idOf(c.book), 'deletedAt').then(Boolean),
    changed: (b, a) => { expect([b, a]).toEqual([false, true]); } },
  { tool: 'issue_book', role: 'LIBRARIAN',
    setup: async (w) => ({ book: await w.book() }),
    args: (_s, c) => ({ bookId: idOf(c.book), admissionNo: 'OAK-1', dueAt: ymd(days(14)) }),
    footprint: async (_s, c) => `${await count(BookIssue, { bookId: idOf(c.book) })}:${await field(Book, idOf(c.book), 'availableCopies')}`,
    changed: (b, a) => { expect([b, a]).toEqual(['0:2', '1:1']); } },
  { tool: 'return_book', role: 'LIBRARIAN',
    setup: async (w) => ({ issue: await w.issue(), book: await w.book() }),
    args: (_s, c) => ({ issueId: idOf(c.issue) }),
    footprint: async (_s, c) => `${await field(BookIssue, idOf(c.issue), 'status')}:${await field(Book, idOf(c.book), 'availableCopies')}`,
    changed: (b, a) => { expect([b, a]).toEqual(['ACTIVE:1', 'RETURNED:2']); } },

  { tool: 'request_book', role: 'STUDENT',
    setup: async (w) => ({ book: await w.book() }),
    args: (_s, c) => ({ bookId: idOf(c.book) }),
    footprint: (_s, c) => count(BookRequest, { bookId: idOf(c.book) }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'decide_book_request', role: 'LIBRARIAN',
    setup: async (w) => ({ request: await w.bookRequest(), book: await w.book() }),
    args: (_s, c) => ({ requestId: idOf(c.request), status: 'APPROVED' }),
    // Approving is what issues the book, so the footprint is both the decision
    // and the copy leaving the shelf.
    footprint: async (_s, c) => `${await field(BookRequest, idOf(c.request), 'status')}:${await field(Book, idOf(c.book), 'availableCopies')}`,
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING:2', 'APPROVED:1']); } },

  /* Hostel */
  { tool: 'create_hostel_room', role: 'WARDEN', tenant: false,
    args: () => ({ roomNo: 'B-201', capacity: 3 }),
    footprint: () => count(HostelRoom, { roomNo: 'B-201' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_hostel_room', role: 'WARDEN',
    setup: async (w) => ({ room: await w.room() }),
    args: (_s, c) => ({ roomId: idOf(c.room), status: 'MAINTENANCE' }),
    footprint: (_s, c) => field(HostelRoom, c.room._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['ACTIVE', 'MAINTENANCE']); } },
  { tool: 'create_hostel_inquiry', role: 'WARDEN', tenant: false,
    args: (s) => ({ subject: 'Leaking tap in B-201', studentId: idOf(s.aman.student) }),
    footprint: () => count(HostelInquiry, { subject: 'Leaking tap in B-201' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_hostel_inquiry', role: 'WARDEN',
    setup: async (w) => ({ inquiry: await w.inquiry() }),
    args: (_s, c) => ({ inquiryId: idOf(c.inquiry), status: 'RESOLVED' }),
    footprint: (_s, c) => field(HostelInquiry, c.inquiry._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['OPEN', 'RESOLVED']); } },
  { tool: 'allocate_hostel_bed', role: 'WARDEN',
    setup: async (w) => ({ room: await w.room() }),
    args: (_s, c) => ({ roomId: idOf(c.room), admissionNo: 'OAK-3' }),
    footprint: (s) => count(HostelAllocation, { studentId: s.aman.student._id, status: 'ACTIVE' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'vacate_hostel_bed', role: 'WARDEN',
    setup: async (w) => ({ allocation: await w.allocation() }),
    args: (_s, c) => ({ allocationId: idOf(c.allocation) }),
    footprint: (_s, c) => field(HostelAllocation, c.allocation._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['ACTIVE', 'VACATED']); } },

  /* Transport */
  { tool: 'create_transport_route', role: 'ADMIN', tenant: false,
    args: () => ({ name: 'Route 9', vehicleNo: 'MH12CD5678' }),
    footprint: () => count(TransportRoute, { name: 'Route 9' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'update_transport_route', role: 'ADMIN',
    setup: async (w) => ({ route: await w.route() }),
    args: (_s, c) => ({ routeId: idOf(c.route), fareAmountPaise: 1500000 }),
    footprint: (_s, c) => field(TransportRoute, idOf(c.route), 'fareAmountPaise').then((v) => v ?? 0),
    // w.route() creates 'Route 7' with no fare, so it starts at the default.
    changed: (b, a) => { expect([b, a]).toEqual([0, 1500000]); } },
  { tool: 'create_transport_stop', role: 'ADMIN',
    setup: async (w) => ({ route: await w.route() }),
    args: (_s, c) => ({ routeId: idOf(c.route), name: 'Temple', sequenceNo: 2 }),
    footprint: (_s, c) => count(TransportStop, { routeId: c.route._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'enroll_in_transport', role: 'ADMIN',
    setup: async (w) => ({ route: await w.route(), stop: await w.stop() }),
    args: (_s, c) => ({ admissionNo: 'OAK-1', routeId: idOf(c.route), stopId: idOf(c.stop) }),
    footprint: (s) => count(BusEnrollment, { studentId: s.rahul.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },

  { tool: 'cancel_profile_edit_request', role: 'STUDENT',
    setup: async (w) => ({ request: await w.profileEdit() }),
    args: (_s, c) => ({ requestId: idOf(c.request) }),
    footprint: (_s, c) => field(ProfileEditRequest, idOf(c.request), 'status').then((v) => v ?? '(gone)'),
    // withdraw() deletes the row, so the footprint goes from PENDING to gone.
    changed: (b, a) => { expect(b).toBe('PENDING'); expect(a).toBe('(gone)'); } },
  { tool: 'cancel_book_request', role: 'STUDENT',
    setup: async (w) => ({ request: await w.bookRequest() }),
    args: (_s, c) => ({ requestId: idOf(c.request) }),
    footprint: (_s, c) => field(BookRequest, idOf(c.request), 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'CANCELLED']); } },
  { tool: 'cancel_transport_request', role: 'STUDENT',
    setup: async (w) => ({ request: await w.transportRequest() }),
    args: (_s, c) => ({ requestId: idOf(c.request) }),
    footprint: (_s, c) => field(TransportRequest, idOf(c.request), 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'CANCELLED']); } },
  { tool: 'request_transport_route', role: 'STUDENT',
    setup: async (w) => ({ route: await w.route(), stop: await w.stop() }),
    args: (_s, c) => ({ routeId: idOf(c.route), stopId: idOf(c.stop) }),
    footprint: (s) => count(TransportRequest, { studentId: s.priya.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'decide_transport_request', role: 'ADMIN',
    setup: async (w) => ({ request: await w.transportRequest() }),
    args: (_s, c) => ({ requestId: idOf(c.request), status: 'APPROVED' }),
    // Approving grants the place as well as recording the decision.
    footprint: async (_s, c) => `${await field(TransportRequest, idOf(c.request), 'status')}:${await count(BusEnrollment)}`,
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING:0', 'APPROVED:1']); } },

  /* Documents */
  { tool: 'delete_document', role: 'ADMIN',
    setup: async (w) => ({ doc: await w.document() }),
    args: (_s, c) => ({ documentId: idOf(c.doc) }),
    footprint: (_s, c) => count(Document, { _id: c.doc._id }),
    changed: (b, a) => { expect([b, a]).toEqual([1, 0]); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['FORBIDDEN'] } },

  // Created by the teacher into a section they are class teacher of. A
  // Riverside administrator naming Oakridge's section is now refused outright:
  // document.service checks that the section belongs to the acting school, so
  // this no longer has to tolerate a no-op in the other school.
  { tool: 'create_course_material', role: 'TEACHER',
    args: (s) => ({ title: 'Chapter 3 notes', fileUrl: '/uploads/ch3.pdf', sectionId: idOf(s.sectionA) }),
    footprint: () => count(Document, { title: 'Chapter 3 notes' }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); },
    // Holds materials.manage at OWN but teaches nothing, so not this section.
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN'] } },
  { tool: 'update_course_material', role: 'TEACHER',
    setup: async (_w, s) => ({ doc: await oak(() => Document.create({
      title: 'Chapter 2 notes', type: 'CUSTOM', fileUrl: '/uploads/ch2.pdf',
      authorProfileId: s.people.TEACHER.profile._id, sectionId: s.sectionA._id,
    })) }),
    args: (_s, c) => ({ documentId: idOf(c.doc), title: 'Chapter 2 notes (revised)' }),
    footprint: (_s, c) => field(Document, c.doc._id, 'title'),
    changed: (b, a) => { expect([b, a]).toEqual(['Chapter 2 notes', 'Chapter 2 notes (revised)']); },
    // Another teacher did not write it, and authorship is the rule.
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN'] } },

  /* Leave, registrations, student requests */
  { tool: 'apply_for_leave', role: 'STUDENT', tenant: false,
    args: () => ({ fromDate: ymd(days(15)), toDate: ymd(days(16)), reason: 'Family function' }),
    footprint: (s) => count(LeaveApplication, { enrollmentId: s.priya.enrollment._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'review_leave', role: 'TEACHER',
    setup: async (w) => ({ leave: await w.leave() }),
    args: (_s, c) => ({ leaveId: idOf(c.leave), status: 'APPROVED' }),
    footprint: (_s, c) => field(LeaveApplication, c.leave._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'APPROVED']); },
    wrongScope: {
      actor: (s) => s.people.TEACHER.actor,
      args: (_s, c) => ({ leaveId: idOf(c.otherLeave), status: 'APPROVED' }),
      setup: async (w, s) => ({ otherLeave: await w.leave(s.riya) }),
      codes: ['FORBIDDEN'],
    } },
  { tool: 'register_for_elective', role: 'STUDENT',
    setup: async (w) => ({ offering: await w.elective() }),
    args: (_s, c) => ({ subjectOfferingId: idOf(c.offering) }),
    footprint: (_s, c) => count(SubjectRegistration, { subjectOfferingId: c.offering._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'withdraw_elective_registration', role: 'STUDENT',
    setup: async (w) => ({ registration: await w.registration() }),
    args: (_s, c) => ({ registrationId: idOf(c.registration) }),
    footprint: (_s, c) => field(SubjectRegistration, idOf(c.registration), 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'WITHDRAWN']); } },
  { tool: 'decide_registration', role: 'TEACHER',
    setup: async (w) => ({ registration: await w.registration() }),
    args: (_s, c) => ({ registrationId: idOf(c.registration), status: 'APPROVED' }),
    footprint: (_s, c) => field(SubjectRegistration, idOf(c.registration), 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'APPROVED']); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN'] } },
  { tool: 'request_cocurricular', role: 'STUDENT', tenant: false,
    args: () => ({ name: 'Inter-school quiz', activityDate: '2026-08-15', category: 'LITERARY' }),
    footprint: (s) => count(CoCurricularActivity, { studentId: s.priya.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'cancel_cocurricular_request', role: 'STUDENT',
    setup: async (w) => ({ request: await w.cocurricular() }),
    args: (_s, c) => ({ requestId: idOf(c.request) }),
    footprint: (s) => count(CoCurricularActivity, { studentId: s.priya.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([1, 0]); } },
  { tool: 'decide_cocurricular', role: 'TEACHER',
    setup: async (w) => ({ request: await w.cocurricular() }),
    args: (_s, c) => ({ requestId: idOf(c.request), status: 'APPROVED' }),
    footprint: (_s, c) => field(CoCurricularActivity, idOf(c.request), 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['PENDING', 'APPROVED']); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN', 'NOT_FOUND'] } },
  { tool: 'request_profile_edit', role: 'STUDENT', tenant: false,
    args: () => ({ changes: { address: '14 New Colony' }, note: 'We moved' }),
    footprint: (s) => count(ProfileEditRequest, { studentId: s.priya.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'decide_profile_edit', role: 'TEACHER',
    setup: async (w) => ({ request: await w.profileEdit() }),
    args: (_s, c) => ({ requestId: idOf(c.request), status: 'APPROVED' }),
    footprint: (s) => field(Student, s.priya.student._id, 'address'),
    changed: (b, a) => { expect(b ?? null).toBeNull(); expect(a).toBe('22 Lake Road'); },
    wrongScope: { actor: async (_s, w) => (await w.secondTeacher()).actor, codes: ['FORBIDDEN', 'NOT_FOUND'] } },

  /* Medical */
  { tool: 'upsert_medical_record', role: 'ADMIN',
    args: () => ({ admissionNo: 'OAK-1', bloodGroup: 'O+' }),
    footprint: (s) => read(() => MedicalRecord.findOne({ studentId: s.rahul.student._id }).lean()).then((r) => r?.bloodGroup ?? null),
    changed: (b, a) => { expect([b, a]).toEqual([null, 'O+']); },
    wrongScope: { actor: (s) => s.people.PARENT.actor, args: () => ({ admissionNo: 'OAK-3', bloodGroup: 'B-' }), codes: ['NOT_FOUND', 'FORBIDDEN'] } },
  { tool: 'remove_medical_record', role: 'ADMIN',
    setup: async (w) => ({ record: await w.medical() }),
    args: () => ({ admissionNo: 'OAK-1' }),
    footprint: (s) => count(MedicalRecord, { studentId: s.rahul.student._id }),
    changed: (b, a) => { expect([b, a]).toEqual([1, 0]); },
    wrongScope: { actor: (s) => s.people.PARENT.actor, args: () => ({ admissionNo: 'OAK-3' }), codes: ['NOT_FOUND', 'FORBIDDEN'] } },

  /* Tickets */
  { tool: 'create_ticket', role: 'PARENT', tenant: false,
    args: () => ({ subject: 'Bus timing query', routedToRoleKey: 'ADMIN' }),
    footprint: (s) => count(Ticket, { raisedByProfileId: s.people.PARENT.profile._id }),
    changed: (b, a) => { expect([b, a]).toEqual([0, 1]); } },
  { tool: 'reply_to_ticket', role: 'ADMIN',
    setup: async (w) => ({ ticket: await w.ticket() }),
    args: (_s, c) => ({ ticketId: idOf(c.ticket), body: 'We will check the timetable and revert.' }),
    footprint: async (_s, c) => `${await field(Ticket, c.ticket._id, 'status')}:${await count(TicketMessage, { ticketId: c.ticket._id })}`,
    changed: (b, a) => { expect([b, a]).toEqual(['NEW:0', 'OPEN:1']); },
    wrongScope: { actor: (s) => s.people.TEACHER.actor, codes: ['NOT_FOUND', 'FORBIDDEN'] } },
  { tool: 'update_ticket', role: 'ADMIN',
    setup: async (w) => ({ ticket: await w.ticket() }),
    args: (_s, c) => ({ ticketId: idOf(c.ticket), status: 'RESOLVED' }),
    footprint: (_s, c) => field(Ticket, c.ticket._id, 'status'),
    changed: (b, a) => { expect([b, a]).toEqual(['NEW', 'RESOLVED']); } },
];

const labelOf = (c) => c.label ?? c.tool;
const ROLE_ORDER = ['TEACHER', 'PARENT', 'STUDENT', 'LIBRARIAN', 'WARDEN', 'FINANCE', 'PRINCIPAL', 'ADMIN'];
const isHighRisk = (tool) => tool.risk === 'HIGH' || tool.risk === 'CRITICAL' || tool.operation === 'DELETE';

async function prepareCase(c, extraSetup) {
  const w = world(school);
  const ctx = { ...((await c.setup?.(w, school)) ?? {}) };
  if (extraSetup) Object.assign(ctx, await extraSetup(w, school, ctx));
  return { w, ctx };
}

/** A call and, if it was proposed, its confirmation — the whole attempt. */
async function attempt(tenant, actor, name, args) {
  const first = await mcp(tenant, actor, name, args);
  if (first?.action?.status !== 'confirmation_required') return first;
  return mcp(tenant, actor, name, {}, { confirmationToken: first.action.confirmationToken });
}

/* ── Coverage is complete ─────────────────────────────────── */

describe('the write-tool matrix', () => {
  it('has a case for every one of the 82 write tools', () => {
    const writeTools = Object.entries(MCP_TOOLS).filter(([, t]) => mutates(t)).map(([n]) => n).sort();
    expect(writeTools).toHaveLength(82);
    expect([...new Set(CASES.map((c) => c.tool))].sort()).toEqual(writeTools);
  });
});

/* ── 1. Execution through MCP ─────────────────────────────── */

describe.each(CASES.map((c) => [labelOf(c), c]))('%s', (_label, c) => {
  const tool = MCP_TOOLS[c.tool];

  it('executes through MCP: confirmation where required, the database changes, the audit records it', async () => {
    const { ctx } = await prepareCase(c);
    const actor = school.people[c.role].actor;
    const args = c.args(school, ctx);
    const before = await c.footprint(school, ctx);

    const first = await mcp(OAK, actor, c.tool, args);
    let done = first;
    const confirm = requiresConfirmation(tool, args);
    if (confirm) {
      expect(first.action?.status, JSON.stringify(first.error)).toBe('confirmation_required');
      expect(await c.footprint(school, ctx)).toEqual(before);
      expect(await executedIn(OAK, c.tool)).toBe(0);
      done = await mcp(OAK, actor, c.tool, {}, { confirmationToken: first.action.confirmationToken });
    }
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    const after = await c.footprint(school, ctx);
    c.changed(before, after, school, ctx);

    const audit = await oak(() => AuditLog.findOne({ action: `agent.${c.tool}`, 'after.status': 'EXECUTED', 'after.via': 'MCP' }).lean());
    expect(audit, 'no EXECUTED audit entry').not.toBeNull();
    expect(String(audit.actorProfileId)).toBe(actor.profileId);
    expect(audit.after.confirmed).toBe(confirm);
    record(labelOf(c), 'executed', true);
    record(labelOf(c), 'confirmation', confirm);
    record(labelOf(c), 'role', c.role);
  });

  it('is refused to a role without the permission, and nothing is written', async () => {
    const outsider = ROLE_ORDER.find((r) => !school.people[r].actor.permissions[tool.permission]);
    expect(outsider, `every seeded role holds ${tool.permission}`).toBeTruthy();
    const { ctx } = await prepareCase(c);
    const before = await c.footprint(school, ctx);
    const res = await mcp(OAK, school.people[outsider].actor, c.tool, c.args(school, ctx));
    expect(res.error?.code).toBe('FORBIDDEN');
    expect(await oak(() => AgentAction.countDocuments())).toBe(0);
    expect(await ranIn(OAK, c.tool)).toEqual([]);
    expect(await c.footprint(school, ctx)).toEqual(before);
    record(labelOf(c), 'outsider', outsider);
  });

  if (c.wrongScope) {
    it('is refused to a holder of the permission acting outside their scope, and nothing is written', async () => {
      const { w, ctx } = await prepareCase(c, c.wrongScope.setup);
      const actor = await c.wrongScope.actor(school, w);
      const args = (c.wrongScope.args ?? c.args)(school, ctx);
      const before = await c.footprint(school, ctx);
      const res = await attempt(OAK, actor, c.tool, args);
      expect(res.success, `ran for an actor outside scope: ${JSON.stringify(res)}`).toBe(false);
      expect(c.wrongScope.codes, `${res.error?.code}: ${res.error?.message}`).toContain(res.error?.code);
      expect(await executedIn(OAK, c.tool)).toBe(0);
      expect(await c.footprint(school, ctx)).toEqual(before);
      record(labelOf(c), 'wrongScope', res.error?.code);
    });
  }

  if (c.tenant !== false) {
    it("is refused to another school's administrator naming this school's records, and nothing is written here", async () => {
      const { ctx } = await prepareCase(c);
      const before = await c.footprint(school, ctx);
      const res = await attempt(RIVER, school.people.RIVER_ADMIN.actor, c.tool, c.args(school, ctx));
      if (!c.tenantEmptyOk) {
        expect(res.success, `ran across schools: ${JSON.stringify(res)}`).toBe(false);
        expect(await executedIn(RIVER, c.tool)).toBe(0);
      }
      expect(await executedIn(OAK, c.tool)).toBe(0);
      expect(await c.footprint(school, ctx)).toEqual(before);
      record(labelOf(c), 'wrongTenant', res.success ? 'no-op in own school' : res.error?.code);
    });
  }
});

/* ── 2. Confirmation cannot be bypassed ───────────────────── */

const BATTERY = CASES.filter((c) => c.battery !== false && isHighRisk(MCP_TOOLS[c.tool]));

describe.each(BATTERY.map((c) => [labelOf(c), c]))('%s — confirmation cannot be bypassed', (_label, c) => {
  it('refuses every unsafe confirmation, then runs exactly once for the right person', async () => {
    const tool = MCP_TOOLS[c.tool];
    const { ctx } = await prepareCase(c);
    const actor = school.people[c.role].actor;
    const args = c.args(school, ctx);
    const before = await c.footprint(school, ctx);
    const propose = async () => {
      const p = await mcp(OAK, actor, c.tool, args);
      expect(p.action?.status, JSON.stringify(p.error)).toBe('confirmation_required');
      return p.action;
    };
    const nothingRan = async (why) => {
      expect(await ranIn(OAK, c.tool), why).toEqual([]);
      expect(await c.footprint(school, ctx), why).toEqual(before);
    };
    const refused = (res, why) => expect(res.success, `${why}: ${JSON.stringify(res)}`).toBe(false);

    // No confirmation: the direct call only proposes.
    const p1 = await propose();
    await nothingRan('direct call');

    // Wrong confirmation: a token that was never issued.
    refused(await mcp(OAK, actor, c.tool, {}, { confirmationToken: crypto.randomBytes(24).toString('hex') }), 'bogus token');
    await nothingRan('bogus token');

    // Wrong confirmation: this token presented against a different tool.
    const other = mcpToolsFor(actor).map((t) => t.name).find((n) => n !== c.tool && mutates(MCP_TOOLS[n]));
    refused(await mcp(OAK, actor, other, {}, { confirmationToken: p1.confirmationToken }), 'token for another tool');
    await nothingRan('token for another tool');

    // Expired.
    await oak(() => AgentAction.updateOne({ _id: p1.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    refused(await mcp(OAK, actor, c.tool, {}, { confirmationToken: p1.confirmationToken }), 'expired token');
    await nothingRan('expired token');

    // Another user: a second holder of the same role presents it.
    const p2 = await propose();
    const colleague = await seedPerson({ roleKey: c.role, roleId: school.roleIds[c.role], displayName: `Second ${c.role}` });
    refused(await mcp(OAK, colleague.actor, c.tool, {}, { confirmationToken: p2.confirmationToken }), "another user's token");
    await nothingRan("another user's token");

    // Another school: presented from a Riverside session.
    refused(await mcp(RIVER, school.people.RIVER_ADMIN.actor, c.tool, {}, { confirmationToken: p2.confirmationToken }), 'another school');
    await nothingRan('another school');

    // Permission removed before the yes: the same person, whose live
    // permission map no longer carries the grant.
    const { [tool.permission]: _removed, ...rest } = actor.permissions;
    refused(await mcp(OAK, { ...actor, permissions: rest }, c.tool, {}, { confirmationToken: p2.confirmationToken }), 'permission removed');
    await nothingRan('permission removed');

    // Simultaneous confirmations by the right person: exactly one runs.
    const [a, b] = await Promise.all([
      mcp(OAK, actor, c.tool, {}, { confirmationToken: p2.confirmationToken }),
      mcp(OAK, actor, c.tool, {}, { confirmationToken: p2.confirmationToken }),
    ]);
    expect([a.success, b.success].filter(Boolean), JSON.stringify([a.error, b.error])).toHaveLength(1);
    expect(await executedIn(OAK, c.tool)).toBe(1);
    c.changed(before, await c.footprint(school, ctx), school, ctx);

    // Reused: the spent token does nothing more.
    const afterOnce = await c.footprint(school, ctx);
    refused(await mcp(OAK, actor, c.tool, {}, { confirmationToken: p2.confirmationToken }), 'reused token');
    expect(await executedIn(OAK, c.tool)).toBe(1);
    expect(await c.footprint(school, ctx)).toEqual(afterOnce);
    record(labelOf(c), 'battery', true);
  });
});
