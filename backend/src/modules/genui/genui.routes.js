import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { askDashboard } from './ask.service.js';
import * as panels from './panels.service.js';

/**
 * @swagger
 * tags:
 *   name: GenUI
 *   description: '"Ask your dashboard": generated panels (OpenUI Lang, registered components only) from the analytics workspace and the role dashboards, and pinned panels per person'
 */
const router = Router();
// Any signed-in person: what a panel can show is decided by the sources it
// reads (analytics.workspace.read and its scope, or the person's own role
// dashboard), exactly as on those screens.
router.use(authenticate);
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

/**
 * @swagger
 * /genui/ask:
 *   post:
 *     summary: Build a generated panel for a sentence (e.g. "compare fee collection this year with last year by month")
 *     tags: [GenUI]
 */
router.post('/ask', ok((r) => askDashboard(r.actor, { prompt: r.body?.prompt, child: r.body?.child ?? null }), 'Panel generated'));

router.get('/panels', ok((r) => panels.list(r.actor, { surface: r.query.surface })));
router.post('/panels', ok((r) => panels.pin(r.actor, r.body ?? {}), 'Panel pinned', 201));
router.get('/panels/:id', ok((r) => panels.render(r.actor, r.params.id)));
router.delete('/panels/:id', ok((r) => panels.unpin(r.actor, r.params.id), 'Panel unpinned'));

export default router;
