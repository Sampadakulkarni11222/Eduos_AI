# Requirements ledger — institution operations

Started on branch `feat/education-erp-operations`; later rounds continued on the `feat/platform-*` branches (current: `feat/platform-part-4`). Last updated 2026-10-17.

Rounds 1 to 5 record the operations work of 2026-10-13 to 2026-10-14. The "Added in the sixth round" section summarises the platform work since. For the full row-by-row list of what the owner asked for and where it stands, see `PENDING-REQUIREMENTS-2026-10-17.md`; for the platform modules, see `PLATFORM-COVERAGE-MATRIX.md`.

## How to read the status column

| Status | Meaning |
|---|---|
| **Tested** | Built, and its rules are covered by automated API tests that pass. |
| **Built** | Built and passing typecheck, lint and production build, and opened in a browser as every profile without error, but with no automated test of its own and not every button pressed. |
| **Simulated** | The workflow works, but the outside step (sending, filing, paying) is recorded and not performed. The record says so. |
| **Blocked** | Cannot be finished without something from outside (an account, a credential, a decision). |
| **Planned** | Not built. |

Every API below is **Tested** unless noted; every screen is **Built**.

## Ledger

| # | Requirement (from the request) | What was delivered | API | Screen | Notes |
|---|---|---|---|---|---|
| 1 | Work on a branch, never push to main | All work is on `feat/education-erp-operations` | — | — | Nothing committed to `main`. |
| 2 | Flashcard attendance with Present / Absent, Go back and Pass | Flashcard mode beside the list mode on the teacher's attendance page. Skipped students come back at the end. Progress is saved on the server as a draft, so a refresh or a second device does not lose it. | Tested (7) | Built, logic tested (frontend unit test) | Nothing is final until the teacher submits. |
| 3 | Principal as approver | One approvals inbox. Maker-checker, stages, delegation, escalation, conflict of interest, per-school rules. | Tested (15) | Built | Covers the request types listed in `DEFAULT_POLICIES`. |
| 4 | File attendance and returns to boards, agencies and government | Regulatory returns: data prepared from records (UDISE+ profile, AISHE profile, monthly attendance, staff strength, custom), review, approval, then submission recorded with the acknowledgement. | Tested | Built | **Simulated**: the system does not file on any government portal. A person files and records the proof. |
| 5 | Letters: manage, reply, remind | Correspondence register with owner, tasks, reply draft, principal approval, dispatch proof, reminders, overdue list. | Tested | Built | Task suggestions are keyword rules, not AI. |
| 6 | Trustee and board meetings with WhatsApp updates | Meetings, agenda, minutes, resolutions, action tracking. Members are notified in the app and by WhatsApp when it is live. | Tested | Built | WhatsApp is **Simulated** until templates are registered (see INTEGRATION-STATUS). |
| 7 | Agreements, rules and policies | Agreement register with renewals; policies with versions and read-acknowledgement. | Tested | Built | |
| 8 | Cost analysis | Budgets with committed and actual spend from procurement; cost figures on the principal's home. | Tested | Built | Cost per student shows "Not available" until budgets and enrolment are both present. |
| 9 | Teacher and student performance | Existing risk and workload pages kept; summarised on the Command Centre. Since the fourth round the principal also sees each teacher against their module plan: subjects on track and behind, lessons recorded this week, syllabus covered and the average of published exam results. | Tested | Built | The figures are signals shown side by side, not a rating or a ranking. |
| 10 | Administration department: operations | Facilities, room booking with clash checks, maintenance work orders. | Tested | Built | |
| 11 | Background verification of teachers and drivers, principal decides | Consent, checks with evidence, principal's final decision, expiry. | Tested | Built | **Planned**: showing a driver's clearance on transport routes. No link to any police or agency system; results are entered by staff. |
| 12 | Events, fests, meeting arrangement | Proposal, budget, approval, tasks, close-out. | Tested | Built | |
| 13 | Finance: payroll, PF, salary | Pay structures, date-versioned statutory rules, runs, bank file, payment confirmed by a second person, PF / ESI / PT / TDS exports, payslips. | Tested (10, shared with 14–15) | Built | **Simulated**: bank file and statutory files are downloads; nothing is uploaded to a bank, EPFO or ESIC. Statutory figures must be checked by the school's accountant before first use. |
| 14 | Procurement | Request, quotes, order, receipt, invoice, three-way match, payment, assets. Split-purchase and duplicate-invoice checks. | Tested | Built | |
| 15 | Financing | Funding proposals and loan comparison with instalments. | Tested | Built | Comparison only; no lender connection. |
| 16 | One source for all school and college needs | Institution type (school, college or both) switches the terms used. | Tested | Built | College-specific academics (credits, semesters, accreditation evidence) are **Planned**. |
| 17 | Marketing and sales department | Funnel, campaigns, creative approval, seats and offers, counselling, on top of the existing admission CRM. | Tested (10, shared with 20–21) | Built | **Planned**: publishing to social media and ad platforms. Posters are uploaded, not generated. |
| 18 | Organisation map and school profile that update from data | Org units, positions, appointments; chart built from them. Profile with a completeness check. | Tested | Built | |
| 19 | Smart dashboards for every profile | A role home for each role and the principal's Command Centre with a daily briefing. | Tested | Built | Missing data is shown as "Not available", never as zero. |
| 20 | Licences, POCSO and other mandatory sessions, district notices | Licence register with expiry reminders, training sessions with attendance, notice register, notice sources watched for changes. | Tested | Built | Notice watching only detects that a page changed; a person reads and records the notice. Not yet run against live sites. Catalogue entries start as "Under review". |
| 21 | Newsroom, circles, seniors and alumni | Posts with moderation, reactions, circles, mentoring (supervised for students), media consent, alumni role. | Tested | Built | Videos show as links (uploads have no captions). |
| 22 | 3D game-like campus map for every profile, limited by access, with drill-down | Campus World: 3D buildings and rooms, click for detail, buttons to related pages, list view as the accessible alternative. Filtering is done on the server. | Tested | Built | Uses a sample layout until a school enters its own. Lessons come from the timetable and headcounts from the attendance register; nobody is located or tracked. Frame rate not yet measured on a low-end phone. |
| 23 | Safeguarding | Anyone can raise a concern; only the safeguarding team can read cases; details encrypted. | Tested | Built | The system records reports to authorities; it does not make them. |
| 24 | Messaging with honest status | Outbox with consent, quiet hours, idempotency and true delivery status. | Tested | Built | **Simulated** without a provider. |
| 25 | Research all roles; final audit; competitors; AI opportunities | `REFERENCE-ANALYSIS.md`, `docs/research/regulatory-source-register.md`, `COMPETITOR-GAP-ANALYSIS.md`, `AUDIT.md`. | — | — | AI opportunities are listed, **not implemented** (see below). |
| 26 | Install a skill to read the videos | Frames were extracted locally with FFmpeg and read. | — | — | The MCPmarket installer link was invalid or expired and was not run. |

## Added in the second round

| # | Item | Status |
|---|---|---|
| 27 | Campus World visible to every profile from day one: sample campus created automatically, daylight view, top-bar button and home-page card on every portal, room buttons, links from a room to related pages | Tested (API) and checked in a browser as every profile |
| 28 | Scheduler for reminders, held messages, expiry checks and notice watching | Tested |
| 29 | Assistant tools for the new modules (read-only at the time; confirmed writes were added later, see the sixth round); assistant turned on for the five new roles | Tested |
| 30 | Driver background-check status on transport routes | Tested |
| 31 | Course credits on subjects | Tested |
| 32 | Accreditation evidence tracker (NAAC, NBA, inspection, custom) | Tested (API); screen built and loads |
| 33 | Session no longer lost on reload (frontend could not reach the backend on Windows) | Checked in a browser |
| 34 | Links between the new screens fixed | Tested and checked in a browser |
| 35 | Browser smoke test of every new screen as every profile | Done |

## Added in the third round

| # | Item | Status |
|---|---|---|
| 36 | Campus World rebuilt to the reference videos' standard: bright model-style campus, road loop with traffic and a school bus calling at its bay, coloured roofs and glazed facades, playground goals and court hoops, furnished interiors (desks, chairs, boards, lab benches, shelves, auditorium seating), map pins over live places, search, live clock, icon KPI cards, a timetable step tracker for the selected room, and an In use / Repairs / Events table | Built, checked in a browser |
| 37 | Interactive dashboard on every home page: briefing with read-aloud, department tiles, a live mini campus, hover-and-click charts (attendance, fees, approvals, online classes, compliance, admissions funnel, repair ageing) and a live activity feed, each limited to what the role may read | Tested (API, frontend) and checked in a browser |
| 38 | Digital lectures and online meetings in every portal: scheduling for one's own classes (or anyone, for the principal and administration), weekly repeats, built-in Jitsi rooms or pasted Google Meet/Zoom/Teams links, clash checks, join window, join record, recordings, notes and material | Tested (11) and checked in a browser |
| 39 | Email channel for notifications, beside in-app and WhatsApp, with the same honest status and an email opt-out | Tested |
| 40 | Class announcements, reminders, changes and cancellations by app, email and WhatsApp | Tested |
| 41 | Board and government submissions: researched; no public filing API found. Every return and letter prints as an official document on letterhead with declaration, signature and seal blocks and a DRAFT mark until approved; new board candidate list and mandatory disclosure templates | Tested (5) and checked in a browser |

## Added in the fourth round

| # | Item | Status |
|---|---|---|
| 42 | Syllabus & Modules: a teacher lays out each subject as modules with a planned window and topics, and records what was taught after a lesson (topics, note, homework). Progress is only what was recorded; "behind" is measured against the planned window | Tested (5) and checked in a browser as principal, teacher and student |
| 43 | Principal's module tracker: every subject and every teacher against the plan (on track, behind, no lesson recorded this week, no plan), with the timeline of each subject one click away | Tested and checked in a browser |
| 44 | Live classrooms on the campus map: present out of enrolled from today's attendance register ("register not taken" until it is marked), the lesson and teacher from the timetable, the module and next topic from the plan, exam in progress, the week's attendance, and a class shown as away when its lesson is in a lab | Tested (8) and checked in a browser |
| 45 | Departments on the campus map: thirteen departments placed on their rooms, each with its head, people and live figures for those allowed to see them, and buttons to its pages in the reader's own portal | Tested and checked in a browser |
| 46 | Campus map opens full page, with seated students that follow the register's count, a teacher at the board, an invigilator in an exam room, a time slider and "Play the day" for staff, and a button to hide the panels | Checked in a browser |
| 47 | The sample campus now covers the whole school: named labs, a staff room, separate offices for administration, accounts, admissions, HR, compliance and the principal, a hostel, a store, and a department on every space | Tested |
| 48 | Sample data for every section (`npm run seed:operations`, and part of `npm run demo`): 27 sections from the school profile to payroll, all written through the same services the screens use, all fictional | Run on an empty database; every section reports its result |
| 49 | Assistant tool for syllabus progress (192 tools in the catalogue) | Tested |

## Added in the fifth round

| # | Item | Status |
|---|---|---|
| 50 | Reverse-engineering, ownership, load, query-plan and database-integrity testing, with the tools kept in the repo (`npm run qa:*`, `npm run db:audit`) | Run; results in QA-TESTING.md |
| 51 | About 110 confirmed problems from seven role audits, fixed with regression tests (finance, payroll, newsroom, academics, library, hostel, marketing, compliance, governance, student and parent) | Tested |
| 52 | The assistant never decides anything; confirmations are bound to their channel; every filing is confirmed. Approvals and decisions are made by the approver on the website | Tested |
| 53 | Absence and late alerts to guardians from the day register | Tested |
| 54 | Parents apply for leave and request certificates for their own children | Tested |

## Added in the sixth round (platform parts 2 to 5, 2026-10-14 to 2026-10-17)

Detail and evidence for each module are in `PLATFORM-COVERAGE-MATRIX.md`; role-by-role findings are in `profile-audits/`. Status words are those of the matrix.

| # | Item | Status |
|---|---|---|
| 55 | The assistant now reads and writes. The generated catalogue (`docs/MCP-TOOLS.md`, `docs/mcp-tools.json`) lists 470 tools: 243 reads (GET) and 227 that create, change, delete or perform an action. Writes need confirmation: the tool returns a summary and a token and runs only when the person approves; some calls are conditional (a dry run does not need it). What a role sees is computed from its live permissions. The assistant never decides: approvals, payment checks, admission decisions and filings are done by the approver on the website. Thirteen capabilities are deliberately not exposed (raw database access, arbitrary HTTP, online payment execution, bulk messages and others; see the Blocked section of the catalogue) | Tested |
| 56 | Analytics workspace (46 metrics in 8 departments, period comparison, saved views, CSV/PDF export), quarterly reports, common tasks and reminders, bills and renewals, labs, fleet and trips, PTM and parent review calls, staff leave and cover, report cards, clubs, showcase, alumni, support plans, portfolios, sustainability, library barcodes, health room and nurse role, shifts, teacher qualifications, universal search | Built; most also Tested in the API suites. Browser re-check of the parts 3 and 4 pages as every role is not complete |
| 57 | Live campus: time slider and date, students shown only during scheduled hours, one dynamic detail page, collapsible panels, "my campus" view for parents, teachers and students | Built; browser-checked for the principal. Parent, teacher and student views tested through the API only |
| 58 | Marketing connectors (Meta, Google, LinkedIn, X), live ad sync and social posting, Meta lead-ads webhook, offline campaigns with QR short links | Simulated until a provider app is configured and the school connects its account. Not verified against live providers (`INTEGRATIONS-SETUP.md`) |
| 59 | Camera event review, GPS telemetry for buses, ID checkpoints and gate/pickup | Simulated. Camera observations stay unverified until a person reviews them; no real camera, tracker or card reader is connected |
| 60 | Generated UI panels (`modules/genui`, `components/genui`) using an in-house OpenUI Lang subset and zod; the `@openuidev/*` packages are not installed | Built; the substitution is awaiting the owner's confirmation |
| 61 | Opportunities newsletter: curated catalogue of competitions, exams and research opportunities, eligibility matching, weekly and monthly editions with flashcards, quiz, poll and map, unsubscribe page, scheduled job | Built. Email is simulated until a provider is set. The catalogue is curated, not refreshed from the web. Google Alerts feeds and AI extraction/polish are in progress in the working tree (`newsletterAi.model.js`, `newsletter/ai`) and are not finished or tested |
| 62 | Profile audits for every role (11 files in `profile-audits/`) with fixes | Done; remaining findings are listed in each file and summarised in `PENDING-REQUIREMENTS-2026-10-17.md` |
| 63 | Mobile and speed pass (responsive layout, request de-duplication, caching, indexes) | Partly done. Some chart text, bars and scroll tables remain; cold portal load is about 4 s on a desktop |

## How to run the demo

1. In `backend`, run `npm run demo` (add `-- --build` after changing the frontend, or on the first run).
2. Open `http://localhost:3000/oakridge`.
3. Staff sign in with `role@schoolerp.com` (for example `principal@schoolerp.com`, `teacher@schoolerp.com`, `hr@schoolerp.com`); the shared demo password is `ChangeMe@123!` (used by the API login; the demo page also accepts the email with the OTP shown on screen).
4. Parent, student and alumnus sign in by phone number with an OTP; in development the code is shown on the screen. Phones: student `+910000003001`, parent `+910000004001`, alumnus `+910000000033`.

The database is in memory and fictional; it is lost when the script stops. Email, WhatsApp, SMS, ads, social posting, cameras, GPS and card readers are simulated; nothing is sent, filed or paid.

## Not done

- **Pressing every button on every screen.** The browser test proves pages load; forms were not all exercised by hand.
- **Real AI text.** Drafts (`/ai/drafts`), the quarterly report narrative and free-form assistant understanding need an AI model key, which is not configured. Without one, drafts are template text labelled "Template draft (no AI key configured)" and the assistant answers by built-in question matching.
- **Instant push to the campus map.** The map asks the server every 30 seconds, so a register a teacher has just taken appears within half a minute, not at once.
- **Poster and creative generation.** Marketing material is uploaded and approved, not designed in the system.
- **Live provider checks.** Email, WhatsApp, SMS, ad sync, social posting, GPS, camera and ID readers are built against the providers' documented API shapes or recorded test adapters and have never run against a live provider. They stay simulated until a provider is connected.
- **Direct filing with boards or government**: no public API exists (see docs/research/board-submission-channels.md).
- **Meeting-service integration**: EduOS does not create meetings inside Google Meet, Zoom or Teams, or read their attendance; the host pastes the link.
- **College academics beyond credits and accreditation evidence**: credit-based grading, semester promotion, outcome mapping.
- **Anything that needs an outside party**: filing on government portals, bank uploads, WhatsApp template approval, an accountant's sign-off.
