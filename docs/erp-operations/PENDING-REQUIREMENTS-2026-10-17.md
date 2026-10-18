# Pending requirements cross-check (2026-10-17)

Branch at time of check: `feat/platform-part-4` (HEAD `4ecf26b`). Working tree has no code changes (only the three owner video files are untracked).

## How this was produced

- Owner messages were extracted from the session transcript (87 genuine entries; the rest were "proceed", agent relays and context summaries). Requirements come from the owner's own messages of 2026-10-13 (first brief), 10-13 (3D game view and dashboard, digital lecture and board filings), 10-14 (3D details, MCP, role audit, testing skills), 10-14 (big feature brief with the attached `OPUS_5_5_SCHOOL_PLATFORM_PROMPT.txt` and `ADVANCED-FEATURE-RESEARCH-2026-10-14.md`), 10-15 (3D "add, don't change", dashboards, MCP, universal search, marketing, newsroom social), 10-15 (health, ad sync, social posting, teacher qualifications, mobile, campus time, shifts, sample data, OpenUI) and 10-17 (opportunities newsletter, Google Alerts and AI newsletter).
- "What is built" was checked against the coverage matrix, the profile audits, the integration docs, route mounts in `backend/src/routes/index.js`, module folders, `frontend/src/lib/ops-routes.json` and the MCP tool folder. Matrix rows were not trusted blindly; where I could confirm a module and a page exist I say so, otherwise "unverified".
- Nothing was run (no tests, no browser). "Done" here means code present and recorded as tested in the repo's own logs; it does not mean re-verified today.

Status words: **Done** (built, tested in code), **Partial**, **Simulated** (works end to end, needs a provider, hardware or credentials to go live), **Not built**, **Deliberately not built**.

## 1. Requirement table

Dates are when the owner first asked (2026-10-xx).

### Process and rules

| Requirement (owner's words, short) | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Never push to main; make a branch first | 13 | Done | Work on `feat/*` branches; current `feat/platform-part-4` | Latest branch push status unverified (owner asked 10-17 "if not pushed, push in a new branch"). |
| Use research and testing skills; install if needed | 13, 14 | Partial | `QA-TESTING.md` lists skills installed and tools (`qa:routes`, `qa:sweep`, `qa:ownership`, `qa:load`, `qa:plans`, `db:audit`) | The unreviewed MCPmarket curl installer was deliberately not run (link invalid or expired). |
| Read the reference videos | 13 | Done | Frames extracted with FFmpeg (ledger row 26) | None. |
| Share list of what was newly added (for testing) | 14 | Done (earlier) | Ledger and coverage matrix | Parts 3 to 5 additions are in the matrix only; no single tester-facing list was produced since part 2. |

### Core departments (first brief)

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Flashcard attendance (present/absent, go back, pass) | 13 | Done | `components/attendance/flashcard-*`, `/attendance/drafts` | None found. |
| Principal administration: file returns to boards/agencies, letters, reminders, replies | 13 | Simulated | `/compliance`, `/correspondence`; official print-ready documents | No board or government API exists; the principal prints, signs and files by hand (researched, documented). |
| Board and trustee meetings with WhatsApp updates | 13 | Simulated | `/governance`, messaging outbox | WhatsApp templates must be approved by Meta; status is SIMULATED until then. |
| Agreements, rules, policies, cost analysis, teacher/student performance | 13 | Done | `/contracts`, policies with acknowledgement, `/budgets`, leadership workload and attendance | Cost per student shows "Not available" until budgets and enrolment exist. |
| Administration department: background verification of teachers and drivers, principal final approval | 13 | Done | `/verification`, driver clearance on transport routes | Results typed in by staff; no agency or police API. |
| Events, fests, meeting arrangement | 13 | Done | `/institution-events`, `/facilities` | None found. |
| Finance: payroll, PF, salary, procurement, financing | 13 | Simulated | `/payroll`, `/procurement`, `/budgets`; EPF ceiling rule rows | Bank file and EPFO/ESIC files are downloads only; accountant must verify formats. |
| Marketing and sales department (leads, posters, banners, social, counsellors) | 13 | Done | `/marketing`, `/marketing-growth`, admissions CRM, follow-up queue | Poster and banner creative is uploaded and approved, not designed in the system. |
| Organisation structure map and school profile | 13 | Done | `/institution`, `/org` | None found. |
| Licensing transparency, POCSO and mandatory sessions, district collector notices | 13 | Partial | `/compliance` licences, training sessions, notice register and notice sources | Notice watching has "not yet run against live sites" in the docs; it only detects change, a person reads it. Catalogue entries start "Under review". |
| One platform for all school and college needs | 13 | Partial | Institution type switch (school, college, both) | College academics (credit grading, semester promotion, outcome mapping) not built. |
| Smart analytics dashboards for every profile | 13 | Done | `/insights/dashboard`, `RoleDashboard`, `dash-charts.tsx`, `/analytics` | Browser verification of every chart for every role is unverified. |
| Digital lecture, meeting creation, mail/notification/WhatsApp | 13 | Partial | `/lectures` (Jitsi built in; Meet/Zoom/Teams by pasted link) | No Google, Zoom or Teams API integration; attendance is "link opened", not time in session. |
| Board/government submission: use API else export, print and sign | 13 | Done | Official document export on letterhead (`docs/research/board-submission-channels.md`) | Digital signature or e-sign not built (see decisions). |

### 3D campus / Campus World

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| 3D game-like map for every profile, role-limited, with drill-down | 13 | Done | `campus-world.tsx`, `campus-scene.ts`, `/campus` | Frame rate on a low-end phone not measured (ledger). |
| Department details on click, redirect to page | 14 | Done | Departments on the map; ledger 45 | None found. |
| Students per classroom from attendance, teacher, exam vs class, module details | 14 | Done | `/campus/live`, `live-detail.service.js` | Polling every 15 to 30 s; no push (SSE). |
| Module update with timeline per teacher; principal tracker | 14 | Done | `/syllabus`, module tracker | None found. |
| Sample data in every section | 14, 15 | Done | `seed_operations`, `seed_p3_sampledata`, `seed_p3_workflows` ("100 sections OK" in log) | `demo.completeness` test takes about 5 minutes; keep an eye on seed time (190 s on a loaded machine). |
| Real-time details on room click, existing UI untouched | 15 | Done | `LiveNowBlock`, `GET /campus/live` | Same polling caveat. |
| One dynamic detail page for all "see details" | 15 | Done | `LiveDetailView` hidden route `live?kind=` | None found. |
| Collapse option for 3D panels | 15 | Done | `CollapsePanel`, `usePanelState` | None found. |
| Parent 3D view: child's class, teacher, strength, present | 15 | Done | `/campus/my-view`, `MyCampusPanel` | Parent, teacher and student browser walk not done in p3-campus (API and tests only). |
| Role views for all profiles (limited access) | 15 | Done | `myView` per role | Same browser caveat. |
| Update 3D map with every new feature (labs, sports, transport, gardens, waste) | 14 | Partial | `/campus/layers`: labs, transport bay, tasks, gate counts | Sports/arts and greenery layers sit "behind an optional-module guard"; whether they show real data in the demo is unverified. No utilities or maintenance-tasks layer other than tasks by department. |
| Students visible in Campus World | 15 | Done | `campus.dayPlan`, scene `setMoment`, seeded timetable | Browser-checked for principal only; other roles unverified. |
| View changes with selected time slot | 15 | Done | Staff slider 06:00 to 20:00 plus date picker, `GET /campus/moment` | None found. |
| Students only during scheduled hours; holiday and non-school = no movement animation | 15 | Done | `day-plan.js` (holiday, weekly off, exam-only, motion false) | None found. |
| Live timing | 15 | Done | School time zone live mode | None found. |
| Shift management | 15 | Done | `/shifts`, `schoolShift.model.js`, clash refusal | None found. |
| Teacher qualifications on the map | 15 | Done | `/staff-profile`, family consent flag default off | Shown to families only when the teacher consents; empty until staff fill it (HR fill-up is manual). |
| Missing data / sample data everywhere | 15 | Done | See sample data row | Gaps in newer modules (part 4/5 pages) in the seed are unverified. |

### Analytics, finance and reminders

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Detailed analytics, custom dates, year-over-year, per department | 14 | Done | `/analytics` (46 metrics, 8 departments), `utils/periods.js`, saved views | Bank-style cash-flow forecast depth unverified. |
| Reliable analytics (definitions, freshness, no invented zeros) | 14 | Done | `catalogue.js` | None found. |
| Pricing, quotation, bills, procurement, admission, revenue, licence dates in analytics | 14 | Partial | Procurement, bills and renewals feed analytics (F01, F02, F04, F05) | Budget actuals from bills and payroll not mapped (needs school's mapping, finance audit). |
| Engaging analytics with graphs, easy navigation | 15 | Done | `analytics-view.tsx`, `dash-charts.tsx` | Visual check at all breakpoints was a sweep, not a hand test. |
| Bill and service reminders, cost and leakage dashboard | 14 | Done | `/bills`, `/tasks`, job `bills.due` | Leakage uses rule-based review queues (as the prompt wanted); no bank-statement import. |
| Bills and invoice generation and tracking | 14 | Done | Fees invoices, `INV/<FY>/000001`, `/accounts-export` | None found. |
| Quarterly auto reports to administration and principal | 14 | Done | `quarterly.service.js`, job `reports.quarterly`, PDF | Real email delivery not live (provider needed); narrative by AI needs a model key. |
| Tally / GST / concessions | 14 | Done | `/accounts-export`, `/fee-adjustments` | Statutory formats need accountant check. |
| Scenario planning | 14 | Done | `/scenarios` | None found. |

### Camera, safety and transport

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Camera: is the teacher taking class | 14 | Simulated | Class check-in tap (done) plus reviewer-confirmed presence; `/camera`, `/teacher-presence` | No real camera provider adapter; camera pilot off by default (by prompt design). |
| Camera: detect bullying, report to teacher and principal | 14 | Simulated | `camera.service.js`: observations stay UNVERIFIED until a human reviews; referral to safeguarding | No trained model or real camera feed; prompt forbids automatic findings. Activation needs hardware and a model evaluation. |
| Bus tracking | 14 | Simulated | `/fleet/telemetry` (HMAC, nonce, dedupe), `/bus-today` | Needs real GPS devices or app. |
| Student ID tracking for transparency | 14 | Simulated | `/checkpoints`, `/gate`, `/pickup`, lost-card revocation | QR/RFID readers are simulated. |
| Vehicle capacity, service notifications (fire, bus) | 14 | Done | `/fleet` (vehicles, trips, atomic seat claim, document expiries, fire-extinguisher check) | None found. |
| Safe transport handover | 14 | Done | `/bus-duty`, `safety/pickup.service.js` | None found. |
| Visitor / pickup passes | 14 (prompt) | Done | `safety/visitors.service.js` | Hostel visitor permission for warden not granted (see decisions). |

### Sustainability, showcase, alumni, newsroom

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Greenery and waste management, recognition, social points | 14 | Done | `/sustainability`, `/eco-points`, SHVR/GSP/Eco Club packs | Current application windows must be rechecked by the school; no automatic submission (by design). |
| Showcase previous top rankers | 14 | Done | `/showcase` | None found. |
| Alumni community: batches, social links, post-exit access | 14 | Done | `/alumni`, `/profile-links`, alumnus portal | Self-claim for people who left before EduOS ("I studied here" with HR verification) not built; donations not built. |
| Newsroom social media (engaging, circles, seniors) | 13 | Done | `/community`, `newsroom-view.tsx` | Videos shown as links (no captions). |
| Daily tech/education forum auto-posts like Google Alerts | 14 | Partial | `/digest` (allowlisted RSS/Atom, SSRF-safe fetch, opt-in) | No Google Alerts RSS wiring (see newsletter section). Prompt says never call it a Google Alerts API. |
| Newsroom to social: staff pick networks, parents/students refused | 14 | Simulated | `/newsroom-social`, `/social` outbox | Unable to see option (10-15) was fixed per matrix; live posting needs OAuth app credentials and account connection. |
| Live social posting | 15 | Simulated | `social.publishers.js` (Facebook, Instagram, LinkedIn, X recorded shapes) | Unverified against live providers; YouTube posting and some formats unconfirmed. |
| Live ad platform sync | 15 | Simulated | `adsync.service.js` (Meta, Google Ads, GA4, LinkedIn); CSV import path | Unverified against live APIs; needs app credentials and approvals. |
| Marketing: offline (banners, pamphlets, posters, roadshows) | 15 | Done | `/marketing-growth/offline*`, QR short links, attribution | None found. |
| Marketing connectors (Meta, Google, others) | 15 | Simulated | `connectors.service.js`, `IntegrationsPanel` | As above. |

### Engagement and academic modules

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Review calls and PTM scheduling and follow-ups | 14 | Done | `/ptm`, `/review-calls`, job `ptm.reminders` | Meeting link by Jitsi or pasted link only. |
| Sports and extracurricular (dance, music, arts) | 14 | Done | `/clubs` | Equipment and fixture assistant tools are "Gap" in MCP list. |
| Substitute cover | 14 | Done | `/cover`, `/staff-leave` | None found. |
| Staff leave balances | 14 | Done | `/staff/leave` | Assistant "apply for leave" fix: matrix says Partial (`directIntents.js`); older tests pinned the old refusal, so confirm they were updated (unverified). |
| CBSE term report cards | 14 | Done | `/report-cards` | Results moderation and release dashboard left to later (leadership audit). |
| PTM booking | 14 | Done | See PTM | None. |
| Parent-teacher messaging | 14 | Done | `/conversations` | Family action inbox not built. |
| Library barcodes | 14 | Done | `/library/copies`, `library-labels` | Stock verification session, MARC/ISBN import not built. |
| Hostel out-pass | 14 | Done | `/outpass`, `/my-outpass` | Hostel visitors permission for warden not granted. |
| Online admission form | 14 | Done | `/public/admissions/*` | None found. |
| Alumni directory | 14 | Done | `/alumni` | See above. |
| AI-written drafts | 14 | Simulated | `/ai/drafts`; "Template draft (no AI key configured)" fallback | Needs an AI model key to produce real AI text. |
| Lab operations (science and computer) | 14 | Done | `/labs`, stock ledger, expiry, calibration | Barcode/QR scanning has manual fallback; hardware scanners not tested. |
| Service and renewal tracking | 14 | Done | `/bills/renewals`, `/tasks` | None found. |
| Student support plans | 14 | Done | `/support-plans` | Not available through the assistant for parents (by design, awaiting review). |
| Competency portfolios | 14 | Done | `/portfolios` | None found. |
| Offline workflows | 14 | Partial | `offline-queue.ts`, `sw.js`, idempotency middleware | Service worker prod-only; offline marking coverage limited to the listed flows (attendance, lab, gate, sanitation, PTM check-in, class check-in). Not browser-verified on a real flaky network (unverified). |
| Evidence-based AI | 14 | Done | `evidence.js`, evidence footer | Matrix says Partial for some surfaces; spot-check not done. |
| Health visits and medication | 15 | Done | `/health`, `HealthView`, nurse role | Immunisation schedule check and cluster alert from page not built. |

### Assistant (MCP / WhatsApp) and search

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Everything doable by Ask AI and WhatsApp automation, per role | 14, 15 | Partial | 470 tools in `docs/MCP-TOOLS.md`; `platformPeople.js` (47), `platformOps.js` (76), `platformGaps.js` (15), part 4 role tools | `MCP-AUTOMATION-GAPS.md` lists many "Gap" items still a click (club sessions/fixtures, PTM waitlist, report-card marks grid, quizzes authoring, syllabus modules CRUD, correspondence and compliance drafting, budgets, org structure, digest sources). Decisions and publishing are By design. |
| Audit the MCP part thoroughly and fix | 14 | Done | `MCP-AUDIT.md`, fix agent log | Pinned catalogue counts in some tests were left for reconciliation (student-alumnus audit); status now unverified. |
| Universal search on all profiles | 15 | Done | `GET /search`, `modules/search` | Browser verification across 13 portals unverified. |
| Assistant "apply for leave" for teachers | 15 | Partial | `staffLeaveStep` in `directIntents.js` | Unverified end to end by wording variants. |

### UI, speed, mobile, generative UI

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| Alignment issues (funnel bar, etc.) | 14 | Done | Visual QA sweep, equal funnel bars | New pages added after the sweep not swept. |
| Mobile responsiveness | 15 | Partial | `responsive.css`; 13 portals sweep: 415 findings down to roughly 30 in one portal; later fixes for other portals | Final all-portal sweep count not recorded; remaining items (SVG chart text, chart bars, tables) listed as residual. |
| Slow tab switching | 15 | Done | API request dedup, theme caching, brotli quality, indexes; first nav about 130 ms down from 168 etc. | Cold portal load still about 4.0 s. Measured on desktop with a quiet machine only. |
| Dashboards for each profile with graphs | 15 | Partial | Role dashboards (teacher, parent, student, staff) | Matrix status "Partial"; some roles (nurse, warden, librarian) have fewer charts. |
| OpenUI library install for generative UI | 15 | Deliberately not built | `modules/genui`, `components/genui`, own OpenUI Lang subset parser plus zod 4 | Library `@openuidev/*` not installed because of default-on install telemetry, unpinned remote dev CDN code, React 19 peer and version churn. Owner did not ask for that substitute; needs owner confirmation. |
| Install needed skills as required | 15 | Partial | See process rows | None specific. |

### Newsletter / opportunities

| Requirement | Asked | Status | Evidence | What is missing |
|---|---|---|---|---|
| India-wide, state, international competitions, exams, research, in-domain | 17 | Done (curated) | `newsletter/catalogue.js`, `opportunities.service.js`, eligibility matching | Catalogue is curated and seeded; it is not auto-refreshed from the web. |
| Weekly and monthly interactive newsletter, mailed to parents and teachers | 17 | Done | `editions.service.js`, `emailHtml.js`, job `newsletter.daily`, unsubscribe page | Email is SIMULATED until an email provider is set. |
| Flashcards, hooks, quiz, poll, map | 17 | Done | `FlashcardDeck`, `HOOKS`, `newsletter-views.tsx` | Hooks are from templates, not AI written. |
| Use Google Alerts feeds, AI to scrape and polish, auto-generate with AI | 17 | Not built | No Google Alerts, AI or feed ingestion code found in `modules/newsletter`; `digest` module is separate and says it is not connected to any alerts service | Session log `p5-newsletter-ai.md` shows another engineer started (one line, no code in the working tree at check time). Treat as in progress and unverified. |
| Install and use skills to generate interactive newsletters | 17 | Not built | None found | Same as above. |

## 2. Counts by status (table above)

Tallied at the end of this file under "Counts".

## 3. Still pending, prioritised

| P | Item | Reason | Effort |
|---|---|---|---|
| P1 | Newsletter: Google Alerts RSS sources, AI extraction of items, AI-polished edition text and hooks (owner's latest request) | Explicitly requested 10-17; not in the tree; another session may be doing it | M |
| P1 | Push the latest branch and confirm the working tree is committed | Owner asked 10-17 "if not pushed, push in a new branch" | S |
| P1 | Final full-suite and build run on the current HEAD (backend, frontend tests, typecheck, lint, build) and record the numbers | Last recorded full-suite figures are from the fourth round (4,068 tests; 2 failed in full run, pass alone). Later parts only report per-suite results | S |
| P1 | Browser-verify the part 3 and part 4 pages as every role (campus for parent, teacher, student; newsletter; health; support plans; leadership pages) | Leadership audit says the final browser re-check could not be done (machine out of memory); campus parent/teacher/student walk not done | M |
| P2 | Assistant coverage of the remaining "Gap" actions in `MCP-AUTOMATION-GAPS.md` | Owner wants complete automation by query | L |
| P2 | Real provider activation tests: email, WhatsApp templates, Meta/Google/LinkedIn/X OAuth, ad sync, social posting | Built from recorded API shapes only, never run live | M (needs credentials) |
| P2 | Remaining mobile findings (SVG chart text, chart bars, scroll tables) and a re-sweep including part 4/5 pages | Owner reported mobile as broken; sweep not closed out | M |
| P2 | Dashboards with graphs for remaining roles (nurse, warden, librarian, HR detail) | Owner wants role dashboards "where needed"; matrix marks Partial | M |
| P2 | Real-time push (SSE) for the campus map instead of polling | Owner asked for realtime; currently 15 to 30 s | M |
| P2 | Camera and GPS/RFID adapters against a real vendor | Currently simulated | L (needs hardware) |
| P3 | Budget actuals from bills and payroll; bank-statement import; TDS on vendor payments | Finance audit remaining | L |
| P3 | HR appraisal cycle, employee master and hire flow | HR audit remaining | L |
| P3 | Consent ledger for children's data, retention and erasure workflow (DPDP) | Compliance audit remaining; rules commence in phases | M |
| P3 | Library stock verification, purchase suggestions to procurement | Librarian audit remaining | M |
| P3 | Parent full UI translation | Needs native-speaker string catalogue | L |
| P3 | Alumni self-claim verification, donations (80G) | Student/alumnus audit remaining | M |
| P3 | College academics (credits grading, semester promotion, outcome mapping) | Ledger "Not done" | L |
| P3 | Meeting-service integrations (Meet, Zoom, Teams APIs) | Ledger "Not done" | M |
| P3 | Poster and creative generation inside the system | Ledger "Not done" | M |
| P3 | Warden: room inspection checklist, mess billing, hostel visitor access | Warden audit remaining | S to M |
| P3 | Nurse: immunisation schedule check, cluster alert message | Nurse audit remaining | M |
| P3 | Public QR certificate verification | Needs field decision | S |
| P3 | Entrance test scheduling and results; drip WhatsApp templates; RTE import | Marketing audit remaining | M |

## 4. Needs the owner's decision or credentials

- AI model key (Anthropic or other): needed for real AI drafts, quarterly report narrative, newsletter AI extraction and polish, free-form assistant understanding.
- Email provider: set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (or choose another) for newsletters, quarterly reports and notifications.
- WhatsApp: approved Meta templates (`WA_TEMPLATE_*`), phone number id and token; parent opt-in policy.
- SMS provider: not chosen.
- Ad and social app credentials and a connected account per network: Meta, Google (Ads, GA4, YouTube), LinkedIn, X. Also decide which networks matter.
- OpenUI: confirm that the in-house OpenUI Lang renderer is acceptable, or accept the install telemetry and dev-mode remote code of `@openuidev/*`.
- E-signature or OTP provider for circular resolutions and signed documents.
- Warden permission `visitors.manage` for hostel visiting day.
- Whether HR gets `users.manage` for a single hire flow.
- Budget-line mapping (bill categories and payroll to budget lines); bank statement sample; TDS rule table from the school's adviser; the school's rubric and approval chain for appraisals; immunisation schedule (UIP or IAP).
- Camera vendor, GPS devices, RFID/QR readers, and a model evaluation plan before any bullying detection goes live.
- Public certificate verification: which fields may be shown.
- Google Alerts: which topics and which Google account will own the alerts that produce the RSS feeds (Google Alerts has no API; feeds are created by hand).
- Real Jitsi server (`JITSI_BASE_URL`) for private rooms.
- Single-approver mode default for small schools (built, off by default).

## 5. Quality gaps

- Test suite status on the current HEAD is not recorded after part 3 or 4. Earlier records: 4,068 backend tests with 2 failures plus a database crash in the full run (pass alone); frontend 555 of 556 (the `expandable-result` 2,500-item test times out under load, passes alone). Treat as known flaky under load.
- `BUG-04` (creatable roles list) failed when the NURSE role was added; the test file now lists NURSE, so likely fixed (unverified).
- MCP architecture tests with pinned tool counts were reported failing because of other engineers' new tools; later reconciliation not recorded.
- Browser coverage: the 13-profile smoke test (182 page loads) predates parts 2 to 4. "Pressing every button" and a screen-reader test are marked Not done. The final leadership browser recheck did not happen (out-of-memory). Campus parent, teacher, student browser walk not done.
- Machine limits: the C: drive filled up (41 MB free, 44 leftover mongo temp directories) and in-memory MongoDB crashed during several agents' runs. Cleanup of `D:/tmp-openui` left to the owner.
- Integrations are built from recorded API shapes and have never run against live providers (ad sync, social posting, OAuth, email, WhatsApp, GPS, RFID, camera).
- Notice watching has not been run against live government or board sites.
- Frame rate of the 3D campus on low-end phones not measured; cold portal load about 4 s.
- Dependency audit: backend 4 findings, frontend 10 findings, all pre-existing (as of the fourth round); one pre-existing lint error in `tests/studyHelp.skillSync.test.js`.
- Seed: a full seed takes about 190 s; `demo.completeness` runs about 5 minutes. Newer part 4/5 sections in the seed are unverified for completeness.
- Mobile: residual findings listed in the perf log (SVG chart text, chart bars, tables scrolling) and not re-swept after part 4 pages.
- Profile-audit leftovers: demo timetable double-bookings (P-3) fix belongs to the seed; Principal Home vs Today duplication (X-1); results moderation and report-card release dashboard.
- Documentation drift: `REQUIREMENTS-LEDGER.md` and `INTEGRATION-STATUS.md` still say "last updated 2026-10-13" and describe the assistant as having sixteen read-only tools, which is out of date. The coverage matrix is current but its status wording mixes "built" and "verified".
- The OPUS prompt asked for migration rollback notes, a metric catalogue document and a source register update for the new topics (SHVR, GSP, DPDP); whether all of these exist as docs is unverified (a catalogue exists in code, `docs/research/regulatory-source-register.md` exists).

## Counts

Rows in section 1 by status ("Done (curated)" is counted as Done):

- Done: 68
- Partial: 13
- Simulated: 12
- Deliberately not built: 1
- Not built: 2

Total rows: 96.
