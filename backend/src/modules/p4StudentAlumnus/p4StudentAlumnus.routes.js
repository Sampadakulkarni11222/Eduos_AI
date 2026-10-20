import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { AppError } from '../../utils/AppError.js';
import * as types from '../documentRequests/documentType.service.js';
import * as docs from '../documentRequests/documentRequest.service.js';
import * as docController from '../documentRequests/documentRequest.controller.js';
import * as opps from './opportunities.service.js';
import * as planner from './planner.service.js';

/**
 * Part 4, student and alumnus profile audit.
 *
 *   /alumni-services/documents       a former student requests certificates from their own archived record
 *                                    (the same workflow and office queue as students' requests)
 *   /alumni-services/opportunities   the alumni "give back" board (career talks, mentoring, internships, jobs)
 *   /student-planner/me              a student's (or parent's, for a child) planner, study plan and board-details check
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

/**
 * Types that certify *current* enrolment make no sense for someone who has
 * left; the office can still configure anything, this only shapes the list.
 */
export const CURRENT_ONLY = /bonafide|enrol+ment certificate|fee certificate/i;

export const alumniServicesRouter = Router();
alumniServicesRouter.use(authenticate, requireFeature('alumni'));
const alumnus = [requirePermission('alumni.directory.read'), requireRole('ALUMNUS')];
alumniServicesRouter.get('/documents/types', ...alumnus, ok(async () => (await types.listRequestable()).filter((t) => !CURRENT_ONLY.test(t.name))));
alumniServicesRouter.get('/documents', ...alumnus, ok((r) => docs.listMine(r.actor)));
alumniServicesRouter.post('/documents', ...alumnus, ok(async (r) => {
  const all = await types.listRequestable();
  const t = all.find((x) => String(x.id) === String(r.body?.documentTypeId));
  if (t && CURRENT_ONLY.test(t.name)) throw new AppError(`A ${t.name} certifies a current student. Ask for a character, study or leaving certificate instead.`, 400, [], 'NOT_FOR_ALUMNI');
  return docs.createRequest(r.actor, { ...r.body, studentId: undefined });
}, 'Document request submitted', 201));
alumniServicesRouter.get('/documents/:id', ...alumnus, ok((r) => docs.getMine(r.actor, r.params.id)));
alumniServicesRouter.post('/documents/:id/cancel', ...alumnus, ok((r) => docs.cancelMine(r.actor, r.params.id), 'Document request cancelled'));
alumniServicesRouter.get('/documents/:id/file', ...alumnus, docController.downloadMine);

const board = requirePermission('alumni.directory.read');
const anyAlumni = (req, _res, next) => {
  if (req.actor?.permissions?.['alumni.directory.read'] || req.actor?.permissions?.['alumni.manage']) return next();
  throw new AppError('Missing permission: alumni.directory.read', 403);
};
alumniServicesRouter.get('/opportunities', anyAlumni, ok((r) => opps.list(r.actor, r.query)));
alumniServicesRouter.get('/opportunities/mine', anyAlumni, ok((r) => opps.mine(r.actor)));
alumniServicesRouter.post('/opportunities', anyAlumni, ok((r) => opps.create(r.actor, r.body), 'Offer saved', 201));
alumniServicesRouter.post('/opportunities/:id/withdraw', anyAlumni, ok((r) => opps.withdraw(r.actor, r.params.id), 'Offer withdrawn'));
alumniServicesRouter.post('/opportunities/:id/review', requirePermission('alumni.manage', 'ALL'), ok((r) => opps.review(r.actor, r.params.id, r.body), 'Offer reviewed'));
alumniServicesRouter.post('/opportunities/:id/interest', board, ok((r) => opps.interest(r.actor, r.params.id, r.body), 'Interest saved'));

export const plannerRouter = Router();
plannerRouter.use(authenticate);
plannerRouter.get('/me', requirePermission('assignments.read'), requireRole('STUDENT', 'PARENT'), ok((r) => planner.getPlanner(r.actor, { studentId: r.query.studentId, days: r.query.days })));
