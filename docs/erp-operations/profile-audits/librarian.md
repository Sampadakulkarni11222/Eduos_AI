# Profile audit: Librarian

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/librarian`, demo login
`librarian@schoolerp.com`. Considered: a single school librarian (the common case in CBSE/ICSE schools), a library
assistant at the desk, and the principal/admin who read the library's figures.

## 1. The role in an Indian school

**Answers to** the principal (often through the academic coordinator). Works with class teachers (library periods,
reading lists), the accounts office (book budget, fines), and the admin office (stock verification, write-offs).

| When | What |
|---|---|
| Daily | Open the desk; issue and return (barcode or register); shelve returns; chase overdue books; library periods for classes (story time for primary, reference skills for middle school); answer reference questions; process book requests. |
| Weekly | Overdue list to class teachers / families; display boards (new arrivals, themes); newspaper and magazine register; reading-period plan per class. |
| Termly | Reading programme or challenge (e.g. "read 5 books this term", Hindi/regional-language reading weeks); book fair; author visit; inter-house reading competitions; report on circulation to the principal. |
| Yearly | Purchase list against the budget (teacher and student suggestions); accessioning and labelling new stock; annual stock verification (physical check against the accession register) and write-off of lost/damaged books with approval; weeding of outdated stock; data for the CBSE affiliation / mandatory disclosure (library size, books per student). |

**Reports owed:** circulation figures, overdue and fines, stock-verification report, purchase proposals, the library
figures in inspection and affiliation returns.

**Pain points:** the overdue chase (calling class teachers one by one), a popular title with a queue nobody tracks,
fines that are computed but never settled or are waived without a trace, no evidence of reading habits for the
principal, idle stock occupying shelves, manual reading-challenge tallies.

Sources: Koha documentation and community notes on circulation, holds and fines (ByWater help, Koha release notes,
INFLIBNET Koha module), Indian school librarian job postings (Indeed, Weekday, Podar, GD Goenka), CBSE affiliation
library norms as stated in school disclosures.

## 2. Competitors

| Capability | Koha (open source ILS) | Fedena / Entab library module | Teachmint / MyClassboard | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Catalogue, digital resources, notes, question papers | ✓ (MARC) | ✓ | ✓ | ✓ | ✓ |
| Accession numbers, barcode labels, scan desk | ✓ | ✓ | partial | ✓ | ✓ |
| Issue / return with IST due days and fines | ✓ | ✓ | ✓ | ✓ | ✓ |
| Renewals with limits | ✓ | ✓ | partial | — | ✓ max 2, never overdue, never past a waiting reservation |
| Reservations / hold queue with hold shelf | ✓ | partial | — | — (requests only; refused when no copy) | ✓ queue, copy set aside on return for 3 days, family told, expiry passes it on |
| Overdue notices to families | ✓ (email/SMS) | ✓ | ✓ | — | ✓ once a day per loan, student + guardians, in-app/WhatsApp outbox |
| Fine settlement (paid / waived with reason) | ✓ | ✓ | partial | — (amount only) | ✓ audited, waiver needs a reason |
| Circulation reports | ✓ | ✓ | partial | counts only | ✓ popular titles, by class/category, reader share, on-time rate, idle titles |
| Reading programme / challenge | plugin | — | — | — | ✓ per class or school, category filter, per-student progress; student sees own |
| Recommendations | plugin | — | — | — | ✓ explained next-read suggestions |
| Assistant (chat / WhatsApp) | — | — | — | catalogue, issue, return, copies | + briefing, overdue, reminders, renew, reserve, collect, insights, suggestions, challenges |

Gaps left: stock verification (inventory scan session), purchase suggestions workflow, inter-library loan, MARC/Z39.50
import, SIP2 self-check kiosks (see section 6).

## 3. Hands-on test (findings)

See `scratchpad\p4-support-roles\` for screenshots. Desktop 1440 px and phone 390 px.

- Home (Library Overview) had counts but nothing that told the librarian what to do first. **Fixed:** a "Library desk
  today" briefing card (overdue, hold shelf, fines, last 30 days, idle titles) with a link to the desk.
- Book requests were refused when no copy was free, and there was nowhere to queue the student. **Built:** reservations.
- A returned late book had a fine amount but no way to record it as paid or waived; it stayed "owed" forever.
  **Built:** fines tab and `fineStatus` (old rows with a fine read as DUE).
- No renewals: the desk had to return and re-issue, which reset nothing and lost the history. **Built.**
- No way to tell families about overdue books from the system. **Built:** reminders with a dry-run count.
- Mobile: catalogue cards are readable; new desk screens use the same table/card patterns and wrap at 390 px.

## 4. What was built

**Library desk** page `/librarian/library-desk` (also in the admin portal), backend `modules/library/library.desk.js`,
routes `/library/desk/*`, models `BookHold`, `ReadingChallenge` (`models/supportRoles.model.js`), additive fields on
`BookIssue` (`renewCount`, `renewals[]`, `fineStatus`, `fineSettledAt`, `fineNote`, `remindedOn`).

Tabs: Today (briefing) · Overdue (days late, fine so far, Remind borrowers) · Reservations (reserve, lend now, cancel)
· Fines (paid / waive with reason) · Reading programme (create, progress) · Insights (30/90/365 days) · Suggest a book.

Rules: renewal 7 days, max 2, refused when overdue or when a queue exists and no other copy is free; a returned copy goes
to the first QUEUED reservation (copy claimed so the desk cannot lend it elsewhere), ready 3 days, then expires and
passes on (hourly job `library.holds.expire`); reminders at most once a day per loan (idempotency key per loan per day).

API: `GET /library/desk/briefing|insights|overdue|fines|holds|challenges|challenges/:id|challenges/mine|suggestions/:studentId|rules`,
`POST /library/desk/overdue/remind`, `POST /library/desk/loans/:id/renew`, `POST /library/desk/loans/:id/fine`,
`POST /library/desk/holds`, `POST /library/desk/holds/:id/cancel|collect`, `POST /library/desk/challenges`,
`POST /library/desk/challenges/:id/close`. All `library.manage` except `rules` (`library.read`) and `challenges/mine`
(`library.request`, students only, own progress).

AI, always evidence-backed and never deciding: the briefing lines are counts with their source; suggestions list their
reasons ("borrowed 3 Fiction books", "borrowed 4 times by classmates", "2 copies on the shelf").

Sample data: a reservation ready on the hold shelf, two queued, a term reading challenge, a settled fine
(`seed_p4_support_roles.js`).

### Parents ask for books (and bus places) for their own children

Lead's item, built with this audit: PARENT now holds `library.request` and `transport.request` at OWN. The services take
the child from the parent's own guardian links (`utils/familyStudent.js`): a parent names one of their children (or
has only one), never another family's child (403 `STUDENT_OUT_OF_SCOPE`); a parent with two children who names none is
asked which (`CHILD_REQUIRED`). Listing and withdrawing cover all of the parent's children; a student still asks only
for themselves. The decision notification goes to the student and to the parent who asked. Screens: "Ask for it" on
the parent Library catalogue with a requests card, and "Ask for a bus place" on the parent Transport page. Assistant:
`request_book`, `get_transport_routes` and `request_transport_route` take an optional `childName`. Tests:
`backend/tests/parent.requests.test.js`, `frontend/tests/p4-support-views.test.tsx`.

## 5. Assistant coverage

New tools (`backend/src/modules/ai/mcp/tools/p4Librarian.js`, 13): `get_library_desk_briefing`, `list_overdue_loans`,
`send_library_overdue_reminders` (web-confirmed: reaches families), `renew_library_loan`, `reserve_library_book`,
`list_library_reservation_queue`, `cancel_library_reservation`, `lend_reserved_book`, `list_unpaid_library_fines` (read-only),
`get_library_insights`, `suggest_books_for_student`, `create_reading_challenge`, `get_reading_challenge_progress`.

Existing: catalogue CRUD, issue/return, copies by accession, book requests (read). Librarian catalogue: 67 → 82 tools.
Every write is a draft confirmed by the same person.

Deliberately not in chat: marking a fine paid or waived (money, at the desk), deciding a student's book request (the
Book Requests page), label printing (no file channel).

## 6. What remains, and why

- **Stock verification session** (scan every shelf, list missing copies, propose write-offs for approval): needs a
  scan-session model and a write-off approval route; next after this audit.
- **Purchase suggestions** from teachers/students feeding procurement: procurement exists; the link is a small follow-up.
- **MARC / ISBN lookup import, Z39.50, SIP2 kiosks**: external integrations; out of scope without a provider decision.
- **Fine collection through fees**: fines are settled at the desk; posting them to the fee ledger needs a finance decision.
