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

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    error = new AppError(`Duplicate value for '${field}'`, 409);
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
    env.isDev && !error.isOperational ? [err.stack] : errors
  );
}

export function notFoundHandler(req, res) {
  sendError(res, `Cannot ${req.method} ${req.originalUrl}`, 404);
}
