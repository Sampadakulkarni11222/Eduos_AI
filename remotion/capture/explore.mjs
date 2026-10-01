// Quick low-res pass over every target route, to see what each screen holds
// before writing the real capture. Output: .work/explore/*.png
import { launch, newPage, signIn, go, shot, outDir, PEOPLE } from './lib.mjs';

const ROUTES = {
  superAdmin: ['/super-admin', '/super-admin/schools', '/super-admin/customization', '/super-admin/seats'],
  principal: ['/principal', '/principal/risk', '/principal/fees', '/principal/attendance'],
  admin: ['/admin', '/admin/timetable', '/admin/admissions', '/admin/payments', '/admin/permissions', '/admin/audit'],
  teacher: ['/teacher', '/teacher/attendance', '/teacher/assignments', '/teacher/material'],
  parent: ['/parent', '/parent/student-view', '/parent/payments', '/parent/study-help'],
  student: ['/student', '/student/assignments', '/student/timetable'],
  warden: ['/warden'],
  librarian: ['/librarian', '/librarian/books'],
};

const only = process.argv[2];
const dir = outDir('.work', 'explore');
const browser = await launch();
for (const [who, routes] of Object.entries(ROUTES)) {
  if (only && only !== who) continue;
  const page = await newPage(browser, { scale: 1 });
  try {
    await signIn(page, PEOPLE[who]);
    for (const r of routes) {
      await go(page, r);
      await shot(page, dir, `${who}${r.replace(/\//g, '_')}`);
    }
  } catch (e) {
    console.error(`✖ ${who}: ${e.message}`);
    await shot(page, dir, `${who}__error`).catch(() => {});
  }
  await page.context().close();
}
await browser.close();
