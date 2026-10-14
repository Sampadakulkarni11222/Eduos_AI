import { countLabel } from '../../utils/plural.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Exam, ExamSubject } from '../../models/exam.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { OrgUnit, Position, Appointment } from '../../models/institution.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { Facility, WorkOrder } from '../../models/facility.model.js';
import { Correspondence, InstitutionEvent } from '../../models/administration.model.js';
import { Invoice } from '../../models/fee.model.js';
import { ApprovalRequest } from '../../models/approval.model.js';
import { Lead } from '../../models/lead.model.js';
import { Book, BookIssue } from '../../models/library.model.js';
import { HostelRoom, HostelAllocation } from '../../models/hostel.model.js';
import { TransportRoute, BusEnrollment } from '../../models/transport.model.js';
import { VerificationCase } from '../../models/verification.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { logger } from '../../utils/logger.js';
import * as compliance from '../compliance/compliance.service.js';
import { startOfDayUtc } from '../ops/common.js';

/**
 * What is happening in each class today, for the campus map.
 *
 * Headcount is the day's attendance register, nothing else: "32 of 40 present"
 * means the register says so, and a class whose register has not been taken
 * yet says "not marked", never zero. It updates as soon as a teacher marks or
 * corrects the register. No device counts or locates anyone.
 */
export async function liveBySection(sectionIds, now = new Date()) {
  const out = new Map();
  if (!sectionIds.length) return out;
  const day = startOfDayUtc(now);
  const [enrolments, marks] = await Promise.all([
    Enrollment.find({ sectionId: { $in: sectionIds }, status: 'ACTIVE' }).select('_id sectionId').lean(),
    AttendanceRecord.aggregate([
      { $match: { date: day, periodNo: null } },
      { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'en' } },
      { $unwind: '$en' },
      { $match: { 'en.sectionId': { $in: sectionIds } } },
      { $group: { _id: { section: '$en.sectionId', status: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);
  for (const id of sectionIds) out.set(String(id), { enrolled: 0, present: 0, absent: 0, late: 0, marked: 0, registerTaken: false, attendancePct: null, exam: null });
  for (const e of enrolments) out.get(String(e.sectionId)).enrolled += 1;
  for (const m of marks) {
    const row = out.get(String(m._id.section));
    if (!row) continue;
    row.marked += m.n;
    if (m._id.status === 'PRESENT') row.present += m.n;
    else if (m._id.status === 'LATE') { row.present += m.n; row.late += m.n; }
    else if (m._id.status === 'ABSENT') row.absent += m.n;
  }
  for (const row of out.values()) {
    row.registerTaken = row.marked > 0;
    row.attendancePct = row.marked ? Math.round((row.present / row.marked) * 1000) / 10 : null;
  }

  // Exams: a paper dated today for a subject this class takes, or an exam
  // whose dates cover today when its papers carry no date of their own.
  const dayEnd = new Date(day.getTime() + 86_400_000);
  const exams = await Exam.find({ startsOn: { $lt: dayEnd }, endsOn: { $gte: day } }).select('name').lean();
  if (exams.length) {
    const offerings = await SubjectOffering.find({ sectionId: { $in: sectionIds } }).select('sectionId subjectId').populate('subjectId', 'name').lean();
    const offeringSection = new Map(offerings.map((o) => [String(o._id), o]));
    const papers = await ExamSubject.find({ examId: { $in: exams.map((e) => e._id) }, subjectOfferingId: { $in: offerings.map((o) => o._id) } }).lean();
    const examName = new Map(exams.map((e) => [String(e._id), e.name]));
    for (const p of papers) {
      const o = offeringSection.get(String(p.subjectOfferingId));
      const row = o && out.get(String(o.sectionId));
      if (!row) continue;
      const today = p.examDate && new Date(p.examDate) >= day && new Date(p.examDate) < dayEnd;
      if (today) row.exam = { name: examName.get(String(p.examId)), subject: o.subjectId?.name ?? null, paperToday: true };
      else if (!row.exam && !p.examDate) row.exam = { name: examName.get(String(p.examId)), subject: null, paperToday: false };
    }
  }
  return out;
}

// ── Departments ─────────────────────────────────────────────────────────

const DAY = 86_400_000;
const can = (actor, key, scope = null) => {
  const held = actor.permissions?.[key];
  return Boolean(held) && (!scope || held === scope);
};

/**
 * The departments of an institution as places on the map: where each one sits,
 * who leads it, how many people it has, and the two or three live numbers that
 * describe its day. Each number is offered only to someone who may read the
 * records behind it; a department the viewer may know nothing about still
 * appears, as a name and a place.
 *
 * A department is matched to rooms by the `department` recorded on a facility,
 * or by the kind of space it obviously runs (the library, the bus bay).
 */
const DEPARTMENTS = [
  { code: 'LEADERSHIP', name: "Principal's Office", roles: ['PRINCIPAL'], kinds: [], names: ['principal'], pages: ['approvals', 'today', 'governance'] },
  { code: 'ACADEMICS', name: 'Academics', roles: ['TEACHER'], kinds: ['CLASSROOM', 'LECTURE_HALL', 'LAB', 'STAFF_ROOM'], names: ['academic'], pages: ['syllabus', 'attendance', 'timetable', 'lectures'] },
  { code: 'ADMINISTRATION', name: 'Administration', roles: ['ADMIN'], kinds: [], names: ['administration office', 'admin'], pages: ['correspondence', 'facilities', 'events'] },
  { code: 'FINANCE', name: 'Finance & Accounts', roles: ['FINANCE'], kinds: [], names: ['account', 'finance'], pages: ['payroll', 'procurement', 'budgets', 'fees', 'payments'] },
  { code: 'ADMISSIONS', name: 'Admissions & Marketing', roles: ['MARKETING'], kinds: [], names: ['admission', 'marketing'], pages: ['marketing', 'admissions'] },
  { code: 'HR', name: 'Human Resources', roles: ['HR'], kinds: [], names: ['hr', 'human'], pages: ['verification', 'organization', 'payroll'] },
  { code: 'COMPLIANCE', name: 'Compliance & Safeguarding', roles: ['COMPLIANCE'], kinds: [], names: ['compliance'], pages: ['compliance', 'safeguarding'] },
  { code: 'LIBRARY', name: 'Library', roles: ['LIBRARIAN'], kinds: ['LIBRARY'], names: ['library'], pages: ['library', 'books'] },
  { code: 'TRANSPORT', name: 'Transport', roles: [], kinds: ['TRANSPORT_BAY', 'PARKING', 'GATE'], names: ['transport'], pages: ['transport'] },
  { code: 'HOSTEL', name: 'Hostel', roles: ['WARDEN'], kinds: ['HOSTEL'], names: ['hostel'], pages: ['rooms'] },
  { code: 'HEALTH', name: 'Health Centre', roles: [], kinds: ['CLINIC'], names: ['health', 'clinic', 'medical'], pages: ['medical', 'safeguarding'] },
  { code: 'EVENTS', name: 'Events & Sports', roles: [], kinds: ['AUDITORIUM', 'GROUND', 'COURT'], names: ['sport', 'event'], pages: ['events', 'calendar'] },
  { code: 'CANTEEN', name: 'Canteen', roles: [], kinds: ['CANTEEN'], names: ['canteen'], pages: [] },
];

async function metricsFor(code, actor, now) {
  const lines = [];
  const add = (value, label, tone = 'neutral') => lines.push({ value, label: typeof value === 'number' ? countLabel(value, label) : label, tone });
  if (code === 'LEADERSHIP' && can(actor, 'approvals.read', 'ALL')) {
    add(await ApprovalRequest.countDocuments({ status: 'PENDING' }), 'approvals in progress');
  }
  if (code === 'ADMINISTRATION') {
    if (can(actor, 'correspondence.read', 'ALL')) add(await Correspondence.countDocuments({ status: { $nin: ['CLOSED', 'NO_ACTION', 'DISPATCHED'] } }), 'open letters');
    if (can(actor, 'facilities.read', 'ALL')) add(await WorkOrder.countDocuments({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }), 'open repairs');
  }
  if (code === 'FINANCE') {
    if (can(actor, 'fees.read', 'ALL')) {
      const overdue = await Invoice.countDocuments({ dueOn: { $lt: now }, $expr: { $lt: ['$paidPaise', '$totalPaise'] }, status: { $ne: 'CANCELLED' } });
      add(overdue, 'overdue invoices', overdue ? 'warn' : 'good');
    }
    if (can(actor, 'approvals.read', 'ALL')) add(await ApprovalRequest.countDocuments({ status: 'PENDING', category: { $in: ['PROCUREMENT', 'PAYMENT', 'BUDGET', 'CAPEX', 'PAYROLL_RUN', 'FUNDING', 'FEE_REFUND'] } }), 'money decisions waiting');
  }
  if (code === 'ADMISSIONS' && can(actor, 'marketing.read')) {
    add(await Lead.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } }), 'enquiries this week');
    add(await Lead.countDocuments({ stage: 'NEW' }), 'not yet contacted');
  }
  if (code === 'HR' && can(actor, 'verification.read')) {
    add(await VerificationCase.countDocuments({ status: { $in: ['INITIATED', 'IN_PROGRESS', 'HR_REVIEW', 'AWAITING_DECISION'] } }), 'verifications under way');
  }
  if (code === 'COMPLIANCE' && can(actor, 'compliance.read')) {
    const items = await compliance.calendar({ days: 30 });
    const overdue = items.filter((i) => i.overdue).length;
    add(overdue, 'compliance items overdue', overdue ? 'bad' : 'good');
    add(items.length - overdue, 'due within 30 days');
  }
  if (code === 'LIBRARY' && can(actor, 'library.read')) {
    add(await Book.countDocuments({}), 'titles');
    if (can(actor, 'library.read', 'ALL')) {
      add(await BookIssue.countDocuments({ status: { $in: ['ACTIVE', 'OVERDUE'] } }), 'books out');
      const late = await BookIssue.countDocuments({ status: { $in: ['ACTIVE', 'OVERDUE'] }, dueDate: { $lt: now } });
      add(late, 'overdue returns', late ? 'warn' : 'good');
    }
  }
  if (code === 'TRANSPORT' && can(actor, 'transport.read', 'ALL')) {
    add(await TransportRoute.countDocuments({ status: 'ACTIVE' }), 'bus routes');
    add(await BusEnrollment.countDocuments({}), 'students on buses');
  }
  if (code === 'HOSTEL' && can(actor, 'hostel.read', 'ALL')) {
    const rooms = await HostelRoom.find({ status: 'ACTIVE' }).select('capacity').lean();
    const beds = rooms.reduce((n, r) => n + (r.capacity ?? 0), 0);
    const taken = await HostelAllocation.countDocuments({ status: 'ACTIVE' });
    add(taken, `of ${beds} beds occupied`);
  }
  if (code === 'EVENTS' && can(actor, 'events.read')) {
    add(await InstitutionEvent.countDocuments({ startsAt: { $gte: now, $lt: new Date(now.getTime() + 14 * DAY) }, status: { $nin: ['CANCELLED', 'REJECTED'] } }), 'events in the next two weeks');
  }
  return lines;
}

export async function departments(actor, { academics = null, now = new Date() } = {}) {
  const tenantId = currentTenantId();
  const [facilities, units, roles] = await Promise.all([
    Facility.find({ kind: { $nin: ['CAMPUS', 'FLOOR', 'BUILDING'] } }).select('kind name department restricted parentId').lean(),
    OrgUnit.find({ kind: { $in: ['DEPARTMENT', 'LEADERSHIP', 'TEAM'] } }).lean(),
    Role.find({}).select('_id key').lean(),
  ]);
  const staff = !['STUDENT', 'PARENT', 'ALUMNUS'].includes(actor.roleKey);
  const roleId = new Map(roles.map((r) => [r.key, r._id]));
  // Heads, from the organisation structure where one has been set up.
  const headPositions = await Position.find({ orgUnitId: { $in: units.map((u) => u._id) }, isHead: true }).lean();
  const appts = await Appointment.find({ positionId: { $in: headPositions.map((p) => p._id) }, effectiveTo: null }).lean();
  const people = await Profile.find({ _id: { $in: appts.map((a) => a.profileId) } }).select('displayName').lean();
  const personName = new Map(people.map((p) => [String(p._id), p.displayName]));
  const headOfUnit = new Map();
  for (const p of headPositions) {
    const a = appts.find((x) => String(x.positionId) === String(p._id));
    if (a) headOfUnit.set(String(p.orgUnitId), { name: personName.get(String(a.profileId)) ?? null, title: p.title });
  }

  const out = [];
  for (const d of DEPARTMENTS) {
    const mine = facilities.filter((f) => {
      if (f.restricted && !staff) return false;
      const dep = String(f.department ?? '').toLowerCase();
      const nm = String(f.name ?? '').toLowerCase();
      return d.kinds.includes(f.kind) || (dep && (dep === d.name.toLowerCase() || dep === d.code.toLowerCase() || d.names.some((n) => dep.includes(n)))) || (!d.kinds.length && d.names.some((n) => nm.includes(n)));
    });
    const unit = units.find((u) => (u.code && u.code === d.code) || d.names.some((n) => u.name.toLowerCase().includes(n)) || u.name.toLowerCase() === d.name.toLowerCase());
    // A department with no room and no unit is not part of this institution.
    if (!mine.length && !unit) continue;
    let staffCount = null;
    let metrics = [];
    try {
      if (staff && d.roles.length) {
        staffCount = await Profile.countDocuments({ roleId: { $in: d.roles.map((r) => roleId.get(r)).filter(Boolean) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) });
      }
      metrics = staff ? await metricsFor(d.code, actor, now) : [];
      if (d.code === 'ACADEMICS' && academics && staff) {
        metrics = [
          { value: academics.classesNow, label: 'classes right now', tone: 'neutral' },
          ...(academics.studentsMarked ? [{ value: academics.studentsPresent, label: `of ${academics.studentsMarked} students present today`, tone: 'good' }] : [{ value: null, label: 'attendance not marked yet today', tone: 'neutral' }]),
          ...(academics.examsToday ? [{ value: academics.examsToday, label: 'classes with an exam today', tone: 'warn' }] : []),
        ];
      }
    } catch (err) {
      logger.warn(`Department ${d.code} figures unavailable: ${err.message}`);
    }
    const head = unit ? headOfUnit.get(String(unit._id)) ?? null : null;
    out.push({
      code: d.code, name: unit?.name ?? d.name, description: unit?.description ?? null,
      head: staff ? head : null, staffCount,
      facilityIds: mine.map((f) => String(f._id)),
      metrics, pages: d.pages,
    });
  }
  return out;
}
