import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { env } from '../config/env.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack }) =>
    stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${message}`
  )
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const fileTransportOptions = (level) => ({
  level,
  dirname: env.LOG_DIR,
  filename: `%DATE%-${level}.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  format: combine(timestamp(), errors({ stack: true }), json()),
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: env.isDev ? devFormat : prodFormat,
  transports: [
    new winston.transports.Console(),
    new DailyRotateFile(fileTransportOptions('error')),
    new DailyRotateFile({ ...fileTransportOptions('info'), filename: '%DATE%-combined.log' }),
  ],
  exceptionHandlers: [
    new DailyRotateFile({ ...fileTransportOptions('error'), filename: '%DATE%-exceptions.log' }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({ ...fileTransportOptions('error'), filename: '%DATE%-rejections.log' }),
  ],
});
