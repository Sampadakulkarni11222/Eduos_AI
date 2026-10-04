import morgan from 'morgan';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// The Chatflow webhook URL carries a shared secret as ?token=…; keep it out of
// access logs. Overrides morgan's built-in :url, which both formats use.
morgan.token('url', (req) => String(req.originalUrl || req.url).replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]'));

const stream = {
  write: (message) => logger.http(message.trim()),
};

export const requestLogger = morgan(
  env.isDev ? 'dev' : 'combined',
  { stream }
);
