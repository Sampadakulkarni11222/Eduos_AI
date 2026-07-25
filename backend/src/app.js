import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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


import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { swaggerSpec } from './config/swagger.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sendError } from './utils/response.js';
import apiRoutes from './routes/index.js';

const app = express();

// ─── Status Page (public/) ────────────────────────────────
app.use(express.static(join(__dirname, '..', 'public')));

// ─── Uploaded files (documents, course material, submissions) ──
app.use('/uploads', express.static(join(process.cwd(), env.UPLOAD_DIR)));
// A missing/evicted file falls through express.static's next() — answer with
// a friendly JSON 404 here instead of letting it reach the generic API
// notFoundHandler, which would otherwise leak "Cannot GET /uploads/…".
app.use('/uploads', (req, res) => {
  sendError(res, 'This file could not be found. It may have been removed or is temporarily unavailable.', 404, [], 'FILE_NOT_FOUND');
});

// ─── Security & Compression ───────────────────────────────
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(apiCompressionMiddleware);

// ─── Body Parsing ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
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

export default app;
