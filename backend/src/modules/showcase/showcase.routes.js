import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as showcase from './showcase.service.js';

/**
 * @swagger
 * tags:
 *   - name: Showcase
 *     description: Achievement and top-ranker showcase. Everyone in the school reads the published showcase; showcase.publish holders (never students or families) draft, review, publish and withdraw. Ranks come only from published results, up to the school's cut-off; consent is checked when publishing and on every read.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('showcase'));
// Reading: anyone who can see the institution's own pages (every role in the school).
const read = requirePermission('institution.read');
const publish = requirePermission('showcase.publish');

router.get('/', read, ok((r) => showcase.published(r.actor, r.query)));
router.get('/settings', read, ok(() => showcase.getSettings()));
router.put('/settings', publish, ok((r) => showcase.updateSettings(r.actor, r.body)));
router.get('/options', publish, ok((r) => showcase.options(r.actor)));
router.get('/rank-preview', publish, ok((r) => showcase.rankPreview(r.actor, r.query)));
router.get('/candidates', publish, ok((r) => showcase.candidates(r.actor, r.query)));
router.get('/editions', publish, ok((r) => showcase.listEditions(r.actor)));
router.post('/editions', publish, ok((r) => showcase.createEdition(r.actor, r.body), 'Showcase created', 201));
router.get('/editions/:id', publish, ok((r) => showcase.getEdition(r.actor, r.params.id)));
router.post('/editions/:id/rank-entries', publish, ok((r) => showcase.addRankEntries(r.actor, r.params.id, r.body), 'Ranks drafted', 201));
router.post('/editions/:id/entries', publish, ok((r) => showcase.addEntry(r.actor, r.params.id, r.body), 'Entry drafted', 201));
router.post('/editions/:id/publish', publish, ok((r) => showcase.publishEdition(r.actor, r.params.id), 'Published'));
router.post('/editions/:id/withdraw', publish, ok((r) => showcase.withdrawEdition(r.actor, r.params.id, r.body), 'Withdrawn'));
router.post('/entries/:id/review', publish, ok((r) => showcase.reviewEntry(r.actor, r.params.id, r.body)));
router.post('/entries/:id/withdraw', publish, ok((r) => showcase.withdrawEntry(r.actor, r.params.id, r.body), 'Withdrawn'));
router.delete('/entries/:id', publish, ok((r) => showcase.removeEntry(r.actor, r.params.id), 'Removed'));

export default router;
