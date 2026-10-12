import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/response.js';
import { env } from '../config/env.js';

export function errorHandler(err, req, res, next) {
  let error = err;

  // Mongoose cast error (invalid ObjectId)
  if (err instanceof mongoose.Error.CastError) {
    error = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  // Mongoose validation error
  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((e) => e.message);
    error = new AppError('Validation failed', 422, messages);
  }

  // Mongoose duplicate key error — map the raw DB field name to something a
  // user filling out a form actually recognizes (e.g. creating a user with
  // a phone/email that's already registered) instead of "Duplicate value
  // for 'phoneE164'".
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    const FRIENDLY_FIELD = {
      phoneE164: 'phone number',
      email: 'email address',
      admissionNo: 'admission number',
    };
    const label = FRIENDLY_FIELD[field] ?? field;
    error = new AppError(`This ${label} is already in use by another account.`, 409, [], 'DUPLICATE_VALUE');
  }

  const statusCode = error.statusCode ?? 500;
  const message = error.isOperational ? error.message : 'Internal server error';
  const errors = error.errors ?? [];

  if (!error.isOperational) {
    logger.error(err);
  }

  // A stack trace is never part of a response unless somebody asked for it by
  // name. It used to be sent whenever the process was in development mode --
  // and "development" is what NODE_ENV defaults to, so any deployment that did
  // not set it (docker-compose ships `development`) answered an unexpected
  // failure with the whole stack: internal file paths, module names, sometimes
  // a connection string, in the body of a 500 that a browser or a tester's
  // screenshot then carried anywhere. The full error is in the server log
  // above, which is where a developer reads it. DEBUG_ERROR_STACKS=true puts it
  // back in the response for local debugging, and is ignored in production.
  const exposeStack = env.isDev && !env.isProd && process.env.DEBUG_ERROR_STACKS === 'true' && !error.isOperational;

  sendError(
    res,
    message,
    statusCode,
    exposeStack ? [err.stack] : errors,
    error.code ?? null
  );
}

export function notFoundHandler(req, res) {
  sendError(res, `Cannot ${req.method} ${req.originalUrl}`, 404);
}
