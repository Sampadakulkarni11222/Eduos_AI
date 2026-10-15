import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as svc from './scenarios.service.js';

/**
 * @swagger
 * tags:
 *   - name: Scenarios
 *     description: >
 *       What-if projections 1–5 years ahead from current actuals: enrolment (intake, retention),
 *       fees (increase, concessions, collection), staffing (ratio, hires, increments), transport
 *       (vehicles needed for riders and capacity) and budget. Saved scenarios and side-by-side
 *       comparison. Always labelled as projections; every assumption is returned with its source.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('scenarios'));
const read = requirePermission('scenarios.read', 'ALL');
const manage = requirePermission('scenarios.manage', 'ALL');

router.get('/baseline', read, ok(() => svc.getBaseline()));
router.post('/preview', read, ok((r) => svc.preview(r.body)));
router.get('/compare', read, ok((r) => svc.compare(r.query.ids)));
router.get('/', read, ok(() => svc.list()));
router.post('/', manage, ok((r) => svc.create(r.actor, r.body), 'Scenario saved', 201));
router.get('/:id', read, ok((r) => svc.get(r.params.id)));
router.patch('/:id', manage, ok((r) => svc.update(r.actor, r.params.id, r.body), 'Scenario updated'));
router.delete('/:id', manage, ok((r) => svc.archive(r.params.id), 'Scenario removed'));

export default router;
