import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './school.service.js';

export const list = asyncHandler(async (_req, res) => {
  const schools = await service.listSchools();
  sendSuccess(res, schools, 'Schools fetched');
});

export const getById = asyncHandler(async (req, res) => {
  const school = await service.getSchool(req.params.tenantId);
  sendSuccess(res, school, 'School fetched');
});

export const create = asyncHandler(async (req, res) => {
  const result = await service.createSchool(req.body);
  sendSuccess(res, result, 'School created', 201);
});

export const update = asyncHandler(async (req, res) => {
  const school = await service.updateSchool(req.params.tenantId, req.body);
  sendSuccess(res, school, 'School updated');
});

export const listAdmins = asyncHandler(async (req, res) => {
  const admins = await service.listSchoolAdmins(req.params.tenantId);
  sendSuccess(res, admins, 'School Admins fetched');
});

export const publicBySlug = asyncHandler(async (req, res) => {
  const school = await service.getPublicSchool(req.params.slug);
  sendSuccess(res, school, 'School fetched');
});

export const createAdmin = asyncHandler(async (req, res) => {
  const profileId = await service.createSchoolAdmin(req.params.tenantId, req.body);
  const admins = await service.listSchoolAdmins(req.params.tenantId);
  sendSuccess(res, admins.find((a) => a.profileId === profileId), 'School Admin created', 201);
});

export const updateAdmin = asyncHandler(async (req, res) => {
  const admin = await service.updateSchoolAdmin(req.params.tenantId, req.params.profileId, req.body);
  sendSuccess(res, admin, 'School Admin updated');
});
