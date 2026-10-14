import { describeFeatures, setFeatures } from '../../utils/features.js';
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { School } from '../../models/school.model.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import * as institution from './institution.service.js';
import * as org from './org.service.js';

/**
 * @swagger
 * tags:
 *   - name: Institution
 *     description: Institution profile, campuses, affiliations, terminology and public disclosures
 *   - name: Organization
 *     description: Organization structure — units, positions, appointments and the generated chart
 */
export const institutionRouter = Router();

/**
 * Public disclosures, without sign-in. Only what the school marked public.
 * @swagger
 * /institution/public/{slug}:
 *   get:
 *     summary: Published profile and mandatory disclosures of a school
 *     tags: [Institution]
 *     security: []
 */
institutionRouter.get('/public/:slug', asyncHandler(async (req, res) => {
  const slug = String(req.params.slug ?? '').toLowerCase().trim();
  const school = await School.findOne({ slug, status: 'ACTIVE' }).lean();
  if (!school) throw new AppError('Not found', 404);
  const data = await runWithTenant(slug, () => institution.publicProfile());
  sendSuccess(res, data ?? { displayName: school.name, disclosures: [] });
}));

institutionRouter.use(authenticate);
institutionRouter.get('/terminology', asyncHandler(async (_req, res) => sendSuccess(res, await institution.terminology())));
// Which modules this school has switched on (any signed-in person: screens hide what is off).
institutionRouter.get('/features', asyncHandler(async (_req, res) => sendSuccess(res, await describeFeatures())));
institutionRouter.put('/features', requirePermission('settings.manage', 'ALL'), asyncHandler(async (req, res) =>
  sendSuccess(res, await setFeatures(req.body ?? {}))));
institutionRouter.get('/', requirePermission('institution.read'), asyncHandler(async (_req, res) => sendSuccess(res, await institution.getProfile())));
institutionRouter.put('/', requirePermission('institution.manage'), asyncHandler(async (req, res) =>
  sendSuccess(res, await institution.updateProfile(req.actor, req.body), 'Institution profile saved')));

export const orgRouter = Router();
orgRouter.use(authenticate);
orgRouter.get('/chart', requirePermission('org.read'), asyncHandler(async (_req, res) => sendSuccess(res, await org.chart())));
orgRouter.get('/staff', requirePermission('org.read'), asyncHandler(async (_req, res) => sendSuccess(res, await org.appointableStaff())));
orgRouter.post('/bootstrap', requirePermission('org.manage'), asyncHandler(async (req, res) => {
  const { institutionType } = await institution.terminology();
  sendSuccess(res, await org.bootstrap(req.body?.institutionType ?? institutionType), 'Structure created from staff records', 201);
}));
orgRouter.post('/units', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.createUnit(req.body), 'Unit created', 201)));
orgRouter.patch('/units/:id', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.updateUnit(req.params.id, req.body), 'Unit updated')));
orgRouter.delete('/units/:id', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.deleteUnit(req.params.id), 'Unit removed')));
orgRouter.post('/positions', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.createPosition(req.body), 'Position created', 201)));
orgRouter.patch('/positions/:id', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.updatePosition(req.params.id, req.body), 'Position updated')));
orgRouter.delete('/positions/:id', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.deletePosition(req.params.id), 'Position removed')));
orgRouter.post('/appointments', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.appoint(req.body), 'Appointed', 201)));
orgRouter.post('/appointments/:id/end', requirePermission('org.manage'), asyncHandler(async (req, res) => sendSuccess(res, await org.endAppointment(req.params.id, req.body), 'Appointment ended')));
