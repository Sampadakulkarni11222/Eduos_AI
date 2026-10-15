import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { env, numFromEnv } from '../../config/env.js';
import { School } from '../../models/school.model.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import * as growth from './growth.service.js';
import * as connectors from './connectors.service.js';

/**
 * @swagger
 * tags:
 *   - name: MarketingGrowth
 *     description: Offline campaigns (banners, pamphlets, posters, radio, events...) with approval and tracking codes; lead attribution; ad-platform connectors (CSV import of each platform's export, simulated sample, encrypted credentials) and the attribution report
 *   - name: MarketingPublic
 *     description: Public campaign tracking links (short link / QR) and the HMAC-verified lead webhook
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const growthRouter = Router();
growthRouter.use(authenticate);
const read = requirePermission('marketing.read');
const manage = requirePermission('marketing.manage');
// Connector credentials and webhook secrets: school-wide marketing managers only.
const manageAll = requirePermission('marketing.manage', 'ALL');
const leadsManage = requirePermission('admissions.manage');

growthRouter.get('/offline', read, ok((r) => growth.listOffline(r.actor, r.query)));
growthRouter.post('/offline', manage, ok((r) => growth.createOffline(r.actor, r.body), 'Campaign saved', 201));
growthRouter.get('/offline/:id', read, ok((r) => growth.getOffline(r.actor, r.params.id)));
growthRouter.patch('/offline/:id', manage, ok((r) => growth.updateOffline(r.actor, r.params.id, r.body), 'Campaign updated'));
// Approve/reject are checked in the service: marketing.manage or the principal, never the creator.
growthRouter.post('/offline/:id/move', read, ok((r) => {
  if (!r.actor.permissions['marketing.manage'] && r.actor.roleKey !== 'PRINCIPAL') throw new AppError('Missing permission: marketing.manage', 403);
  return growth.moveOffline(r.actor, r.params.id, r.body);
}, 'Updated'));
growthRouter.get('/heard-from', read, ok(() => growth.listHeardFrom()));
growthRouter.post('/heard-from', manage, ok((r) => growth.saveHeardFrom(r.actor, r.body), 'Saved'));
growthRouter.get('/leads/:id/attribution', requirePermission('admissions.read'), ok((r) => growth.leadAttribution(r.actor, r.params.id)));
growthRouter.post('/leads/:id/attribution', leadsManage, ok((r) => growth.attributeLead(r.actor, r.params.id, r.body), 'Source recorded'));
growthRouter.get('/settings', read, ok(() => growth.getSettings()));
growthRouter.put('/settings', manage, ok((r) => growth.saveSettings(r.actor, r.body), 'Saved'));
growthRouter.get('/attribution', read, ok((r) => growth.attributionReport(r.actor, r.query)));
growthRouter.get('/attribution.csv', read, asyncHandler(async (req, res) => {
  const csv = await growth.attributionCsv(req.actor, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attribution.csv"');
  res.send(String.fromCharCode(0xfeff) + csv);
}));

growthRouter.get('/connectors', read, ok((r) => connectors.listConnectors(r.actor)));
growthRouter.get('/connectors/imports', read, ok((r) => connectors.listImports(r.actor, r.query)));
growthRouter.get('/connectors/metrics', read, ok((r) => connectors.metricsSummary(r.actor, r.query)));
growthRouter.put('/connectors/:platform/credentials', manageAll, ok((r) => connectors.saveCredentials(r.actor, r.params.platform, r.body), 'Saved'));
growthRouter.post('/connectors/:platform/sync', manage, ok((r) => connectors.sync(r.actor, r.params.platform)));
growthRouter.post('/connectors/:platform/webhook-secret', manageAll, ok((r) => connectors.rotateWebhookSecret(r.actor, r.params.platform), 'New secret issued'));
growthRouter.post('/connectors/:platform/import', manage, ok((r) => connectors.importMetrics(r.actor, r.params.platform, r.body), 'Imported'));
growthRouter.post('/connectors/:platform/import-leads', manage, leadsManage, ok((r) => connectors.importLeads(r.actor, r.params.platform, r.body), 'Imported'));
growthRouter.post('/connectors/:platform/sample', manage, ok((r) => connectors.setSample(r.actor, r.params.platform, r.body?.on === true), 'Updated'));

// ── public ──────────────────────────────────────────────────────────
const limiter = (name, max) => rateLimit({
  windowMs: 15 * 60_000, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `mkt:${name}:${req.ip}|${String(req.params?.school ?? '').toLowerCase()}`,
  handler: (_req, res) => sendError(res, 'Too many requests, please try again later.', 429, [], 'RATE_LIMITED'),
});
const scanLimiter = limiter('scan', numFromEnv('RATE_LIMIT_MARKETING_SCAN_MAX', 300));
const hookLimiter = limiter('hook', numFromEnv('RATE_LIMIT_MARKETING_WEBHOOK_MAX', 600));

async function schoolSlug(raw) {
  const slug = String(raw ?? '').toLowerCase().trim();
  if (!/^[a-z0-9-]{2,60}$/.test(slug) || !(await School.exists({ slug, status: 'ACTIVE' }))) throw new AppError('Not found', 404);
  return slug;
}
const webOrigin = () => String(process.env.PUBLIC_WEB_URL || env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');

export const publicMarketingRouter = Router();
// Short link / QR: counts the open and sends the visitor to the school's online admission form with the campaign's UTM.
publicMarketingRouter.get('/r/:school/:code', scanLimiter, asyncHandler(async (req, res) => {
  const slug = await schoolSlug(req.params.school);
  const hit = await runWithTenant(slug, () => growth.scan(String(req.params.code ?? '').slice(0, 40)));
  const url = new URL(`${webOrigin()}/public/admission/${encodeURIComponent(slug)}`);
  if (hit) {
    for (const [k, v] of Object.entries(hit.utm)) url.searchParams.set(k, v);
    url.searchParams.set('mc', hit.code);
  }
  res.redirect(302, url.toString());
}));
// "How did you hear about us?" answers for the public form.
publicMarketingRouter.get('/:school/heard-from', scanLimiter, asyncHandler(async (req, res) => {
  const slug = await schoolSlug(req.params.school);
  const rows = await runWithTenant(slug, () => growth.listHeardFrom({ activeOnly: true }));
  sendSuccess(res, rows.map((r) => ({ id: r.id, label: r.label })));
}));
// Lead webhook: Meta-style handshake, then HMAC-verified lead delivery.
publicMarketingRouter.get('/leads/:school/:platform', hookLimiter, asyncHandler(async (req, res) => {
  const slug = await schoolSlug(req.params.school);
  const challenge = await runWithTenant(slug, () => connectors.verifyHandshake(String(req.params.platform).toUpperCase(), req.query));
  if (challenge === null) return sendError(res, 'Verification failed', 403, [], 'BAD_VERIFY_TOKEN');
  res.type('text/plain').send(challenge);
}));
publicMarketingRouter.post('/leads/:school/:platform', hookLimiter, asyncHandler(async (req, res) => {
  const slug = await schoolSlug(req.params.school);
  const out = await runWithTenant(slug, () => connectors.receiveWebhook(String(req.params.platform).toUpperCase(), req.rawBody, req.get('x-hub-signature-256'), req.body));
  sendSuccess(res, out, 'Received');
}));
