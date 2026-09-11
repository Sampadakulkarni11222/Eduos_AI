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

/**
 * Reads a comma-separated email allowlist, normalised to lowercase.
 *
 * Accepts either spelling of the variable so a single address in
 * SUPER_ADMIN_EMAIL works as well as a list in SUPER_ADMIN_EMAILS.
 */
export function emailListFromEnv(...names) {
  const raw = names.map((n) => process.env[n]).find((v) => v && v.trim());
  if (!raw) return [];
  return [...new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')),
  )];
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
  // Defaults to the local frontend rather than '*' so development exercises the
  // same cross-origin rules as production — a wildcard default hides CORS
  // mistakes until deploy, where the boot check then refuses to start on them.
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
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
  // How long a just-rotated refresh token still works.
  //
  // Refresh tokens rotate on every use, and presenting a revoked one is
  // treated as theft: every session on the account is killed. That is right
  // for a token replayed hours later and wrong for the ordinary case of two
  // browser tabs whose access tokens expire in the same second — both send the
  // cookie they hold, one wins the rotation, and the loser's perfectly honest
  // request used to log the account out of everything. Anything replayed
  // inside this window is treated as that race instead, and re-issued.
  //
  // Small on purpose: seconds, not minutes. It has to cover a request already
  // in flight, nothing more.
  REFRESH_ROTATION_GRACE_SECONDS: numFromEnv('REFRESH_ROTATION_GRACE_SECONDS', 30),
  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES) || 5,
  OTP_MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
  MEDICAL_ENCRYPTION_KEY: process.env.MEDICAL_ENCRYPTION_KEY ?? 'change-this-medical-key-in-production',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN ?? 'change-this-verify-token',
  ALLOW_DEV_OTP_IN_PRODUCTION: process.env.ALLOW_DEV_OTP_IN_PRODUCTION === 'true',
  // ── WhatsApp (Meta Cloud API) ──
  // Live mode is inferred from the phone number + access token; the app secret
  // is what authenticates inbound webhooks. All three live here rather than
  // being read straight from process.env so the placeholder check below can
  // see them.
  WA_PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID ?? '',
  WA_ACCESS_TOKEN: process.env.WA_ACCESS_TOKEN ?? '',
  WA_APP_SECRET: process.env.WA_APP_SECRET ?? '',
  // ── Webhook registration (scripts/whatsapp-webhook-setup.js only) ──
  //
  // Receiving messages takes one more step than the credentials above: Meta has
  // to be told the callback URL *and* subscribed to the `messages` field. A URL
  // that verifies but is not subscribed goes quiet forever, which looks exactly
  // like a broken bot -- so these exist to let the setup script do both over the
  // API instead of by hand in the dashboard.
  //
  // Identifiers, not secrets: the App ID is public and the WABA ID is visible to
  // anyone in the Business account. Neither is read at runtime.
  WA_APP_ID: process.env.WA_APP_ID ?? '',
  WA_WABA_ID: process.env.WA_WABA_ID ?? '',
  // Public HTTPS origin Meta should deliver to, without a trailing slash. The
  // script appends the webhook path itself, because getting that path wrong
  // (/api/whatsapp instead of /api/v1/whatsapp) is a 404 Meta reports as a
  // verification failure with no hint as to why.
  WA_CALLBACK_ORIGIN: process.env.WA_CALLBACK_ORIGIN ?? '',
  // The number families message, in international format. Distinct from
  // WA_PHONE_NUMBER_ID, which is Meta's internal id for the sending number and
  // is not dialable — putting that in a wa.me link produces a dead link.
  SCHOOL_WHATSAPP_NUMBER: process.env.SCHOOL_WHATSAPP_NUMBER ?? '',
  // Master switch for the "Chat on WhatsApp" entry point. Defaults on so a
  // configured number is enough; set false to hide it without unsetting config.
  WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED !== 'false',
  // ── WhatsApp conversation memory ──
  // How long a thread may sit idle before the next message starts a fresh
  // session. Not a security boundary: identity, role and permissions are
  // re-resolved on every turn regardless. It is a relevance boundary, so a
  // question tomorrow is not answered against yesterday's subject.
  WHATSAPP_SESSION_IDLE_MINUTES: Number(process.env.WHATSAPP_SESSION_IDLE_MINUTES) || 120,
  // Turns of transcript handed to the model to resolve a follow-up. Small on
  // purpose -- "what about last month?" refers a turn or two back, and sending
  // the whole thread grows every request without making the answer better.
  WHATSAPP_HISTORY_TURNS: Number(process.env.WHATSAPP_HISTORY_TURNS) || 6,
  // ── Provider abstractions (all optional — safe fallbacks in dev) ──
  // Google Sign-In: when set, /auth/google verifies the ID token audience.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  // Super Admin allowlist. An address here is provisioned as SUPER_ADMIN the
  // first time it signs in with a Google account Google has verified — which
  // is how the platform gets its first Super Admin without a seeded password.
  // Nothing else reads this list, so an address not on it is unaffected, and
  // clearing it does not revoke anyone (remove the profile to do that).
  //
  // A getter, unlike every other key here, so the list is read from the
  // environment at the moment of a sign-in rather than at import time — which
  // keeps it independent of module load order.
  get SUPER_ADMIN_EMAILS() {
    return emailListFromEnv('SUPER_ADMIN_EMAILS', 'SUPER_ADMIN_EMAIL');
  },
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
  // Read here as well as from process.env so every consumer sees the same
  // value. rag.js checked `env.GEMINI_API_KEY`, which this object never
  // carried, so the retrieval fallback disabled itself on schools that had
  // configured a key perfectly well.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? null,
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
  /**
   * How long any single model call may take before the assistant stops
   * waiting for it.
   *
   * The agent has a deterministic answer for everything it is asked; the model
   * only ever improves the routing. Waiting indefinitely for it trades a good
   * answer now for a possibly-better answer later, which is the wrong trade in
   * a chat box - and with a provider that intermittently 503s, it is how the
   * assistant comes to look broken.
   */
  AI_TIMEOUT_MS: Number(process.env.AI_TIMEOUT_MS) || 10_000,
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

/**
 * Placeholder secrets shipped so the app runs out of the box.
 *
 * These have to be recognised, not merely non-empty: `WA_APP_SECRET` was left
 * at `change-this-app-secret`, which is truthy, so signature verification ran
 * against a value Meta has never seen and rejected every genuine webhook with
 * a 401. A secret that is present but wrong is worse than one that is absent —
 * absence is at least detectable.
 */
const PLACEHOLDERS = new Set([
  'change-this-secret-in-production',
  'change-this-medical-key-in-production',
  'change-this-verify-token',
  'change-this-app-secret',
  '',
]);

/** True when a secret is unset or still one of the shipped defaults. */
export function isPlaceholderSecret(value) {
  return PLACEHOLDERS.has(String(value ?? '').trim());
}

/**
 * WhatsApp is "live" once it has a number and a token to send with — that is
 * also the point at which Meta starts POSTing real webhooks at us, so it is
 * the point from which the app secret must be real.
 */
export function isWhatsappLive() {
  return Boolean(env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN);
}

/** True when inbound webhook signatures can actually be checked. */
export function isWhatsappSignatureConfigured() {
  return !isPlaceholderSecret(env.WA_APP_SECRET);
}

/** The hosts in a MongoDB URI, lower-cased and without ports or credentials. */
export function databaseHostsOf(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(String(uri ?? ''));
  return m ? m[1].split(',').map((h) => h.replace(/:\d+$/, '').trim().toLowerCase()).filter(Boolean) : [];
}

/** The operator's settings for the database guard, read at call time. */
export function databaseGuardConfig(processEnv = process.env) {
  return {
    allowRemote: processEnv.ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION === 'true',
    productionHosts: String(processEnv.PRODUCTION_DB_HOSTS ?? '')
      .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}

/**
 * Decides whether a process running as `nodeEnv` may connect to `uri`.
 *
 * The failure this exists to prevent is real in this repository: a developer
 * `.env` whose MONGO_URI points at the live cluster, and a server whose boot
 * sequence writes to whatever it connects to (it upserts every permission and
 * system role). resolveMongoUri() already ignores MONGO_URI_ATLAS outside
 * production; this closes the other door.
 *
 * Outside production:
 *   - a host listed in PRODUCTION_DB_HOSTS is refused, whatever else is set;
 *   - any remote cluster (mongodb+srv, or *.mongodb.net) is refused unless the
 *     operator opts in with ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true — which a
 *     staging deployment on its own Atlas cluster sets deliberately.
 * In production nothing is refused here; env.js's production gate applies.
 *
 * Pure: it reads nothing and connects to nothing, so the preflight script and
 * the tests can call it directly.
 */
export function assessDatabaseTarget({ nodeEnv = 'development', uri = '', allowRemote = false, productionHosts = [] } = {}) {
  const hosts = databaseHostsOf(uri);
  const remote = /^mongodb\+srv:\/\//i.test(String(uri)) || hosts.some((h) => /\.mongodb\.net$/.test(h));
  if (nodeEnv === 'production') return { ok: true, remote, hosts };

  const listed = hosts.filter((h) => productionHosts.some((p) => h === p || h.endsWith(`.${p}`)));
  if (listed.length) {
    return {
      ok: false, remote, hosts,
      reason: `the database host is listed in PRODUCTION_DB_HOSTS, and NODE_ENV is "${nodeEnv}" — a non-production process may not connect to production`,
    };
  }
  if (remote && !allowRemote) {
    return {
      ok: false, remote, hosts,
      reason: `MONGO_URI points at a remote cluster while NODE_ENV is "${nodeEnv}". Use a local or staging database, ` +
        'or — for a staging deployment on its own cluster — set ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true',
    };
  }
  return { ok: true, remote, hosts };
}

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
  // Only demanded once WhatsApp is actually live: a deployment that never
  // receives webhooks has nothing to authenticate. Once it is live, an
  // unverifiable webhook lets anyone who learns the URL post messages that
  // appear to come from any parent's number.
  if (isWhatsappLive() && !isWhatsappSignatureConfigured()) {
    insecure.push('WA_APP_SECRET (WhatsApp is live — inbound webhooks cannot be authenticated without it)');
  }
  if (env.CORS_ORIGIN === '*') insecure.push('CORS_ORIGIN (must name your frontend origin)');
  // The console providers cannot actually deliver anything, so in production
  // they mean OTP login is broken — and until this was fixed they also meant
  // the code came back in the HTTP response, which is account takeover for any
  // address. Refusing to boot is the only safe reading of this configuration.
  if (env.SMS_PROVIDER === 'console' && !env.ALLOW_DEV_OTP_IN_PRODUCTION) insecure.push('SMS_PROVIDER=console (cannot deliver an OTP — configure a real SMS provider)');
  if (env.EMAIL_PROVIDER === 'console' && !env.ALLOW_DEV_OTP_IN_PRODUCTION) insecure.push('EMAIL_PROVIDER=console (cannot deliver an OTP — configure a real email provider)');
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
