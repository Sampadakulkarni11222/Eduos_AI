import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Spins up a real MongoDB for the test run.
 *
 * A *replica set* rather than a standalone, deliberately: transactions and
 * `session.withTransaction` only work on a replica set, and the money paths
 * under test depend on them. A standalone would silently take
 * runInTransaction's non-transactional fallback and the tests would pass
 * without ever exercising the behaviour they claim to cover.
 */
let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'eduos-test' });
}, 120_000);

afterEach(async () => {
  // Clear rather than drop: dropping removes the indexes the models declared at
  // connect time, and several tests rely on unique indexes actually being
  // enforced (admission numbers, elective registrations).
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
