import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as roleService from './role.service.js';

export const list = asyncHandler(async (_req, res) => {
  const roles = await roleService.list();
  sendSuccess(res, roles, 'Roles fetched');
});

export const getById = asyncHandler(async (req, res) => {
  const role = await roleService.getById(req.params.id);
  sendSuccess(res, role, 'Role fetched');
});

export const create = asyncHandler(async (req, res) => {
  const role = await roleService.create(req.body);
  sendSuccess(res, role, 'Role created', 201);
});

export const update = asyncHandler(async (req, res) => {
  const role = await roleService.update(req.params.id, req.body, req.actor);
  sendSuccess(res, role, 'Role updated');
});

export const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id, req.actor);
  sendSuccess(res, null, 'Role deleted');
});

export const assignPermission = asyncHandler(async (req, res) => {
  const role = await roleService.assignPermission(req.params.id, req.body, req.actor);
  sendSuccess(res, role, 'Permission assigned to role');
});

export const revokePermission = asyncHandler(async (req, res) => {
  const role = await roleService.revokePermission(req.params.id, req.params.key, req.actor);
  sendSuccess(res, role, 'Permission revoked from role');
});
