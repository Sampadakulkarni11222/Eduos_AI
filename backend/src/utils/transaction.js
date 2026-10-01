import mongoose from 'mongoose';
import { logger } from './logger.js';

/**
 * Lets `runInAmbientTransaction` carry its session through every Mongoose
 * operation in its callback without each one being handed it explicitly.
 *
 * Only operations inside a `connection.transaction()` callback pick a session up
 * this way. Everything else — including `runInTransaction` below, which passes
 * its session by hand — behaves exactly as it did before this was set.
 */
mongoose.set('transactionAsyncLocalStorage', true);

/** True when the server cannot run transactions at all (a standalone mongod). */
function isStandaloneError(err) {
  return (
    err?.message?.includes('replica set') ||
    err?.message?.includes('Transaction numbers are only allowed on a replica set member') ||
    err?.code === 20
  );
}

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
    if (isStandaloneError(err)) {
      logger.warn('Transactions not supported on this MongoDB setup. Falling back to non-transactional execution.');
      return await fn(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * True while the current code is running inside runInAmbientTransaction's
 * transaction.
 *
 * Compensating writes need this. After a write fails inside a transaction the
 * server has already aborted it, so a "clean up what I wrote" operation fails
 * with a transient error — and a transient error retries the whole callback,
 * which fails the same way again until the retry budget runs out. Inside a
 * transaction the abort IS the clean-up; only outside one does code have to undo
 * its own writes.
 */
export function inAmbientTransaction() {
  return Boolean(mongoose.transactionAsyncLocalStorage?.getStore()?.session);
}

/**
 * Runs `fn` in a transaction that every Mongoose operation inside it joins
 * automatically — including operations in services `fn` calls, which know
 * nothing about sessions.
 *
 * For work that spans several services' writes (creating an account, a
 * profile and a student record) and must commit or roll back as one. A
 * transient error such as a write conflict retries the whole callback, which is
 * what makes a conflict-based lock inside it safe: the retry re-reads the state
 * the winning transaction committed.
 *
 * Falls back to running `fn` without a transaction on a standalone mongod, as
 * runInTransaction does. The standalone error is raised by the callback's first
 * database operation, before anything has been written.
 */
export async function runInAmbientTransaction(fn) {
  try {
    return await mongoose.connection.transaction(() => fn());
  } catch (err) {
    if (isStandaloneError(err)) {
      logger.warn('Transactions not supported on this MongoDB setup. Falling back to non-transactional execution.');
      return fn();
    }
    throw err;
  }
}
