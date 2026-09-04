/**
 * Points Meta's WhatsApp Cloud API at this server, and subscribes it to
 * messages.
 *
 *   npm run whatsapp:webhook          register, then verify
 *   npm run whatsapp:webhook:check    report the current state, change nothing
 *
 * Why this exists as a script rather than a paragraph in the README: getting
 * inbound WhatsApp working needs two separate calls, and skipping the second
 * one fails *silently*. The callback URL is registered on the app; the app is
 * then subscribed to the WhatsApp Business Account. Do only the first and Meta
 * verifies the URL, reports success, and never delivers anything — a bot that
 * looks configured, answers nothing, and gives you no error to search for.
 * (When the number also has a greeting or away message set, those keep
 * replying, so it looks like the bot is answering badly rather than not at
 * all.)
 *
 * Reads, from the environment:
 *   WA_APP_ID            the Meta app that owns the webhook subscription
 *   WA_APP_SECRET        used only to mint the app access token, never sent
 *   WA_WABA_ID           the WhatsApp Business Account the number belongs to
 *   WA_ACCESS_TOKEN      system user token, for the WABA subscription
 *   WA_CALLBACK_ORIGIN   public HTTPS origin of this API
 *   WHATSAPP_VERIFY_TOKEN  the shared secret for Meta's handshake
 *
 * Nothing here is read at runtime and nothing is written to the database: this
 * only changes configuration held by Meta.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Must match the mount in src/routes/index.js. */
const WEBHOOK_PATH = '/api/v1/whatsapp/webhook';

/** The one field that matters. Without it the URL verifies and stays silent. */
const REQUIRED_FIELD = 'messages';

const checkOnly = process.argv.includes('--check');

const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => console.log(`  ✗ ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

/**
 * Reports a Graph error in the terms the dashboard uses.
 *
 * Meta's messages are written for someone looking at the app dashboard, so the
 * raw text ("Unsupported post request") rarely names the thing that is actually
 * wrong. The common causes are worth spelling out at the call site.
 */
function describe(body) {
  const err = body?.error;
  if (!err) return 'unknown error';
  const parts = [err.message];
  if (err.error_user_title) parts.push(err.error_user_title);
  if (err.code) parts.push(`(code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})`);
  return parts.join(' ');
}

/**
 * One Graph call.
 *
 * Credentials go in the Authorization header and writes go in a form body,
 * never in the query string. Graph accepts `?access_token=` too, and its own
 * examples use it, but a URL is the part that survives in proxy logs, browser
 * history and shell history — and the values here (an app access token, the
 * webhook verify token) are exactly the ones that must not.
 */
async function graph(method, path, { params = {}, token } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;

  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    // Graph reads POST parameters as form-encoded, which is what its own SDKs
    // send; a JSON body is silently ignored for these endpoints.
    body = new URLSearchParams(params).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, { method, headers, body });
  const parsed = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Fails fast, naming every missing value at once rather than one per run. */
function requireConfig() {
  const missing = [];
  if (!env.WA_APP_ID) missing.push('WA_APP_ID');
  if (!env.WA_APP_SECRET) missing.push('WA_APP_SECRET');
  if (!env.WA_WABA_ID) missing.push('WA_WABA_ID');
  if (!env.WA_ACCESS_TOKEN) missing.push('WA_ACCESS_TOKEN');
  if (!env.WA_CALLBACK_ORIGIN) missing.push('WA_CALLBACK_ORIGIN');

  if (missing.length) {
    console.error(`\nMissing in .env: ${missing.join(', ')}`);
    console.error('See the WhatsApp section of .env.example for where each value lives.\n');
    process.exit(1);
  }

  const origin = env.WA_CALLBACK_ORIGIN.replace(/\/+$/, '');
  if (!origin.startsWith('https://')) {
    // Meta refuses plain HTTP, and the refusal it gives names neither the
    // scheme nor the URL.
    console.error(`\nWA_CALLBACK_ORIGIN must be https:// — got ${origin}\n`);
    process.exit(1);
  }
  if (env.WHATSAPP_VERIFY_TOKEN === 'change-this-verify-token') {
    console.error('\nWHATSAPP_VERIFY_TOKEN is still the shipped placeholder. Set a real one.\n');
    process.exit(1);
  }
  return `${origin}${WEBHOOK_PATH}`;
}

/**
 * Performs Meta's own handshake against the callback before Meta does.
 *
 * Worth the extra request: when Meta cannot reach the URL it says only that
 * verification failed, so a stopped tunnel, a wrong path and a wrong token are
 * one indistinguishable error. Here they are three different messages.
 */
async function preflight(callbackUrl) {
  const probe = new URL(callbackUrl);
  probe.searchParams.set('hub.mode', 'subscribe');
  probe.searchParams.set('hub.verify_token', env.WHATSAPP_VERIFY_TOKEN);
  probe.searchParams.set('hub.challenge', 'preflight');

  let res;
  try {
    res = await fetch(probe, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    bad(`Callback URL is not reachable from the internet: ${err.message}`);
    info('Is the server running, and the tunnel still up on the same URL?');
    return false;
  }

  const text = (await res.text()).trim();
  if (res.status === 404) {
    bad(`404 at ${callbackUrl}`);
    info('WA_CALLBACK_ORIGIN should be the origin only — the path is added here.');
    return false;
  }
  if (res.status === 403) {
    bad('403 — the server refused the verify token.');
    info('WHATSAPP_VERIFY_TOKEN here must match the one the server is running with.');
    return false;
  }
  if (!res.ok || text !== 'preflight') {
    bad(`Unexpected reply (HTTP ${res.status}): ${text.slice(0, 120)}`);
    return false;
  }

  ok('Callback answers the verification handshake');
  return true;
}

/** What Meta currently believes, for both --check and the post-run report. */
async function report(callbackUrl) {
  const appToken = `${env.WA_APP_ID}|${env.WA_APP_SECRET}`;

  // Bearer rather than ?access_token=: Meta accepts both, and a credential in a
  // query string is the one that ends up in proxy logs and shell history.
  const subs = await graph('GET', `${env.WA_APP_ID}/subscriptions`, { token: appToken });
  if (!subs.ok) {
    bad(`Could not read the app's subscriptions: ${describe(subs.body)}`);
    info('A wrong WA_APP_ID or WA_APP_SECRET is the usual cause.');
    return false;
  }

  const waba = (subs.body.data ?? []).find((s) => s.object === 'whatsapp_business_account');
  if (!waba) {
    bad('The app has no whatsapp_business_account subscription.');
    return false;
  }

  const registered = waba.callback_url;
  if (registered === callbackUrl) {
    ok(`Callback URL registered: ${registered}`);
  } else {
    bad(`Callback URL is ${registered}, not ${callbackUrl}`);
  }

  const fields = (waba.fields ?? []).map((f) => (typeof f === 'string' ? f : f.name));
  if (fields.includes(REQUIRED_FIELD)) {
    ok(`Subscribed to fields: ${fields.join(', ')}`);
  } else {
    bad(`Not subscribed to '${REQUIRED_FIELD}' — inbound messages will never arrive.`);
    info(`Subscribed to: ${fields.join(', ') || '(nothing)'}`);
  }

  // The second half: the app must also be attached to this particular WABA.
  const apps = await graph('GET', `${env.WA_WABA_ID}/subscribed_apps`, {
    token: env.WA_ACCESS_TOKEN,
  });
  if (!apps.ok) {
    bad(`Could not read the WABA's subscribed apps: ${describe(apps.body)}`);
    return false;
  }
  const attached = (apps.body.data ?? []).some(
    (a) => String(a.whatsapp_business_api_data?.id) === String(env.WA_APP_ID)
  );
  if (attached) {
    ok('App is subscribed to the WhatsApp Business Account');
  } else {
    const names = (apps.body.data ?? []).map((a) => a.whatsapp_business_api_data?.name ?? '?');
    bad('App is NOT subscribed to the WABA — this is the step that is usually missed.');
    info(`Apps currently subscribed: ${names.join(', ') || '(none)'}`);
  }

  return registered === callbackUrl && fields.includes(REQUIRED_FIELD) && attached;
}

async function main() {
  const callbackUrl = requireConfig();

  console.log(`\nWhatsApp webhook — ${checkOnly ? 'checking' : 'configuring'}`);
  console.log(`  app ${env.WA_APP_ID} → ${callbackUrl}\n`);

  if (checkOnly) {
    const healthy = await report(callbackUrl);
    console.log(healthy ? '\nInbound WhatsApp is wired up.\n' : '\nRun `npm run whatsapp:webhook` to fix.\n');
    process.exit(healthy ? 0 : 1);
  }

  if (!(await preflight(callbackUrl))) {
    console.log('\nNot registering a URL Meta would fail to verify. Fix the above first.\n');
    process.exit(1);
  }

  // 1. Register the callback on the app, and ask for the messages field.
  const appToken = `${env.WA_APP_ID}|${env.WA_APP_SECRET}`;
  const sub = await graph('POST', `${env.WA_APP_ID}/subscriptions`, {
    // In the body, not the query string: both the app token and the verify
    // token are credentials, and a URL is the part that gets logged.
    params: {
      object: 'whatsapp_business_account',
      callback_url: callbackUrl,
      verify_token: env.WHATSAPP_VERIFY_TOKEN,
      fields: REQUIRED_FIELD,
    },
    token: appToken,
  });
  if (!sub.ok) {
    bad(`Registering the callback failed: ${describe(sub.body)}`);
    info('Check WA_APP_ID and WA_APP_SECRET belong to the same app.');
    process.exit(1);
  }
  ok('Callback URL registered and subscribed to messages');

  // 2. Attach the app to this WABA. Without this, step 1 delivers nothing.
  const attach = await graph('POST', `${env.WA_WABA_ID}/subscribed_apps`, {
    token: env.WA_ACCESS_TOKEN,
  });
  if (!attach.ok) {
    bad(`Subscribing the app to the WABA failed: ${describe(attach.body)}`);
    info('WA_ACCESS_TOKEN needs whatsapp_business_management on this WABA.');
    process.exit(1);
  }
  ok('App subscribed to the WhatsApp Business Account');

  // Read it back rather than trusting two 200s: this is the state that decides
  // whether messages arrive.
  console.log('\nVerifying:');
  const healthy = await report(callbackUrl);

  if (healthy) {
    console.log('\nDone. Send a message to the number and watch the log.');
    console.log('If a canned reply arrives first, turn off the greeting and away');
    console.log('messages on the number in WhatsApp Manager.\n');
  } else {
    console.log('\nSomething did not stick. See above.\n');
  }
  process.exit(healthy ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nwhatsapp-webhook-setup failed: ${err.message}\n`);
  process.exit(1);
});
