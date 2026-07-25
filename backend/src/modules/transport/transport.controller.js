import { TransportRoute, TransportStop, BusEnrollment } from '../../models/transport.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './transport.service.js';

export const listRoutes = asyncHandler(async (req, res) => {
  const routes = await TransportRoute.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean();
  
  // Also get stop counts and enrollment counts to match frontend expectations if necessary
  const routesDtos = await Promise.all(routes.map(async (route) => {
    const stopsCount = await TransportStop.countDocuments({ routeId: route._id });
    const enrollmentsCount = await BusEnrollment.countDocuments({ routeId: route._id });
    
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

  sendSuccess(res, routesDtos, 'Routes fetched successfully');
});

export const listStops = asyncHandler(async (req, res) => {
  const { routeId } = req.params;
  
  const stops = await TransportStop.find({ routeId }).sort({ sequenceNo: 1 }).lean();
  
  const stopsDtos = stops.map(stop => ({
    id: stop._id,
    routeId: stop.routeId,
    name: stop.name,
    sequenceNo: stop.sequenceNo,
    etaMinutesFromStart: stop.etaMinutesFromStart
  }));

  sendSuccess(res, stopsDtos, 'Stops fetched successfully');
});

export const myBus = asyncHandler(async (req, res) => {
  const bus = await service.getOwnBus(req.actor, req.query.studentId);
  sendSuccess(res, bus, bus ? 'Bus enrollment fetched successfully' : 'No bus assigned');
});

export const createRoute = asyncHandler(async (req, res) => {
  const { name, operatorName, vehicleNo, driverName, driverPhone } = req.body;
  
  if (!name) {
    throw new AppError('Route name is required', 400);
  }
  
  const route = await TransportRoute.create({
    name,
    operatorName,
    vehicleNo,
    driverName,
    driverPhone
  });
  
  sendSuccess(res, { id: route._id }, 'Route created successfully', 201);
});

export const bulkCreateRoutes = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateRoutes(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} routes`, 201);
});

export const createStop = asyncHandler(async (req, res) => {
  const { routeId, name, sequenceNo, etaMinutesFromStart } = req.body;
  
  if (!routeId || !name || sequenceNo === undefined) {
    throw new AppError('routeId, name, and sequenceNo are required', 400);
  }
  
  const stop = await TransportStop.create({
    routeId,
    name,
    sequenceNo,
    etaMinutesFromStart: etaMinutesFromStart || 0
  });
  
  sendSuccess(res, { id: stop._id }, 'Stop created successfully', 201);
});

export const bulkCreateStops = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateStops(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} stops`, 201);
});

export const enrollStudent = asyncHandler(async (req, res) => {
  const { studentId, routeId, stopId, academicYearId, direction } = req.body;
  
  let targetYearId = academicYearId;
  if (!targetYearId) {
    const currentYear = await AcademicYear.findOne({ isCurrent: true });
    targetYearId = currentYear?._id;
  }
  
  if (!studentId || !routeId || !stopId || !targetYearId) {
    throw new AppError('studentId, routeId, stopId, and academicYearId are required', 400);
  }
  
  const enrollment = await BusEnrollment.findOneAndUpdate(
    { studentId, academicYearId: targetYearId },
    { routeId, stopId, direction: direction || 'BOTH' },
    { upsert: true, new: true }
  );
  
  sendSuccess(res, { id: enrollment._id }, 'Student enrolled successfully', 201);
});

export const bulkEnrollStudents = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkEnrollStudents(rows);
  sendSuccess(res, result, `Enrolled ${result.imported} of ${rows.length} students`, 201);
});
