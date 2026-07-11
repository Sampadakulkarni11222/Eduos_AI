import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './dashboard.service.js';

/**
 * GET /dashboard/owner
 * Allowed roles: OWNER
 */
export const ownerDashboard = asyncHandler(async (req, res) => {
  const data = await service.getOwnerDashboard();
  sendSuccess(res, data, 'Owner dashboard fetched');
});

/**
 * GET /dashboard/admin
 * Allowed roles: ADMIN, OWNER
 */
export const adminDashboard = asyncHandler(async (req, res) => {
  const data = await service.getAdminDashboard();
  sendSuccess(res, data, 'Admin dashboard fetched');
});

/**
 * GET /dashboard/finance
 * Allowed roles: FINANCE, ADMIN, OWNER
 */
export const financeDashboard = asyncHandler(async (req, res) => {
  const data = await service.getFinanceDashboard();
  sendSuccess(res, data, 'Finance dashboard fetched');
});

/**
 * GET /dashboard/teacher
 * Allowed roles: TEACHER — data scoped to the requesting teacher's classes
 */
export const teacherDashboard = asyncHandler(async (req, res) => {
  const data = await service.getTeacherDashboard(req.actor.profileId);
  sendSuccess(res, data, 'Teacher dashboard fetched');
});

/**
 * GET /dashboard/student
 * Allowed roles: STUDENT — data scoped to the requesting student's own record
 */
export const studentDashboard = asyncHandler(async (req, res) => {
  const data = await service.getStudentDashboard(req.actor.profileId);
  sendSuccess(res, data, 'Student dashboard fetched');
});

/**
 * GET /dashboard/parent
 * Allowed roles: PARENT — data scoped to the requesting parent's linked children
 */
export const parentDashboard = asyncHandler(async (req, res) => {
  const data = await service.getParentDashboard(req.actor.profileId);
  sendSuccess(res, data, 'Parent dashboard fetched');
});

/**
 * GET /dashboard/warden
 * Allowed roles: WARDEN, ADMIN, OWNER
 */
export const wardenDashboard = asyncHandler(async (req, res) => {
  const data = await service.getWardenDashboard();
  sendSuccess(res, data, 'Warden dashboard fetched');
});

/**
 * GET /dashboard/librarian
 * Allowed roles: LIBRARIAN, ADMIN, OWNER
 */
export const librarianDashboard = asyncHandler(async (req, res) => {
  const data = await service.getLibrarianDashboard();
  sendSuccess(res, data, 'Librarian dashboard fetched');
});
