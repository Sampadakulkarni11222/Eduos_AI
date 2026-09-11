import { TransportRoute, TransportStop, BusEnrollment } from '../../models/transport.model.js';
import { Student } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { Enrollment } from '../../models/student.model.js';
import { getOwnStudentId, getGuardianStudentIds, getTeacherSectionIds } from '../../utils/scope.js';
import { insertRows, rowError } from '../../utils/csvImport.js';

/* ── Routes, stops and bus enrolment ─────────────────────────
   Moved here from transport.controller.js, which used to write the models
   directly, so the REST routes and the assistant's transport tools share one
   implementation instead of the tools having to copy the controller's. The
   behaviour is unchanged: same validation, same defaults, same upsert. */

/** Active routes with their stop and enrolment counts. */
export async function listRoutes() {
  const routes = await TransportRoute.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean();
  return Promise.all(routes.map(async (route) => {
    const [stopsCount, enrollmentsCount] = await Promise.all([
      TransportStop.countDocuments({ routeId: route._id }),
      BusEnrollment.countDocuments({ routeId: route._id }),
    ]);
    return {
      id: route._id,
      name: route.name,
      operatorName: route.operatorName,
      vehicleNo: route.vehicleNo,
      driverName: route.driverName,
      driverPhone: route.driverPhone,
      stopsCount,
      enrollmentsCount,
    };
  }));
}

/** A route's stops, in the order the bus reaches them. */
export async function listStops(routeId) {
  const stops = await TransportStop.find({ routeId }).sort({ sequenceNo: 1 }).lean();
  return stops.map((stop) => ({
    id: stop._id,
    routeId: stop.routeId,
    name: stop.name,
    sequenceNo: stop.sequenceNo,
    etaMinutesFromStart: stop.etaMinutesFromStart,
  }));
}

export async function createRoute({ name, operatorName, vehicleNo, driverName, driverPhone } = {}) {
  if (!name) throw new AppError('Route name is required', 400);
  return TransportRoute.create({ name, operatorName, vehicleNo, driverName, driverPhone });
}

/**
 * One route, by id, in the acting school — or a 404.
 *
 * The tenant plugin on TransportRoute confines the lookup, so another school's
 * route id is "not found" here exactly as it is everywhere else.
 */
export async function getRoute(routeId) {
  const route = await TransportRoute.findById(routeId).select('name vehicleNo status').lean();
  if (!route) throw new AppError('Route not found', 404);
  return { id: String(route._id), name: route.name, vehicleNo: route.vehicleNo ?? null, status: route.status };
}

export async function createStop({ routeId, name, sequenceNo, etaMinutesFromStart } = {}) {
  if (!routeId || !name || sequenceNo === undefined) {
    throw new AppError('routeId, name, and sequenceNo are required', 400);
  }
  // A stop used to be created against whatever routeId arrived, so a stop could
  // point at another school's route, or at none. The route must exist here.
  await getRoute(routeId);
  return TransportStop.create({ routeId, name, sequenceNo, etaMinutesFromStart: etaMinutesFromStart || 0 });
}

/**
 * Checks that a bus enrolment names real things in the acting school, and
 * resolves the academic year (the current one when none is named).
 *
 * The upsert below used to accept any ids: a student could be put on another
 * school's route, on a stop that belongs to a different route, or on a year
 * that does not exist, and the row would be written. Every id is now looked up
 * through the tenant-scoped models, and the stop must be on the route.
 *
 * Returns names as well as ids, so a caller can describe the enrolment before
 * it is made.
 */
export async function resolveEnrollment({ studentId, routeId, stopId, academicYearId } = {}) {
  let targetYearId = academicYearId;
  if (!targetYearId) {
    const currentYear = await AcademicYear.findOne({ isCurrent: true });
    targetYearId = currentYear?._id;
  }

  if (!studentId || !routeId || !stopId || !targetYearId) {
    throw new AppError('studentId, routeId, stopId, and academicYearId are required', 400);
  }

  const [student, route, stop, year] = await Promise.all([
    Student.findOne({ _id: studentId, deletedAt: null }).select('firstName lastName').lean(),
    TransportRoute.findById(routeId).select('name').lean(),
    TransportStop.findById(stopId).select('routeId name').lean(),
    AcademicYear.findById(targetYearId).select('name').lean(),
  ]);
  if (!student) throw new AppError('Student not found', 404);
  if (!route) throw new AppError('Route not found', 404);
  if (!stop) throw new AppError('Stop not found', 404);
  if (String(stop.routeId) !== String(routeId)) {
    throw new AppError(`"${stop.name}" is not a stop on route "${route.name}"`, 400, [], 'STOP_NOT_ON_ROUTE');
  }
  if (!year) throw new AppError('Academic year not found', 404);

  return {
    studentId: String(student._id),
    studentName: `${student.firstName} ${student.lastName ?? ''}`.trim(),
    routeId: String(route._id),
    routeName: route.name,
    stopId: String(stop._id),
    stopName: stop.name,
    academicYearId: String(year._id),
    academicYearName: year.name,
  };
}

/**
 * Puts a student on a route and stop for an academic year.
 *
 * One enrolment per student per year: enrolling again moves them rather than
 * adding a second row. Defaults to the current academic year when none is named.
 */
export async function enrollStudent({ studentId, routeId, stopId, academicYearId, direction } = {}) {
  const target = await resolveEnrollment({ studentId, routeId, stopId, academicYearId });
  return BusEnrollment.findOneAndUpdate(
    { studentId: target.studentId, academicYearId: target.academicYearId },
    { routeId: target.routeId, stopId: target.stopId, direction: direction || 'BOTH' },
    { upsert: true, new: true },
  );
}

/**
 * The student id(s) this actor may query a bus assignment for.
 *
 * `null` means unrestricted — within the acting school, which the tenant
 * plugin on BusEnrollment settles regardless.
 *
 * This endpoint carries no transport.* permission by design (a family has
 * none, and still has to see its own bus), so the entitlement is resolved
 * here. It used to return `null` for every role that was not a student or a
 * parent, which read as "staff, unrestricted" — and made
 * `GET /transport/my-bus?studentId=<anyone>` hand any signed-in teacher,
 * librarian, warden or finance user that student's route, stop, vehicle and
 * the driver's name and phone number.
 */
async function resolveOwnStudentIds(actor) {
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    return id ? [id] : [];
  }
  if (actor.roleKey === 'PARENT') {
    return getGuardianStudentIds(actor.profileId);
  }
  if (actor.roleKey === 'TEACHER') {
    // Reuses the section assignment the rest of the app scopes teachers by —
    // class teacher of, or holding a subject offering in. No transport-side
    // copy of who teaches whom.
    const sectionIds = await getTeacherSectionIds(actor.profileId);
    if (!sectionIds.length) return [];
    const enrolments = await Enrollment.find({
      sectionId: { $in: sectionIds }, status: 'ACTIVE',
    }).select('studentId').lean();
    return [...new Set(enrolments.map((e) => e.studentId.toString()))];
  }
  // Unrestricted only for an actor the permission system says may read the
  // school's transport data. Anyone else — finance, librarian, warden,
  // principal — holds no transport grant and gets no one else's assignment.
  if (actor.permissions?.['transport.read']) return null;
  return [];
}

/**
 * Looks up a student's active bus/route/stop assignment. STUDENT/PARENT
 * actors are pinned to their own child(ren) — an explicit studentId in the
 * query is only honoured if it's actually theirs; staff roles may query any
 * studentId.
 */
export async function getOwnBus(actor, studentId) {
  const ownIds = await resolveOwnStudentIds(actor);
  let targetId = studentId;

  if (ownIds !== null) {
    if (studentId && !ownIds.includes(String(studentId))) {
      throw new AppError('You are not authorized to view this bus assignment', 403);
    }
    // "My bus" means something only to the family it belongs to, so only they
    // get an implicit subject. A teacher is entitled to a whole section, and
    // defaulting to the first of them would answer a question nobody asked.
    const ownsSubject = actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT';
    targetId = studentId || (ownsSubject ? ownIds[0] : undefined);
  }
  if (!targetId) throw new AppError('studentId query param is required', 400);

  const enrollment = await BusEnrollment.findOne({ studentId: targetId })
    .populate('routeId')
    .populate('stopId')
    .sort({ createdAt: -1 })
    .lean();

  if (!enrollment || !enrollment.routeId || !enrollment.stopId) return null;

  return {
    id: enrollment._id,
    studentId: enrollment.studentId,
    direction: enrollment.direction,
    route: {
      id: enrollment.routeId._id,
      name: enrollment.routeId.name,
      vehicleNo: enrollment.routeId.vehicleNo,
      driverName: enrollment.routeId.driverName,
      driverPhone: enrollment.routeId.driverPhone,
    },
    stop: {
      id: enrollment.stopId._id,
      name: enrollment.stopId.name,
      etaMinutesFromStart: enrollment.stopId.etaMinutesFromStart,
    },
  };
}

/**
 * Every authorized student's travel arrangements in one read.
 *
 * `getOwnBus` answers about one student at a time, which is right for a family
 * and useless for a teacher: knowing who goes home on which bus is a
 * class-level question — it is asked when the last bell rings, about thirty
 * children at once, not one by one.
 *
 * Authorization is not re-invented here. The same `resolveOwnStudentIds` that
 * gates the single lookup decides which students are in reach, so a teacher
 * sees their own sections, a family sees their own children, and a role with
 * no transport grant and no link to a student sees nothing. A `sectionId` may
 * narrow that set; it can never widen it.
 */
export async function listTransportRoster(actor, { sectionId } = {}) {
  const ownIds = await resolveOwnStudentIds(actor);

  const enrolmentFilter = { status: 'ACTIVE' };
  if (sectionId) enrolmentFilter.sectionId = sectionId;
  if (ownIds !== null) {
    if (!ownIds.length) return [];
    enrolmentFilter.studentId = { $in: ownIds };
  }

  const enrolments = await Enrollment.find(enrolmentFilter)
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .populate({ path: 'sectionId', select: 'name', populate: { path: 'gradeId', select: 'name' } })
    .sort({ rollNo: 1 })
    .lean();

  if (!enrolments.length) return [];

  const studentIds = enrolments.map((e) => e.studentId?._id).filter(Boolean);
  const busEnrolments = await BusEnrollment.find({ studentId: { $in: studentIds } })
    .populate('routeId')
    .populate('stopId')
    .sort({ createdAt: -1 })
    .lean();

  // Newest first, so the first entry seen for a student is their current one.
  const busByStudent = new Map();
  for (const b of busEnrolments) {
    const key = String(b.studentId);
    if (!busByStudent.has(key)) busByStudent.set(key, b);
  }

  return enrolments
    .filter((e) => e.studentId)
    .map((e) => {
      const bus = busByStudent.get(String(e.studentId._id));
      const section = e.sectionId;
      return {
        studentId: String(e.studentId._id),
        studentName: `${e.studentId.firstName} ${e.studentId.lastName ?? ''}`.trim(),
        admissionNo: e.studentId.admissionNo ?? null,
        rollNo: e.rollNo ?? null,
        class: section ? [section.gradeId?.name, section.name].filter(Boolean).join(' - ') : null,
        sectionId: section ? String(section._id) : null,
        // Null means the student does not travel by school transport, which is
        // a real answer and not a missing record.
        route: bus?.routeId ? { id: String(bus.routeId._id), name: bus.routeId.name, vehicleNo: bus.routeId.vehicleNo ?? null } : null,
        stop: bus?.stopId ? { id: String(bus.stopId._id), name: bus.stopId.name, etaMinutesFromStart: bus.stopId.etaMinutesFromStart ?? null } : null,
        direction: bus?.direction ?? null,
        status: bus ? 'ENROLLED' : 'NOT_ENROLLED',
      };
    });
}

export async function bulkCreateRoutes(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const name = row.name?.trim();
    if (!name) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'name',
        problem: 'is required',
        suggestion: 'the route name, e.g. "Route 4 - Kothrud"',
      }));
      continue;
    }
    docs.push({
      rowNo,
      name,
      operatorName: row.operatorname?.trim() || undefined,
      vehicleNo: row.vehicleno?.trim() || undefined,
      driverName: row.drivername?.trim() || undefined,
      driverPhone: row.driverphone?.trim() || undefined,
    });
  }

  const inserted = await insertRows(
    TransportRoute,
    docs.map(({ rowNo, ...doc }) => ({ rowNo, doc })),
    { dupField: 'name', dupLabel: 'name' },
  );

  return {
    imported: results.imported + inserted.imported,
    failed: results.failed + inserted.failed,
    errors: [...results.errors, ...inserted.errors],
  };
}

export async function bulkCreateStops(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  const routeNames = rows.map((r) => r.routename?.trim()).filter(Boolean);
  const routes = await TransportRoute.find({ name: { $in: routeNames } }).select('_id name').lean();
  const routeIdByName = new Map(routes.map((r) => [r.name.toLowerCase(), r._id]));

  const docs = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const routeName = row.routename?.trim();
    const name = row.name?.trim();
    const sequenceNo = Number(row.sequenceno);

    if (!routeName || !name || !Number.isFinite(sequenceNo)) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !routeName ? 'routeName' : !name ? 'name' : 'sequenceNo',
        problem: 'is required',
        suggestion: 'sequenceNo is the stop order along the route, starting at 1',
      }));
      continue;
    }
    const routeId = routeIdByName.get(routeName.toLowerCase());
    if (!routeId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'routeName',
        value: routeName,
        problem: 'does not match any route in this school',
        suggestion: 'create the route first, or correct the spelling',
      }));
      continue;
    }
    const etaMinutesFromStart = row.etaminutesfromstart?.trim() ? Number(row.etaminutesfromstart) : 0;
    docs.push({ rowNo, routeId, name, sequenceNo, etaMinutesFromStart });
  }

  const inserted = await insertRows(
    TransportStop,
    docs.map(({ rowNo, ...doc }) => ({ rowNo, doc })),
    { dupField: 'sequenceNo', dupLabel: 'sequenceNo' },
  );

  return {
    imported: results.imported + inserted.imported,
    failed: results.failed + inserted.failed,
    errors: [...results.errors, ...inserted.errors],
  };
}

/**
 * Bulk-enrolls students on bus routes from CSV rows: admissionNo, routeName,
 * stopName, direction. Each row does its own upsert (mirroring
 * enrollStudent's findOneAndUpdate) since a student can only have one
 * enrollment per academic year.
 */
export async function bulkEnrollStudents(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  const currentYear = await AcademicYear.findOne({ isCurrent: true });
  if (!currentYear) {
    return { imported: 0, failed: rows.length, errors: [{ row: 2, error: 'No current academic year is configured' }] };
  }

  const admissionNos = rows.map((r) => r.admissionno?.trim()).filter(Boolean);
  const students = await Student.find({ admissionNo: { $in: admissionNos }, deletedAt: null }).select('_id admissionNo').lean();
  const studentIdByAdmissionNo = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s._id]));

  const routeNames = rows.map((r) => r.routename?.trim()).filter(Boolean);
  const routes = await TransportRoute.find({ name: { $in: routeNames } }).select('_id name').lean();
  const routeIdByName = new Map(routes.map((r) => [r.name.toLowerCase(), r._id]));

  const VALID_DIRECTIONS = new Set(['BOTH', 'PICKUP', 'DROP']);

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const admissionNo = row.admissionno?.trim();
    const routeName = row.routename?.trim();
    const stopName = row.stopname?.trim();
    const direction = row.direction?.trim().toUpperCase() || 'BOTH';

    if (!admissionNo || !routeName || !stopName) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: !admissionNo ? 'admissionNo' : !routeName ? 'routeName' : 'stopName',
        problem: 'is required',
        suggestion: 'each row names the student, their route and the stop they board at',
      }));
      continue;
    }
    if (!VALID_DIRECTIONS.has(direction)) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'direction',
        value: row.direction,
        problem: 'is not a travel direction',
        suggestion: 'use one of: BOTH, PICKUP, DROP',
      }));
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'admissionNo',
        value: admissionNo,
        problem: 'does not match any student in this school',
        suggestion: 'check the admission number, or import the student first',
      }));
      continue;
    }

    const routeId = routeIdByName.get(routeName.toLowerCase());
    if (!routeId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'routeName',
        value: routeName,
        problem: 'does not match any route in this school',
        suggestion: 'create the route first, or correct the spelling',
      }));
      continue;
    }

    // Stop names aren't globally unique, only within a route.
    const stop = await TransportStop.findOne({ routeId, name: stopName }).select('_id').lean();
    if (!stop) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'stopName',
        value: stopName,
        problem: 'is not a stop on that route',
        suggestion: 'add the stop to the route first, or correct the spelling',
      }));
      continue;
    }

    try {
      await BusEnrollment.findOneAndUpdate(
        { studentId, academicYearId: currentYear._id },
        { routeId, stopId: stop._id, direction },
        { upsert: true, new: true },
      );
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push(rowError(rowNo, { problem: err.message }));
    }
  }

  return results;
}
