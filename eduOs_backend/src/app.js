import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { swaggerSpec } from './config/swagger.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

const app = express();

// ─── Status Page (public/) ────────────────────────────────
app.use(express.static(join(__dirname, '..', 'public')));

// ─── Security & Compression ───────────────────────────────
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(compression());

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
