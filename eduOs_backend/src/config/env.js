import 'dotenv/config';

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT) || 5000,
  HOST: process.env.HOST ?? 'localhost',
  MONGO_URI: process.env.MONGO_URI ?? 'mongodb://localhost:27017/school_erp',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  LOG_DIR: process.env.LOG_DIR ?? 'logs',
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900_000,
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 100,
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
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};
