import { TransportRoute, TransportStop, BusEnrollment } from '../../models/transport.model.js';
import { Student } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { Enrollment } from '../../models/student.model.js';
import { getOwnStudentId, getGuardianStudentIds, getTeacherSectionIds } from '../../utils/scope.js';
import { insertRows, rowError } from '../../utils/csvImport.js';

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
