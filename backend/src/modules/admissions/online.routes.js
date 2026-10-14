import { Router, raw } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { numFromEnv } from '../../config/env.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import { assertObjectId } from '../ops/common.js';
import * as online from './online.service.js';

/**
 * @swagger
 * tags:
 *   name: OnlineAdmission
 *   description: The public, per-school online admission form (no sign-in, no fee), document upload, and status check by reference number plus phone OTP; and the admissions team's list of online applications
 */

const limiter = (name, max, windowMs, message) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  // Per address and per school, so one school's form being hammered does not close another's.
  keyGenerator: (req) => `adm:${name}:${req.ip}|${String(req.params?.school ?? '').toLowerCase()}`,
  handler: (_req, res) => sendError(res, message, 429, [], 'RATE_LIMITED'),
});

const formLimiter = limiter('form', numFromEnv('RATE_LIMIT_ADMISSION_FORM_MAX', 120), 15 * 60_000, 'Too many requests, please try again later.');
const fileLimiter = limiter('file', numFromEnv('RATE_LIMIT_ADMISSION_FILE_MAX', 20), 15 * 60_000, 'Too many uploads, please wait a few minutes.');
const submitLimiter = limiter('submit', numFromEnv('RATE_LIMIT_ADMISSION_SUBMIT_MAX', 5), 60 * 60_000, 'Too many applications from this connection. Please try again later or contact the school.');
const statusLimiter = limiter('status', numFromEnv('RATE_LIMIT_ADMISSION_STATUS_MAX', 20), 15 * 60_000, 'Too many status checks, please try again later.');

/** Resolves the school in the URL and runs the rest of the request inside it. */
const inSchool = asyncHandler(async (req, _res, next) => {
  const school = await online.resolvePublicSchool(req.params.school);
  req.publicSchool = school;
  // The same pattern authenticate uses: everything after this runs pinned to the school.
  return runWithTenant(school.slug, next);
});

const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const publicAdmissionRouter = Router({ mergeParams: true });
publicAdmissionRouter.get('/:school/form', formLimiter, inSchool, ok((r) => online.formConfig(r.publicSchool)));
publicAdmissionRouter.post(
  '/:school/files', fileLimiter, inSchool,
  raw({ type: () => true, limit: online.maxDocBytes() + 1024 }),
  ok((r) => online.storeDocument(r.publicSchool, { rawName: r.headers['x-filename'], body: r.body }), 'File uploaded', 201),
);
publicAdmissionRouter.post('/:school/applications', submitLimiter, inSchool, ok((r) => online.submitApplication(r.publicSchool, r.body, { ip: r.ip }), 'Application received', 201));
publicAdmissionRouter.post('/:school/status/code', statusLimiter, inSchool, ok((r) => online.requestStatusCode(r.body), 'Code requested'));
publicAdmissionRouter.post('/:school/status', statusLimiter, inSchool, ok((r) => online.checkStatus(r.body)));

/** The admissions team's view of online applications (the CRM lead is the working record). */
export const onlineApplicationsRouter = Router();
onlineApplicationsRouter.use(authenticate, requireFeature('onlineAdmission'));
onlineApplicationsRouter.get('/', requirePermission('admissions.read'), ok((r) => online.listApplications(r.query)));
onlineApplicationsRouter.get('/:id', requirePermission('admissions.read'), ok((r) => online.getApplication(assertObjectId(r.params.id))));
