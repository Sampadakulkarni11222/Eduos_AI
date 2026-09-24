/**
 * Boots an isolated EduOS stack for promo capture.
 *
 *   node capture/stack.mjs
 *
 * - A throwaway in-memory MongoDB replica set (the backend's own
 *   mongodb-memory-server). MONGO_URI and MONGO_URI_ATLAS are overridden for
 *   every child process, so the Atlas cluster in backend/.env is unreachable.
 * - The real seed scripts, in the order the README documents, which produce
 *   Oakridge Academy.
 * - The real backend on CAPTURE_API_PORT (default 5055), in Rules mode, with
 *   the sandbox payment provider so Pay Now is demonstrable.
 * - A production build of a *copy* of the frontend on CAPTURE_WEB_PORT
 *   (default 3055), so a dev server already running on :3000 and its .next
 *   folder are never touched.
 *
 * Writes .work/stack.json once everything is listening. Ctrl+C tears it all
 * down and the database is discarded.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REMOTION = path.resolve(HERE, '..');
const REPO = path.resolve(REMOTION, '..');
const BACKEND = path.join(REPO, 'backend');
const FRONTEND = path.join(REPO, 'frontend');
const WORK = path.join(REMOTION, '.work');
const APP_COPY = path.join(WORK, 'frontend');

const API_PORT = process.env.CAPTURE_API_PORT ?? '5055';
const WEB_PORT = process.env.CAPTURE_WEB_PORT ?? '3055';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const SKIP_BUILD = process.argv.includes('--skip-build');
// Backend only: enough to ask the real agent a question, without the memory a
// Next build and server need. No capture can run against it.
const API_ONLY = process.argv.includes('--api-only');

mkdirSync(WORK, { recursive: true });

const require = createRequire(path.join(BACKEND, 'package.json'));
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const MONGO_URI = replSet.getUri('eduos-promo');
console.log(`[stack] in-memory MongoDB ${MONGO_URI}`);

const backendEnv = {
  ...process.env,
  NODE_ENV: 'development',
  MONGO_URI,
  MONGO_URI_ATLAS: '',
  PORT: API_PORT,
  HOST: 'localhost',
  CORS_ORIGIN: WEB_URL,
  JWT_SECRET: 'promo-capture-secret-not-for-production',
  MEDICAL_ENCRYPTION_KEY: 'promo-capture-medical-key',
  SMS_PROVIDER: 'console',
  EMAIL_PROVIDER: 'console',
  PAYMENT_PROVIDER: 'sandbox',
  AI_PROVIDER: 'rules',
  GEMINI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  // No live integration reaches this stack: WhatsApp is switched off (and its
  // Meta credentials blanked), so the capture backend can never message
  // anyone and the Ask Agent panel shows no hand-off.
  WHATSAPP_ENABLED: 'false',
  SCHOOL_WHATSAPP_NUMBER: '',
  WA_PHONE_NUMBER_ID: '',
  WA_ACCESS_TOKEN: '',
  WA_APP_SECRET: '',
  WA_APP_ID: '',
  WA_WABA_ID: '',
  WA_CALLBACK_ORIGIN: '',
  WHATSAPP_VERIFY_TOKEN: '',
  RATE_LIMIT_AUTH_MAX: '10000',
  RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_AI_MAX: '1000',
  AGENT_RATE_LIMIT_PER_MIN: '1000',
  LOG_LEVEL: 'warn',
};

// Async on purpose: the in-memory mongod is a child of this process, and a
// spawnSync here blocks the event loop that drains its output pipes — mongod
// then stalls on a full pipe and every connection times out.
function runSeed(script) {
  console.log(`[stack] seed: ${script}`);
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [script], { cwd: BACKEND, env: backendEnv, stdio: 'inherit' });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

// Order from the README: full school data, then roles/demo accounts/books/
// hostel rooms, then the migration that links demo data, then documents.
await runSeed('src/seed/seed_school_data.js');
await runSeed('src/seed/seed.js');
await runSeed('src/seed/migrate.js');
await runSeed('src/seed/seed_documents.js');

const children = [];
const backend = spawn(process.execPath, ['src/app.js'], { cwd: BACKEND, env: backendEnv, stdio: 'inherit' });
children.push(backend);

// ── Frontend: a copy, built for production ─────────────────────────────────
const webEnv = {
  ...process.env,
  NEXT_PUBLIC_BACKEND_URL: API_URL,
  API_URL,
  NEXTAUTH_URL: WEB_URL,
  NEXTAUTH_SECRET: 'promo-capture-nextauth-secret',
  // The Google button would otherwise try real OAuth; no client id → demo.
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  NEXT_TELEMETRY_DISABLED: '1',
  PORT: WEB_PORT,
};

const nextBin = path.join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next');
if (!API_ONLY) {
  if (!SKIP_BUILD || !existsSync(path.join(APP_COPY, '.next'))) {
    rmSync(APP_COPY, { recursive: true, force: true });
    mkdirSync(APP_COPY, { recursive: true });
    for (const entry of readdirSync(FRONTEND)) {
      // node_modules is linked, not copied; .env* is left behind on purpose —
      // the copy runs on the explicit env above and nothing else.
      if (['node_modules', '.next', 'tests', 'tsconfig.tsbuildinfo'].includes(entry) || entry.startsWith('.env')) continue;
      cpSync(path.join(FRONTEND, entry), path.join(APP_COPY, entry), { recursive: true });
    }
    spawnSync('cmd', ['/c', 'mklink', '/J', path.join(APP_COPY, 'node_modules'), path.join(FRONTEND, 'node_modules')], { stdio: 'ignore' });
    console.log('[stack] building frontend copy (production)…');
    await new Promise((resolve, reject) => {
      const b = spawn(process.execPath, [nextBin, 'build'], { cwd: APP_COPY, env: webEnv, stdio: 'inherit' });
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('next build failed'))));
    });
  }
  const web = spawn(process.execPath, [nextBin, 'start', '-p', WEB_PORT], { cwd: APP_COPY, env: webEnv, stdio: 'inherit' });
  children.push(web);
}

async function waitFor(url, label) {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}
await waitFor(`${API_URL}/api/v1/health`, 'backend');
if (!API_ONLY) await waitFor(`${WEB_URL}/login`, 'frontend');

writeFileSync(
  path.join(WORK, 'stack.json'),
  JSON.stringify({ apiUrl: API_URL, webUrl: API_ONLY ? null : WEB_URL, school: 'oakridge', startedAt: new Date().toISOString() }, null, 2),
);
console.log(`\n[stack] READY  web=${API_ONLY ? '(not started)' : WEB_URL}  api=${API_URL}\n`);

const shutdown = async () => {
  for (const c of children) c.kill();
  await replSet.stop();
  rmSync(path.join(WORK, 'stack.json'), { force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
