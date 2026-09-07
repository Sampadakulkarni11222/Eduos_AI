import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as coCurricular from './cocurricular.service.js';
import * as profileEdit from './profileEdit.service.js';
import { EDITABLE_FIELD_LIST } from './profileEdit.service.js';

// ── Co-curricular ───────────────────────────────────────────
export const requestActivity = asyncHandler(async (req, res) => {
  const activity = await coCurricular.request(req.actor, req.body);
  sendSuccess(res, activity, 'Co-curricular request submitted', 201);
});

export const listActivities = asyncHandler(async (req, res) => {
  const activities = await coCurricular.listForStudent(req.actor, req.scope, req.query);
  sendSuccess(res, activities, 'Co-curricular activities fetched');
});

export const listActivityReviews = asyncHandler(async (req, res) => {
  const activities = await coCurricular.listForReview(req.actor, req.scope, req.query);
  sendSuccess(res, activities, 'Co-curricular requests fetched');
});

export const decideActivity = asyncHandler(async (req, res) => {
  const activity = await coCurricular.decide(req.actor, req.scope, req.params.id, req.body);
  sendSuccess(res, activity, `Request ${activity.status.toLowerCase()}`);
});

export const withdrawActivity = asyncHandler(async (req, res) => {
  await coCurricular.withdraw(req.actor, req.params.id);
  sendSuccess(res, null, 'Request withdrawn');
});

// ── Profile edit requests ───────────────────────────────────
export const editableFields = asyncHandler(async (_req, res) => {
  sendSuccess(res, { fields: EDITABLE_FIELD_LIST }, 'Editable profile fields fetched');
});

export const requestProfileEdit = asyncHandler(async (req, res) => {
  const request = await profileEdit.request(req.actor, req.body);
  sendSuccess(res, request, 'Profile edit request submitted', 201);
});

export const listProfileEdits = asyncHandler(async (req, res) => {
  const requests = await profileEdit.listMine(req.actor, req.scope, req.query);
  sendSuccess(res, requests, 'Profile edit requests fetched');
});

export const listProfileEditReviews = asyncHandler(async (req, res) => {
  const requests = await profileEdit.listForReview(req.actor, req.scope, req.query);
  sendSuccess(res, requests, 'Profile edit requests fetched');
});

export const decideProfileEdit = asyncHandler(async (req, res) => {
  const request = await profileEdit.decide(req.actor, req.scope, req.params.id, req.body);
  sendSuccess(res, request, `Request ${request.status.toLowerCase()}`);
});

export const withdrawProfileEdit = asyncHandler(async (req, res) => {
  await profileEdit.withdraw(req.actor, req.params.id);
  sendSuccess(res, null, 'Request withdrawn');
});
