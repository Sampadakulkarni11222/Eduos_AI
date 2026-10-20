import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as svc from './portfolios.service.js';
import { renderPortfolioPdf } from './portfolio.pdf.js';

/**
 * @swagger
 * tags:
 *   - name: Portfolios
 *     description: >
 *       Competency portfolios (CBSE/NEP-aligned): evidence read from school records plus teacher
 *       evidence, a three-level rubric per competency (no scores, no behaviour ratings), student
 *       reflections and a PDF for the student and family. Families see only their own.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

const router = Router();
router.use(authenticate, requireFeature('portfolios'));
const read = requirePermission('portfolios.read');
const manage = requirePermission('portfolios.manage');
const reflectP = requirePermission('portfolios.reflect');

router.get('/framework', read, ok(() => svc.framework()));
router.get('/students', read, ok((r) => svc.students(r.actor, r.scope, r.query)));
router.get('/:studentId', read, ok((r) => svc.portfolio(r.actor, r.scope, r.params.studentId)));
router.get('/:studentId/pdf', read, asyncHandler(async (req, res) => {
  const p = await svc.portfolio(req.actor, req.scope, req.params.studentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Portfolio-${p.student.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  renderPortfolioPdf(res, p);
}));
router.post('/:studentId/evidence', manage, ok((r) => svc.addEvidence(r.actor, r.scope, r.params.studentId, r.body), 'Evidence added', 201));
router.delete('/:studentId/evidence/:evidenceId', manage, ok((r) => svc.removeEvidence(r.actor, r.scope, r.params.studentId, r.params.evidenceId), 'Evidence removed'));
router.put('/:studentId/ratings', manage, ok((r) => svc.rate(r.actor, r.scope, r.params.studentId, r.body), 'Rating saved'));
router.post('/:studentId/reflections', reflectP, ok((r) => svc.reflect(r.actor, r.params.studentId, r.body), 'Reflection saved', 201));

export default router;
