# Profile audit: Principal, Administrator and Trustee

This is part 4 of the profile audits, run 16–17 Oct 2026 on branch `feat/platform-part-3`. It covers three demo logins:

- `principal@schoolerp.com`: the head of school.
- `admin@schoolerp.com`: the administrator or office superintendent.
- `trustee@schoolerp.com`: a trustee or member of the governing body.

All three use the password `ChangeMe@123!`. Companion audits are [compliance.md](compliance.md), [finance.md](finance.md), [hr.md](hr.md) and [teacher.md](teacher.md).

## 1. The roles in an Indian school

### Principal (head of school)
**Reports to:** the managing society or trust and the School Management Committee (SMC). Under CBSE Affiliation Bye-Laws 2018, clause 9.2, the principal is ex-officio Member Secretary of the SMC. The principal heads the school office, is responsible for compliance with the Affiliation and Examination Bye-Laws and CBSE directions, and is the drawing and disbursing officer (in unaided schools, as the society delegates).

| When | What |
|---|---|
| Daily | Morning round: which registers are not yet taken, who is absent among staff, and who covers their periods. Decisions waiting (leave, money, letters, policies). Parent escalations. Discipline and safeguarding referrals. |
| Weekly | Staff meeting. Syllabus progress by teacher. Attendance by class. Students slipping below 75% (CBSE requires 75% to sit board exams). Teacher load and cover fairness. |
| Term | Exam schedule, results moderation and report-card release, PTMs, classroom observations and appraisal, timetable revision. |
| Year | Budget presented to the SMC before it goes to the society. Fee proposals for SMC approval. Affiliation conditions (fire, building, water and sanitation certificates). UDISE+ school profile (state deadlines run Sep–Dec). CBSE OASIS data and the mandatory public disclosure on the website (Appendix IX). Inspections. Board-exam LOC. |

**Owes:** the SMC agenda and minutes (as its secretary), the budget, UDISE+, OASIS, the website disclosure, and inspection evidence.

**Pain points:**
- Registers not taken by 10:00.
- Teachers double-booked or overloaded.
- Assembling evidence on inspection day.
- Writing board papers by hand.

### Administrator / office superintendent
**Reports to:** the principal.

**Responsibilities:**
- Admissions and the admission register.
- Student records. Name, date of birth, religion and address are not changed without evidence and a prescribed application.
- Certificates: transfer (TC), leaving, bonafide, character and fee. A TC records dues paid up to a month and must be produced at the next school.
- Vendors and AMC, facilities, correspondence, and office staff.

**Pain points:**
- TCs typed in Word, with no serial register.
- No-dues checks done by walking to the accounts, library and hostel offices.
- Certificates cannot be verified when another school phones.

### Trustee / governing body
**Responsibilities:** the society or trust owns the school and is responsible for infrastructure and for running it as a community service. The SMC approves fees and reviews the budget, ensures there are no financial irregularities and no irregular admissions or examinations, ensures safety, and hears staff grievances.

**Board cycle:** an agenda with papers is circulated about a week ahead. Members declare conflicts of interest. Votes are counted against quorum. The chair approves the minutes. An action register is followed up at the next meeting.

**Pain points:**
- Papers arrive late or differ between members.
- Finance is given as a single number without comparison.
- There is no action register.
- Conflicts go undeclared.

Sources: CBSE "Role of Principal / Manager / School Management Committee / Society" pages (cbse.gov.in); Affiliation Bye-Laws 2018 ch. 7–9 as summarised; Delhi DoE circular 437/46 (UDISE+ by 30.09.2025); Maharashtra and Assam UDISE+ circulars as reported; CBSE OASIS circular 02/2022 and Appendix IX disclosure FAQ (saras.cbse.gov.in); board-portal feature guides (Azeus Convene, iBabs, Aprio); state education rules on TCs and admission registers (Madras Educational Rules, Karnataka circular).

## 2. Competitors

| Capability | Entab CampusCare / Fedena / MyClassboard | Teachmint / Edunext | Veracross / Blackbaud / PowerSchool | Board portals (Diligent, BoardEffect, Convene) | EduOS before | EduOS now |
|---|---|---|---|---|---|---|
| Management dashboard, multi-department | ✓ | ✓ | ✓ | — | ✓ pulse board, analytics, quarterly reports | ✓ |
| School-wide attendance by class, registers not taken, students below 75% | ✓ | ✓ | ✓ | — | ✗: one section's roster for one day | ✓ |
| Teacher workload from the timetable, with clash detection | partial (substitution) | partial | ✓ | — | ✗: grade and offering counts only | ✓ periods a week and per day, cover, leave, cap, clashes |
| Approvals with maker-checker and delegation | partial | partial | partial | — | ✓ | ✓ |
| Certificate generation (TC, bonafide) from records | ✓ | ✓ | n/a | — | ✗: upload a file typed elsewhere | ✓ with no-dues check, serial number, verification code |
| No-dues clearance (fees, library, hostel) | ✓ | partial | n/a | — | ✗ | ✓ |
| Board/SMC meetings, agenda, minutes, votes, actions | — | — | partial | ✓ | ✓ | ✓ |
| Board pack (frozen version, read receipts, PDF) | — | — | — | ✓ | ✗ | ✓ |
| Conflict declarations with recusal from votes | — | — | — | ✓ | API only, no UI, no recusal | ✓ UI, recusal enforced |
| Finance oversight for trustees (year vs last year, budget vs actual) | partial | — | ✓ | via uploaded papers | analytics figures only | ✓ in the board pack, with last year's outturn |
| Suggested questions from the figures | — | — | — | some (AI) | ✗ | ✓ rule-based, each with its basis |
| Assistant can act (draft, then confirm) | — | partial | — | — | governance and certificate reads only | ✓ 15 tools |

**Still behind:**
- E-signature and OTP voting on circular resolutions, which board portals offer.
- Results moderation.
- Classroom observation and appraisal.

These are listed in section 5.

## 3. Hands-on test findings

The shared demo was down, so the test ran on my own instance: API on 5161 against an in-memory or on-disk database, and `next dev` on 3161. The principal sweep covered 69 pages at 1440 px. Screenshots and page text are in `scratchpad/p4-leadership/sweep/`. API probes for all three logins followed.

| # | Finding | Status |
|---|---|---|
| P-1 | "Attendance Trends" showed one section's roster for one day. The default date was UTC, so it showed yesterday before 05:30. The percentage counted unmarked students. Statuses appeared as raw ABSENT/PRESENT. Load errors were swallowed. | **Fixed.** A new School overview tab is the default (see section 4). The class register keeps the local date, a percentage of those marked, statuses in words and an error message. |
| P-2 | "Teacher Workload" showed grades, not teachers. Class 10 sorted before Class 5. Tiles were hard-coded white. | **Fixed.** Per-teacher load now sits on top. The grade table is kept, sorted numerically, with themed tiles. |
| P-3 | Demo timetable double-booked teachers: Karan Bhatia has 59 periods a week and 14 on Saturday, Amit Joshi 58, Neha Singh 56. | **Surfaced:** a CLASH flag names the day, time and classes. Correcting the timetable seed is left to the timetable owner. |
| G-1 | Conflict-of-interest declarations had no UI, and a conflicted member could still be counted in the vote. | **Fixed.** Members declare per agenda item. Resolutions take an agenda item, and votes from conflicted members are refused (CONFLICTED_MEMBER_VOTED). |
| G-2 | A held meeting with approved minutes could be "cancelled". | **Fixed** (MEETING_HELD). |
| G-3 | "Done" on board actions was shown to everyone; non-owners got a 403. | **Fixed:** per-action `canUpdate`. |
| G-4 | Action owners showed "—" when set by profile. | **Fixed:** the name is filled from the profile. |
| G-5 | Conflict declarations were not checked against the agenda and stayed editable after the minutes were approved. | **Fixed.** |
| G-6 | "2 open action(s)" and "reminder(s)" plurals. | **Fixed.** |
| D-1 | Sample AGM read "0/4 accepted" for a meeting everyone attended. The 2025-26 approved budget showed ₹0 spent on every line, so budget-versus-actual could not be demonstrated. | **Fixed in seed:** members accepted, and last year's outturn is seeded (Furniture +12%, Repairs +18% with an explanation). |
| A-1 | Certificates had to be typed outside EduOS and uploaded. There was no dues check, no serial register and no verification. | **Built** (see section 4). |
| X-1 | Home and Today render the same pulse board for the principal. | Not changed: shared component, outside this scope. |
| X-2 | Risk page slow to scan in dev mode. | Not reproduced on the API; left as is. |

## 4. What was built

**Backend** (`backend/src/modules/leadership/`, mounted at `/api/v1/leadership`):

- `GET /attendance-overview?from&to&threshold` (attendance.read ALL) returns:
  - every class over the period;
  - today's registers not taken or only partly taken, with class teachers (Sundays and holidays excluded);
  - the school's day-by-day figure;
  - students below the threshold, lowest first.

  It uses the same counting rules as the attendance module.
- `GET /workload?cap` (timetable.read ALL) returns, per teacher: periods a week and per day, classes, subjects, class-teacher duty, cover in the last 30 days and leave this year. It flags OVER_CAP, HEAVY_DAY, NO_PERIODS, MANY_COVERS and CLASH.
- `GET /board-pack/:meetingId[?live=1]` and `GET /board-pack/:meetingId/pdf` (governance.read; non-members get 404). The pack contains:
  - meeting and agenda;
  - previous meeting's minutes and resolutions;
  - action register;
  - finance for this financial year against last year (the analytics workspace's definitions);
  - budget by line, with last year's overruns;
  - compliance exceptions;
  - decisions at a trustee stage;
  - enrolment;
  - suggested questions, each with the figure behind it.

  Each section is built only if the reader may see that data.
- `POST /board-pack/:meetingId/freeze` (governance.manage ALL) freezes a new version (model `BoardPack`). After a freeze, members read the frozen version, and each person's first open is recorded as a read receipt.
- Certificates, all under students.manage ALL (the office):
  - `GET /certificates/:requestId/clearance` checks fees, library books and fines, and hostel bed.
  - `POST /certificates/:requestId/preview`.
  - `POST /certificates/:requestId/generate` refuses a TC or leaving certificate while dues are open, unless a reason of 10+ characters is given. The reason is audited and shown in the register. It builds a PDF in the CBSE TC layout from the record, including date of birth in words, first admission, last class, attendance and dues paid up to. It gives a per-kind serial (`TC/2026/0001`, `BC/…`) and a verification code, then attaches the file through the existing `documentRequests.issue()`, so versions, audit and family notification work as before.
  - `GET /certificates/register` and `GET /certificates/verify/:code`.

  Model: `IssuedCertificate`.
- Governance service fixes G-1 to G-5. `present()` now returns `actions[].canUpdate` and `myConflicts`.

**Frontend:**
- `/principal/attendance`: tabs for School overview (new) and Class register (existing, fixed).
- `/principal/workload`: teacher workload on top, the grade table kept.
- Governance meeting drawer:
  - a **Board pack** tab with Download PDF, read receipts, questions and Freeze;
  - a **Conflicts of interest** card for members;
  - an agenda item on each resolution;
  - Done shown only to the owner or the secretariat.
- `/admin/document-requests`: **Generate from records** on approved requests (dues check, office fields, preview, generate) and a **Certificate Register** tab with code check.
- Files: `components/leadership/*`, `lib/leadership-api.ts`, and a "Part 4 (leadership)" section in `operations.css`. The 390 px layouts use 2-column tiles and stacked filters.

**AI and automation:** no model decides anything. Board-pack questions are fixed rules over the figures, each showing its basis and labelled as prompts. The assistant drafts writes, and the same person confirms them (see section 6).

## 5. What remains, and why

1. **OTP or e-sign voting on circular resolutions between meetings.** This needs an e-signature provider decision. The current flow records votes taken in the meeting.
2. **Results moderation and report-card release dashboard, and classroom observation/appraisal.** These overlap the teacher and HR audits' scopes and were left to those engineers to avoid conflicting edits.
3. **Public, QR-based certificate verification.** Verification is office-only today, to avoid exposing a child's details on a public URL. A public check would need a product decision on which fields it shows.
4. **Fixing the demo timetable double-bookings (P-3).** The fix belongs in the timetable seed; the workload page now exposes the clashes.
5. **Principal Home and Today duplication (X-1).** A shared component; outside this scope.
6. **Browser re-check after the final changes.** The machine ran out of memory: the mongod journal failed with "Insufficient system resources" and the seed hit "Fatal process out of memory". The coordinator limited us to one server at a time. The new pages are verified by component tests, `tsc`, lint and API probes on a seeded instance (board pack, workload and attendance responses shown in the progress log). They have not had a final browser pass.

## 6. Assistant coverage (Ask AI and WhatsApp)

New file `backend/src/modules/ai/mcp/tools/p4Leadership.js`, with 15 tools registered in `registry.js` (one import plus one spread).

| Tool | Kind | Permission | Notes |
|---|---|---|---|
| get_school_attendance_overview | read | attendance.read ALL | classes, registers not taken, below 75% |
| get_teacher_workload | read | timetable.read ALL | optional teacher filter and cap |
| get_board_pack | read | governance.read | frozen version for members (records the read) |
| list_board_actions | read | governance.read | overdue first |
| list_certificate_requests | read | students.manage ALL | office queue |
| get_certificate_clearance | read | students.manage ALL | no-dues check |
| list_issued_certificates | read | students.manage ALL | register |
| check_certificate_code | read | students.manage ALL | verification |
| schedule_board_meeting | CREATE, confirm, affects others | governance.manage ALL | members by name (default: trustees and the principal) |
| set_board_agenda | UPDATE, confirm, affects others | governance.manage ALL | optional circulate |
| freeze_board_pack | CREATE, confirm, affects others | governance.manage ALL | |
| respond_to_board_meeting | UPDATE, confirm | governance.read | also works on WhatsApp |
| declare_meeting_conflict | UPDATE, confirm | governance.read | also works on WhatsApp |
| mark_board_action_done | UPDATE, confirm | governance.read | owner or secretariat only |
| generate_certificate | CREATE, confirm, HIGH, website only | students.manage ALL | refuses open dues without the user's stated reason |

The totals are 8 reads and 7 writes (3 CREATE, 4 UPDATE). Pinned counts were not edited: `mcp.catalog` and `admin.writeAudit` now differ because of every part-4 tool file, and the lead reconciles them.

**Deliberately not in chat:**
- approving minutes (the chair decides);
- recording votes and resolutions (the secretary records them from the meeting);
- approving or rejecting certificate requests (a decision; the registry's deciding-verb rule);
- file downloads.

Existing tools already cover approvals inbox reads, budgets, compliance deadlines, admissions, analytics and quarterly reports.

## 7. Tests

| Suite | Result |
|---|---|
| `backend/tests/leadership.p4.test.js` (11 tests): attendance overview, ranges, workload, cap and clashes, recusal, held-meeting cancel, conflict validation, owner names and canUpdate, board pack (live, non-member 404, freeze versions, single read receipt, sections hidden without permission, PDF), certificates (dues refusal, override, serial, attachment, register, verify, tenant isolation, bonafide, approved-only, date in words) | pass |
| `backend/tests/mcp.p4Leadership.test.js` (6 tests): contract, role visibility, scope refusal (teacher), draft-then-confirm (schedule, agenda, conflict over WhatsApp, freeze), owner-only action done, certificate website-only with reason | pass |
| `frontend/tests/p4-leadership.test.tsx` (6 tests) | pass |
| `governance.minutes`, `administration.workflows`, `documentRequests.module`, `demo.completeness` (backend); `ops-screens`, `document-requests` (frontend) | pass |
| `mcp.roleCoverage` | 4 failures, all about `analytics.child.read` from another engineer's parent work, not leadership |
| `mcp.catalog`, `admin.writeAudit` | pinned counts (lead reconciles) |
| `tsc --noEmit` and eslint on changed files | clean |
