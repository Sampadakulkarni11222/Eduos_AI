import mongoose from 'mongoose';
import { Role } from '../../src/models/role.model.js';
import { Account } from '../../src/models/account.model.js';
import { Profile } from '../../src/models/profile.model.js';
import { Student, StudentGuardian, Enrollment } from '../../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../../src/models/academics.model.js';
import { Invoice, InvoiceLine } from '../../src/models/fee.model.js';
import { AttendanceRecord } from '../../src/models/attendanceRecord.model.js';
import { Announcement } from '../../src/models/announcement.model.js';
import { SYSTEM_ROLES } from '../../src/constants/permissions.js';
import { buildPermissionMap } from '../../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../../src/tenancy/tenantContext.js';
import { openSession, closeSession } from '../../src/modules/ai/mcp/session.js';
import { executeToolCall } from '../../src/modules/ai/mcp/server.js';

/**
 * A small, real school for the MCP suites — not a helper that fakes the ERP.
 *
 * Everything here is written through the actual models, the actors are built
 * exactly the way middleware/auth.js builds them (from a real Account, Profile
 * and DB-backed Role), and the tenancy plugin stamps every school-owned row.
 * Two schools exist so isolation can be tested against something real: both
 * have a student called Rahul.
 *
 * Not a test file (no .test.js suffix), so vitest only runs it when imported.
 */

export const OAK = 'oakridge';
export const RIVER = 'riverside';

export const inSchool = (tenant, fn) => runWithTenant(tenant, fn);

let phoneSeq = 0;
const nextPhone = () => `+91988${String(Date.now()).slice(-3)}${String(++phoneSeq).padStart(4, '0')}`;

/** Today as the attendance module stores it: the local calendar day at UTC midnight. */
export const todayKey = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/** Seeds the role catalogue exactly as app.js does on boot. */
export async function seedRoles() {
  const roleIds = {};
  for (const r of SYSTEM_ROLES) {
    const doc = await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
    roleIds[r.key] = doc._id;
  }
  return roleIds;
}

/**
 * One person: an Account, a Profile in a school, and the actor middleware
 * would build for them. The phone number is the one WhatsApp resolves.
 */
export async function seedPerson({ roleKey, roleId, tenantId = OAK, displayName }) {
  const phone = nextPhone();
  const account = await Account.create({ phoneE164: phone, status: 'ACTIVE' });
  const profile = await Profile.create({
    accountId: account._id,
    roleId,
    displayName: displayName ?? `${roleKey} user`,
    tenantId,
    tenantName: tenantId === OAK ? 'Oakridge Academy' : 'Riverside School',
    status: 'ACTIVE',
  });
  const role = await Role.findById(roleId);
  const actor = {
    accountId: String(account._id),
    profileId: String(profile._id),
    displayName: profile.displayName,
    roleKey,
    permissions: buildPermissionMap(role),
    tenantId,
    tenantName: profile.tenantName,
  };
  return { account, profile, actor, phone };
}

/**
 * The fixture every MCP suite shares.
 *
 * Oakridge, Class 6 A (class teacher: TEACHER):
 *   OAK-1 Rahul Sharma   roll 1 — PARENT is his father; ABSENT today; INV-1001 ₹8,000 overdue
 *   OAK-2 Priya Verma    roll 2 — the STUDENT profile is hers; PRESENT today
 *   OAK-3 Aman Gupta     roll 3 — no attendance; INV-1002 ₹5,000 not yet due
 * Oakridge, Class 6 B (no class teacher): OAK-9 Riya Kapoor
 * Riverside: RIV-1 Rahul Riverside with INV-9001 — the isolation target.
 */
export async function seedSchool() {
  const roleIds = await seedRoles();
  const people = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT']) {
    people[key] = await seedPerson({ roleKey: key, roleId: roleIds[key] });
  }
  people.RIVER_ADMIN = await seedPerson({ roleKey: 'ADMIN', roleId: roleIds.ADMIN, tenantId: RIVER, displayName: 'Riverside admin' });

  const oak = await inSchool(OAK, async () => {
    const year = await AcademicYear.create({
      name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
    });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const sectionA = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: people.TEACHER.profile._id });
    const sectionB = await Section.create({ gradeId: grade._id, name: 'B' });

    const enrol = async (admissionNo, firstName, lastName, section, rollNo, extra = {}) => {
      const student = await Student.create({ admissionNo, firstName, lastName, ...extra });
      const enrollment = await Enrollment.create({
        studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo,
      });
      return { student, enrollment };
    };

    const rahul = await enrol('OAK-1', 'Rahul', 'Sharma', sectionA, 1);
    const priya = await enrol('OAK-2', 'Priya', 'Verma', sectionA, 2, { profileId: people.STUDENT.profile._id });
    const aman = await enrol('OAK-3', 'Aman', 'Gupta', sectionA, 3);
    const riya = await enrol('OAK-9', 'Riya', 'Kapoor', sectionB, 1);

    await StudentGuardian.create({
      studentId: rahul.student._id, guardianProfileId: people.PARENT.profile._id, relation: 'FATHER', isPrimary: true,
    });

    const day = 86_400_000;
    const inv1 = await Invoice.create({
      enrollmentId: rahul.enrollment._id, invoiceNo: 'INV-1001', dueOn: new Date(Date.now() - 20 * day), totalPaise: 800000,
    });
    await InvoiceLine.create({ invoiceId: inv1._id, description: 'Tuition — Term 1', amountPaise: 800000 });
    const inv2 = await Invoice.create({
      enrollmentId: aman.enrollment._id, invoiceNo: 'INV-1002', dueOn: new Date(Date.now() + 20 * day), totalPaise: 500000,
    });
    await InvoiceLine.create({ invoiceId: inv2._id, description: 'Tuition — Term 1', amountPaise: 500000 });

    await AttendanceRecord.create({ enrollmentId: rahul.enrollment._id, date: todayKey(), periodNo: null, status: 'ABSENT' });
    await AttendanceRecord.create({ enrollmentId: priya.enrollment._id, date: todayKey(), periodNo: null, status: 'PRESENT' });

    await Announcement.create({
      title: 'Bus route 4 changes from Monday',
      content: 'Route 4 will now start from Gandhi Nagar at 7:10 am and will skip the market stop.',
      audience: { all: true },
      createdByProfileId: people.ADMIN.profile._id,
    });
    await Announcement.create({
      title: 'Attendance policy',
      content: 'Students must maintain at least 75% attendance to sit the final examinations.',
      audience: { all: true },
      createdByProfileId: people.ADMIN.profile._id,
    });

    return { year, grade, sectionA, sectionB, rahul, priya, aman, riya, inv1, inv2 };
  });

  const river = await inSchool(RIVER, async () => {
    const year = await AcademicYear.create({
      name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
    });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    const student = await Student.create({ admissionNo: 'RIV-1', firstName: 'Rahul', lastName: 'Riverside' });
    const enrollment = await Enrollment.create({
      studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo: 1,
    });
    const invoice = await Invoice.create({
      enrollmentId: enrollment._id, invoiceNo: 'INV-9001', dueOn: new Date(Date.now() - 5 * 86_400_000), totalPaise: 300000,
    });
    return { year, section, student, enrollment, invoice };
  });

  return { roleIds, people, ...oak, river };
}

/** A permission-only actor, for checks that need no database person behind them. */
export function actorForRole(roleKey, overrides = {}) {
  const role = SYSTEM_ROLES.find((r) => r.key === roleKey);
  return {
    roleKey,
    profileId: String(new mongoose.Types.ObjectId()),
    permissions: buildPermissionMap({ permissions: role.grants }),
    tenantId: OAK,
    ...overrides,
  };
}

/** Runs one MCP tool call as `actor`, in `tenant`, through the real server. */
export async function mcp(tenant, actor, name, args = {}, { channel = 'WEB', confirmationToken = null } = {}) {
  return inSchool(tenant, async () => {
    const sessionId = openSession({ actor, channel });
    try {
      return await executeToolCall({ sessionId, name, args, confirmationToken });
    } finally {
      closeSession(sessionId);
    }
  });
}

/**
 * Arguments that give each read tool something real to find in the fixture.
 * Shared by the contract and data-exposure suites, so both exercise every read
 * tool the same way.
 */
export function readToolArgs(name, school) {
  const random = () => String(new mongoose.Types.ObjectId());
  return {
    search_students: { query: 'Rahul' },
    get_student: { admissionNo: 'OAK-1' },
    get_student_overview: { admissionNo: 'OAK-1', include: ['profile', 'personal', 'guardians', 'attendance', 'performance', 'assignments', 'medical'] },
    list_guardians: { admissionNo: 'OAK-1' },
    get_student_attendance: { admissionNo: 'OAK-1' },
    get_attendance_roster: { sectionId: String(school.sectionA._id) },
    get_attendance_trend: { admissionNo: 'OAK-1' },
    get_subject_attendance: { admissionNo: 'OAK-1' },
    get_attendance_calendar: { admissionNo: 'OAK-1' },
    get_invoice: { invoiceNo: 'INV-1001' },
    get_report_card: { admissionNo: 'OAK-1' },
    get_marks_grid: { examSubjectId: random() },
    get_performance_history: { studentId: String(school.rahul.student._id) },
    get_submissions: { assignmentId: random() },
    get_admission_lead: { leadId: random() },
    get_book: { bookId: random() },
    list_transport_stops: { routeId: random() },
    get_ticket: { ticketId: random() },
    get_medical_record: { admissionNo: 'OAK-1' },
    get_at_risk_students: { attendanceBelowPct: 75 },
    get_growth_score: { admissionNo: 'OAK-1' },
  }[name] ?? {};
}

/** Proposes a write, then confirms it with the token the proposal returned. */
export async function proposeAndConfirm(tenant, actor, name, args, opts = {}) {
  const proposal = await mcp(tenant, actor, name, args, opts);
  if (proposal?.action?.status !== 'confirmation_required') return { proposal, done: null };
  const done = await mcp(tenant, actor, name, {}, { ...opts, confirmationToken: proposal.action.confirmationToken });
  return { proposal, done };
}
