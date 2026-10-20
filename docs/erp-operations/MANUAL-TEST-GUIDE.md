# EduOS: manual test guide (everything added on top of `main` b4a4847)

Date: 2026-10-18. Covers the 31 commits from `3b72f1b` to `6314925`.
Each section lists what was added or changed, then how to test it: steps, and what you should see.

## 0. Setup

1. `cd backend && npm run demo -- --build` (first run, or after frontend changes); `npm run demo` reuses the last build.
   It starts an in-memory database, loads fictional sample data for every section (about 3 minutes),
   the API on port 5000 and the website on port 3000. Data is wiped when you stop it.
2. Open **http://localhost:3000/oakridge** (the school's own sign-in page; `/login` is the platform page for super admins).
3. Sign-ins (all fictional):

| Profile | Sign-in |
|---|---|
| Principal, Admin, Teacher, Finance, Librarian, Warden, HR, Marketing, Compliance, Trustee, Nurse | `<role>@schoolerp.com` / `ChangeMe@123!` (e.g. `teacher@schoolerp.com`) |
| Parent (two children, both named Diya) | `+910000004001`, one-time code shown on screen in the demo |
| Student | `+910000003001` |
| Alumnus | `+910000000033` |

4. Not live in the demo, labelled "Simulated" where they appear: email, WhatsApp sending, SMS, ad and social
   accounts, GPS, ID-card readers, cameras, speech-to-text for WhatsApp voice notes, and the AI model
   (AI_PROVIDER=rules). Everything else works for real against the demo data.
5. Ask AI is the chat button on every page; the WhatsApp agent can be tried from the in-app WhatsApp simulator
   (admin portal) where available.

---

## 1. Foundations: roles, permissions, approvals, messaging

**Added:** role-based permissions (OWN vs ALL scope) for 14 roles including the new **Nurse**, school-by-school data
isolation, an approvals engine (requests route to the right approver), a messaging outbox (in-app, email, WhatsApp,
SMS with consent and quiet hours), per-school **feature switches**, and a crash-safe job scheduler.

Test:
- Sign in as each role: the sidebar shows only that role's pages; opening another role's URL is refused.
- Admin → Settings → **Features**: switch a module off (e.g. Clubs); its pages say "switched off" and Ask AI refuses it. Switch it back on.
- Admin → Settings → **Single-approver mode**: off by default; turning on needs a reason and is logged.
- Raise a request as a teacher (e.g. purchase request): it appears in the principal's/finance **Approvals** inbox.

## 2. Attendance

**Added:** flashcard marking mode (swipe through students), drafts saved on the server, phone-friendly roster
(one line per pupil, 40px buttons), substitute teachers can mark only the period they cover, offline queue.

Test (teacher):
- Attendance → choose class → flashcard mode: swipe present/absent; leave and come back, the draft is kept; submit.
- Turn off the network (browser dev tools → offline), mark attendance: an "offline, n changes waiting" banner shows; back online, it syncs once.
- Principal → **Attendance overview**: every class over a period, registers not taken today with class teacher named, students below 75%.

## 3. Administration, compliance, safeguarding, governance

**Added:** administration department, compliance register (licences, certificates, returns, notices), safeguarding
cases (restricted), background verification, governance (board meetings, minutes, actions, conflict-of-interest),
**board pack** per meeting (frozen versions, PDF), certificates generated from the record (no-dues check, CBSE TC
layout, serial numbers and verification codes), data protection (DPDP request and breach registers), statutory committees.

Test:
- Compliance: Licences list with expiry; a licence near expiry shows in Tasks with reminders.
- Principal → Governance → a meeting → **Board pack**: preview, freeze, download PDF; trustee sees the same version.
- Admin → Document requests → approve a transfer certificate → **Generate from records**: refused if dues are open unless you give a reason; PDF has serial TC/2026/xxxx and a verification code; check the code in the Certificate register.
- Compliance → **Data protection**: log a request; it can't be completed until identity is verified.

## 4. Finance, payroll, procurement, budgets

**Added:** payroll with versioned statutory rules (PF/ESI), procurement, budgets, assets and funding, bills and
service lifecycle (AMC visits, renewals list, leakage review queue), fee concessions/credit notes/voids via approvals,
per-school invoice series INV/<FY>/000001, Tally voucher export and GST summary, **Finance reports** (collections by
day/mode/cashier/fee head/class, day book, overdue ageing, audit flags), day-end **cash close** (second-person check).

Test (finance):
- Finance reports: switch tabs; download day book and ageing CSV.
- Cash close: enter notes and coins; a difference needs a note; a different person verifies.
- Bills: record a bill payment; it stays "recorded" until another person confirms it.
- Concessions: request one; it goes to approvals.
- Accounts export: Tally XML/CSV and GST summary download.

## 5. Marketing, admissions, newsroom

**Added:** admissions CRM and funnel, **online admission form** (public: `/public/admission/oakridge`), admission
follow-up queue with warmth score, offline campaigns (banners, pamphlets, posters, radio…) with QR codes, short links,
promo codes and tracking numbers, attribution and ROI, ad connectors (CSV import; live OAuth for Meta/Google/LinkedIn/X
when credentials exist), newsroom with **social posting** (staff only, simulated until accounts are connected),
circles/community.

Test:
- Open `/public/admission/oakridge`, submit an application: you get a reference number; it appears in Marketing → Online applications.
- Marketing → Campaigns → Offline: create one; open Tracking → QR; a second person approves.
- Marketing → **Follow-ups**: overdue/due today queue; log a follow-up.
- Newsroom (principal): compose a story → "Also post to social media" → pick networks → status shows "Simulated". As a parent, the option is absent.

## 6. Campus World (3D map)

**Added:** 3D campus for every profile; live classrooms and departments; layers for labs, buses, cover, tasks, gate
counts, clubs, greenery; **time slider** that changes the scene (arrival, assembly, lessons, lunch, games, buses, clubs,
empty after hours); status banner ("Period 3 of 8, 12 min left", "Holiday: …", "School closed: opens 7:45 am"); no
movement on holidays/Sundays/after hours; **shifts** with their own bell schedules; "Live now" panel for a room;
one dynamic **live details** page (`/<portal>/live`); collapsible panels; parent/student view centred on their class;
teacher qualifications shown to families only with the teacher's consent.

Test:
- Principal → Campus: drag the time slider from 08:00 to 20:00; the scene and banner change. Pick a holiday date (21 Oct in the sample data): no movement, holiday banner.
- Click a classroom in session: "Live now" (teacher, subject, countdown, present/strength); **See details** opens the live page.
- Collapse panels; "Collapse all"; reload: the choice is remembered.
- Parent: the map flies to the child's classroom; shows teacher and counts only, no other children's names.
- Principal → **Shifts & Bells**: two shifts; assigning a class to an overlapping room/time is refused.
- Teacher → Professional profile: add a degree and tick "show to families"; the parent sees it in "who is teaching now".

## 7. Teaching and learning

**Added:** digital lectures/online classes, syllabus tracker, **lesson plans** (suggested from the syllabus; marking
taught ticks topics), **question bank** and blueprint papers (competency share, chapter spread, print with/without
answers), quizzes, **CPD hours** against CBSE's 50, class result analysis (average, highest/lowest, A1–E spread, remedial
group), CBSE **term report cards**, competency portfolios, student support plans, substitute **cover**, staff leave balances.

Test (teacher):
- Lesson plans → "Suggest from my syllabus" → save → mark taught: syllabus topics ticked.
- Question bank → build a paper from a blueprint → check: shows competency %; print.
- Exams → a paper → Class result panel.
- CPD hours → log 3 hours; HR or principal verifies (you can't verify your own).
- Staff leave → apply; balance shown; principal approves; cover suggestions appear.

## 8. Labs, transport, hostel, library, health, safety

**Added:** science/computer labs (stock ledger that can't go negative, expiry, hazards, practicals), fleet and trips
(seat limits, safe handover to authorised adults, live bus status, parent sees only own child's bus), ID checkpoints,
visitors and pickup delegations (OTP), hostel **out-pass**, hostel life (night roll call with alerts, mess menu,
incidents), library desk (renewals, holds, fines, reading challenges, barcode labels and scan desk, parents can request
books for their children), **health room** (nurse: visits, medication with parent consent, dose record, stock expiry,
immunisations, screenings, Health Watch for clusters; principal sees counts only; teachers see consented care notes).

Test:
- Teacher → Labs: issue 2 beakers to a practical; try issuing an expired batch: refused.
- Parent → Bus today: only own child's trip.
- Warden → Hostel life → Roll call: submitting with residents unmarked asks for confirmation first.
- Librarian → Library desk: renew a loan (max 2), send overdue reminders, create a reading challenge; Labels & scan: scan-to-issue by accession number.
- Nurse (`nurse@schoolerp.com`) → record a visit; Health watch shows a fever cluster from the sample data. Principal → Health summary: counts only.

## 9. PTM, conversations, clubs, showcase, alumni, sustainability

**Added:** PTM rounds and slot booking (one family per slot, no clashes across children), review calls, parent–teacher
message threads, clubs/teams/houses with consent and fixtures (a second teacher approves results), top-ranker
**showcase** (consented, top 3 by default), alumni community (batches, opt-in directory, certificate requests,
opportunities board), daily digest, greenery/waste/sanitation with SHVR/CSE/Mission LiFE evidence packs and verified eco points.

Test:
- Parent → PTM: book a slot for each child; booking two overlapping slots is refused.
- Teacher → Conversations: reply to a parent thread.
- Student → Clubs: join; parent gets a consent request.
- Alumnus → Certificates: request a character certificate; Give back: offer a career talk (coordinator reviews it).
- Compliance → Sustainability → verify an eco activity (you can't verify your own).

## 10. Opportunities newsletter (weekly / monthly)

**Added:** curated catalogue of real recurring competitions, olympiads, scholarships, exams and programmes (no invented
dates; "check dates on the official site"), matching with reasons ("Because Diya is in Class 5…"), "Can I enter?",
save/remind/add to calendar/ask a teacher; weekly and monthly editions with an admit-card **hook**, **flashcards** with
spaced repetition and streaks, a 3-question quiz, polls, class/house board (opt-in, group averages only), moderated
comments, Hindi/English; email to opted-in parents and teachers (simulated). **Google Alerts via its RSS feeds**
(guided setup), AI extraction into the editor's review queue (official sites only), AI-written editions with fallback,
60-second cards, deadline radar, "challenge a friend" (classmates only).

Test:
- Student → Opportunities: open the weekly edition; flip flashcards; take the quiz once; vote in the poll.
- Parent → Opportunities: "For you" shows matches for each child with reasons.
- Principal → Newsletter desk: Review queue (approve with/without confirmed dates), Editions (draft → preview → publish), **Google Alerts** tab (follow the guide; the sample feed is fictional and not fetched), Analytics.

## 11. Dashboards, analytics, search, generated panels

**Added:** interactive dashboards per role (teacher, parent per child, student, finance, HR, librarian, warden, nurse,
marketing, compliance, trustee), analytics workspace with any date range and comparisons (previous period, last year,
custom), department tiles, saved views (server), quarterly reports (PDF), **universal search** (Ctrl/Cmd+K) scoped to
your access, "Ask your dashboard" panels, scenario planning, My Tasks with reminders and escalation.

Test:
- Principal → Analytics: choose Academic year, compare with last year; open a metric's focus view; save a view; reload.
- Press Ctrl+K and search "fees" (pages) or a student's name; as a parent you only find your own children.
- Analytics → "Ask your dashboard": "compare fee collection this year with last year by month"; pin it.

## 12. Ask AI and the WhatsApp agent

**Added (summary):** 1,108 actions across all modules; every school action is either an Ask AI tool or on a stated
screen-only list (sign-in and credentials, payroll, safeguarding, camera, payment checkout, file downloads, a few
decisions on money and published marks). Every change is shown as a draft and runs only when you confirm; high-risk,
money and other-people changes are confirmed on the website (WhatsApp hands them over). Approvals can be recorded only by
the approver. Conversation memory on the server (24 h), multi-part questions, an explained performance score,
verification of every figure, bulk import by attaching a sheet, eight Indian languages, tolerant spelling, voice input,
personal reminders, school automations.

Test each line in Ask AI (website), then the same on WhatsApp where noted:

| # | As | Type | Expect |
|---|---|---|---|
| 1 | Teacher | "show 6A attendance today" → "and 5A?" → "who was absent?" → "message their parents" | each follow-up keeps the class; last one drafts messages for the absentees (confirm needed) |
| 2 | Teacher | "no, I meant yesterday" after a read | same question for yesterday |
| 3 | Teacher | reload the page or change pages mid-chat | the conversation is still there; "+" starts a new chat |
| 4 | Parent | "Diya Sharma score, performance, assignments and who is the class teacher" | four sections; performance shows components, weights, data coverage and "How it's calculated"; assignments only hers |
| 5 | Parent | "show my child performance and who is the class teacher" | asks once "Which child — Diya Sharma or Diya Singh?"; answer "Diya Singh" → both parts for her |
| 6 | Parent | "show homework" | one section per child, each with that child's own list |
| 7 | Student | "what is my rank in class?" | says class ranks aren't shown; offers own marks and trend |
| 8 | Teacher | "students with low attendance in my classes" | list across all the teacher's classes |
| 9 | Principal | "who scored the highest?" after "show 6A marks" | names the top scorer(s) |
| 10 | HR | "how many staff" | staff only (not parents/students) |
| 11 | Teacher | "kal ki attendance dikhao" / "aaj 6A mein kaun absent hai?" | Hinglish understood |
| 12 | Parent | a request in Hindi/Marathi/Tamil, e.g. "मेरे बच्चे की फीस" | understood; reply heading in that language; "Read as: …" line |
| 13 | Any | misspell: "atendance of 6-a tmrw", "rahul sarma fees" | corrected, or "Did you mean …?" when unsure |
| 14 | Any | microphone button (Chrome) | speech goes into the box; reply starts "I heard: …"; Listen reads it aloud |
| 15 | Admin | attach a CSV of students with the paperclip: "add these students" | preview "N ready, M with problems"; confirm imports; with errors: import valid rows or download error report and sample template |
| 16 | Any | "what can I import?" / "template for library books" | list of formats / downloadable sample |
| 17 | Teacher | "remind me every Friday to submit lesson plans" → "show my reminders" → "stop the Friday reminder" | created after confirm, listed, stopped |
| 18 | Any | "what needs me today?" | today's items for your role; suggested next-step chips under answers |
| 19 | Principal | "approve the pending certificate request" | drafted; confirm only on the website |
| 20 | Parent (WhatsApp) | "Hi" | family summary in the chosen language; "YES" after a low-risk draft completes it; a high-risk draft gives a website link |
| 21 | Any | ask for data that doesn't exist, e.g. "school pass percentage" | says EduOS doesn't keep it; never invents a number |

Also: Admin → **Automations** page: 11 automations (register nudge, homework due, fee reminders, library overdue,
daily briefing, cover suggestions, low health stock, admissions follow-ups, health follow-ups, weekly parent digest,
birthdays) with on/off, time, audience and preview; "Run now" for a manager.

## 13. Mobile, speed, accessibility

**Added:** all pages checked at 360, 390, 768 and 1280 widths; dialogs fit the screen; 40px touch targets; 12px minimum
text on phones; tables become cards on phones for the new pages; page switching 22–37% faster with half the API calls;
self-hosted fonts.

Test: open the site on a phone (or Chrome device mode, 390 px): no sideways scrolling; dialogs scroll inside; menu works.

## 14. Security and correctness fixes worth re-checking

- Query operators stripped from inputs; invoices scoped to own enrolments.
- "Today" uses the school's local date (no more yesterday between midnight and 05:30).
- Growth scores at OWN scope limited to own pupils/children.
- Timetable no longer double-books teachers.
- A per-child answer never includes a sibling's records (withheld with a reason).
- Assistant text that cites a figure not in the records is replaced by the plain answer.

## 15. Known limits

- Simulated until configured: email, WhatsApp sending, SMS, ad/social accounts, GPS, card readers, cameras, speech-to-text, AI model.
- Language word lists need review by native speakers.
- Not built yet: health-room records in some exports, report-card readiness checklist, exam seating/invigilation drafts, bus delay alerts to families, staff birthdays (no staff date of birth), next-step chips on WhatsApp, bank statement matching, TDS on vendor payments, appraisals, Form 16.
- Reference documents: `ASSISTANT-COVERAGE-MAP.md`, `AUTOMATION-AUDIT.md`, `PENDING-REQUIREMENTS-2026-10-17.md`, `PLATFORM-COVERAGE-MATRIX.md`, `profile-audits/*.md`, `INTEGRATIONS-SETUP.md`.
