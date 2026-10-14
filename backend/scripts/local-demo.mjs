#!/usr/bin/env node
/**
 * One command to try EduOS on this machine, with nothing else installed:
 *
 *   cd backend && npm run demo            (add  -- --build  to rebuild the frontend)
 *
 * It starts a throwaway MongoDB in memory, seeds it with the fictional demo
 * school, starts the API on http://localhost:5000 and serves the production
 * build of the frontend on http://localhost:3000 (building it first if there
 * is no build, or with --build to force one).
 *
 * The database lives in memory: everything you enter is gone when you stop
 * the script (Ctrl+C). It is for trying the product, never for real data.
 * Nothing here touches a real database: MONGO_URI is pointed at the in-memory
 * server for the child processes only.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.resolve(backend, '..', 'frontend');
const API_PORT = process.env.DEMO_API_PORT ?? '5000';
const WEB_PORT = process.env.DEMO_WEB_PORT ?? '3000';
const forceBuild = process.argv.includes('--build');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const children = [];
let mongo = null;
let stopping = false;

function run(cmd, args, { cwd, env, label, wait = true }) {
  const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
  if (!wait) children.push(child);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (wait) return code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`));
      if (!stopping) { console.error(`\n${label} stopped (code ${code}). Shutting the demo down.`); void stop(1); }
      return resolve();
    });
    if (!wait) resolve();
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  if (mongo) await mongo.stop().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

async function waitFor(url, label, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

try {
  console.log('\n1/4  Starting a throwaway database (in memory)…');
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    MONGO_URI: mongo.getUri('eduos_demo'),
    MONGO_URI_ATLAS: '',
    PORT: API_PORT,
    CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
  };

  console.log('2/4  Seeding the fictional demo school…');
  await run(process.execPath, ['src/seed/seed_school_data.js'], { cwd: backend, env, label: 'School seed' });
  await run(process.execPath, ['src/seed/seed.js'], { cwd: backend, env, label: 'Demo-user seed' });

  console.log(`3/4  Starting the API on port ${API_PORT}…`);
  await run(process.execPath, ['src/app.js'], { cwd: backend, env, label: 'API', wait: false });
  await waitFor(`http://127.0.0.1:${API_PORT}/api/v1/auth/me`, 'The API');

  const webEnv = { ...process.env, API_URL: `http://127.0.0.1:${API_PORT}`, NEXT_PUBLIC_BACKEND_URL: `http://localhost:${API_PORT}` };
  if (forceBuild || !fs.existsSync(path.join(frontend, '.next', 'BUILD_ID'))) {
    console.log('4/4  Building the frontend (a few minutes the first time)…');
    await run(npx, ['next', 'build'], { cwd: frontend, env: webEnv, label: 'Frontend build' });
  } else {
    console.log('4/4  Using the existing frontend build (run with --build to rebuild).');
  }
  await run(npx, ['next', 'start', '-p', WEB_PORT], { cwd: frontend, env: webEnv, label: 'Frontend', wait: false });
  await waitFor(`http://127.0.0.1:${WEB_PORT}/oakridge`, 'The frontend');

  const { DEMO_USERS } = await import('../src/constants/demoUsers.js');
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EduOS demo is running:  http://localhost:${WEB_PORT}/oakridge

  To sign in: type an email or phone number below, press "Send OTP", and
  enter the 6-digit code. In this demo the code is shown on the screen.

${DEMO_USERS.filter((u) => u.email && u.roleKey !== 'SUPER_ADMIN').map((u) => `    ${u.roleKey.padEnd(11)} ${u.email}`).join(String.fromCharCode(10))}
    STUDENT     +910000003001
    PARENT      +910000004001
    ALUMNUS     +910000000033

  The data is fictional and lives in memory: it is gone when you stop this
  (Ctrl+C). Email and WhatsApp are simulated; nothing is sent.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
} catch (err) {
  console.error(`\nThe demo could not start: ${err.message}`);
  await stop(1);
}
