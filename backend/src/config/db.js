import mongoose from 'mongoose';
import { env, assessDatabaseTarget, databaseGuardConfig } from './env.js';
import { logger } from '../utils/logger.js';
import dns from 'dns';

// Configure DNS to prevent querySrv ECONNREFUSED on some networks
dns.setServers(['8.8.8.8', '1.1.1.1']);

const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

/** Strips any user:password before a URI reaches the log file. */
function redactCredentials(uri) {
  return uri.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
}

export async function connectDB() {
  // Said before connecting, not after: if the URI is wrong, the reason the
  // process is about to exit should already be on screen.
  logger.info(
    `Connecting to MongoDB… (target=${redactCredentials(env.MONGO_URI)}, ` +
      `source=${env.MONGO_URI_SOURCE}, NODE_ENV=${env.NODE_ENV})`
  );
  // Before anything connects — and so before bootstrap() writes a single role —
  // a non-production process is refused a production or remote database it
  // has not been explicitly allowed. See assessDatabaseTarget() in env.js.
  const target = assessDatabaseTarget({ nodeEnv: env.NODE_ENV, uri: env.MONGO_URI, ...databaseGuardConfig() });
  if (!target.ok) {
    logger.error(`✘  Refusing to connect to MongoDB: ${target.reason}.`);
    process.exit(1);
  }
  if (env.MONGO_ATLAS_IGNORED) {
    logger.warn(
      'MONGO_URI_ATLAS is set but was IGNORED — Atlas is only used when NODE_ENV=production. ' +
        'Using the local MONGO_URI instead.'
    );
  }
  try {
    const conn = await mongoose.connect(env.MONGO_URI, MONGO_OPTIONS);
    const { host, port, name } = conn.connection;
    const kind = /mongodb\.net$/i.test(host) ? 'ATLAS (remote)' : 'LOCAL';
    logger.info(`✔  MongoDB connected  →  ${host}:${port}/${name}  [${kind}]`);
  } catch (err) {
    logger.error(`✘  MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * 'ok' when the database answers a ping within `timeoutMs`, else 'unavailable'.
 *
 * For the health endpoint, so a load balancer stops routing to an instance
 * that has lost its database. Reports a single word and nothing about the
 * target: no host, no name, no error text.
 */
export async function databaseHealth(timeoutMs = 1500) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return 'unavailable';
  let timer;
  try {
    const answered = await Promise.race([
      mongoose.connection.db.admin().ping().then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    return answered ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});
