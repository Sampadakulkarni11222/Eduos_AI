import { TransportRoute, TransportStop, BusEnrollment } from '../../models/transport.model.js';
import { Student } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';

/** Resolves the student id(s) this actor may query bus assignments for (empty for staff roles — unrestricted). */
async function resolveOwnStudentIds(actor) {
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    return id ? [id] : [];
  }
  if (actor.roleKey === 'PARENT') {
    return getGuardianStudentIds(actor.profileId);
  }
  return null; // staff roles: unrestricted
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
    targetId = studentId || ownIds[0];
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

export async function bulkCreateRoutes(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const name = row.name?.trim();
    if (!name) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'name is required' });
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

  const CHUNK_SIZE = 100;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    try {
      await TransportRoute.insertMany(chunk.map(({ rowNo, ...doc }) => doc));
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach((c) => results.errors.push({ row: c.rowNo, error: err.message }));
    }
  }

  return results;
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
      results.errors.push({ row: rowNo, error: 'routeName, name, and a numeric sequenceNo are required' });
      continue;
    }
    const routeId = routeIdByName.get(routeName.toLowerCase());
    if (!routeId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No route found named "${routeName}"` });
      continue;
    }
    const etaMinutesFromStart = row.etaminutesfromstart?.trim() ? Number(row.etaminutesfromstart) : 0;
    docs.push({ rowNo, routeId, name, sequenceNo, etaMinutesFromStart });
  }

  const CHUNK_SIZE = 100;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    try {
      await TransportStop.insertMany(chunk.map(({ rowNo, ...doc }) => doc));
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach((c) => {
        const msg = err.code === 11000 ? `Sequence ${c.sequenceNo} already used on this route` : err.message;
        results.errors.push({ row: c.rowNo, error: msg });
      });
    }
  }

  return results;
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
      results.errors.push({ row: rowNo, error: 'admissionNo, routeName, and stopName are required' });
      continue;
    }
    if (!VALID_DIRECTIONS.has(direction)) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid direction "${row.direction}" (expected BOTH, PICKUP, or DROP)` });
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No student found with admissionNo "${admissionNo}"` });
      continue;
    }

    const routeId = routeIdByName.get(routeName.toLowerCase());
    if (!routeId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No route found named "${routeName}"` });
      continue;
    }

    // Stop names aren't globally unique, only within a route.
    const stop = await TransportStop.findOne({ routeId, name: stopName }).select('_id').lean();
    if (!stop) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No stop named "${stopName}" found on route "${routeName}"` });
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
      results.errors.push({ row: rowNo, error: err.message });
    }
  }

  return results;
}
