import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { requireAnyPermission } from '../ptm/relations.js';
import * as service from './reportcards.service.js';
import { renderTermCardPdf } from './termCardPdf.js';

/**
 * @swagger
 * tags:
 *   name: TermReportCards
 *   description: Term report-card templates, generation from published marks, moderation, versioned publication and PDF
 */
const router = Router();
router.use(authenticate, requireFeature('reportCards'));
const manage = requirePermission('reportcards.manage');
const read = requirePermission('reportcards.read');
const either = requireAnyPermission('reportcards.read', 'reportcards.manage');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

router.get('/templates', either, ok(() => service.listTemplates()));
router.post('/templates', manage, ok((r) => service.createTemplate(r.actor, r.scope, r.body), 'Template created', 201));
router.patch('/templates/:id', manage, ok((r) => service.updateTemplate(r.actor, r.scope, r.params.id, r.body)));
router.get('/sections', manage, ok((r) => service.mySections(r.actor, r.scope)));
router.get('/published', read, ok((r) => service.published(r.actor, r.scope, r.query)));
router.get('/versions/:id', either, ok((r) => service.getVersion(r.actor, r.actor.permissions, r.params.id)));
router.get('/versions/:id/pdf', either, asyncHandler(async (req, res) => {
  const v = await service.getVersion(req.actor, req.actor.permissions, req.params.id);
  const safe = String(v.card?.studentName ?? 'student').replace(/[^a-zA-Z0-9]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ReportCard-${safe}-${v.card?.termKey ?? ''}-v${v.version}.pdf"`);
  renderTermCardPdf(res, v);
}));
router.post('/generate', manage, ok((r) => service.generate(r.actor, r.scope, r.body), 'Report cards prepared'));
router.post('/bulk', manage, ok((r) => service.bulk(r.actor, r.scope, r.body)));
router.get('/', manage, ok((r) => service.list(r.actor, r.scope, r.query)));
router.get('/:id', manage, ok((r) => service.get(r.actor, r.scope, r.params.id)));
router.patch('/:id', manage, ok((r) => service.update(r.actor, r.scope, r.params.id, r.body), 'Saved'));
router.post('/:id/moderate', manage, ok((r) => service.moderate(r.actor, r.scope, r.params.id, r.body), 'Approved'));
router.post('/:id/return', manage, ok((r) => service.returnToDraft(r.actor, r.scope, r.params.id, r.body), 'Returned to draft'));
router.post('/:id/publish', manage, ok((r) => service.publish(r.actor, r.scope, r.params.id, r.body), 'Published'));
router.get('/:id/versions', manage, ok((r) => service.versionsOf(r.actor, r.scope, r.params.id)));

export default router;
