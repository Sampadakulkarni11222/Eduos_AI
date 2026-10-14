# Requirements ledger — institution operations

Branch `feat/education-erp-operations`. Last updated 2026-10-13.

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
| 9 | Teacher and student performance | Existing risk and workload pages kept; summarised on the Command Centre. | Existing | Built | No new performance model was added. |
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
| 22 | 3D game-like campus map for every profile, limited by access, with drill-down | Campus World: 3D buildings and rooms, click for detail, buttons to related pages, list view as the accessible alternative. Filtering is done on the server. | Tested | Built | Uses a sample layout until a school enters its own. Activity shown is scheduled, not live tracking. Frame rate not yet measured on a low-end phone. |
| 23 | Safeguarding | Anyone can raise a concern; only the safeguarding team can read cases; details encrypted. | Tested | Built | The system records reports to authorities; it does not make them. |
| 24 | Messaging with honest status | Outbox with consent, quiet hours, idempotency and true delivery status. | Tested | Built | **Simulated** without a provider. |
| 25 | Research all roles; final audit; competitors; AI opportunities | `REFERENCE-ANALYSIS.md`, `docs/research/regulatory-source-register.md`, `COMPETITOR-GAP-ANALYSIS.md`, `AUDIT.md`. | — | — | AI opportunities are listed, **not implemented** (see below). |
| 26 | Install a skill to read the videos | Frames were extracted locally with FFmpeg and read. | — | — | The MCPmarket installer link was invalid or expired and was not run. |

## Added in the second round

| # | Item | Status |
|---|---|---|
| 27 | Campus World visible to every profile from day one: sample campus created automatically, daylight view, top-bar button and home-page card on every portal, room buttons, links from a room to related pages | Tested (API) and checked in a browser as every profile |
| 28 | Scheduler for reminders, held messages, expiry checks and notice watching | Tested |
| 29 | Read-only assistant tools for the new modules; assistant turned on for the five new roles | Tested |
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

## Not done

- **Pressing every button on every screen.** The browser test proves pages load; forms were not all exercised by hand.
- **AI that drafts or summarises** (reply drafts, notice summaries, minutes). The assistant's tools only read and report.
- **Direct filing with boards or government**: no public API exists (see docs/research/board-submission-channels.md).
- **Meeting-service integration**: EduOS does not create meetings inside Google Meet, Zoom or Teams, or read their attendance; the host pastes the link.
- **College academics beyond credits and accreditation evidence**: credit-based grading, semester promotion, outcome mapping.
- **Anything that needs an outside party**: filing on government portals, bank uploads, WhatsApp template approval, an accountant's sign-off.
