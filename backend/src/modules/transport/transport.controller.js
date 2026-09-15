import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './transport.service.js';

export const listRoutes = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listRoutes(), 'Routes fetched successfully');
});

export const listStops = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listStops(req.params.routeId), 'Stops fetched successfully');
});

export const myBus = asyncHandler(async (req, res) => {
  const bus = await service.getOwnBus(req.actor, req.query.studentId);
  sendSuccess(res, bus, bus ? 'Bus enrollment fetched successfully' : 'No bus assigned');
});

export const createRoute = asyncHandler(async (req, res) => {
  const route = await service.createRoute(req.body);
  sendSuccess(res, { id: route._id }, 'Route created successfully', 201);
});

export const updateRoute = asyncHandler(async (req, res) => {
  const route = await service.updateRoute(req.actor, req.params.routeId, req.body);
  sendSuccess(res, { id: route._id, fareAmountPaise: route.fareAmountPaise ?? 0 }, 'Route updated');
});

export const bulkCreateRoutes = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateRoutes(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} routes`, 201);
});

export const createStop = asyncHandler(async (req, res) => {
  const stop = await service.createStop(req.body);
  sendSuccess(res, { id: stop._id }, 'Stop created successfully', 201);
});

export const bulkCreateStops = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateStops(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} stops`, 201);
});

export const enrollStudent = asyncHandler(async (req, res) => {
  const enrollment = await service.enrollStudent(req.body);
  sendSuccess(res, { id: enrollment._id }, 'Student enrolled successfully', 201);
});

export const bulkEnrollStudents = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkEnrollStudents(rows);
  sendSuccess(res, result, `Enrolled ${result.imported} of ${rows.length} students`, 201);
});

/**
 * The class-level view. Deliberately not behind `transport.read`: a teacher
 * holds no transport grant, and the students they may see are decided by the
 * service from their own section assignments.
 */
export const roster = asyncHandler(async (req, res) => {
  const rows = await service.listTransportRoster(req.actor, { sectionId: req.query.sectionId });
  sendSuccess(res, rows, 'Transport roster fetched');
});

/* ── Route requests ───────────────────────────────────────── */

/**
 * The routes a student may choose from. Self-service, like /my-bus: students
 * hold no transport.* grant, and the service answers only for the student the
 * session belongs to.
 */
export const routesForStudent = asyncHandler(async (req, res) => {
  const data = await service.listRoutesForStudent(req.actor);
  sendSuccess(res, data, 'Routes fetched');
});

export const requestRoute = asyncHandler(async (req, res) => {
  const request = await service.requestRoute(req.actor, {
    routeId: req.body.routeId,
    stopId: req.body.stopId,
    direction: req.body.direction,
  });
  sendSuccess(res, request, 'Transport request submitted for approval', 201);
});

export const listMyTransportRequests = asyncHandler(async (req, res) => {
  const requests = await service.listMyTransportRequests(req.actor);
  sendSuccess(res, requests, 'Your transport requests fetched');
});

export const cancelTransportRequest = asyncHandler(async (req, res) => {
  const request = await service.cancelTransportRequest(req.actor, req.params.id);
  sendSuccess(res, request, 'Transport request cancelled');
});

export const listTransportRequestsForReview = asyncHandler(async (req, res) => {
  const page = await service.listTransportRequestsForReview(req.actor, req.scope, req.query);
  sendSuccess(res, page, 'Transport requests fetched');
});

export const decideTransportRequest = asyncHandler(async (req, res) => {
  const request = await service.decideTransportRequest(req.actor, req.params.id, {
    status: req.body.status,
    note: req.body.note,
  });
  sendSuccess(res, request, `Transport request ${request.status.toLowerCase()}`);
});
