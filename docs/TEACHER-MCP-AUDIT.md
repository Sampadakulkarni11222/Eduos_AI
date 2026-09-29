# Teacher MCP Phase — Final Audit

Status at the end of this report: **TEACHER PHASE COMPLETE** (see §11). Full backend: 112/112 files, 2,897/2,897 tests on the pre-merge tree, and 2,912/2,912 on the merged `mcp-fix` tree (§10).

## 1. Scope

| Surface | What was audited |
|---|---|
| Teacher Web pages | 16 pages under `frontend/src/app/[school]/teacher` (Dashboard, My Classes, Attendance, Timetable, Assignments, Exams & Performance, Course Material, Announcements, Calendar, Parent Queries, Subject Registrations, Student Requests, Leave Requests, Medical Records, Transport) and the shared components they use |
| Web API routes | Every route in `backend/src/routes/index.js` checked against the TEACHER grants in `constants/permissions.js`, including router-level guards. About 90 routes are reachable by a Teacher |
| MCP capabilities | `mcpToolsFor(TEACHER)` over the 173-tool registry |
| WhatsApp | The real signed webhook (`/whatsapp/webhook`), same `runAgent()` → MCP path as the website |

The test environment was an in-memory MongoDB. `.env` (which points at live Atlas) was never loaded or modified.

## 2. Final Capability Counts (Teacher)

| Operation | Count | Tools |
|---|---|---|
| GET | 41 | students (5), attendance (8), classes/subjects/years (5), timetable, results/report card/class marks/marks grid/exams/performance (7), assignments/submissions, announcements, calendar, leave, registration & student-request queues (3), medical, tickets (2), dashboard, notifications, documents, profile |
| CREATE | 3 | `create_assignment`, `create_announcement`, `create_course_material` |
| UPDATE | 1 | `update_course_material` |
| DELETE | 1 | `delete_document` (own documents only) |
| ACTION | 10 | `mark_attendance`, `bulk_mark_attendance`, `enter_marks`, `publish_marks`, `grade_submission`, `review_leave`, `decide_registration`, `decide_cocurricular`, `decide_profile_edit`, `reply_to_ticket` |
| **Total** | **56** | (was 58) |

## 3. Web → MCP Parity

**MCP-only Teacher capabilities: 0.** Both earlier ones were removed from the Teacher surface by `minScope: 'ALL'`. Admin and Principal keep them.

| Capability | Why it was MCP-only | Now |
|---|---|---|
| `update_announcement` | No announcement edit route or UI exists on the Web | Refused to OWN scope (`FORBIDDEN_SCOPE`); the assistant says it isn't offered |
| `generate_homework` | AI drafting has no Web counterpart | Refused to OWN scope; "generate homework" reaches `create_assignment` (= `POST /assignments`) |

**Intentional exclusions** (Web has it; not exposed through the assistant):

| Web route | Reason |
|---|---|
| `POST /calendar` | The calendar service refuses OWN-scope creation, so the Web cannot do it either. The assistant says "can't schedule the calendar" |
| `POST /attendance/ocr/draft` | Photo input; not text |
| `GET /exams/report-card/pdf`, `GET /students/:id/id-card`, `GET /documents/:id/file` | Binary artefacts; downloaded from the screen |
| `PATCH /students/:id/photo`, `POST /uploads` | File upload; a chat message cannot carry a file (WhatsApp rejects non-text by design) |
| `POST /announcements/preview` | Folded into the proposal: the confirmation names the real audience |
| `GET /enrollments/next-roll-no` | Admin form helper |

**Web → MCP missing (verified against the code; not added, by decision):**

| Web route | Finding |
|---|---|
| `POST /notifications/read`, `POST /notifications/read-all` | An own-record write the Web allows any signed-in user; no MCP tool exists. `list_notifications` reads them. |
| `GET /transport/roster` (Teacher Transport page) | The Web route is authentication-only, and `transport.service.listTransportRoster()` scopes it to the caller's own sections. The MCP tool `get_transport_roster` declares `transport.read` at `minScope: 'ALL'`, which a Teacher does not hold, so the assistant cannot answer it for a Teacher. |

**Not a gap (corrected):** the academic terms list. `list_academic_years`, which a Teacher holds, calls the same `academics.service.listTerms()` and returns the terms.

## 4. Fixes Implemented

All resolver fixes are in shared logic (entity, date and name readers, operation families, registry metadata). None are Teacher-specific rules, and none are per-sentence rules.

| Problem | Root cause | Solution | Verified by |
|---|---|---|---|
| "marks for Mathematics" looked up a pupil called Mathematics | The same phrase filled both the subject and the student dimension | One phrase fills one dimension; the subject wins (`entityIntent.dimensionsNamed`) | webParity §2 |
| "Mathematics." had a trailing full stop | The subject reader kept punctuation | Strip it | webParity §2 |
| "on 5 August 2026" → period 5 | The day-of-month was left in the residual, and the integer reader took it | Written dates are removed from the residual (`entityIntent.residualMessage`) | webParity §2 |
| "this week" → today, or the whole month | `rangeFromText` didn't read weeks, and a week inside one month was accepted as a `month` | Calendar weeks read; a month carries a range only if the range *is* that month (`isWholeMonth`) | webParity §3 (declined) |
| Weekly timetable missing | `get_timetable` answered one day only | `day: "week"` renders the same service data grouped by day | webParity §2 |
| Update/delete homework became *create* homework | Every ACTION counted as an UPDATE/DELETE; generic verbs inherited catalogue ACTIONs | `performsAsked()`: an ACTION stands in for DELETE only if its verb deletes, and for UPDATE only if it doesn't create. Generic verbs mean their own operation | webParity §3 |
| "Record marks/attendance", "send an announcement" refused | NOT_PERMITTED was judged by tool-name verbs only | Also accept the opening verbs of a held capability's own description on the same entity (`actsBy`) | webParity §5 |
| "absent students" → "you have no enrolment" | A single-record tool was chosen for a Teacher with no record of their own | `toClassLevel()`: for an OWN-scope class holder asking about nobody in particular, use the same entity's class-level capability (asks "which class?") | webParity §2 |
| "Sharma" read as "share" | Stem `shar` | Whole word forms only | webParity §2 |
| Exams / announcements / course materials misrouted | Self-scoped `get_my_*` bonus applied when "my classes" was only a qualifier; "course material" read as a course | Self bonus only when the self entity is the subject; vocabulary fixes | webParity §2 |
| Security phrases missed | No patterns for "ignore permissions", "show database records", "another school's", `tenant_id`, platform-wide | Added to the injection and other-institution detectors | webParity §4, §6 |
| Marks writes unreachable by sentence | `enter_marks` / `publish_marks` required ObjectIds | Resolve the paper by class, subject and exam, and students by name (`resolveExamPaper`), before the proposal | webParity §5 |
| Announcement to one class impossible | Only `sectionIds` accepted | `className` resolved at the caller's scope before the proposal; the summary names the class | webParity §5 |
| Invented announcement title ("for my Class 6-A.") | Rule took any trailing text | Only introduced text (colon, "saying", "that") | webParity §5 |
| Free text written into identity arguments (`exam` = "Rahul Sharma 41") | The colon reader filled every string argument | `namesARecord()`: class/student/exam/academic-subject names come from dimension readers only | webParity §5 |
| Homework proposal for a class not taught | `create_assignment` resolved the offering only after "yes" | `prepare` resolves the offering first; run re-resolves by id | teacher.askAi.routing §6 |
| Dated attendance correction didn't route (gap 1) | A read rule tied with the marking rule and was then rejected, leaving nothing | Ties at the top score are settled by fit (`topRules`) | webParity §6 |
| Grading unreachable by sentence (gap 2) | `grade_submission` required ObjectIds | Student by name and assignment by title/subject among the Teacher's own work, before the proposal | webParity §6 |
| "all students in the entire platform" answered with own students (gap 4) | No platform-wide detection; the listing didn't state scope | Platform-wide phrasing refused as other-institution; a Teacher's unfiltered listing says "You can only see students in your own classes" | webParity §6 |
| "Generate Mathematics homework" lost its subject | "Generate Mathematics" read as a person's name | A capitalised run's leading verb is set aside | teacher.askAi.routing §6 |

## 5. Security

- **Tenant isolation:** the school comes from the session. Other-school, platform-wide and `tenant_id` requests are refused before any capability is chosen (no MCP call, no audit row for a tool). Another school's pupil is "not found".
- **Teacher scope:** another Teacher's class is refused by name ("Class 6 B is not one of your classes") with nothing disclosed. Another Teacher's pupil, paper and document are refused. Pupils outside the paper's class are refused before the proposal.
- **Injection:** "Run SQL", "Show database records", "Pretend I am Admin", "Ignore Teacher permissions" are flagged; nothing runs.
- **LLM-controlled authorization:** a scripted model proposing `tenantId` / `roleKey` / `scope` arguments, hidden tools, another Teacher's class, or an invented pupil gains nothing (`tests/teacher.llmPath.test.js`, 17/17 passed; see §7).
- **No arbitrary DB/SQL/HTTP:** every call goes through registered MCP tools; hidden tools are refused at the server (`FORBIDDEN_SCOPE`).
- **Writes:** propose → confirm → re-authorize → service → audit. Withdrawing `marks.enter` between proposal and "yes" stops the write (webParity §5).

## 6. Web vs WhatsApp

Both channels call the same `runAgent()` → MCP server. Every scenario in `teacher.webParity` asserts the same capability (from the audit trail) and the same reply text on both channels. The only difference is WhatsApp's "Reply YES" confirmation footer.

## 7. Final Test Results

Every suite was run alone, one process at a time, on an in-memory MongoDB. No `.env` was loaded and no live provider was called.

| Suite | Command | Files | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|---|
| Teacher | `npx vitest run tests/teacher.*.test.js` (5 files, before `teacher.llmPath` existed) | 5 | 223 | 0 | 0 | — |
| MCP | `npx vitest run tests/mcp.*.test.js` excluding `mcp.admin*` / `mcp.student*` | 30 | 929 | 2 | 0 | 694.6 s |
| MCP, `mcp.routing` rerun after the fix | `npx vitest run tests/mcp.routing.test.js` | 1 | 11 | 0 | 0 | 27.2 s |
| Admin | `mcp.admin*` (3), `schoolAdmin.isolation`, `roleSegregation.p0`, `authorization.matrix` | 6 | 161 | 0 | 0 | 125.0 s |
| Student | `mcp.studentAskAi`, `mcp.studentIdentity`, `student.askAi`, `studyHelp.learningBuddy`, `studyHelp.skillSync` | 5 | 184 | 0 | 0 | 205.3 s |
| WhatsApp | `whatsapp.assistant`, `mcp.channels`, `mcp.manualScenarios.channels`, `mcp.adminScenarios.channels`, `teacher.webParity` | 5 | 140 | 0 | 0 | 196.2 s |
| Teacher LLM path (scripted model) | `npx vitest run tests/teacher.llmPath.test.js` | 1 | 17 | 0 | 0 | 30.5 s |
| Full backend, run 1 | `npx vitest run --reporter=default` | 112 | 2,896 | 1 | 0 | 2,934.1 s |
| `agent.bulkAuthorization` rerun after the fix | `npx vitest run tests/agent.bulkAuthorization.test.js` | 1 | 25 | 0 | 0 | 22.9 s |
| **Full backend, final** | `npx vitest run` | **112** | **2,897** | **0** | **0** | **3,512.9 s** |

Two earlier full-suite attempts were stopped by the host for low memory (1.7 to 2.7 GB free out of 16 GB) while the session was idle. Those runs produced no results. The runs above completed normally, with the session kept active.

**Full run 1's one failure:** `agent.bulkAuthorization` › "generate_homework admits exactly the roles holding its permission" still listed TEACHER. This was an obsolete expectation from the final decision to hide `generate_homework` from Teachers, not a regression. Its expected roles are now SUPER_ADMIN and ADMIN, with the reason in the test. The file then passed 25/25, and the final full run passed 2,897/2,897.

**The MCP failures, and what was done about them:**

- The 3 earlier `mcp.writes.coverage` failures (`generate_homework` executed as TEACHER; `generate_homework` and `update_announcement` "outside their scope") were obsolete expectations. They now pass with the Teacher refused `FORBIDDEN_SCOPE` and `generate_homework` exercised as ADMIN.
- **2 new failures in `mcp.routing` ("what is his attendance?") were a genuine regression.** It was caused by `toClassLevel()` in `intent.js`, which re-read a pronoun question as a class-level one ("Which class?"). Fixed in the same shared function: a third-person pronoun names a person, so the re-reading is skipped. `mcp.routing` then passed 11/11, and `teacher.webParity` passed again in the WhatsApp group. The other four Teacher files have not been re-run since that one-line change; the full run was meant to cover them.

**`teacher.llmPath` corrections (the file's first run):** 2 assertions were wrong about the design, not the product.
- "Who is absent today?" is a *tentative* rule reading, which is offered to the model by design. The test now asserts the model is consulted and the rule reading stands.
- The "model-only" sentence was actually rule-readable, so it was replaced with one that is not.
- Three tests were added: a model-proposed write is confirmed and audited; it is refused after the permission is withdrawn; and it is refused for another Teacher's class.

## 8. Final Known Gaps

1. **Web → MCP, not added by decision:** marking notifications read, and the Teacher transport roster (see §3).
2. **Course material over WhatsApp:** accepted limitation. Only an already-uploaded file can be published; WhatsApp accepts text only.
3. **Live LLM:** not exercised (not required for this phase). The scripted-model path is verified (17/17).

The academic terms list is **not** a gap: `list_academic_years` returns the terms.

## Security (verified)

| Case | Result | Test |
|---|---|---|
| Another school's data | Refused before routing; no MCP call; pupil "not found" | webParity §4 |
| `tenant_id` injection | Refused as other-institution; a model-proposed `tenantId`/`roleKey`/`scope` gains nothing | webParity §4, llmPath §2 |
| Platform-wide requests | Refused outright, both channels, no MCP call | webParity §6, llmPath §1 |
| "Ignore permissions" | Flagged as injection; nothing runs | webParity §4, llmPath §1 |
| "Pretend I am Admin" | Flagged; nothing runs | webParity §4 |
| SQL / database requests | Flagged; nothing runs | webParity §4 |
| Another Teacher's class | Refused by name, nothing disclosed; model proposals refused too | webParity §4, llmPath §2–3 |
| Another student's record | Not disclosed on either channel; a direct id call is refused | webParity §4 |
| Permission revoked between proposal and confirmation | Refused with 403; nothing written; FORBIDDEN audited | webParity §5, llmPath §3 |

## 9. Files Changed

| File | Why |
|---|---|
| `backend/src/modules/ai/agent/intent.js` | `toClassLevel` (skipped for self and pronoun questions), `topRules` tie-break, marks/publish/attendance-correction rule readers, announcement title fix, week timetable, `performsAsked`, `keepsWhatWasNamed` range rules, course vocabulary |
| `backend/src/modules/ai/agent/capabilityResolver.js` | `performsAsked`, operation reading of generic verbs, `actsBy`, stand-in ACTION checks, other-institution/platform detection, week ranges, whole-month rule, self-subject scoring, verb positions, capitalised-name verb, "task" equivalence |
| `backend/src/modules/ai/agent/entityIntent.js` | Subject/student collision, punctuation, catalogue verbs not subjects, dates out of the residual, "share", UPDATE never a creating task, topic "due" clause |
| `backend/src/modules/ai/agent/profileIntent.js` | "course material" isn't a subject; week words are timetable |
| `backend/src/modules/ai/agent/orchestrator.js` | Injection patterns; decline NOT_OFFERED acts whose planned tool isn't held |
| `backend/src/modules/ai/agent/tools.js` | Weekly timetable; `generate_homework` `minScope: 'ALL'` |
| `backend/src/modules/ai/mcp/capabilities.js` | Homework/subject vocabulary; `namesARecord` |
| `backend/src/modules/ai/mcp/tools/academics.js` | `resolveExamPaper`; `enter_marks` / `publish_marks` by name; `create_assignment` prepare; `grade_submission` by name; timetable schema |
| `backend/src/modules/ai/mcp/tools/communication.js` | `create_announcement` to a named class; `update_announcement` `minScope: 'ALL'` |
| `backend/src/modules/ai/mcp/tools/students.js` | A Teacher's unfiltered listing states its scope |
| `backend/src/utils/peopleNames.js` | Function words and material words aren't names |
| `backend/src/utils/dateRanges.js` | "this / next week" |
| `backend/tests/teacher.webParity.test.js` | New: surface, routing, declines, scope, write lifecycles, gaps |
| `backend/tests/teacher.llmPath.test.js` | New: scripted-model path — model routing, hidden tools unreachable, invented identities dropped, confirmation and execution-time re-authorization (17/17) |
| `backend/tests/teacher.announcementUpdate.test.js`, `teacher.askAi.routing.test.js`, `mcp.writes.coverage.test.js`, `agent.bulkAuthorization.test.js` | Obsolete expectations updated for the final decisions (§7) |
| `docs/mcp-tools.json`, `docs/MCP-TOOLS.md` | Regenerated by `scripts/mcp-catalog.js --write` |
| `docs/TEACHER-MCP-AUDIT.md` | This report |

## 10. Integration onto `main` (branch `mcp-fix`)

The Teacher phase was built on uncommitted Student and Admin MCP work, and on other uncommitted hardening work that the MCP layer imports and relies on (medical-audit redaction, tenancy and service fixes, auth/env, signed uploads, the OpenRouter provider). With the owner's agreement, all of that uncommitted work goes into this branch, cut from the latest `origin/main` (`12d2ce2`). That `main` already contained the Study Help commit and has since merged newer Parent/Finance, Librarian and Warden fixes.

**Merge conflicts resolved:**
- `capabilityResolver.js` `dimensionsOf()`: kept `main`'s Librarian title/person logic, reading from `named`.
- `entityIntent.js` word list: both additions kept.
- `.gitignore`: comment kept.
- `frontend/src/app/api/session/{route,refresh/route}.ts`: the hardened local versions kept, plus `main`'s `API_URL` fallback.

**Integration fixes** (found by running the full suite on the merged tree; all generic, none role-specific):

| Failure on the merged tree | Cause | Fix |
|---|---|---|
| Parent "Child exam schedule" → report card | The subject reader read on to a later entity and took "exam" (itself an entity word) as a school subject | A later entity's candidate that is itself an entity word is not a subject; the first entity's reading is unchanged (`capabilityResolver.subjectOf`) |
| Student "Register me for the Robotics elective" lost "Robotics" | `main`'s name reader now trims "the", so "Robotics elective" read as a person | "elective", "activity", "registration" are not name words (`peopleNames`) |
| Teacher announcement to one class: title "A: Science" | `main`'s colon-aware title reader glued the section letter to the text after the colon | The class reference is removed before titles are read (`titleFromText`) |
| Admin "message to Rahul's father" proposal dropped | `main`'s "to X" branch read "Rahul's father saying" as a person | Parent kinship words (father, mother, parent, guardian…) are not name words (`peopleNames`) |
| `uploads.signedAccess` tamper case served (flaky) | The test overwrote the first signature digit with "0", a no-op 1 time in 16 | The test always changes the digit (strengthened, not weakened) |

**Merged-tree results:**
- Full backend: **112/112 files, 2,912/2,912 tests passed** (1,834.6 s).
- Frontend: 21/21 files, 256/256 tests passed; `tsc --noEmit` clean.

A first merged run also saw an in-memory MongoDB start timeout and a CRLF line-ending artefact of the fresh Windows checkout (`studyHelp.skillSync`). Both were environmental and passed on the rerun; the repository content is LF.

**Pre-existing, not addressed:** Librarian "Add the book Clean Code: A Handbook of…" routes to `return_book` on `main` itself; outside this phase.

## 11. Completion Status

**TEACHER PHASE COMPLETE**

| Check | Result |
|---|---|
| Teacher | 223/223 |
| MCP | 929/931, then both `mcp.routing` failures fixed (genuine regression in `toClassLevel`, pronoun follow-ups) and rerun 11/11 |
| Admin | 161/161 |
| Student | 184/184 |
| WhatsApp (includes `teacher.webParity`) | 140/140 |
| Teacher LLM path (scripted model) | 17/17 |
| Full backend | **112/112 files, 2,897/2,897 tests** |
| Teacher capabilities | GET 41, CREATE 3, UPDATE 1, DELETE 1, ACTION 10, **total 56** |
| MCP-only Teacher capabilities | 0 |
| `update_announcement`, `generate_homework` | Unavailable to Teacher (`FORBIDDEN_SCOPE`); retained by Admin and Principal |
| Teacher scope and security | Pass (§ Security) |
| Web/WhatsApp parity | Pass |

## Manual Teacher Ask AI Write/Action Audit

Every Teacher CREATE, UPDATE, DELETE and ACTION capability was driven through the real authenticated route (`POST /ai/agent`, then `POST /ai/agent/confirm`) and through the signed WhatsApp webhook, on an in-memory MongoDB, and followed to the database row and the audit entry. The first pass sent 65 single sentences and 3 conversations through both channels. After the fixes, the same sentences plus 9 conversations and 14 confirm-and-verify runs were repeated. The result is pinned by `tests/teacher.writeAudit.test.js` (83 tests).

### Inventory (Web ↔ MCP)

| Capability | Type | Web route | Required arguments | Entities read from the sentence | Confirmation | Teacher scope | Routing before | Routing now |
|---|---|---|---|---|---|---|---|---|
| `create_assignment` | CREATE | `POST /assignments` | `title`, `dueAt` (the model requires a due date) | class, subject, title, due date | Required | Own subject offerings | Routed, but "I need a bit more" named nothing; `titled "Chapter 3"` → subject "titled", maxMarks 3 | Fixed |
| `create_announcement` | CREATE | `POST /announcements` | `title` | class (audience), words | Required | Own classes | "Announce that …" unrouted; follow-up answer lost | Fixed |
| `create_course_material` | CREATE | `POST /documents` (after `POST /uploads`) | `title`, `fileUrl` | class, title | Required | Own classes | Asks for title and uploaded file | Works (file limitation) |
| `update_course_material` | UPDATE | `PUT /documents/:id` | none (title identifies) | record name, new name, class | Required | Own material | Target not read; rename proposed as "Change nothing" | Fixed |
| `delete_document` | DELETE | `DELETE /documents/:id` | none (title identifies) | record name | Required | Own documents | Only a quoted title worked | Fixed |
| `mark_attendance` | ACTION | `POST /attendance/mark` | a pupil + status, or the whole register | pupil(s), status, class, date | Required | Class teacher (day), own periods | Possessive and preposition forms read the wrong name; "Record/Set …" unrouted; "Mark all present" unreachable | Fixed |
| `bulk_mark_attendance` | ACTION | `POST /attendance/mark/bulk` (CSV) | `sectionId`, `rows` | none | Required | As above | CSV upload | Not by sentence (file); the "Mark all present" button is served by `mark_attendance` |
| `enter_marks` | ACTION | `POST /exams/marks` | paper + marks per pupil | class, subject, exam, pupil(s), marks | Required | Own papers | Only the "Name 41, Name 38" sheet worked | Fixed |
| `publish_marks` | ACTION | `POST /exams/publish` | paper | class, subject, exam | Required | Own papers | Worked | Works |
| `grade_submission` | ACTION | `POST /assignments/grade` | `marks` | pupil, assignment title or subject, marks | Required | Own assignments | Title polluted by the owner's name; "Give Priya 8 marks for her … assignment" unrouted | Fixed |
| `review_leave` | ACTION | `POST /leave/:id/review` | `status` | pupil, decision | Required | Own classes | Worked | Works |
| `decide_registration` | ACTION | `PATCH /registrations/:id/decision` | `status` | pupil, decision | Required | Own electives | Worked | Works |
| `decide_cocurricular` | ACTION | `PATCH /student-requests/cocurricular/:id/decide` | `status` | pupil, decision | Required | Own classes | Worked | Works |
| `decide_profile_edit` | ACTION | `PATCH /student-requests/profile-edits/:id/decide` | `status` | pupil, decision | Required | Own classes | Worked | Works |
| `reply_to_ticket` | ACTION | `POST /tickets/reply` | `body` | ticket headline, reply text | Required | Tickets raised by or assigned to the teacher | No ticket could ever be named (tool bug); reply text mis-read | Fixed |

The Teacher surface is unchanged: **GET 41, CREATE 3, UPDATE 1, DELETE 1, ACTION 10, total 56**. No MCP-only capability was added. Two existing capabilities gained an argument that expresses something the Web screen already does:

- `update_course_material.newTitle`: rename by name. The Web edit form renames.
- `mark_attendance.everyone`: the register screen's "Mark all present", with named exceptions.

### Results through the real Ask AI route

Web and WhatsApp gave the same capability and the same words for every row below (WhatsApp adds only its "Reply YES" footer). "Executed" means confirmed over HTTP, with the database row checked and an `EXECUTED` audit entry with `confirmed: true`.

| Operation | Natural language | Resolved intent | MCP tool | Result | Status |
|---|---|---|---|---|---|
| Attendance | Mark Diya Kumar's attendance as present for today. | pupil Diya Kumar, PRESENT, today | `mark_attendance` | Executed; Diya PRESENT | Fixed |
| Attendance | Mark Diya Kumar's attendance as absent for today. | Diya Kumar, ABSENT, today | `mark_attendance` | Proposed | Fixed |
| Attendance | Mark Rahul Sharma's attendance as present today. | Rahul Sharma, PRESENT | `mark_attendance` | Proposed | Fixed |
| Attendance | Record Rahul Sharma as present today. | Rahul Sharma, PRESENT | `mark_attendance` | Proposed | Fixed (was unrouted) |
| Attendance | Set Rahul Sharma's attendance to present for today. | Rahul Sharma, PRESENT | `mark_attendance` | Proposed | Fixed (was unrouted) |
| Attendance | Mark attendance for Rahul Sharma today. | Rahul Sharma, status missing | `mark_attendance` | "Tell me the status." → "present" → proposed | Fixed |
| Attendance | Mark attendance of Rahul Sharma as present today. | Rahul Sharma, PRESENT | `mark_attendance` | Proposed | Fixed (name was "attendance of Rahul Sharma") |
| Attendance | Correct Rahul Sharma's attendance for 5 August 2026. | Rahul Sharma, 2026-08-05, status missing | `mark_attendance` | Asks the status; with "to present", executed on 5 Aug only | Fixed |
| Attendance | Who is absent today in Class 6-A? | read | `get_attendance_roster` | "1 absent — Rahul Sharma" | Works |
| Attendance | Mark all present in Class 6-A today. | whole register, PRESENT | `mark_attendance` | "everyone (4) → PRESENT" | Fixed (was unreachable) |
| Attendance | Mark everyone in Class 6-A present except Rahul Sharma. | register PRESENT, Rahul ABSENT | `mark_attendance` | Executed; 3 PRESENT, Rahul ABSENT, 6-B untouched | Fixed |
| Announcement | Create an announcement for Class 6-A. | audience 6-A, words missing | `create_announcement` | "Tell me a title." | Works |
| Announcement | Send an announcement to Class 6-A. | audience 6-A | `create_announcement` | "Tell me a title." → answer → proposed | Fixed (answer was lost) |
| Announcement | Announce that tomorrow's Mathematics class starts at 9 AM to Class 6-A. | audience 6-A, words | `create_announcement` | Executed; addressed to 6-A only | Fixed (was misrouted to class marks) |
| Announcement | Create an announcement saying "Unit test is on Friday" for Class 6-A. | 6-A, words | `create_announcement` | Proposed | Works |
| Announcement | Post an announcement to my Class 6-A. | 6-A | `create_announcement` | "Tell me a title." | Works |
| Announcement | Send this announcement to Class 6-A: "Bring your practical file tomorrow." | 6-A, words | `create_announcement` | Proposed | Works |
| Homework | Create Mathematics homework for Class 6-A about fractions. | 6-A, Mathematics, "fractions" | `create_assignment` | "Tell me the due date." | Fixed (named nothing) |
| Homework | Create an assignment for Class 6-A titled "Chapter 3". | 6-A, "Chapter 3" | `create_assignment` | "Tell me the due date." | Fixed (subject "titled", maxMarks 3) |
| Homework | Give Class 6-A an assignment on algebra. | 6-A, "algebra" | `create_assignment` | "Tell me the due date." | Fixed |
| Homework | Create homework for my Science class. | Science | `create_assignment` | "Tell me a title and the due date." | Fixed |
| Homework | Create an assignment. | nothing | `create_assignment` | "Tell me a title and the due date." | Fixed |
| Homework | Create Mathematics homework for Class 6-A about fractions due 2026-10-05. | all | `create_assignment` | Executed | Works |
| Marks | Record marks for Class 6-A Mathematics. | paper by class + subject | `enter_marks` | "Whose marks, and how many?" → "Rahul Sharma 44" → proposed | Fixed (answer was lost) |
| Marks | Enter marks for Rahul Sharma. | pupil Rahul Sharma | `enter_marks` | "Tell me the marks." | Fixed (subject was "Rahul") |
| Marks | Give Rahul Sharma 8 marks in Mathematics. | Rahul Sharma 8, Mathematics | `enter_marks` | Proposed; with 44, executed as DRAFT | Fixed |
| Marks | Record Rahul Sharma's Mathematics marks. | Rahul Sharma, Mathematics | `enter_marks` | "Tell me the marks." | Fixed |
| Marks | Update Rahul Sharma's Mathematics marks. | as above (re-entering updates) | `enter_marks` | "Tell me the marks." → "45" → proposed | Fixed |
| Marks | Publish Mathematics marks for Class 6-A. | paper | `publish_marks` | Executed; marks PUBLISHED | Works |
| Grading | Grade Priya's submission. | Priya | `grade_submission` | "Tell me the marks." | Fixed (named nothing) |
| Grading | Grade Priya Verma's Mathematics submission. | Priya Verma, Mathematics | `grade_submission` | "Tell me the marks." | Fixed (title "Priya Verma's Mathematics") |
| Grading | Grade Priya's assignment. | Priya | `grade_submission` | "Tell me the marks." | Fixed |
| Grading | Give Priya 8 marks for her Mathematics assignment. | Priya, Mathematics, 8 | `grade_submission` | Executed; GRADED, 8 | Fixed (was unrouted) |
| Material | Add a Mathematics course material. | — | `create_course_material` | "Tell me a title and the uploaded file." | Works (limitation) |
| Material | Upload course material for Class 6-A. | 6-A | `create_course_material` | same | Works (limitation) |
| Material | Add this material to Mathematics. | — | `create_course_material` | same | Works (limitation) |
| Update | Update the course material Fractions notes. | record "Fractions notes" | `update_course_material` | "What should change: its title, its file or its class?" | Fixed (was "Which document?") |
| Update | Change the title of the course material 'Fractions notes' to 'Fractions notes v2'. | rename | `update_course_material` | "Rename … to …" | Fixed (was "Change nothing") |
| Update | Rename course material Fractions notes to Fraction basics. | rename | `update_course_material` | Executed; title changed | Fixed (was unrouted) |
| Update | Modify the course material Fractions notes for Class 6-A. | record + class | `update_course_material` | "Change class on …" | Fixed |
| Update | Edit the course material Fractions notes. | record | `update_course_material` | asks what should change | Fixed |
| Delete | Delete the course material Test notes. | record "Test notes" | `delete_document` | Executed; removed | Fixed (quoted only before) |
| Delete | Delete the test record. | nothing identifiable | — | "I'm not sure what you need." Nothing is deleted | Works (refuses to guess) |
| Delete | Delete the test assignment. | not offered | — | "You can't delete homework here" (no MCP call) | Works |
| Action | Approve Rahul Sharma's leave. | Rahul, APPROVED | `review_leave` | Executed | Works |
| Action | Reject Rahul's leave application. | Rahul, REJECTED | `review_leave` | Proposed | Works |
| Action | Approve Priya Verma's elective registration. | Priya, APPROVED | `decide_registration` | Executed | Works |
| Action | Approve Priya Verma's co-curricular request. | Priya, APPROVED | `decide_cocurricular` | Executed | Works |
| Action | Approve Priya Verma's profile edit request. | Priya, APPROVED | `decide_profile_edit` | Executed; address written | Works |
| Action | Reply to the Bus timing ticket: We will check the bus schedule. | ticket "Bus timing", body | `reply_to_ticket` | Executed; message posted, ticket OPEN | Fixed (tool bug) |
| Action | Reply to the ticket about bus timing saying we will check. | ticket, body "we will check" | `reply_to_ticket` | Proposed | Fixed |
| Refusal | Edit my previous announcement. | not offered | — | "You can't edit an announcement here" (no MCP call) | Fixed (reached the server; reply was a scope error) |
| Refusal | Update an unsupported request. | nothing | — | "I'm not sure what you need." | Works |
| Refusal | Create a calendar event for sports day on 10 October 2026. | not offered | — | "You can't create the calendar here" | Works |
| Refusal | Generate AI homework using generate_homework. | not offered | — | "You can't generate homework here" (no MCP call) | Fixed (reached the server) |
| Refusal | Delete all assignments. / Delete all students. | not offered | — | "can't delete homework" / "can't delete a student" | Works |
| Refusal | Modify another Teacher's records. | nothing | — | "I'm not sure what you need." | Works |
| Refusal | Deleting or updating homework | not offered | — | "You can't delete homework here" | Fixed (said "can't deleting") |

### Conversations (Part 12)

Each conversation was checked on the website (with the transcript the web client sends) and on WhatsApp (with its stored transcript).

| Conversation | Turns | Result | Status |
|---|---|---|---|
| A | "Create Mathematics homework for Class 6-A." → "Fractions and decimals." → "5 October 2026" → Yes | Asks for the title and due date, then the due date, then proposes; confirmed, written | Fixed |
| B | "Send an announcement to Class 6-A." → "Bring your practical file tomorrow." → Yes | Proposed to 6-A only; confirmed, written | Fixed |
| C | "Mark Rahul Sharma present today." → "Yes" (WhatsApp) | Written and audited | Works |
| D | Proposal, then `announcements.publish` withdrawn, then yes | 403; nothing written; FORBIDDEN audited | Works |
| Chain | "Create an assignment." → "Mathematics for Class 6-A" → "Algebra basics" → "2026-10-09" | Proposed on both channels | Fixed (WhatsApp needed the history fix) |
| Follow-ups | status "present", sheet "Rahul Sharma 44", number "45", grade "9" | Each finishes the open request | Fixed |
| Topic change | "Create an announcement for Class 6-A." → "Show my timetable for today." | Answered as a new question; nothing written | Works |

The Web requires a due date for an assignment (`Assignment.dueAt` is `required`), so the assistant asks for it. It does not invent one.

### Summary

| | Count |
|---|---|
| Teacher write/action capabilities tested | **15** (3 CREATE, 1 UPDATE, 1 DELETE, 10 ACTION) |
| Working through natural language now | **14** |
| Of those, working before this audit | 5 (`publish_marks`, `review_leave`, `decide_registration`, `decide_cocurricular`, `decide_profile_edit`) |
| Fixed in this audit | 8 (`mark_attendance`, `enter_marks`, `create_assignment`, `grade_submission`, `create_announcement`, `update_course_material`, `delete_document`, `reply_to_ticket`) |
| Working with a documented limitation | 1 (`create_course_material`: the file must already be uploaded) |
| Intentionally not reachable by a sentence | 1 (`bulk_mark_attendance`: the Web's counterpart is a CSV upload. Its "Mark all present" button is served by `mark_attendance`) |
| Unsupported writes still refused | edit announcement, `generate_homework`, calendar create, delete homework, delete students, homework update |

### Root causes and fixes

All fixes are in shared readers, the orchestrator or MCP tools. There is no Teacher-specific branch and no rule for one sentence.

| # | Symptom | Category | Root cause | Fix |
|---|---|---|---|---|
| 1 | "Diya Kumar's attendance" and "attendance of Rahul Sharma" read as names | C, D | The attendance rule kept a private name regex instead of the shared reader | The rule now uses `nameFromText(withoutLeadingVerb(…))`. `peopleNames` trims binding words ("as", "to", "today") from either end of a name, and a leading "of"/"for" |
| 2 | "Record / Set … present", "Correct …'s attendance" unrouted | A, B | The rule knew only "mark" and required a status on corrections | Register-writing verbs generalised. A correction without a status routes and asks for it |
| 3 | One pupil in a marks or attendance sentence lost | C, D, F, J | `readMarksHead` and the entity tier read the subject before the person ("marks for Rahul" → subject Rahul). Entity-tier steps never received the rule's arguments | Identity first, then subject (the order `dimensionsOf` already uses). Rule arguments fill entity-tier steps as they do catalogue steps |
| 4 | "Give Priya 8 marks for her … assignment" | A, B, D | A quantity of marks was read as the marks entity. The pronoun guard skipped the catalogue even though the sentence named Priya | The entity tier yields when marks are *given*. The pronoun guard applies only when nobody is named. "give/award <name> <n> marks" read as a person |
| 5 | Grading title "Priya Verma's Mathematics" | G | The title reader included the owner's possessive | The owner's possessive is removed before reading a title |
| 6 | `titled "Chapter 3"` → subject "titled", maxMarks 3 | F, C | Name-introducers were read as subjects. Numbers inside quotes were read as values | "titled/called/named" and pronouns are not subjects. Non-text kinds are read from outside quotes |
| 7 | "I need a bit more to do that." with nothing named | O | No everyday phrase for `dueAt`, `marks`, `fileUrl`. List-item errors (`students[0]: status is required`) were not parsed | Phrases added. Item errors are asked for by the field's own name |
| 8 | "Announce that … to Class 6-A" | A, H | Only the noun "announcement" was recognised. A trailing class address would have entered the text | The verb "announce" is recognised. The addressed class is trimmed from the words (it is the audience) |
| 9 | Course material target not read; rename proposed as "Change nothing" | G, P, N | A record named after its noun was not read. `title` both identifies and renames, so a rename by name was inexpressible. No-op proposals were allowed | `recordNamedAfterNoun`, `renameFromText` and the `newTitle` argument. A proposal that changes nothing asks what should change |
| 10 | No ticket could be named | N | `resolveTicket` read the service's `{ticket, messageCount}` rows as tickets | Rows unwrapped. Ticket named before/after its noun. "saying …" preferred over "about …" for the body |
| 11 | Answers to missing-detail questions lost (both channels) | O | With no model, a follow-up was parsed as a new request | `continuedWrite()`: replays the caller's own earlier turns, keeps a write open only while the assistant's reply asked a question, and merges the answer by the same readers. The result is still validated, authorized, confirmed and re-authorized |
| 12 | WhatsApp forgot a request the website remembered | O | WhatsApp history held 6 messages (including the current one); the website holds 10 | `WHATSAPP_HISTORY_TURNS` defaults to 10 (still overridable). WhatsApp's copy of the current message is not treated as an earlier turn |
| 13 | "Edit my announcement", "generate_homework" reached the server | B, J | The opening verb "edit" matched the noun of `decide_profile_edit`. A named catalogue tool not offered to the caller was not declined | The opening verb is not a noun. A catalogue name the caller isn't offered is NOT_OFFERED |
| 14 | "You can't deleting homework" | O | The refusal repeated the inflected verb | Base form from the catalogue's verbs |
| 15 | "Mark all present" unreachable; "Mark the whole class present" → exam marks | P, J, F | The register screen's bulk fill had no expression. "whole" was read as a subject | `mark_attendance.everyone` (an object, so no generic reader can set it from a status word). "whole/entire" are not subjects |

### Security (re-verified)

- Every write is still proposed → confirmed → re-authorized → audited.
- Withdrawing the permission between the proposal and "yes" gives a 403, writes nothing, and records a FORBIDDEN audit entry (test §4).
- The whole-register write uses the same roster the Web loads (`getRoster`, which checks class access) and the same `markAttendance` service rule. Class 6-B was untouched.
- A follow-up merges only the caller's own words. An assistant turn is only checked for whether it asked a question, and never supplies a value (test §5).
- Declined acts make no MCP call on either channel (test §6).

### Remaining gaps

1. `create_course_material` needs a file already uploaded. A chat message can't carry a file, and WhatsApp accepts text only. This is the documented limitation.
2. `bulk_mark_attendance` (CSV) is not reachable by a sentence, by design. "Mark all present … except …" covers the Web's in-screen bulk action.
3. Phrasings still missed: "Mark all **students** in Class 6-A absent except …" is read as a student search (a read; nothing is written).
4. Web ↔ MCP gaps not added, unchanged from §3: marking notifications read, and the Teacher transport roster.
5. **Pre-existing test flake:** `teacher.classQueries` §3 compares the fixture's local "today" with the tool's UTC "today". It fails between 00:00 and 05:30 IST and passes otherwise (verified with `TZ=UTC`). It is not caused by this audit and was not changed.

### Files changed (this audit)

| File | Why |
|---|---|
| `backend/src/utils/peopleNames.js` | Binding words trimmed from names; "give <name> <n> marks" |
| `backend/src/modules/ai/agent/intent.js` | Attendance rule on the shared reader, verbs, whole register; `readMarksHead`; announce verb/text; entity tier (verb past, marks given, rule arguments); pronoun guard; `continuedWrite` |
| `backend/src/modules/ai/agent/capabilityResolver.js` | Record-after-noun, rename, ticket naming, owner out of titles, quoted numbers, NOT_OFFERED noun/verb collision, named tools not offered, base verbs |
| `backend/src/modules/ai/agent/entityIntent.js` | Identity before subject; non-subjects (titled, pronouns, whole); rename verbs |
| `backend/src/modules/ai/agent/argumentKinds.js` | "saying …" before "about …" |
| `backend/src/modules/ai/agent/orchestrator.js` | Missing-field phrases, list-item errors |
| `backend/src/modules/ai/mcp/tools/attendance.js` | `mark_attendance.everyone` |
| `backend/src/modules/ai/mcp/tools/analytics.js` | `update_course_material.newTitle`; no-op refusal |
| `backend/src/modules/ai/mcp/tools/welfare.js` | `resolveTicket` row shape |
| `backend/src/config/env.js`, `backend/src/modules/whatsapp/whatsapp.session.js`, `backend/.env.example` | WhatsApp history window 10 |
| `backend/tests/teacher.writeAudit.test.js` | New, 83 tests |
| `docs/mcp-tools.json`, `docs/MCP-TOOLS.md` | Regenerated for the two new arguments |
| `docs/TEACHER-MCP-AUDIT.md` | This section |

### Test results (this audit)

Each suite was run on its own, one process at a time, on an in-memory MongoDB with no `.env` loaded. The runs used `TZ=UTC` because they happened between 00:00 and 05:30 IST (see remaining gap 5); that makes them equivalent to a daytime run.

| Suite | Files | Passed | Failed | Duration |
|---|---|---|---|---|
| Teacher (7 files, incl. `teacher.llmPath` and the new `teacher.writeAudit`) | 7 | 323 | 0 | 337.0 s |
| MCP (`mcp.*` excluding admin/student) | 30 | 931 | 0 | 827.7 s |
| Admin | 6 | 161 | 0 | 103.4 s |
| Student | 5 | 184 | 0 | 163.0 s |
| WhatsApp | 5 | 140 | 0 | 152.0 s |
| Full backend (`npx vitest run`) | 113 | 2,979 | 1 | 34,911 s wall clock (host suspended; see below) |
| `mcp.adminScenarios.channels` rerun alone | 1 | 13 | 0 | 34.2 s |

The first Teacher run, without `TZ=UTC` at 00:55 IST, also failed 3 tests:
- 2 were the clock flake in `teacher.classQueries`. They passed 37/37 under `TZ=UTC`.
- 1 was a genuine regression from this audit. "Publish marks for Mathematics" read Mathematics as a pupil in `readMarksHead`. It was fixed by keeping the existing rule that a name equal to the subject word is the subject.

**The one full-run failure was a timeout, not an assertion.** `mcp.adminScenarios.channels` › "7 — Mark test_Stud present…" hit `Test timed out in 240000ms`, with a recorded test time of 32,890 s. The whole run took 9.7 h against about 1 h normally, which means the host was suspended during that test. The same file passed in the Admin run (161/161) and the WhatsApp run (140/140) earlier, and 13/13 when rerun alone. The full suite was not rerun end to end after this.

`teacher.classQueries` was also rerun in daytime IST without `TZ=UTC`: 37/37.

**Final full backend run (end to end, the laptop kept awake, nothing else running, no `.env`, in-memory MongoDB):** `npx vitest run` with no TZ override, started 12:37 IST on 29 Sep 2026: **113/113 files, 2,980/2,980 tests passed, 0 failed, 4,153.7 s.** This supersedes the sleep-affected run above.

**Totals:** 113 files (112 + `teacher.writeAudit`). 2,980 tests: 2,897 baseline + 83 new. All passed.


### Integration onto `mcp-fix` (merged-tree validation)

The audit was developed on a tree cut before `main`'s newer Parent/Finance, Librarian and Warden fixes. It was applied to `mcp-fix` (PR #31, `d60536f`) as a three-way merge of only this audit's changes. Main's newer code was kept in full, and only the lines this audit deliberately replaces were removed:

- `entityIntent.js` and `peopleNames.js`: main's word lists (kinship, facility, elective, preposition and policy words; `'child' … 'timetable'`) restored next to the audit's additions (`BINDING_WORDS`, "titled/called/named", pronouns, "whole/entire"). Main's "to <name>" and "<name> bed/room" readers are kept, with the audit's binding-word trimming applied to them.
- `capabilityResolver.js`:
  - Restored: main's class-reference stripping in `titleFromText`, the multi-entity `subjectOf` loop (the Robotics elective), and the Librarian `personFromTitle`/`title` reading.
  - Combined with the audit's rename, owner-possessive and record-after-noun readings.
- **Regression found only on the merged tree, fixed:** "Give Rahul Sharma 8 marks in Mathematics" proposed **publishing** marks. Main's Librarian rule treated the capitalised name as a possible book title unless grammar marked it as a person. "A number of marks given to someone" is now part of that grammar, the same evidence `nameFromText()` uses. It now resolves to `enter_marks` with Rahul Sharma, 8.

**Merged-tree full backend:** `npx vitest run` on the `mcp-fix` worktree. The laptop was kept awake, no other test processes ran, no `.env` was loaded, and the database was in-memory. **113/113 files, 2,995/2,995 tests passed, 0 failed, 1,427.1 s.** This includes `teacher.writeAudit` 83/83.

The previous attempt on this tree produced no result: the in-memory MongoDB could not start under critically low memory (Windows code `0xC0000142`), and the run was stopped. The first completed run on this tree had 2,994/2,995 passing. The one failure was `studyHelp.skillSync` "byte-for-byte UNIVERSAL_SYSTEM_PROMPT.txt": the fresh worktree checkout (`core.autocrlf=true`) wrote that `.txt` with CRLF endings, while the repository content is LF. Re-checking it out with LF gave 5/5, and the confirming full run above is green. That failure was unrelated to this audit and nothing was changed to work around it.

**Write audit:** 14 of 15 Teacher write capabilities reachable through natural language. The one intentionally not reachable is `bulk_mark_attendance`: its Web counterpart is a CSV upload, and the Web's "Mark all present" button is served by `mark_attendance`.
