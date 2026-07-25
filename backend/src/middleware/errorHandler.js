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

  sendError(
    res,
    message,
    statusCode,
    env.isDev && !error.isOperational ? [err.stack] : errors,
    error.code ?? null
  );
}

export function notFoundHandler(req, res) {
  sendError(res, `Cannot ${req.method} ${req.originalUrl}`, 404);
}
