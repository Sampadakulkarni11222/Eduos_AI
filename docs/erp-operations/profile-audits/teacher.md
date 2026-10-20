# Profile audit: Teacher

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/teacher`, demo login
`teacher@schoolerp.com`. Roles considered: class teacher, subject teacher across several sections, coordinator / head of
department (reads and comments), substitute, lab-in-charge and a teacher in their first year.

## 1. The role in an Indian school

### Who a teacher answers to
Subject teacher → head of department / academic coordinator → vice-principal or headmistress → principal. The class
teacher also answers to parents for their class and is the school's first point of contact for each child.

### The day
| When | What |
|---|---|
| Before assembly | Sign in (staff attendance), check the substitution ("arrangement") board, collect the day's register. |
| Period 1 (class teacher) | Attendance for the class (absentee-first), diary/almanac notes, notices and circulars to children. |
| Each period | Teach to the lesson plan; note what was covered; set and collect homework; maintain discipline. |
| Free periods | Correct notebooks and test papers, prepare the next lesson, take an arrangement period for an absent colleague. |
| Breaks | Corridor / lunch / bus duty on the duty roster. |
| After school | Parent calls and messages, club or lab duty, records (marks, syllabus register), next day's plan. |

### The week and the term
- Weekly lesson plan (many schools ask for it on Saturday for the coming week) and the syllabus register checked by the
  coordinator; notebook correction cycle; one or two class tests.
- Periodic tests (PT 1–3), half-yearly and annual exams: set papers to a blueprint, invigilate, evaluate, enter marks by
  the deadline, moderate with the HOD.
- CBSE internal assessment (Classes 9–10: 20 marks per subject — periodic assessment, multiple assessment, portfolio,
  subject enrichment, with 33% needed separately in internal and external); at least half of a paper competency-based
  (case-, source- and assertion-reason questions); NEP practices: experiential, art-, sports- and toy-based pedagogy.
- Report cards each term: marks, co-scholastic grades (work, art, health and PE), discipline, class-teacher remarks;
  PTM after each.
- At least 50 hours of CPD a year (CBSE, since 2025: 25 external through CBSE / government institutes, 25 in-house or
  school-complex; spread over the NPST areas: core values 12, knowledge and practice 24, professional growth 14).

### Reports a teacher owes
Daily attendance; syllabus/lesson register; lesson plans; marks lists by deadline; internal-assessment records;
report-card remarks; PTM notes; leave applications; CPD record; lab stock and incident registers (lab-in-charge).

### Pain points
Paperwork that duplicates itself (lesson plan, syllabus register, homework diary, marks register); setting balanced
papers by hand; chasing CPD certificates at inspection time; being the person who absorbs arrangement periods; a new
teacher not knowing the school's formats.

Sources: CBSE circulars on CPD (Academic 32/2021; TRG-2 and TRG-3/2025 as reported by Careers360 and Gulf News), school
assessment plans published for 2026-27 (e.g. St Xavier's Delhi Class 9), Careers360 and MTG summaries of the competency
share; vendor pages listed in section 2.

## 2. Competitors

| Capability | Fedena | Entab CampusCare | Teachmint | Toddle | Google Classroom / Schoology | PowerSchool / Veracross | EduOS before | EduOS now |
|---|---|---|---|---|---|---|---|---|
| Attendance (list, flashcards, OCR) | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Homework with submissions and grading | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Syllabus tracker per class | partial | ✓ | partial | ✓ (units) | — | partial | ✓ | ✓ (class teacher now sees every subject of the class) |
| Lesson plans | ✓ (template) | ✓ | ✓ (AI) | ✓ (AI, templates) | — | partial | free-text AI draft only | ✓ structured, 5E, NEP pedagogy, suggestion from syllabus + bank, copy to sections, taught → syllabus + homework, coordinator feedback |
| Question bank / paper builder | add-on | ✓ | ✓ (AI) | ✓ | quiz only | partial | quizzes only | ✓ shared bank, blueprint builder, competency/Bloom/chapter checks, print with/without answers, MCQs → quiz |
| CBSE term report cards with co-scholastic | ✓ | ✓ | ✓ | ✓ | — | n/a | ✓ | ✓ (+ assistant can enter notebook / SEA and co-scholastic grades) |
| Comment bank / AI remarks | — | — | ✓ | ✓ | — | ✓ | ✓ AI draft | ✓ |
| Staff leave + substitution | ✓ | ✓ | partial | — | — | ✓ | ✓ | ✓ |
| CPD / professional development log | — | partial | — | ✓ (PD) | — | ✓ (Veracross PD) | — (training register only) | ✓ 50-hour reference, external / in-house, NPST areas, trainings counted, HR verifies |
| PTM booking | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Assistant that acts (draft → confirm) | — | — | limited | limited | — | — | 134 teacher tools | 149 teacher tools (134 + 15 here; other part-4 audits add more) |

Gaps that remain against the field (section 6): invigilation / duty roster beyond bus duty; IA portfolio evidence per
pupil; offline mobile marking.

## 3. Hands-on test (findings)

### 3a. What was exercised
All 51 teacher sidebar pages at 1440×900 and 390×844 on the shared demo (committed code), screenshots in the
scratchpad folder p4-teacher. Two attempts to run a private seeded copy (own API port, in-memory database) for the new
screens failed for lack of memory on the shared machine, so the new screens were checked through component tests that
render them against API-shaped data (frontend/tests/p4-teacher-views.test.tsx), the service and MCP suites, and the
demo-completeness test (which seeds the whole demo school, including this audit's sample data, and reads the new
endpoints as the demo teacher).

 Earlier audit findings (14 Oct) that are now fixed in code and were re-checked:
attendance date window and regularisation; assignment validation, edit and withdraw; AB/ML absence codes and a
completeness check before publishing marks; report-card moderation; staff leave with balances and cover.

Findings in this audit:

| # | Finding | Status |
|---|---|---|
| T4-1 | Navigation: about 15 operations groups were inserted above TEACHING, so Attendance, Assignments and Exams sat below the fold. | Fixed: for the teacher portal the operations groups now follow TEACHING (`frontend/src/lib/portals.ts`). |
| T4-2 | A class teacher could not see the syllabus coverage of the other subjects of their own class (filter was `teacherId` only), though they own the class's report card and PTM. | Fixed: read-only view of every subject of their class (`syllabus.service.js` readableOfferingFilter); managing stays with the subject teacher. Tested. |
| T4-3 | No lesson plans: the only "plan" was a free-text AI draft, unconnected to the syllabus or homework. Homework written in the syllabus log never became an assignment. | Built (section 4). |
| T4-4 | No question bank or paper builder; nothing checked a paper's competency share. | Built (section 4). |
| T4-5 | No CPD record although CBSE requires 50 hours a year and inspection asks for it. | Built (section 4). |
| T4-7 | Exams page had no class-level result for a paper (only one student at a time). | Built: class result panel with CBSE bands and a suggested remedial group. |
| T4-8 | The dashboard did not show the day's lesson plans or lessons left unmarked. | Built: "Lesson plans today" list on the teacher dashboard. |
| T4-9 | Phone attendance list: each pupil a ~170px card with 34×22px buttons (60 pupils ≈ 10,000px of scrolling; under touch-target size). Seen again in this sweep (`teacher-m-attendance.png`). | Fixed: one line per pupil with 40px buttons under 768px (`operations.css`, `att-roster` class on the table). |
| T4-10 | Syllabus page footnote explained an "Average result" column the teacher view does not have. | Fixed: that sentence shows only where the column does (school-wide view). |
| T4-6 | The assistant could not plan a syllabus module, draft a quiz, or enter notebook / subject-enrichment marks and co-scholastic grades, all of which the teacher does on screen. | Built: 17 tools (section 5). |

## 4. What was built

### Lesson plans (`/teacher/lesson-plans`, principal read + feedback)
- Model `LessonPlan` (`backend/src/models/teaching.model.js`); service `backend/src/modules/teaching/lessonPlans.service.js`.
- Week view grouped by day; tiles: plans, taught, ready, past-not-marked-taught, with a competency check.
- Editor: class/subject, date, period, minutes, objectives, NEP pedagogy chips, 5E steps with minutes (warns when steps
  and lesson length differ), TLM, differentiation, competency-based check, assessment, homework, Draft/Ready.
- "Suggest from my syllabus plan": next untaught topics of the current module, the subject's usual pedagogies, minutes
  split 1:2:2:2:1, and a real competency-based question from the bank for that chapter. Shows what it was built from.
  Never saved by itself.
- Mark taught: reflection; ticks the planned topics through `syllabus.recordProgress` (same date rules); optionally sets
  the homework as a real assignment with a due date.
- Copy to another section of the same subject (topics matched to that class's module of the same name).
- Principal / coordinator (`syllabus.manage` ALL): read every plan, add feedback; feedback never changes the plan.

### Question bank and papers (`/teacher/question-bank`, principal too)
- Models `BankQuestion`, `QuestionPaper`; service `questionBank.service.js`.
- Bank shared per subject and grade among the teachers of it; author edits; answers staff-only.
- Types MCQ, assertion-reason, VSA, SA, LA, case-based, source-based, map/diagram; Bloom level; difficulty;
  competency-based inferred (case/source/AR, or apply-and-above) and overridable.
- Build from blueprint (type × count × marks, chapters, target marks, competency target default 50%): prefers least-used
  questions, spreads chapters, leans to competency questions until the target is met, reports shortfalls, never pads.
- Checks: total vs target, competency share, repeats, empty sections, a chapter over 40%, no higher-order question.
- Print paper / print with answers; make final (locks it, counts each question's use); MCQs → a draft quiz.

### CPD hours (`/teacher/cpd-hours`, principal and HR too)
- Model `CpdEntry`; service `cpd.service.js`.
- Year = current academic year. Total vs 50, external vs 25, in-house vs 25, NPST areas vs 12/24/14; flags an all-online
  year. Attended, completed in-house trainings from the trainings register count automatically.
- HR / principal: all-staff table (furthest behind first) and a verification queue; nobody verifies their own entry;
  a verified entry cannot be deleted.

### Class result analysis (Exams & Performance page)
- `GET /teaching/paper-results?examSubjectId=` (`paperResults.service.js`), shown under Marks entry once any mark is
  entered: marked / absent / medical / pending, average, highest, lowest, share at or above 33%, the CBSE eight-point
  grade spread, and the pupils below 33% as a suggested remedial group. Same ownership check as the marks grid.
  Closes the earlier finding that the teacher had no class-level view of a paper (only per-student lookups).

### Teacher dashboard
- New list "Lesson plans today" in the teacher's own dashboard (`insights/dashboards.service.js`): today's plans with
  their status and a to-do line for past lessons not yet marked taught.

### API
`/api/v1/teaching/…` (`backend/src/modules/teaching/teaching.routes.js`): lesson-plans (list, suggest, create, get,
patch, delete, copy, taught, feedback), question-bank (scopes, list, add, patch, archive), papers (list, create, build,
to-quiz, get, patch, final, delete), cpd (mine, add, delete, overview, verify). Plans and bank need `syllabus.manage`
(parents and students hold only `syllabus.read`); CPD needs `staffleave.apply` or `staffleave.manage`.

### Sample data
`backend/src/seed/seed_p4_teacher.js`: the demo teacher's week of plans (taught with reflections, ready, one past plan
left unmarked, one with the principal's feedback), about 48 bank questions over two subjects from the syllabus module
chapters with a draft periodic-test paper each, CPD entries for the teacher (one verified) and five colleagues.

## 5. Assistant coverage

Teacher tools before: 134. Added in `backend/src/modules/ai/mcp/tools/p4Teacher.js` (17 tools; 15 visible to a teacher):

| Tool | Op | Who |
|---|---|---|
| list_lesson_plans | GET | teacher (own), principal/admin (all) |
| get_lesson_plan_suggestion | GET (nothing saved) | teacher |
| save_lesson_plan | CREATE, confirm | teacher |
| mark_lesson_taught | ACTION, confirm | teacher |
| add_lesson_plan_feedback | ACTION, confirm, web only | principal / admin |
| search_question_bank | GET | teacher |
| add_bank_question | CREATE, confirm | teacher |
| build_question_paper | CREATE, confirm (draft only) | teacher |
| check_question_paper | GET | teacher |
| make_quiz_from_paper | CREATE, confirm (quiz stays draft) | teacher |
| create_quiz_draft | CREATE, confirm (quiz stays draft) | teacher |
| plan_syllabus_module | CREATE, confirm | teacher |
| get_my_cpd_hours | GET | all staff |
| log_cpd_hours | CREATE, confirm | all staff |
| list_staff_cpd_hours | GET | HR / principal / admin |
| save_report_card_component_marks | UPDATE, confirm, web only | subject teacher |
| save_co_scholastic_grades | UPDATE, confirm, web only | class teacher |

Nothing here publishes, approves or decides: publishing a quiz, making a paper final, approving a report card and
verifying CPD hours stay on their screens. Tests: `backend/tests/mcp.p4Teacher.test.js` (contract, visibility per role,
draft → confirm, refusals for another teacher's class or subject, the HR-only overview).

Screen actions still without a tool (by design): publishing marks or quizzes, report-card moderation, student-leave and
registration decisions (human decisions, see `decisions.js`).

## 6. Tests
- backend/tests/teaching.p4.test.js (10): plans (suggest, save, taught → syllabus + assignment, copy, feedback, refusals), bank and papers (validation, scope, blueprint build, checks, final, to-quiz), pure paper analysis, CPD (trainings counted, gaps, verify by someone else), class-teacher syllabus read, paper results.
- backend/tests/mcp.p4Teacher.test.js (9): contract, visibility per role, draft → confirm flows, refusals, report-card component and co-scholastic entry, principal feedback.
- backend/tests/syllabus.modules.test.js: expectation updated (the class teacher now also sees the class's other subjects, read-only).
- backend/tests/demo.completeness.test.js: the demo teacher now also must see lesson plans, a bank, a paper and CPD hours (passes).
- frontend/tests/p4-teacher-views.test.tsx (5).
- Pinned counts not edited (lead reconciles): tests/mcp.catalog.test.js (from this audit: teacher +15, principal +15, admin +17, HR +3, finance / librarian / warden +2 each for their own CPD hours; parents and students +0), tests/teacher.writeAudit.test.js (teacher writes grow by 10: save_lesson_plan, mark_lesson_taught, add_bank_question, build_question_paper, make_quiz_from_paper, create_quiz_draft, plan_syllabus_module, log_cpd_hours, save_report_card_component_marks, save_co_scholastic_grades).

## 7. What remains, and why

- Invigilation / duty roster beyond bus duty: needs the exam timetable and a staff-availability model shared with
  cover; better done with the exam-office profile.
- IA evidence per pupil (portfolio, multiple assessment) stored with marks: the report-card template already supports
  manual components; a per-pupil evidence upload is a follow-up.
- An LLM-written lesson plan narrative: the structured suggestion is deterministic and evidence-backed; the free-text AI
  draft (`ai-drafts`, kind LESSON_PLAN) remains for those who want prose.
- Offline marking on the phone: a PWA/offline concern for the whole app, not this profile.
