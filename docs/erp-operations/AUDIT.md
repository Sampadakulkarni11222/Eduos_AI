# Final audit — institution operations

Branch `feat/education-erp-operations`, audited 2026-10-13. Companion documents: `REQUIREMENTS-LEDGER.md`, `ROLE-PERMISSION-MATRIX.md`, `INTEGRATION-STATUS.md`, `COMPETITOR-GAP-ANALYSIS.md`, `REFERENCE-ANALYSIS.md` and `docs/research/regulatory-source-register.md`.

## Verdict

The server side is built and tested, and every new screen has now been opened in a real browser as every profile with no crash and no failed request. That is a smoke test: it proves each page loads with seeded data, not that every button on it has been pressed. Nothing here files with a government portal, pays anyone or sends a real message.

## Checks run

| Check | Result |
|---|---|
| Backend tests, full suite | 4,068 tests in 143 files: 4,057 passed, 9 skipped by design, 2 failed in the full run and 1 file could not start because the in-memory test database crashed. Of those, one was this round's own scheduler test (not updated for the new lecture-reminder job; now fixed) and the other was a load failure. All three files pass when rerun on their own (83 tests). |
| Backend tests added in this branch | 95 across 10 files: approvals (16), attendance drafts (7), administration (18), finance (10), community, marketing and campus (10), scheduler (4), accreditation and credits (7), digital lectures (11), official documents (5), dashboard data (7) |
| Frontend tests, full suite | 403 passed, 28 files |
| Frontend typecheck (`tsc --noEmit`) | Clean |
| Frontend lint (`next lint`) | No warnings or errors |
| Frontend production build | Succeeds |
| Browser smoke test | 182 page loads as 13 profiles (every home page and every operations page in each sidebar, now including Digital Lectures). 172 were clean. The other 10 were home pages: some only showed the first-load request that is sent before the session token arrives and is retried, and the admin and finance home pages timed out because the new dashboard linked to a page those portals do not have. That link is fixed and tested; the sweep was not re-run after the fix. |
| Both seeders, on an empty database | Run cleanly, including the sample campus |
| Dependency audit, backend | 4 findings (3 high, 1 moderate), all in packages already present on `main`; no backend dependency was added |
| Dependency audit, frontend | 10 findings (7 high, 3 moderate), all in packages already present on `main`. The two packages added (`three`, `@types/three`, both 0.169.0) have none. |
| Pressing every button on every screen | **Not done** |
| Accessibility test with a screen reader | **Not done** |
| Load or performance test of the API | **Not done** |

### How the browser test was run

A throwaway copy of the system was started: an in-memory database seeded by the two seed scripts, the backend on port 5050 and a production build of the frontend on port 3100. A headless Chrome signed in as each profile and opened that profile's home page and every operations page in its sidebar, recording page errors and any request that failed. The 3D campus was also screenshotted at campus, building and room level. The developer's own servers and database were not touched.

## Measured performance

Only build-time figures were measured.

| Item | Figure |
|---|---|
| Frontend compile time | 18 s |
| JavaScript shared by every page | 102 kB |
| Teacher attendance page with flashcards | 12.4 kB page, 150 kB first load |
| 3D library | One separate file of about 520 kB before compression, loaded only when Campus World is opened |

Not measured: API response times, campus frame rate on a phone, behaviour with a large school's data.

## Audit by role

| Role | New pages | Can decide | Checked by tests | Open points |
|---|---|---|---|---|
| Principal | Command Centre, approvals, and every operations page | Approvals at their stage; final background-verification decision | Approval engine, verification decision | Does not hold safeguarding case access unless granted |
| School admin | Administration pages, compliance, marketing, messaging log | Approvals at their stage | Administration workflows | Restricted permissions are not given automatically |
| Finance | Payroll, procurement, budgets, agreements | Finance stages | Payroll and procurement rules | Second person needed to confirm payment |
| HR | Verification, payroll, organisation, trainings | HR stages | Shared with the above | New role |
| Marketing | Admission CRM, campaigns, creative, newsroom moderation | None on money | Marketing and community | New role |
| Compliance officer | Safeguarding cases, compliance centre, verification, correspondence | Safeguarding case handling | Safeguarding access rules | New role |
| Trustee | Overview, board meetings, budgets, compliance (read) | Board-stage approvals | Governance | Sees summaries only |
| Teacher, librarian, warden | Today, approvals (own), events, facilities, purchase requests, payslips, newsroom | None | Attendance drafts; own-scope checks | |
| Student, parent | Newsroom, campus (limited), report a concern, policies | None | Campus filtering, consent | Students: mentoring is supervised |
| Alumnus | Newsroom, mentoring, campus (limited) | None | Community | New role; signs in by phone |

## Security and privacy

| Control | State |
|---|---|
| Permission checked on the server for every new route | Yes. Personal pages (my home, my policies and trainings) need sign-in only and return only the caller's own data. |
| One school cannot see another's data | Yes, by the platform's existing tenant scoping. Cross-school tests exist for approvals, administration and community; payroll, procurement and attendance drafts rely on the same scoping without a cross-school test of their own. |
| Maker-checker and conflict of interest | Yes; tested |
| Safeguarding details encrypted and kept out of the audit log | Yes |
| Salary and bank details behind a separate permission | Yes |
| Photos of students shown only with consent at the right level | Yes; tested |
| Campus map filtered on the server | Yes; tested |
| Seed data fictional | Yes |
| AI approves, files or decides anything | No. No AI was added. |

## Problems found by the full test run, and how they were fixed

The first full backend run found 24 failures in 12 files, all caused by this branch colliding with existing security rules:

| Problem | Fix |
|---|---|
| The principal had been given read access to the admissions CRM, which existing rules forbid. | Removed. The principal sees aggregate funnel and seat figures through `marketing.read`; enquiry details stay with admissions staff. |
| The assistant's attendance tool passed on the student photo path that was added for flashcards. | The assistant's copy of the roster no longer includes photos. |
| `payroll.approve` was granted but not checked anywhere. | The final approval of a payroll run now requires it, so approving a stage is not enough on its own. Tested. |
| `messaging.manage` was granted but not checked anywhere. | It now guards the new route that releases messages held for quiet hours. Tested. |
| The five new roles have no assistant tools, while existing tests expected every school role to have some. | Recorded on purpose: these roles do not hold `ai.copilot.use` yet. The tests now pin that exact list, so any new role has to be placed deliberately. |
| The platform super admin no longer holds every permission. | Recorded on purpose: safeguarding case files and individual pay are withheld from the platform role (`PLATFORM_WITHHELD`). Tests updated to say so. |
| The new permission keys have no assistant tools. | Recorded in the coverage ledger as "planned". |

## Fixed in the second round

| Problem | Fix |
|---|---|
| The 3D campus was reported as "nothing to see". | Three causes. A school with no buildings recorded got a one-line note instead of a map: the labelled sample campus is now created the first time anyone opens the map, and by the seed. The map opened in a dark dusk palette in the evening: it now opens in daylight. And it was one unremarkable sidebar item: every portal now has a Campus button in the top bar and a Campus World card on its home page. |
| After a page reload, or 15 minutes, people were returned to the sign-in page. | On Windows the frontend server resolved `localhost` to IPv6 while the backend listens on IPv4, so the session could never be renewed. The frontend's server-side default is now `127.0.0.1`. This existed before this branch. |
| Links between the new screens led to "not found". | They were missing the portal part of the address. One hook now builds every such link for the portal the reader is in. Found by the browser test; covered by a test. |
| The 3D scene was rebuilt from scratch every minute. | A data refresh now updates the scene in place. |
| Rooms could only be chosen by clicking the 3D canvas. | Each floor's rooms, and the outdoor spaces, are also buttons. A room's panel now links on to the related pages of the reader's own portal (timetable, attendance, library, transport and so on). |
| No scheduler. | An in-process scheduler runs reminders, releases messages held for quiet hours, expires lapsed clearances and checks watched notice pages. Each job runs once per school per window even with several server processes. A repeated reminder no longer re-notifies in the app. |
| The assistant could not see the new modules. | Sixteen read-only tools were added, and the assistant was turned on for HR, marketing, compliance, trustees and alumni. It reports; it cannot approve, file, pay, clear or decide. Safeguarding, individual pay and the contents of background checks are not available to it at all. |
| Driver clearance was not shown on transport routes. | Transport managers see each named driver's background-check status. Families do not. |
| College features were thin. | Subjects can carry credits, and the Compliance Centre has an accreditation tracker (NAAC, NBA, inspection or custom) with evidence items, owners and proof. |
| The demo Marketing, Compliance, Trustee and Alumnus accounts shared phone numbers with seeded teachers. | They now use their own numbers. |

## Third round

| Item | Result |
|---|---|
| Campus World | Rebuilt to the reference videos' layout and look; screenshots checked at campus, building and room level. |
| Interactive dashboard | On every home page; each chart, tile and feed entry links to its records; tested per role. |
| Digital lectures | Scheduling, clash checks, join window, join record, recordings; announcements by app, email and WhatsApp; 11 tests. |
| Official documents | Returns and letters print on letterhead for signature; DRAFT until approved; exports recorded; 5 tests. |
| Board submission APIs | Researched; none public. Recorded in docs/research/board-submission-channels.md. |

## Known limitations

1. **The browser test is a smoke test.** Every page loads; not every button has been pressed. Expect some defects in the forms.
2. **Statutory payroll figures need professional sign-off.** The rules follow the research register, including the PF wage ceiling change on 17 September 2026 and the wage definition from 21 November 2025. They are not legal or tax advice.
3. **The compliance catalogue is a starting list.** Every entry starts "Under review" and must be confirmed for the school's board and state.
4. **Online classes run on a meeting service.** The default Jitsi server is public: anyone with a room's link can enter. Use the institution's own server for privacy. Attendance means the link was opened, not time spent.
5. **Official documents depend on the Institution profile** for the letterhead; a missing name, address or code is called out on the page.
6. **Accreditation criteria are headings only**, from each agency's published structure as understood when written. A cycle says so until someone records that they checked it against the current manual. The institution adds its own metrics.
7. **Campus World uses a sample layout** until a school enters its own. It shows scheduled activity, not live positions. Frame rate was measured only under software rendering in the test browser (4 to 12 frames a second), which says little about a real device.
8. **Driver clearance is matched on the driver's name** as typed on the route, so a spelling difference reads as "no record".
9. **The assistant's new tools answer through its built-in question matching** for the words listed in its vocabulary. Freer phrasing needs an AI model key to be configured.
10. **Notice watching was not run against real sites.**
11. **College academics stop at credits and accreditation evidence.** There is no credit-based grading, semester promotion or outcome mapping.
12. **Videos in the newsroom are links**, because uploads carry no captions.
13. **Pre-existing dependency findings** remain, and one pre-existing lint error in `tests/studyHelp.skillSync.test.js`.

## Recommended next work

1. Restart the running backend and frontend so they pick up this branch (see the handover note).
2. Walk each role through its forms by hand, pressing the buttons the smoke test did not.
3. Have an accountant check payroll output for two real months.
4. Register the WhatsApp templates and test with one opted-in number.
5. Replace the sample campus with the real buildings and rooms.
6. Check each accreditation template against the agency's current manual.
7. Link drivers to verification records by person rather than by name.
8. Update the dependencies with audit findings.
