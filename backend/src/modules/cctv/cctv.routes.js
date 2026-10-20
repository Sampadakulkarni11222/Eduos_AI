import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { requireFeature } from '../../utils/features.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import * as cctv from './cctv.service.js';
import { verifyToken } from './playback.js';

/**
 * @swagger
 * tags:
 *   - name: CCTV
 *     description: Optional live CCTV viewing for authorised staff (feature cctvLive). View-only, every view logged; never for families.
 */
const ok = (fn, message = 'OK', status = 200) => asyncHandler(async (req, res) => sendSuccess(res, await fn(req), message, status));
const viewerIp = (req) => req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;

// ── /cctv (signed-in staff) ─────────────────────────────────────────────
export const cctvRouter = Router();
cctvRouter.use(authenticate);
// Reachable with the feature off, so the screen can say it is off and show the setup steps.
cctvRouter.get('/status', ok((r) => cctv.status(r.actor)));
cctvRouter.use(requireFeature('cctvLive'));
cctvRouter.get('/streams', ok((r) => cctv.listStreams(r.actor)));
cctvRouter.get('/streams/manage', ok((r) => cctv.manageStreams(r.actor)));
cctvRouter.post('/streams', ok((r) => cctv.createStream(r.actor, r.body), 'Camera registered', 201));
cctvRouter.patch('/streams/:id', ok((r) => cctv.updateStream(r.actor, r.params.id, r.body)));
cctvRouter.post('/streams/check', ok(async (r) => { cctv.assertManager(r.actor); return cctv.checkStreams(); }));
cctvRouter.get('/settings', ok((r) => cctv.readSettings(r.actor)));
cctvRouter.put('/settings', ok((r) => cctv.updateSettings(r.actor, r.body)));
cctvRouter.post('/settings/test', ok((r) => cctv.testGateway(r.actor)));
cctvRouter.post('/streams/:id/sessions', ok((r) => cctv.startSession(r.actor, r.params.id, r.body), 'Viewing started', 201));
cctvRouter.post('/sessions/:id/renew', ok((r) => cctv.renewSession(r.actor, r.params.id, r.body)));
cctvRouter.post('/sessions/:id/end', ok((r) => cctv.endSession(r.actor, r.params.id)));
cctvRouter.get('/view-log', ok((r) => cctv.viewLog(r.actor, r.query)));

// ── /cctv/play (playback token, no bearer: a native video player cannot send one) ──
export const cctvPlayRouter = Router();
// Live HLS asks for a playlist and a segment every couple of seconds, so these
// requests skip the general per-IP limiter and are limited per viewing here.
cctvPlayRouter.use(rateLimit({
  windowMs: 60_000, max: 400, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `cctv:${String(req.params?.sid ?? req.path.split('/')[1] ?? req.ip)}`,
  handler: (_req, res) => sendError(res, 'Too many playback requests.', 429, [], 'RATE_LIMITED'),
}));

function tokenOf(req) {
  const h = req.headers['x-playback-token'];
  if (typeof h === 'string' && h) return { token: h, inQuery: false };
  return { token: typeof req.query.t === 'string' ? req.query.t : null, inQuery: true };
}

/** Verifies the token, enters its school, and resolves the viewing. */
const play = (fn) => async (req, res, next) => {
  try {
    const { token, inQuery } = tokenOf(req);
    const v = verifyToken(token);
    if (v.error) throw new AppError(v.error === 'EXPIRED' ? 'The playback token has expired.' : 'Invalid playback token.', 401, [], `TOKEN_${v.error}`);
    if (v.payload.sid !== req.params.sid) throw new AppError('Invalid playback token.', 401, [], 'TOKEN_MISMATCH');
    await runWithTenant(v.payload.tid, async () => {
      const ctx = await cctv.resolvePlayback(req.params.sid, { ip: viewerIp(req), userAgent: req.headers['user-agent'] ?? null });
      await fn(req, res, ctx, { inQuery });
    });
  } catch (err) { next(err); }
};

function sendMedia(res, out) {
  res.set({
    'Content-Type': out.contentType,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Referrer-Policy': 'no-referrer',
  });
  res.status(200).end(out.body);
}

cctvPlayRouter.get('/:sid/index.m3u8', play(async (req, res, ctx, { inQuery }) => {
  sendMedia(res, await cctv.proxyHls(ctx, { ref: null, query: req.query, prefix: req.baseUrl, tokenInQuery: inQuery }));
}));
cctvPlayRouter.get('/:sid/r/:ref', play(async (req, res, ctx, { inQuery }) => {
  sendMedia(res, await cctv.proxyHls(ctx, { ref: req.params.ref, query: req.query, prefix: req.baseUrl, tokenInQuery: inQuery }));
}));
cctvPlayRouter.post('/:sid/whep', play(async (req, res, ctx) => {
  sendSuccess(res, await cctv.whepOffer(ctx, req.body?.sdp), 'OK');
}));
