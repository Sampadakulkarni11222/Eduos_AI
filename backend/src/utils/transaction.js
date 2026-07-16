import mongoose from 'mongoose';
import { logger } from './logger.js';

/**
 * Executes a callback function within a Mongoose transaction.
 * If the MongoDB server configuration does not support transactions (e.g. local standalone server),
 * it logs a warning and falls back to non-transactional execution.
 * 
 * @param {function(session: mongoose.ClientSession|null): Promise<T>} fn 
 * @returns {Promise<T>}
 */
export async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const isStandalone = 
      err.message?.includes('replica set') || 
      err.message?.includes('Transaction numbers are only allowed on a replica set member') ||
      err.code === 20;
      
    if (isStandalone) {
      logger.warn('Transactions not supported on this MongoDB setup. Falling back to non-transactional execution.');
      return await fn(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}
