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
  // ── School domains ──
  // The platform's own domain, under which a school may be given a subdomain
  // (abc-public-school.<PLATFORM_DOMAIN>). No default: an unset value means
  // subdomains cannot be configured, rather than being handed out under a
  // domain this deployment does not own.
  PLATFORM_DOMAIN: String(process.env.PLATFORM_DOMAIN ?? '').trim().toLowerCase().replace(/\.$/, ''),
  // The hostname a school's custom domain must CNAME to so its traffic reaches
  // this deployment (on Render, the frontend service's onrender.com host). Shown
  // in the DNS instructions; unset means the instructions say to ask the
  // platform team for it.
  DOMAIN_CNAME_TARGET: String(process.env.DOMAIN_CNAME_TARGET ?? '').trim().toLowerCase().replace(/\.$/, ''),
  // How long one DNS query or TLS handshake may take during verification.
  DOMAIN_CHECK_TIMEOUT_MS: Number(process.env.DOMAIN_CHECK_TIMEOUT_MS) || 5000,
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
  // Read only so that a production deployment still carrying it can be told,
  // loudly, that it is ignored. It used to make production echo every one-time
  // code in the HTTP response, which is account takeover for any known phone
  // or email address; production now never does that, whatever this says.
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
  // `||`, not `??`: a variable declared but left blank (Render's sync: false)
  // arrives as '', which means "not configured", not an unknown provider.
  SMS_PROVIDER: (process.env.SMS_PROVIDER || 'console').trim().toLowerCase(),
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER || 'console').trim().toLowerCase(),
  // ── OTP delivery providers ──
  // EMAIL_PROVIDER=resend sends through Resend's HTTP API; SMS_PROVIDER=twilio
  // through Twilio's. Credentials come only from the environment (the Render
  // dashboard in production), never from a committed file.
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? '',
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER ?? '',
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
  // Key for the signed, expiring /uploads links. Optional: derived from
  // JWT_SECRET when unset. Rotating it (or JWT_SECRET) invalidates every
  // outstanding file link, which the portal replaces on its next read.
  FILE_URL_SECRET: process.env.FILE_URL_SECRET ?? '',
  // Shared with the frontend server (its FRONTEND_PROXY_SECRET, server-side
  // only). Lets its session-refresh proxy skip the per-IP failed-refresh limit,
  // which it enforces per real client itself. Optional.
  FRONTEND_PROXY_SECRET: process.env.FRONTEND_PROXY_SECRET ?? '',
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
  // OpenRouter: AI_PROVIDER=openrouter uses it directly; with AI_PROVIDER=gemini
  // or anthropic, a key here makes it the fallback when that provider fails.
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? null,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openrouter/auto',
  OPENROUTER_FALLBACK_MODELS: process.env.OPENROUTER_FALLBACK_MODELS ?? '',
  OPENROUTER_MAX_TOKENS: Number(process.env.OPENROUTER_MAX_TOKENS) || 4096,
  OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL ?? '',
  OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME ?? 'EduOS',
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
export const SMS_PROVIDERS = ['console', 'twilio'];
export const EMAIL_PROVIDERS = ['console', 'resend'];

/**
 * What stops production from starting, and what it should only warn about.
 *
 * Pure over the settings object so it can be tested without booting a
 * process. `fatal` entries are insecure or broken configuration; `warnings`
 * are features that will be unavailable but leave the deployment safe.
 */
export function productionConfigProblems(e = env) {
  const fatal = [];
  const warnings = [];
  // The development defaults above are deliberately weak so the app runs out of
  // the box. Booting production with any of them still set means anyone holding
  // a copy of this repo can forge sessions, decrypt medical records, or pass the
  // WhatsApp webhook handshake.
  if (e.JWT_SECRET === 'change-this-secret-in-production') fatal.push('JWT_SECRET');
  if (String(e.JWT_SECRET ?? '').length < 32) fatal.push('JWT_SECRET (must be ≥32 characters)');
  if (e.MEDICAL_ENCRYPTION_KEY === 'change-this-medical-key-in-production') fatal.push('MEDICAL_ENCRYPTION_KEY');
  if (e.WHATSAPP_VERIFY_TOKEN === 'change-this-verify-token') fatal.push('WHATSAPP_VERIFY_TOKEN');
  // Only demanded once WhatsApp is actually live: a deployment that never
  // receives webhooks has nothing to authenticate. Once it is live, an
  // unverifiable webhook lets anyone who learns the URL post messages that
  // appear to come from any parent's number.
  if (e.WA_PHONE_NUMBER_ID && e.WA_ACCESS_TOKEN && isPlaceholderSecret(e.WA_APP_SECRET)) {
    fatal.push('WA_APP_SECRET (WhatsApp is live — inbound webhooks cannot be authenticated without it)');
  }
  if (e.CORS_ORIGIN === '*') fatal.push('CORS_ORIGIN (must name your frontend origin)');

  // ── One-time-code delivery ──
  // A provider nobody implemented, or a real one missing its credentials, is a
  // misconfiguration: fail loudly rather than silently lose every code.
  if (!SMS_PROVIDERS.includes(e.SMS_PROVIDER)) fatal.push(`SMS_PROVIDER=${e.SMS_PROVIDER} (unknown — use one of ${SMS_PROVIDERS.join(', ')})`);
  if (!EMAIL_PROVIDERS.includes(e.EMAIL_PROVIDER)) fatal.push(`EMAIL_PROVIDER=${e.EMAIL_PROVIDER} (unknown — use one of ${EMAIL_PROVIDERS.join(', ')})`);
  if (e.SMS_PROVIDER === 'twilio') {
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) if (!e[k]) fatal.push(`${k} (required by SMS_PROVIDER=twilio)`);
  }
  if (e.EMAIL_PROVIDER === 'resend') {
    for (const k of ['RESEND_API_KEY', 'EMAIL_FROM']) if (!e[k]) fatal.push(`${k} (required by EMAIL_PROVIDER=resend)`);
  }
  // The console providers cannot deliver anything. That used to be fatal —
  // and the escape hatch that let a deployment boot anyway was to echo every
  // code in the response. Neither is right: production now starts, OTP
  // sign-in on that channel answers 503 OTP_DELIVERY_UNAVAILABLE, and password
  // and Google sign-in keep working.
  if (e.SMS_PROVIDER === 'console') warnings.push('SMS_PROVIDER=console — phone OTP sign-in is unavailable until a real SMS provider is configured');
  if (e.EMAIL_PROVIDER === 'console') warnings.push('EMAIL_PROVIDER=console — email OTP sign-in is unavailable until a real email provider is configured');
  if (e.ALLOW_DEV_OTP_IN_PRODUCTION) {
    warnings.push('ALLOW_DEV_OTP_IN_PRODUCTION is set and IGNORED — production never returns one-time codes; remove it from the environment');
  }

  // A sandbox gateway in production marks invoices Paid without money moving.
  if (e.PAYMENT_PROVIDER === 'sandbox') fatal.push('PAYMENT_PROVIDER=sandbox (simulates payments — use a real gateway or "none")');
  if (e.PAYMENT_PROVIDER === 'razorpay') {
    if (!e.RAZORPAY_KEY_ID) fatal.push('RAZORPAY_KEY_ID');
    if (!e.RAZORPAY_KEY_SECRET) fatal.push('RAZORPAY_KEY_SECRET');
    // Without this, webhook signatures cannot be checked, and an unauthenticated
    // POST could mark any invoice paid.
    if (!e.RAZORPAY_WEBHOOK_SECRET) fatal.push('RAZORPAY_WEBHOOK_SECRET (required to authenticate payment webhooks)');
  }
  return { fatal, warnings };
}

if (env.isProd) {
  const { fatal, warnings } = productionConfigProblems(env);
  for (const w of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`WARNING (production config): ${w}`);
  }
  if (fatal.length) {
    // eslint-disable-next-line no-console
    console.error(
      `\nFATAL: refusing to start in production with insecure or broken configuration:\n` +
        fatal.map((k) => `  • ${k}`).join('\n') +
        `\nSet these to real values in the environment and restart.\n`
    );
    process.exit(1);
  }
}
