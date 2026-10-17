# Profile audit: Student and Alumnus

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portals `/oakridge/student` (demo login by phone
`+910000003001`, Diya Sharma, Class 5 A) and `/oakridge/alumnus` (`+910000000033`, Demo Alumnus, Class of 2018).
Considered: a primary child (Classes 1–5, usually using the portal with a parent), a middle-school student (6–8), a
senior-secondary student preparing for boards and entrance exams (9–12), a recent graduate, an older alumnus, and a
retired teacher who is now "former staff".

## 1. The roles in an Indian school

### Student

**Answers to** the class teacher and subject teachers; the family sees the same record through the parent portal.

| When | What |
|---|---|
| Daily | Timetable and room; homework due tomorrow; class tests and quizzes; attendance (and a leave note when absent); course material; doubt-solving (Study Help); library returns; bus timing. |
| Weekly | Assignments and projects across subjects; club and house activities; revision for weekly/unit tests; digital lectures missed. |
| Termly | Unit tests and half-yearly exams (datesheet, syllabus per paper); report card; co-scholastic activities and portfolio; PTM; elective/subject registration (Class 9 and 11). |
| Yearly | Annual exams; promotion; in Classes 10 and 12 the **board registration (List of Candidates, LOC)** — for the 2027 CBSE exams the school window ran 24 Sep–21 Oct 2026 (late fee to 30 Oct) with a correction window 2–4 Nov 2026; then the board datesheet and admit card; entrance-exam preparation (JEE/NEET/CUET) alongside boards; certificates (bonafide, character, TC) when changing school. |

**Pain points by age.** Primary: the portal is the parent's job, days need to be short and simple. Middle: many
subjects, no single "what is due" list, falling behind silently in one subject. Senior: boards plus entrance prep,
stress, and an unforgiving one-time step — a misspelt name or wrong date of birth in the LOC is very hard to correct
after the window. All ages: safety disclosures made to a chatbot that go nowhere.

### Alumnus (former student or former staff)

**Relationship** with the school's alumni coordinator (HR/admin in EduOS). Needs that recur for years after leaving:
certificates from the school record (character, study and leaving certificates; duplicate TC for jobs, visas, foreign
universities, domicile), reunions, finding batchmates, and "giving back" — career talks, mentoring, internships, jobs
and scholarships for current students. Board documents (duplicate marksheets, migration certificate) are issued by the
board itself (CBSE's Duplicate Academic Documents System or DigiLocker), not the school, and alumni often do not know
that. Former teachers want to stay connected and are natural mentors.

Sources: CBSE duplicate-documents guidelines (cbse.gov.in/dup.htm) and DigiLocker; Careers360 coverage of the CBSE LOC
2026-27 timeline; Teachmint and Schoology/Toddle public product pages and reviews; Almabase and Graduway (Gravyty)
product pages and Capterra reviews.

## 2. Competitors

| Capability | Teachmint / MyClassboard / Entab | Schoology / Toddle / Google Classroom | Almabase / Graduway | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Timetable, homework, submissions, quizzes, report cards, fees, library, transport | ✓ | partial (LMS only) | — | ✓ | ✓ |
| One "what is due" list across subjects | partial | ✓ planner/calendar | — | dashboard count only | ✓ **My Planner**: due, overdue, quizzes not taken, exams in 21 days |
| Suggested study plan from the student's own results | — | — | — | — (Study Help scaffold per topic) | ✓ a week of study blocks, each with its reason (homework due, exam in N days, lowest subject), sized by age |
| Board-registration (LOC) details check | — | — | — | — | ✓ Classes 10 and 12: name, DOB, gender, parents' names, subjects, missing items flagged, calendar deadlines, "ask for a correction" |
| AI doubt-solving with integrity mode | partial | — | — | ✓ | ✓ + safety disclosures can reach the safeguarding team (student-confirmed) |
| Alumni directory with per-field consent, batches, circles, reunions + RSVP | — | — | ✓ | ✓ | ✓ |
| Alumni certificate requests from the school record | — | — | — | — (a note said "ask the office") | ✓ same office queue as students; current-student certificates (bonafide, enrolment, fee) excluded |
| Jobs / internships / mentoring / career talks board ("give back") | — | — | ✓ | — | ✓ reviewed by the coordinator; students see their audience only, never the alumnus's contact; interest routed through the coordinator |
| Giving / donations | — | — | ✓ | — | — (see section 6) |
| Assistant for these tasks | — | — | — | students broad; alumni 20 tools | + 17 tools (section 5) |

## 3. Hands-on test (findings)

Own servers (API on :5071 with an in-memory database seeded by the three demo seeds, Next dev on :3061 with
`NEXT_DIST_DIR=.next-student-alumnus`). Every sidebar page as STUDENT and ALUMNUS at 1440 px and 390 px; screenshots in
`scratchpad\p4-student-alumnus\`. Earlier part-1 findings for the student portal were rechecked: the attendance
double count (period rows), the "Pending assignments 0" count and the library-notes facet 403s are fixed in the code.

- **Safety disclosures went nowhere (fixed).** When Study Help classified a message as a `safety` disclosure (danger,
  abuse, self-harm) the student got a kind reply and nothing else; no adult was told. Now the reply offers "Tell someone
  at school": the student chooses urgency, may add a few words, and presses send. It files a safeguarding report
  (encrypted; the officers' alert is content-free) and shows the reference. The AI files nothing by itself.
- **No single list of what is due (built).** Homework, quizzes and exam papers lived on three pages; the dashboard showed
  a count. Built **My Planner** for students and parents.
- **Board LOC check absent (built)**, see above. Demo calendar now carries a "Board LOC details check" event.
- **Alumni could not request certificates (built).** "Your school record" said to ask the office, with no way to do
  it; the demo alumnus also had no archived record at all (seed fixed: archived record `OAK-2006-0412` linked, and a
  pending character-certificate request in the office queue).
- **Alumnus home was only the newsroom (extended).** Added a strip above it: next reunion and the alumnus's reply,
  certificate status, their offers, and what the directory shows of them; each opens the page where they act.
- **Nothing for alumni to give (built)**: the Opportunities board, with a review step and child-safe introductions.
- Alumni "Your school record" note now points to Certificates.
- Mobile 390 px: new screens stack (week plan one day per row, subject bars wrap); no horizontal scroll found on the
  alumnus pages. The User Guide page could not render in this run because `frontend/src/lib/guides/ops.ts` currently
  has unescaped apostrophes in other engineers' new entries (librarian, hostel life); one of them (librarian) was
  escaped here, the rest are left to their owners.

## 4. What was built

Backend
- `models/alumniOpportunity.model.js` — offers with kind, audience (SENIOR_STUDENTS = Classes 9–12, ALL_STUDENTS,
  ALUMNI, EVERYONE), review, interests, history.
- `modules/p4StudentAlumnus/opportunities.service.js` — list (audience by role and class; published and not past
  apply-by), create (alumnus → PENDING_REVIEW; coordinator → PUBLISHED), withdraw, review (alumni.manage, reason
  required to reject, never your own), interest (students and alumni; coordinator notified with class; poster sees a
  count only; links shown to adults only).
- `modules/p4StudentAlumnus/planner.service.js` — `getPlanner(actor, { studentId, days })`: student or a linked
  parent; own open homework, overdue, unattempted quizzes, exam papers, calendar, own published marks per subject, a
  7-day plan (20/30/60/90/120 minutes a day by stage; homework due next day, then revision for exams within 10 days,
  then the lowest subject) and the board-details block for Classes 10 and 12.
- `modules/documentRequests/documentRequest.service.js` — `alumnusContext`: an ALUMNUS who is a former student acts
  on their own archived record (found through their alumni profile, never an id they send); former staff and
  suspended alumni are refused.
- `modules/p4StudentAlumnus/p4StudentAlumnus.routes.js`, mounted in `routes/index.js`:
  `GET/POST /alumni-services/documents`, `GET /alumni-services/documents/types`, `GET /alumni-services/documents/:id`,
  `POST /alumni-services/documents/:id/cancel`, `GET /alumni-services/documents/:id/file` (ALUMNUS + alumni feature);
  `GET/POST /alumni-services/opportunities`, `GET /alumni-services/opportunities/mine`,
  `POST /alumni-services/opportunities/:id/withdraw|review|interest`; `GET /student-planner/me` (STUDENT, PARENT).
- `seed/seed_p4_student_alumnus.js` (called from `seed_operations.js`).

Frontend
- `components/ops/p4-student-alumnus-views.tsx` — `StudentPlannerView` (child chips for parents with several
  children), `GiveBackView` (board, my offers, review queue for the coordinator), `AlumniCertificatesView`,
  `AlumnusHomeStrip` / `AlumnusHomeView`.
- `components/study-help/results/safety-help.tsx`, used by `redirect-view.tsx` for `safety` replies.
- `lib/p4-student-alumnus-api.ts`; pages `planner` (student, parent), `give-back` (student, alumnus, HR),
  `certificates` (alumnus) in `ops-routes.json`, generated; alumnus home now renders `AlumnusHomeView`; guide topics
  in `lib/guides/ops.ts`; styles in `operations.css` (section "Part 4: student planner…").

## 5. Assistant coverage

New file `backend/src/modules/ai/mcp/tools/p4StudentAlumnus.js` (17 tools, registered in `registry.js`). Writes are
drafted and run only when the same person confirms; nothing here decides (publishing or rejecting an offer and issuing a
certificate stay on the screen).

| Tool | Op | Who |
|---|---|---|
| get_my_alumni_profile | GET | alumnus |
| update_my_alumni_profile | UPDATE (confirm) | alumnus |
| get_my_school_record | GET | alumnus |
| list_alumni_batches | GET | alumni.directory.read (students, alumni, staff with it) |
| list_alumni_posts | GET | alumnus |
| create_alumni_post | CREATE (confirm) | alumnus |
| list_alumni_certificate_types | GET | alumnus |
| get_my_alumni_certificate_requests | GET | alumnus |
| request_alumni_certificate | CREATE (confirm) | alumnus |
| cancel_alumni_certificate_request | UPDATE (confirm) | alumnus |
| list_alumni_opportunities | GET | alumni.directory.read |
| get_my_opportunity_offers | GET | alumnus |
| offer_opportunity | CREATE (confirm) | alumnus |
| withdraw_opportunity_offer | UPDATE (confirm) | alumnus |
| express_interest_in_opportunity | ACTION (confirm) | student, alumnus |
| get_my_planner | GET | student, parent |
| get_board_registration_details | GET | student, parent |

Alumnus catalogue 20 → 35 tools; student gains get_my_planner, get_board_registration_details, list_alumni_opportunities,
express_interest_in_opportunity, list_alumni_batches. The student portal was already broadly covered (97 tools:
homework submission, leave, electives, library, transport, certificates, tickets, profile edits, out-passes, clubs).
Safeguarding reports are deliberately not an assistant tool (the safeguarding rules keep cases out of the assistant);
the student files one on the screen.

## 6. What remains, and why

- **Alumni giving / donations.** Needs a receipting and 80G flow with Finance and a real payment provider; out of scope
  for a profile audit and it would touch money (a person must confirm on the Payments screen).
- **Issuing alumni certificates as signed PDFs automatically.** The office still uploads the issued file (the existing
  document-request workflow); a template-generated, digitally signed certificate is a school-wide document feature.
- **Parent planner write-actions** (e.g. marking study blocks done) — the plan is a read-only suggestion by design.
- **Board LOC dates as data.** The planner shows board deadlines only from the school calendar; dates vary by board and
  year, so they are not hard-coded.
- **Alumni verification for self-registration** (people who left before EduOS). Today alumni come from the transition
  step; an "I studied here" claim flow with HR verification is the next step.
- Pinned MCP counts in `tests/mcp.catalog.test.js` etc. are left for the lead to reconcile (17 new tools).
