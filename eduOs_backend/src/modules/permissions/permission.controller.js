import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as permissionService from './permission.service.js';

export const list = asyncHandler(async (_req, res) => {
  const permissions = await permissionService.list();
  sendSuccess(res, permissions, 'Permissions fetched');
});

export const create = asyncHandler(async (req, res) => {
  const permission = await permissionService.create(req.body);
  sendSuccess(res, permission, 'Permission created', 201);
});

export const update = asyncHandler(async (req, res) => {
  const permission = await permissionService.update(req.params.id, req.body);
  sendSuccess(res, permission, 'Permission updated');
});

export const remove = asyncHandler(async (req, res) => {
  await permissionService.remove(req.params.id);
  sendSuccess(res, null, 'Permission deleted');
});
