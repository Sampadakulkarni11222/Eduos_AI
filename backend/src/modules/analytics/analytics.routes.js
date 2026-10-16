import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import * as service from './analytics.service.js';
import * as quarterly from './quarterly.service.js';
import * as views from './views.service.js';
import { renderQuarterlyPdf } from './quarterly.pdf.js';

/**
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Analytics workspace (metric catalogue, periods and comparisons, CSV export) and quarterly decision reports
 */
const router = Router();
router.use(authenticate, requireFeature('analytics'));

const workspace = requirePermission('analytics.workspace.read');
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const sendFile = (res, { filename, body }, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
};

/**
 * @swagger
 * /analytics/catalogue:
 *   get:
 *     summary: Metric definitions (key, definition, unit, date basis, sources, version) within your scope
 *     tags: [Analytics]
 */
router.get('/catalogue', workspace, ok((r) => service.catalogue(r.actor, r.scope)));

/**
 * @swagger
 * /analytics/overview:
 *   get:
 *     summary: Figures for a period and its comparison, per metric, with change, trend, record counts and coverage
 *     tags: [Analytics]
 *     parameters:
 *       - { in: query, name: preset, schema: { type: string, enum: [today, week, month, quarter, year, academicYear, financialYear, custom] } }
 *       - { in: query, name: from, schema: { type: string, example: '2026-04-01' } }
 *       - { in: query, name: to, schema: { type: string, example: '2026-06-30' } }
 *       - { in: query, name: compare, schema: { type: string, enum: [previous, lastYear, priorYears, custom, none] } }
 *       - { in: query, name: department, schema: { type: string } }
 */
router.get('/overview', workspace, ok((r) => service.overview(r.actor, r.scope, r.query)));
// Part 3: saved views live on the server, per person (they follow the person across devices).
router.get('/views', workspace, ok((r) => views.list(r.actor)));
router.post('/views', workspace, ok((r) => views.save(r.actor, r.body), 'View saved', 201));
router.post('/views/import', workspace, ok((r) => views.importViews(r.actor, r.body), 'Views imported'));
router.delete('/views/:id', workspace, ok((r) => views.remove(r.actor, r.params.id), 'View forgotten'));

// The export requires both keys and uses the workspace scope, so it never holds more than the screen.
router.get('/export.csv', requirePermission('analytics.export'), workspace, asyncHandler(async (req, res) => {
  sendFile(res, await service.exportCsv(req.actor, req.scope, req.query), 'text/csv; charset=utf-8');
}));

// ── quarterly reports ──────────────────────────────────────────────────
const readReports = requirePermission('reports.quarterly.read');
const manageReports = requirePermission('reports.quarterly.manage', 'ALL');

router.get('/reports', readReports, ok((r) => quarterly.list(r.actor, r.query)));
router.post('/reports/generate', manageReports, ok((r) => quarterly.regenerate(r.actor, r.body ?? {}), 'Report generated', 201));
router.get('/reports/:id', readReports, ok((r) => quarterly.get(r.actor, r.params.id)));
router.get('/reports/:id/deliveries', manageReports, ok((r) => quarterly.deliveries(r.actor, r.params.id)));
router.post('/reports/:id/deliver', manageReports, ok((r) => quarterly.retryDeliveries(r.actor, r.params.id), 'Deliveries retried'));
// Downloads re-check the reader's authority on every request (requirePermission reads the live role).
router.get('/reports/:id/download.csv', readReports, asyncHandler(async (req, res) => {
  sendFile(res, await quarterly.csv(req.actor, req.params.id), 'text/csv; charset=utf-8');
}));
router.get('/reports/:id/download.pdf', readReports, asyncHandler(async (req, res) => {
  const report = await quarterly.forPdf(req.actor, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="quarterly-${report.quarterKey}-v${report.version}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  renderQuarterlyPdf(res, report);
}));

export default router;
