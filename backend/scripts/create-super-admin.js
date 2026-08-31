/**
 * Provisions the first Super Admin.
 *
 * The demo seeder (`npm run seed`) refuses to run outside development because
 * its password is public in this repo's history — which is correct, and which
 * leaves production with no way to create the one account that manages schools
 * and School Admins. This script is that way: one deliberate account, a
 * password supplied by the operator through the environment, and no demo data.
 *
 *   SUPER_ADMIN_PASSWORD='…' node scripts/create-super-admin.js \
 *     --name "Asha Menon" --phone +919876543210 --email asha@example.com
 *
 * Flags:
 *   --name          required, the display name on the profile
 *   --phone         required, E.164 (the account's identity in this system)
 *   --email         optional, needed for email + password sign-in
 *   --set-password  overwrite the password on an account that already has one
 *   --allow-remote  required when the target database is not local
 *
 * The password is read from SUPER_ADMIN_PASSWORD, never from a flag, so it
 * does not land in shell history or the process list. It is never printed.
 *
 * Safe to re-run: an existing account gains a SUPER_ADMIN profile rather than
 * being duplicated, and an account that already has one is left alone.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { DEMO_PASSWORD } from '../src/constants/demoUsers.js';

const SUPER_ADMIN_ROLE_KEY = 'SUPER_ADMIN';
const MIN_PASSWORD_LENGTH = 12;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads `--flag value` / `--flag=value` off argv. */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1]?.startsWith('--') ? '' : process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  logger.error(message);
  process.exit(1);
}

async function main() {
  const name = arg('name')?.trim();
  const phone = arg('phone')?.trim();
  const email = arg('email')?.trim().toLowerCase() || undefined;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  // ── Input ─────────────────────────────────────────────────
  if (!name || !phone) {
    fail('Usage: SUPER_ADMIN_PASSWORD=\'…\' node scripts/create-super-admin.js --name "Full Name" --phone +919876543210 [--email you@example.com]');
  }
  if (name.length < 2 || name.length > 120) fail('--name must be between 2 and 120 characters.');
  if (!E164.test(phone)) fail('--phone must be in E.164 format, e.g. +919876543210.');
  if (email && !EMAIL_RE.test(email)) fail('--email is not a valid email address.');
  if (!password) {
    fail('Set SUPER_ADMIN_PASSWORD in the environment. It is deliberately not a command-line flag.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. This account can administer every school.`);
  }
  if (password === DEMO_PASSWORD) {
    fail('SUPER_ADMIN_PASSWORD is the public demo password from this repo\'s history. Choose a real secret.');
  }

  // ── Target database ───────────────────────────────────────
  const safeUri = env.MONGO_URI.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
  const isLocal = /localhost|127\.0\.0\.1/.test(env.MONGO_URI);
  if (!isLocal && !flag('allow-remote')) {
    fail(`REFUSING to write to a non-local database (${safeUri}). Re-run with --allow-remote if you are certain.`);
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info(`Connected to MongoDB → ${safeUri} (NODE_ENV=${env.NODE_ENV})`);

  // ── The role ──────────────────────────────────────────────
  // Normally already present: app.js upserts the catalog and system roles on
  // every boot. Upserted here too so this script works against a database the
  // new build has not started against yet.
  const roleDef = SYSTEM_ROLES.find((r) => r.key === SUPER_ADMIN_ROLE_KEY);
  if (!roleDef) fail(`${SUPER_ADMIN_ROLE_KEY} is missing from the system role catalog.`);

  for (const p of PERMISSION_CATALOG) {
    await Permission.updateOne(
      { key: p.key },
      { $set: { group: p.group, description: p.description, isSystem: true } },
      { upsert: true },
    );
  }
  await Role.updateOne(
    { key: roleDef.key },
    { $set: { name: roleDef.name, description: roleDef.description ?? '', isSystem: true, permissions: roleDef.grants } },
    { upsert: true },
  );
  const role = await Role.findOne({ key: SUPER_ADMIN_ROLE_KEY });
  logger.info(`✔  ${SUPER_ADMIN_ROLE_KEY} role present with ${role.permissions.length} permissions`);

  // ── The account ───────────────────────────────────────────
  let account = await Account.findOne({ phoneE164: phone });
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

  if (!account) {
    if (email && (await Account.findOne({ email }))) {
      fail(`Another account already uses ${email}. Re-run with the phone number that owns it, or a different email.`);
    }
    account = await Account.create({ phoneE164: phone, ...(email && { email }), passwordHash });
    logger.info(`✔  Account created for ${phone}`);
  } else {
    logger.info(`-  Account for ${phone} already exists — reusing it`);
    if (account.status !== 'ACTIVE') {
      account.status = 'ACTIVE';
      logger.info('✔  Account status set back to ACTIVE');
    }
    if (email && !account.email) account.email = email;
    if (!account.passwordHash || flag('set-password')) {
      account.passwordHash = passwordHash;
      // A password reset also clears a live lockout, which is otherwise the
      // reason an operator is running this a second time.
      account.failedLoginAttempts = 0;
      account.lockoutUntil = null;
      logger.info('✔  Password set');
    } else {
      logger.warn('-  Account already has a password — left unchanged (pass --set-password to overwrite)');
    }
    await account.save();
  }

  // ── The profile ───────────────────────────────────────────
  const existing = await Profile.findOne({ accountId: account._id, roleId: role._id });
  if (existing) {
    if (existing.status !== 'ACTIVE' || existing.deletedAt) {
      existing.status = 'ACTIVE';
      existing.deletedAt = null;
      await existing.save();
      logger.info('✔  Existing Super Admin profile reactivated');
    } else {
      logger.info('-  This account already holds an ACTIVE Super Admin profile — nothing to do');
    }
  } else {
    await Profile.create({ accountId: account._id, roleId: role._id, displayName: name });
    logger.info(`✔  Super Admin profile created for "${name}"`);
  }

  const total = await Profile.countDocuments({ roleId: role._id, deletedAt: null });
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`  Super Admins on this deployment : ${total}`);
  logger.info(`  Sign in with                    : ${email ?? account.email ?? `phone ${phone} (OTP)`}`);
  logger.info('  Portal                          : /super-admin');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(`Failed to create the Super Admin: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
