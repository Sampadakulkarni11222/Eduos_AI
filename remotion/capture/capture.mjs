/**
 * Captures every screen the promo uses from the running EduOS stack.
 *
 *   npm run stack      # in one terminal (isolated, seeded, Rules mode)
 *   npm run capture    # in another
 *   npm run capture -- teacher parent   # only some roles
 *
 * Runs in story order, because later screens show the effects of earlier
 * actions: the Agent-posted announcement reaches the parent's dashboard, the
 * register the teacher saves is what the parent and principal then see. Each
 * step is isolated — a failure is logged and the rest still run.
 *
 * Output: assets/screenshots/*.png (3840×2160 captures of a 1920×1080 viewport).
 * Also writes assets/screenshots/manifest.json with what was captured.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, newPage, session, close, go, settle, shot, outDir, WEB, SCHOOL } from './lib.mjs';

const OUT = outDir('assets', 'screenshots');
const manifest = [];
const failures = [];
const only = process.argv.slice(2);

async function snap(page, name, note) {
  await shot(page, OUT, name);
  manifest.push({ file: `${name}.png`, url: new URL(page.url()).pathname, note });
}

async function step(label, fn) {
  try { await fn(); } catch (e) {
    failures.push({ label, error: e.message.split('\n')[0] });
    console.error(`  ✖ ${label}: ${e.message.split('\n')[0]}`);
  }
}

// ── Ask Agent helpers — drive the real panel, nothing is stubbed ──────────
async function openAgent(page) {
  await page.getByRole('button', { name: /Ask Agent/ }).first().click();
  await page.getByLabel('Message input').waitFor();
  await page.waitForTimeout(500);
}
async function typeQuestion(page, text) {
  const input = page.getByLabel('Message input');
  await input.click();
  await input.pressSequentially(text, { delay: 12 });
}
async function sendAndWait(page) {
  const before = await page.locator('.ai-msg.assistant').count();
  const reply = page.waitForResponse((r) => /\/ai\/agent(\/confirm)?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await reply;
  await page.waitForFunction((n) => {
    const bubbles = document.querySelectorAll('.ai-msg.assistant');
    return bubbles.length > n && !bubbles[bubbles.length - 1].querySelector('.spinner');
  }, before, { timeout: 30_000 });
  await page.waitForTimeout(700);
}

const ROLES = {
  // Signed out: the school's own sign-in door.
  async signin(browser) {
    const page = await newPage(browser);
    await step('signin', async () => {
      await page.goto(`${WEB}/${SCHOOL}`, { waitUntil: 'networkidle' });
      await settle(page, 800);
      await snap(page, 'signin', 'Oakridge Academy sign-in door');
    });
    await page.context().close();
  },

  async superAdmin(browser) {
    const page = await session(browser, 'superAdmin');
    await step('super-admin-dashboard', async () => { await go(page, '/super-admin'); await snap(page, 'super-admin-dashboard'); });
    await step('super-admin-schools', async () => { await go(page, '/super-admin/schools'); await snap(page, 'super-admin-schools'); });
    await step('school-customization', async () => { await go(page, '/super-admin/customization'); await snap(page, 'school-customization'); });
    await step('seat-management', async () => { await go(page, '/super-admin/seats'); await snap(page, 'seat-management'); });
    await step('super-admin-dashboards', async () => { await go(page, '/super-admin/dashboards'); await snap(page, 'super-admin-dashboards'); });
    await close(page);
  },

  async admin(browser) {
    const page = await session(browser, 'admin');

    // HERO: the write flow. Question → server-side proposal → confirmation
    // card → Confirm → result → audit entry.
    await step('ask-agent-write', async () => {
      await go(page, '/admin');
      await openAgent(page);
      await snap(page, 'ask-agent-open-admin', 'Ask Agent panel, suggestions for Admin');
      await typeQuestion(page, 'Post an announcement saying the annual sports day is on 5 October');
      await snap(page, 'ask-agent-write-question');
      await sendAndWait(page);
      await page.locator('.ai-confirm').waitFor();
      await snap(page, 'ask-agent-confirmation', 'Server-composed summary awaiting Confirm');
      const confirmReply = page.waitForResponse((r) => /\/ai\/agent\/confirm$/.test(new URL(r.url()).pathname));
      await page.locator('.ai-confirm-yes').click();
      await confirmReply;
      await page.waitForFunction(() => !document.querySelector('.ai-confirm') && !document.querySelector('.ai-msg .spinner'));
      await page.waitForTimeout(800);
      await snap(page, 'ask-agent-confirmed', 'Action executed after Confirm');
    });
    await step('admin-audit', async () => { await go(page, '/admin/audit'); await snap(page, 'admin-audit', 'Audit log incl. the Agent-posted announcement'); });
    await step('admin-announcements', async () => { await go(page, '/admin/announcements'); await snap(page, 'admin-announcements'); });
    await step('admin-dashboard', async () => { await go(page, '/admin'); await snap(page, 'admin-dashboard'); });
    await step('admin-timetable', async () => { await go(page, '/admin/timetable'); await snap(page, 'admin-timetable'); });
    await step('admin-admissions', async () => { await go(page, '/admin/admissions'); await snap(page, 'admin-admissions'); });
    await step('admin-payments', async () => { await go(page, '/admin/payments'); await snap(page, 'admin-payments'); });
    await step('admin-permissions', async () => { await go(page, '/admin/permissions'); await snap(page, 'admin-permissions'); });
    await close(page);
  },

  async teacher(browser) {
    const page = await session(browser, 'teacher');
    await step('teacher-dashboard', async () => { await go(page, '/teacher'); await snap(page, 'teacher-dashboard'); });

    // Marks Class 5 A (Diya's class) for today. This is a real save.
    await step('teacher-attendance', async () => {
      await go(page, '/teacher/attendance');
      const section = page.getByLabel('Section');
      const opts = await section.locator('option').allTextContents();
      const target = opts.find((o) => /Class 5\s*–\s*A/.test(o)) ?? opts[0];
      await section.selectOption({ label: target });
      await settle(page, 600);
      await snap(page, 'teacher-attendance-empty');
      await page.getByRole('button', { name: 'Mark all present' }).click();
      await page.waitForTimeout(400);
      // One late arrival, so the register reads like a real morning.
      const lateButtons = page.locator('button[title="LATE"]');
      if (await lateButtons.count() > 3) await lateButtons.nth(3).click();
      await page.waitForTimeout(400);
      await snap(page, 'teacher-attendance', 'Register filled, before saving');
      const saveBtn = page.locator('button').filter({ hasText: /^Save/ }).first();
      await saveBtn.click();
      await page.waitForTimeout(1500);
      await snap(page, 'teacher-attendance-saved', 'Register saved');
    });

    await step('teacher-grading', async () => {
      await go(page, '/teacher/assignments');
      await snap(page, 'teacher-assignments');
      await page.getByRole('button', { name: 'Submissions' }).first().click();
      await settle(page, 800);
      await snap(page, 'teacher-submissions', 'Submissions roster');
      const grade = page.getByRole('button', { name: /Grade|Regrade|Edit grade/ }).first();
      if (await grade.count()) {
        await grade.click();
        await page.waitForTimeout(700);
        await snap(page, 'teacher-grading', 'Grading an actual submission');
      }
    });
    await step('teacher-material', async () => { await go(page, '/teacher/material'); await snap(page, 'teacher-material'); });
    await step('teacher-timetable', async () => { await go(page, '/teacher/timetable'); await snap(page, 'teacher-timetable'); });
    await close(page);
  },

  async parent(browser) {
    const page = await session(browser, 'parent');
    await step('parent-dashboard', async () => { await go(page, '/parent'); await snap(page, 'parent-dashboard'); });
    await step('parent-attendance', async () => { await go(page, '/parent/attendance'); await snap(page, 'parent-attendance'); });
    await step('parent-performance', async () => { await go(page, '/parent/performance'); await snap(page, 'parent-performance'); });

    // Permission contrast: the same question the principal asks, answered
    // from this parent's own scope.
    await step('ask-agent-parent', async () => {
      await go(page, '/parent');
      await openAgent(page);
      await typeQuestion(page, 'Show fee collection summary');
      await sendAndWait(page);
      await snap(page, 'ask-agent-parent-read', 'Same question as the principal, parent scope');
    });

    await step('parent-pay', async () => {
      await go(page, '/parent/payments');
      await snap(page, 'parent-payments');
      await page.getByRole('button', { name: /Pay now/ }).first().click();
      await page.locator('.modal').waitFor();
      await page.waitForTimeout(600);
      await snap(page, 'parent-pay-modal');
      const payResp = page.waitForResponse((r) => /\/fees|\/payments/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
      await page.locator('.modal button[type="submit"]').click();
      await payResp;
      await page.waitForTimeout(1800);
      await snap(page, 'parent-pay-done', 'Sandbox payment captured on the real ledger');
      await go(page, '/parent/payments');
      await snap(page, 'parent-payments-paid');
    });

    await step('parent-study-help', async () => {
      await go(page, '/parent/study-help');
      await page.getByPlaceholder(/What do you want help/).fill('Fractions');
      await page.getByRole('button', { name: 'Get help' }).click();
      await page.waitForFunction(() => !/Thinking…/.test(document.body.innerText), null, { timeout: 45_000 });
      await settle(page, 800);
      await snap(page, 'parent-study-help');
    });
    await close(page);
  },

  async student(browser) {
    const page = await session(browser, 'student');
    await step('student-dashboard', async () => { await go(page, '/student'); await snap(page, 'student-dashboard'); });
    await step('student-assignments', async () => {
      await go(page, '/student/assignments');
      await snap(page, 'student-assignments');
      await page.getByRole('button', { name: /^(Submit|Resubmit)$/ }).first().click();
      await page.locator('.modal').waitFor();
      await page.waitForTimeout(600);
      await snap(page, 'student-assignment-submit', 'Submission dialog (not sent)');
    });
    await step('student-timetable', async () => { await go(page, '/student/timetable'); await snap(page, 'student-timetable'); });
    await close(page);
  },

  async principal(browser) {
    const page = await session(browser, 'principal');
    await step('principal-risk', async () => {
      await go(page, '/principal/risk', 1200);
      // The page lists stored predictions; only Rescan scores every student.
      // On a fresh database the store is partial, so press it first.
      const rescanned = page.waitForResponse((r) => /\/risk\/scan/.test(r.url()) && /refresh=true/.test(r.url()), { timeout: 60_000 });
      await page.getByRole('button', { name: /Rescan/ }).click();
      await rescanned;
      await settle(page, 1200);
      await snap(page, 'principal-risk');
      await page.getByRole('button', { name: 'Details' }).first().click();
      await page.waitForTimeout(1500);
      await settle(page, 600);
      await snap(page, 'principal-risk-drawer');
    });
    // After the risk page: it re-runs the scan, and the dashboard reads the
    // stored result — in this order the two screens show the same numbers.
    await step('principal-intelligence', async () => { await go(page, '/principal', 1200); await snap(page, 'principal-intelligence'); });
    await step('principal-fees', async () => { await go(page, '/principal/fees'); await snap(page, 'principal-fees'); });
    await step('principal-attendance', async () => { await go(page, '/principal/attendance'); await snap(page, 'principal-attendance'); });

    // READ: school-wide scope.
    await step('ask-agent-read', async () => {
      await go(page, '/principal');
      await openAgent(page);
      await snap(page, 'ask-agent-open', 'Ask Agent panel, suggestions for Principal');
      await typeQuestion(page, 'Show fee collection summary');
      await snap(page, 'ask-agent-read-question');
      await sendAndWait(page);
      await snap(page, 'ask-agent-read', 'Answer from get_fee_statistics via MCP');
    });
    await close(page);
  },

  async warden(browser) {
    const page = await session(browser, 'warden');
    await step('warden-dashboard', async () => { await go(page, '/warden'); await snap(page, 'warden-dashboard'); });
    await step('warden-rooms', async () => { await go(page, '/warden/rooms'); await snap(page, 'warden-rooms'); });
    await close(page);
  },

  async librarian(browser) {
    const page = await session(browser, 'librarian');
    await step('librarian-dashboard', async () => { await go(page, '/librarian'); await snap(page, 'librarian-dashboard'); });
    await step('librarian-books', async () => { await go(page, '/librarian/books'); await snap(page, 'librarian-books'); });
    await close(page);
  },
};

const browser = await launch();
for (const [role, run] of Object.entries(ROLES)) {
  if (only.length && !only.includes(role)) continue;
  console.log(`\n▸ ${role}`);
  await step(role, () => run(browser));
}
await browser.close();

const manifestFile = path.join(OUT, only.length ? `manifest.${only.join('-')}.json` : 'manifest.json');
writeFileSync(manifestFile, JSON.stringify({ capturedAt: new Date().toISOString(), viewport: '1920x1080@2x', school: 'Oakridge Academy', shots: manifest, failures }, null, 2));
console.log(`\n${manifest.length} captured, ${failures.length} failed`);
if (failures.length) console.log(JSON.stringify(failures, null, 2));
