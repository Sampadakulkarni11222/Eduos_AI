# EduOS Repository Audit — MCP Capability Inventory

Audit date: 2026-09-09 · Branch: `final-issues`
Scope: `backend/src` (34 modules, 246 HTTP routes, 33 models, 71 permissions, 9 system roles) and `frontend/src/app` (9 role portals).

This document is the **source of truth** for the MCP tool catalog. Every tool in
`backend/src/modules/ai/mcp/tools/` traces to a row here, and nothing was
implemented that this audit could not find a real service for.

---

## A. User profiles / roles

Roles are **DB-backed and runtime-extensible** (`roles` collection,
`/api/v1/roles`, permission `roles.manage`). `src/constants/permissions.js`
seeds nine system roles; custom roles are real and must work. Authorization is
`permission key → scope`, where scope is `ALL` (whole school) or `OWN` (own
record / own children / own classes).

| Role key | Name | Grants | Shape | Portal |
|---|---|---|---|---|
| `SUPER_ADMIN` | Super Admin | 71 | all ALL | `/super-admin` |
| `ADMIN` | Administrator | 67 | all ALL | `/[school]/admin` |
| `PRINCIPAL` | Principal | 32 | all ALL | `/[school]/principal` |
| `TEACHER` | Teacher | 28 | 3 ALL / 25 OWN | `/[school]/teacher` |
| `STUDENT` | Student | 22 | 2 ALL / 20 OWN | `/[school]/student` |
| `PARENT` | Parent | 18 | 2 ALL / 16 OWN | `/[school]/parent` |
| `FINANCE` | Finance | 12 | all ALL | `/[school]/finance` |
| `WARDEN` | Warden | 11 | all ALL | `/[school]/warden` |
| `LIBRARIAN` | Librarian | 9 | all ALL | `/[school]/librarian` |

Identity plumbing: `middleware/auth.js` builds `req.actor`
(`accountId, profileId, roleKey, permissions{}, tenantId`);
`middleware/permission.js` sets `req.scope`. WhatsApp mirrors that shape in
`whatsapp.agent.js:resolveActorByPhone()` from the Meta-verified phone number.

**No HR, payroll, staff-employment or inventory role exists.** "Staff" is a
view (`principal/staff`), not a role.

## B. Modules (34)

`academics` `admissions` `ai` `announcements` `assignments` `attendance`
`audit` `auth` `calendar` `dashboard` `documents` `exams` `fees` `growth`
`hostel` `leave` `library` `medical` `notifications` `observability`
`permissions` `profiles` `registrations` `risk` `roles` `schools`
`studentRequests` `students` `tickets` `timetable` `transport` `uploads`
`users` `whatsapp`

**Absent despite common assumption:** HR, Payroll, Inventory, Events (calendar
only), Certificates, Courses (modelled as Subjects + SubjectOfferings), Email
delivery, standalone Reports/Analytics (analytics = `dashboard` + `risk` +
`growth`).

## C + D. Operation inventory with implementing service

### Students & enrollment — `students.read` / `students.manage` / `enrollments.manage`

| Op | Capability | Service |
|---|---|---|
| GET | list/search students (paged) | `student.service.list()` |
| GET | student record (PII, audited) | `getById()` |
| GET | full overview | `getOverview()` |
| GET | guardians / ID card / next roll no | `listGuardians()` `getIdCardData()` `nextRollNo()` |
| GET | enrollments | `listEnrollments()` |
| CREATE | student | `create()` |
| CREATE | enroll / bulk enroll | `enroll()` `bulkEnroll()` |
| CREATE | link guardian | `addGuardian()` |
| UPDATE | student fields | `update()` ⚠️ unbounded |
| UPDATE | enrollment status | `updateEnrollmentStatus()` |
| UPDATE | photo | `setPhoto()` |
| DELETE | soft delete + cascade withdraw | `softDelete()` |
| ACTION | irreversible PII erasure | `anonymiseStudent()` |

### Attendance — `attendance.read` / `attendance.mark`

GET `getRoster` `getSummary` `getDailyAbsenceSummary` `getCalendar`
`getSubjectWiseSummary` `getTrend` `getLectureAttendance` ·
ACTION `markAttendance` `markAttendanceBulk` · OCR draft `ocr.service`

### Fees & payments — 9 permission keys, 33 routes

GET `getSummary` `listInvoices` `getInvoiceDetail` `listPayments`
`getPaymentHistory` `getPaymentLinks` `getStudentPaymentOverview`
`listFeeHeads` `listFeeStructures` `listFeePlans` `getFeePlanDetail`
`listPaymentChangeRequests` `listPaymentAcademicYears`
CREATE `createFeeHead` `createFeeStructure` `createInvoice`
`bulkCreateInvoices` `createFeePlan` `createPaymentChangeRequest`
UPDATE `updateFeePlan` `updatePayment`
ACTION `generateInvoices` `recordPayment` `approvePayment` `rejectPayment`
`refundPayment` `decidePaymentChangeRequest` `transitionFeePlan`
`publishFeePlan` `payOnline` `verifyCheckout` `settleGatewayPayment`

**Separation of duties is deliberate**: `fees.plan.request` / `.review` /
`.approve` and `fees.payments.approve` are distinct keys, and FINANCE holds
request/review but **not** approve.

### Admissions — `admissions.read` / `.manage`

GET `getPipeline` `getLeadById` · CREATE `createLead` `bulkCreateLeads` ·
UPDATE/ACTION `updateLead` — stage machine
`NEW→CONTACTED→TOUR_SCHEDULED→APPLICATION→ENROLLED|LOST`, writes a
`LeadInteraction`.

### Exams & marks — `exams.manage` / `marks.*`

GET `listExams` `listExamSubjects` `getMarksGrid` `getPerformance`
`getPerformanceHistory` `getReportCard` (+PDF) · CREATE `createExam`
`createExamSubject` · ACTION `enterMarks` `publishMarks`

### Assignments — `assignments.*` / `submissions.*`

GET `list` `listSubmissions` · CREATE `create` · ACTION `submit`
`gradeSubmission` · AI drafting `homework.draftHomework` + `commitHomework`

### Academics structure — `academics.read` / `academics.structure.manage`

GET years/terms/grades/sections/subjects/offerings + `getMySections`
`getMyOfferings` · CREATE each (+ bulk CSV) · UPDATE `updateSection`
`updateOffering`

### Approval workflows (GET + ACTION-decide)

| Module | Request | Review / decide |
|---|---|---|
| `leave` | `apply()` | `review()` — `leave.review` |
| `registrations` | `register()` `withdraw()` | `decide()` — `registrations.review` |
| `cocurricular` | `request()` `withdraw()` | `decide()` — `cocurricular.review` |
| `profileEdit` | `request()` `withdraw()` | `decide()` — `profile.edit.review`; strict field allow-list |

### Other modules

- **Library** GET `getSummary` `listBooks` `getBookById` `listBookFacets` `listIssues` · CREATE `createBook` `bulkCreateBooks` · UPDATE `updateBook` · DELETE `deleteBook` · ACTION `issueBook` `bulkIssueBooks` `returnBook`
- **Hostel** GET `getSummary` `listRooms` `getRoomById` `listAllocations` `listHostelStudents` `listInquiries` `getMedicalRecord` · CREATE `createRoom` `bulkCreateRooms` `createInquiry` · UPDATE `updateRoom` `updateInquiry` · ACTION `allocate` `bulkAllocate` `vacate`
- **Transport** GET `getOwnBus` `listTransportRoster`; ⚠️ `createRoute`/`createStop`/`enrollStudent` write models **directly in the controller**
- **Medical** `getByStudentId` `upsert` `remove` + `assertCanAccess` (class-teacher gate)
- **Documents** `listForActor` `getFileForActor`; create/update/delete live in the controller (file uploads)
- **Tickets** `list` `getById` `create` `reply` `update` ⚠️ unbounded
- **Calendar** `list` `create` · **Announcements** `list` `preview` `create` · **Notifications** `notify` `list` `unreadCount` `markRead` `markAllRead`
- **Users** `listUsers` `getUserById` `createUser` `bulkCreateUsers` `updateUser` *(status only)*
- **Roles/Permissions** full CRUD · **Schools** (SUPER_ADMIN) · **Audit** `listLogs`
- **Risk** `scan()` — per-enrollment risk from 30-day attendance + published marks + overdue fees. This is the real source for "students below the attendance threshold".
- **Growth** `getScore()` · **Dashboards** 7 role aggregates

## E. Permissions

71 keys in 12 groups (`admin, students, academics, fees, communication,
support, sensitive, admissions, library, hostel, transport, ai, analytics`).
Seeded from `PERMISSION_CATALOG`, authoritative at runtime in Mongo. Tenancy is
enforced independently by AsyncLocalStorage + a Mongoose plugin
(`src/tenancy/`): school-owned collections are filtered by the acting school
even when a query forgets to say so.

## F. Website Ask AI architecture (before MCP)

```
ask-eduos.tsx → POST /ai/agent  (authenticate → aiRateLimiter → ai.copilot.use)
  → ai.controller.agent → orchestrator.runAgentSafely
      → throttle → injection detection → parseIntentWithLlm
      → checkAuthorization(actor, tool) → tool.execute(actor, scope, args)
      → AgentAction proposal + confirmToken                    [writes]
  → POST /ai/agent/confirm → confirmAction (re-authorize, snapshot, audit)
```

`agent/tools.js` held **18 tools** (13 read, 5 write) calling existing
services. The write path already had propose→confirm→audit with before/after
snapshots.

**Finding:** `/ai/chat` and `ai.service.js` (~500 lines: 15 hardcoded intent
handlers plus a *second* copy of the RAG fallback) are **dead code** —
`api.aiChat` is declared in `frontend/src/lib/api.ts` and called by no
component.

## G. WhatsApp architecture

```
Meta → POST /whatsapp/webhook → verifySignature(rawBody, X-Hub-Signature-256)
  → whatsapp.service.receiveWebhook → whatsapp.session (idle window, N turns)
  → whatsapp.agent.handleInboundMessage
      → resolveActorByPhone (digit-normalised, full-value regex, refuses ambiguity)
      → runInActorScope (runWithTenant | runAcrossSchools for SUPER_ADMIN)
      → converse: briefing | bare yes/no → confirmActionById | runAgentSafely
  → whatsapp.service.sendMessage(to, text)
```

Both channels already shared `runAgentSafely` and `agent/tools.js`. Only
identity resolution, history and formatting differed.

## H. RAG architecture

Two near-identical implementations: `agent/rag.js` (live) and
`ai.service.js:handleRagFallback` (dead).

- Corpus: **announcements only** (`announcements.list(actor)`), chunked 200/20
- Retrieval: **keyword overlap count**, top 3 chunks scoring > 0
- **No embeddings, no vector store, no document ingestion**
- Generation: `providers/ai.provider.js` (Anthropic or Gemini, circuit breaker, 10 s timeout)
- Trigger: only when intent parsing matches no tool

**Critical finding:** RAG does not index policies, manuals, or the `documents`
module. The knowledge base people assume exists does not. Its only corpus is
announcements — which is also available structurally via `get_announcements`.

## I. RAG functionality migrated to MCP

Everything `agent/tools.js` answered — attendance, fees, results, assignments,
subjects, timetable, announcements-as-list, hostel, library, payment links —
plus the live-data questions RAG attempted through announcement prose: fee
amounts, absentee counts, student lookups, admissions, statistics.
Transactional truth now comes from a tool call, never from retrieved text.

## J. RAG functionality retained

1. **Announcement free-text Q&A** — "what did the circular about the bus route say?" is a text question, not a record lookup.
2. **Greeting / small-talk handling** — lives in the RAG prompt.
3. **Future document knowledge** — the `documents` module already stores school files; RAG is the right home for them. Today it does not read them, so this is an opportunity rather than existing behaviour.

RAG remains the fallback when no tool fits.

## K. MCP tool catalog

Implemented in `backend/src/modules/ai/mcp/tools/`. See
[`MCP-TOOLS.md`](./MCP-TOOLS.md) for the full per-tool catalog with schemas,
permissions, risk and confirmation.

## L. Capabilities NOT implemented, and why

| Requested capability | Why not |
|---|---|
| **Update a phone number** | **No service writes `Account.phoneE164` after creation.** Phone is on `Account`, not `Student`; `user.service.updateUser()` updates status only; `profileEdit` allows only `firstName, lastName, dob, gender, address`. Would require new business logic. |
| **Bulk WhatsApp/email to all parents** | `announcement.service.dispatch()` is a **log-line stub** that sends nothing. Real outbound exists only as 1:1 `whatsapp.sendMessage()`, and Meta's 24-hour session window requires approved templates that do not exist here. |
| `send_email` | Only `sendOtpEmail` exists; `EMAIL_PROVIDER=console` logs the code. |
| `generate_certificate` / TC | No generator. `documents` stores **uploaded** files. The only PDF generators (report card, invoice, receipt, ID card) **stream to an HTTP response** from controllers and return no reusable object. |
| `promote_student`, `transfer_student` | No service. `updateEnrollmentStatus()` only sets the enum on one enrollment. |
| `generate_fee_report` / export | No report service; the finance page composes `feeSummary()` + `invoices()` client-side. MCP returns the data, not a file. |
| `delete_student` (hard) | Only `softDelete()` + `anonymiseStudent()`. Correct as-is. |
| `regularize_attendance` | `attendance.regularize` exists in the catalog and is granted to ADMIN, but **no route or service implements it**. |
| HR / payroll / inventory / events tools | Modules do not exist. |

### Resolved since the audit

Three capabilities were blocked because their logic lived in a controller with
no service behind it. Each was small and safe to extract, so each now has a
service that both its REST route and an MCP tool call — the route's behaviour
unchanged, its existing tests still passing:

| Capability | Extracted to | MCP tools |
|---|---|---|
| Audit log listing | `audit/audit.service.js` — `listLogs(actor, query)` | `list_audit_logs` |
| Document deletion | `document.service.js` — `deleteForActor(actor, scope, id)` | `delete_document` |
| Transport routes, stops, bus enrolment | `transport.service.js` — `listRoutes`, `listStops`, `createRoute`, `createStop`, `enrollStudent` | `list_transport_routes`, `list_transport_stops`, `create_transport_route`, `create_transport_stop`, `enroll_in_transport` |

## Findings that shaped the implementation

1. **`student.service.update(id, updates)` is `Object.assign(student, updates)` — completely unbounded**, and takes no `actor`/`scope`. Exposed raw to an LLM it could set `status`, `admissionNo`, `deletedAt` or `tenantId`. Fixed: see `MCP-SECURITY.md` §Field allow-lists.
2. **Several write services take no actor/scope** (`create`, `softDelete`, `addGuardian`, `updateEnrollmentStatus`, `ticket.update`) — route middleware was their only authorization. MCP reproduces that check itself.
3. **A real import cycle exists**: `agent/tools.js → announcement.service → whatsapp.service → whatsapp.agent → orchestrator`. Any module importing both `tools.js` and the orchestrator hits `Cannot access 'TOOLS' before initialization`. The MCP registry resolves wrapped tools lazily for this reason.
4. **Dead code to retire, not migrate**: `/ai/chat` + `ai.service.js`.
5. **Idempotency already exists** where it matters: `approvePayment` and `refundPayment` use conditional `findOneAndUpdate`, `issueBook` atomically claims a copy, `hostel.allocate` refuses a second active allocation, `markAttendance` upserts by `(enrollment, date, period)`.
