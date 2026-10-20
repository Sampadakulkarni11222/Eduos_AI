import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { requireFeature } from '../../utils/features.js';
import { numFromEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { runAcrossSchools, runWithTenant } from '../../tenancy/tenantContext.js';
import { IntegrationConnection } from '../../models/integration.model.js';
import * as oauth from './oauth.service.js';
import * as engagement from './engagement.service.js';
import { verifySignature, ingestPayload } from '../marketing/connectors.service.js';

/**
 * @swagger
 * tags:
 *   - name: Integrations
 *     description: OAuth connections to the provider apps (Meta, Google, LinkedIn, X) for live ad sync and social posting; tokens are encrypted and never returned. Without the provider app configured everything stays simulated.
 *   - name: IntegrationsPublic
 *     description: The app-level Meta webhook (lead ads), verified with X-Hub-Signature-256 and routed to the school by Page id
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));

export const integrationsRouter = Router();
integrationsRouter.use(authenticate);
// Who may connect what is checked in the service (ads: marketing.manage ALL; social: social.connect).
integrationsRouter.get('/', ok((r) => oauth.overview(r.actor)));
integrationsRouter.post('/oauth/complete', ok((r) => oauth.completeConnect(r.actor, r.body), 'Connected'));
integrationsRouter.post('/:provider/connect', ok((r) => oauth.startConnect(r.actor, r.params.provider, r.body)));
integrationsRouter.put('/:provider/assets', ok((r) => oauth.selectAssets(r.actor, r.params.provider, r.body), 'Saved'));
integrationsRouter.post('/:provider/refresh-assets', ok((r) => oauth.refreshAssets(r.actor, r.params.provider), 'Refreshed'));
integrationsRouter.post('/:provider/disconnect', ok((r) => oauth.disconnect(r.actor, r.params.provider), 'Disconnected'));
integrationsRouter.post('/social-posts/:id/engagement', requireFeature('socialPublishing'), requirePermission('social.publish'), ok((r) => engagement.refreshPost(r.actor, r.params.id), 'Refreshed'));

// ── public: Meta's app-level webhook ─────────────────────────────────
const hookLimiter = rateLimit({
  windowMs: 15 * 60_000, max: numFromEnv('RATE_LIMIT_MARKETING_WEBHOOK_MAX', 600), standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `integ:meta:${req.ip}`,
  handler: (_req, res) => sendError(res, 'Too many requests, please try again later.', 429, [], 'RATE_LIMITED'),
});

export const publicIntegrationsRouter = Router();
// Subscription handshake: echo hub.challenge when the verify token is the installation's META_WEBHOOK_VERIFY_TOKEN.
publicIntegrationsRouter.get('/meta/webhook', hookLimiter, (req, res) => {
  const want = String(process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim();
  const given = String(req.query['hub.verify_token'] ?? '');
  if (!want || req.query['hub.mode'] !== 'subscribe' || given.length !== want.length || !Buffer.from(given).equals(Buffer.from(want))) return sendError(res, 'Verification failed', 403, [], 'BAD_VERIFY_TOKEN');
  return res.type('text/plain').send(String(req.query['hub.challenge'] ?? '').slice(0, 200));
});
// Lead ads: signed by Meta with the app secret; each entry is routed to the school whose connected Page it is.
publicIntegrationsRouter.post('/meta/webhook', hookLimiter, asyncHandler(async (req, res) => {
  const secret = String(process.env.META_APP_SECRET ?? '').trim();
  if (!secret) return sendError(res, 'Not found', 404);
  if (!verifySignature(secret, req.rawBody, req.get('x-hub-signature-256'))) return sendError(res, 'Signature does not match', 401, [], 'BAD_SIGNATURE');
  const out = { entries: 0, routed: 0, unknownPages: 0, created: 0, duplicates: 0, rejected: 0 };
  for (const entry of Array.isArray(req.body?.entry) ? req.body.entry.slice(0, 50) : []) {
    out.entries += 1;
    const pageId = String(entry?.id ?? '');
    if (!/^\d{1,30}$/.test(pageId)) { out.unknownPages += 1; continue; }
    // eslint-disable-next-line no-await-in-loop
    const conn = await runAcrossSchools(() => IntegrationConnection.findOne({ provider: 'META', status: 'CONNECTED', 'selected.metaPageId': pageId }).select('tenantId').lean());
    if (!conn?.tenantId) { out.unknownPages += 1; continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await runWithTenant(conn.tenantId, () => ingestPayload('META_ADS', { entry: [entry] }));
      out.routed += 1; out.created += r.created; out.duplicates += r.duplicates; out.rejected += r.rejected;
    } catch (err) {
      out.rejected += 1;
      logger.warn(`[meta webhook] ${conn.tenantId}: ${err.message}`);
    }
  }
  // Always 200 for a verified delivery, so Meta does not retry what was already handled.
  sendSuccess(res, out, 'Received');
}));
