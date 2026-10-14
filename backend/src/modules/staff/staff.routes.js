import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { requireAnyPermission } from '../ptm/relations.js';
import * as leave from './staffLeave.service.js';
import * as cover from './cover.service.js';

/**
 * @swagger
 * tags:
 *   - name: StaffLeave
 *     description: Staff leave types, balances, applications, approval and LOP for payroll
 *   - name: Cover
 *     description: Affected periods of absent teachers, substitute proposals and confirmed cover
 */
const router = Router();
router.use(authenticate, requireFeature('staffCover'));
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const apply = requirePermission('staffleave.apply');
const manage = requirePermission('staffleave.manage');
const anyLeave = requireAnyPermission('staffleave.manage', 'staffleave.apply');
const coverMgr = requirePermission('cover.manage');
const staffOrCover = requireAnyPermission('cover.manage', 'staffleave.apply');

router.get('/leave/policies', anyLeave, ok(() => leave.policies()));
router.put('/leave/policies/:code', manage, ok((r) => leave.setPolicy(r.actor, r.scope, r.params.code, r.body), 'Policy saved'));
router.get('/leave/balance', anyLeave, ok((r) => leave.balanceFor(r.actor, r.scopes['staffleave.manage'] === 'ALL' ? 'ALL' : 'OWN', r.query)));
router.get('/leave/balances', manage, ok((r) => leave.allBalances(r.actor, r.scope, r.query)));
router.post('/leave/balances/init', manage, ok((r) => leave.initBalances(r.actor, r.scope, r.body), 'Balances set up'));
router.post('/leave/balances/adjust', manage, ok((r) => leave.adjustBalance(r.actor, r.scope, r.body), 'Balance adjusted'));
router.get('/leave/lop', manage, ok((r) => leave.lopSummary(r.actor, r.scope, r.query)));
router.get('/leave', anyLeave, ok((r) => leave.list(r.actor, r.scopes['staffleave.manage'] === 'ALL' ? 'ALL' : 'OWN', r.query)));
router.post('/leave', apply, ok((r) => leave.apply(r.actor, r.scope, r.body), 'Leave applied for', 201));
router.post('/leave/:id/decide', manage, ok((r) => leave.decide(r.actor, r.scope, r.params.id, r.body)));
router.post('/leave/:id/cancel', anyLeave, ok((r) => leave.cancel(r.actor, r.scopes['staffleave.manage'] === 'ALL' ? 'ALL' : 'OWN', r.params.id, r.body), 'Leave cancelled'));

router.get('/cover/for', staffOrCover, ok((r) => cover.coverForRoute(r.actor, r.query)));
router.get('/cover/mine', staffOrCover, ok((r) => cover.myCovers(r.actor, r.query)));
router.get('/cover/needs', coverMgr, ok((r) => cover.needs(r.actor, r.scope, r.query)));
router.get('/cover/candidates', coverMgr, ok((r) => cover.candidates(r.actor, r.scope, r.query)));
router.get('/cover/rules', coverMgr, ok(() => cover.rules()));
router.put('/cover/rules', coverMgr, ok((r) => cover.setRules(r.actor, r.scope, r.body), 'Saved'));
router.post('/cover', coverMgr, ok((r) => cover.assign(r.actor, r.scope, r.body), 'Cover confirmed', 201));
router.post('/cover/:id/cancel', coverMgr, ok((r) => cover.cancelCover(r.actor, r.scope, r.params.id, r.body), 'Cover cancelled'));
router.get('/cover/absences', coverMgr, ok((r) => cover.listAbsences(r.actor, r.scope, r.query)));
router.post('/cover/absences', coverMgr, ok((r) => cover.markAbsent(r.actor, r.scope, r.body), 'Marked absent', 201));
router.post('/cover/absences/:id/withdraw', coverMgr, ok((r) => cover.withdrawAbsence(r.actor, r.scope, r.params.id)));

export default router;
