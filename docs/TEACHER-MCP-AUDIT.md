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

Nothing has been committed or pushed.
