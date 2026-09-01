import { describe, it, expect, beforeEach } from 'vitest';
import { Lead } from '../src/models/lead.model.js';
import { Student } from '../src/models/student.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { Enrollment } from '../src/models/student.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
// Registered for its side effect: the admin dashboard populates the ticket's
// and announcement's author, so mongoose needs the Profile schema present.
import '../src/models/profile.model.js';
import mongoose from 'mongoose';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requireRole, requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as dashboard from '../src/modules/dashboard/dashboard.service.js';

/**
 * Which dashboard each role may open, and what it receives once inside.
 *
 * Two different questions, answered by two different mechanisms, so both are
 * exercised here: requireRole + requirePermission decide whether the endpoint
 * opens at all, and the service decides which panels of the payload a given
 * actor is entitled to.
 */

const roleGrants = new Map(SYSTEM_ROLES.map((r) => [r.key, r.grants]));
const actorFor = (roleKey) => ({
  roleKey,
  profileId: new mongoose.Types.ObjectId().toString(),
  permissions: buildPermissionMap({ permissions: roleGrants.get(roleKey) }),
});

/** The route guards for each dashboard, exactly as dashboard.routes.js mounts them. */
const DASHBOARD_GUARDS = {
  admin: [requireRole('SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'), requirePermission('students.read', 'ALL')],
  finance: [requireRole('SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'FINANCE'), requirePermission('fees.read', 'ALL')],
  teacher: [requireRole('TEACHER'), requirePermission('timetable.read')],
  student: [requireRole('STUDENT'), requirePermission('attendance.read')],
  parent: [requireRole('PARENT'), requirePermission('students.read')],
  warden: [requireRole('SUPER_ADMIN', 'ADMIN', 'WARDEN'), requirePermission('hostel.read')],
  librarian: [requireRole('SUPER_ADMIN', 'ADMIN', 'LIBRARIAN'), requirePermission('library.read')],
};

/** Runs a dashboard's real guard chain and reports whether the request opens. */
const canOpen = (roleKey, name) => {
  const req = { actor: actorFor(roleKey) };
  try {
    for (const guard of DASHBOARD_GUARDS[name]) guard(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'];

/** The dashboards each role is expected to reach — everything else must 403. */
const EXPECTED_ACCESS = {
  SUPER_ADMIN: ['admin', 'finance', 'warden', 'librarian'],
  ADMIN: ['admin', 'finance', 'warden', 'librarian'],
  PRINCIPAL: ['admin', 'finance'],
  TEACHER: ['teacher'],
  STUDENT: ['student'],
  PARENT: ['parent'],
  FINANCE: ['finance'],
  LIBRARIAN: ['librarian'],
  WARDEN: ['warden'],
};

describe('which dashboard each role may open', () => {
  it.each(ROLES)('%s reaches exactly its own dashboards', (roleKey) => {
    const reached = Object.keys(DASHBOARD_GUARDS).filter((name) => canOpen(roleKey, name));
    expect(reached.sort()).toEqual([...EXPECTED_ACCESS[roleKey]].sort());
  });

  it('a family role cannot open any staff dashboard, by URL or by API', () => {
    for (const roleKey of ['STUDENT', 'PARENT']) {
      for (const name of ['admin', 'finance', 'warden', 'librarian', 'teacher']) {
        expect(canOpen(roleKey, name), `${roleKey} must not open /dashboard/${name}`).toBe(false);
      }
    }
  });

  it('a teacher cannot open the school-wide dashboards', () => {
    for (const name of ['admin', 'finance', 'warden', 'librarian']) {
      expect(canOpen('TEACHER', name)).toBe(false);
    }
  });

  it('the support roles stay in their own domain', () => {
    expect(canOpen('LIBRARIAN', 'finance')).toBe(false);
    expect(canOpen('LIBRARIAN', 'warden')).toBe(false);
    expect(canOpen('WARDEN', 'finance')).toBe(false);
    expect(canOpen('WARDEN', 'librarian')).toBe(false);
    expect(canOpen('FINANCE', 'admin')).toBe(false);
    expect(canOpen('FINANCE', 'warden')).toBe(false);
  });

  it('holding a permission only at OWN scope does not open a school-wide dashboard', () => {
    // A parent holds students.read, but at OWN scope — /dashboard/admin asks
    // for it at ALL, which is what stops the family view becoming a school view.
    expect(actorFor('PARENT').permissions['students.read']).toBe('OWN');
    expect(canOpen('PARENT', 'admin')).toBe(false);
  });
});

describe('the admin dashboard shows each caller only its authorized panels', () => {
  const SCHOOL = 'oakridge';
  const inSchool = (fn) => runWithTenant(SCHOOL, fn);

  beforeEach(async () => {
    await inSchool(async () => {
      await Student.create({ admissionNo: 'ADM-1', firstName: 'A', lastName: 'Student' });
      await Ticket.create({
        subject: 'Broken projector', status: 'OPEN',
        raisedByProfileId: new mongoose.Types.ObjectId(),
      });
      await Lead.create({ childName: 'Prospect One', guardianName: 'Guardian One', phone: '+919810000011', stage: 'NEW' });
      await Lead.create({ childName: 'Prospect Two', guardianName: 'Guardian Two', phone: '+919810000012', stage: 'CONTACTED' });
    });
  });

  it('gives the admissions pipeline to a role that holds admissions.read', async () => {
    for (const roleKey of ['ADMIN', 'SUPER_ADMIN']) {
      const data = await inSchool(() => dashboard.getAdminDashboard(actorFor(roleKey)));
      expect(data.admissionsPipeline.length, roleKey).toBeGreaterThan(0);
    }
  });

  it('withholds the admissions pipeline from a principal, who holds no admissions permission', async () => {
    expect(actorFor('PRINCIPAL').permissions['admissions.read']).toBeUndefined();

    const data = await inSchool(() => dashboard.getAdminDashboard(actorFor('PRINCIPAL')));
    expect(data.admissionsPipeline).toEqual([]);
  });

  it('still shows the principal every panel it is entitled to', async () => {
    // Withholding one panel must not blank the dashboard: the widgets backed by
    // students.read, tickets.read and announcements.read are unchanged.
    const data = await inSchool(() => dashboard.getAdminDashboard(actorFor('PRINCIPAL')));
    expect(data.totalStudents).toBe(1);
    expect(data.openTickets).toBe(1);
    expect(data.recentStudents).toHaveLength(1);
    expect(data.recentTickets).toHaveLength(1);
  });

  it('keeps the response shape identical for every caller, so no page breaks', async () => {
    const admin = await inSchool(() => dashboard.getAdminDashboard(actorFor('ADMIN')));
    const principal = await inSchool(() => dashboard.getAdminDashboard(actorFor('PRINCIPAL')));
    expect(Object.keys(principal).sort()).toEqual(Object.keys(admin).sort());
    expect(Array.isArray(principal.admissionsPipeline)).toBe(true);
  });

  it('reads only the acting school, so a School Admin sees no other school', async () => {
    await runWithTenant('nvmp', () => Lead.create({
      childName: 'NVMP Prospect', guardianName: 'NVMP Guardian', phone: '+919810000013', stage: 'NEW',
    }));

    const data = await inSchool(() => dashboard.getAdminDashboard(actorFor('ADMIN')));
    const total = data.admissionsPipeline.reduce((n, s) => n + s.count, 0);
    expect(total).toBe(2); // the two Oakridge leads, not the NVMP one
    expect(data.totalStudents).toBe(1);
  });
});

describe('the per-person dashboards stay bound to the caller', () => {
  it('are reachable by exactly one role each', () => {
    expect(EXPECTED_ACCESS.TEACHER).toEqual(['teacher']);
    expect(EXPECTED_ACCESS.STUDENT).toEqual(['student']);
    expect(EXPECTED_ACCESS.PARENT).toEqual(['parent']);

    // Not even a platform actor reads them: they aggregate one profileId, so
    // there is nothing school-wide to return.
    for (const name of ['teacher', 'student', 'parent']) {
      expect(canOpen('SUPER_ADMIN', name), name).toBe(false);
      expect(canOpen('ADMIN', name), name).toBe(false);
    }
  });
});

describe('the warden sees leave for hostel residents only', () => {
  const inSchool = (fn) => runWithTenant('oakridge', fn);

  /** A student with an enrolment and one pending leave application. */
  const seedStudentOnLeave = async (admissionNo, firstName) => {
    const student = await Student.create({ admissionNo, firstName, lastName: 'Test' });
    const enrollment = await Enrollment.create({
      studentId: student._id,
      sectionId: new mongoose.Types.ObjectId(),
      academicYearId: new mongoose.Types.ObjectId(),
      status: 'ACTIVE',
    });
    await LeaveApplication.create({
      enrollmentId: enrollment._id,
      fromDate: new Date(), toDate: new Date(),
      reason: `${firstName} personal reason`, status: 'PENDING',
    });
    return student;
  };

  beforeEach(async () => {
    await inSchool(async () => {
      const resident = await seedStudentOnLeave('HOSTEL-1', 'Resident');
      await seedStudentOnLeave('DAY-1', 'DayScholar');

      const room = await HostelRoom.create({ roomNo: '101', block: 'A', capacity: 2, status: 'ACTIVE' });
      await HostelAllocation.create({ roomId: room._id, studentId: resident._id, status: 'ACTIVE' });
    });
  });

  it("lists the resident pending leave", async () => {
    const data = await inSchool(() => dashboard.getWardenDashboard());
    expect(data.leaveRequests).toHaveLength(1);
    expect(data.leaveRequests[0].admissionNo).toBe('HOSTEL-1');
  });

  it("withholds a day scholar leave, including the stated reason", async () => {
    const data = await inSchool(() => dashboard.getWardenDashboard());
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('DAY-1');
    expect(serialised).not.toContain('DayScholar personal reason');
  });

  it('counts only residents, so the total matches the list', async () => {
    const data = await inSchool(() => dashboard.getWardenDashboard());
    expect(data.pendingLeaveCount).toBe(1);
  });

  it('drops a student out once their allocation is vacated', async () => {
    await inSchool(() => HostelAllocation.updateMany({}, { $set: { status: 'VACATED' } }));
    const data = await inSchool(() => dashboard.getWardenDashboard());
    expect(data.leaveRequests).toHaveLength(0);
    expect(data.pendingLeaveCount).toBe(0);
  });
});
