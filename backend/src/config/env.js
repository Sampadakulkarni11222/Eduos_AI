import 'dotenv/config';
import dns from 'dns';

// Configure DNS to prevent querySrv ECONNREFUSED on some networks (e.g. for MongoDB Atlas)
dns.setServers(['8.8.8.8', '1.1.1.1']);

/**
 * Reads a numeric setting, treating a configured **0 as a real value**.
 *
 * The usual `Number(process.env.X) || fallback` idiom silently discards 0,
 * because 0 is falsy. That is harmless for a port or a TTL, where 0 is
 * meaningless anyway — but not for a quota. `AI_FREE_MONTHLY_CREDITS=0` means
 * "no free tier", and the `|| 50` form quietly handed out 50 free AI answers
 * instead. A billing setting that ignores what you configured is worse than one
 * that refuses to start.
 *
 * Anything non-numeric or negative falls back, since those are typos rather
 * than intent.
 */
export function numFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const LOCAL_MONGO_FALLBACK = 'mongodb://localhost:27017/school_erp';

/**
 * Chooses the MongoDB URI, and refuses to reach production from a dev box.
 *
 * This used to be `MONGO_URI_ATLAS ?? MONGO_URI ?? local`, which meant a single
 * stray value in a committed `.env` silently pointed every local run — and every
 * `npm run seed`, which drops collections — at the live cluster. It also broke
 * file downloads in a way that looked unrelated: records came from Atlas while
 * the referenced uploads only ever existed on the server's disk.
 *
 * Atlas is now opt-in by environment, not by variable presence: outside
 * production `MONGO_URI_ATLAS` is ignored even when set. Returns the source
 * alongside the URI so startup can say out loud which database it picked.
 */
export function resolveMongoUri(processEnv = process.env) {
  const nodeEnv = processEnv.NODE_ENV ?? 'development';
  const atlas = processEnv.MONGO_URI_ATLAS;
  const local = processEnv.MONGO_URI;

  if (nodeEnv === 'production') {
    if (atlas) return { uri: atlas, source: 'MONGO_URI_ATLAS', atlasIgnored: false };
    if (local) return { uri: local, source: 'MONGO_URI', atlasIgnored: false };
    return { uri: LOCAL_MONGO_FALLBACK, source: 'default', atlasIgnored: false };
  }

  return {
    uri: local ?? LOCAL_MONGO_FALLBACK,
    source: local ? 'MONGO_URI' : 'default',
    // Surfaced so the connection log can explain the override rather than
    // leaving someone to wonder why their Atlas URI "did nothing".
    atlasIgnored: Boolean(atlas),
  };
}

const mongo = resolveMongoUri();

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT) || 5000,
  HOST: process.env.HOST ?? '0.0.0.0',
  MONGO_URI: mongo.uri,
  MONGO_URI_SOURCE: mongo.source,
  MONGO_ATLAS_IGNORED: mongo.atlasIgnored,
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  LOG_DIR: process.env.LOG_DIR ?? 'logs',
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900_000,
  // General API limit. The old default of 100/15min starved normal dashboard
  // usage (each page fires several XHRs); 2000/15min ≈ 2 req/s sustained.
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 2000,
  // Stricter limit for credential endpoints (login / OTP request+verify).
  RATE_LIMIT_AUTH_MAX: Number(process.env.RATE_LIMIT_AUTH_MAX) || 30,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  // Defaults to true in development, false in production
  SWAGGER_ENABLED: process.env.SWAGGER_ENABLED !== undefined
    ? process.env.SWAGGER_ENABLED === 'true'
    : (process.env.NODE_ENV ?? 'development') !== 'production',
  JWT_SECRET: process.env.JWT_SECRET ?? 'change-this-secret-in-production',
  // When false, accounts always auto-select a single profile (the most
  // recently created one) instead of being asked to pick — useful for
  // deployments where every person only ever has one role.
  MULTI_PROFILE_ENABLED: process.env.MULTI_PROFILE_ENABLED !== 'false',
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN ?? '15m',
  REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30,
  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES) || 5,
  OTP_MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
  MEDICAL_ENCRYPTION_KEY: process.env.MEDICAL_ENCRYPTION_KEY ?? 'change-this-medical-key-in-production',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN ?? 'change-this-verify-token',
  // ── Provider abstractions (all optional — safe fallbacks in dev) ──
  // Google Sign-In: when set, /auth/google verifies the ID token audience.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  // SMS/Email OTP delivery: 'console' logs the code and returns devOtp
  // outside production; a real provider module can be added per key.
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'console',
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'console',
  // Online payments: 'sandbox' completes payments against the real ledger
  // with a SANDBOX- reference (clearly labeled in the UI); 'none' disables
  // online payment; real gateways plug in via this same interface.
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? 'sandbox',
  // Razorpay (PAYMENT_PROVIDER=razorpay). The key secret signs API calls; the
  // webhook secret is a *separate* value set in the Razorpay dashboard and is
  // what proves an incoming "payment captured" event is genuine.
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  RAZORPAY_API_BASE: process.env.RAZORPAY_API_BASE ?? 'https://api.razorpay.com/v1',
  RAZORPAY_CURRENCY: process.env.RAZORPAY_CURRENCY ?? 'INR',
  // File uploads
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? 'uploads',
  UPLOAD_MAX_BYTES: Number(process.env.UPLOAD_MAX_BYTES) || 15 * 1024 * 1024,
  // Branding used on generated documents (e.g. ID cards)
  SCHOOL_NAME: process.env.SCHOOL_NAME ?? 'Oakridge Academy',
  // AI copilot: set ANTHROPIC_API_KEY (or compatible) to upgrade the
  // deterministic data-grounded assistant to a full LLM integration.
  AI_PROVIDER: process.env.AI_PROVIDER ?? 'rules',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

// ─── Production safety gate ───────────────────────────────
// The development defaults above are deliberately weak so the app runs out of
// the box. Booting production with any of them still set means anyone holding
// a copy of this repo can forge sessions, decrypt medical records, or pass the
// WhatsApp webhook handshake — so refuse to start instead.
if (env.isProd) {
  const insecure = [];
  if (env.JWT_SECRET === 'change-this-secret-in-production') insecure.push('JWT_SECRET');
  if (env.JWT_SECRET.length < 32) insecure.push('JWT_SECRET (must be ≥32 characters)');
  if (env.MEDICAL_ENCRYPTION_KEY === 'change-this-medical-key-in-production') insecure.push('MEDICAL_ENCRYPTION_KEY');
  if (env.WHATSAPP_VERIFY_TOKEN === 'change-this-verify-token') insecure.push('WHATSAPP_VERIFY_TOKEN');
  if (env.CORS_ORIGIN === '*') insecure.push('CORS_ORIGIN (must name your frontend origin)');
  // A sandbox gateway in production marks invoices Paid without money moving.
  if (env.PAYMENT_PROVIDER === 'sandbox') insecure.push('PAYMENT_PROVIDER=sandbox (simulates payments — use a real gateway or "none")');
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    if (!env.RAZORPAY_KEY_ID) insecure.push('RAZORPAY_KEY_ID');
    if (!env.RAZORPAY_KEY_SECRET) insecure.push('RAZORPAY_KEY_SECRET');
    // Without this, webhook signatures cannot be checked, and an unauthenticated
    // POST could mark any invoice paid.
    if (!env.RAZORPAY_WEBHOOK_SECRET) insecure.push('RAZORPAY_WEBHOOK_SECRET (required to authenticate payment webhooks)');
  }

  if (insecure.length) {
    // eslint-disable-next-line no-console
    console.error(
      `\nFATAL: refusing to start in production with insecure defaults:\n` +
        insecure.map((k) => `  • ${k}`).join('\n') +
        `\nSet these to real values in the environment and restart.\n`
    );
    process.exit(1);
  }
}
