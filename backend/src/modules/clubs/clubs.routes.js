import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { AppError } from '../../utils/AppError.js';
import * as clubs from './clubs.service.js';
import * as sessions from './sessions.service.js';
import * as fixtures from './fixtures.service.js';
import * as kit from './equipment.service.js';
import { portfolio } from './portfolio.service.js';

/**
 * @swagger
 * tags:
 *   - name: Clubs
 *     description: Clubs, teams and houses; join requests with parent consent and teacher approval, capacity and waiting list; sessions with venue and attendance; fixtures, results approved by a second teacher, house points; equipment issue log; participation portfolio
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const KEYS = ['clubs.read', 'clubs.manage', 'clubs.join'];
const scopesOf = (req) => Object.fromEntries(KEYS.map((k) => [k, req.actor?.permissions?.[k] ?? null]).filter(([, v]) => v));

const router = Router();
router.use(authenticate, requireFeature('clubs'));
const read = requirePermission('clubs.read');
const manage = requirePermission('clubs.manage');
const join = requirePermission('clubs.join');
const joinOrManage = (req, _res, next) => {
  const s = scopesOf(req);
  if (!s['clubs.join'] && !s['clubs.manage']) throw new AppError('Missing permission: clubs.join or clubs.manage', 403);
  next();
};

router.get('/', read, ok((r) => clubs.listClubs(r.actor, r.scope, r.query)));
router.post('/', requirePermission('clubs.manage', 'ALL'), ok((r) => clubs.createClub(r.actor, r.scope, r.body), 'Club created', 201));
router.get('/options', read, ok((r) => clubs.options(r.actor, r.actor?.permissions?.['clubs.manage'] ?? null)));
router.get('/my', join, ok((r) => clubs.myMemberships(r.actor)));
router.get('/my-students', join, ok((r) => clubs.myStudents(r.actor)));
router.get('/approvals', manage, ok((r) => clubs.approvalQueue(r.actor, r.scope)));
router.get('/portfolio/:studentId', read, ok((r) => portfolio(r.actor, r.scope, r.params.studentId)));

router.post('/memberships', join, ok((r) => clubs.requestJoin(r.actor, r.body), 'Request sent', 201));
router.post('/memberships/:id/consent', join, ok((r) => clubs.decideConsent(r.actor, r.params.id, r.body)));
router.post('/memberships/:id/decision', manage, ok((r) => clubs.decideJoin(r.actor, r.scope, r.params.id, r.body)));
router.post('/memberships/:id/leave', joinOrManage, ok((r) => clubs.leave(r.actor, scopesOf(r), r.params.id, r.body)));
router.post('/memberships/:id/role', manage, ok((r) => clubs.setRole(r.actor, r.scope, r.params.id, r.body)));

router.get('/sessions', read, ok((r) => sessions.listSessions(r.actor, scopesOf(r), r.query)));
router.get('/sessions/:id/register', manage, ok((r) => sessions.register(r.actor, r.scope, r.params.id)));
router.post('/sessions/:id/attendance', manage, ok((r) => sessions.takeAttendance(r.actor, r.scope, r.params.id, r.body), 'Register saved'));
router.post('/sessions/:id/cancel', manage, ok((r) => sessions.cancelSession(r.actor, r.scope, r.params.id, r.body), 'Session cancelled'));

router.get('/houses', read, ok((r) => fixtures.listHouses(r.actor)));
router.post('/houses', requirePermission('clubs.manage', 'ALL'), ok((r) => fixtures.createHouse(r.actor, r.scope, r.body), 'House created', 201));
router.post('/houses/assign', requirePermission('clubs.manage', 'ALL'), ok((r) => fixtures.assignHouse(r.actor, r.scope, r.body)));
router.get('/house-points', read, ok((r) => fixtures.housePoints(r.actor, r.query)));

router.get('/fixtures', read, ok((r) => fixtures.listFixtures(r.actor, scopesOf(r), r.query)));
router.post('/fixtures', manage, ok((r) => fixtures.createFixture(r.actor, r.scope, r.body), 'Fixture scheduled', 201));
router.put('/fixtures/:id/participants', manage, ok((r) => fixtures.setParticipants(r.actor, r.scope, r.params.id, r.body)));
router.post('/fixtures/:id/result', manage, ok((r) => fixtures.recordResult(r.actor, r.scope, r.params.id, r.body), 'Result recorded; waiting for approval'));
router.post('/fixtures/:id/result/decision', manage, ok((r) => fixtures.decideResult(r.actor, r.scope, r.params.id, r.body)));
router.post('/fixtures/:id/cancel', manage, ok((r) => fixtures.cancelFixture(r.actor, r.scope, r.params.id, r.body), 'Fixture cancelled'));

router.get('/equipment', manage, ok((r) => kit.listEquipment(r.actor, r.scope, r.query)));
router.post('/equipment', manage, ok((r) => kit.addEquipment(r.actor, r.scope, r.body), 'Equipment added', 201));
router.get('/equipment/issues', manage, ok((r) => kit.listIssues(r.actor, r.scope, r.query)));
router.post('/equipment/issues', manage, ok((r) => kit.issue(r.actor, r.scope, r.body), 'Issued', 201));
router.post('/equipment/issues/:id/return', manage, ok((r) => kit.returnIssue(r.actor, r.scope, r.params.id, r.body)));

router.get('/:id', read, ok((r) => clubs.getClub(r.actor, scopesOf(r), r.params.id)));
router.patch('/:id', manage, ok((r) => clubs.updateClub(r.actor, r.scope, r.params.id, r.body)));
router.post('/:id/sessions', manage, ok((r) => sessions.createSessions(r.actor, r.scope, r.params.id, r.body), 'Sessions scheduled', 201));

export default router;
