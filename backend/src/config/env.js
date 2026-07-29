import 'dotenv/config';
import dns from 'dns';

// Configure DNS to prevent querySrv ECONNREFUSED on some networks (e.g. for MongoDB Atlas)
dns.setServers(['8.8.8.8', '1.1.1.1']);

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT) || 5000,
  HOST: process.env.HOST ?? '0.0.0.0',
  MONGO_URI: process.env.MONGO_URI_ATLAS ?? process.env.MONGO_URI ?? 'mongodb://localhost:27017/school_erp',
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
