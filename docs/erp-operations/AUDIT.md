# Final audit — institution operations

Branch `feat/education-erp-operations`, audited 2026-10-13. Companion documents: `REQUIREMENTS-LEDGER.md`, `ROLE-PERMISSION-MATRIX.md`, `INTEGRATION-STATUS.md`, `COMPETITOR-GAP-ANALYSIS.md`, `REFERENCE-ANALYSIS.md` and `docs/research/regulatory-source-register.md`.

## Verdict

The server side is built and tested. The screens are built and compile, but **no screen has been clicked through in a browser against a running server**. That is the main thing to do before anyone relies on this branch. Nothing here files with a government portal, pays anyone or sends a real message.

## Checks run

| Check | Result |
|---|---|
| Backend tests, full suite | 4,033 tests in 138 files. 4,029 passed; 4 failed when the in-memory test database's connection timed out under load (`admin.writeAudit`, `askAi.routingDefects`). Both files pass when rerun on their own (246 tests). |
| Backend tests added in this branch | 59 across 5 files: approvals (15), attendance drafts (7), administration (17), finance (10), community, marketing and campus (10) |
| Frontend tests, full suite | 392 passed, 27 files |
| Frontend typecheck (`tsc --noEmit`) | Clean |
| Frontend lint (`next lint`) | No warnings or errors |
| Frontend production build | Succeeds |
| Dependency audit, backend | 4 findings (3 high, 1 moderate), all in packages already present on `main`; no backend dependency was added |
| Dependency audit, frontend | 10 findings (7 high, 3 moderate), all in packages already present on `main`. The two packages added (`three`, `@types/three`, both 0.169.0) have none. |
| Browser test of new screens | **Not done** |
| Accessibility test with a screen reader | **Not done** |
| Load or performance test of the API | **Not done** |

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

## Known limitations

1. **Screens are unverified in a browser.** Expect layout and wiring defects.
2. **No scheduler.** Reminders and the release of messages held for quiet hours run only when triggered (see `INTEGRATION-STATUS.md`).
3. **Statutory payroll figures need professional sign-off.** The rules follow the research register, including the PF wage ceiling change on 17 September 2026 and the wage definition from 21 November 2025. They are not legal or tax advice.
4. **The compliance catalogue is a starting list.** Every entry starts "Under review" and must be confirmed for the school's board and state.
5. **Campus World uses a sample layout** until a school enters its own. It shows scheduled activity, not live positions.
6. **Notice watching was not run against real sites.**
7. **College features are thin**: terms and profile only.
8. **Ask Agent cannot see the new modules.**
9. **Few frontend tests** for the new views.
10. **Videos in the newsroom are links**, because uploads carry no captions.
11. **Pre-existing dependency findings** remain.

## Recommended next work

1. Start the app with seed data and walk each role through its pages; fix what breaks.
2. Add a scheduler that calls the reminder and message-release routes, and runs expiry checks.
3. Have an accountant check payroll output for two real months.
4. Register the WhatsApp templates and test with one opted-in number.
5. Add frontend tests for approvals, payroll and safeguarding screens.
6. Give Ask Agent read-only tools for the new modules.
7. Show driver clearance on transport routes.
8. Plan the college track: credits, semesters, accreditation evidence.
9. Update the dependencies with audit findings.
