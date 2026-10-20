# Profile audit: Parent / guardian

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/parent`, demo login by phone
`+910000004001` (OTP; the demo shows the code). I looked at it from four angles: the working parent with a minute on a
phone in the morning, the parent with children in two classes, the parent with limited English, and the parent on a
cheap phone with a weak connection who uses WhatsApp far more than any app. Companion audit for students and alumni:
see the student/alumnus audit.

## 1. The role in an Indian school

Parents are not staff, but the school runs on what they do: pay the fees, sign the consents, send the child on time,
read the circular, turn up at the PTM, and answer the class teacher. In CBSE/ICSE/state-board private schools the
contact is the class teacher (first line), the office or accounts (fees, certificates, transport), and the principal
(escalation). International schools add a homeroom tutor and an online parent portal, but the duties are the same.

| When | What the parent does |
|---|---|
| Every school day | Checks the child reached school (absence or late SMS/WhatsApp); homework and diary; bus timing and pickup; reads notices; replies to the teacher. |
| Weekly | Homework plan and test schedule; library book due; club or practice sessions; canteen/transport top-ups in some schools. |
| Monthly / term | Fee instalment (quarterly or term-wise, with late fee); PTM (one per term, booked slot); unit test and term results; consent slips for trips, events and media; leave applications for planned absence. |
| Yearly | Admission/re-registration; book and uniform lists; annual fee and transport fee; report card; certificates (bonafide for a passport or visa, TC on leaving, fee certificate); **tuition-fee statement for Section 80C** of the Income-tax Act (tuition fees for up to two children, paid in the April–March financial year; the employer asks for proof by January–March); updating contact and medical details; APAAR/ID details for board classes. |

**Reports and documents they need from the school:** fee receipts, the 80C tuition-fee certificate, report cards,
bonafide/TC/character certificates, attendance shortfall letters, and medical/consent records.

**Pain points (practitioner sources, parent forums, vendor pages):**
- Too many channels: class WhatsApp groups, SMS, a portal, paper diary. Nothing says "this needs you".
- Several children = several logins or a child switcher on every page; the app answers one child at a time.
- English-only portals; circulars full of jargon; most families use Hindi or a regional language at home.
- Low-end Android phones and patchy data: heavy dashboards, big images, many requests; WhatsApp works, apps do not.
- Fee receipts and tax certificates have to be requested from the office every year.
- No idea whether a consent or a PTM slot is still open until the teacher chases.

Sources: Edunext parent-app guides published by schools (leave, receipts, live bus, progress reports), MyClassBoard
release notes (leave intimation), Entab CampusCare product pages (circulars, fees, sibling single login), Teachmint
listing (attendance, fees, notices, reminders), ClassDojo family-engagement pages (automatic translation into 130+
languages), WhatsApp-for-education vendor guides (exception alerts and weekly digests rather than daily "attended"
messages), Income-tax Act s.80C (tuition fees, two children).

## 2. Competitors

| Capability | Entab CampusCare | Edunext / MyClassBoard | Teachmint | ClassDojo / Brightwheel | PowerSchool / Veracross | EduOS before | EduOS now |
|---|---|---|---|---|---|---|---|
| Attendance, homework, timetable, results per child | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ |
| Absence/late alert to parents | ✓ SMS/app | ✓ | ✓ | ✓ | ✓ | ✓ (attendance-alerts) | ✓ |
| One view of all children and "what needs me" | sibling login only | sibling switch | — | per class | partial | — (one child at a time) | ✓ family desk |
| Online fee payment, receipts | ✓ | ✓ | ✓ | Brightwheel ✓ | ✓ | pay ✓, receipts not on parent screen | ✓ receipts + invoice PDFs |
| Tuition-fee statement for 80C | office certificate | school-specific | — | n/a | n/a | — | ✓ statement (signed certificate via Certificates) |
| PTM slot booking | partial | partial | — | conferences (Dojo) | ✓ | ✓ | ✓ |
| Parent–teacher messaging | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notices in the parent's language | — | — | — | ✓ automatic | partial | — | ✓ AI translation, labelled |
| Choose language for messages | — | — | — | ✓ | ✓ | backend only (no screen) | ✓ dashboard + contact settings |
| Leave for the child, certificates, consents, out-pass, pickup delegates | partial | ✓ leave | partial | — | ✓ | ✓ | ✓ |
| WhatsApp assistant that can act (with confirmation) | — | — | — | — | — | ✓ | ✓ + family summary, language preference |

## 3. Hands-on test (own instance, desktop 1440 px and phone 390 px)

All 40 parent pages were opened at both widths (`scratchpad/p4-parent/sweep.mjs`, screenshots `scratchpad/p4-parent/`).
No page had horizontal scroll. Findings:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **Student View was a 403** for every parent: `/growth/score` required `ai.insights.read`, which parents do not hold; the page then said "your school has not turned on the growth score", which was untrue. The request also had no `period`. | Bug | **Fixed**: parents with `analytics.child.read` read their own child's score (enrolment checked against their linked children); period defaults to the current month (IST). |
| 2 | Dashboard (phone): the first two screens are the generic campus board ("You have 1 online class today", isometric campus, "Online classes and meetings you host or are invited to"); the child appears 3+ screens down. | UX | **Fixed**: "Today for your family" card first; pulse wording for parents ("1 online class for your child today", "Online classes for your children's classes"). |
| 3 | Sidebar: 21 shared school pages (Newsroom, Clubs, Campus World…) came before MY CHILD and Payments. | UX | **Fixed**: the parent's own groups first, shared pages before Help. |
| 4 | Payments: no receipts, no invoice PDF, no tax statement on the parent's screen (the backend had all three). | Gap | **Fixed**: Invoice PDF on every invoice, a Receipts table with receipt PDFs, and the 80C statement. |
| 5 | Language: the language preference existed in the backend (WhatsApp template language) but no screen let anyone set it; the assistant greeted a Hindi-preferring parent in English when they wrote "Hi". | Gap | **Fixed**: language picker on the family card and in "How we contact you"; WhatsApp falls back to the chosen language when a message does not reveal one; preference values validated. |
| 6 | Two-children parent on WhatsApp: the "Hi" briefing used per-child reads that answer "Which child?" when there are two, so they were silently dropped. | Bug | **Fixed**: a parent's briefing is the family summary (all children). |
| 7 | React duplicate-key warnings on the dashboard and Calendar (events merged from exams/PTM share ids); past events not dimmed. | Bug | **Fixed**. |
| 8 | Demo data: every seeded parent had exactly one child. | Data | **Fixed**: the demo parent gets a second child in another grade (idempotent seed section). |
| 9 | UI chrome (menus, headings) is English only. | Gap | **Remains** (see §5). |
| 10 | Parents still cannot request transport or library books (no `transport.request` / `library.request` for PARENT). | Gap | **Remains**: a permission decision for the lead (students hold both). |

Items from the part-1 audit that I re-checked and found already fixed: library 403 (PARENT now has `library.read`),
leave for the child (`leave.apply` OWN), absence alerts (attendance-alerts), Student View error state, timetable class
picker only with children in two classes, dashboard grade labels from the grading scale.

## 4. What I built

**Family desk** (`backend/src/modules/family/`, routes under `/api/v1/family`, PARENT only, own linked children only):
- `GET /family/today`: per child today's register mark, attendance %, homework due in the next 3 days (not handed in),
  fees outstanding, next exam, class teacher; and "waiting for you": fees past due, absent/late today, club consent,
  hostel out-pass, pickup delegate unconfirmed, health-room consent (count only, never what it is about), PTM round
  open with nothing booked, unread teacher messages. Each item links into the parent portal; urgent first.
- `GET /family/fee-statement?fy=2025-26&studentId=`: payments in the Indian financial year (IST), per child, split into
  tuition and other charges in proportion to each invoice's lines (fee head category TUITION or "tuition" in the line);
  an invoice without lines is shown but not counted as tuition. States that the signed certificate is the office's
  fee certificate.
- `POST /family/translate-announcement`: an announcement the reader may see (same audience filter as the list) in one
  of 11 Indian languages via the configured AI provider; contact and ID numbers are redacted before the model; the
  English notice stays the official text; without a provider it says so (never a fake translation).
- `GET /family/languages`: languages with their names in their own script ("हिन्दी (Hindi)").

**Frontend:** `components/family/family-today.tsx` (top of the parent dashboard), `fee-tax-statement.tsx` (Payments,
printable), `notice-translate.tsx` ("Read in my language" under each notice on the parent's Announcements),
`lib/family-api.ts`; Payments gains invoice PDFs and receipts; "How we contact you" gains a language picker; CSS in
`app/operations.css` (Part 4 parent section), phone-first.

**Fixes:** `growth.routes.js`/`growth.controller.js`, `insights/pulse.service.js` (parent wording), `lib/portals.ts`
(parent nav order), `components/calendar-view.tsx` and the dashboard (keys, past events), `messaging.service.js`
(language validated), `whatsapp.agent.js` (reply language from preference), `whatsapp.briefing.js` (family summary for
parents), `seed_operations.js` (second child for the demo parent).

## 5. What remains, and why

- **Full UI translation** (menus, page text) needs a string catalogue across ~40 parent pages and native-speaker review;
  the product's language note already says machine-translating the catalogue is not acceptable. What exists now: the
  assistant answers in the parent's language (Hindi catalogue + model), notices can be read in 11 languages, and
  WhatsApp templates follow the chosen language.
- **Transport and library requests by parents:** needs `transport.request`/`library.request` for PARENT, a permission
  change for the lead to approve.
- **Offline/low-data mode:** the dashboard still loads the campus board and charts; a "lite" parent home (family card
  only) would help weak connections. The family card itself is one request.
- **Health consent through the assistant:** deliberately not added; health consent stays on the Health page (the
  health tool file excludes consent by design).
- **Support plans and competency portfolio through the assistant** for parents: not added; they carry special-needs
  detail and should get the same review as health before going to chat.

## 6. Assistant coverage (Ask AI and WhatsApp)

New file `backend/src/modules/ai/mcp/tools/p4Parent.js` (one import + spread in `registry.js`), 5 tools:

| Tool | Kind | Who | Notes |
|---|---|---|---|
| `get_family_today` | read | PARENT | every child at once and what is waiting; the WhatsApp "Hi" briefing for parents |
| `get_fee_tax_statement` | read | PARENT (`fees.read`) | financial year, optional child |
| `translate_school_notice` | read | anyone with `announcements.read` | picks a notice by title words or the latest; language from the argument or the preference |
| `get_child_growth_view` | read | PARENT (`analytics.child.read`) | asks "which child?" when there are two |
| `set_my_message_preferences` | write, **confirmed** | anyone with the assistant | language, WhatsApp on/off, quiet hours |

The parent's tool count went from 97 to 102 (all roles: +5). Pinned counts in `mcp.catalog.test.js` were not edited.
Already covered before this audit and re-checked: attendance, fees (pay link, history, invoices), homework, timetable,
results and report cards, notices and calendar, library loans, leave for the child, medical record, tickets, PTM
(list/book/reschedule/cancel), conversations (read/send), clubs (join, consent), certificates (request/cancel), bus,
pickup delegates (request/confirm/revoke), out-passes (request/cancel/consent), digest, eco points, showcase.

Tests: `backend/tests/parent.familyDesk.test.js` (12: scope, refusals, the 80C split, translation honesty, HTTP growth
score for own/other child, tool confirmation, WhatsApp briefing language) and `frontend/tests/p4-parent-family.test.tsx`
(6: family card, language save, empty states, 80C table, notice translation, sidebar order). Also adjusted:
`tests/mcp.roleCoverage.test.js` (analytics.child.read is now covered for parents; recorded as scope-gated at ALL),
`tests/whatsapp.assistant.test.js` (a briefing tool may be MCP-native), `tests/demo.completeness.test.js` (the demo
parent has two children).

The fixes and new screens were checked by component tests, tsc and lint. A second browser sweep of the finished
screens was not run: the machine was short of memory and the lead limited each engineer to one server at a time.
