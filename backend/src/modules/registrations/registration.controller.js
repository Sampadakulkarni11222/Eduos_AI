import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './registration.service.js';

export const listAvailable = asyncHandler(async (req, res) => {
  const electives = await service.listAvailable(req.actor);
  sendSuccess(res, electives, 'Available electives fetched');
});

export const listMine = asyncHandler(async (req, res) => {
  const registrations = await service.listMine(req.actor);
  sendSuccess(res, registrations, 'Your registrations fetched');
});

export const register = asyncHandler(async (req, res) => {
  const registration = await service.register(req.actor, req.body?.subjectOfferingId);
  sendSuccess(res, registration, 'Registration submitted for approval', 201);
});

export const withdraw = asyncHandler(async (req, res) => {
  const registration = await service.withdraw(req.actor, req.params.id);
  sendSuccess(res, registration, 'Registration withdrawn');
});

export const listForReview = asyncHandler(async (req, res) => {
  const registrations = await service.listForReview(req.actor, req.scope, {
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  sendSuccess(res, registrations, 'Registrations fetched');
});

export const decide = asyncHandler(async (req, res) => {
  const registration = await service.decide(req.actor, req.scope, req.params.id, {
    status: req.body?.status,
    note: req.body?.note,
  });
  sendSuccess(res, registration, `Registration ${req.body?.status?.toLowerCase?.() ?? 'updated'}`);
});
