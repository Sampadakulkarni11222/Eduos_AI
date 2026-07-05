import mongoose from 'mongoose';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { sendError } from '../../utils/response.js';

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export const ready = asyncHandler(async (_req, res) => {
  const state = READY_STATES[mongoose.connection.readyState] ?? 'unknown';
  if (state !== 'connected') {
    return sendError(res, `Database not ready (${state})`, 503);
  }
  sendSuccess(res, { database: state }, 'Ready');
});

export const metrics = asyncHandler(async (_req, res) => {
  const mem = process.memoryUsage();
  sendSuccess(
    res,
    {
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      database: READY_STATES[mongoose.connection.readyState] ?? 'unknown',
      nodeVersion: process.version,
    },
    'Metrics fetched'
  );
});
