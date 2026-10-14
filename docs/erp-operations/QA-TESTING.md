# Testing round: reverse engineering, load, database, roles and the assistant

Branch `feat/education-erp-operations`, 2026-10-14. This round tested the
whole product the way an outsider would: from the running API and the
browser, without trusting the code or the docs, then fixed what it found.
Companion documents: `AUDIT.md` (overall audit), `REQUIREMENTS-LEDGER.md`,
`ROLE-PERMISSION-MATRIX.md`.

All of it ran against throwaway, seeded, in-memory databases. Nothing here
touched a real school's data.

## How it was tested

| Method | What it does | Tool (re-runnable) |
|---|---|---|
| Route discovery | Lists every API route by walking the Express router, with no docs: 612 routes (259 read, 353 write). | `npm run qa:routes` |
| Reverse-engineering sweep | Calls every route as all 13 roles and as nobody, with an unknown id, hostile ids (`abc`, `../../etc/passwd`, `null`), a hostile query string (operators, a 100,000-row page, a catastrophic regex, impossible dates) and, for writes, five hostile bodies: empty, MongoDB operators, wrong types, script injection plus a 200 KB string, prototype pollution, and malformed JSON. Flags 5xx crashes, anonymous access, leaked internals and unbounded pages. | `npm run qa:sweep [get\|write]` |
| Ownership sweep | As a student and as a parent, calls every read route with another child's student, enrolment, section and profile ids, in the query string and in the path, and flags any answer containing that child's data. | `npm run qa:ownership` |
| Assistant (MCP) audit | Core layer (schemas, confirmation tokens, tenancy, errors) read and verified; then all 192 tools' handlers called in-process as every role with other people's ids. | audit notes; tests in `tests/mcp*` |
| Load test | Virtual users weighted like a school (40% students, 30% parents, 20% teachers, 5% principal, 5% administration) open their most-used pages at 10, 25, 50 and 100 concurrent users. | `npm run qa:load` |
| CPU and query profiling | Database operations counted per endpoint; CPU profiled under load. | (scratch tooling; findings below) |
| Query-plan audit | The MongoDB profiler records every operation while the sweep replays real traffic; the report lists collection scans and queries that read 20× more documents than they return. | `npm run qa:plans on\|report` |
| Database integrity audit | Records with no school, references to missing records, references across schools, money not in whole paise, declared indexes not built. Read-only; exits non-zero on a problem, so it can run in CI. | `npm run db:audit` |
| Role audits | Seven audits, one per group of profiles, each opening every sidebar page at desktop (1366×820) and phone (390×844) width, exercising the main flows through the API and the browser, and comparing with competitors. | screenshots and notes (not in the repo) |

Testing skills used and installed for Claude Code (each read before installing; all
are instructions and local helper scripts): Anthropic's `webapp-testing`,
`frontend-visual-qa`, and from `qa-skills` `performance-testing`,
`database-testing`, `security-testing`, `api-testing`, `exploratory-testing`,
`accessibility-testing`; also `qa-test`, `owasp-security`, `front-end-test`.
`gstack` was not installed: its setup compiles binaries with Bun, rewrites
CLAUDE.md and commits to the repository.

## What the sweeps found

| Finding | Severity | Fixed |
|---|---|---|
| A signed-in student or parent read **every invoice in the school** (720) with `?enrollmentId[$ne]=…`. Nothing removed MongoDB operators from requests, and the invoice list trusted a caller-supplied enrolment at "own" scope. | Critical | A guard drops `$`-operator and prototype keys from every query string and body; the invoice list ignores any enrolment that is not the caller's. Regression tests. |
| `GET /tickets?pageSize=…` crashed (500). | Medium | Fixed and tested. |
| Everything else: 353 write routes × 6 hostile inputs, 259 read routes × 15 identities × hostile ids and queries | — | No crash, no anonymous read or write (except the public health/readiness probes), no leaked stack trace or database message, no unbounded page. |
| `x-school-id` naming another school | — | Ignored for school users: the school always comes from the sign-in (verified). |
| Ownership sweep after the fix | — | No other child's data on any read route, for a student or a parent. |

## Load and performance

| Concurrent users | Requests/s before → after | Median before → after | 95th percentile before → after | Errors |
|---|---|---|---|---|
| 10 | 13.5 → 45.7 | 422 ms → 144 ms | 3.1 s → 0.6 s | 0 |
| 25 | 18.0 → 47.3 | 810 ms → 327 ms | 4.4 s → 1.6 s | 0 |
| 50 | 17.9 → 52.6 | 1.5 s → 0.7 s | 35.7 s → 2.7 s | 0 |
| 100 | 4.0 → 66.2 (it had collapsed) | 60.6 s → 1.1 s | 64.1 s → 4.1 s | 0 |

One Node process on a developer laptop that was also running the test suites;
the absolute figures are pessimistic, the before/after comparison is fair.

What changed:
1. **School-first compound indexes.** The query-plan audit showed that most lookups by a linked record were answered from the single-field school index, reading every document the school owns: 720 rows to find one guardian link, 6,000 marks to return 5. The tenancy plugin now adds `{ tenantId, <link> }` for every field that references another model; staff lookups by role got their own index.
2. **Campus map**: one timetable query for the whole campus instead of one per room (144 → 50 queries).
3. **Sign-in lookups** (account, profile, role) cached for 5 seconds and dropped at once on sign-out, suspension or a status change.
4. **Live boards** (campus map, pulse, home insights) share an answer for 15 seconds, and identical concurrent requests share one computation. Off in tests.
5. Date formatters built once instead of per chart point.

Still the slowest under load: the older role dashboards (parent, teacher,
student), at 20–30 queries each. Running more than one Node process (cluster
mode) multiplies throughput by the number of cores and is the next step for a
large school.

## Database

| Check | Result |
|---|---|
| Collection scans in real traffic | One (131 permission rows); everything else uses an index. |
| Queries reading ≥20× what they return | Lookups by linked record — fixed by the compound indexes above. Remaining wide reads are whole-school reports (risk scan, attendance analytics) that are meant to read a lot. |
| Records with no school | Sign-in audit entries were saved with no school, so a school's audit log never showed its own sign-ins. Fixed: they carry the school of the profile that signed in. Unidentified WhatsApp senders and platform actions have no school by design. |
| Dangling references | Only notifications addressed to people removed by a re-seed; `seed:operations --reset` now clears them. |
| Cross-school references, money in fractions, unbuilt indexes | None. |

## Role audits: confirmed problems fixed this round

Every fix has a regression test unless marked.

**Assistant (MCP).** The assistant could carry out approvals, refunds, publication of marks and other decisions after a human said yes; a WhatsApp "yes" could confirm a proposal made on the website; six "request" tools filed without confirmation; several questions were routed to the wrong topic. See the assistant section of `AUDIT.md` for what changed.

**Newsroom and mentoring (17).**
- Mentoring:
  - Anyone could cancel or complete someone else's mentoring; there is now a state machine, and duplicate requests are refused.
  - A lower-case mode let a private one-to-one session with a minor through the supervision rule.
- Circles:
  - Alumni and parents could join student circles and see minors.
  - Removed members could rejoin.
  - Circle moderators could publish posts they could not read.
- Reports and photo consent:
  - Any report could hide every photo on any post.
  - `javascript:` media links were accepted.
  - Photo consent applied only when students were tagged; every image now needs tagged students with consent or a "no identifiable students" confirmation.
- Moderation and comments:
  - Taken-down posts could be republished.
  - Adults' comments where students read them were not moderated.
  - Reaction counts lost updates under concurrency.
- Posts can now be edited and withdrawn; reports show the target and can take it down.

**Teacher and principal (14).**
- Attendance:
  - Attendance accepted any date. It now refuses the future and dates before the academic year, and allows three days of back-dating before `attendance.regularize` is needed.
  - One child showed four different attendance percentages, because per-period records were counted as days.
- Homework, marks and lessons:
  - Homework copied the request body; it now validates its fields and can be edited and withdrawn.
  - Marks could be entered before the exam.
  - AB/ML (absent / medical) marks are supported.
  - Results could be published with marks missing; there is now a reopen-for-correction path.
  - Lessons could be recorded at any past date.
  - Flashcard totals were wrong, and class lists were not in roll order.
- Approvals:
  - Large amounts were approved with one click from the list; there is now a review step.
  - The inbox ignored priority.
- Any lookup failure said "no school at this address".

**Student and parent.**
- Pending homework always showed 0.
- The parent library page was broken.
- Library filters were forbidden to students.
- Parents could hard-delete medical records; removal is now a soft delete by the office, with an audit entry.
- Parents could not apply for leave or request certificates for their child; both now work, scoped to linked children.
- There were no absence alerts. A child marked absent or late on the day register now triggers one message to their guardians, through the outbox: consent, quiet hours and honest delivery status apply.
- Mixed time and date formats.

**Librarian, warden, marketing, compliance, trustee.**
- Cross-role:
  - Sign-in was limited to 30 attempts per 15 minutes per internet address, which locks out a whole school behind one connection. It is now limited per address and account, with a looser per-address ceiling.
  - The limit could be dodged with a forged `X-Forwarded-For`. The proxy setting is now off unless configured.
  - Side drawers clipped their content.
- Library:
  - A fine was charged on the due date itself.
  - Loans could be issued to students who don't exist.
  - Copy counts went inconsistent.
- Hostel:
  - Rooms could be allotted across genders.
  - Closed or shrunk rooms could keep residents.
  - The last bed could be allotted twice.
- Marketing:
  - An RTE-reserved seat could go to a general applicant.
  - Seat offers never expired; they now expire through the scheduler, freeing the seat without offering it to anyone automatically.
  - Moving a lead to "enrolled" created an active student with no class.
- Compliance and safeguarding:
  - Anonymous safeguarding reporters were identifiable.
  - Urgent cases sorted below standard ones.
  - A trustee could review a regulatory return.
  - Trainings could be completed before they happened.
- Governance: approved minutes and resolutions could be rewritten, and minutes recorded for meetings not yet held.

**Administration, finance, HR (18).**
- Fees and receipts:
  - A refund could be applied to a payment not yet approved, which could then be approved and credited again. Refunds now go to the principal for approval, carry a reason, amount and mode, and are audited.
  - Receipts were random numbers with no series; they are now a gap-free series per financial year. The receipt PDF now carries the transaction reference, fee heads, balance, amount in words and cashier.
  - UPI is accepted at the counter, with the ₹2 lakh cash rule (s.269ST) warned.
  - The fee summary counted cancelled invoices.
- Purchasing:
  - The three-way match compared unit counts, not values.
  - Purchase orders went to vendors without due diligence; that now needs a recorded override.
- Payroll:
  - Off-cycle and full-and-final runs paid everyone a full month again.
  - Saving one employee's loss-of-pay entry wiped the others.
  - EPF wages were uncapped in the ECR file, which is now also produced in ECR text format.
  - ESI was rounded to the nearest rupee instead of up.
  - Professional tax was silently zero, and TDS was zero without warning.
  - An administrator could add an adjustment to their own pay line. Payroll preparation is now withheld from administrators by default, and every adjustment is listed for the approver.
- Read-only users could close letters.
- Verification:
  - Verification consent was recorded without evidence.
  - A driver's police check could be waived.

## Not done, and why

Large features the audits recommend, left for a later round:
- **Staff:**
  - substitution / proxy periods and the principal's morning staff board;
  - staff leave balances and staff attendance;
  - a hire flow for HR (create the account, pay structure and verification in one go).
- **Academics:** lesson plans; CBSE term report cards with co-scholastic grades.
- **Parents:**
  - parent–teacher meeting slot booking;
  - parent–teacher messaging;
  - circulars with acknowledgement and consent;
  - fee centre and the Section 80C certificate.
- **Accounts:** Tally export, concessions, GST.
- **Library:** accession register with barcodes.
- **Hostel:** out-pass with parent approval, roll call, mess.
- **Admissions:** lead capture and online application.
- **Governance:** a board pack PDF.
- **Alumni:** directory, certificates for alumni, giving.

AI that drafts (letters, minutes, lesson plans, question papers, report-card remarks, reply suggestions) needs an AI model key, which is not configured. Every such feature must stay a draft a person accepts; the assistant never approves, files, pays or decides.
