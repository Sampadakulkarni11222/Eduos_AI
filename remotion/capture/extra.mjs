/**
 * Supplementary captures for the dynamic cut: screens the first pass did not
 * shoot (calendar, exams, documents, tickets, user management…).
 *
 *   npm run stack:fast           # same production build as the main capture
 *   node capture/extra.mjs       # → .work/extra/*.png, for review
 *
 * Writes to a staging folder, never to assets/screenshots: a screen is only
 * copied into the promo's assets after it has been looked at, so an empty
 * list or a dev-only artefact never reaches the video. Read-only — nothing
 * here clicks a button that changes data.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, session, close, go, shot, outDir } from './lib.mjs';

const OUT = outDir('.work', 'extra');
const ROUTES = {
  admin: ['/admin/users', '/admin/calendar', '/admin/documents', '/admin/tickets', '/admin/attendance', '/admin/library'],
  teacher: ['/teacher/calendar', '/teacher/exams', '/teacher/tickets', '/teacher/classes', '/teacher/announcements'],
  parent: ['/parent/calendar', '/parent/documents', '/parent/announcements', '/parent/tickets', '/parent/assignments', '/parent/material'],
  student: ['/student/performance', '/student/material'],
  warden: ['/warden/students', '/warden/medical'],
  librarian: ['/librarian/requests'],
};

const captured = [];
const failures = [];
const browser = await launch();
for (const [who, routes] of Object.entries(ROUTES)) {
  if (process.argv[2] && process.argv[2] !== who) continue;
  const page = await session(browser, who);
  for (const r of routes) {
    const name = `${who}${r.replace(/^\/[a-z]+/, '').replace(/\//g, '-')}`;
    try {
      await go(page, r, 900);
      await shot(page, OUT, name);
      captured.push({ file: `${name}.png`, url: new URL(page.url()).pathname });
    } catch (e) {
      failures.push({ name, error: e.message.split('\n')[0] });
      console.error(`  ✖ ${name}: ${e.message.split('\n')[0]}`);
    }
  }
  await close(page);
}
await browser.close();
writeFileSync(
  path.join(OUT, 'manifest.extra.json'),
  JSON.stringify({ capturedAt: new Date().toISOString(), viewport: '1920x1080@2x', school: 'Oakridge Academy', shots: captured, failures }, null, 2),
);
console.log(`\n${captured.length} captured, ${failures.length} failed`);
