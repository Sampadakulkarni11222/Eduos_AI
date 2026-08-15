import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './user.service.js';

export const list = asyncHandler(async (req, res) => {
  const { search, status, roleKey, sectionId, page, pageSize } = req.query;
  const users = await service.listUsers({ search, status, roleKey, sectionId, page, pageSize });
  sendSuccess(res, users, 'Users fetched');
});

export const getById = asyncHandler(async (req, res) => {
  const user = await service.getUserById(req.params.id);
  sendSuccess(res, user, 'User fetched');
});

export const update = asyncHandler(async (req, res) => {
  const user = await service.updateUser(req.params.id, req.body);
  sendSuccess(res, user, 'User updated');
});

export const create = asyncHandler(async (req, res) => {
  const user = await service.createUser(req.body);
  sendSuccess(res, user, 'User created', 201);
});

export const bulkCreate = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateUsers(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} users`, 201);
});
