#!/usr/bin/env node
/**
 * Staging preflight — checks the configuration a staging run would use,
 * without connecting to anything.
 *
 *   NODE_ENV=staging node scripts/staging-preflight.js
 *
 * Exits 0 only when every check passes. Prints no secret, no credential and no
 * database host — only which check passed or failed and why. Run it before
 * every staging start; it is the "explicitly verify" step in
 * docs/MCP-PRODUCTION-READINESS.md §3.
 *
 * What it will not do: open a database connection, start the server, or write
 * anything. A configuration that fails here must not be started.
 */
import crypto from 'crypto';
import {
  env, isPlaceholderSecret, isWhatsappLive, isWhatsappSignatureConfigured,
  assessDatabaseTarget, databaseGuardConfig,
} from '../src/config/env.js';

const results = [];
const check = (ok, label, detail = '') => results.push({ ok: Boolean(ok), label, detail });

const nodeEnv = process.env.NODE_ENV ?? '(unset)';
const guard = databaseGuardConfig();
const mongoUri = process.env.MONGO_URI ?? '';

check(nodeEnv === 'staging', 'NODE_ENV is "staging"', `it is "${nodeEnv}"`);
check(Boolean(mongoUri), 'MONGO_URI is set');
check(!process.env.MONGO_URI_ATLAS, 'MONGO_URI_ATLAS is unset', 'it is set — remove it from the staging environment');
check(guard.productionHosts.length > 0, 'PRODUCTION_DB_HOSTS names the production cluster(s)',
  'set it, so a staging box can prove it is not pointed at production');

const target = assessDatabaseTarget({ nodeEnv, uri: mongoUri, ...guard });
check(target.ok, 'MONGO_URI is not production, and a remote cluster is explicitly allowed', target.reason ?? '');
check(/\/[^/?]*staging[^/?]*(\?|$)/i.test(mongoUri) || /\/[^/?]*test[^/?]*(\?|$)/i.test(mongoUri),
  'the database name says staging or test', 'name the database e.g. eduos_staging');

check(!isPlaceholderSecret(env.MEDICAL_ENCRYPTION_KEY), 'MEDICAL_ENCRYPTION_KEY is a real key, not the shipped placeholder');
if (process.env.PRODUCTION_MEDICAL_KEY_SHA256) {
  const digest = crypto.createHash('sha256').update(String(env.MEDICAL_ENCRYPTION_KEY)).digest('hex');
  check(digest !== process.env.PRODUCTION_MEDICAL_KEY_SHA256.toLowerCase(), 'MEDICAL_ENCRYPTION_KEY differs from production');
} else {
  check(false, 'MEDICAL_ENCRYPTION_KEY differs from production',
    'set PRODUCTION_MEDICAL_KEY_SHA256 (the SHA-256 of the production key, never the key) so this can be proven');
}
check(!isPlaceholderSecret(env.JWT_SECRET) && env.JWT_SECRET.length >= 32, 'JWT_SECRET is real and at least 32 characters');
if (isWhatsappLive()) {
  check(isWhatsappSignatureConfigured(), 'WA_APP_SECRET is set (WhatsApp is live)');
}
check(env.PAYMENT_PROVIDER !== 'razorpay' || /test/i.test(env.RAZORPAY_KEY_ID), 'payments are sandbox or Razorpay test keys',
  'PAYMENT_PROVIDER=razorpay with a key that is not a test key');

const width = Math.max(...results.map((r) => r.label.length));
for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(width)}${r.ok || !r.detail ? '' : `  — ${r.detail}`}`);
}
const failed = results.filter((r) => !r.ok).length;
// eslint-disable-next-line no-console
console.log(failed ? `\n${failed} check(s) failed — do not start staging with this configuration.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
