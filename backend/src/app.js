import { fileURLToPath } from 'url';
import { dirname, extname, join } from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import zlib from 'zlib';
import swaggerUi from 'swagger-ui-express';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Setup Brotli / Gzip compression negotiator
const gzipMiddleware = compression({
  threshold: 1024,
  filter: (req, res) => {
    if (res.getHeader('Content-Encoding') || res.getHeader('Cache-Control')?.includes('no-transform')) {
      return false;
    }
    return compression.filter(req, res);
  }
});

function apiCompressionMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  if (acceptEncoding.includes('br')) {
    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];

    res.write = function (chunk, encoding, callback) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      if (typeof callback === 'function') callback();
      return true;
    };

    res.end = function (chunk, encoding, callback) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      
      const buffer = Buffer.concat(chunks);
      
      const contentEncoding = res.getHeader('Content-Encoding');
      const cacheControl = res.getHeader('Cache-Control');
      const contentType = res.getHeader('Content-Type') || '';
      
      const isCompressible = /json|text|javascript|css|xml|html/i.test(contentType);
      const isEventStream = contentType.includes('event-stream');
      
      const shouldCompress = !contentEncoding && 
                             !isEventStream &&
                             (!cacheControl || !cacheControl.includes('no-transform')) &&
                             isCompressible && 
                             buffer.length >= 1024;

      if (!shouldCompress) {
        res.write = originalWrite;
        res.end = originalEnd;
        return res.end(buffer, encoding, callback);
      }

      zlib.brotliCompress(buffer, (err, compressed) => {
        res.write = originalWrite;
        res.end = originalEnd;
        if (err) {
          return res.end(buffer, encoding, callback);
        }
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Length', compressed.length);
        res.end(compressed, encoding, callback);
      });
    };

    next();
  } else {
    gzipMiddleware(req, res, next);
  }
}


import { env, isWhatsappLive, isWhatsappSignatureConfigured, isChatflowLive, isChatflowWebhookAuthConfigured } from './config/env.js';
import { llmConfigSummary } from './providers/ai.provider.js';
import { connectDB } from './config/db.js';
import { swaggerSpec } from './config/swagger.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sendError } from './utils/response.js';
import apiRoutes from './routes/index.js';
import { corsOrigin } from './modules/domains/domain.cors.js';
import { requireSignedUploadUrl } from './modules/uploads/signedUrls.js';

const app = express();

// Render/any reverse proxy terminates TLS and forwards the real client IP in
// X-Forwarded-For. Without this, req.ip is the proxy's address, so every user
// shares a single rate-limit bucket (one noisy client locks out the school).
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────
// Must be mounted BEFORE any static handler, or uploaded files and the status
// page are served with no security headers at all.
app.use(helmet());
// The configured frontend origin, plus https on any school's ACTIVE domain — a
// portal served at www.abcschool.com calls this API cross-origin, and must be
// allowed to exactly when, and only while, that domain is live. A pending or
// deactivated domain is not in the list. See modules/domains/domain.service.js.
app.use(cors({ origin: corsOrigin }));

// ─── Status Page (public/) ────────────────────────────────
app.use(express.static(join(__dirname, '..', 'public')));

// ─── Uploaded files (documents, course material, submissions) ──
// User-supplied content served from our own origin: force a download instead
// of inline rendering and forbid MIME sniffing, so an uploaded HTML/SVG file
// can't execute script in this origin's context.
//
// Raster images are the exception, and have to be. helmet() sets
// Cross-Origin-Resource-Policy: same-origin, and the portal runs on a different
// origin from the API (:3000 vs :5000), so the browser refused every <img>
// pointing here — a profile photo uploaded successfully and then rendered as a
// broken icon, with a 200 and valid JPEG bytes on the wire.
//
// The exception is deliberately narrow: only formats that cannot carry script,
// listed explicitly rather than by a `image/*` prefix. SVG is NOT among them —
// it is an XML document that can execute script, and serving one inline
// cross-origin is exactly the hole the rules above exist to close.
const INLINE_IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.ico']);

// Nothing under /uploads is served without a valid, unexpired signature — the
// links the API hands out to callers entitled to the record they belong to.
app.use('/uploads', requireSignedUploadUrl);
app.use(
  '/uploads',
  (req, res, next) => {
    const ext = extname(req.path).toLowerCase();
    const isSafeImage = INLINE_IMAGE_TYPES.has(ext);

    res.setHeader('Content-Disposition', isSafeImage ? 'inline' : 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (isSafeImage) {
      // Lets the portal render it. Access is already decided by the signed
      // link above, so this widens embedding, not access.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    // A signed link is a bearer credential for its lifetime; keep it out of
    // shared caches and out of the Referer of anything the file links to.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  },
  express.static(join(process.cwd(), env.UPLOAD_DIR))
);
// A missing/evicted file falls through express.static's next() — answer with
// a friendly JSON 404 here instead of letting it reach the generic API
// notFoundHandler, which would otherwise leak "Cannot GET /uploads/…".
app.use('/uploads', (req, res) => {
  sendError(res, 'This file could not be found. It may have been removed or is temporarily unavailable.', 404, [], 'FILE_NOT_FOUND');
});

// ─── Compression ──────────────────────────────────────────
app.use(apiCompressionMiddleware);

// ─── Body Parsing ─────────────────────────────────────────
// The raw body is retained so the WhatsApp webhook can verify Meta's
// X-Hub-Signature-256 HMAC, which is computed over the exact bytes sent.
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request Logging ──────────────────────────────────────
app.use(requestLogger);

// ─── Rate Limiting ────────────────────────────────────────
app.use('/api', rateLimiter);

// ─── API Docs ─────────────────────────────────────────────
if (env.SWAGGER_ENABLED) {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'School ERP API Docs',
      swaggerOptions: { persistAuthorization: true },
    })
  );
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
}

// ─── API Routes ───────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// ─── 404 & Error Handlers ─────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────
async function bootstrap() {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('  School ERP Backend  —  starting up');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Database ──
  await connectDB();

  // Auto-sync permissions and system roles on boot
  try {
    const { Permission } = await import('./models/permission.model.js');
    const { Role } = await import('./models/role.model.js');
    const { PERMISSION_CATALOG, SYSTEM_ROLES } = await import('./constants/permissions.js');

    for (const p of PERMISSION_CATALOG) {
      await Permission.updateOne(
        { key: p.key },
        { $set: { group: p.group, description: p.description, isSystem: true } },
        { upsert: true }
      );
    }
    for (const r of SYSTEM_ROLES) {
      await Role.updateOne(
        { key: r.key },
        {
          $set: {
            name: r.name,
            description: r.description ?? '',
            isSystem: true,
            permissions: r.grants,
          },
        },
        { upsert: true }
      );
    }
    logger.info('✔  System roles and permissions auto-synced with DB');

    // An agent tool naming a permission that doesn't exist fails closed for
    // everyone and looks identical to "you lack that permission" at the call
    // site, so surface it loudly at boot rather than as a silent dead tool.
    const { validateToolPermissions } = await import('./modules/ai/agent/tools.js');
    const badTools = validateToolPermissions(PERMISSION_CATALOG.map((p) => p.key));
    if (badTools.length) {
      logger.error(`✘  Agent tools reference unknown permissions: ${badTools.join(', ')}`);
    } else {
      logger.info('✔  Agent tool permissions validated against the catalog');
    }

    // The same check for the MCP catalog, plus the invariants that cannot be
    // made at import time: every wrapped agent tool exists, every write can
    // describe itself for confirmation, and no tool names a permission the
    // school does not have. A tool that fails any of these fails closed and
    // looks identical to "you lack that permission" at the call site, so it is
    // surfaced loudly here instead.
    const { validateMcpRegistry, mcpPermissionsUsed, mcpCatalogStats } = await import('./modules/ai/mcp/registry.js');
    const knownPermissions = new Set(PERMISSION_CATALOG.map((p) => p.key));
    const badMcp = [
      ...validateMcpRegistry(),
      ...mcpPermissionsUsed().filter((p) => !knownPermissions.has(p)).map((p) => `unknown permission "${p}"`),
    ];
    if (badMcp.length) {
      logger.error(`✘  MCP tool catalog is inconsistent: ${badMcp.join('; ')}`);
    } else {
      const stats = mcpCatalogStats();
      logger.info(
        `✔  MCP server ready  →  ${stats.total} ERP tools ` +
          `(${Object.entries(stats.byOperation).map(([op, n]) => `${n} ${op}`).join(', ')})`
      );
    }
  } catch (syncErr) {
    logger.error(`✘  Failed to auto-sync roles/permissions: ${syncErr.message}`);
  }

  // ── Logger ──
  logger.info(`✔  Logger initialized  →  level: ${env.LOG_LEVEL}, dir: ${env.LOG_DIR}/`);

  // ── Rate Limiter ──
  logger.info(
    `✔  Rate limiter active  →  ${env.RATE_LIMIT_MAX} req / ${env.RATE_LIMIT_WINDOW_MS / 60_000} min per IP`
  );

  // ── CORS ──
  logger.info(`✔  CORS enabled  →  origin: ${env.CORS_ORIGIN}`);

  // ── WhatsApp ──
  // Said out loud at boot because the failure is otherwise silent: webhooks
  // just stop arriving, and nothing in the app looks wrong.
  if (isWhatsappLive()) {
    if (isWhatsappSignatureConfigured()) {
      logger.info('✔  WhatsApp live  →  inbound webhook signatures verified');
    } else if (env.isDev) {
      logger.warn(
        '✘  WhatsApp is LIVE but WA_APP_SECRET is unset or still a placeholder. ' +
          'Inbound webhooks are being accepted UNVERIFIED because this is development — ' +
          'any deployment reachable from the internet must set it to the App Secret ' +
          'from the Meta app dashboard.'
      );
    } else {
      logger.error(
        '✘  WhatsApp is LIVE but WA_APP_SECRET is unset or still a placeholder — ' +
          'inbound webhooks cannot be authenticated and are being REFUSED. ' +
          'Set it to the App Secret from the Meta app dashboard.'
      );
    }
  } else {
    logger.info('-  WhatsApp simulation mode  →  set WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN to go live');
  }

  // ── WhatsApp via Chatflow-Pro ──
  if (isChatflowLive()) {
    logger.info(
      `✔  Chatflow-Pro live  →  replies via ${env.CHATFLOW_API_URL}/messages; ` +
        `webhook ${isChatflowWebhookAuthConfigured() ? 'authenticated' : 'UNAUTHENTICATED (dev only)'} at /api/v1/whatsapp/chatflow/webhook`
    );
    if (isWhatsappLive()) {
      logger.warn('!  Both Meta (WA_*) and Chatflow-Pro are live — make sure Meta delivers to Chatflow, not to /whatsapp/webhook, or users get two replies.');
    }
  } else {
    logger.info('-  Chatflow-Pro not configured  →  set CHATFLOW_API_URL / CHATFLOW_API_KEY to go live');
  }

  // ── AI model ──
  // Said at boot so a deployment's model setup can be checked from its log:
  // which provider and model id are in use, and whether a key is present.
  {
    const ai = llmConfigSummary();
    if (ai.enabled) {
      logger.info(`✔  AI model  →  ${ai.provider} / ${ai.model ?? 'n/a'}, key ${ai.keyPresent ? 'present' : 'MISSING'}${ai.openRouterFallback ? ', OpenRouter fallback' : ''}, timeout ${ai.timeoutMs}ms`, { event: 'llm_config', ...ai });
    } else {
      logger.warn(`✘  AI model off  →  AI_PROVIDER=${ai.provider}${ai.provider !== 'rules' ? ' but its API key is missing' : ''}; Ask AI uses rules only`, { event: 'llm_config', ...ai });
    }
  }

  // ── Swagger ──
  if (env.SWAGGER_ENABLED) {
    logger.info('✔  Swagger UI enabled');
  } else {
    logger.warn('✘  Swagger UI disabled  →  set SWAGGER_ENABLED=true to enable');
  }

  // ── Static / Status page ──
  logger.info('✔  Static files mounted  →  public/');

  // ── HTTP Server ──
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`  Environment  :  ${env.NODE_ENV}`);
    logger.info(`  API          :  http://${env.HOST}:${env.PORT}/api/v1`);
    logger.info(`  Status page  :  http://${env.HOST}:${env.PORT}/status.html`);
    if (env.SWAGGER_ENABLED) {
      logger.info(`  API Docs     :  http://${env.HOST}:${env.PORT}/api-docs`);
    }
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('  Server is ready to accept connections  🚀');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  server.on('error', (error) => {
    logger.error(`Server startup failed: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use. Set a different PORT or stop the conflicting process.`);
    }
    process.exit(1);
  });
}

bootstrap();

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error?.stack || error}`);
});

export default app;
