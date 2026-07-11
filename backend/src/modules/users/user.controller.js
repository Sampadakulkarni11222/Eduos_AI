import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './user.service.js';

export const list = asyncHandler(async (req, res) => {
  const { search, status, roleKey } = req.query;
  const users = await service.listUsers({ search, status, roleKey });
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
