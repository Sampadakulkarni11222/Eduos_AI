import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

export async function connectDB() {
  logger.info('Connecting to MongoDB…');
  try {
    const conn = await mongoose.connect(env.MONGO_URI, MONGO_OPTIONS);
    const { host, port, name } = conn.connection;
    logger.info(`✔  MongoDB connected  →  ${host}:${port}/${name}`);
  } catch (err) {
    logger.error(`✘  MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});
