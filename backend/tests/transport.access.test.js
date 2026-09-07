import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { TransportRoute, TransportStop, BusEnrollment } from '../src/models/transport.model.js';
import { Student, Enrollment, StudentGuardian } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as transport from '../src/modules/transport/transport.service.js';

/**
 * Who may read a bus assignment.
 *
 * GET /transport/my-bus deliberately carries no transport.* permission — a
 * family holds none and still has to see its own bus — so the entitlement is
 * resolved in the service. It used to treat every role that was not a student
 * or a parent as "staff, unrestricted", which handed any signed-in teacher,
 * librarian, warden or finance user another student's route, stop, vehicle and
 * the driver's name and phone number for the asking.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

const canReach = (roleKey, permissionKey) => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission(permissionKey)(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

const teacherId = new mongoose.Types.ObjectId();
const otherTeacherId = new mongoose.Types.ObjectId();
let myStudent;       // in the teacher's own section
let otherStudent;    // in a colleague's section
let studentProfileId;
let parentProfileId;
let nvmpStudent;
let mySection;
let otherSection;

/** A student in `section`, with a bus enrolment on the given route/stop. */
const seedRider = async (section, admissionNo, profileId = null) => {
  const student = await Student.create({
    admissionNo, firstName: admissionNo, lastName: 'Rider', profileId,
  });
  await Enrollment.create({
    studentId: student._id, sectionId: section._id,
    academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
  });
  const route = await TransportRoute.create({
    name: `Route ${admissionNo}`, vehicleNo: 'KA-01-1234',
    driverName: 'A Driver', driverPhone: '+919800000000', status: 'ACTIVE',
  });
  const stop = await TransportStop.create({ routeId: route._id, name: 'Main Gate', sequenceNo: 1 });
  await BusEnrollment.create({
    studentId: student._id, routeId: route._id, stopId: stop._id,
    academicYearId: new mongoose.Types.ObjectId(), direction: 'BOTH',
  });
  return student;
};

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    mySection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });
    otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: otherTeacherId });

    studentProfileId = new mongoose.Types.ObjectId();
    parentProfileId = new mongoose.Types.ObjectId();

    myStudent = await seedRider(mySection, 'IN-6A', studentProfileId);
    otherStudent = await seedRider(otherSection, 'IN-6B');

    await StudentGuardian.create({
      studentId: myStudent._id, guardianProfileId: parentProfileId, relation: 'FATHER',
    });
  });

  await inNvmp(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    nvmpStudent = await seedRider(section, 'NV-6A');
  });
});

describe('1. a teacher reaches only their own sections', () => {
  it('sees the bus of a student they teach', async () => {
    const bus = await inOak(() =>
      transport.getOwnBus(actorFor('TEACHER', teacherId), myStudent._id.toString()));
    expect(bus.route.name).toBe('Route IN-6A');
    expect(bus.stop.name).toBe('Main Gate');
  });

  it('is refused a student in a colleague section', async () => {
    await expect(
      inOak(() => transport.getOwnBus(actorFor('TEACHER', teacherId), otherStudent._id.toString())),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a teacher assigned to nothing reaches no one', async () => {
    await expect(
      inOak(() => transport.getOwnBus(actorFor('TEACHER'), myStudent._id.toString())),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('must name the student — it does not answer with an arbitrary one', async () => {
    // "My bus" has no implicit subject for a teacher; defaulting to the first
    // student of a section would answer a question nobody asked.
    await expect(
      inOak(() => transport.getOwnBus(actorFor('TEACHER', teacherId), undefined)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cannot list the route catalogue, which stays a transport.read surface', () => {
    expect(canReach('TEACHER', 'transport.read')).toBe(false);
    expect(canReach('TEACHER', 'transport.manage')).toBe(false);
  });
});

describe('4. students and parents keep the access they had', () => {
  it('a student sees their own bus with no query parameter', async () => {
    const bus = await inOak(() => transport.getOwnBus(actorFor('STUDENT', studentProfileId)));
    expect(bus.route.name).toBe('Route IN-6A');
  });

  it('a student is refused another student bus', async () => {
    await expect(
      inOak(() => transport.getOwnBus(actorFor('STUDENT', studentProfileId), otherStudent._id.toString())),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a parent sees their child bus', async () => {
    const bus = await inOak(() => transport.getOwnBus(actorFor('PARENT', parentProfileId)));
    expect(bus.route.name).toBe('Route IN-6A');
  });

  it('a parent is refused a child who is not theirs', async () => {
    await expect(
      inOak(() => transport.getOwnBus(actorFor('PARENT', parentProfileId), otherStudent._id.toString())),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('5. roles with no transport grant get no one else data', () => {
  it.each(['FINANCE', 'LIBRARIAN', 'WARDEN', 'PRINCIPAL'])(
    '%s cannot read a student bus by id', async (roleKey) => {
      expect(permsOf(roleKey)['transport.read']).toBeUndefined();
      await expect(
        inOak(() => transport.getOwnBus(actorFor(roleKey), myStudent._id.toString())),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

  it('the driver name and phone are not reachable by an unentitled role', async () => {
    await expect(
      inOak(() => transport.getOwnBus(actorFor('LIBRARIAN'), myStudent._id.toString())),
    ).rejects.toThrow(/not authorized/i);
  });
});

describe('2 & 3. school boundaries', () => {
  it('a School Admin reads a bus in their own school', async () => {
    expect(permsOf('ADMIN')['transport.read']).toBe('ALL');
    const bus = await inOak(() =>
      transport.getOwnBus(actorFor('ADMIN'), myStudent._id.toString()));
    expect(bus.route.name).toBe('Route IN-6A');
  });

  it('a School Admin is refused another school student', async () => {
    // BusEnrollment is tenant-scoped, so the row is simply not there.
    const bus = await inOak(() =>
      transport.getOwnBus(actorFor('ADMIN'), nvmpStudent._id.toString()));
    expect(bus).toBeNull();
  });

  it('the other school admin sees their own student', async () => {
    const bus = await inNvmp(() =>
      transport.getOwnBus(actorFor('ADMIN'), nvmpStudent._id.toString()));
    expect(bus.route.name).toBe('Route NV-6A');
  });

  it('a Super Admin acting on a school reads that school', async () => {
    const bus = await inOak(() =>
      transport.getOwnBus(actorFor('SUPER_ADMIN'), myStudent._id.toString()));
    expect(bus.route.name).toBe('Route IN-6A');
  });

  it('route and stop management stays with the transport grant holders', () => {
    for (const roleKey of ['ADMIN', 'SUPER_ADMIN']) {
      expect(canReach(roleKey, 'transport.read'), roleKey).toBe(true);
      expect(canReach(roleKey, 'transport.manage'), roleKey).toBe(true);
    }
    for (const roleKey of ['TEACHER', 'STUDENT', 'PARENT', 'PRINCIPAL', 'WARDEN']) {
      expect(canReach(roleKey, 'transport.manage'), roleKey).toBe(false);
    }
  });
});

describe('6. the class-level roster a teacher actually needs', () => {
  /**
   * Knowing who goes home on which bus is a question about a whole class at
   * the last bell, not about one child at a time. The roster answers it — and
   * takes its authorization from the same place the single lookup does, so it
   * cannot become a wider door than getOwnBus.
   */
  it('lists the riders of the sections the teacher teaches', async () => {
    const rows = await inOak(() => transport.listTransportRoster(actorFor('TEACHER', teacherId)));

    expect(rows.map((r) => r.admissionNo)).toEqual(['IN-6A']);
    expect(rows[0].route.name).toBe('Route IN-6A');
    expect(rows[0].stop.name).toBe('Main Gate');
    expect(rows[0].status).toBe('ENROLLED');
  });

  it('never includes a colleague section, even when that section is asked for', async () => {
    const rows = await inOak(() => transport.listTransportRoster(
      actorFor('TEACHER', teacherId),
      { sectionId: otherSection._id.toString() },
    ));
    expect(rows).toEqual([]);
  });

  it('a teacher assigned to nothing gets an empty roster, not the school', async () => {
    expect(await inOak(() => transport.listTransportRoster(actorFor('TEACHER')))).toEqual([]);
  });

  it('a role with no transport grant and no students reaches nobody', async () => {
    expect(await inOak(() => transport.listTransportRoster(actorFor('LIBRARIAN')))).toEqual([]);
  });

  it('an admin sees the school, because the permission says so', async () => {
    const rows = await inOak(() => transport.listTransportRoster(actorFor('ADMIN')));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('says so plainly when a student does not travel by bus', async () => {
    // A walker is a real answer, not a missing record.
    const walker = await inOak(async () => {
      const student = await Student.create({ admissionNo: 'IN-6W', firstName: 'Walks', lastName: 'Home' });
      await Enrollment.create({
        studentId: student._id, sectionId: mySection._id,
        academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
      });
      return student;
    });

    const rows = await inOak(() => transport.listTransportRoster(actorFor('TEACHER', teacherId)));
    const row = rows.find((r) => r.studentId === walker._id.toString());
    expect(row.status).toBe('NOT_ENROLLED');
    expect(row.route).toBeNull();
  });
});
