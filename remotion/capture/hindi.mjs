/**
 * The Hindi Ask Agent exchange, captured from the real panel.
 *
 *   node capture/hindi.mjs
 *
 * Nothing about voice is simulated: the panel's own language selector is set
 * to हिन्दी (a real control — the same one dictation uses), the question is
 * typed, and the answer is whatever Rules mode returns. The question asked is
 * the parent's outstanding fee, which every seed bills identically
 * (₹45,000, INV-2026-0001), so the number agrees with the other captures.
 */
import { launch, session, close, go, shot, outDir } from './lib.mjs';

const OUT = outDir('assets', 'screenshots');
const QUESTION = 'fees kitni baki hai';

const browser = await launch();
const page = await session(browser, 'parent');
try {
  await go(page, '/parent');
  await page.getByRole('button', { name: /Ask Agent/ }).first().click();
  await page.getByLabel('Message input').waitFor();

  // The real language control. It sets the language the assistant answers in
  // (and would set the dictation language, which headless cannot exercise).
  const lang = page.getByLabel('Voice language');
  if (!(await lang.count())) throw new Error('No language selector — cannot show a Hindi exchange honestly');
  await lang.selectOption({ label: 'हिन्दी' });
  await page.waitForTimeout(400);

  const input = page.getByLabel('Message input');
  await input.click();
  await input.pressSequentially(QUESTION, { delay: 30 });
  await page.waitForTimeout(400);
  await shot(page, OUT, 'ask-agent-hindi-question');

  const reply = page.waitForResponse((r) => /\/ai\/agent$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const body = await (await reply).json();
  console.log('  reply:', body?.data?.reply);
  await page.waitForFunction(() => {
    const b = document.querySelectorAll('.ai-msg.assistant');
    return b.length > 0 && !b[b.length - 1].querySelector('.spinner');
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(900);
  await shot(page, OUT, 'ask-agent-hindi-answer');
} finally {
  await close(page);
  await browser.close();
}
