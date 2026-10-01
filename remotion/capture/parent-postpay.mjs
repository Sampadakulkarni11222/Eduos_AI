/**
 * Re-captures the parent's Ask Agent fee answer *after* the invoice is paid.
 *
 * The promo shows the parent paying INV-2026-0001 in the day scene, then asks
 * the same question as the principal twenty seconds later. Captured before the
 * payment, that answer still claimed ₹45,000 outstanding — true when it was
 * taken, contradictory in the cut. This pays first (the real sandbox flow),
 * then asks, so the two scenes agree.
 */
import { launch, session, close, go, settle, shot, outDir } from './lib.mjs';

const OUT = outDir('assets', 'screenshots');
const browser = await launch();
const page = await session(browser, 'parent');
try {
  await go(page, '/parent/payments');
  const payNow = page.getByRole('button', { name: /Pay now/ });
  if (await payNow.count()) {
    await payNow.first().click();
    await page.locator('.modal').waitFor();
    const paid = page.waitForResponse((r) => /\/fees|\/payments/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
    await page.locator('.modal button[type="submit"]').click();
    await paid;
    await page.waitForTimeout(1500);
  } else {
    console.log('  (already paid)');
  }

  await go(page, '/parent');
  await page.getByRole('button', { name: /Ask Agent/ }).first().click();
  await page.getByLabel('Message input').waitFor();
  const input = page.getByLabel('Message input');
  await input.click();
  await input.pressSequentially('Show fee collection summary', { delay: 12 });
  const reply = page.waitForResponse((r) => /\/ai\/agent$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const body = await (await reply).json();
  console.log('  reply:', body?.data?.reply);
  await page.waitForFunction(() => {
    const b = document.querySelectorAll('.ai-msg.assistant');
    return b.length > 0 && !b[b.length - 1].querySelector('.spinner');
  }, null, { timeout: 30_000 });
  await settle(page, 900);
  await shot(page, OUT, 'ask-agent-parent-read');
} finally {
  await close(page);
  await browser.close();
}
