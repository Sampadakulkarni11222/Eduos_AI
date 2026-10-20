# Assistant coverage map: every API route and the assistant tool that performs it

Generated 2026-10-18 on `feat/platform-part-4` by the coverage script (route walker + service-call matcher). Do not edit by hand; regenerate.

The owner's requirement: every action a person can take on a screen (read, create, update, act) can be done from Ask AI and from the WhatsApp agent. This map is the proof, route by route.

## How it is measured

1. **Routes.** The Express router (`routes/index.js` and every module router) is walked at runtime with the guards instrumented, so each route carries its method, full path, every `requirePermission` key with its minimum scope, `requireAnyOf` / `requireAnyPermission` alternatives, `requireRole`, `requireFeature`, and whether it is signed-in at all. Inline permission checks in a handler are picked up from the handler source.
2. **Roles.** For each of the 15 system roles the permission map is built from `constants/permissions.js` exactly as at sign-in, and a route counts as callable by a role when every guard passes.
3. **Tools.** Each route's handler is read (following controllers) for the service functions it calls; each MCP tool's `prepare`/`run` (and the agent tool it wraps) likewise. A route is performed by a tool when both call the same service function (a write route only by a writing tool). Per role, the tool must also be in that role's catalogue (`mcpToolsFor`: permission, minimum scope, `forRoles`).
4. **Classification** of every route no tool performs: `SCREEN` (deliberately screen-only, with the reason), `EXCEPTION` (a decision existing tests or product rules keep on its screen), `PARTIAL-OK` (the role the matcher counted cannot actually use it).

## Totals

- Routes: **1363** (GET 589, POST 613, PATCH 88, DELETE 33, PUT 40); public 33; Super-Admin-only 37; callable by a school role 1293.
- Routes performed by at least one tool: before **538**, after **1140**.
- Tools: before 517, after 1108.
- Status of every route: SCREEN 142, TOOL 1140, COVERED 23, PLATFORM 37, EXCEPTION 21.

### Per role (routes the role can call / performed by a tool in that role's catalogue)

| Role | Routes callable | Matched before | Matched after | Screen-only / exception / not for this role | Unaccounted |
|---|---:|---:|---:|---:|---:|
| ADMIN | 1211 | 487 (40%) | 1075 (89%) | 136 | 0 |
| PRINCIPAL | 788 | 281 (36%) | 696 (88%) | 92 | 0 |
| TEACHER | 572 | 198 (35%) | 483 (84%) | 89 | 0 |
| PARENT | 327 | 121 (37%) | 259 (79%) | 68 | 0 |
| STUDENT | 327 | 115 (35%) | 248 (76%) | 79 | 0 |
| FINANCE | 391 | 126 (32%) | 303 (77%) | 88 | 0 |
| LIBRARIAN | 299 | 108 (36%) | 240 (80%) | 59 | 0 |
| WARDEN | 315 | 109 (35%) | 252 (80%) | 63 | 0 |
| NURSE | 251 | 76 (30%) | 189 (75%) | 62 | 0 |
| HR | 370 | 98 (26%) | 294 (79%) | 76 | 0 |
| MARKETING | 343 | 96 (28%) | 275 (80%) | 68 | 0 |
| COMPLIANCE | 402 | 107 (27%) | 332 (83%) | 70 | 0 |
| TRUSTEE | 231 | 49 (21%) | 167 (72%) | 64 | 0 |
| ALUMNUS | 205 | 47 (23%) | 142 (69%) | 63 | 0 |

Super Admin is excluded by design: the platform operator has no `ai.copilot.use` and no school assistant.

## Deliberately screen-only (SCREEN)

Kept to what cannot or must not happen in a chat. The assistant still explains these and points to the screen.

- **Nobody signed in: public forms and pages, signed provider webhooks, device-signed endpoints (GPS, ID readers, cameras) and system probes** (27): `GET /health`, `GET /public/admissions/:school/form`, `POST /public/admissions/:school/files`, `POST /public/admissions/:school/applications`, `POST /public/admissions/:school/status/code`, `POST /public/admissions/:school/status`, `POST /public/newsletter/:school/unsubscribe`, `GET /public/marketing/r/:school/:code`, `GET /public/marketing/:school/heard-from`, `GET /public/marketing/leads/:school/:platform`, `POST /public/marketing/leads/:school/:platform`, `GET /public/integrations/meta/webhook`, `POST /public/integrations/meta/webhook`, `GET /schools/public/:slug`, `POST /fees/webhooks/razorpay`, `GET /whatsapp/webhook`, `POST /whatsapp/webhook`, `POST /whatsapp/chatflow/webhook`, `GET /observability/ready`, `GET /domains/resolve`, `GET /institution/public/:slug`, `POST /fleet/telemetry`, `POST /checkpoints/scan`, `POST /camera/events`, `POST /camera/heartbeat`, `GET /community/public/:slug`, `POST /marketing-growth/connectors/:platform/webhook-secret`
- **Credentials and access: sign-in, OTP, sessions and the profile switcher, user accounts, roles and permission grants, OAuth connections, API and webhook secrets, device secrets** (31): `POST /auth/register`, `POST /auth/otp/request`, `POST /auth/otp/email/request`, `POST /auth/otp/email/verify`, `POST /auth/google`, `POST /auth/otp/verify`, `POST /auth/login`, `POST /auth/profile/select`, `POST /auth/refresh`, `POST /auth/logout`, `GET /roles/`, `POST /roles/`, `GET /roles/:id`, `PATCH /roles/:id`, `DELETE /roles/:id`, `POST /roles/:id/permissions`, `DELETE /roles/:id/permissions/:key`, `GET /profiles/`, `POST /users/`, `PATCH /users/:id`, `GET /permissions/`, `POST /safety/devices`, `POST /safety/devices/:id/rotate-secret`, `POST /social/accounts`, `POST /social/accounts/:id/disconnect`, `PUT /marketing-growth/connectors/:platform/credentials`, `POST /integrations/oauth/complete`, `POST /integrations/:provider/connect`, `PUT /integrations/:provider/assets`, `POST /integrations/:provider/refresh-assets`, `POST /integrations/:provider/disconnect`
- **Restricted data kept out of chat by product rule: payroll and individual pay, safeguarding reports, case files, outcomes and referrals, camera observations, devices and metrics, health data outside the health role** (35): `GET /hostel/life/mess/diet`, `GET /hostel/medical-lookup/:studentId`, `POST /safeguarding/reports`, `GET /safeguarding/reports/mine`, `GET /safeguarding/cases`, `GET /safeguarding/cases/:id`, `PATCH /safeguarding/cases/:id`, `GET /payroll/payslips/mine`, `GET /payroll/rules`, `POST /payroll/rules`, `POST /payroll/rules/seed`, `POST /payroll/rules/:id/verify`, `GET /payroll/compensation`, `PUT /payroll/compensation`, `POST /payroll/runs`, `POST /payroll/runs/:id/submit`, `POST /payroll/runs/:id/reopen`, `GET /payroll/runs/:id/bank-file.csv`, `POST /payroll/runs/:id/payment-initiated`, `POST /payroll/runs/:id/payment-confirmed`, `GET /payroll/runs/:id/statutory/:code.csv`, `GET /payroll/runs/:id/statutory/EPF_ECR.txt`, `POST /payroll/runs/:id/statutory`, `POST /payroll/runs/:id/close`, `GET /camera/status`, `GET /camera/devices`, `GET /camera/observations`, `GET /camera/observations/:id`, `POST /camera/observations/:id/review`, `POST /camera/observations/:id/link-case`, `GET /camera/metrics`, `POST /support-plans/:id/referral`, `GET /health/class-care-notes`, `POST /health/doses/:id/countersign`, `POST /exits/:id/settlement/payroll`
- **Money through a payment gateway: fee checkout, AI credit and seat purchases** (6): `POST /fees/pay`, `POST /fees/pay/verify`, `POST /ai/credits/purchase`, `POST /ai/credits/purchase/verify`, `POST /seats/requests/:id/pay`, `POST /seats/payments/verify`
- **Bulk spreadsheet imports (the single-record tool is the assistant path)** (3): `POST /analytics/views/import`, `POST /marketing-growth/connectors/:platform/import`, `POST /marketing-growth/connectors/:platform/import-leads`
- **Files: uploads, downloads, PDFs, CSV exports, printing and labels (the same data is readable through a tool where one exists)** (25): `PATCH /students/:id/photo`, `GET /students/:id/id-card`, `POST /attendance/ocr/draft`, `GET /document-requests/mine/:id/file`, `POST /document-requests/:id/issue`, `GET /document-requests/:id/file`, `GET /fees/payments/:id/pdf`, `GET /library/copies/labels`, `POST /library/copies/labels/printed`, `GET /documents/:id/file`, `POST /uploads/`, `GET /correspondence/:id/document`, `GET /compliance/returns/:id/export.csv`, `GET /compliance/returns/:id/document`, `GET /analytics/export.csv`, `GET /analytics/reports/:id/download.csv`, `GET /analytics/reports/:id/download.pdf`, `POST /labs/devices/:id/decommission`, `GET /sustainability/packs/:key/csv`, `GET /alumni-services/documents/:id/file`, `GET /newsletter/opportunities/:id/calendar`, `GET /finance-reports/day-book.csv`, `GET /finance-reports/ageing.csv`, `GET /health-insights/register.csv`, `GET /marketing-growth/attribution.csv`
- **The assistant's own endpoints (the chat, tutor, WhatsApp link, generated panels) and platform observability** (15): `POST /ai/agent`, `POST /ai/agent/confirm`, `POST /ai/agent/continue`, `GET /ai/agent/capabilities`, `GET /ai/tutor/status`, `GET /ai/tutor/syllabus`, `POST /ai/tutor`, `GET /ai/tutor/learn/status`, `POST /ai/tutor/learn`, `POST /whatsapp/simulate`, `GET /whatsapp/assistant-link`, `POST /whatsapp/assistant-link/click`, `GET /observability/metrics`, `POST /genui/ask`, `GET /genui/panels/:id`

Each route's own reason is in its row of the table below.

## Via Ask AI (file attach)

Moved in part 7 (16 routes): bulk spreadsheet imports are no longer screen-only. The person attaches a CSV/Excel file in Ask AI (or sends it as a WhatsApp document); `preview_import` recognises the target, maps the columns and checks every row; `run_import` imports through the same bulk service after one confirmation on the website (WhatsApp hands off with a link). Exam marks per paper (`POST /exams/marks`) and the attendance register (`POST /attendance/mark/bulk`) can also come from a sheet. Registry: `backend/src/modules/imports/schemas.js`.

`POST /users/bulk`, `POST /academics/grades/bulk`, `POST /academics/sections/bulk`, `POST /academics/subjects/bulk`, `POST /enrollments/bulk`, `POST /fees/invoices/bulk`, `POST /admissions/leads/bulk`, `POST /library/books/bulk`, `POST /library/issues/bulk`, `POST /hostel/rooms/bulk`, `POST /hostel/allocations/bulk`, `POST /transport/routes/bulk`, `POST /transport/stops/bulk`, `POST /transport/enroll/bulk`, `POST /imports/files`, `GET /imports/files/:id/:report`

## Decisions kept on their screen (EXCEPTION)

Every other decision a role makes on screen is an approver-confirmed tool: recorded only when the approver states it and confirms on the website (`approverDecision`, HIGH risk, never on WhatsApp). These stay on screen because existing tests (`mcp.humanDecisions`, `teacher.writeAudit`, `admin.writeAudit`, `askAi.routingDefects`, `mcp.e2e`, `teacher.webParity`) or product rules say so: money (fee payments, refunds, payment change requests, fee plans, procurement payments, cash close), publishing marks and report cards to families, student leave, elective registrations, co-curricular and profile-edit requests, book and transport requests, admission decisions, safeguarding outcomes.

- **student leave review stays on screen**: `POST /leave/:id/review`
- **publishing marks stays on screen**: `POST /exams/publish`
- **unpublishing marks stays on screen**: `POST /exams/unpublish`
- **recording a fee payment stays on the Payments screen**: `POST /fees/payments`
- **fee plan publish**: `POST /fees/plans/:id/publish`
- **payment change request decision**: `POST /fees/payments/change-requests/:id/decide`
- **payment approval**: `POST /fees/payments/:id/approve`
- **payment rejection**: `POST /fees/payments/:id/reject`
- **fee refund**: `POST /fees/payments/:id/refund`
- **elective registration decisions stay on screen**: `PATCH /registrations/:id/decision`
- **co-curricular decisions stay on screen**: `PATCH /student-requests/cocurricular/:id/decide`
- **profile-edit decisions stay on screen**: `PATCH /student-requests/profile-edits/:id/decide`
- **settling/waiving a library fine is recording a payment; kept at the desk by product rule (p4Librarian.js header; tests/p4.supportRoles.test.js "a fine is settled by a person")**: `POST /library/desk/loans/:id/fine`
- **library book-request decision**: `PATCH /library/requests/:id/decision`
- **transport-request decision**: `PATCH /transport/requests/:id/decision`
- **procurement payment approval**: `POST /procurement/requests/:id/approve-payment`
- **procurement payment initiated**: `POST /procurement/requests/:id/payment-initiated`
- **procurement payment confirmed**: `POST /procurement/requests/:id/payment-confirmed`
- **publishing report cards to families stays on screen**: `POST /report-cards/:id/publish`
- **offering a seat (admission decision)**: `POST /marketing/offers`
- **cash-close verification**: `POST /finance-reports/cash-close/:id/check`

## Decisions recorded on the approver's confirmation

Approver-confirmed tools (`approverDecision`): the decision is a required argument the approver states in their own words (never suggested), the tool is HIGH risk and confirmed on the website only, and the service checks the approver exactly as on screen (self-approval, stage, second person). Natural requests reach them through `APPROVER_CONFIRMED` in `mcp/decisions.js`.

`moderate_alumni_post` (alumni.manage ALL), `moderate_newsletter_comment` (digest.read), `moderate_newsroom_comment` (community.read), `moderate_newsroom_post` (community.read), `record_alumni_offer_decision` (alumni.manage ALL), `record_board_minutes_approval` (governance.read), `record_care_note_sharing_decision` (health.read), `record_circle_join_decision` (community.read), `record_class_report_card_moderation` (reportcards.manage), `record_club_join_decision` (clubs.manage), `record_concession_decision` (approvals.decide), `record_cpd_verification` (staffleave.manage ALL), `record_document_request_decision` (students.manage ALL), `record_facility_booking_decision` (facilities.manage), `record_fixture_result_decision` (clubs.manage), `record_marketing_asset_decision` (marketing.read), `record_medication_consent_decision` (health.read), `record_mentoring_request_decision` (community.read), `record_notice_applicability_decision` (compliance.manage), `record_obligation_applicability_decision` (compliance.manage), `record_offline_campaign_decision` (marketing.read), `record_opportunity_decision` (digest.manage ALL), `record_outpass_consent` (hostel.outpass.request), `record_outpass_decision` (hostel.outpass.manage), `record_report_card_moderation` (reportcards.manage), `record_return_review_decision` (compliance.manage), `record_showcase_entry_review` (showcase.publish), `record_staff_leave_decision` (staffleave.manage ALL), `record_vendor_due_diligence` (procurement.manage), `record_verification_decision` (verification.decide), `record_verification_dispute_resolution` (verification.decide), `record_verification_recommendation` (verification.manage), `record_visitor_host_decision` (ai.copilot.use), `resolve_community_report` (community.moderate), `verify_bill_payment` (bills.manage ALL)

## Every route

Roles: AD admin, PR principal, TE teacher, PA parent, ST student, FI finance, LI librarian, WA warden, NU nurse, HR, MK marketing, CO compliance, TR trustee, AL alumnus, SA super admin. "Tools" lists the tools that perform the route; a role in "not in catalogue" can call the route but sees none of them (with the reason when recorded).

### /health

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/health` | public (no sign-in) | public | **SCREEN** — System health probe (no person, no action). |
| GET | `/health/summary` | `health.summary.read` | SA AD PR NU | `get_health_room_summary` |
| GET | `/health/class-care-notes` | `health.carenotes.read` | TE | **SCREEN** — Health data shared with the class teacher stays on the Health page (audited) and out of chat transcripts, by the existing product rule (roleCoverage ledger, health.carenotes.read). |
| GET | `/health/family` | `health.read` | PA NU | `get_family_health` — not in catalogue for NU (get_family_health (PARENT; NU reaches the route but the service refuses non-parents: PARENT_ONLY)) |
| GET | `/health/today` | `health.manage` (ALL) | NU | `get_health_visits_today`, `close_health_visit` |
| GET | `/health/students` | `health.manage` (ALL) | NU | `get_child_medication_log`, `list_health_visits`, `list_child_health_visits`, `list_medication_plans`, `list_care_notes`, `list_child_health_entries`, `get_child_health_card` |
| GET | `/health/settings` | `health.manage` (ALL) | NU | `get_health_room_settings` |
| PUT | `/health/settings` | `health.manage` (ALL) | NU | `update_health_room_settings` |
| GET | `/health/visits` | `health.read` | PA NU | `list_health_visits`, `list_child_health_visits` |
| POST | `/health/visits` | `health.manage` (ALL) | NU | `log_health_visit` |
| PATCH | `/health/visits/:id` | `health.manage` (ALL) | NU | `close_health_visit` |
| GET | `/health/plans` | `health.read` | PA NU | `list_child_health_visits`, `list_medication_plans`, `list_care_notes`, `list_child_health_entries` |
| POST | `/health/plans` | `health.read` | PA NU | `create_medication_plan` — not in catalogue for PA (create_medication_plan (nurse draft awaiting consent; a parent's own plan requires the prescription upload, which stays on the Health page)) |
| POST | `/health/plans/:id/consent` | `health.read` | PA NU | `record_medication_consent_decision` — not in catalogue for NU (record_medication_consent_decision (parent, approver-confirmed; needs the prescription already on the plan)) |
| POST | `/health/plans/:id/stop` | `health.read` | PA NU | `cancel_medication_plan`, `record_medication_consent_decision` |
| GET | `/health/doses/due` | `health.manage` (ALL) | NU | `log_medicine_dose` |
| POST | `/health/doses` | `health.manage` (ALL) | NU | `log_medicine_dose` |
| POST | `/health/doses/:id/countersign` | `health.witness` | NU | **SCREEN** — Countersigning a controlled medicine is the second person checking at the cabinet; done on the Health page by that person, never through chat (existing product rule, health.witness). |
| GET | `/health/students/:studentId/medication-log` | `health.read` | PA NU | `get_child_medication_log` |
| GET | `/health/stock` | `health.manage` (ALL) | NU | `list_health_stock` |
| POST | `/health/stock` | `health.manage` (ALL) | NU | `add_health_stock` |
| PATCH | `/health/stock/:id` | `health.manage` (ALL) | NU | `update_health_stock` |
| GET | `/health/care-notes` | `health.read` | PA NU | `list_care_notes` |
| POST | `/health/care-notes` | `health.read` | PA NU | `add_care_note` |
| POST | `/health/care-notes/:id/consent` | `health.read` | PA NU | `record_care_note_sharing_decision` — not in catalogue for NU (record_care_note_sharing_decision (parent, approver-confirmed)) |
| POST | `/health/care-notes/:id/retire` | `health.read` | PA NU | `retire_care_note` |
| GET | `/health/students/:studentId/entries` | `health.read` | PA NU | `list_child_health_entries` |
| POST | `/health/entries` | `health.manage` (ALL) | NU | `add_health_entry` |
| GET | `/health/students/:studentId/card` | `health.read` | PA NU | `get_child_health_card` |

### /public

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/public/admissions/:school/form` | public (no sign-in) | public | **SCREEN** — Public unauthenticated form for applicants who have no account; nobody signed in to act for. |
| POST | `/public/admissions/:school/files` | public (no sign-in) | public | **SCREEN** — Public unauthenticated form for applicants who have no account; nobody signed in to act for. |
| POST | `/public/admissions/:school/applications` | public (no sign-in) | public | **SCREEN** — Public unauthenticated form for applicants who have no account; nobody signed in to act for. |
| POST | `/public/admissions/:school/status/code` | public (no sign-in) | public | **SCREEN** — Public unauthenticated form for applicants who have no account; nobody signed in to act for. |
| POST | `/public/admissions/:school/status` | public (no sign-in) | public | **SCREEN** — Public unauthenticated form for applicants who have no account; nobody signed in to act for. |
| POST | `/public/newsletter/:school/unsubscribe` | public (no sign-in) | public | **SCREEN** — Public one-click unsubscribe link from an email; nobody signed in. |
| GET | `/public/marketing/r/:school/:code` | public (no sign-in) | public | **SCREEN** — Public campaign tracking link / lead form; nobody signed in. |
| GET | `/public/marketing/:school/heard-from` | public (no sign-in) | public | **SCREEN** — Public campaign tracking link / lead form; nobody signed in. |
| GET | `/public/marketing/leads/:school/:platform` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/public/marketing/leads/:school/:platform` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| GET | `/public/integrations/meta/webhook` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/public/integrations/meta/webhook` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |

### /auth

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/auth/register` | `users.manage` | SA AD | **SCREEN** — user account creation (credentials) |
| POST | `/auth/otp/request` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/otp/email/request` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/otp/email/verify` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/google` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/otp/verify` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/login` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/profile/select` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — sign-in/session: profile switch |
| POST | `/auth/refresh` | public (no sign-in) | public | **SCREEN** — Sign-in, OTP, password and session handling: credentials never pass through a chat. |
| POST | `/auth/logout` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — sign-in/session: logout |
| GET | `/auth/me` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_profile` |

### /roles

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/roles/` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| POST | `/roles/` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| GET | `/roles/:id` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| PATCH | `/roles/:id` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| DELETE | `/roles/:id` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| POST | `/roles/:id/permissions` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |
| DELETE | `/roles/:id/permissions/:key` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants |

### /profiles

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/profiles/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — sign-in/session: the account's own profiles for the profile switcher |

### /users

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/users/` | `users.read` | SA AD PR HR CO | `list_users`, `get_user_account` |
| POST | `/users/` | `users.manage` | SA AD | **SCREEN** — user account creation (credentials) |
| POST | `/users/bulk` | `users.manage` | SA AD | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/users/:id` | `users.read` | SA AD PR HR CO | `get_user_account` |
| PATCH | `/users/:id` | `users.manage` | SA AD | **SCREEN** — user account editing (credentials) |

### /permissions

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/permissions/` | `roles.manage` | SA AD | **SCREEN** — roles and permission grants (permission catalogue) |
| POST | `/permissions/` | `permissions.manage` | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PATCH | `/permissions/:id` | `permissions.manage` | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| DELETE | `/permissions/:id` | `permissions.manage` | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |

### /schools

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/schools/public/:slug` | public (no sign-in) | public | **SCREEN** — Public school page data for visitors; nobody signed in. |
| GET | `/schools/` | `schools.read` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/schools/` | `schools.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/schools/:tenantId` | `schools.read` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PATCH | `/schools/:tenantId` | `schools.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/schools/:tenantId/admins` | `schools.read` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/schools/:tenantId/admins` | `schools.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PATCH | `/schools/:tenantId/admins/:profileId` | `schools.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |

### /academics

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/academics/years` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_academic_years` |
| POST | `/academics/years` | `academics.structure.manage` | SA AD PR | `create_academic_year` |
| GET | `/academics/terms` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_academic_years` |
| POST | `/academics/terms` | `academics.structure.manage` | SA AD PR | `create_term` |
| GET | `/academics/grades` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_classes` |
| POST | `/academics/grades` | `academics.structure.manage` | SA AD PR | `create_grade` |
| POST | `/academics/grades/bulk` | `academics.structure.manage` | SA AD PR | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/academics/sections/mine` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_classes`, `get_my_profile` |
| GET | `/academics/sections` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_classes` |
| POST | `/academics/sections` | `academics.structure.manage` | SA AD PR | `create_section` |
| PATCH | `/academics/sections/:id` | `academics.structure.manage` | SA AD PR | `update_section` |
| POST | `/academics/sections/bulk` | `academics.structure.manage` | SA AD PR | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/academics/subjects` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_subjects` |
| POST | `/academics/subjects` | `academics.structure.manage` | SA AD PR | `create_subject` |
| POST | `/academics/subjects/bulk` | `academics.structure.manage` | SA AD PR | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/academics/offerings/mine` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_classes`, `get_subjects`, `get_my_profile` |
| GET | `/academics/offerings` | `academics.read` | SA AD PR TE FI LI WA NU MK | `list_subjects` |
| POST | `/academics/offerings` | `academics.structure.manage` | SA AD PR | `assign_teacher_to_subject` |
| PATCH | `/academics/offerings/:id` | `academics.structure.manage` | SA AD PR | `update_subject_offering` |

### /students

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/students/` | `students.read` | SA AD PR TE PA ST FI LI WA NU | `search_students`, `get_my_profile` |
| POST | `/students/` | `students.manage` | SA AD | `create_student` |
| GET | `/students/:id` | `students.read` | SA AD PR TE PA ST FI LI WA NU | `get_student` |
| PATCH | `/students/:id/photo` | `students.read` | SA AD PR TE PA ST FI LI WA NU | **SCREEN** — photo upload |
| POST | `/students/:id/anonymise` | `students.manage` | SA AD | `anonymise_student` |
| PATCH | `/students/:id` | `students.manage` | SA AD | `update_student` |
| DELETE | `/students/:id` | `students.manage` | SA AD | `archive_student` |
| GET | `/students/:id/overview` | `students.read` | SA AD PR TE PA ST FI LI WA NU | `get_student_overview` |
| GET | `/students/:id/guardians` | `students.read` | SA AD PR TE PA ST FI LI WA NU | `list_guardians` |
| POST | `/students/:id/guardians` | `students.manage` | SA AD | `add_guardian` |
| GET | `/students/:id/id-card` | `students.read` | SA AD PR TE PA ST FI LI WA NU | **SCREEN** — PDF ID card download/printing |

### /enrollments

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/enrollments/` | `students.read` | SA AD PR TE PA ST FI LI WA NU | `get_student`, `list_enrollments`, `get_attendance_roster`, `get_attendance_draft` |
| GET | `/enrollments/next-roll-no` | `students.read` (ALL) | SA AD PR FI LI WA NU | `get_next_roll_number` |
| POST | `/enrollments/` | `enrollments.manage` | SA AD | `enroll_student` |
| POST | `/enrollments/bulk` | `enrollments.manage` | SA AD | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| PATCH | `/enrollments/:id/status` | `enrollments.manage` | SA AD | `update_enrollment_status` |

### /timetable

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/timetable/` | `timetable.read` | SA AD PR TE PA ST | `get_timetable` |
| POST | `/timetable/slot` | `timetable.manage` | SA AD PR | `upsert_timetable_slot` |

### /shifts

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/shifts/` | `timetable.read` | SA AD PR TE PA ST | `list_school_shifts` |
| POST | `/shifts/` | `timetable.manage` (ALL) | SA AD PR | `create_school_shift` |
| GET | `/shifts/section/:sectionId` | `timetable.read` | SA AD PR TE PA ST | **COVERED** — get_section_shift (campus/moment shiftOfSection, same shift and bells) |
| PUT | `/shifts/:id` | `timetable.manage` (ALL) | SA AD PR | `update_school_shift` |
| DELETE | `/shifts/:id` | `timetable.manage` (ALL) | SA AD PR | `retire_school_shift` |

### /staff-profile

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/staff-profile/me` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_staff_profile` — not in catalogue for PA ST TR AL (get_my_staff_profile) |
| PUT | `/staff-profile/me` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `update_my_staff_profile` — not in catalogue for PA ST TR AL (update_my_staff_profile) |
| GET | `/staff-profile/teachers-of` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_child_teacher_profiles` — not in catalogue for AD PR TE FI LI WA NU HR MK CO TR AL (list_my_child_teacher_profiles) |
| GET | `/staff-profile/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_staff_profiles` — not in catalogue for PR TE PA ST FI LI WA NU MK CO TR AL (list_staff_profiles) |
| GET | `/staff-profile/:profileId` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **COVERED** — get_teacher_qualifications (credentials.service.byName -> read) |
| PUT | `/staff-profile/:profileId` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `update_staff_profile` — not in catalogue for PR TE PA ST FI LI WA NU MK CO TR AL (update_staff_profile) |

### /attendance

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/attendance/ocr/draft` | `attendance.mark` | SA AD TE | **SCREEN** — register photo / OCR upload |
| GET | `/attendance/roster` | `attendance.read` | SA AD PR TE PA ST | `get_attendance_roster` |
| POST | `/attendance/mark` | `attendance.mark` | SA AD TE | `mark_attendance` |
| POST | `/attendance/mark/bulk` | `attendance.mark` | SA AD TE | `bulk_mark_attendance` |
| GET | `/attendance/summary` | `attendance.read` | SA AD PR TE PA ST | `get_student_attendance`, `get_attendance_roster`, `get_attendance_statistics`, `get_attendance` |
| GET | `/attendance/calendar` | `attendance.read` | SA AD PR TE PA ST | `get_attendance_calendar` |
| GET | `/attendance/subject-wise` | `attendance.read` | SA AD PR TE PA ST | `get_subject_attendance` |
| GET | `/attendance/trend` | `attendance.read` | SA AD PR TE PA ST | `get_attendance_trend` |
| GET | `/attendance/lectures` | `attendance.read` | SA AD PR TE PA ST | `get_lecture_attendance` |
| GET | `/attendance/drafts` | `attendance.mark` | SA AD TE | `get_attendance_draft` |
| PUT | `/attendance/drafts` | `attendance.mark` | SA AD TE | `save_attendance_draft` |
| DELETE | `/attendance/drafts` | `attendance.mark` | SA AD TE | `discard_attendance_draft` |

### /leave

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/leave/apply` | `leave.apply` (checked in handler); `leave.read` (checked in handler) | SA AD PR TE PA ST | `apply_for_leave` — not in catalogue for PR TE (PR/TE do not hold leave.apply; student leave is applied by a student or a parent (leave.service resolves the caller's own/child's enrolment and refuses anyone else)) |
| GET | `/leave/mine` | `leave.read` | SA AD PR TE PA ST | `get_leave_requests` |
| GET | `/leave/` | `leave.read` | SA AD PR TE PA ST | `get_leave_requests` |
| POST | `/leave/:id/review` | `leave.review` | SA AD PR TE | **EXCEPTION** — student leave review stays on screen |

### /assignments

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/assignments/` | `assignments.read` | SA AD PR TE PA ST | `get_assignments` |
| POST | `/assignments/` | `assignments.manage` | SA AD TE | `create_assignment` |
| POST | `/assignments/grade` | `submissions.grade` | SA AD TE | `grade_submission` |
| POST | `/assignments/submit` | `submissions.submit` | SA AD ST | `submit_assignment` |
| GET | `/assignments/:id/submissions` | `submissions.grade` | SA AD TE | `get_submissions` |
| PATCH | `/assignments/:id` | `assignments.manage` | SA AD TE | `update_assignment` |
| DELETE | `/assignments/:id` | `assignments.manage` | SA AD TE | `delete_assignment` |

### /exams

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/exams/` | `exams.manage` | SA AD | `create_exam` |
| GET | `/exams/` | `marks.read` | SA AD PR TE PA ST | `list_exams` |
| GET | `/exams/subjects` | `marks.read` | SA AD PR TE PA ST | `get_class_marks`, `list_exams`, `get_paper_results` |
| POST | `/exams/subjects` | `exams.manage` | SA AD | `create_exam_subject` |
| GET | `/exams/marks-grid` | `marks.read` | SA AD PR TE PA ST | `get_class_marks`, `get_marks_grid` |
| GET | `/exams/performance/history` | `marks.read` | SA AD PR TE PA ST | `get_performance_history` |
| GET | `/exams/performance` | `marks.read` | SA AD PR TE PA ST | `get_performance` |
| GET | `/exams/report-card` | `marks.read` | SA AD PR TE PA ST | `get_results`, `get_report_card` |
| GET | `/exams/report-card/pdf` | `marks.read` | SA AD PR TE PA ST | `get_results`, `get_report_card` |
| POST | `/exams/marks` | `marks.enter` | SA AD TE | `enter_marks` |
| POST | `/exams/publish` | `marks.publish` | SA AD PR TE | **EXCEPTION** — publishing marks stays on screen |
| POST | `/exams/unpublish` | `marks.publish` | SA AD PR TE | **EXCEPTION** — unpublishing marks stays on screen |

### /quizzes

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/quizzes/` | `assignments.read` | SA AD PR TE PA ST | `list_quizzes`, `get_quiz`, `get_quiz_results`, `get_quiz_to_take`, `get_my_quiz_answers` |
| POST | `/quizzes/` | `assignments.manage` | SA AD TE | `create_quiz_draft` |
| GET | `/quizzes/my-attempts` | `submissions.submit` | ST (requireRole STUDENT) | `get_my_quiz_results` |
| GET | `/quizzes/:id` | `assignments.manage` | SA AD TE | `get_quiz` |
| PATCH | `/quizzes/:id` | `assignments.manage` | SA AD TE | `update_quiz` |
| DELETE | `/quizzes/:id` | `assignments.manage` | SA AD TE | `delete_quiz` |
| POST | `/quizzes/:id/questions` | `assignments.manage` | SA AD TE | `create_quiz_draft`, `add_quiz_question` |
| PATCH | `/quizzes/:id/questions/:questionId` | `assignments.manage` | SA AD TE | `update_quiz_question` |
| DELETE | `/quizzes/:id/questions/:questionId` | `assignments.manage` | SA AD TE | `delete_quiz_question` |
| POST | `/quizzes/:id/publish` | `assignments.manage` | SA AD TE | `release_quiz` |
| POST | `/quizzes/:id/unpublish` | `assignments.manage` | SA AD TE | `release_quiz` |
| GET | `/quizzes/:id/results` | `submissions.grade` | SA AD TE | `get_quiz_results` |
| GET | `/quizzes/:id/take` | `submissions.submit` | ST (requireRole STUDENT) | `get_quiz_to_take` |
| POST | `/quizzes/:id/start` | `submissions.submit` | ST (requireRole STUDENT) | `start_quiz`, `submit_quiz_answers` |
| POST | `/quizzes/:id/submit` | `submissions.submit` | ST (requireRole STUDENT) | `submit_quiz_answers` |
| GET | `/quizzes/:id/my-result` | `submissions.submit` | ST (requireRole STUDENT) | `get_my_quiz_answers` |

### /document-requests

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/document-requests/mine/types` | `students.read` | PA ST (requireRole STUDENT/PARENT) | `list_certificate_types`, `get_my_certificate_requests`, `list_quizzes`, `get_my_quiz_results`, `list_my_maintenance_reports`, `list_alumni_certificate_types` |
| GET | `/document-requests/mine` | `students.read` | PA ST (requireRole STUDENT/PARENT) | `get_my_certificate_requests`, `get_my_alumni_certificate_requests`, `get_my_document_request`, `get_my_alumni_document_request` |
| POST | `/document-requests/mine` | `students.read` | PA ST (requireRole STUDENT/PARENT) | `request_certificate`, `request_alumni_certificate` |
| GET | `/document-requests/mine/:id` | `students.read` | PA ST (requireRole STUDENT/PARENT) | `get_my_document_request`, `get_my_alumni_document_request` |
| POST | `/document-requests/mine/:id/cancel` | `students.read` | PA ST (requireRole STUDENT/PARENT) | `cancel_certificate_request`, `cancel_alumni_certificate_request` |
| GET | `/document-requests/mine/:id/file` | `students.read` | PA ST (requireRole STUDENT/PARENT) | **SCREEN** — file download of the issued document |
| GET | `/document-requests/` | `students.manage` (ALL) | SA AD | `list_certificate_requests`, `get_certificate_clearance`, `get_document_request`, `get_certificate_preview` |
| GET | `/document-requests/:id` | `students.manage` (ALL) | SA AD | `get_document_request` |
| POST | `/document-requests/:id/review` | `students.manage` (ALL) | SA AD | `start_document_request_review` |
| POST | `/document-requests/:id/approve` | `students.manage` (ALL) | SA AD | `record_document_request_decision` |
| POST | `/document-requests/:id/reject` | `students.manage` (ALL) | SA AD | `record_document_request_decision` |
| POST | `/document-requests/:id/issue` | `students.manage` (ALL) | SA AD | **SCREEN** — attaches an uploaded file (fileUrl from POST /uploads); the assistant path for issuing is generate_certificate |
| GET | `/document-requests/:id/file` | `students.manage` (ALL) | SA AD | **SCREEN** — file download |

### /document-types

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/document-types/` | `settings.manage` | SA AD | `list_document_types` |
| POST | `/document-types/` | `settings.manage` | SA AD | `create_document_type` |
| POST | `/document-types/suggested` | `settings.manage` | SA AD | `add_suggested_document_types` |
| PATCH | `/document-types/:id` | `settings.manage` | SA AD | `update_document_type` |
| DELETE | `/document-types/:id` | `settings.manage` | SA AD | `delete_document_type` |

### /fees

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/fees/webhooks/razorpay` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/fees/heads` | `fees.structure.manage` | SA AD FI | `create_fee_head` |
| GET | `/fees/heads` | `fees.read` (ALL) | SA AD PR FI | `get_fee_structures` |
| POST | `/fees/structures` | `fees.structure.manage` | SA AD FI | `create_fee_structure` |
| GET | `/fees/structures` | `fees.read` (ALL) | SA AD PR FI | `get_fee_structures` |
| POST | `/fees/invoices/generate` | `fees.manage` | SA AD FI | `generate_invoices` |
| GET | `/fees/invoices` | `fees.read` | SA AD PR PA ST FI | `get_pending_fees`, `get_invoice` |
| POST | `/fees/invoices` | `fees.manage` | SA AD FI | `create_invoice` |
| GET | `/fees/invoices/:id` | `fees.read` | SA AD PR PA ST FI | `get_invoice` |
| GET | `/fees/invoices/:id/pdf` | `fees.read` | SA AD PR PA ST FI | `get_invoice` |
| POST | `/fees/invoices/bulk` | `fees.manage` | SA AD FI | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/fees/summary` | `fees.read` | SA AD PR PA ST FI | `get_pending_fees`, `get_fee_statistics`, `get_fees` |
| POST | `/fees/payments` | `fees.pay` | SA AD PA ST FI | **EXCEPTION** — recording a fee payment stays on the Payments screen |
| GET | `/fees/payments` | `fees.read` | SA AD PR PA ST FI | `get_payment_history` |
| GET | `/fees/payments/:id/pdf` | `fees.read` | SA AD PR PA ST FI | **SCREEN** — receipt PDF download (get_payment_history / get_invoice give the data) |
| POST | `/fees/pay` | `fees.pay` | SA AD PA ST FI | **SCREEN** — payment gateway checkout (get_payment_link gives the link) |
| POST | `/fees/pay/verify` | `fees.pay` | SA AD PA ST FI | **SCREEN** — payment gateway verify |
| GET | `/fees/academic-years` | `fees.read` | SA AD PR PA ST FI | `list_fee_academic_years`, `get_fee_year_statement`, `get_installment_plan_breakdown`, `list_seat_purchases`, `list_seat_price_changes`, `get_seat_request`, `list_vendors`, `get_purchase_request`, `list_procurement_assets`, `list_funding_proposals`, `list_service_accounts`, `get_service_bill`, `list_gst_rates`, `list_cash_closes`, `get_scenario_projection`, `get_scenario_comparison`, `list_budget_scenarios`, `get_scenario` |
| GET | `/fees/overview` | `fees.read` | SA AD PR PA ST FI | `get_fee_year_statement` |
| GET | `/fees/plans` | `fees.read` | SA AD PR PA ST FI | `get_fee_plans`, `get_installment_plan_breakdown` |
| POST | `/fees/plans` | `fees.plan.request` (ALL) | SA AD FI | `create_fee_plan` |
| GET | `/fees/plans/:id` | `fees.read` | SA AD PR PA ST FI | `get_installment_plan_breakdown` |
| PATCH | `/fees/plans/:id` | `fees.plan.request` (ALL) | SA AD FI | `update_fee_plan` |
| POST | `/fees/plans/:id/:step(submit|review|requestApproval|approve|reject)` | `fees.read` (ALL) | SA AD PR FI | `transition_fee_plan` |
| POST | `/fees/plans/:id/publish` | `fees.plan.approve` (ALL) | SA AD | **EXCEPTION** — fee plan publish |
| GET | `/fees/payments/change-requests` | `fees.read` (ALL) | SA AD PR FI | `get_payment_change_requests` |
| POST | `/fees/payments/change-requests/:id/decide` | `fees.payments.approve` (ALL) | SA AD | **EXCEPTION** — payment change request decision |
| GET | `/fees/payments/:id/history` | `fees.read` (ALL) | SA AD PR FI | `get_payment_audit_trail` |
| POST | `/fees/payments/:id/approve` | `fees.payments.approve` (ALL) | SA AD | **EXCEPTION** — payment approval |
| POST | `/fees/payments/:id/reject` | `fees.payments.approve` (ALL) | SA AD | **EXCEPTION** — payment rejection |
| PATCH | `/fees/payments/:id` | `fees.payments.approve` (ALL) | SA AD | `update_payment` |
| POST | `/fees/payments/:id/change-request` | `fees.manage` (ALL) | SA AD FI | `request_payment_change` |
| POST | `/fees/payments/:id/refund` | `fees.payments.refund` | SA FI | **EXCEPTION** — fee refund |

### /announcements

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/announcements/` | `announcements.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR | `get_announcements` |
| POST | `/announcements/` | `announcements.publish` | SA AD PR TE | `create_announcement` |
| POST | `/announcements/preview` | `announcements.publish` | SA AD PR TE | `get_announcement_preview` |

### /notifications

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/notifications/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_notifications` |
| GET | `/notifications/unread-count` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **COVERED** — list_notifications (returns the unread count with the list) |
| POST | `/notifications/read` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `dismiss_unread_notifications` |
| POST | `/notifications/read-all` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `dismiss_unread_notifications` |

### /calendar

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/calendar/` | `calendar.read` | SA AD PR TE PA ST LI WA NU HR MK CO TR | `get_calendar_events` |
| POST | `/calendar/` | `calendar.manage` | SA AD PR TE | `create_calendar_event` — not in catalogue for TE (calendar.service.create refuses any scope but ALL; a teacher's OWN calendar.manage cannot create events) |

### /tickets

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/tickets/` | `tickets.read` | SA AD PR TE PA ST LI WA | `list_tickets` |
| POST | `/tickets/` | `tickets.create` | SA AD PA ST | `create_ticket` |
| GET | `/tickets/:id` | `tickets.read` | SA AD PR TE PA ST LI WA | `get_ticket` |
| PATCH | `/tickets/:id` | `tickets.manage` | SA AD PR WA | `update_ticket` |
| POST | `/tickets/reply` | `tickets.respond` | SA AD TE LI WA | `reply_to_ticket` |

### /medical

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/medical/:studentId` | `medical.read` | SA AD TE PA WA NU | `get_medical_record` |
| PUT | `/medical/:studentId` | `medical.manage` | SA AD PA | `upsert_medical_record` |
| DELETE | `/medical/:studentId` | `medical.manage` | SA AD PA | `remove_medical_record` |

### /registrations

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/registrations/available` | `registrations.apply` | SA AD ST | `get_my_electives` |
| GET | `/registrations/mine` | `registrations.apply` | SA AD ST | `get_leave_requests`, `get_my_electives` |
| POST | `/registrations/` | `registrations.apply` | SA AD ST | `register_for_elective` |
| PATCH | `/registrations/:id/withdraw` | `registrations.apply` | SA AD ST | `withdraw_elective_registration` |
| GET | `/registrations/review` | `registrations.review` | SA AD PR TE | `get_registration_reviews` |
| PATCH | `/registrations/:id/decision` | `registrations.review` | SA AD PR TE | **EXCEPTION** — elective registration decisions stay on screen |

### /student-requests

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/student-requests/cocurricular` | `cocurricular.read` | SA AD PR TE ST | `list_cocurricular` |
| POST | `/student-requests/cocurricular` | `cocurricular.request` | SA AD ST | `request_cocurricular` |
| GET | `/student-requests/cocurricular/review` | `cocurricular.review` | SA AD PR TE | `get_student_requests` |
| PATCH | `/student-requests/cocurricular/:id/decide` | `cocurricular.review` | SA AD PR TE | **EXCEPTION** — co-curricular decisions stay on screen |
| DELETE | `/student-requests/cocurricular/:id` | `cocurricular.request` | SA AD ST | `cancel_cocurricular_request` |
| GET | `/student-requests/profile-edits/fields` | `profile.edit.request` | SA AD ST | `get_editable_fields`, `request_profile_edit` |
| GET | `/student-requests/profile-edits/review` | `profile.edit.review` | SA AD PR TE | `get_student_requests` |
| GET | `/student-requests/profile-edits` | `profile.edit.request` | SA AD ST | `get_my_profile_edit_requests` |
| POST | `/student-requests/profile-edits` | `profile.edit.request` | SA AD ST | `request_profile_edit` |
| PATCH | `/student-requests/profile-edits/:id/decide` | `profile.edit.review` | SA AD PR TE | **EXCEPTION** — profile-edit decisions stay on screen |
| DELETE | `/student-requests/profile-edits/:id` | `profile.edit.request` | SA AD ST | `cancel_profile_edit_request` |

### /admissions

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/admissions/online/` | `admissions.read` | SA AD MK | `list_online_applications`, `get_online_application` |
| GET | `/admissions/online/:id` | `admissions.read` | SA AD MK | `get_online_application` |
| GET | `/admissions/pipeline` | `admissions.read` | SA AD MK | `get_admissions` |
| POST | `/admissions/leads` | `admissions.manage` | SA AD MK | `create_admission_lead` |
| POST | `/admissions/leads/bulk` | `admissions.manage` | SA AD MK | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| POST | `/admissions/leads/update` | `admissions.manage` | SA AD MK | `update_admission_lead` |
| GET | `/admissions/leads/:id` | `admissions.read` | SA AD MK | `get_admission_lead` |
| GET | `/admissions/followups/` | `admissions.read` | SA AD MK | `get_followup_queue` |
| GET | `/admissions/followups/counsellors` | `admissions.read` | SA AD MK | `get_counsellor_stats` |
| GET | `/admissions/followups/:leadId/score` | `admissions.read` | SA AD MK | `get_enquiry_score` |
| POST | `/admissions/followups/:leadId` | `admissions.manage` | SA AD MK | `log_admission_followup` |

### /growth

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/growth/score` | `ai.insights.read` (checked in handler); `analytics.child.read` (checked in handler) | SA AD PR PA | `get_growth_score`, `get_child_growth_view` |

### /risk

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/risk/scan` | `ai.insights.read` | SA AD PR | `get_risk_scan` |

### /ai

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/ai/drafts/` | `ai.drafts.use` | SA AD PR TE FI LI WA HR MK CO | `get_available_ai_draft_kinds` |
| POST | `/ai/drafts/` | `ai.drafts.use` | SA AD PR TE FI LI WA HR MK CO | **COVERED** — get_ai_draft (drafts.service.draft) |
| POST | `/ai/agent` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/agent) |
| POST | `/ai/agent/confirm` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/agent) |
| POST | `/ai/agent/continue` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/agent) |
| GET | `/ai/agent/capabilities` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/agent) |
| GET | `/ai/tutor/status` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/tutor) |
| GET | `/ai/tutor/syllabus` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/tutor) |
| POST | `/ai/tutor` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/tutor) |
| GET | `/ai/tutor/learn/status` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/tutor) |
| POST | `/ai/tutor/learn` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/ai/tutor) |
| GET | `/ai/credits` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_ai_credits` |
| GET | `/ai/credits/packs` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_ai_credits` |
| GET | `/ai/credits/orders` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_ai_credits` |
| POST | `/ai/credits/purchase` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — AI credit purchase (payment) |
| POST | `/ai/credits/purchase/verify` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — AI credit purchase verification (payment gateway) |

### /whatsapp

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/whatsapp/webhook` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/whatsapp/webhook` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/whatsapp/chatflow/webhook` | public (no sign-in) | public | **SCREEN** — Signed provider webhook (HMAC-verified machine endpoint), not a person's action. |
| POST | `/whatsapp/simulate` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/whatsapp) |
| GET | `/whatsapp/assistant-link` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/whatsapp) |
| POST | `/whatsapp/assistant-link/click` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/whatsapp) |

### /observability

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/observability/ready` | public (no sign-in) | public | **SCREEN** — System readiness probe (no person, no action). |
| GET | `/observability/metrics` | signed in (checked in service) | SA AD (requireRole SUPER_ADMIN/ADMIN) | **SCREEN** — platform observability |

### /library

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/library/copies/` | `library.manage` | SA AD LI | `find_library_copy` |
| POST | `/library/copies/generate` | `library.manage` | SA AD LI | `generate_library_accession_numbers` |
| GET | `/library/copies/labels` | `library.manage` | SA AD LI | **SCREEN** — label printing (printable label sheet) |
| POST | `/library/copies/labels/printed` | `library.manage` | SA AD LI | **SCREEN** — part of the label-printing flow: marks the sheet just printed on screen |
| POST | `/library/copies/scan` | `library.manage` | SA AD LI | `lend_copy_by_accession`, `checkin_copy_by_accession`, `update_library_copy_status` |
| POST | `/library/copies/scan/issue` | `library.manage` | SA AD LI | `lend_copy_by_accession` |
| POST | `/library/copies/scan/return` | `library.manage` | SA AD LI | `checkin_copy_by_accession` |
| PATCH | `/library/copies/:id` | `library.manage` | SA AD LI | `update_library_copy_status` |
| GET | `/library/desk/rules` | `library.read` | SA AD PA ST LI | `renew_library_loan`, `get_library_rules` |
| GET | `/library/desk/briefing` | `library.manage` | SA AD LI | `get_library_desk_briefing` |
| GET | `/library/desk/insights` | `library.manage` | SA AD LI | `get_library_insights` |
| GET | `/library/desk/overdue` | `library.manage` | SA AD LI | `list_overdue_loans` |
| POST | `/library/desk/overdue/remind` | `library.manage` | SA AD LI | `send_library_overdue_reminders` |
| POST | `/library/desk/loans/:id/renew` | `library.manage` | SA AD LI | `renew_library_loan` |
| GET | `/library/desk/fines` | `library.manage` | SA AD LI | `list_unpaid_library_fines` |
| POST | `/library/desk/loans/:id/fine` | `library.manage` | SA AD LI | **EXCEPTION** — settling/waiving a library fine is recording a payment; kept at the desk by product rule (p4Librarian.js header; tests/p4.supportRoles.test.js "a fine is settled by a person") |
| GET | `/library/desk/holds` | `library.manage` | SA AD LI | `list_library_reservation_queue` |
| POST | `/library/desk/holds` | `library.manage` | SA AD LI | `reserve_library_book` |
| POST | `/library/desk/holds/:id/cancel` | `library.manage` | SA AD LI | `cancel_library_reservation` |
| POST | `/library/desk/holds/:id/collect` | `library.manage` | SA AD LI | `lend_reserved_book` |
| GET | `/library/desk/suggestions/:studentId` | `library.manage` | SA AD LI | `suggest_books_for_student` |
| GET | `/library/desk/challenges` | `library.manage` | SA AD LI | `get_reading_challenge_progress` |
| POST | `/library/desk/challenges` | `library.manage` | SA AD LI | `create_reading_challenge` |
| GET | `/library/desk/challenges/mine` | `library.request` | SA AD PA ST | `list_my_reading_challenges` |
| GET | `/library/desk/challenges/:id` | `library.manage` | SA AD LI | `get_reading_challenge_progress` |
| POST | `/library/desk/challenges/:id/close` | `library.manage` | SA AD LI | `close_reading_challenge` |
| GET | `/library/summary` | `library.read` | SA AD PA ST LI | `get_library_summary` — not in catalogue for PA ST (get_library_summary: drop minScope 'ALL' (route is library.read with no minimum scope; it returns school-wide counts to any library.read holder)) |
| GET | `/library/books` | `library.read` (checked in handler); `students.read` (checked in handler) | SA AD PR TE PA ST FI LI WA NU | `list_books`, `get_book`, `list_book_issues` — not in catalogue for PR TE FI WA NU (libraryRead admits only library.read holders or a PARENT with students.read; PR/TE/FI/WA/NU hold neither) |
| POST | `/library/books` | `library.manage` | SA AD LI | `create_book` |
| POST | `/library/books/bulk` | `library.manage` | SA AD LI | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/library/books/facets` | `library.read` (checked in handler); `students.read` (checked in handler) | SA AD PR TE PA ST FI LI WA NU | `list_library_shelf_categories` — not in catalogue for PR TE FI WA NU (list_library_shelf_categories) |
| GET | `/library/books/:id` | `library.read` (checked in handler); `students.read` (checked in handler) | SA AD PR TE PA ST FI LI WA NU | `get_book`, `list_book_issues` — not in catalogue for PR TE FI WA NU (same libraryRead guard as /library/books) |
| PATCH | `/library/books/:id` | `library.manage` | SA AD LI | `update_book` |
| DELETE | `/library/books/:id` | `library.manage` | SA AD LI | `delete_book` |
| GET | `/library/issues` | `library.read` (checked in handler); `students.read` (checked in handler) | SA AD PR TE PA ST FI LI WA NU | `get_overdue_books`, `list_book_issues` — not in catalogue for PR TE FI WA NU (same libraryRead guard as /library/books) |
| POST | `/library/issues` | `library.manage` | SA AD LI | `issue_book` |
| POST | `/library/issues/bulk` | `library.manage` | SA AD LI | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| PATCH | `/library/issues/:id/return` | `library.manage` | SA AD LI | `return_book` |
| GET | `/library/requests/mine` | `library.request` | SA AD PA ST | `get_my_book_requests` |
| GET | `/library/requests/review` | `library.manage` | SA AD LI | `get_book_requests` |
| POST | `/library/requests` | `library.request` | SA AD PA ST | `request_book` |
| PATCH | `/library/requests/:id/cancel` | `library.request` | SA AD PA ST | `cancel_book_request` |
| PATCH | `/library/requests/:id/decision` | `library.manage` | SA AD LI | **EXCEPTION** — library book-request decision |

### /hostel

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/hostel/life/briefing` | `hostel.read` | SA AD WA | `get_hostel_night_briefing` |
| GET | `/hostel/life/residents` | `hostel.read` | SA AD WA | `mark_hostel_roll_call`, `log_hostel_incident`, `list_hostel_incidents`, `request_outpass_for_resident` |
| GET | `/hostel/life/rollcalls` | `hostel.read` | SA AD WA | `get_hostel_roll_call` |
| POST | `/hostel/life/rollcalls` | `hostel.manage` | SA AD WA | `start_hostel_roll_call` |
| GET | `/hostel/life/rollcalls/:id` | `hostel.read` | SA AD WA | `get_hostel_roll_call` |
| POST | `/hostel/life/rollcalls/:id/mark` | `hostel.manage` | SA AD WA | `mark_hostel_roll_call` |
| POST | `/hostel/life/rollcalls/:id/submit` | `hostel.manage` | SA AD WA | `submit_hostel_roll_call` |
| GET | `/hostel/life/mess/menu` | `hostel.read` | SA AD WA | `get_mess_menu` |
| PUT | `/hostel/life/mess/menu` | `hostel.manage` | SA AD WA | `update_mess_menu` |
| GET | `/hostel/life/mess/headcount` | `hostel.read` | SA AD WA | `get_mess_menu` |
| GET | `/hostel/life/mess/diet` | `hostel.manage`; `medical.read` | SA AD WA | **SCREEN** — health data (allergy/diet list) for a non-health role; privacy rule; p4Warden keeps it on the page |
| GET | `/hostel/life/incidents` | `hostel.read` | SA AD WA | `list_hostel_incidents`, `get_hostel_incident` |
| POST | `/hostel/life/incidents` | `hostel.manage` | SA AD WA | `log_hostel_incident` |
| GET | `/hostel/life/incidents/:id` | `hostel.read` | SA AD WA | `get_hostel_incident` |
| POST | `/hostel/life/incidents/:id/contact` | `hostel.manage` | SA AD WA | `log_parent_contact` |
| POST | `/hostel/life/incidents/:id/resolve` | `hostel.manage` | SA AD WA | `resolve_hostel_incident` |
| GET | `/hostel/summary` | `hostel.read` | SA AD WA | `get_hostel_summary` |
| GET | `/hostel/rooms` | `hostel.read` | SA AD WA | `list_hostel_rooms`, `list_hostel_allocations` |
| POST | `/hostel/rooms` | `hostel.manage` | SA AD WA | `create_hostel_room` |
| POST | `/hostel/rooms/bulk` | `hostel.manage` | SA AD WA | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/hostel/rooms/:id` | `hostel.read` | SA AD WA | `get_hostel_room` |
| PATCH | `/hostel/rooms/:id` | `hostel.manage` | SA AD WA | `update_hostel_room` |
| GET | `/hostel/allocations` | `hostel.read` | SA AD WA | `list_hostel_allocations` |
| POST | `/hostel/allocations` | `hostel.manage` | SA AD WA | `allocate_hostel_bed` |
| POST | `/hostel/allocations/bulk` | `hostel.manage` | SA AD WA | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| PATCH | `/hostel/allocations/:id/vacate` | `hostel.manage` | SA AD WA | `vacate_hostel_bed` |
| GET | `/hostel/students` | `hostel.read` | SA AD WA | `get_hostel_residents` |
| GET | `/hostel/medical-lookup/:studentId` | `hostel.read`; `medical.read` | SA AD WA | **SCREEN** — health data (medical record) for the warden; privacy rule: health data only to the health role / own parent |
| GET | `/hostel/inquiries` | `hostel.read` | SA AD WA | `list_hostel_inquiries` |
| POST | `/hostel/inquiries` | `hostel.read` | SA AD WA | `create_hostel_inquiry` |
| PATCH | `/hostel/inquiries/:id` | `hostel.manage` | SA AD WA | `update_hostel_inquiry` |

### /compliance

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/compliance/privacy/overview` | `compliance.read` | SA AD PR HR CO TR | `get_data_protection_overview` |
| GET | `/compliance/privacy/readiness` | `compliance.read` | SA AD PR HR CO TR | `get_compliance_readiness` |
| GET | `/compliance/privacy/committees` | `compliance.read` | SA AD PR HR CO TR | `list_statutory_committees` |
| POST | `/compliance/privacy/committees` | `compliance.manage` | SA AD CO | `save_statutory_committee` |
| PATCH | `/compliance/privacy/committees/:id` | `compliance.manage` | SA AD CO | `save_statutory_committee` |
| GET | `/compliance/privacy/requests` | `compliance.manage` | SA AD CO | `list_data_requests`, `get_data_request` |
| POST | `/compliance/privacy/requests` | `compliance.manage` | SA AD CO | `log_data_request` |
| GET | `/compliance/privacy/requests/:id` | `compliance.manage` | SA AD CO | `get_data_request` |
| PATCH | `/compliance/privacy/requests/:id` | `compliance.manage` | SA AD CO | `update_data_request` |
| GET | `/compliance/privacy/breaches` | `compliance.manage` | SA AD CO | `list_data_breaches` |
| POST | `/compliance/privacy/breaches` | `compliance.manage` | SA AD CO | `log_data_breach` |
| PATCH | `/compliance/privacy/breaches/:id` | `compliance.manage` | SA AD CO | `update_data_breach` |
| GET | `/compliance/my/policies` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_policies`, `acknowledge_policy` |
| POST | `/compliance/my/policies/:id/acknowledge` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `acknowledge_policy` |
| GET | `/compliance/my/trainings` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_trainings`, `acknowledge_my_training` |
| POST | `/compliance/my/trainings/:id/acknowledge` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `acknowledge_my_training` |
| GET | `/compliance/overview` | `compliance.read` | SA AD PR HR CO TR | `get_compliance_overview` |
| GET | `/compliance/calendar` | `compliance.read` | SA AD PR HR CO TR | `list_compliance_deadlines` |
| GET | `/compliance/obligations` | `compliance.read` | SA AD PR HR CO TR | `list_compliance_obligations` |
| POST | `/compliance/obligations` | `compliance.manage` | SA AD CO | `add_compliance_obligation` |
| POST | `/compliance/obligations/seed` | `compliance.manage` | SA AD CO | `create_sample_campus`, `add_standard_compliance_obligations` |
| PATCH | `/compliance/obligations/:id` | `compliance.manage` | SA AD CO | `update_compliance_obligation`, `record_obligation_applicability_decision` |
| GET | `/compliance/returns` | `compliance.read` | SA AD PR HR CO TR | `list_regulatory_returns`, `get_regulatory_return` |
| POST | `/compliance/returns` | `compliance.manage` | SA AD CO | `generate_regulatory_return` |
| GET | `/compliance/returns/:id` | `compliance.read` | SA AD PR HR CO TR | `get_regulatory_return` |
| GET | `/compliance/returns/:id/export.csv` | `compliance.read` | SA AD PR HR CO TR | **SCREEN** — CSV export download |
| GET | `/compliance/returns/:id/document` | `compliance.read` | SA AD PR HR CO TR | **SCREEN** — printable document (letterhead/watermark for print/PDF; records an export); figures readable via get_regulatory_return |
| POST | `/compliance/returns/:id/regenerate` | `compliance.manage` | SA AD CO | `move_regulatory_return` |
| POST | `/compliance/returns/:id/data` | `compliance.manage` | SA AD CO | `edit_regulatory_return_figures` |
| POST | `/compliance/returns/:id/review` | `compliance.manage` | SA AD CO | `move_regulatory_return` |
| POST | `/compliance/returns/:id/reviewed` | `compliance.manage` | SA AD CO | `record_return_review_decision` |
| POST | `/compliance/returns/:id/submission` | `compliance.manage` | SA AD CO | `move_regulatory_return` |
| POST | `/compliance/returns/:id/outcome` | `compliance.manage` | SA AD CO | `move_regulatory_return` |
| POST | `/compliance/returns/:id/reopen` | `compliance.manage` | SA AD CO | `move_regulatory_return` |
| GET | `/compliance/licences` | `compliance.read` | SA AD PR HR CO TR | `list_licences` |
| POST | `/compliance/licences` | `compliance.manage` | SA AD CO | `add_compliance_licence` |
| PATCH | `/compliance/licences/:id` | `compliance.manage` | SA AD CO | `update_compliance_licence` |
| GET | `/compliance/policies` | `compliance.read` | SA AD PR HR CO TR | `list_compliance_policies`, `get_compliance_policy` |
| POST | `/compliance/policies` | `compliance.manage` | SA AD CO | `create_compliance_policy` |
| GET | `/compliance/policies/:id` | `compliance.read` | SA AD PR HR CO TR | `get_compliance_policy` |
| POST | `/compliance/policies/:id/versions` | `compliance.manage` | SA AD CO | `draft_policy_version` |
| POST | `/compliance/policies/:id/submit` | `compliance.manage` | SA AD CO | `send_policy_for_approval` |
| GET | `/compliance/trainings` | `compliance.read` | SA AD PR HR CO TR | `list_compliance_trainings` |
| GET | `/compliance/trainings/coverage` | `compliance.read` | SA AD PR HR CO TR | `get_training_coverage` |
| POST | `/compliance/trainings` | `compliance.manage` | SA AD CO | `schedule_compliance_training` |
| POST | `/compliance/trainings/:id/attendance` | `compliance.manage` | SA AD CO | `update_training_attendance` |
| GET | `/compliance/accreditation/frameworks` | `compliance.read` | SA AD PR HR CO TR | `list_accreditation_frameworks` |
| GET | `/compliance/accreditation/mine` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_accreditation_items`, `update_accreditation_item` |
| GET | `/compliance/accreditation` | `compliance.read` | SA AD PR HR CO TR | `list_accreditation_cycles`, `get_accreditation_cycle` |
| POST | `/compliance/accreditation` | `compliance.manage` | SA AD CO | `create_accreditation_cycle` |
| GET | `/compliance/accreditation/:id` | `compliance.read` | SA AD PR HR CO TR | `get_accreditation_cycle` |
| POST | `/compliance/accreditation/:id/template-verified` | `compliance.manage` | SA AD CO | `move_accreditation_cycle` |
| POST | `/compliance/accreditation/:id/criteria` | `compliance.manage` | SA AD CO | `add_accreditation_criterion` |
| POST | `/compliance/accreditation/:id/criteria/:criterionId/items` | `compliance.manage` | SA AD CO | `add_accreditation_item` |
| PATCH | `/compliance/accreditation/:id/items/:itemId` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `update_accreditation_item` |
| POST | `/compliance/accreditation/:id/submission` | `compliance.manage` | SA AD CO | `move_accreditation_cycle` |
| POST | `/compliance/accreditation/:id/outcome` | `compliance.manage` | SA AD CO | `move_accreditation_cycle` |
| GET | `/compliance/notices` | `compliance.read` | SA AD PR HR CO TR | `list_regulatory_notices` |
| POST | `/compliance/notices` | `compliance.manage` | SA AD CO | `log_regulatory_notice` |
| POST | `/compliance/notices/:id/decide` | `compliance.manage` | SA AD CO | `update_regulatory_notice`, `record_notice_applicability_decision` |
| GET | `/compliance/notice-sources` | `compliance.read` | SA AD PR HR CO TR | `list_notice_sources` |
| POST | `/compliance/notice-sources` | `compliance.manage` | SA AD CO | `add_notice_source` |
| POST | `/compliance/notice-sources/:id/check` | `compliance.manage` | SA AD CO | `check_notice_source` |

### /dashboard

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/dashboard/admin` | `students.read` (ALL) | SA AD PR (requireRole SUPER_ADMIN/ADMIN/PRINCIPAL) | `get_dashboard` |
| GET | `/dashboard/finance` | `fees.read` (ALL) | SA AD PR FI (requireRole SUPER_ADMIN/ADMIN/PRINCIPAL/FINANCE) | `get_dashboard` |
| GET | `/dashboard/teacher` | `timetable.read` | TE (requireRole TEACHER) | `get_dashboard` |
| GET | `/dashboard/student` | `attendance.read` | ST (requireRole STUDENT) | `get_dashboard` |
| GET | `/dashboard/parent` | `students.read` | PA (requireRole PARENT) | `get_dashboard` |
| GET | `/dashboard/warden` | `hostel.read` | SA AD WA (requireRole SUPER_ADMIN/ADMIN/WARDEN) | `get_dashboard` |
| GET | `/dashboard/librarian` | `library.read` | SA AD LI (requireRole SUPER_ADMIN/ADMIN/LIBRARIAN) | `get_dashboard` |

### /documents

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/documents/` | `materials.read` | SA AD PR TE PA ST | `list_documents` |
| GET | `/documents/:id/file` | `materials.read` | SA AD PR TE PA ST | **SCREEN** — file download |
| POST | `/documents/` | `materials.manage` | SA AD PR TE | `create_course_material` |
| PUT | `/documents/:id` | `materials.manage` | SA AD PR TE | `update_course_material` |
| DELETE | `/documents/:id` | `materials.manage` | SA AD PR TE | `delete_document` |

### /transport

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/transport/routes` | `transport.read` | SA AD | `list_transport_routes` |
| POST | `/transport/routes` | `transport.manage` | SA AD | `create_transport_route` |
| POST | `/transport/routes/bulk` | `transport.manage` | SA AD | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| PATCH | `/transport/routes/:routeId` | `transport.manage` | SA AD | `update_transport_route` |
| GET | `/transport/routes/:routeId/stops` | `transport.read` | SA AD | `list_transport_stops` |
| POST | `/transport/stops` | `transport.manage` | SA AD | `create_transport_stop` |
| POST | `/transport/stops/bulk` | `transport.manage` | SA AD | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/transport/my-bus` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_bus` — not in catalogue for PR TE FI LI WA NU HR MK CO TR AL (getOwnBus answers only for a student's/parent's own child; staff have no implicit subject) |
| GET | `/transport/roster` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_transport_roster` |
| POST | `/transport/enroll` | `transport.manage` | SA AD | `enroll_in_transport` |
| POST | `/transport/enroll/bulk` | `transport.manage` | SA AD | **COVERED** — via Ask AI (file attach): the person attaches the CSV/Excel sheet in Ask AI (or sends it as a WhatsApp document); preview_import recognises it, maps the columns and checks every row, run_import imports it through this same bulk service after one confirmation on the website. |
| GET | `/transport/routes/available` | `transport.request` | SA AD PA ST | `get_transport_routes` |
| GET | `/transport/requests/mine` | `transport.request` | SA AD PA ST | `get_my_transport_requests` |
| GET | `/transport/requests/review` | `transport.manage` | SA AD | `get_transport_requests` |
| POST | `/transport/requests` | `transport.request` | SA AD PA ST | `request_transport_route` |
| PATCH | `/transport/requests/:id/cancel` | `transport.request` | SA AD PA ST | `cancel_transport_request` |
| PATCH | `/transport/requests/:id/decision` | `transport.manage` | SA AD | **EXCEPTION** — transport-request decision |

### /audit

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/audit/logs` | `audit.read` | SA AD PR | `list_audit_logs` |

### /seats

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/seats/summary` | `seats.read` (ALL) | SA AD | `get_seat_summary` |
| GET | `/seats/history` | `seats.read` (ALL) | SA AD | `list_seat_purchases` |
| GET | `/seats/price` | `seats.read` (ALL) | SA AD | **COVERED** — get_seat_summary (returns priceList from the same seatPrice.service.seatPriceList) |
| GET | `/seats/price/history` | `seats.read` (ALL) | SA AD | `list_seat_price_changes` |
| GET | `/seats/requests` | `seats.read` (ALL) | SA AD | `get_seat_requests`, `get_seat_request` |
| POST | `/seats/requests` | `seats.request` (ALL) | SA AD | `request_extra_seats` |
| GET | `/seats/requests/:id` | `seats.read` (ALL) | SA AD | `get_seat_request` |
| POST | `/seats/requests/:id/pay` | `seats.request` (ALL) | SA AD | **SCREEN** — seat purchase payment (gateway checkout) |
| POST | `/seats/payments/verify` | `seats.request` (ALL) | SA AD | **SCREEN** — seat purchase payment verify |
| GET | `/seats/schools` | `seats.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/seats/prices` | `seats.pricing.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PATCH | `/seats/prices/:priceId` | `seats.pricing.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/seats/schools/:tenantId/price` | `seats.pricing.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/seats/schools/:tenantId/price` | `seats.pricing.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/seats/schools/:tenantId/price/history` | `seats.pricing.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/seats/schools/:tenantId` | `seats.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/seats/schools/:tenantId/history` | `seats.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/seats/schools/:tenantId` | `seats.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/seats/requests/:id/decision` | `seats.approve` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |

### /customization

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/customization/theme` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_school_theme` |
| GET | `/customization/dropdowns/:key` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_school_dropdown` |
| GET | `/customization/` | `settings.manage` (ALL) | SA AD | `get_school_customization` |
| GET | `/customization/schools` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/customization/schools/:tenantId` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PUT | `/customization/schools/:tenantId` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| DELETE | `/customization/schools/:tenantId` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/customization/schools/:tenantId/theme` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/customization/schools/:tenantId/preview` | `customization.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |

### /domains

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/domains/resolve` | public (no sign-in) | public | **SCREEN** — Platform host-name resolution used by the web app before sign-in. |
| GET | `/domains/mine` | `domains.read` (ALL) | SA AD | `get_school_domain` |
| GET | `/domains/schools` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/domains/schools/:tenantId` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| GET | `/domains/schools/:tenantId/subdomain/suggestion` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PUT | `/domains/schools/:tenantId/subdomain` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| PUT | `/domains/schools/:tenantId/custom` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/verify` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/ssl-check` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/activate` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/deactivate` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/profile-domain/import` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |
| POST | `/domains/schools/:tenantId/profile-domain/dismiss` | `domains.manage` (ALL) | SA | **PLATFORM** — Super Admin only (platform operations; the platform administrator has no school assistant). |

### /uploads

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/uploads/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — file upload |

### /imports

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/imports/files` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **COVERED** — via Ask AI (file attach): the Ask AI attach button (and a WhatsApp document) stores the sheet here; preview_import and run_import then work on it. |
| GET | `/imports/formats` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `describe_import_formats` — not in catalogue for PA ST NU HR CO TR AL (A role with no import target (parent, student, nurse, HR, compliance, trustee, alumnus) gets an empty list on the screen too; the import tools are offered to the roles that can import something.) |
| GET | `/imports/templates/:name` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_import_template` — not in catalogue for PA ST NU HR CO TR AL (A role with no import target (parent, student, nurse, HR, compliance, trustee, alumnus) has no template to download; the import tools are offered to the roles that can import something.) |
| GET | `/imports/files/:id` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_import_result` — not in catalogue for PA ST NU HR CO TR AL (A role with no import target (parent, student, nurse, HR, compliance, trustee, alumnus) never has an import file to read; the import tools are offered to the roles that can import something.) |
| GET | `/imports/files/:id/:report` | `ai.copilot.use` | AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **COVERED** — via Ask AI (file attach): the error report is a download link run_import and get_import_result return with the result. |

### /approvals

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/approvals/inbox` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `list_pending_approvals`, `get_pending_items_for_me`, `list_compliance_deadlines`, `list_licences`, `list_open_correspondence`, `list_board_meetings`, `list_fest_plans`, `list_maintenance_work`, `list_purchase_requests`, `get_budget_position`, `list_payroll_runs`, `list_newsroom_posts`, `list_digital_lectures`, `get_syllabus_progress`, `record_concession_decision`, `get_approval_request`, `update_my_approval_request`, `declare_approval_conflict`, `escalate_approval_request` |
| GET | `/approvals/summary` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `get_approvals_summary` |
| GET | `/approvals/policies` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `list_approval_policies` |
| PUT | `/approvals/policies/:category` | `approvals.configure` | SA AD PR | `configure_approval_policy` |
| DELETE | `/approvals/policies/:category` | `approvals.configure` | SA AD PR | `configure_approval_policy` |
| GET | `/approvals/delegations` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `list_approval_delegations` |
| POST | `/approvals/delegations` | `approvals.decide` | SA AD PR FI HR TR | `delegate_approvals` |
| POST | `/approvals/delegations/:id/revoke` | `approvals.decide` | SA AD PR FI HR TR | `revoke_approval_delegation` |
| GET | `/approvals/` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `list_approval_requests`, `get_approval_request` |
| POST | `/approvals/` | `approvals.submit` | SA AD PR TE FI LI WA NU HR MK CO | `submit_approval_request` |
| GET | `/approvals/:id` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `get_approval_request` |
| POST | `/approvals/:id/decide` | `approvals.decide` | SA AD PR FI HR TR | `record_concession_decision` |
| POST | `/approvals/:id/resubmit` | `approvals.submit` | SA AD PR TE FI LI WA NU HR MK CO | `update_my_approval_request` |
| POST | `/approvals/:id/withdraw` | `approvals.submit` | SA AD PR TE FI LI WA NU HR MK CO | `update_my_approval_request` |
| POST | `/approvals/:id/conflict` | `approvals.decide` | SA AD PR FI HR TR | `declare_approval_conflict` |
| POST | `/approvals/:id/escalate` | `approvals.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `escalate_approval_request` |

### /messaging

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/messaging/preferences` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `translate_school_notice`, `get_my_message_preferences` |
| PUT | `/messaging/preferences` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `set_my_message_preferences` |
| GET | `/messaging/channels` | `messaging.read` | SA AD PR | `get_messaging_channels` |
| GET | `/messaging/outbox` | `messaging.read` | SA AD PR | `list_message_outbox` |
| POST | `/messaging/outbox/release` | `messaging.manage` | SA AD | `release_deferred_messages` |

### /automations

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/automations/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_school_automations` — not in catalogue for TE PA ST FI LI WA NU HR MK CO TR AL (Everyone sees the school list read-only on the page; in Ask AI a non-manager reads their own opt-ins (get_my_automation_optins), reminders and drafts, and the school-wide settings read (list_school_automations) goes to settings managers.) |
| PUT | `/automations/:key` | any of `settings.manage` (ALL) / `institution.manage` (ALL) | SA AD PR | `set_school_automation` |
| POST | `/automations/:key/run` | any of `settings.manage` (ALL) / `institution.manage` (ALL) | SA AD PR | `run_school_automation_now` |
| GET | `/automations/me/today` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_what_needs_me_today` |
| GET | `/automations/me/drafts` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_automation_drafts` |
| POST | `/automations/me/drafts/:id/confirm` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `confirm_automation_draft` |
| POST | `/automations/me/drafts/:id/dismiss` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `dismiss_automation_draft` |
| GET | `/automations/me/opt-ins` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_automation_optins` |
| PUT | `/automations/me/opt-ins/:key` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `set_my_automation_optin` |
| GET | `/automations/me/reminders` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_reminders` |
| POST | `/automations/me/reminders` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `create_my_reminder` |
| DELETE | `/automations/me/reminders/:id` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `stop_my_reminder` |

### /institution

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/institution/public/:slug` | public (no sign-in) | public | **SCREEN** — Public school page data for visitors; nobody signed in. |
| GET | `/institution/terminology` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_institution_terminology`, `create_sample_campus`, `add_standard_compliance_obligations` |
| GET | `/institution/features` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_school_features` |
| PUT | `/institution/features` | `settings.manage` (ALL) | SA AD | `set_module_switches` |
| GET | `/institution/` | `institution.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_institution_profile` |
| PUT | `/institution/` | `institution.manage` | SA AD PR | `update_institution_profile` |

### /org

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/org/chart` | `org.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `get_organisation_structure`, `create_org_unit`, `update_org_unit`, `delete_org_unit`, `create_org_position`, `update_org_position`, `delete_org_position`, `appoint_to_position`, `close_appointment` |
| GET | `/org/staff` | `org.read` | SA AD PR TE FI LI WA NU HR MK CO TR | `list_appointable_staff`, `appoint_to_position` |
| POST | `/org/bootstrap` | `org.manage` | SA AD HR | `create_sample_campus`, `add_standard_compliance_obligations`, `set_up_org_structure` |
| POST | `/org/units` | `org.manage` | SA AD HR | `create_org_unit` |
| PATCH | `/org/units/:id` | `org.manage` | SA AD HR | `update_org_unit` |
| DELETE | `/org/units/:id` | `org.manage` | SA AD HR | `delete_org_unit` |
| POST | `/org/positions` | `org.manage` | SA AD HR | `create_org_position` |
| PATCH | `/org/positions/:id` | `org.manage` | SA AD HR | `update_org_position` |
| DELETE | `/org/positions/:id` | `org.manage` | SA AD HR | `delete_org_position` |
| POST | `/org/appointments` | `org.manage` | SA AD HR | `appoint_to_position` |
| POST | `/org/appointments/:id/end` | `org.manage` | SA AD HR | `close_appointment` |

### /correspondence

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/correspondence/` | `correspondence.read` | SA AD PR CO | `list_open_correspondence`, `get_letter_deadlines`, `get_correspondence_letter` |
| GET | `/correspondence/stats` | `correspondence.read` | SA AD PR CO | `get_correspondence_stats` |
| POST | `/correspondence/` | `correspondence.manage` | SA AD | `log_correspondence` |
| POST | `/correspondence/extract` | `correspondence.read` | SA AD PR CO | `get_letter_deadlines` |
| POST | `/correspondence/reminders/run` | `correspondence.manage` | SA AD | `send_correspondence_reminders` |
| GET | `/correspondence/:id/document` | `correspondence.read` | SA AD PR CO | **SCREEN** — printable letter on letterhead (print/PDF output) |
| GET | `/correspondence/:id` | `correspondence.read` | SA AD PR CO | `get_correspondence_letter` |
| GET | `/correspondence/:id/suggest` | `correspondence.read` | SA AD PR CO | `get_letter_deadlines` |
| POST | `/correspondence/:id/assign` | `correspondence.manage` | SA AD | `assign_correspondence` |
| POST | `/correspondence/:id/verify-source` | `correspondence.read` | SA AD PR CO | `verify_correspondence_source` |
| POST | `/correspondence/:id/transition` | `correspondence.manage` | SA AD | `move_correspondence_letter` |
| POST | `/correspondence/:id/draft` | `correspondence.read` | SA AD PR CO | `draft_correspondence_reply` |
| POST | `/correspondence/:id/submit` | `correspondence.read` | SA AD PR CO | `send_correspondence_reply_for_approval` |
| POST | `/correspondence/:id/dispatch` | `correspondence.manage` | SA AD | `move_correspondence_letter` |
| POST | `/correspondence/:id/acknowledgement` | `correspondence.manage` | SA AD | `move_correspondence_letter` |
| POST | `/correspondence/:id/close` | `correspondence.manage` | SA AD | `move_correspondence_letter` |
| POST | `/correspondence/:id/reminders` | `correspondence.read` | SA AD PR CO | `add_correspondence_reminder` |
| POST | `/correspondence/:id/legal-hold` | `correspondence.manage` | SA AD | `set_correspondence_legal_hold` |

### /facilities

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/facilities/` | `facilities.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_my_policies`, `get_my_trainings`, `list_facility_bookings` |
| GET | `/facilities/stats` | `facilities.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_facility_stats` |
| POST | `/facilities/` | `facilities.manage` | SA AD | `create_facility` |
| POST | `/facilities/sample-campus` | `facilities.manage` | SA AD | `create_sample_campus`, `add_standard_compliance_obligations` |
| GET | `/facilities/bookings` | `facilities.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_facility_bookings` |
| POST | `/facilities/bookings` | `facilities.request` | SA AD PR TE FI LI WA NU HR MK CO | `request_facility_reservation` |
| POST | `/facilities/bookings/:id/decide` | `facilities.manage` | SA AD | `record_facility_booking_decision` |
| POST | `/facilities/bookings/:id/cancel` | `facilities.request` | SA AD PR TE FI LI WA NU HR MK CO | `cancel_facility_booking` |
| GET | `/facilities/work-orders` | `facilities.request` | SA AD PR TE FI LI WA NU HR MK CO | `list_maintenance_work`, `list_my_maintenance_reports` |
| POST | `/facilities/work-orders` | `facilities.request` | SA AD PR TE FI LI WA NU HR MK CO | `report_repair` |
| PATCH | `/facilities/work-orders/:id` | `facilities.manage` | SA AD | `update_work_order` |
| PATCH | `/facilities/:id` | `facilities.manage` | SA AD | `update_facility` |

### /institution-events

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/institution-events/` | `events.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_fest_plans`, `get_fest_plan` |
| POST | `/institution-events/` | `approvals.submit` | SA AD PR TE FI LI WA NU HR MK CO | `propose_fest_plan` |
| GET | `/institution-events/:id` | `events.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_fest_plan` |
| PATCH | `/institution-events/:id` | `events.read` | SA AD PR TE FI LI WA NU HR MK CO | `update_fest_plan` |
| POST | `/institution-events/:id/submit` | `approvals.submit` | SA AD PR TE FI LI WA NU HR MK CO | `submit_fest_plan` |
| POST | `/institution-events/:id/move` | `events.read` | SA AD PR TE FI LI WA NU HR MK CO | `move_fest_plan` |
| POST | `/institution-events/:id/complete` | `events.read` | SA AD PR TE FI LI WA NU HR MK CO | `move_fest_plan` |

### /contracts

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/contracts/` | `contracts.read` | SA AD PR FI CO | `list_agreements`, `get_agreement` |
| POST | `/contracts/` | `contracts.manage` | SA AD | `create_agreement` |
| GET | `/contracts/:id` | `contracts.read` | SA AD PR FI CO | `get_agreement` |
| PATCH | `/contracts/:id` | `contracts.manage` | SA AD | `update_agreement` |
| POST | `/contracts/:id/submit` | `contracts.manage` | SA AD | `submit_agreement_for_approval` |

### /verification

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/verification/` | `verification.read` | SA AD PR FI HR CO | `list_verification_cases`, `get_verification_case` |
| GET | `/verification/stats` | `verification.read` | SA AD PR FI HR CO | `get_verification_counts` |
| GET | `/verification/clearance` | `verification.read` | SA AD PR FI HR CO | `get_verification_clearance` |
| POST | `/verification/` | `verification.manage` | SA AD HR | `start_background_verification` |
| GET | `/verification/:id` | `verification.read` | SA AD PR FI HR CO | `get_verification_case` |
| POST | `/verification/:id/consent` | `verification.manage` | SA AD HR | `update_verification_case` |
| POST | `/verification/:id/checks/:checkId` | `verification.manage` | SA AD HR | `update_verification_case` |
| POST | `/verification/:id/hr-review` | `verification.manage` | SA AD HR | `record_verification_recommendation` |
| POST | `/verification/:id/decide` | `verification.decide` | SA PR | `record_verification_decision` |
| POST | `/verification/:id/dispute` | `verification.manage` | SA AD HR | `update_verification_case` |
| POST | `/verification/:id/dispute/resolve` | `verification.decide` | SA PR | `record_verification_dispute_resolution` |

### /safeguarding

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/safeguarding/guidance` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_safeguarding_guidance` |
| POST | `/safeguarding/reports` | `safeguarding.report` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — safeguarding reports (brief: only the static guidance may be read); goes straight to the DSL from the Safeguarding page |
| GET | `/safeguarding/reports/mine` | `safeguarding.report` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — safeguarding reports |
| GET | `/safeguarding/cases` | `safeguarding.manage` | CO | **SCREEN** — safeguarding case files |
| GET | `/safeguarding/cases/:id` | `safeguarding.manage` | CO | **SCREEN** — safeguarding case files |
| PATCH | `/safeguarding/cases/:id` | `safeguarding.manage` | CO | **SCREEN** — safeguarding case files / outcomes |

### /governance

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/governance/meetings` | `governance.read` | SA AD PR TR | `list_board_meetings`, `get_teacher_workload`, `get_board_pack`, `list_board_actions`, `list_certificate_requests`, `get_certificate_clearance`, `list_issued_certificates`, `get_board_meeting` |
| GET | `/governance/actions` | `governance.read` | SA AD PR TR | `list_board_actions`, `mark_board_action_done` |
| POST | `/governance/meetings` | `governance.manage` | SA AD PR | `schedule_board_meeting` |
| POST | `/governance/reminders/run` | `governance.manage` | SA AD PR | `send_board_meeting_reminders` |
| GET | `/governance/meetings/:id` | `governance.read` | SA AD PR TR | `get_board_meeting` |
| POST | `/governance/meetings/:id/availability` | `governance.read` | SA AD PR TR | `mark_board_meeting_availability` |
| POST | `/governance/meetings/:id/rsvp` | `governance.read` | SA AD PR TR | `respond_to_board_meeting`, `declare_meeting_conflict` |
| POST | `/governance/meetings/:id/schedule` | `governance.manage` | SA AD PR | `set_board_meeting_time` |
| POST | `/governance/meetings/:id/agenda` | `governance.manage` | SA AD PR | `set_board_agenda` |
| POST | `/governance/meetings/:id/record` | `governance.manage` | SA AD PR | `record_board_meeting` |
| POST | `/governance/meetings/:id/minutes/approve` | `governance.read` | SA AD PR TR | `record_board_minutes_approval` |
| POST | `/governance/meetings/:id/actions/:actionId` | `governance.read` | SA AD PR TR | `mark_board_action_done` |
| POST | `/governance/meetings/:id/cancel` | `governance.manage` | SA AD PR | `cancel_board_meeting` |

### /payroll

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/payroll/payslips/mine` | `payroll.read` | SA AD PR TE FI LI WA NU HR MK CO | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/rules` | `payroll.read` (ALL) | SA AD PR FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/rules` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/rules/seed` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/rules/:id/verify` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/compensation` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| PUT | `/payroll/compensation` | `payroll.sensitive.read`; `payroll.prepare` | FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/runs` | `payroll.read` (ALL) | SA AD PR FI HR | `list_payroll_runs`, `get_payroll_run` |
| POST | `/payroll/runs` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/runs/:id` | `payroll.read` (ALL) | SA AD PR FI HR | `get_payroll_run` |
| PUT | `/payroll/runs/:id/inputs` | `payroll.prepare` | SA FI HR | `update_payroll_inputs` |
| POST | `/payroll/runs/:id/calculate` | `payroll.prepare` | SA FI HR | `calculate_payroll_run` |
| POST | `/payroll/runs/:id/submit` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/runs/:id/reopen` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/runs/:id/bank-file.csv` | `payroll.sensitive.read`; `payroll.prepare` | FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/runs/:id/payment-initiated` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/runs/:id/payment-confirmed` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/runs/:id/statutory/:code.csv` | `payroll.sensitive.read`; `payroll.prepare` | FI HR | **SCREEN** — payroll (restricted pay data) |
| GET | `/payroll/runs/:id/statutory/EPF_ECR.txt` | `payroll.sensitive.read`; `payroll.prepare` | FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/runs/:id/statutory` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |
| POST | `/payroll/runs/:id/close` | `payroll.prepare` | SA FI HR | **SCREEN** — payroll (restricted pay data) |

### /procurement

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/procurement/stats` | `procurement.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_procurement_stats` |
| GET | `/procurement/vendors` | `procurement.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_vendors` |
| POST | `/procurement/vendors` | `procurement.manage` | SA AD FI | `create_vendor` |
| POST | `/procurement/vendors/:id/due-diligence` | `procurement.manage` | SA AD FI | `record_vendor_due_diligence` |
| POST | `/procurement/vendors/:id/conflict` | `procurement.request` | SA AD PR TE FI LI WA NU HR MK CO | `declare_vendor_conflict` |
| GET | `/procurement/requests` | `procurement.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_purchase_requests`, `get_purchase_request` |
| POST | `/procurement/requests` | `procurement.request` | SA AD PR TE FI LI WA NU HR MK CO | `create_purchase_request` |
| GET | `/procurement/requests/:id` | `procurement.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_purchase_request` |
| PUT | `/procurement/requests/:id/quotes` | `procurement.request` | SA AD PR TE FI LI WA NU HR MK CO | `set_purchase_quotes` |
| POST | `/procurement/requests/:id/submit` | `procurement.request` | SA AD PR TE FI LI WA NU HR MK CO | `transition_purchase_request` |
| POST | `/procurement/requests/:id/cancel` | `procurement.request` | SA AD PR TE FI LI WA NU HR MK CO | `transition_purchase_request` |
| POST | `/procurement/requests/:id/po` | `procurement.manage` | SA AD FI | `move_purchase_request` |
| POST | `/procurement/requests/:id/receive` | `procurement.manage` | SA AD FI | `move_purchase_request` |
| POST | `/procurement/requests/:id/invoice` | `procurement.manage` | SA AD FI | `move_purchase_request` |
| POST | `/procurement/requests/:id/approve-payment` | `procurement.manage` | SA AD FI | **EXCEPTION** — procurement payment approval |
| POST | `/procurement/requests/:id/payment-initiated` | `procurement.manage` | SA AD FI | **EXCEPTION** — procurement payment initiated |
| POST | `/procurement/requests/:id/payment-confirmed` | `procurement.manage` | SA AD FI | **EXCEPTION** — procurement payment confirmed |
| GET | `/procurement/assets` | `procurement.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_procurement_assets` |
| PATCH | `/procurement/assets/:id` | `procurement.manage` | SA AD FI | `update_procurement_asset` |

### /budgets

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/budgets/` | `budget.read` | SA AD PR FI TR | `get_budget_position` |
| POST | `/budgets/` | `budget.manage` | SA AD FI | `draft_budget` |
| POST | `/budgets/:id/submit` | `budget.manage` | SA AD FI | `submit_budget` |
| POST | `/budgets/:id/variance` | `budget.manage` | SA AD FI | `add_budget_variance_note` |
| GET | `/budgets/funding` | `funding.read` | SA AD PR FI TR | `list_funding_proposals` |
| POST | `/budgets/funding` | `funding.manage` | SA AD FI | `create_funding_proposal` |
| POST | `/budgets/funding/:id/submit` | `funding.manage` | SA AD FI | `transition_funding_proposal` |
| PATCH | `/budgets/funding/:id` | `funding.manage` | SA AD FI | `transition_funding_proposal` |

### /lectures

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/lectures/` | `lectures.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_digital_lectures`, `get_online_class`, `get_online_class_attendance` |
| GET | `/lectures/options` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `get_online_class_options` |
| GET | `/lectures/stats` | `lectures.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_online_class_stats` |
| POST | `/lectures/` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `schedule_online_class` |
| GET | `/lectures/:id` | `lectures.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_online_class` |
| POST | `/lectures/:id/join` | `lectures.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `join_online_class` |
| PATCH | `/lectures/:id` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `reschedule_online_class` |
| POST | `/lectures/:id/cancel` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `cancel_online_class` |
| POST | `/lectures/:id/finish` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `finish_online_class` |
| GET | `/lectures/:id/attendance` | `lectures.manage` | SA AD PR TE FI LI WA NU HR MK CO | `get_online_class_attendance` |

### /syllabus

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/syllabus/` | `syllabus.read` | SA AD PR TE PA ST | `get_syllabus_progress`, `get_syllabus_plan` |
| GET | `/syllabus/offerings` | `syllabus.manage` | SA AD PR TE | `log_syllabus_progress`, `list_lesson_plans`, `get_lesson_plan_suggestion`, `save_lesson_plan`, `mark_lesson_taught`, `add_lesson_plan_feedback`, `search_question_bank`, `add_bank_question`, `build_question_paper`, `check_question_paper`, `make_quiz_from_paper`, `create_quiz_draft`, `plan_syllabus_module`, `save_report_card_component_marks`, `save_co_scholastic_grades`, `update_syllabus_module`, `delete_syllabus_module`, `get_lesson_plan`, `update_lesson_plan`, `delete_lesson_plan`, `duplicate_lesson_plan`, `update_bank_question`, `archive_bank_question`, `draft_question_paper` |
| GET | `/syllabus/offerings/:offeringId` | `syllabus.read` | SA AD PR TE PA ST | `log_syllabus_progress`, `update_syllabus_module`, `delete_syllabus_module`, `get_syllabus_plan` |
| POST | `/syllabus/modules` | `syllabus.manage` | SA AD PR TE | `plan_syllabus_module` |
| PATCH | `/syllabus/modules/:id` | `syllabus.manage` | SA AD PR TE | `update_syllabus_module` |
| POST | `/syllabus/modules/:id/progress` | `syllabus.manage` | SA AD PR TE | `log_syllabus_progress` |
| DELETE | `/syllabus/modules/:id` | `syllabus.manage` | SA AD PR TE | `delete_syllabus_module` |

### /teaching

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/teaching/lesson-plans` | `syllabus.manage` | SA AD PR TE | `list_lesson_plans`, `get_lesson_plan` |
| POST | `/teaching/lesson-plans/suggest` | `syllabus.manage` | SA AD PR TE | `save_lesson_plan` |
| POST | `/teaching/lesson-plans` | `syllabus.manage` | SA AD PR TE | `save_lesson_plan` |
| GET | `/teaching/lesson-plans/:id` | `syllabus.manage` | SA AD PR TE | `get_lesson_plan` |
| PATCH | `/teaching/lesson-plans/:id` | `syllabus.manage` | SA AD PR TE | `update_lesson_plan` |
| DELETE | `/teaching/lesson-plans/:id` | `syllabus.manage` | SA AD PR TE | `delete_lesson_plan` |
| POST | `/teaching/lesson-plans/:id/copy` | `syllabus.manage` | SA AD PR TE | `duplicate_lesson_plan` |
| POST | `/teaching/lesson-plans/:id/taught` | `syllabus.manage` | SA AD PR TE | `mark_lesson_taught` |
| POST | `/teaching/lesson-plans/:id/feedback` | `syllabus.manage` | SA AD PR TE | `add_lesson_plan_feedback` — not in catalogue for TE (lessonPlans.addFeedback refuses anyone without syllabus.manage ALL (feedback is the principal's / coordinator's)) |
| GET | `/teaching/question-bank/scopes` | `syllabus.manage` | SA AD PR TE | `list_question_bank_scopes` |
| GET | `/teaching/question-bank` | `syllabus.manage` | SA AD PR TE | `search_question_bank` |
| POST | `/teaching/question-bank` | `syllabus.manage` | SA AD PR TE | `add_bank_question` |
| PATCH | `/teaching/question-bank/:id` | `syllabus.manage` | SA AD PR TE | `update_bank_question` |
| DELETE | `/teaching/question-bank/:id` | `syllabus.manage` | SA AD PR TE | `archive_bank_question` |
| GET | `/teaching/papers` | `syllabus.manage` | SA AD PR TE | `check_question_paper`, `get_question_paper` |
| POST | `/teaching/papers` | `syllabus.manage` | SA AD PR TE | `draft_question_paper` |
| POST | `/teaching/papers/build` | `syllabus.manage` | SA AD PR TE | `build_question_paper` |
| POST | `/teaching/papers/to-quiz` | `syllabus.manage` | SA AD PR TE | `make_quiz_from_paper` — not in catalogue for PR (the route also requires assignments.manage (assignScope), which the principal does not hold) |
| GET | `/teaching/papers/:id` | `syllabus.manage` | SA AD PR TE | `get_question_paper` |
| PATCH | `/teaching/papers/:id` | `syllabus.manage` | SA AD PR TE | `update_question_paper` |
| POST | `/teaching/papers/:id/final` | `syllabus.manage` | SA AD PR TE | `finalise_question_paper` |
| DELETE | `/teaching/papers/:id` | `syllabus.manage` | SA AD PR TE | `delete_question_paper` |
| GET | `/teaching/paper-results` | `marks.read` | SA AD PR TE PA ST | `get_paper_results` |
| GET | `/teaching/cpd` | any of `staffleave.apply` / `staffleave.manage` | SA AD PR TE FI LI WA NU HR MK CO | `get_my_cpd_hours`, `delete_cpd_entry` |
| POST | `/teaching/cpd` | any of `staffleave.apply` / `staffleave.manage` | SA AD PR TE FI LI WA NU HR MK CO | `log_cpd_hours` |
| DELETE | `/teaching/cpd/:id` | any of `staffleave.apply` / `staffleave.manage` | SA AD PR TE FI LI WA NU HR MK CO | `delete_cpd_entry` |
| GET | `/teaching/cpd/overview` | `staffleave.manage` (ALL) | SA AD PR HR | `list_staff_cpd_hours`, `record_cpd_verification` |
| POST | `/teaching/cpd/:id/verify` | `staffleave.manage` (ALL) | SA AD PR HR | `record_cpd_verification` |

### /tasks

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/tasks/` | `tasks.read` | SA AD PR TE FI LI WA NU HR MK CO | `list_due_items` |
| GET | `/tasks/summary` | `tasks.read` | SA AD PR TE FI LI WA NU HR MK CO | `get_due_items_summary` |
| POST | `/tasks/` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `create_due_item` |
| POST | `/tasks/:id/acknowledge` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `acknowledge_due_item` |
| POST | `/tasks/:id/snooze` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `snooze_due_item` |
| POST | `/tasks/:id/complete` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `complete_due_item` |
| POST | `/tasks/:id/reassign` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `reassign_due_item` — not in catalogue for TE FI LI WA NU HR MK (tasks.service.reassign refuses any scope but ALL, so TE/FI/LI/WA/NU/HR/MK (tasks.manage OWN) cannot use the route either) |
| POST | `/tasks/:id/cancel` | `tasks.manage` | SA AD PR TE FI LI WA NU HR MK CO | `cancel_due_item` |

### /fleet

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/fleet/telemetry` | public (no sign-in) | public | **SCREEN** — Device-signed endpoint (GPS tracker, ID reader, camera) authenticated by device key, not by a person. |
| GET | `/fleet/my-trips` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_child_bus` — not in catalogue for TE FI LI WA NU HR MK CO TR AL (get_my_child_bus: permission 'transport.tracking.read' -> 'transport.request' (students hold transport.request OWN and myTrips serves a student's own trips); staff PARTIAL-OK (ownStudentIds is [] for staff)) |
| GET | `/fleet/vehicles` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` (ALL) / `transport.read` (ALL) | SA AD PR | `list_vehicles`, `get_vehicle`, `get_vehicle_track` |
| POST | `/fleet/vehicles` | `transport.fleet.manage` | SA AD | `add_vehicle` |
| GET | `/fleet/vehicles/:id` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` (ALL) / `transport.read` (ALL) | SA AD PR | `get_vehicle` |
| PATCH | `/fleet/vehicles/:id` | `transport.fleet.manage` | SA AD | `update_vehicle` |
| POST | `/fleet/vehicles/:id/status` | `transport.fleet.manage` | SA AD | `set_vehicle_status` |
| POST | `/fleet/vehicles/:id/logs` | `transport.fleet.manage` | SA AD | `log_vehicle_event` |
| POST | `/fleet/vehicles/:id/logs/:logId/resolve` | `transport.fleet.manage` | SA AD | `resolve_vehicle_breakdown` |
| PUT | `/fleet/vehicles/:id/gps-device` | `transport.fleet.manage` | SA AD | `set_vehicle_gps_device` |
| GET | `/fleet/vehicles/:id/track` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` (ALL) / `transport.read` (ALL) | SA AD PR | `get_vehicle_track` |
| GET | `/fleet/fuel` | `transport.fleet.manage` | SA AD | `get_fleet_fuel_summary` |
| GET | `/fleet/live` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` (ALL) / `transport.read` (ALL) | SA AD PR | `get_live_bus_status` |
| GET | `/fleet/trips` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` | SA AD PR TE | `list_trips`, `get_bus_trip` |
| POST | `/fleet/trips` | `transport.fleet.manage` | SA AD | `plan_bus_trip` |
| POST | `/fleet/trips/plan-day` | `transport.fleet.manage` | SA AD | `plan_bus_trips_for_day` |
| GET | `/fleet/trips/:id` | any of `transport.fleet.manage` / `transport.tracking.read` (ALL) / `transport.trips.operate` | SA AD PR TE | `get_bus_trip` |
| POST | `/fleet/trips/:id/crew` | `transport.fleet.manage` | SA AD | `set_trip_crew` |
| POST | `/fleet/trips/:id/substitute` | `transport.fleet.manage` | SA AD | `substitute_trip_vehicle` |
| POST | `/fleet/trips/:id/cancel` | `transport.fleet.manage` | SA AD | `cancel_bus_trip` |
| POST | `/fleet/trips/:id/allocate` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `manage_trip_seat` |
| POST | `/fleet/trips/:id/allocate-enrolled` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `allocate_enrolled_to_trip` |
| POST | `/fleet/trips/:id/allocations/:allocationId/release` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `manage_trip_seat` |
| POST | `/fleet/trips/:id/start` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `move_bus_trip` |
| POST | `/fleet/trips/:id/stops/:stopId` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `mark_trip_stop` |
| POST | `/fleet/trips/:id/board` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `record_trip_boarding` |
| POST | `/fleet/trips/:id/alight` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `record_trip_boarding` |
| POST | `/fleet/trips/:id/no-show` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `record_trip_boarding` |
| POST | `/fleet/trips/:id/handover` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `record_trip_handover` |
| POST | `/fleet/trips/:id/reconcile` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `move_bus_trip` |
| POST | `/fleet/trips/:id/complete` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `move_bus_trip` |
| POST | `/fleet/trips/:id/suppress-alerts` | any of `transport.fleet.manage` / `transport.trips.operate` | SA AD TE | `suppress_trip_alerts` |

### /checkpoints

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/checkpoints/scan` | `checkpoints.manage` (checked in handler) | public | **SCREEN** — Device-signed endpoint (GPS tracker, ID reader, camera) authenticated by device key, not by a person. |
| GET | `/checkpoints/my-children` | `checkpoints.read` | SA AD PR PA WA CO | `get_my_child_checkpoints` |
| GET | `/checkpoints/events` | `checkpoints.read` (ALL) | SA AD PR WA CO | `get_my_child_checkpoints` |
| GET | `/checkpoints/attendance-suggestions` | any of `checkpoints.read` (ALL) / `attendance.mark` (ALL) / `attendance.read` (ALL) | SA AD PR WA CO | `get_checkpoint_attendance_suggestions` |
| GET | `/checkpoints/cards` | `checkpoints.read` (ALL) | SA AD PR WA CO | `list_id_cards`, `get_id_card_log` |
| POST | `/checkpoints/cards` | `checkpoints.manage` | SA AD | `issue_id_card` |
| GET | `/checkpoints/cards/:id/history` | `checkpoints.read` (ALL) | SA AD PR WA CO | `get_id_card_log` |
| POST | `/checkpoints/cards/:id/block` | `checkpoints.manage` | SA AD | `block_id_card` |
| POST | `/checkpoints/cards/:id/replace` | `checkpoints.manage` | SA AD | `issue_replacement_id_card` |

### /visitors

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/visitors/` | `visitors.manage` | SA AD PR CO | `get_visitors_on_site` |
| GET | `/visitors/hosting` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_hosted_visitors`, `record_visitor_host_decision`, `list_safety_alerts` — not in catalogue for PA ST TR AL (list_my_hosted_visitors) |
| POST | `/visitors/` | `visitors.manage` (checked in handler) | SA AD PR CO | `add_visitor` |
| POST | `/visitors/:id/host-decision` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `record_visitor_host_decision` — not in catalogue for PA ST TR AL (record_visitor_host_decision (approver-confirmed)) |
| POST | `/visitors/:id/check-in` | `visitors.manage` | SA AD PR CO | `update_visitor` |
| POST | `/visitors/:id/check-out` | `visitors.manage` | SA AD PR CO | `update_visitor` |
| POST | `/visitors/:id/cancel` | `visitors.manage` | SA AD PR CO | `update_visitor` |

### /pickup

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/pickup/mine` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_visitors_on_site`, `list_my_child_delegates`, `confirm_pickup_delegation`, `revoke_pickup_delegation`, `list_outpasses`, `get_staff_leave_balance` — not in catalogue for ST TR AL (guardianList refuses anyone but a PARENT) |
| POST | `/pickup/mine/delegates` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `request_pickup_delegation` — not in catalogue for TE ST FI LI WA NU HR MK CO TR AL (guardianRequest asserts the caller is the child's PARENT) |
| POST | `/pickup/mine/delegates/:id/confirm` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `confirm_pickup_delegation` — not in catalogue for TE ST FI LI WA NU HR MK CO TR AL (guardianConfirm asserts the caller is the child's PARENT) |
| POST | `/pickup/mine/delegates/:id/revoke` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `revoke_pickup_delegation`, `revoke_pickup_adult` — not in catalogue for TE ST FI LI WA NU HR MK TR AL (revoke(asGuardian) asserts the caller is the child's PARENT) |
| GET | `/pickup/students/:studentId` | `visitors.manage` | SA AD PR CO | `list_student_pickup_adults` |
| POST | `/pickup/adults` | `visitors.manage` | SA AD PR CO | `add_student_pickup_adult` |
| POST | `/pickup/adults/:id/revoke` | `visitors.manage` | SA AD PR CO | `revoke_pickup_delegation`, `revoke_pickup_adult` |
| POST | `/pickup/release` | `visitors.manage` | SA AD PR CO | `record_pickup_release` |
| GET | `/pickup/releases` | `visitors.manage` | SA AD PR CO | `list_gate_releases` |

### /outpass

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/outpass/` | any of `hostel.outpass.manage` / `hostel.outpass.request` | SA AD PR PA ST WA | `list_my_outpasses`, `list_outpasses`, `get_outpass_record` |
| POST | `/outpass/` | any of `hostel.outpass.manage` / `hostel.outpass.request` | SA AD PR PA ST WA | `request_outpass`, `request_outpass_for_resident` |
| GET | `/outpass/:id` | any of `hostel.outpass.manage` / `hostel.outpass.request` | SA AD PR PA ST WA | `get_outpass_record` |
| POST | `/outpass/:id/parent-decision` | `hostel.outpass.request` | SA AD PA ST | `record_outpass_consent` |
| POST | `/outpass/:id/decision` | `hostel.outpass.manage` | SA AD PR WA | `record_outpass_decision` |
| POST | `/outpass/:id/gate` | `hostel.outpass.manage` | SA AD PR WA | `record_outpass_gate` |
| POST | `/outpass/:id/cancel` | any of `hostel.outpass.manage` / `hostel.outpass.request` | SA AD PR PA ST WA | `cancel_outpass`, `cancel_resident_outpass` |

### /camera

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/camera/events` | public (no sign-in) | public | **SCREEN** — Device-signed endpoint (GPS tracker, ID reader, camera) authenticated by device key, not by a person. |
| POST | `/camera/heartbeat` | public (no sign-in) | public | **SCREEN** — Device-signed endpoint (GPS tracker, ID reader, camera) authenticated by device key, not by a person. |
| GET | `/camera/status` | any of `camera.events.review` / `camera.devices.manage` | SA AD PR CO | **SCREEN** — camera |
| GET | `/camera/devices` | any of `camera.events.review` / `camera.devices.manage` | SA AD PR CO | **SCREEN** — camera devices |
| GET | `/camera/observations` | `camera.events.review` | PR CO | **SCREEN** — camera observations |
| GET | `/camera/observations/:id` | `camera.events.review` | PR CO | **SCREEN** — camera observations |
| POST | `/camera/observations/:id/review` | `camera.events.review` | PR CO | **SCREEN** — camera observations |
| POST | `/camera/observations/:id/link-case` | `camera.events.review` | PR CO | **SCREEN** — camera observations / safeguarding case |
| GET | `/camera/metrics` | `camera.events.review` | PR CO | **SCREEN** — camera metrics |

### /class-check-ins

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/class-check-ins/mine` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_class_check_ins` — not in catalogue for PA ST TR AL (list_my_class_check_ins) |
| GET | `/class-check-ins/board` | any of `cover.manage` (ALL) / `camera.events.review` | SA AD PR HR CO | `get_class_presence_board` |
| POST | `/class-check-ins/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `check_in_to_class` — not in catalogue for PA ST TR AL (check_in_to_class) |

### /safety

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/safety/settings` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | `get_safety_settings` |
| PUT | `/safety/settings` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | `update_safety_settings` |
| GET | `/safety/alerts` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_safety_alerts` — not in catalogue for PA ST TR AL (list_safety_alerts) |
| POST | `/safety/alerts/:id` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `update_safety_alert` — not in catalogue for PA ST TR AL (update_safety_alert) |
| GET | `/safety/devices` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | `list_safety_devices` |
| POST | `/safety/devices` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | **SCREEN** — device registration returns the device secret once (device secrets) |
| POST | `/safety/devices/:id/rotate-secret` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | **SCREEN** — device secret rotation |
| POST | `/safety/devices/:id/status` | any of `transport.fleet.manage` / `checkpoints.manage` / `visitors.manage` / `hostel.outpass.manage` / `camera.devices.manage` | SA AD PR WA CO | `set_safety_device_status` |
| GET | `/safety/emergency-roster` | any of `visitors.manage` / `checkpoints.read` (ALL) | SA AD PR WA CO | `get_emergency_roster` |

### /ptm

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/ptm/rounds` | `ptm.read` | SA AD PR TE PA | `list_ptm_rounds`, `get_ptm_slots`, `list_my_ptm_bookings`, `list_review_calls`, `list_conversations`, `read_conversation`, `list_term_report_cards`, `get_term_report_remark_draft`, `list_clubs`, `get_my_club_memberships`, `list_club_sessions`, `search_alumni`, `list_alumni_events`, `list_social_posts`, `list_eco_activities`, `list_online_applications`, `find_library_copy`, `get_ptm_round_schedule`, `list_my_ptm_slots`, `get_ptm_meeting_sheet`, `list_ptm_unbooked_families`, `get_ptm_metrics`, `get_ptm_options_for_pupil` |
| POST | `/ptm/rounds` | `ptm.manage` | SA AD PR TE | `create_ptm_round` — not in catalogue for TE (ptm.service.createRound refuses scope != ALL; TE holds ptm.manage OWN) |
| GET | `/ptm/rounds/:id` | `ptm.read` | SA AD PR TE PA | `get_ptm_round_schedule` |
| PATCH | `/ptm/rounds/:id` | `ptm.manage` | SA AD PR TE | `update_ptm_round` — not in catalogue for TE (ptm.service.updateRound refuses scope != ALL; TE holds ptm.manage OWN) |
| POST | `/ptm/rounds/:id/cancel` | `ptm.manage` | SA AD PR TE | `cancel_ptm_round` — not in catalogue for TE (ptm.service.cancelRound refuses scope != ALL; TE holds ptm.manage OWN) |
| POST | `/ptm/rounds/:id/availability` | `ptm.manage` | SA AD PR TE | `add_ptm_availability` |
| GET | `/ptm/rounds/:id/slots` | `ptm.manage` | SA AD PR TE | `list_my_ptm_slots` |
| GET | `/ptm/rounds/:id/options` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `get_ptm_slots`, `reserve_ptm_slot`, `reschedule_ptm_booking`, `join_ptm_waitlist`, `accept_ptm_slot_offer`, `cancel_ptm_waitlist_entry`, `get_ptm_options_for_pupil` |
| GET | `/ptm/rounds/:id/sheet` | any of `ptm.manage` / `ptm.read` | SA AD PR TE PA | `get_ptm_meeting_sheet` |
| GET | `/ptm/rounds/:id/unbooked` | `ptm.manage` | SA AD PR TE | `list_ptm_unbooked_families` |
| POST | `/ptm/slots/:id/block` | `ptm.manage` | SA AD PR TE | `block_ptm_slot` |
| POST | `/ptm/slots/:id/unblock` | `ptm.manage` | SA AD PR TE | `unblock_ptm_slot` |
| GET | `/ptm/bookings` | any of `ptm.read` / `ptm.manage` / `ptm.book` | SA AD PR TE PA | `list_my_ptm_bookings`, `reschedule_ptm_booking`, `cancel_ptm_booking`, `check_in_ptm_meeting`, `mark_ptm_no_show`, `record_ptm_outcome`, `get_ptm_meeting_briefing` |
| POST | `/ptm/bookings` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `reserve_ptm_slot`, `reserve_ptm_slot_for_family` |
| POST | `/ptm/bookings/:id/cancel` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `cancel_ptm_booking`, `change_family_ptm_booking` |
| POST | `/ptm/bookings/:id/reschedule` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `reschedule_ptm_booking`, `change_family_ptm_booking` |
| POST | `/ptm/bookings/:id/check-in` | `ptm.manage` | SA AD PR TE | `check_in_ptm_meeting` |
| POST | `/ptm/bookings/:id/no-show` | `ptm.manage` | SA AD PR TE | `mark_ptm_no_show` |
| POST | `/ptm/bookings/:id/outcome` | `ptm.manage` | SA AD PR TE | `record_ptm_outcome` |
| GET | `/ptm/bookings/:id/briefing` | `ptm.manage` | SA AD PR TE | `get_ptm_meeting_briefing` |
| POST | `/ptm/waitlist` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `join_ptm_waitlist`, `manage_family_ptm_waitlist` |
| POST | `/ptm/waitlist/:id/leave` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `cancel_ptm_waitlist_entry`, `manage_family_ptm_waitlist` |
| POST | `/ptm/waitlist/:id/accept` | any of `ptm.book` / `ptm.manage` | SA AD PR TE PA | `accept_ptm_slot_offer` — not in catalogue for AD PR TE (ptm.service.acceptOffer accepts only for the parent the slot is held for; staff cannot accept for a family) |
| GET | `/ptm/metrics` | any of `ptm.manage` / `ptm.read` | SA AD PR TE PA | `get_ptm_metrics` |

### /review-calls

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/review-calls/` | `reviewcalls.manage` | SA AD PR TE | `list_review_calls`, `get_review_call`, `get_review_call_briefing` |
| GET | `/review-calls/metrics` | `reviewcalls.manage` | SA AD PR TE | `get_review_call_metrics` |
| POST | `/review-calls/` | `reviewcalls.manage` | SA AD PR TE | `open_review_call` |
| GET | `/review-calls/:id` | `reviewcalls.manage` | SA AD PR TE | `get_review_call` |
| PATCH | `/review-calls/:id` | `reviewcalls.manage` | SA AD PR TE | `update_review_call` |
| GET | `/review-calls/:id/briefing` | `reviewcalls.manage` | SA AD PR TE | `get_review_call_briefing` |
| POST | `/review-calls/:id/schedule` | `reviewcalls.manage` | SA AD PR TE | `update_review_call_schedule` |
| POST | `/review-calls/:id/attempts` | `reviewcalls.manage` | SA AD PR TE | `log_review_call_attempt` |
| POST | `/review-calls/:id/notes` | `reviewcalls.manage` | SA AD PR TE | `add_review_call_note` |
| POST | `/review-calls/:id/actions` | `reviewcalls.manage` | SA AD PR TE | `add_review_call_action` |
| POST | `/review-calls/:id/actions/:actionId/complete` | `reviewcalls.manage` | SA AD PR TE | `complete_review_call_action` |
| POST | `/review-calls/:id/close` | `reviewcalls.manage` | SA AD PR TE | `close_review_call` |
| POST | `/review-calls/:id/reopen` | `reviewcalls.manage` | SA AD PR TE | `reopen_review_call` |

### /conversations

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/conversations/` | `conversations.use` | SA AD PR TE PA | `list_conversations`, `read_conversation` |
| GET | `/conversations/contacts` | `conversations.use` | SA AD PR TE PA | `send_conversation_message` |
| GET | `/conversations/queue` | `conversations.use` | SA AD PR TE PA | `list_unanswered_conversations` |
| GET | `/conversations/settings` | `conversations.use` | SA AD PR TE PA | `get_conversation_office_hours` |
| PUT | `/conversations/settings` | `conversations.use` | SA AD PR TE PA | `set_conversation_office_hours` — not in catalogue for PA (conversations.service.setSettings refuses parents ("Office hours are for staff")) |
| POST | `/conversations/` | `conversations.use` | SA AD PR TE PA | `send_conversation_message` |
| GET | `/conversations/:id` | `conversations.use` | SA AD PR TE PA | `read_conversation` |
| POST | `/conversations/:id/messages` | `conversations.use` | SA AD PR TE PA | `reply_to_conversation` |
| POST | `/conversations/:id/close` | `conversations.use` | SA AD PR TE PA | `close_conversation` — not in catalogue for PA (conversations.service.close refuses anyone but the staff side or ALL) |

### /staff

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/staff/leave/policies` | any of `staffleave.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `list_staff_leave_policies` |
| PUT | `/staff/leave/policies/:code` | `staffleave.manage` | SA AD PR HR | `set_staff_leave_policy` |
| GET | `/staff/leave/balance` | any of `staffleave.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `get_staff_leave_balance`, `apply_staff_leave`, `record_staff_leave_decision` |
| GET | `/staff/leave/balances` | `staffleave.manage` | SA AD PR HR | `get_staff_leave_balances` |
| POST | `/staff/leave/balances/init` | `staffleave.manage` | SA AD PR HR | `set_up_staff_leave_balances` |
| POST | `/staff/leave/balances/adjust` | `staffleave.manage` | SA AD PR HR | `adjust_staff_leave_balance` |
| GET | `/staff/leave/lop` | `staffleave.manage` | SA AD PR HR | `get_staff_leave_lop` |
| GET | `/staff/leave` | any of `staffleave.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `list_staff_leave` |
| POST | `/staff/leave` | `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `apply_staff_leave` |
| POST | `/staff/leave/:id/decide` | `staffleave.manage` | SA AD PR HR | `record_staff_leave_decision` |
| POST | `/staff/leave/:id/cancel` | any of `staffleave.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `cancel_staff_leave` |
| GET | `/staff/cover/for` | any of `cover.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | **COVERED** — get_cover_arrangements (cover.service.coverFor, which coverForRoute wraps; every role on the route holds staffleave.apply) |
| GET | `/staff/cover/mine` | any of `cover.manage` / `staffleave.apply` | SA AD PR TE FI LI WA NU HR MK CO | `get_cover_arrangements`, `cancel_cover` |
| GET | `/staff/cover/needs` | `cover.manage` | SA AD PR HR | `get_cover_needs` |
| GET | `/staff/cover/candidates` | `cover.manage` | SA AD PR HR | `suggest_cover_teachers`, `assign_cover` |
| GET | `/staff/cover/rules` | `cover.manage` | SA AD PR HR | `get_cover_assignment_rules` |
| PUT | `/staff/cover/rules` | `cover.manage` | SA AD PR HR | `set_cover_rules` |
| POST | `/staff/cover` | `cover.manage` | SA AD PR HR | `assign_cover` |
| POST | `/staff/cover/:id/cancel` | `cover.manage` | SA AD PR HR | `cancel_cover` |
| GET | `/staff/cover/absences` | `cover.manage` | SA AD PR HR | `list_staff_absences` |
| POST | `/staff/cover/absences` | `cover.manage` | SA AD PR HR | `mark_staff_absent` |
| POST | `/staff/cover/absences/:id/withdraw` | `cover.manage` | SA AD PR HR | `withdraw_staff_absence` |

### /report-cards

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/report-cards/templates` | any of `reportcards.read` / `reportcards.manage` | SA AD PR TE PA ST | `list_report_card_templates` — not in catalogue for PA ST (list_report_card_templates (staff via reportcards.manage; families have no template screen)) |
| POST | `/report-cards/templates` | `reportcards.manage` | SA AD PR TE | `create_report_card_template` |
| PATCH | `/report-cards/templates/:id` | `reportcards.manage` | SA AD PR TE | `update_report_card_template` |
| GET | `/report-cards/sections` | `reportcards.manage` | SA AD PR TE | `list_term_report_classes` |
| GET | `/report-cards/published` | `reportcards.read` | SA AD PR PA ST | `get_my_term_report_cards`, `list_term_report_cards`, `get_published_term_report_card` |
| GET | `/report-cards/versions/:id` | any of `reportcards.read` / `reportcards.manage` | SA AD PR TE PA ST | `get_published_term_report_card` |
| GET | `/report-cards/versions/:id/pdf` | any of `reportcards.read` / `reportcards.manage` | SA AD PR TE PA ST | `get_published_term_report_card` |
| POST | `/report-cards/generate` | `reportcards.manage` | SA AD PR TE | `generate_term_report_cards` |
| POST | `/report-cards/bulk` | `reportcards.manage` | SA AD PR TE | `record_class_report_card_moderation` |
| GET | `/report-cards/` | `reportcards.manage` | SA AD PR TE | `list_term_report_cards`, `get_term_report_remark_draft`, `get_term_report_card`, `list_term_report_card_versions` |
| GET | `/report-cards/:id` | `reportcards.manage` | SA AD PR TE | `get_term_report_card` |
| PATCH | `/report-cards/:id` | `reportcards.manage` | SA AD PR TE | `save_term_report_remarks`, `save_report_card_component_marks`, `save_co_scholastic_grades` |
| POST | `/report-cards/:id/moderate` | `reportcards.manage` | SA AD PR TE | `record_report_card_moderation` |
| POST | `/report-cards/:id/return` | `reportcards.manage` | SA AD PR TE | `record_report_card_moderation` |
| POST | `/report-cards/:id/publish` | `reportcards.manage` | SA AD PR TE | **EXCEPTION** — publishing report cards to families stays on screen |
| GET | `/report-cards/:id/versions` | `reportcards.manage` | SA AD PR TE | `list_term_report_card_versions` |

### /analytics

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/analytics/catalogue` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | `get_analytics_catalogue` |
| GET | `/analytics/overview` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | `get_analytics_overview` |
| GET | `/analytics/views` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | `list_analytics_views` |
| POST | `/analytics/views` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | `save_analytics_view` |
| POST | `/analytics/views/import` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | **SCREEN** — one-time import of views kept in the browser's local storage (bulk import); save_analytics_view is the assistant path |
| DELETE | `/analytics/views/:id` | `analytics.workspace.read` | SA AD PR TE FI HR MK CO TR | `delete_analytics_view` |
| GET | `/analytics/export.csv` | `analytics.export`; `analytics.workspace.read` | SA AD PR FI | **SCREEN** — CSV export |
| GET | `/analytics/reports` | `reports.quarterly.read` | SA AD PR FI HR CO TR | `list_quarterly_reports`, `get_quarterly_report`, `list_quarterly_report_deliveries` |
| POST | `/analytics/reports/generate` | `reports.quarterly.manage` (ALL) | SA AD PR | `regenerate_quarterly_report` |
| GET | `/analytics/reports/:id` | `reports.quarterly.read` | SA AD PR FI HR CO TR | `get_quarterly_report` |
| GET | `/analytics/reports/:id/deliveries` | `reports.quarterly.manage` (ALL) | SA AD PR | `list_quarterly_report_deliveries` |
| POST | `/analytics/reports/:id/deliver` | `reports.quarterly.manage` (ALL) | SA AD PR | `send_quarterly_report` |
| GET | `/analytics/reports/:id/download.csv` | `reports.quarterly.read` | SA AD PR FI HR CO TR | **SCREEN** — CSV download |
| GET | `/analytics/reports/:id/download.pdf` | `reports.quarterly.read` | SA AD PR FI HR CO TR | **SCREEN** — PDF download |

### /labs

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/labs/` | `labs.read` | SA AD PR TE | `list_lab_stock`, `list_lab_equipment`, `list_lab_stock_movements`, `list_lab_devices`, `list_lab_software`, `get_lab`, `get_lab_fefo_plan` |
| GET | `/labs/overview` | `labs.read` | SA AD PR TE | `get_labs_overview` |
| POST | `/labs/` | `labs.manage` (ALL) | SA AD | `create_lab` |
| GET | `/labs/facilities` | `labs.manage` (ALL) | SA AD | `list_lab_rooms_without_profile` |
| GET | `/labs/scan/:code` | `labs.read` | SA AD PR TE | `search_lab_code`, `set_lab_batch_status`, `record_lab_stocktake` |
| POST | `/labs/due/sync` | `labs.manage` (ALL) | SA AD | `sync_lab_due_items` |
| GET | `/labs/items` | `labs.read` | SA AD PR TE | `list_lab_stock`, `list_lab_stock_movements`, `get_lab_fefo_plan` |
| PATCH | `/labs/items/:id` | `labs.manage` | SA AD TE | `update_lab_item` |
| POST | `/labs/items/:id/receive` | `labs.manage` | SA AD TE | `receive_lab_stock` |
| GET | `/labs/items/:id/fefo` | `labs.read` | SA AD PR TE | `issue_lab_stock`, `record_lab_stock_use`, `get_lab_fefo_plan` |
| POST | `/labs/items/:id/reorder` | `labs.manage` | SA AD TE | `draft_lab_reorder` |
| POST | `/labs/stock/issue` | `labs.manage` | SA AD TE | `issue_lab_stock`, `record_lab_stock_use` |
| POST | `/labs/stock/consume` | `labs.manage` | SA AD TE | `issue_lab_stock`, `record_lab_stock_use` |
| POST | `/labs/stock/damage` | `labs.manage` | SA AD TE | `issue_lab_stock`, `record_lab_stock_use` |
| POST | `/labs/stock/dispose` | `labs.manage` | SA AD TE | `issue_lab_stock`, `record_lab_stock_use` |
| POST | `/labs/stock/return` | `labs.manage` | SA AD TE | `return_lab_stock` |
| PATCH | `/labs/batches/:id` | `labs.manage` | SA AD TE | `set_lab_batch_status` |
| GET | `/labs/movements` | `labs.read` | SA AD PR TE | `list_lab_stock_movements` |
| GET | `/labs/equipment` | `labs.read` | SA AD PR TE | `list_lab_equipment` |
| PATCH | `/labs/equipment/:id` | `labs.manage` | SA AD TE | `update_lab_equipment` |
| POST | `/labs/equipment/:id/calibration` | `labs.manage` | SA AD TE | `record_lab_calibration` |
| POST | `/labs/equipment/:id/repairs` | `labs.manage` | SA AD TE | `record_lab_equipment_repair` |
| POST | `/labs/equipment/:id/repairs/:repairId/close` | `labs.manage` | SA AD TE | `record_lab_equipment_repair` |
| GET | `/labs/devices` | `labs.read` | SA AD PR TE | `list_lab_devices` |
| PATCH | `/labs/devices/:id` | `labs.manage` | SA AD TE | `update_lab_device` |
| POST | `/labs/devices/:id/repairs` | `labs.manage` | SA AD TE | `record_lab_device_repair` |
| POST | `/labs/devices/:id/repairs/:repairId/close` | `labs.manage` | SA AD TE | `record_lab_device_repair` |
| POST | `/labs/devices/:id/decommission` | `labs.manage` | SA AD TE | **SCREEN** — requires an uploaded e-waste handover certificate as evidence (file upload) |
| GET | `/labs/software` | `labs.read` | SA AD PR TE | `list_lab_software` |
| POST | `/labs/software` | `labs.manage` | SA AD TE | `add_lab_software` |
| PATCH | `/labs/software/:id` | `labs.manage` | SA AD TE | `update_lab_software` |
| POST | `/labs/software/:id/seats` | `labs.manage` | SA AD TE | `set_lab_software_seat` |
| POST | `/labs/software/:id/seats/release` | `labs.manage` | SA AD TE | `set_lab_software_seat` |
| GET | `/labs/sessions` | `labs.read` | SA AD PR TE | `list_practical_sessions`, `get_practical_session` |
| POST | `/labs/sessions` | `labs.manage` | SA AD TE | `plan_practical_session` |
| GET | `/labs/sessions/:id` | `labs.read` | SA AD PR TE | `get_practical_session` |
| PATCH | `/labs/sessions/:id` | `labs.manage` | SA AD TE | `update_practical_session` |
| POST | `/labs/sessions/:id/readiness` | `labs.manage` | SA AD TE | `move_practical_session` |
| POST | `/labs/sessions/:id/prep` | `labs.manage` | SA AD TE | `move_practical_session` |
| POST | `/labs/sessions/:id/prepared` | `labs.manage` | SA AD TE | `move_practical_session` |
| POST | `/labs/sessions/:id/start` | `labs.manage` | SA AD TE | `move_practical_session` |
| POST | `/labs/sessions/:id/attendance` | `labs.manage` | SA AD TE | `record_practical_attendance` |
| POST | `/labs/sessions/:id/complete` | `labs.manage` | SA AD TE | `move_practical_session` |
| POST | `/labs/sessions/:id/cancel` | `labs.manage` | SA AD TE | `move_practical_session` |
| GET | `/labs/incidents` | `labs.read` | SA AD PR TE | `list_lab_incidents` |
| POST | `/labs/incidents` | `labs.manage` | SA AD TE | `report_lab_incident` |
| POST | `/labs/incidents/:id/close` | `labs.manage` | SA AD TE | `close_lab_incident` |
| GET | `/labs/:id` | `labs.read` | SA AD PR TE | `get_lab` |
| PATCH | `/labs/:id` | `labs.manage` | SA AD TE | `update_lab` |
| POST | `/labs/:labId/items` | `labs.manage` | SA AD TE | `add_lab_item` |
| POST | `/labs/:labId/stocktake` | `labs.manage` | SA AD TE | `record_lab_stocktake` |
| POST | `/labs/:labId/equipment` | `labs.manage` | SA AD TE | `add_lab_equipment` |
| POST | `/labs/:labId/devices` | `labs.manage` | SA AD TE | `add_lab_devices` |

### /bills

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/bills/accounts` | `bills.read` (ALL) | SA AD PR FI CO | `list_service_accounts` |
| POST | `/bills/accounts` | `bills.manage` (ALL) | SA AD FI | `create_service_account` |
| PATCH | `/bills/accounts/:id` | `bills.manage` (ALL) | SA AD FI | `update_service_account` |
| POST | `/bills/accounts/:id/visits` | `bills.manage` (ALL) | SA AD FI | `schedule_service_visit` |
| GET | `/bills/visits` | `bills.read` (ALL) | SA AD PR FI CO | `list_service_visits` |
| POST | `/bills/visits/:id/complete` | `bills.manage` (ALL) | SA AD FI | `complete_service_visit` |
| GET | `/bills/renewals` | `bills.read` (ALL) | SA AD PR FI CO | `list_renewals` |
| GET | `/bills/review` | `bills.read` (ALL) | SA AD PR FI CO | `get_bill_review_queue`, `note_bill_flag` |
| POST | `/bills/review` | `bills.manage` (ALL) | SA AD FI | `note_bill_flag` |
| GET | `/bills/dashboard` | `bills.read` (ALL) | SA AD PR FI CO | `get_bill_costs` |
| POST | `/bills/due/sync` | `bills.manage` (ALL) | SA AD FI | `sync_bill_reminders` |
| GET | `/bills/` | `bills.read` (ALL) | SA AD PR FI CO | `list_bills`, `get_service_bill` |
| POST | `/bills/` | `bills.manage` (ALL) | SA AD FI | `record_bill` |
| GET | `/bills/:id` | `bills.read` (ALL) | SA AD PR FI CO | `get_service_bill` |
| POST | `/bills/:id/payments` | `bills.manage` (ALL) | SA AD FI | `record_bill_payment` |
| POST | `/bills/:id/payments/:paymentId/confirm` | `bills.manage` (ALL) | SA AD FI | `verify_bill_payment` |
| POST | `/bills/:id/status` | `bills.manage` (ALL) | SA AD FI | `change_bill_status` |

### /clubs

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/clubs/` | `clubs.read` | SA AD PR TE PA ST AL | `list_clubs`, `list_club_sessions`, `list_club_fixtures`, `list_club_equipment`, `get_club` |
| POST | `/clubs/` | `clubs.manage` (ALL) | SA AD PR | `create_club` |
| GET | `/clubs/options` | `clubs.read` | SA AD PR TE PA ST AL | `get_club_options` |
| GET | `/clubs/my` | `clubs.join` | SA AD PA ST | `get_my_club_memberships`, `consent_to_club_join`, `withdraw_club_membership`, `join_ptm_waitlist`, `accept_ptm_slot_offer`, `cancel_ptm_waitlist_entry`, `block_ptm_slot`, `unblock_ptm_slot`, `update_ptm_round`, `cancel_ptm_round`, `complete_review_call_action` |
| GET | `/clubs/my-students` | `clubs.join` | SA AD PA ST | `join_club` — not in catalogue for AD (AD: clubs.myStudents returns only a student's own / a parent's children (the join-form picker); staff have none) |
| GET | `/clubs/approvals` | `clubs.manage` | SA AD PR TE | `list_club_join_requests`, `record_club_join_decision` |
| GET | `/clubs/portfolio/:studentId` | `clubs.read` | SA AD PR TE PA ST AL | `get_club_portfolio` |
| POST | `/clubs/memberships` | `clubs.join` | SA AD PA ST | `join_club` — not in catalogue for AD (AD: clubs.requestJoin refuses non-family (FAMILY_ONLY; staff do not raise join requests)) |
| POST | `/clubs/memberships/:id/consent` | `clubs.join` | SA AD PA ST | `consent_to_club_join` — not in catalogue for AD ST (AD,ST: clubs.decideConsent refuses anyone but a parent (GUARDIAN_ONLY)) |
| POST | `/clubs/memberships/:id/decision` | `clubs.manage` | SA AD PR TE | `record_club_join_decision` |
| POST | `/clubs/memberships/:id/leave` | `clubs.join` (checked in handler); `clubs.manage` (checked in handler) | SA AD PR TE PA ST | `withdraw_club_membership`, `remove_club_member` |
| POST | `/clubs/memberships/:id/role` | `clubs.manage` | SA AD PR TE | `set_club_member_role` |
| GET | `/clubs/sessions` | `clubs.read` | SA AD PR TE PA ST AL | `list_club_sessions` |
| GET | `/clubs/sessions/:id/register` | `clubs.manage` | SA AD PR TE | `mark_club_attendance` |
| POST | `/clubs/sessions/:id/attendance` | `clubs.manage` | SA AD PR TE | `mark_club_attendance` |
| POST | `/clubs/sessions/:id/cancel` | `clubs.manage` | SA AD PR TE | `cancel_club_session` |
| GET | `/clubs/houses` | `clubs.read` | SA AD PR TE PA ST AL | `list_houses` |
| POST | `/clubs/houses` | `clubs.manage` (ALL) | SA AD PR | `create_house` |
| POST | `/clubs/houses/assign` | `clubs.manage` (ALL) | SA AD PR | `assign_students_to_house` |
| GET | `/clubs/house-points` | `clubs.read` | SA AD PR TE PA ST AL | `get_house_points` |
| GET | `/clubs/fixtures` | `clubs.read` | SA AD PR TE PA ST AL | `list_club_fixtures` |
| POST | `/clubs/fixtures` | `clubs.manage` | SA AD PR TE | `schedule_club_fixture` |
| PUT | `/clubs/fixtures/:id/participants` | `clubs.manage` | SA AD PR TE | `set_fixture_team_sheet` |
| POST | `/clubs/fixtures/:id/result` | `clubs.manage` | SA AD PR TE | `record_club_fixture_result` |
| POST | `/clubs/fixtures/:id/result/decision` | `clubs.manage` | SA AD PR TE | `record_fixture_result_decision` |
| POST | `/clubs/fixtures/:id/cancel` | `clubs.manage` | SA AD PR TE | `cancel_club_fixture` |
| GET | `/clubs/equipment` | `clubs.manage` | SA AD PR TE | `list_club_equipment` |
| POST | `/clubs/equipment` | `clubs.manage` | SA AD PR TE | `add_club_equipment` |
| GET | `/clubs/equipment/issues` | `clubs.manage` | SA AD PR TE | `list_club_equipment_loans` |
| POST | `/clubs/equipment/issues` | `clubs.manage` | SA AD PR TE | `lend_club_equipment` |
| POST | `/clubs/equipment/issues/:id/return` | `clubs.manage` | SA AD PR TE | `return_club_equipment` |
| GET | `/clubs/:id` | `clubs.read` | SA AD PR TE PA ST AL | `get_club` |
| PATCH | `/clubs/:id` | `clubs.manage` | SA AD PR TE | `update_club` |
| POST | `/clubs/:id/sessions` | `clubs.manage` | SA AD PR TE | `schedule_club_session` |

### /showcase

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/showcase/` | `institution.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_showcase` |
| GET | `/showcase/settings` | `institution.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_showcase_settings` |
| PUT | `/showcase/settings` | `showcase.publish` | SA AD PR MK | `update_showcase_rank_cutoff` |
| GET | `/showcase/options` | `showcase.publish` | SA AD PR MK | `get_showcase_options`, `get_showcase_rank_preview` |
| GET | `/showcase/rank-preview` | `showcase.publish` | SA AD PR MK | `get_showcase_rank_preview` |
| GET | `/showcase/candidates` | `showcase.publish` | SA AD PR MK | `list_showcase_candidates` |
| GET | `/showcase/editions` | `showcase.publish` | SA AD PR MK | `list_showcase_editions`, `get_showcase_edition` |
| POST | `/showcase/editions` | `showcase.publish` | SA AD PR MK | `create_showcase_edition` |
| GET | `/showcase/editions/:id` | `showcase.publish` | SA AD PR MK | `get_showcase_edition` |
| POST | `/showcase/editions/:id/rank-entries` | `showcase.publish` | SA AD PR MK | `draft_showcase_rank_entries` |
| POST | `/showcase/editions/:id/entries` | `showcase.publish` | SA AD PR MK | `draft_showcase_entry` |
| POST | `/showcase/editions/:id/publish` | `showcase.publish` | SA AD PR MK | `release_showcase_edition` |
| POST | `/showcase/editions/:id/withdraw` | `showcase.publish` | SA AD PR MK | `withdraw_showcase_edition` |
| POST | `/showcase/entries/:id/review` | `showcase.publish` | SA AD PR MK | `record_showcase_entry_review` |
| POST | `/showcase/entries/:id/withdraw` | `showcase.publish` | SA AD PR MK | `remove_showcase_entry` |
| DELETE | `/showcase/entries/:id` | `showcase.publish` | SA AD PR MK | `remove_showcase_entry` |

### /sustainability

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/sustainability/overview` | `sustainability.read` | SA AD PR TE PA ST CO | `get_sustainability_overview` |
| GET | `/sustainability/eco-points` | `sustainability.read` | SA AD PR TE PA ST CO | `get_eco_points` |
| GET | `/sustainability/map` | `sustainability.read` | SA AD PR TE PA ST CO | `get_sustainability_map` |
| GET | `/sustainability/zones` | `sustainability.read` | SA AD PR TE PA ST CO | `list_sustainability_zones`, `list_plants` |
| POST | `/sustainability/zones` | `sustainability.manage` (ALL) | SA AD PR CO | `add_sustainability_zone` |
| PATCH | `/sustainability/zones/:id` | `sustainability.manage` (ALL) | SA AD PR CO | `update_sustainability_zone` |
| GET | `/sustainability/teams` | `sustainability.read` | SA AD PR TE PA ST CO | `list_eco_teams` |
| POST | `/sustainability/teams` | `sustainability.manage` (ALL) | SA AD PR CO | `add_eco_team` |
| PATCH | `/sustainability/teams/:id` | `sustainability.manage` (ALL) | SA AD PR CO | `update_eco_team` |
| GET | `/sustainability/plants` | `sustainability.read` | SA AD PR TE PA ST CO | `list_plants`, `get_plant` |
| GET | `/sustainability/plants/:id` | `sustainability.read` | SA AD PR TE PA ST CO | `get_plant` |
| POST | `/sustainability/plants` | `sustainability.manage` | SA AD PR TE CO | `add_eco_planting` |
| POST | `/sustainability/plants/:id/checks` | `sustainability.manage` | SA AD PR TE CO | `log_plant_check` |
| GET | `/sustainability/waste` | `sustainability.read` | SA AD PR TE PA ST CO | `list_waste_logs` |
| POST | `/sustainability/waste` | `sustainability.manage` (ALL) | SA AD PR CO | `log_waste` |
| GET | `/sustainability/compost` | `sustainability.read` | SA AD PR TE PA ST CO | `list_compost_batches` |
| POST | `/sustainability/compost` | `sustainability.manage` (ALL) | SA AD PR CO | `start_compost_batch` |
| PATCH | `/sustainability/compost/:id` | `sustainability.manage` (ALL) | SA AD PR CO | `update_compost_batch` |
| GET | `/sustainability/meters` | `sustainability.read` | SA AD PR TE PA ST CO | `list_meter_readings` |
| POST | `/sustainability/meters` | `sustainability.manage` (ALL) | SA AD PR CO | `log_meter_reading` |
| GET | `/sustainability/sanitation` | `sustainability.read` | SA AD PR TE PA ST CO | `list_sanitation_duties`, `list_sanitation_checks` |
| POST | `/sustainability/sanitation` | `sustainability.manage` (ALL) | SA AD PR CO | `add_sanitation_duty` |
| PATCH | `/sustainability/sanitation/:id` | `sustainability.manage` (ALL) | SA AD PR CO | `update_sanitation_duty` |
| GET | `/sustainability/sanitation/:id/checks` | `sustainability.read` | SA AD PR TE PA ST CO | `list_sanitation_checks` |
| POST | `/sustainability/sanitation/:id/checks` | `sustainability.manage` | SA AD PR TE CO | `record_sanitation_check` |
| POST | `/sustainability/sanitation/sync` | `sustainability.manage` (ALL) | SA AD PR CO | `sync_sanitation_tasks` |
| GET | `/sustainability/activities` | `sustainability.read` | SA AD PR TE PA ST CO | `list_eco_activities` — not in catalogue for PA ST (PA,ST: listActivities calls requireStaff (families read eco points through get_eco_points)) |
| POST | `/sustainability/activities` | `sustainability.manage` | SA AD PR TE CO | `log_eco_activity` |
| POST | `/sustainability/activities/:id/decision` | `sustainability.verify` | SA AD PR TE CO | `verify_eco_activity` |
| GET | `/sustainability/packs` | `sustainability.manage` (ALL) | SA AD PR CO | `list_evidence_packs`, `get_evidence_pack` |
| GET | `/sustainability/packs/:key` | `sustainability.manage` (ALL) | SA AD PR CO | `get_evidence_pack` |
| GET | `/sustainability/packs/:key/csv` | `sustainability.manage` (ALL) | SA AD PR CO | **SCREEN** — CSV export (get_evidence_pack returns the same pack as data) |

### /fee-adjustments

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/fee-adjustments/types` | `fees.concessions.manage` (ALL) | SA AD FI | `list_concession_schemes` |
| POST | `/fee-adjustments/types` | `fees.concessions.manage` (ALL) | SA AD FI | `create_concession_scheme` |
| PATCH | `/fee-adjustments/types/:id` | `fees.concessions.manage` (ALL) | SA AD FI | `update_concession_scheme` |
| GET | `/fee-adjustments/` | `fees.concessions.manage` (ALL) | SA AD FI | `list_fee_adjustments` |
| GET | `/fee-adjustments/invoices/:id` | `fees.concessions.manage` (ALL) | SA AD FI | `get_invoice_concession_history` |
| POST | `/fee-adjustments/` | `fees.concessions.manage` (ALL) | SA AD FI | `request_fee_adjustment` |
| POST | `/fee-adjustments/:id/withdraw` | `fees.concessions.manage` (ALL) | SA AD FI | `withdraw_fee_adjustment` |

### /accounts-export

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/accounts-export/vouchers` | `accounts.export` (ALL) | SA AD FI | `get_voucher_summary` |
| GET | `/accounts-export/gst` | `accounts.export` (ALL) | SA AD FI | `get_gst_summary` |
| GET | `/accounts-export/fee-heads` | `accounts.export` (ALL) | SA AD FI | `list_gst_rates` |
| PUT | `/accounts-export/fee-heads/:id/tax` | `accounts.export` (ALL); `fees.structure.manage` | SA AD FI | `set_fee_head_tax` |

### /community

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/community/public/:slug` | public (no sign-in) | public | **SCREEN** — Public school page data for visitors; nobody signed in. |
| GET | `/community/feed` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_newsroom_posts`, `get_newsroom_post`, `update_newsroom_post`, `transition_newsroom_post`, `moderate_newsroom_post`, `react_to_newsroom_post`, `bookmark_newsroom_post`, `add_newsroom_comment`, `change_my_newsroom_comment`, `report_newsroom_content`, `get_newsroom_story_social_status` |
| POST | `/community/posts` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `draft_newsroom_post` |
| GET | `/community/posts/:id` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_newsroom_post` |
| PATCH | `/community/posts/:id` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `update_newsroom_post` |
| DELETE | `/community/posts/:id` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `transition_newsroom_post` |
| POST | `/community/posts/:id/submit` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `transition_newsroom_post` |
| POST | `/community/posts/:id/moderate` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `moderate_newsroom_post` |
| POST | `/community/posts/:id/react` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `react_to_newsroom_post` |
| POST | `/community/posts/:id/bookmark` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `bookmark_newsroom_post` |
| POST | `/community/posts/:id/comments` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `add_newsroom_comment` |
| GET | `/community/comments/pending` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_pending_newsroom_comments`, `moderate_newsroom_comment` |
| POST | `/community/comments/:id/moderate` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `moderate_newsroom_comment` |
| PATCH | `/community/comments/:id` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `change_my_newsroom_comment` |
| DELETE | `/community/comments/:id` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `change_my_newsroom_comment` |
| POST | `/community/reports` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `report_newsroom_content` |
| GET | `/community/reports` | `community.moderate` | SA AD PR CO | `list_community_reports` |
| POST | `/community/reports/:id/resolve` | `community.moderate` | SA AD PR CO | `resolve_community_report` |
| POST | `/community/events/:id/highlight` | `events.read`; `community.post` | SA AD PR TE FI LI WA NU HR MK CO | `draft_event_highlight_post` |
| GET | `/community/circles` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_plants`, `get_newsroom_post`, `list_community_circles` |
| POST | `/community/circles` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `create_community_circle` |
| POST | `/community/circles/:id/join` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `join_or_leave_circle` |
| POST | `/community/circles/:id/leave` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `join_or_leave_circle` |
| POST | `/community/circles/:id/members` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `manage_circle_member`, `record_circle_join_decision` |
| GET | `/community/students` | `community.post` | SA AD PR TE ST FI LI WA NU HR MK CO AL | `list_taggable_students`, `record_media_consent_form` |
| GET | `/community/consents` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_children_media_consent`, `set_child_media_consent` |
| POST | `/community/consents` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `set_child_media_consent`, `record_media_consent_form` — not in catalogue for TE FI LI WA NU HR MK TR AL (set_child_media_consent (PARENT / adult STUDENT, own child) + record_media_consent_form (community.moderate, signed form cited)) |
| GET | `/community/mentors` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_mentors` |
| PUT | `/community/mentors/me` | `mentoring.participate` | SA AD ST AL | `update_my_mentor_profile` |
| POST | `/community/mentors/:id/verify` | `community.moderate` | SA AD PR CO | `verify_mentor_profile` |
| GET | `/community/mentoring` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_my_mentoring`, `record_mentoring_request_decision`, `manage_mentoring` |
| POST | `/community/mentoring` | `mentoring.participate` | SA AD ST AL | `request_mentoring` |
| POST | `/community/mentoring/:id` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `record_mentoring_request_decision`, `manage_mentoring` |

### /marketing

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/marketing/analytics` | `marketing.read` | SA AD PR MK | `get_marketing_funnel` |
| GET | `/marketing/campaigns` | `marketing.read` | SA AD PR MK | `list_marketing_campaigns`, `list_marketing_assets` |
| POST | `/marketing/campaigns` | `marketing.manage` | SA AD MK | `create_marketing_campaign` |
| PATCH | `/marketing/campaigns/:id` | `marketing.manage` | SA AD MK | `update_marketing_campaign` |
| GET | `/marketing/assets/sizes` | `marketing.read` | SA AD PR MK | `list_marketing_asset_sizes` |
| GET | `/marketing/assets` | `marketing.read` | SA AD PR MK | `list_marketing_assets` |
| POST | `/marketing/assets` | `marketing.manage` | SA AD MK | `create_marketing_asset` |
| PATCH | `/marketing/assets/:id` | `marketing.read` | SA AD PR MK | `update_marketing_asset`, `record_marketing_asset_decision` |
| PATCH | `/marketing/leads/:id` | `admissions.manage` | SA AD MK | `update_enquiry_marketing_details` |
| GET | `/marketing/leads/duplicates` | `admissions.read` | SA AD MK | `list_duplicate_enquiries` |
| GET | `/marketing/capacity` | `marketing.read` | SA AD PR MK | `get_admission_capacity` |
| PUT | `/marketing/capacity` | `admissions.manage` | SA AD MK | `set_admission_capacity` |
| GET | `/marketing/offers` | `admissions.read` | SA AD MK | `list_admission_offers` |
| POST | `/marketing/offers` | `admissions.manage` | SA AD MK | **EXCEPTION** — offering a seat (admission decision) |
| POST | `/marketing/offers/:id` | `admissions.manage` | SA AD MK | `update_seat_offer` |
| GET | `/marketing/appointments` | `admissions.read` | SA AD MK | `list_counselling_appointments` |
| POST | `/marketing/appointments` | `admissions.manage` | SA AD MK | `create_counselling_appointment` |
| PATCH | `/marketing/appointments/:id` | `admissions.manage` | SA AD MK | `update_counselling_appointment` |

### /campus

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/campus/map` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_campus_status` |
| GET | `/campus/layers` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_campus_layers`, `get_campus_live_detail` |
| GET | `/campus/live` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_campus_live_detail` |
| GET | `/campus/my-view` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_campus_moment` |
| GET | `/campus/moment` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_campus_moment`, `request_pickup_delegation`, `request_outpass`, `get_section_shift`, `get_role_dashboard` |
| GET | `/campus/facilities/:id` | `campus.map.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_facility_detail` |

### /insights

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/insights/home` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_day` |
| GET | `/insights/pulse` | `approvals.read` (checked in handler) | SA AD PR TE FI LI WA NU HR MK CO TR | `list_pending_approvals`, `get_pending_items_for_me`, `list_compliance_deadlines`, `list_licences`, `list_open_correspondence`, `list_board_meetings`, `list_fest_plans`, `list_maintenance_work`, `list_purchase_requests`, `get_budget_position`, `list_payroll_runs`, `list_newsroom_posts`, `list_digital_lectures`, `get_syllabus_progress`, `record_concession_decision`, `get_approval_request`, `update_my_approval_request`, `declare_approval_conflict`, `escalate_approval_request` |
| GET | `/insights/dashboard` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_role_dashboard` |

### /alumni

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/alumni/student-links/mine` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_my_student_profile_links`, `set_student_profile_links` |
| GET | `/alumni/student-links/:studentId` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_student_profile_links` |
| PUT | `/alumni/student-links/:studentId` | `community.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `set_student_profile_links` — not in catalogue for AD PR TE FI LI WA NU HR MK CO TR AL (set_student_profile_links (forRoles STUDENT, PARENT: the service allows only self or guardian)) |
| GET | `/alumni/me` | `alumni.directory.read` | SA AD PR TE ST MK AL | `get_my_alumni_profile` — not in catalogue for AD PR TE ST MK (alumni.service.me refuses non-alumni (NOT_ALUMNUS)) |
| PUT | `/alumni/me` | `alumni.directory.read` | SA AD PR TE ST MK AL | `update_my_alumni_profile` — not in catalogue for AD PR TE ST MK (alumni.service.updateMe refuses non-alumni (NOT_ALUMNUS)) |
| GET | `/alumni/me/record` | `alumni.directory.read` | SA AD PR TE ST MK AL | `get_my_school_record` — not in catalogue for AD PR TE ST MK (alumni.service.myRecord refuses non-alumni (NOT_ALUMNUS)) |
| GET | `/alumni/directory` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `search_alumni` — not in catalogue for HR (HR holds alumni.manage only and reads the full managed register through list_alumni_records (BUILT), a superset of the consent-filtered directory) |
| GET | `/alumni/batches` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `list_alumni_batches` — not in catalogue for HR (HR: batches come from list_alumni_records filtered by batchYear (BUILT)) |
| GET | `/alumni/circles` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `list_alumni_posts`, `create_alumni_post`, `list_alumni_circle_posts`, `share_alumni_circle_post` — not in catalogue for TE ST MK (list_alumni_circle_posts (alumni.manage: AD,PR,HR). TE,ST,MK PARTIAL-OK: myCircles returns only circles the caller belongs to (alumni only)) |
| GET | `/alumni/posts` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `list_alumni_posts`, `list_alumni_circle_posts` — not in catalogue for TE ST MK (list_alumni_circle_posts (managers). TE,ST,MK PARTIAL-OK: non-members of alumni circles see none) |
| POST | `/alumni/posts` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `create_alumni_post`, `share_alumni_circle_post` — not in catalogue for TE ST MK (share_alumni_circle_post (managers). TE,ST,MK PARTIAL-OK: createPost requires an alumnus member of the circle) |
| POST | `/alumni/posts/:id/moderate` | `alumni.manage` (ALL) | SA AD PR HR | `moderate_alumni_post` |
| GET | `/alumni/events` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `list_alumni_events`, `list_alumni_event_rsvps` |
| POST | `/alumni/events` | `alumni.manage` (ALL) | SA AD PR HR | `create_alumni_event` |
| POST | `/alumni/events/:id/cancel` | `alumni.manage` (ALL) | SA AD PR HR | `cancel_alumni_event` |
| POST | `/alumni/events/:id/rsvp` | `alumni.directory.read` | SA AD PR TE ST MK AL | `rsvp_alumni_event` — not in catalogue for AD PR TE ST MK (alumni.service.rsvp refuses non-alumni (myAlumnus required)) |
| GET | `/alumni/records` | `alumni.manage` (ALL) | SA AD PR HR | `list_alumni_records` |
| PATCH | `/alumni/records/:id` | `alumni.manage` (ALL) | SA AD PR HR | `update_alumni_record` |
| POST | `/alumni/transitions` | `alumni.manage` (ALL) | SA AD PR HR | `move_to_alumni` |

### /alumni-services

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/alumni-services/documents/types` | `alumni.directory.read` | AL (requireRole ALUMNUS) | `list_certificate_types`, `get_my_certificate_requests`, `list_quizzes`, `get_my_quiz_results`, `list_my_maintenance_reports`, `list_alumni_certificate_types` |
| GET | `/alumni-services/documents` | `alumni.directory.read` | AL (requireRole ALUMNUS) | `get_my_certificate_requests`, `get_my_alumni_certificate_requests`, `get_my_document_request`, `get_my_alumni_document_request` |
| POST | `/alumni-services/documents` | `alumni.directory.read` | AL (requireRole ALUMNUS) | `request_certificate`, `update_assignment`, `delete_assignment`, `cancel_online_class`, `report_repair`, `request_facility_reservation`, `request_alumni_certificate` |
| GET | `/alumni-services/documents/:id` | `alumni.directory.read` | AL (requireRole ALUMNUS) | `get_my_document_request`, `get_my_alumni_document_request` |
| POST | `/alumni-services/documents/:id/cancel` | `alumni.directory.read` | AL (requireRole ALUMNUS) | `cancel_certificate_request`, `cancel_alumni_certificate_request` |
| GET | `/alumni-services/documents/:id/file` | `alumni.directory.read` | AL (requireRole ALUMNUS) | **SCREEN** — file download |
| GET | `/alumni-services/opportunities` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `list_alumni_opportunities`, `list_alumni_offers_for_school` |
| GET | `/alumni-services/opportunities/mine` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `get_my_opportunity_offers`, `withdraw_opportunity_offer`, `express_interest_in_opportunity`, `list_alumni_offers_for_school` — not in catalogue for TE MK (list_alumni_offers_for_school mine=true for AD,PR,HR (alumni.manage); PARTIAL-OK for TE,MK: they cannot post (opportunities.create refuses non-alumni non-coordinators), so their own list is always empty) |
| POST | `/alumni-services/opportunities` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `offer_opportunity`, `add_alumni_opportunity` — not in catalogue for TE ST MK (add_alumni_opportunity for AD,PR,HR (alumni.manage); PARTIAL-OK for TE,ST,MK: opportunities.create refuses anyone who is neither an active alumnus nor holds alumni.manage) |
| POST | `/alumni-services/opportunities/:id/withdraw` | `alumni.directory.read` (checked in handler); `alumni.manage` (checked in handler) | SA AD PR TE ST HR MK AL | `withdraw_opportunity_offer`, `close_alumni_opportunity` — not in catalogue for TE ST MK (close_alumni_opportunity for AD,PR,HR (alumni.manage); PARTIAL-OK for TE,ST,MK: withdraw() refuses anyone who is not the poster or a coordinator, and they cannot post) |
| POST | `/alumni-services/opportunities/:id/review` | `alumni.manage` (ALL) | SA AD PR HR | `record_alumni_offer_decision` |
| POST | `/alumni-services/opportunities/:id/interest` | `alumni.directory.read` | SA AD PR TE ST MK AL | `express_interest_in_opportunity` — not in catalogue for AD PR TE MK (opportunities.interest refuses every role but STUDENT and ALUMNUS (ROLE_NOT_PERMITTED); AD,PR,TE,MK cannot show interest) |

### /student-planner

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/student-planner/me` | `assignments.read` | PA ST (requireRole STUDENT/PARENT) | `get_my_planner`, `get_board_registration_details` |

### /social

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/social/accounts` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_social_accounts` — not in catalogue for TE PA ST FI LI WA NU HR CO TR AL (list_social_accounts) |
| POST | `/social/accounts` | `social.connect` | SA AD | **SCREEN** — Connecting a social account (OAuth connection / provider credentials) stays on the Social page |
| POST | `/social/accounts/:id/disconnect` | `social.connect` | SA AD | **SCREEN** — Disconnecting clears the stored OAuth credential; credentials stay on screen |
| GET | `/social/stories` | `social.publish` | SA AD PR MK | `list_shareable_newsroom_stories`, `list_newsroom_social_statuses` |
| GET | `/social/posts` | `social.publish` | SA AD PR MK | `list_social_posts`, `get_social_post` |
| POST | `/social/posts` | `social.publish` | SA AD PR MK | `draft_social_post` |
| GET | `/social/posts/:id` | `social.publish` | SA AD PR MK | `get_social_post` |
| POST | `/social/posts/:id/publish` | `social.publish` | SA AD PR MK | `send_social_post` |

### /digest

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/digest/today` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_my_digest` |
| GET | `/digest/interests` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_my_digest_interests` |
| PUT | `/digest/preferences` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `update_my_digest_interests` |
| GET | `/digest/sources` | `digest.manage` (ALL) | SA AD PR | `list_digest_sources` |
| POST | `/digest/sources` | `digest.manage` (ALL) | SA AD PR | `add_digest_source` |
| PATCH | `/digest/sources/:id` | `digest.manage` (ALL) | SA AD PR | `update_digest_source` |
| POST | `/digest/sources/:id/check` | `digest.manage` (ALL) | SA AD PR | `check_digest_source` |
| POST | `/digest/run` | `digest.manage` (ALL) | SA AD PR | `send_daily_digest` |

### /newsletter

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/newsletter/home` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_newsletter_home` |
| GET | `/newsletter/preferences` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_my_newsletter_preferences` |
| PUT | `/newsletter/preferences` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `update_my_newsletter_preferences` |
| GET | `/newsletter/opportunities` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `check_opportunity_eligibility`, `list_saved_opportunities`, `list_digest_sources`, `get_opportunity`, `get_opportunity_official_link`, `list_opportunity_questions`, `list_newsletter_archive`, `list_pending_newsletter_comments`, `get_newsletter_edition_extras`, `list_newsletter_challenge_classmates`, `list_my_newsletter_challenges`, `list_newsletter_alert_sources`, `list_newsletter_alert_items` |
| GET | `/newsletter/opportunities/map` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_opportunities_map` |
| GET | `/newsletter/matches` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `find_opportunities` |
| GET | `/newsletter/saved` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `list_saved_opportunities`, `remove_saved_opportunity` |
| GET | `/newsletter/questions` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `list_opportunity_questions`, `answer_opportunity_question` |
| POST | `/newsletter/questions/:id/answer` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `answer_opportunity_question` — not in catalogue for PA ST AL (answer_opportunity_question) |
| POST | `/newsletter/opportunities` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `suggest_opportunity` — not in catalogue for PA ST AL (suggest_opportunity; opportunities.service.create refuses PARENT/STUDENT/ALUMNUS (STAFF_ONLY: only staff add items)) |
| GET | `/newsletter/opportunities/:id` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_opportunity` |
| PATCH | `/newsletter/opportunities/:id` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `update_opportunity` — not in catalogue for PA ST AL (update_opportunity) |
| GET | `/newsletter/opportunities/:id/eligibility` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `check_opportunity_eligibility` |
| POST | `/newsletter/opportunities/:id/save` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `save_opportunity` |
| DELETE | `/newsletter/opportunities/:id/save` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `remove_saved_opportunity` |
| GET | `/newsletter/opportunities/:id/calendar` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | **SCREEN** — file download (.ics calendar file); the dates themselves are read by get_opportunity |
| POST | `/newsletter/opportunities/:id/click` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_opportunity_official_link` |
| POST | `/newsletter/opportunities/:id/ask` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `ask_teacher_about_opportunity` — not in catalogue for AD PR TE FI LI WA HR MK CO TR AL (ask_teacher_about_opportunity; opportunities.service.ask refuses everyone but STUDENT/PARENT (staff talk to colleagues directly)) |
| GET | `/newsletter/editions` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_opportunity_official_link`, `list_newsletter_archive`, `get_newsletter_edition_extras`, `list_newsletter_challenge_classmates`, `list_my_newsletter_challenges` |
| GET | `/newsletter/editions/:id` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_newsletter_edition`, `answer_newsletter_quiz` |
| POST | `/newsletter/editions/:id/progress` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `finish_newsletter_edition` |
| POST | `/newsletter/editions/:id/quiz` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `answer_newsletter_quiz` |
| POST | `/newsletter/editions/:id/poll` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `vote_newsletter_poll` |
| POST | `/newsletter/editions/:id/react` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `react_to_newsletter` |
| POST | `/newsletter/editions/:id/comments` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `add_newsletter_comment` |
| POST | `/newsletter/editions/:id/click/:opportunityId` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_opportunity_official_link` |
| GET | `/newsletter/flashcards` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_newsletter_flashcards`, `answer_newsletter_flashcard` |
| POST | `/newsletter/flashcards/review` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `answer_newsletter_flashcard` |
| GET | `/newsletter/comments/pending` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `list_pending_newsletter_comments`, `moderate_newsletter_comment` |
| POST | `/newsletter/comments/:id/moderate` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `moderate_newsletter_comment` — not in catalogue for PA ST AL (moderate_newsletter_comment (approver decision)) |
| GET | `/newsletter/settings` | `digest.manage` (ALL) | SA AD PR | `get_newsletter_official_sites` |
| PUT | `/newsletter/settings` | `digest.manage` (ALL) | SA AD PR | `update_newsletter_official_sites` |
| POST | `/newsletter/opportunities/:id/review` | `digest.manage` (ALL) | SA AD PR | `record_opportunity_decision` |
| POST | `/newsletter/catalogue/import` | `digest.manage` (ALL) | SA AD PR | `add_opportunity_starter_list` |
| POST | `/newsletter/feeds/scan` | `digest.manage` (ALL) | SA AD PR | `sync_newsletter_feeds` |
| POST | `/newsletter/editions/generate` | `digest.manage` (ALL) | SA AD PR | `draft_newsletter` |
| PATCH | `/newsletter/editions/:id` | `digest.manage` (ALL) | SA AD PR | `update_newsletter_draft` |
| POST | `/newsletter/editions/:id/publish` | `digest.manage` (ALL) | SA AD PR | `transition_newsletter_edition` |
| POST | `/newsletter/editions/:id/withdraw` | `digest.manage` (ALL) | SA AD PR | `transition_newsletter_edition` |
| GET | `/newsletter/analytics` | `digest.manage` (ALL) | SA AD PR | `get_newsletter_analytics` |
| GET | `/newsletter/alerts/guide` | `digest.manage` (ALL) | SA AD PR | `get_google_alerts_guide` |
| GET | `/newsletter/alerts/sources` | `digest.manage` (ALL) | SA AD PR | `list_newsletter_alert_sources`, `list_newsletter_alert_items` |
| POST | `/newsletter/alerts/sources` | `digest.manage` (ALL) | SA AD PR | `add_google_alert_feed` |
| PATCH | `/newsletter/alerts/sources/:id` | `digest.manage` (ALL) | SA AD PR | `update_newsletter_alert_feed` |
| POST | `/newsletter/alerts/sources/:id/check` | `digest.manage` (ALL) | SA AD PR | `check_newsletter_alert_feed` |
| GET | `/newsletter/alerts/items` | `digest.manage` (ALL) | SA AD PR | `list_newsletter_alert_items` |
| GET | `/newsletter/alerts/queue` | `digest.manage` (ALL) | SA AD PR | `get_newsletter_review_queue` |
| GET | `/newsletter/alerts/analytics` | `digest.manage` (ALL) | SA AD PR | `get_newsletter_alert_analytics` |
| POST | `/newsletter/alerts/run` | `digest.manage` (ALL) | SA AD PR | `sync_newsletter_alert_feeds` |
| POST | `/newsletter/editions/:id/regenerate` | `digest.manage` (ALL) | SA AD PR | `regenerate_newsletter_hook` |
| GET | `/newsletter/editions/:id/extras` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `get_newsletter_edition_extras` |
| GET | `/newsletter/editions/:id/classmates` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `list_newsletter_challenge_classmates`, `send_newsletter_quiz_challenge` |
| GET | `/newsletter/editions/:id/challenges` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `list_my_newsletter_challenges` |
| POST | `/newsletter/editions/:id/challenges` | `digest.read` | SA AD PR TE PA ST FI LI WA HR MK CO TR AL | `send_newsletter_quiz_challenge` |

### /support-plans

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/support-plans/` | `supportplans.read` | SA AD PR TE PA ST | `list_support_plans`, `get_support_plan` |
| GET | `/support-plans/suggestions` | `supportplans.manage` | SA AD PR TE | `list_support_plan_suggestions` |
| GET | `/support-plans/family` | `supportplans.read` | SA AD PR TE PA ST | `acknowledge_support_plan` |
| POST | `/support-plans/family/:id/acknowledge` | `supportplans.read` | SA AD PR TE PA ST | `acknowledge_support_plan` |
| POST | `/support-plans/` | `supportplans.manage` | SA AD PR TE | `open_support_plan` |
| GET | `/support-plans/:id` | `supportplans.read` | SA AD PR TE PA ST | `get_support_plan` |
| PATCH | `/support-plans/:id` | `supportplans.manage` | SA AD PR TE | `update_support_plan` |
| POST | `/support-plans/:id/goals` | `supportplans.manage` | SA AD PR TE | `add_support_plan_goal` |
| POST | `/support-plans/:id/goals/:goalId/progress` | `supportplans.manage` | SA AD PR TE | `record_support_plan_progress` |
| POST | `/support-plans/:id/actions` | `supportplans.manage` | SA AD PR TE | `add_support_plan_action` |
| POST | `/support-plans/:id/actions/:actionId/complete` | `supportplans.manage` | SA AD PR TE | `complete_support_plan_action` |
| POST | `/support-plans/:id/notes` | `supportplans.manage` | SA AD PR TE | `add_support_plan_note` |
| POST | `/support-plans/:id/reviews` | `supportplans.manage` | SA AD PR TE | `record_support_plan_review` |
| POST | `/support-plans/:id/share` | `supportplans.manage` | SA AD PR TE | `share_support_plan_with_family` |
| POST | `/support-plans/:id/referral` | `supportplans.manage` | SA AD PR TE | **SCREEN** — safeguarding referral flag (safeguarding reports stay on screen; the referral itself is made in the safeguarding module) |
| POST | `/support-plans/:id/close` | `supportplans.manage` | SA AD PR TE | `transition_support_plan` |
| POST | `/support-plans/:id/reopen` | `supportplans.manage` | SA AD PR TE | `transition_support_plan` |

### /finance-reports

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/finance-reports/collections` | `fees.read` (ALL) | SA AD PR FI | `get_fee_collections` |
| GET | `/finance-reports/day-book.csv` | `fees.read` (ALL) | SA AD PR FI | **SCREEN** — CSV download (get_fee_collections gives the figures) |
| GET | `/finance-reports/ageing` | `fees.read` (ALL) | SA AD PR FI | `get_fee_ageing` |
| GET | `/finance-reports/ageing.csv` | `fees.read` (ALL) | SA AD PR FI | **SCREEN** — CSV download (get_fee_ageing gives the figures) |
| GET | `/finance-reports/anomalies` | `fees.read` (ALL) | SA AD PR FI | `get_fee_receipt_flags` |
| POST | `/finance-reports/reminders/preview` | `fees.read` (ALL) | SA AD PR FI | `send_fee_reminders` — not in catalogue for PR (get_reminder_preview (fees.read@ALL, so the principal can preview; send_fee_reminders unchanged)) |
| POST | `/finance-reports/reminders/send` | `fees.manage` (ALL) | SA AD FI | `send_fee_reminders` |
| GET | `/finance-reports/cash-close` | `fees.read` (ALL) | SA AD PR FI | `list_cash_closes` |
| GET | `/finance-reports/cash-close/expected` | `fees.read` (ALL) | SA AD PR FI | `get_cash_position`, `close_cash_day` |
| POST | `/finance-reports/cash-close` | `fees.pay` (ALL) | SA AD FI | `close_cash_day` |
| POST | `/finance-reports/cash-close/:id/check` | `fees.payments.approve` (ALL) | SA AD | **EXCEPTION** — cash-close verification |

### /recruitment

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/recruitment/vacancies` | `org.manage` (ALL) | SA AD HR | `list_recruitment_vacancies`, `list_candidates` |
| POST | `/recruitment/vacancies` | `org.manage` (ALL) | SA AD HR | `open_vacancy` |
| POST | `/recruitment/vacancies/:id/status` | `org.manage` (ALL) | SA AD HR | `set_vacancy_status` |
| GET | `/recruitment/candidates` | `org.manage` (ALL) | SA AD HR | `list_candidates`, `get_candidate` |
| POST | `/recruitment/candidates` | `org.manage` (ALL) | SA AD HR | `add_candidate` |
| GET | `/recruitment/candidates/:id` | `org.manage` (ALL) | SA AD HR | `get_candidate` |
| POST | `/recruitment/candidates/:id/stage` | `org.manage` (ALL) | SA AD HR | `move_candidate` |
| POST | `/recruitment/candidates/:id/scores` | `org.manage` (ALL) | SA AD HR | `add_candidate_scorecard` |
| POST | `/recruitment/candidates/:id/offer` | `org.manage` (ALL) | SA AD HR | `draft_offer_letter` |
| POST | `/recruitment/candidates/:id/verification` | `org.manage` (ALL) | SA AD HR | `start_candidate_verification` |

### /exits

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/exits/` | `org.manage` (ALL) | SA AD HR | `list_staff_exits`, `get_staff_exit`, `get_exit_letters` |
| POST | `/exits/` | `org.manage` (ALL) | SA AD HR | `start_staff_exit` |
| GET | `/exits/:id` | `org.manage` (ALL) | SA AD HR | `get_staff_exit` |
| POST | `/exits/:id/clearance` | `org.manage` (ALL) | SA AD HR | `update_exit_clearance` |
| POST | `/exits/:id/interview` | `org.manage` (ALL) | SA AD HR | `record_exit_interview` |
| POST | `/exits/:id/settlement` | `org.manage` (ALL); `payroll.sensitive.read` (ALL) | HR | `estimate_full_and_final` |
| POST | `/exits/:id/settlement/payroll` | `org.manage` (ALL); `payroll.prepare` (ALL) | SA HR | **SCREEN** — payroll: putting the full-and-final on a payroll run (restricted pay data) |
| GET | `/exits/:id/letters` | `org.manage` (ALL) | SA AD HR | `get_exit_letters` |
| POST | `/exits/:id/close` | `org.manage` (ALL) | SA AD HR | `close_staff_exit` |

### /health-insights

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/health-insights/` | `health.manage` (ALL) | NU | `get_health_watchlist` |
| GET | `/health-insights/register.csv` | `health.manage` (ALL) | NU | **SCREEN** — CSV export download |

### /school-policy

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/school-policy/approver-mode` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_single_approver_mode` |
| PUT | `/school-policy/approver-mode` | `settings.manage` (ALL) | SA AD | `set_single_approver_mode` |

### /portfolios

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/portfolios/framework` | `portfolios.read` | SA AD PR TE PA ST | `add_portfolio_reflection`, `get_portfolio_framework` |
| GET | `/portfolios/students` | `portfolios.read` | SA AD PR TE PA ST | `list_portfolio_students` |
| GET | `/portfolios/:studentId` | `portfolios.read` | SA AD PR TE PA ST | `get_student_portfolio`, `remove_portfolio_evidence` |
| GET | `/portfolios/:studentId/pdf` | `portfolios.read` | SA AD PR TE PA ST | `get_student_portfolio`, `remove_portfolio_evidence` |
| POST | `/portfolios/:studentId/evidence` | `portfolios.manage` | SA AD PR TE | `add_portfolio_evidence` |
| DELETE | `/portfolios/:studentId/evidence/:evidenceId` | `portfolios.manage` | SA AD PR TE | `remove_portfolio_evidence` |
| PUT | `/portfolios/:studentId/ratings` | `portfolios.manage` | SA AD PR TE | `set_portfolio_rating` |
| POST | `/portfolios/:studentId/reflections` | `portfolios.reflect` | SA AD ST | `add_portfolio_reflection` — not in catalogue for AD (portfolios.reflect refuses everyone but the student themself (reflections are written by the student)) |

### /scenarios

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/scenarios/baseline` | `scenarios.read` (ALL) | SA AD PR FI TR | `get_scenario_baseline` |
| POST | `/scenarios/preview` | `scenarios.read` (ALL) | SA AD PR FI TR | `get_scenario_projection` |
| GET | `/scenarios/compare` | `scenarios.read` (ALL) | SA AD PR FI TR | `get_scenario_comparison` |
| GET | `/scenarios/` | `scenarios.read` (ALL) | SA AD PR FI TR | `get_scenario_comparison`, `list_budget_scenarios`, `get_scenario` |
| POST | `/scenarios/` | `scenarios.manage` (ALL) | SA AD PR FI | `create_scenario` |
| GET | `/scenarios/:id` | `scenarios.read` (ALL) | SA AD PR FI TR | `get_scenario` |
| PATCH | `/scenarios/:id` | `scenarios.manage` (ALL) | SA AD PR FI | `update_scenario` |
| DELETE | `/scenarios/:id` | `scenarios.manage` (ALL) | SA AD PR FI | `archive_scenario` |

### /search

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/search/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `search_everything` |

### /genui

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| POST | `/genui/ask` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/genui) |
| GET | `/genui/panels` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `list_pinned_panels` |
| POST | `/genui/panels` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `pin_dashboard_panel` |
| GET | `/genui/panels/:id` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — assistant's own endpoint (/genui) |
| DELETE | `/genui/panels/:id` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `unpin_dashboard_panel` |

### /newsroom-social

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/newsroom-social/options` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_newsroom_social_options` |
| GET | `/newsroom-social/statuses` | `social.publish` | SA AD PR MK | `list_newsroom_social_statuses` |
| GET | `/newsroom-social/stories/:id` | `social.publish` | SA AD PR MK | `get_newsroom_story_social_status` |
| POST | `/newsroom-social/stories/:id/share` | `social.publish` | SA AD PR MK | `share_news_to_social` |

### /marketing-growth

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/marketing-growth/offline` | `marketing.read` | SA AD PR MK | `list_offline_campaigns`, `get_offline_campaign` |
| POST | `/marketing-growth/offline` | `marketing.manage` | SA AD MK | `create_offline_campaign` |
| GET | `/marketing-growth/offline/:id` | `marketing.read` | SA AD PR MK | `get_offline_campaign` |
| PATCH | `/marketing-growth/offline/:id` | `marketing.manage` | SA AD MK | `update_offline_campaign` |
| POST | `/marketing-growth/offline/:id/move` | `marketing.read` | SA AD PR MK | `transition_offline_campaign`, `record_offline_campaign_decision` |
| GET | `/marketing-growth/heard-from` | `marketing.read` | SA AD PR MK | `list_heard_from_options` |
| POST | `/marketing-growth/heard-from` | `marketing.manage` | SA AD MK | `save_heard_from_option` |
| GET | `/marketing-growth/leads/:id/attribution` | `admissions.read` | SA AD MK | `get_enquiry_attribution` |
| POST | `/marketing-growth/leads/:id/attribution` | `admissions.manage` | SA AD MK | `record_enquiry_source` |
| GET | `/marketing-growth/settings` | `marketing.read` | SA AD PR MK | `get_marketing_settings` |
| PUT | `/marketing-growth/settings` | `marketing.manage` | SA AD MK | `save_marketing_settings` |
| GET | `/marketing-growth/attribution` | `marketing.read` | SA AD PR MK | `get_marketing_attribution` |
| GET | `/marketing-growth/attribution.csv` | `marketing.read` | SA AD PR MK | **SCREEN** — CSV download (get_marketing_attribution gives the report) |
| GET | `/marketing-growth/connectors` | `marketing.read` | SA AD PR MK | `get_ad_campaign_performance` |
| GET | `/marketing-growth/connectors/imports` | `marketing.read` | SA AD PR MK | `list_ad_imports` |
| GET | `/marketing-growth/connectors/metrics` | `marketing.read` | SA AD PR MK | `get_ad_campaign_performance` |
| PUT | `/marketing-growth/connectors/:platform/credentials` | `marketing.manage` (ALL) | SA AD MK | **SCREEN** — connector API credentials |
| POST | `/marketing-growth/connectors/:platform/sync` | `marketing.manage` | SA AD MK | `sync_ad_data` |
| POST | `/marketing-growth/connectors/:platform/webhook-secret` | `marketing.manage` (ALL) | SA AD MK | **SCREEN** — webhook secret |
| POST | `/marketing-growth/connectors/:platform/import` | `marketing.manage` | SA AD MK | **SCREEN** — CSV file import of ad metrics |
| POST | `/marketing-growth/connectors/:platform/import-leads` | `marketing.manage`; `admissions.manage` | SA AD MK | **SCREEN** — CSV file import of leads |
| POST | `/marketing-growth/connectors/:platform/sample` | `marketing.manage` | SA AD MK | `set_ad_sample_data` |

### /integrations

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/integrations/` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `get_integration_connections` — not in catalogue for TE PA ST FI LI WA NU HR CO TR AL (get_integration_connections) |
| POST | `/integrations/oauth/complete` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — OAuth complete |
| POST | `/integrations/:provider/connect` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — OAuth connect |
| PUT | `/integrations/:provider/assets` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — OAuth connect flow: choosing the Page / ad account the token can reach (provider ids from discovery) |
| POST | `/integrations/:provider/refresh-assets` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — OAuth connect flow: re-reads what the token reaches and re-encrypts the provider secrets |
| POST | `/integrations/:provider/disconnect` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | **SCREEN** — OAuth disconnect |
| POST | `/integrations/social-posts/:id/engagement` | `social.publish` | SA AD PR MK | `sync_social_post_engagement` |

### /family

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/family/today` | `students.read` | PA (requireRole PARENT) | `get_family_today` |
| GET | `/family/fee-statement` | `fees.read` | PA (requireRole PARENT) | `get_fee_tax_statement` |
| POST | `/family/translate-announcement` | `announcements.read` | SA AD PR TE PA ST FI LI WA NU HR MK CO TR | **COVERED** — translate_school_notice (family.service.translateAnnouncement) |
| GET | `/family/languages` | signed in (checked in service) | SA AD PR TE PA ST FI LI WA NU HR MK CO TR AL | `translate_school_notice`, `set_my_message_preferences` |

### /leadership

| Method | Path | Permission (min scope) | Roles | Tools / status |
|---|---|---|---|---|
| GET | `/leadership/attendance-overview` | `attendance.read` (ALL) | SA AD PR | `get_school_attendance_overview` |
| GET | `/leadership/workload` | `timetable.read` (ALL) | SA AD PR | `get_teacher_workload` |
| GET | `/leadership/board-pack/:meetingId` | `governance.read` | SA AD PR TR | `get_board_pack` |
| POST | `/leadership/board-pack/:meetingId/freeze` | `governance.manage` (ALL) | SA AD PR | `freeze_board_pack` |
| GET | `/leadership/board-pack/:meetingId/pdf` | `governance.read` | SA AD PR TR | `get_board_pack` |
| GET | `/leadership/certificates/register` | `students.manage` (ALL) | SA AD | `list_issued_certificates` |
| GET | `/leadership/certificates/verify/:code` | `students.manage` (ALL) | SA AD | `check_certificate_code` |
| GET | `/leadership/certificates/:requestId/clearance` | `students.manage` (ALL) | SA AD | `get_certificate_clearance`, `generate_certificate` |
| POST | `/leadership/certificates/:requestId/preview` | `students.manage` (ALL) | SA AD | `get_certificate_preview` |
| POST | `/leadership/certificates/:requestId/generate` | `students.manage` (ALL) | SA AD | `generate_certificate` |
