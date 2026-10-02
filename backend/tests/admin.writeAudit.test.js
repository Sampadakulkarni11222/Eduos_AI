import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Grade, Section, Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Student, Enrollment, StudentGuardian } from '../src/models/student.model.js';
import { Exam, ExamSubject } from '../src/models/exam.model.js';
import { FeeHead, FeeStructure, FeePlan, Payment, PaymentChangeRequest } from '../src/models/fee.model.js';
import { Lead } from '../src/models/lead.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { HostelRoom, HostelInquiry } from '../src/models/hostel.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../src/models/transport.model.js';
import { Book } from '../src/models/library.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import { Notification } from '../src/models/notification.model.js';
import { MedicalRecord } from '../src/models/medicalRecord.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as fees from '../src/modules/fees/fee.service.js';
import * as library from '../src/modules/library/library.service.js';
import * as transport from '../src/modules/transport/transport.service.js';
import { isLlmEnabled } from '../src/providers/ai.provider.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent, parsePlan } from '../src/modules/ai/agent/intent.js';
import { capabilityIndex } from '../src/modules/ai/mcp/capabilities.js';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, seedPerson, inSchool, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * Admin writes, through the real Ask AI route, with no model configured.
 *
 * A routing audit sent 102 Admin requests through the chatbot's no-model path;
 * 57 reached the right capability. Every one of the 172 Admin tools worked when
 * called directly (mcp.writes.coverage) -- what failed was reaching them from a
 * sentence. The failures fell into a few shapes, each fixed in shared code:
 *
 *   ids          most structure, fee and facility writes required an ObjectId
 *                nobody types (a year, a grade, a payment, a plan, a stop), so
 *                the resolver never offered them. They now take the record by
 *                NAME, resolved before the confirmation (mcp/tools/_names.js).
 *   corrections  "change X's field to Y" had no reader; a field, whose it is and
 *                its new value are now read by grammar (utils/fieldChange.js)
 *                and matched to the capability's own schema.
 *   acts         an ACTION that CREATES (record a payment, allocate a bed,
 *                request a route) stood in for a correction; approving is not
 *                recording; a quantity is not a pupil; "Route 9" is a name.
 *   refusals     "delete all students" became "which student?" -- a mass
 *                deletion read as the first step of a single one.
 *
 * Every assertion is on a property: which capability, what it was told, that
 * nothing is written before "yes", what is written after, and that a refusal
 * runs nothing.
 */

let api;
let school;
let world;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

/**
 * One school's structure, fees and facilities, the way an admin meets them:
 * a second teacher, a parent "Mr Sharma", Term 1 with Mathematics and an Art
 * offering in Class 6 A, a Class 8 grade with no sections, the exams "Half
 * Yearly" and "Unit Test 2", a payment awaiting approval on INV-1001 and a
 * published one on INV-1002 with a change requested, two of Aman's fee plans
 * (one awaiting approval, one approved), an enquiry, a ticket, a room and its
 * enquiry, Route 7 with its Market stop, a book, and a pupil not yet enrolled.
 */
async function seedAdminWorld() {
  const otherTeacher = await seedPerson({ roleKey: 'TEACHER', roleId: school.roleIds.TEACHER, displayName: 'Other teacher' });
  const mrSharma = await seedPerson({ roleKey: 'PARENT', roleId: school.roleIds.PARENT, displayName: 'Mr Sharma' });
  return inSchool(OAK, async () => {
    const teacher = school.people.TEACHER.profile._id;
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31') });
    const maths = await Subject.create({ name: 'Mathematics' });
    await Subject.create({ name: 'Science' });
    const art = await Subject.create({ name: 'Art' });
    const mathsA = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: maths._id, termId: term._id, teacherId: teacher });
    const artA = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: art._id, termId: term._id, teacherId: teacher });
    const class8 = await Grade.create({ name: 'Class 8', level: 8 });
    const halfYearly = await Exam.create({ termId: term._id, name: 'Half Yearly', startsOn: new Date('2026-12-01'), endsOn: new Date('2026-12-10') });
    const unitTest = await Exam.create({ termId: term._id, name: 'Unit Test 2', startsOn: new Date('2026-11-01'), endsOn: new Date('2026-11-05') });
    await ExamSubject.create({ examId: unitTest._id, subjectOfferingId: mathsA._id, maxMarks: 50 });

    const pending = (await fees.recordPayment(school.people.FINANCE.actor, 'ALL', { invoiceId: school.inv1._id, amountPaise: 100000, mode: 'CASH' })).payment;
    const published = (await fees.recordPayment(school.people.ADMIN.actor, 'ALL', { invoiceId: school.inv2._id, amountPaise: 200000, mode: 'CASH' })).payment;
    const change = await fees.createPaymentChangeRequest(school.people.FINANCE.actor, {
      paymentId: published._id, field: 'notes', requestedValue: 'Paid in person', reason: 'Receipt note was missing',
    });
    await FeeHead.create({ name: 'Lab Fee' });
    const plan = (status, name) => FeePlan.create({
      enrollmentId: school.aman.enrollment._id, studentId: school.aman.student._id, academicYearId: school.year._id,
      name, totalPaise: 500000, mode: 'INSTALLMENT', status,
      installments: [
        { seq: 1, amountPaise: 250000, dueOn: new Date(Date.now() + 30 * 864e5) },
        { seq: 2, amountPaise: 250000, dueOn: new Date(Date.now() + 60 * 864e5) },
      ],
    });
    const waitingPlan = await plan('PENDING_ADMIN_APPROVAL', 'Aman — term plan');
    const approvedPlan = await plan('APPROVED', 'Aman — transport plan');

    const lead = await Lead.create({ childName: 'Kabir Kapoor', guardianName: 'Mr Kapoor', phone: '+919000033333' });
    const ticket = await Ticket.create({ subject: 'Bus timing', raisedByProfileId: school.people.PARENT.profile._id });
    const room = await HostelRoom.create({ roomNo: 'A-101', capacity: 2 });
    const inquiry = await HostelInquiry.create({ subject: 'Fan not working', raisedByProfileId: school.people.PARENT.profile._id });
    const route = await transport.createRoute({ name: 'Route 7', driverName: 'Mahesh' });
    const stop = await transport.createStop({ routeId: route._id, name: 'Market', sequenceNo: 1 });
    const book = await library.createBook({ title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', totalCopies: 2 }, school.people.LIBRARIAN.actor);
    const kabir = await Student.create({ admissionNo: 'OAK-50', firstName: 'Kabir', lastName: 'Mehta' });

    return {
      otherTeacher, mrSharma, term, mathsA, artA, class8, halfYearly, pending, published, change,
      waitingPlan, approvedPlan, lead, ticket, room, inquiry, route, stop, book, kabir,
    };
  });
}

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
  world = await seedAdminWorld();
});

const admin = () => school.people.ADMIN;
const actor = () => actorForRole('ADMIN');
const index = () => Object.fromEntries(capabilityIndex().map((c) => [c.name, c]));
const count = (Model, filter = {}) => inSchool(OAK, () => Model.countDocuments(filter));
const one = (Model, filter) => inSchool(OAK, () => Model.findOne(filter).lean());
const byId = (Model, id) => inSchool(OAK, () => Model.findById(id).lean());
// The single step and the plan the HTTP route runs must read a sentence alike:
// a grammar rule honoured by one and dropped by the other reached the chat as
// "I'm not sure what you need".
const routed = (message) => {
  const step = parseIntent(message, actor());
  expect(parsePlan(message, actor()).map((s) => s.tool), message).toEqual(step ? [step.tool] : []);
  return step;
};
const auditOf = (tool, status) => inSchool(OAK, () => AuditLog.findOne({ action: `agent.${tool}`, 'after.status': status }).lean());

/* ── 0. The path under test ───────────────────────────────── */

describe('0. the no-model fallback path', () => {
  it('no model is configured, so every reading below is the deterministic resolver', () => {
    expect(isLlmEnabled()).toBe(false);
  });

  it('Admin is offered 172 capabilities, 88 of them writes', () => {
    const offered = mcpToolsFor(actorForRole('ADMIN')).map((t) => t.name);
    const writes = offered.filter((n) => index()[n].operation !== 'GET');
    expect(offered).toHaveLength(172);
    expect(writes).toHaveLength(88);
  });
});

/* ── 1. The 13 requests that reached the wrong tool ──────── */

describe('1. requests that reached the wrong capability now reach the right one', () => {
  const WRONG_BEFORE = [
    ['Create grade Class 7 at level 7.', 'create_grade', { name: 'Class 7', level: 7 }, 'enter_marks'],
    ['Add a Mathematics paper for Class 6-A to Half Yearly with 80 marks.', 'create_exam_subject',
      { subject: 'Mathematics', className: 'Class 6-A', exam: 'Half Yearly', maxMarks: 80 }, 'enter_marks'],
    ['Approve the pending payment for INV-1001.', 'approve_payment', { invoiceNo: 'INV-1001' }, 'record_payment'],
    ['Change the capacity of room A-101 to 4.', 'update_hostel_room', { roomNo: 'A-101', capacity: 4 }, 'allocate_hostel_bed'],
    ['Add a stop Market to Route 7 at sequence 2.', 'create_transport_stop', { name: 'Market', routeName: '7', sequenceNo: 2 }, 'request_transport_route'],
    ['Enroll Rahul Sharma on Route 7 at the Market stop.', 'enroll_in_transport',
      { studentName: 'Rahul Sharma', routeName: '7', stopName: 'Market' }, 'request_transport_route'],
    ["Move Kabir Kapoor's admission lead to the tour scheduled stage.", 'update_admission_lead',
      { childName: 'Kabir Kapoor', stage: 'TOUR_SCHEDULED' }, 'get_admissions'],
    ["Mark Aman Gupta's enrollment as transferred.", 'update_enrollment_status',
      { studentName: 'Aman Gupta', status: 'TRANSFERRED' }, 'update_student'],
    ['Schedule Mathematics for Class 6-A on Monday period 2 from 10:00 to 10:45.', 'upsert_timetable_slot',
      { className: 'Class 6-A', day: 'monday', periodNo: 2, startTime: '10:00', endTime: '10:45', subject: 'Mathematics' }, null],
    ["Set Rahul Sharma's blood group to O+.", 'upsert_medical_record', { studentName: 'Rahul Sharma', bloodGroup: 'O+' }, null],
  ];

  for (const [message, tool, args, wrong] of WRONG_BEFORE) {
    it(`"${message}" → ${tool}${wrong ? ` (was ${wrong})` : ' (was refused)'}`, () => {
      const step = routed(message);
      expect(step?.tool).toBe(tool);
      expect(step.args).toMatchObject(args);
    });
  }

  // Realistic variations of the same intent.
  const VARIATIONS = [
    ['Add a new grade Class 9 with level 9.', 'create_grade'],
    ['Put Science in period 3 for Class 6-A on Tuesday from 11:00 to 11:45.', 'upsert_timetable_slot'],
    ['Timetable Mathematics for Class 6-A on Friday period 1 from 09:00 to 09:45.', 'upsert_timetable_slot'],
    ["Update Rahul Sharma's blood group to B+.", 'upsert_medical_record'],
    ['Reject the pending payment for INV-1001 because the cheque bounced.', 'reject_payment'],
    ['Change the capacity of room A-101 to 3.', 'update_hostel_room'],
    ["Move Kabir Kapoor's admission lead to the application stage.", 'update_admission_lead'],
  ];
  for (const [message, tool] of VARIATIONS) {
    it(`variation: "${message}" → ${tool}`, () => {
      expect(routed(message)?.tool).toBe(tool);
    });
  }
});

/* ── 2. The 32 requests that were not understood ─────────── */

describe('2. requests that were not understood now reach an existing capability', () => {
  const UNRECOGNISED_BEFORE = [
    // Fees
    ['Create a fee structure Lab Fee 2026-27 of ₹2000 due 31 October 2026 for Class 6.', 'create_fee_structure',
      { name: 'Lab Fee', academicYear: '2026-27', grade: 'Class 6', amountPaise: 200000, dueOn: '2026-10-31' }],
    ['Create an invoice for Aman Gupta for ₹1500 lab fee due 15 October 2026.', 'create_invoice', { studentName: 'Aman Gupta', dueOn: '2026-10-15' }],
    ['Generate invoices for 2026-27.', 'generate_invoices', { academicYear: '2026-27' }],
    ['Reject the pending payment for INV-1001 because the cheque bounced.', 'reject_payment', { invoiceNo: 'INV-1001', reason: 'the cheque bounced' }],
    ['Change the receipt number of the payment for INV-1001 to R-778.', 'update_payment', { invoiceNo: 'INV-1001', receiptNo: 'R-778' }],
    ['Request a change to the notes of the payment for INV-1001.', 'request_payment_change', { invoiceNo: 'INV-1001', field: 'notes' }],
    ['Approve the payment change request.', 'decide_payment_change_request', { approve: true }],
    ['Create an installment plan for Aman Gupta of ₹5000 in 2 installments.', 'create_fee_plan', { studentName: 'Aman Gupta', mode: 'INSTALLMENT', totalPaise: 500000 }],
    ["Change Aman Gupta's fee plan to 3 installments.", 'update_fee_plan', { studentName: 'Aman Gupta' }],
    ["Publish Aman Gupta's fee plan.", 'publish_fee_plan', { studentName: 'Aman Gupta' }],
    ["Approve Aman Gupta's fee plan.", 'transition_fee_plan', { studentName: 'Aman Gupta', step: 'approve' }],
    // Academics
    ['Create Term 2 for 2026-27 from 1 October 2026 to 31 March 2027.', 'create_term',
      { name: 'Term 2', academicYear: '2026-27', startsOn: '2026-10-01', endsOn: '2027-03-31' }],
    ['Create section B in Class 7.', 'create_section', { name: 'B', grade: 'Class 7' }],
    ['Make the Other teacher the class teacher of Class 6-B.', 'update_section', { className: 'Class 6-B', classTeacher: 'Other teacher' }],
    ['Assign the Other teacher to teach Science in Class 6-A.', 'assign_teacher_to_subject',
      { teacherName: 'Other teacher', subject: 'Science', className: 'Class 6-A' }],
    ['Make Art an elective in Class 6-A with 25 seats.', 'update_subject_offering', { subject: 'Art', className: 'Class 6-A', isElective: true, capacity: 25 }],
    ['Create an exam called Half Yearly in Term 1 from 1 December 2026 to 10 December 2026.', 'create_exam',
      { name: 'Half Yearly', term: 'Term 1', startsOn: '2026-12-01', endsOn: '2026-12-10' }],
    // Students and admissions
    ['Enroll Kabir Mehta in Class 6-A.', 'enroll_student', { studentName: 'Kabir Mehta', className: 'Class 6-A' }],
    ["Change Rahul Sharma's address to 12 Park Street.", 'update_student', { studentName: 'Rahul Sharma', fields: { address: '12 Park Street' } }],
    ['Update the phone number of Priya Verma to 9812345678.', 'update_student', { studentName: 'Priya Verma' }],
    ["Add Mr Sharma as Rahul Sharma's father.", 'add_guardian', { guardianName: 'Mr Sharma', studentName: 'Rahul Sharma', relation: 'FATHER' }],
    ['Add an admission enquiry for Kabir Kapoor, guardian Mr Kapoor, phone 9000033333.', 'create_admission_lead',
      { childName: 'Kabir Kapoor', guardianName: 'Mr Kapoor', phone: '9000033333' }],
    // Calendar, notifications, tickets
    ['Schedule a calendar event for Sports Day on 10 October 2026.', 'create_calendar_event', { title: 'Sports Day', startsAt: '2026-10-10', endsAt: '2026-10-10' }],
    ['Add a holiday on 2 October 2026 for Gandhi Jayanti.', 'create_calendar_event', { title: 'Gandhi Jayanti', startsAt: '2026-10-02' }],
    ['Notify the Other teacher that the staff meeting is at 3pm.', 'notify_users', { recipient: 'Other teacher', body: 'the staff meeting is at 3pm' }],
    ['Close the Bus timing ticket.', 'update_ticket', { subject: 'Bus timing', status: 'CLOSED' }],
    ['Mark the Bus timing ticket as resolved.', 'update_ticket', { subject: 'Bus timing', status: 'RESOLVED' }],
    ['Raise a ticket about the broken projector in Class 6-A.', 'create_ticket', { subject: 'the broken projector' }],
    // Library, hostel, transport
    ['Update Wings of Fire to 5 copies.', 'update_book', { title: 'Wings of Fire', totalCopies: 5 }],
    ['Mark the Fan not working hostel inquiry as resolved.', 'update_hostel_inquiry', { subject: 'Fan not working', status: 'RESOLVED' }],
    ['Create transport route Route 9 with driver Ramesh.', 'create_transport_route', { name: 'Route 9', driverName: 'Ramesh' }],
    ['Change the driver of Route 7 to Suresh.', 'update_transport_route', { routeName: '7', driverName: 'Suresh' }],
  ];

  for (const [message, tool, args] of UNRECOGNISED_BEFORE) {
    it(`"${message}" → ${tool}`, () => {
      const step = routed(message);
      expect(step?.tool).toBe(tool);
      expect(step.args).toMatchObject(args);
    });
  }

  it('recording, approving, rejecting, correcting and requesting a change to a payment stay five acts', () => {
    const acts = {
      'Record a payment of ₹5000 in cash for invoice INV-1001.': 'record_payment',
      'Approve the pending payment for INV-1001.': 'approve_payment',
      'Reject the pending payment for INV-1001 because the cheque bounced.': 'reject_payment',
      'Change the receipt number of the payment for INV-1001 to R-778.': 'update_payment',
      'Request a change to the notes of the payment for INV-1001.': 'request_payment_change',
      'Approve the payment change request.': 'decide_payment_change_request',
    };
    for (const [message, tool] of Object.entries(acts)) expect(routed(message)?.tool, message).toBe(tool);
  });

  it('a fee plan is created, amended, approved and published as four acts', () => {
    const acts = {
      'Create an installment plan for Aman Gupta of ₹5000 in 2 installments.': 'create_fee_plan',
      "Change Aman Gupta's fee plan to 3 installments.": 'update_fee_plan',
      "Approve Aman Gupta's fee plan.": 'transition_fee_plan',
      "Publish Aman Gupta's fee plan.": 'publish_fee_plan',
    };
    for (const [message, tool] of Object.entries(acts)) expect(routed(message)?.tool, message).toBe(tool);
  });
});

/* ── 3. Reads stay reads; writes stay writes ──────────────── */

describe('3. a read never resolves to a write, and a write never to a read', () => {
  const READS = [
    ['What is the fee collection this month?', 'get_payment_history', { from: /^\d{4}-\d{2}-01$/ }],
    ['How much fee was collected this month?', 'get_payment_history'],
    ["Show this month's fee collection.", 'get_payment_history'],
    ['What is the total fee collection for this month?', 'get_payment_history'],
    ['What is the fee collection so far?', 'get_fee_statistics'],
    ['Show fee collection for last month.', 'get_payment_history', { from: /^\d{4}-\d{2}-01$/ }],
    ['Show the fee statistics.', 'get_fee_statistics'],
    ['Show outstanding fees for Class 6-A.', 'get_pending_fees'],
    ['Show hostel occupancy.', 'get_hostel_summary'],
    ['Show admission enquiries.', 'get_admissions'],
    ['Show open tickets.', 'list_tickets'],
    ['Who is absent today in Class 6-A?', 'get_attendance_roster'],
    ['Show the timetable for Class 6-A.', 'get_timetable'],
    ['Show the audit log for today.', 'list_audit_logs'],
  ];
  for (const [message, tool, args] of READS) {
    it(`read: "${message}" → ${tool}`, () => {
      const step = routed(message);
      expect(step?.tool).toBe(tool);
      expect(index()[step.tool].operation).toBe('GET');
      if (args) for (const [k, re] of Object.entries(args)) expect(String(step.args[k])).toMatch(re);
    });
  }

  it('this month\'s collection is the period\'s payments -- the statistics have no period to narrow', () => {
    const step = parseIntent('What is the fee collection this month?', actor());
    const today = new Date();
    expect(step.args.from).toBe(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`);
    expect(step.args.to).toBeDefined();
  });

  it('every write request resolves to a capability that writes', () => {
    const writes = [
      'Close the Bus timing ticket.', "Move Kabir Kapoor's admission lead to the tour scheduled stage.",
      'Change the capacity of room A-101 to 4.', 'Approve the pending payment for INV-1001.',
      "Set Rahul Sharma's blood group to O+.", 'Mark the Fan not working hostel inquiry as resolved.',
    ];
    for (const message of writes) {
      const step = parseIntent(message, actor());
      expect(index()[step?.tool]?.operation, message).not.toBe('GET');
    }
  });
});

/* ── 4. Confirmed, written, audited ───────────────────────── */

describe('4. each write is proposed, written only on "yes", and audited', () => {
  const WRITES = [
    ['Create grade Class 9 at level 9.', 'create_grade', () => count(Grade, { name: 'Class 9', level: 9 }), 1],
    ['Create section B in Class 8.', 'create_section', () => count(Section, { gradeId: world.class8._id, name: 'B' }), 1],
    ['Add a Mathematics paper for Class 6-A to Half Yearly with 80 marks.', 'create_exam_subject',
      () => count(ExamSubject, { examId: world.halfYearly._id, subjectOfferingId: world.mathsA._id, maxMarks: 80 }), 1],
    ['Create Term 2 for 2026-27 from 1 October 2026 to 31 March 2027.', 'create_term', () => count(Term, { name: 'Term 2', academicYearId: school.year._id }), 1],
    ['Create an exam called Annual in Term 1 from 1 March 2027 to 10 March 2027.', 'create_exam', () => count(Exam, { name: 'Annual', termId: world.term._id }), 1],
    ['Make the Other teacher the class teacher of Class 6-B.', 'update_section',
      async () => String((await byId(Section, school.sectionB._id)).classTeacherId), () => String(world.otherTeacher.profile._id)],
    ['Assign the Other teacher to teach Science in Class 6-A.', 'assign_teacher_to_subject',
      () => count(SubjectOffering, { sectionId: school.sectionA._id, teacherId: world.otherTeacher.profile._id }), 1],
    ['Make Art an elective in Class 6-A with 25 seats.', 'update_subject_offering',
      async () => { const o = await byId(SubjectOffering, world.artA._id); return [o.isElective, o.capacity]; }, [true, 25]],
    ['Schedule Mathematics for Class 6-A on Monday period 2 from 10:00 to 10:45.', 'upsert_timetable_slot',
      () => count(TimetableSlot, { sectionId: school.sectionA._id, dayOfWeek: 1, periodNo: 2, subjectOfferingId: world.mathsA._id }), 1],
    ['Approve the pending payment for INV-1001.', 'approve_payment', async () => (await byId(Payment, world.pending._id)).recordStatus, 'PUBLISHED'],
    ['Reject the pending payment for INV-1001 because the cheque bounced.', 'reject_payment',
      async () => { const p = await byId(Payment, world.pending._id); return [p.recordStatus, p.rejectionReason]; }, ['REJECTED', 'the cheque bounced']],
    ['Change the receipt number of the payment for INV-1001 to R-778.', 'update_payment', async () => (await byId(Payment, world.pending._id)).receiptNo, 'R-778'],
    ['Approve the payment change request.', 'decide_payment_change_request',
      async () => (await byId(PaymentChangeRequest, world.change._id)).status, 'APPROVED'],
    ["Approve Aman Gupta's fee plan.", 'transition_fee_plan', async () => (await byId(FeePlan, world.waitingPlan._id)).status, 'APPROVED'],
    ["Publish Aman Gupta's fee plan.", 'publish_fee_plan', async () => (await byId(FeePlan, world.approvedPlan._id)).status, 'PUBLISHED'],
    ['Create a fee structure Lab Fee 2026-27 of ₹2000 due 31 October 2026 for Class 6.', 'create_fee_structure',
      () => count(FeeStructure, { name: 'Lab Fee', amountPaise: 200000 }), 1],
    ['Enroll Kabir Mehta in Class 6-A.', 'enroll_student', () => count(Enrollment, { studentId: world.kabir._id, sectionId: school.sectionA._id }), 1],
    ["Mark Aman Gupta's enrollment as transferred.", 'update_enrollment_status', async () => (await byId(Enrollment, school.aman.enrollment._id)).status, 'TRANSFERRED'],
    ["Change Rahul Sharma's address to 12 Park Street.", 'update_student', async () => (await byId(Student, school.rahul.student._id)).address, '12 Park Street'],
    ["Add Mr Sharma as Rahul Sharma's father.", 'add_guardian',
      () => count(StudentGuardian, { studentId: school.rahul.student._id, guardianProfileId: world.mrSharma.profile._id, relation: 'FATHER' }), 1],
    ['Add an admission enquiry for Meera Nair, guardian Mr Nair, phone 9000044444.', 'create_admission_lead', () => count(Lead, { childName: 'Meera Nair' }), 1],
    ["Move Kabir Kapoor's admission lead to the tour scheduled stage.", 'update_admission_lead', async () => (await byId(Lead, world.lead._id)).stage, 'TOUR_SCHEDULED'],
    ["Set Rahul Sharma's blood group to O+.", 'upsert_medical_record', async () => (await one(MedicalRecord, { studentId: school.rahul.student._id }))?.bloodGroup, 'O+'],
    ['Schedule a calendar event for Sports Day on 10 October 2026.', 'create_calendar_event', () => count(CalendarEvent, { title: 'Sports Day' }), 1],
    ['Notify the Other teacher that the staff meeting is at 3pm.', 'notify_users',
      () => count(Notification, { recipientProfileId: world.otherTeacher.profile._id, body: 'the staff meeting is at 3pm' }), 1],
    ['Close the Bus timing ticket.', 'update_ticket', async () => (await byId(Ticket, world.ticket._id)).status, 'CLOSED'],
    ['Update Wings of Fire to 5 copies.', 'update_book', async () => (await one(Book, { title: 'Wings of Fire' })).totalCopies, 5],
    ['Change the capacity of room A-101 to 4.', 'update_hostel_room', async () => (await byId(HostelRoom, world.room._id)).capacity, 4],
    ['Mark the Fan not working hostel inquiry as resolved.', 'update_hostel_inquiry', async () => (await byId(HostelInquiry, world.inquiry._id)).status, 'RESOLVED'],
    ['Create transport route Route 9 with driver Ramesh.', 'create_transport_route', () => count(TransportRoute, { name: 'Route 9', driverName: 'Ramesh' }), 1],
    ['Change the driver of Route 7 to Suresh.', 'update_transport_route', async () => (await byId(TransportRoute, world.route._id)).driverName, 'Suresh'],
    ['Add a stop Station to Route 7 at sequence 2.', 'create_transport_stop', () => count(TransportStop, { routeId: world.route._id, name: 'Station', sequenceNo: 2 }), 1],
    ['Enroll Rahul Sharma on Route 7 at the Market stop.', 'enroll_in_transport',
      () => count(BusEnrollment, { studentId: school.rahul.student._id, routeId: world.route._id, stopId: world.stop._id }), 1],
  ];

  for (const [message, tool, read, expected] of WRITES) {
    it(`${tool}: "${message}"`, async () => {
      const before = await read();
      resetAgentThrottle();
      const res = await api.ask(admin(), message);
      expect(res.action?.tool, res.reply).toBe(tool);
      // Asked, not done: the proposal writes nothing.
      expect(await read()).toEqual(before);
      const done = await api.confirm(admin(), res.action.confirmToken);
      expect(done.status, done.body?.message).toBe(200);
      expect(done.executed).toBe(true);
      expect(await read()).toEqual(typeof expected === 'function' ? expected() : expected);
      expect((await auditOf(tool, 'EXECUTED'))?.after.confirmed).toBe(true);
    }, 60000);
  }

  it('what a write still needs is asked for, and nothing is proposed or written', async () => {
    for (const [message, asks] of [
      ['Create an invoice for Aman Gupta for ₹1500 lab fee due 15 October 2026.', /which invoice/i],
      // A pupil has no phone of their own: the correction reaches update_student,
      // which names what it does accept instead of guessing a field.
      ['Update the phone number of Priya Verma to 9812345678.', /"phone" is not something .* accepts only: .*address/i],
      ['Create an assignment.', /title/i],
    ]) {
      resetAgentThrottle();
      const res = await api.ask(admin(), message);
      expect(res.action ?? null, message).toBeNull();
      expect(res.reply ?? res.body?.message, message).toMatch(asks);
    }
  }, 60000);

  it('a proposal declined with "no" writes nothing', async () => {
    const res = await api.ask(admin(), 'Approve the pending payment for INV-1001.');
    const declined = await api.confirm(admin(), res.action.confirmToken, false);
    expect(declined.executed).toBe(false);
    expect((await byId(Payment, world.pending._id)).recordStatus).toBe('PENDING_ADMIN_APPROVAL');
  }, 60000);

  it('WhatsApp proposes the same write in the same words, and YES writes it', async () => {
    const web = await api.ask(admin(), 'Change the capacity of room A-101 to 4.');
    await api.confirm(admin(), web.action.confirmToken, false);
    resetAgentThrottle();
    const wa = await api.whatsapp(admin(), 'Change the capacity of room A-101 to 4.');
    expect(wa.reply).toContain(web.action.summary);
    expect(wa.reply).toMatch(/Reply YES/);
    await api.whatsapp(admin(), 'YES');
    expect((await byId(HostelRoom, world.room._id)).capacity).toBe(4);
  }, 60000);
});

/* ── 5. Refused, and nothing runs ─────────────────────────── */

describe('5. a mass deletion is refused, never read as a single one', () => {
  // Invoices cannot be deleted at all, so that refusal says so first; either
  // way nothing is proposed and nothing runs.
  for (const message of ['Delete all students.', 'Remove every student record.', 'Archive all students in Class 6-A.', 'Delete all the invoices.']) {
    it(`"${message}"`, async () => {
      const since = new Date();
      resetAgentThrottle();
      const web = await api.ask(admin(), message);
      resetAgentThrottle();
      const wa = await api.whatsapp(admin(), message);
      const reply = web.reply ?? web.body?.message;
      expect(reply).toMatch(/invoices/.test(message) ? /can't delete fees/i : /can't .* all .* at once/i);
      expect(wa.reply).toBe(reply);
      // Refused before any capability was chosen: no proposal, no MCP call.
      expect(web.action ?? null).toBeNull();
      expect(await count(AuditLog, { 'after.via': 'MCP', createdAt: { $gte: since } })).toBe(0);
      expect(await count(Student, { deletedAt: { $ne: null } })).toBe(0);
    }, 60000);
  }

  it('does not resolve to archive_student or ask "which student?"', async () => {
    resetAgentThrottle();
    const web = await api.ask(admin(), 'Delete all students.');
    expect(web.action?.tool ?? null).not.toBe('archive_student');
    expect(web.reply ?? web.body?.message).not.toMatch(/which student|name a student/i);
  }, 60000);

  it('naming one pupil is still a request about one pupil, not a mass deletion', async () => {
    resetAgentThrottle();
    const web = await api.ask(admin(), 'Archive student Aman Gupta.');
    expect(web.action?.tool).toBe('archive_student');
    await api.confirm(admin(), web.action.confirmToken, false);
  }, 60000);
});
