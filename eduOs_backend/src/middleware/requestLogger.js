import morgan from 'morgan';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

const stream = {
  write: (message) => logger.http(message.trim()),
};

export const requestLogger = morgan(
  env.isDev ? 'dev' : 'combined',
  { stream }
);
