/**
 * Boots the real backend against a throwaway in-memory MongoDB.
 *
 * Exists because `.env` points MONGO_URI at the live Atlas cluster, which made
 * "just run it and see" unsafe — so nothing in this app had ever actually been
 * started. This gives a real server on a real (ephemeral) database with no way
 * to touch production data.
 *
 *   node scripts/run-local.js            # boot and stay up
 *   node scripts/run-local.js --seed     # boot with one admin account seeded
 *
 * Prints the credentials it creates. Everything is discarded on exit.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import process from 'node:process';

const SEED = process.argv.includes('--seed');
const PORT = process.env.PORT ?? '5000';

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const uri = replSet.getUri('eduos-local');
console.log(`\n  in-memory MongoDB ready\n  ${uri}\n`);

if (SEED) {
  const mongoose = (await import('mongoose')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const { Account } = await import('../src/models/account.model.js');
  const { Profile } = await import('../src/models/profile.model.js');
  const { Role } = await import('../src/models/role.model.js');
  const { SYSTEM_ROLES } = await import('../src/constants/permissions.js');

  await mongoose.connect(uri);
  const adminDef = SYSTEM_ROLES.find((r) => r.key === 'ADMIN');
  const role = await Role.create({
    key: adminDef.key,
    name: adminDef.name,
    isSystem: true,
    permissions: adminDef.grants,
  });
  const account = await Account.create({
    phoneE164: '+919900000000',
    email: 'admin@local.test',
    passwordHash: await bcrypt.hash('localdev123', 10),
  });
  await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'Local Admin' });
  await mongoose.disconnect();
  console.log('  seeded  admin@local.test / localdev123\n');
}

const child = spawn(process.execPath, ['src/app.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    // Overrides whatever .env says, so Atlas is never reachable from this run.
    MONGO_URI: uri,
    MONGO_URI_ATLAS: '',
    PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    JWT_SECRET: process.env.JWT_SECRET ?? 'local-dev-secret-not-for-production',
    MEDICAL_ENCRYPTION_KEY: process.env.MEDICAL_ENCRYPTION_KEY ?? 'local-dev-medical-key',
    SMS_PROVIDER: 'console',
    EMAIL_PROVIDER: 'console',
    PAYMENT_PROVIDER: 'none',
    // Raised for local work only: the production default (30 sign-ins per
    // 15 minutes per IP) is correct in production but trips immediately when
    // you are scripting a walkthrough across many accounts from one machine.
    RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX ?? '10000',
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? '100000',
  },
});

const shutdown = async () => {
  child.kill();
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', async (code) => {
  await replSet.stop();
  process.exit(code ?? 0);
});
