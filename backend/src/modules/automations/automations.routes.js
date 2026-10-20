import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireAnyOf } from '../safety/access.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './automations.service.js';
import * as personal from './personal.js';

/**
 * @swagger
 * tags:
 *   name: Automations
 *   description: School automations (on/off, schedule, audience, message preview), drafts an automation prepared for a person to confirm, opt-ins, personal reminders and reports, and "what needs you today"
 */
const router = Router();
router.use(authenticate);

const manage = requireAnyOf(['settings.manage', 'ALL'], ['institution.manage', 'ALL']);
const ok = (fn, message) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message));

// Anyone signed in sees the list (and whether they may change it); changing needs settings.manage or institution.manage, school-wide.
router.get('/', ok((r) => service.listAutomations(r.actor)));
router.put('/:key', manage, ok((r) => service.updateAutomation(r.actor, r.params.key, r.body ?? {}), 'Automation saved'));
router.post('/:key/run', manage, ok((r) => service.runNow(r.actor, r.params.key), 'Automation run'));

router.get('/me/today', ok((r) => service.whatNeedsMe(r.actor)));
router.get('/me/drafts', ok((r) => service.listDrafts(r.actor, { status: r.query.status ?? 'DRAFT' })));
router.post('/me/drafts/:id/confirm', ok((r) => service.confirmDraft(r.actor, r.params.id), 'Draft confirmed'));
router.post('/me/drafts/:id/dismiss', ok((r) => service.dismissDraft(r.actor, r.params.id), 'Draft dismissed'));
router.get('/me/opt-ins', ok((r) => service.myOptIns(r.actor)));
router.put('/me/opt-ins/:key', ok((r) => service.setMyOptIn(r.actor, r.params.key, r.body?.enabled === true), 'Saved'));

router.get('/me/reminders', ok((r) => personal.listMine(r.actor, { includeStopped: r.query.all === 'true' })));
router.post('/me/reminders', ok((r) => personal.createMine(r.actor, r.body ?? {}, { via: 'WEB' }), 'Reminder saved'));
router.delete('/me/reminders/:id', ok(async (r) => {
  const found = await personal.findMine(r.actor, { id: r.params.id });
  if (!found.rows.length) throw new AppError('Reminder not found', 404);
  return personal.stopMine(r.actor, found.rows.map((x) => x._id));
}, 'Reminder stopped'));

export default router;
