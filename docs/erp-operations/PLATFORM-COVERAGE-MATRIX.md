# School platform coverage matrix (implementation ledger)

Branch `feat/school-platform-complete`, started 2026-10-14 from `d359a48`.
Source requirements: `OPUS_5_5_SCHOOL_PLATFORM_PROMPT.txt`, `ADVANCED-FEATURE-RESEARCH-2026-10-14.md`
and the product owner's request of 2026-10-14. Each agent updates its rows as
work lands. Status words:
- **missing**: nothing was found;
- **partial**: some exists;
- **existing**: found and checked;
- **built**: built and tested in code;
- **verified**: also checked in a browser;
- **simulated**: works end to end with a test adapter, and needs a provider or hardware to go live;
- **planned**: not yet built.

| # | Requirement | Before | Status | Evidence / where | Owner | Acceptance test |
|---|---|---|---|---|---|---|
| F00a | Permission keys for every new domain, role grants (no new system roles) | missing | built | `constants/permissions.js` (176 keys) | Platform | role matrix regenerated; permission tests |
| F00b | Per-school feature switches that disable API and jobs | missing | built | `constants/features.js`, `utils/features.js`, `GET/PUT /institution/features`, scheduler `job.feature` | Platform | `tests/tasks.engine.test.js` (feature switch) |
| F00c | Crash-safe scheduler (lease takeover of an unfinished claim) | partial | built | `jobs/scheduler.js`, `JobRun.attempts` | Platform | `tests/scheduler.jobs.test.js` |
| F03 | Common tasks and reminders: owner/delegate, lead days, severity, recurrence, snooze with reason, evidence, escalation to department lead then principal, reassignment when an owner leaves, forecast cost | missing | built (API) | `models/dueItem.model.js`, `modules/tasks/`, job `tasks.reminders` | Operations admin | `tests/tasks.engine.test.js` |
| F01 | Period and comparison contract (school timezone, half-open ranges, AY/FY, previous / same elapsed last year / prior years / custom, zero-baseline rule, buckets) | missing | built | `utils/periods.js` | Admin/finance | `tests/periods.test.js` |
| F02 | Analytics workspace: principal overview, admin operations, department tabs, metric catalogue, drill-down, CSV/PDF export, data freshness | partial | planned | dashboards existed per role only | Principal | reconciliation tests per metric |
| F20 | Quarterly decision reports: versioned snapshots, recipients, durable delivery and retry | missing | planned | — | Principal/admin | crash/retry test |
| F04 | Bills and service lifecycle: recurring bills, AMC, utilities, software, partial payments, evidence, reminders, leakage review queue | partial | planned | procurement, compliance licences existed | Finance | — |
| F05 | Asset service and licence lifecycle into one due-item view | partial | planned | assets, licences, contracts existed | Facilities/compliance | — |
| F06 | Science and computer labs: stock ledger, expiry, hazard storage, SDS, issue/return, calibration, devices, software seats, practical sessions | missing | planned | LAB rooms only | Lab heads | expired stock blocked; no negative stock under concurrency |
| F07 | Vehicles, trips, capacity, documents, service, breakdowns, boarding, safe handover | partial | planned | routes/stops/enrolments existed | Transport | last seat race; unmatched boarding |
| F07b | GPS ingestion (authenticated devices, dedupe, stale status) and parent ETA for own child | missing | planned | — | Transport | parent sees only own child's trip |
| F07c | ID checkpoints (gate, bus, lab, library), lost-card revocation, guardian pickup authorisation | missing | planned | `pickupAuthorized` boolean only | Safety | duplicate scan, revoked card |
| F15 | Visitors, contractors, authorised pickup | missing | planned | — | Safety | — |
| F27 | Optional camera event review: device registry, purpose, adapter, unverified observations, human review, restricted evidence | missing | planned | — | Safety/IT | observation stays unverified; never on map/feed |
| F08 | PTM booking: rounds, teacher availability, slots, multiple children, atomic booking, reschedule/cancel, waitlist, check-in/no-show | partial | planned | PTM calendar event, PARENT_MEETING online class | Academic coordinator | two-children booking without clash |
| F08b | Parent review calls: reason, attempts, outcome, actions, owner, deadline, follow-up | missing | planned | — | Teachers | follow-up closed |
| F13 | Parent–teacher messages (threads per child) | missing | planned | — | Parent engagement | unrelated parent refused |
| F11 | Substitute cover and staff leave balances | missing | planned | student leave only | Timetable coordinator | no double booking |
| F10 | CBSE term report cards (scholastic + co-scholastic, remarks, attendance, publish/versions) | partial | planned | report card per exam existed | Academic head | — |
| F12 | Clubs, teams, houses, coaches, sessions, attendance, fixtures, results, equipment, consent | partial | planned | co-curricular requests existed | Activities | capacity/waitlist |
| F18 | Top-ranker and achievement showcase (approved results, tie rules, consent) | missing | planned | — | Communications | non-consenting child excluded |
| F18b | External social publishing (per-network outbox, consent recheck, no parents/students) | missing | simulated (planned) | — | Communications | parent request refused server-side |
| F17 | Alumni lifecycle, directory with consent, batches, reunions, former teachers | partial | planned | alumnus role, circles, mentoring existed | Alumni coordinator | graduate keeps community access only |
| F19 | Daily learning/trends digest from approved sources (RSS), opt-in by interest | missing | planned | — | Editorial | SSRF and injection safe |
| F16 | Sustainability: trees, waste, water, energy, sanitation, eco points, SHVR/GSP/Eco Club evidence packs | missing | planned | — | Eco Club/facilities | survival vs planted |
| F14 | Health visits and medication administration | partial | planned (later) | encrypted medical record existed | Health staff | — |
| F09 | Student support plans | partial | planned (later) | rule-based risk existed | Support team | — |
| F22a | Online admission form (public) | partial | planned | admissions CRM existed | Admissions | — |
| F22b | Library barcodes (accession numbers, scan issue/return) | missing | planned | — | Library | — |
| F22c | Hostel out-pass with parent approval and gate exit/return | missing | planned | — | Warden | — |
| F04b | Tally voucher export, GST summary, fee concessions with approval | missing | planned | — | Finance | — |
| F25 | AI drafts (letters, minutes, lesson plans, remarks) with template fallback without a model key | missing | planned | — | Department owners | draft only, never sent automatically |
| F26 | 3D campus: labs, sports, transport bay, gardens, waste stations, utilities, tasks, from canonical records | partial | planned | campus map existed | Admin | no restricted data on map |
| UI | Alignment issues (e.g. first bar wider in the admissions funnel) and a visual QA sweep | partial | planned | — | Frontend | screenshots at desktop and phone |
