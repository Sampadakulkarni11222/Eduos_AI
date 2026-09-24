/**
 * Shared Playwright helpers for capturing the real EduOS UI.
 *
 * Every capture runs in a fresh browser context at a fixed 1920×1080 viewport
 * (device scale 2, so Remotion can zoom into a region without it going soft),
 * headless — so there is no browser chrome, no terminal and no dev overlay in
 * any frame. Sign-in goes through the real OTP flow; the code is read from the
 * backend's own development echo (devOtp) on the network response.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REMOTION = path.resolve(HERE, '..');
export const stack = JSON.parse(readFileSync(path.join(REMOTION, '.work', 'stack.json'), 'utf8'));
export const WEB = stack.webUrl;
export const SCHOOL = stack.school;

export const VIEWPORT = { width: 1920, height: 1080 };

/** Oakridge demo identities. Nothing here is personal: all are seed accounts. */
export const PEOPLE = {
  superAdmin: { id: 'superadmin@schoolerp.com', door: null },
  admin: { id: 'admin@schoolerp.com', door: SCHOOL },
  principal: { id: 'principal@schoolerp.com', door: SCHOOL },
  teacher: { id: 'teacher@schoolerp.com', door: SCHOOL },
  finance: { id: 'finance@schoolerp.com', door: SCHOOL },
  librarian: { id: 'librarian@schoolerp.com', door: SCHOOL },
  warden: { id: 'warden@schoolerp.com', door: SCHOOL },
  // Seeded family #1: Diya Sharma and her parent (seed_school_data.js).
  parent: { id: '+910000004001', door: SCHOOL },
  student: { id: '+910000003001', door: SCHOOL },
};

// Hides only the caret and the scrollbars: a blinking caret makes two runs of
// the same capture differ, and a scrollbar gutter reads as browser chrome.
const STILL_CSS = `
  *{caret-color:transparent !important}
  ::-webkit-scrollbar{width:0 !important;height:0 !important}
`;

export async function launch() {
  return chromium.launch({ headless: true });
}

export async function newPage(browser, { scale = 2, storageState } = {}) {
  const context = await browser.newContext({
    storageState,
    viewport: VIEWPORT,
    deviceScaleFactor: scale,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}

function doorPath(door) {
  return door ? `/${door}` : '/login';
}

/** Signs in through the real sign-in screen with the dev OTP echo. */
export async function signIn(page, person) {
  await page.goto(`${WEB}${doorPath(person.door)}`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('name@school.com or +91 98765 43210').fill(person.id);
  const otpResponse = page.waitForResponse((r) => /\/auth\/otp(\/email)?\/request/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Send OTP/ }).click();
  const body = await (await otpResponse).json();
  const code = body?.data?.devOtp;
  if (!code) throw new Error(`No devOtp echoed for ${person.id}: ${JSON.stringify(body).slice(0, 200)}`);
  await page.getByPlaceholder('— — — — — —').fill(code);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL((u) => !/\/login|\/oakridge\/?$/.test(u.pathname) || /select-profile/.test(u.pathname), { timeout: 30_000 });
  if (page.url().includes('select-profile')) {
    await page.locator('button').first().click();
  }
  await page.waitForLoadState('networkidle');
}

/**
 * A signed-in page for one demo identity. The session (refresh cookie +
 * marker) is cached under .work/auth, so re-running a capture does not ask
 * the backend for another OTP — it allows 5 codes per identity per 15 min.
 * The cache dies with the in-memory database: a new stack means new tokens.
 */
export async function session(browser, who, opts = {}) {
  const dir = path.join(REMOTION, '.work', 'auth');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${who}-${stack.startedAt.replace(/[:.]/g, '')}.json`);
  if (existsSync(file)) {
    const page = await newPage(browser, { ...opts, storageState: file });
    await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    if (!/\/login|^\/oakridge\/?$/.test(new URL(page.url()).pathname)) { page.authFile = file; return page; }
    await page.context().close();
  }
  const page = await newPage(browser, opts);
  await signIn(page, PEOPLE[who]);
  await page.context().storageState({ path: file });
  page.authFile = file;
  return page;
}

/** Closes a session page, saving the rotated refresh token for the next run. */
export async function close(page) {
  if (page.authFile) await page.context().storageState({ path: page.authFile }).catch(() => {});
  await page.context().close();
}

/** Waits until a page has stopped loading: network idle, fonts in, no spinners/skeletons. */
export async function settle(page, extraMs = 600) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => !document.querySelector('.spinner, .skeleton, [aria-busy="true"], .loading-overlay'),
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  await page.addStyleTag({ content: STILL_CSS }).catch(() => {});
  await page.waitForTimeout(extraMs);
}

export async function go(page, route, extraMs) {
  const url = route.startsWith('/super-admin') || route.startsWith('/login') ? route : `/${SCHOOL}${route}`;
  await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
  await settle(page, extraMs);
}

export function outDir(...parts) {
  const dir = path.join(REMOTION, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  console.log(`  ✔ ${name}.png`);
  return file;
}
