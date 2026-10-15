# Assistant automation: what a user can do by asking, and what is still a click

Status as of 2026-10-15, branch `feat/platform-part-2`.

The product goal is that anything a signed-in person may do on a screen, they can ask Ask AI or the WhatsApp
agent to do instead, within their own role and scope. Every write is first shown as a concrete draft and runs only
when the same person confirms it on the same channel (`mcp/confirm.js`); a change that is HIGH risk or lands on
someone else's record is confirmed on the website only (`registry.confirmableOn`).

## How this was measured

1. Every API route was enumerated by walking the Express router (`routes/index.js` and every module router):
   **1,094 routes** at the time of writing (GET 460, POST 504, PATCH 77, PUT 29, DELETE 24), each with the permission key(s) and feature switch
   guarding it.
2. The assistant catalogue (`docs/mcp-tools.json`, generated from the registry) was compared with it twice:
   by permission key (a route whose permission no tool declares is certainly not automatable), then by action
   (a covered permission can still hide an uncovered act: `assignments.manage` covered *create homework* but not
   *change its due date*).
3. Each uncovered action was classified:
   - **Built now**: added in this batch (`tools/platformPeople.js`, `tools/platformGaps.js`).
   - **Gap**: a safe action a user may do on screen that still needs a click. Recommended next.
   - **By design**: a decision (approve, reject, publish, refund, record money), credentials, a file upload or
     download, safeguarding, individual payroll, platform administration, or a device/webhook endpoint. These stay
     on their screens; the assistant points to them (`get_pending_items_for_me`, `decisions.js`).

The catalogue went from 180 tools to **318** in this batch: 76 operations tools (`platformOps.js`, another
engineer), 47 people-platform tools and 15 older-module gap tools (this work).

## Built in this batch

**People platform (`tools/platformPeople.js`, 47 tools)**

| Module | Read | Write (draft, then the same user confirms) |
|---|---|---|
| PTM | `list_ptm_rounds`, `get_ptm_slots`, `list_my_ptm_bookings` | `reserve_ptm_slot` (one or several children/teachers), `reschedule_ptm_booking`, `cancel_ptm_booking`, `add_ptm_availability` (teacher, own slots only) |
| Review calls | `list_review_calls` (no private notes) | `open_review_call`, `log_review_call_attempt`, `add_review_call_note`, `update_review_call_schedule` |
| Conversations | `list_conversations` (unread), `read_conversation` | `send_conversation_message` (parent → class/subject teacher or principal; teacher → guardian of own pupil) |
| Term report cards | `get_my_term_report_cards` (published only), `list_term_report_cards`, `get_term_report_remark_draft` (AI/template, not saved) | `save_term_report_remarks` (website only) |
| Clubs | `list_clubs`, `get_my_club_memberships`, `list_club_sessions` | `join_club`, `consent_to_club_join` (parent, own child), `mark_club_attendance` (coach, website only) |
| Showcase | `get_showcase` (published, consent re-checked) | `draft_showcase_entry` (a second person reviews on screen) |
| Alumni | `search_alumni` (listed people, consented fields only), `list_alumni_events` | `rsvp_alumni_event` |
| Social | `list_social_posts` | `draft_social_post` (consent checked), `send_social_post` (HIGH, website only, SIMULATED without credentials) |
| Digest | `get_my_digest` (external text quoted as data) | `update_my_digest_interests` |
| Sustainability | `get_eco_points`, `list_eco_activities` | `log_eco_activity`, `verify_eco_activity` (verifier only, never their own, website only), `log_waste`, `log_meter_reading`, `log_plant_check` (needs an uploaded photo link) |
| Online admissions | `list_online_applications` (moving a lead: existing `update_admission_lead`) | — |
| Library copies | `find_library_copy` | `lend_copy_by_accession`, `checkin_copy_by_accession` |
| AI drafts | `get_ai_draft` (letter, circular, minutes, lesson plan, remark; nothing sent or saved) | — |

**Older-module gaps (`tools/platformGaps.js`, 15 tools)**

| Module | Read | Write |
|---|---|---|
| Certificates | `list_certificate_types`, `get_my_certificate_requests` | `request_certificate`, `cancel_certificate_request` (student/parent) |
| Homework | — | `update_assignment` (title, instructions, chapter, due date), `delete_assignment` |
| Quizzes | `list_quizzes`, `get_my_quiz_results` | — |
| Syllabus | — | `log_syllabus_progress` (topics covered, note, homework) |
| Online classes | — | `schedule_online_class`, `cancel_online_class` (teacher, own classes) |
| Facilities | `list_my_maintenance_reports` | `report_repair`, `request_facility_reservation` (manager confirms) |
| Purchasing | — | `create_purchase_request` (draft only) |

Already automatable before this batch and checked again here: timetable lookups (`get_timetable`, `get_my_classes`),
homework creation (`create_assignment`, `generate_homework`), attendance marking incl. a teacher's own class
(`mark_attendance`, `bulk_mark_attendance`), student leave (`apply_for_leave`), fee receipts and payments
(`get_payment_history` returns receipt numbers; `get_payment_link`), tickets (`create_ticket`, `reply_to_ticket`,
`update_ticket`), calendar events (`create_calendar_event`), notices (`create_announcement`; drafting with
`get_ai_draft` CIRCULAR). Staff leave, cover, out-pass, pickup, labs, bills, fleet, analytics are in `platformOps.js`.

## Still not automatable, per role

"Gap" = recommended next (safe, the user's own act). "By design" = stays on the screen.

### Parent
| Action on screen | Route | Status |
|---|---|---|
| Join the PTM waiting list / accept a freed slot | `POST /ptm/waitlist`, `/waitlist/:id/accept` | Gap |
| Leave a club for a child | `POST /clubs/memberships/:id/leave` | Gap |
| Download a certificate, invoice or receipt PDF | `GET /document-requests/mine/:id/file`, `/fees/invoices/:id/pdf`, `/fees/payments/:id/pdf` | By design (file; the chat gives the link to the page) |
| Pay a fee online | `POST /fees/pay` | By design (checkout cannot be completed in chat; `get_payment_link` instead) |
| Record media consent for a child | `POST /community/consents` | Gap (own child; needs a careful consent wording) |
| Acknowledge a support plan | `POST /support-plans/family/:id/acknowledge` | Gap (new module, not yet in the catalogue) |
| Mark notifications read | `POST /notifications/read(-all)` | By design (no permission on the endpoint) |
| Messaging preferences | `PUT /messaging/preferences` | Gap |

### Student
| Action | Route | Status |
|---|---|---|
| Take a quiz | `/quizzes/:id/start`, `/submit` | By design (timed, interactive; done on the Quizzes page) |
| Leave a club | `POST /clubs/memberships/:id/leave` | Gap |
| Write a portfolio reflection | `/portfolios/*` (`portfolios.reflect`) | Gap (new module) |
| Upload homework files | `POST /uploads` then `submit_assignment` | By design (no file channel; links to uploaded files work) |

### Teacher
| Action | Route | Status |
|---|---|---|
| Block/unblock a PTM slot; check in, mark no-show, record a meeting outcome | `/ptm/slots/:id/block`, `/ptm/bookings/:id/check-in`, `/no-show`, `/outcome` | Gap (outcome creates tasks; next slice) |
| Review-call actions: agree, complete, close, reopen | `/review-calls/:id/actions`, `/close`, `/reopen` | Gap |
| Close a conversation; office-hours note | `POST /conversations/:id/close`, `PUT /conversations/settings` | Gap |
| Term report card: manual marks, co-scholastic grades, discipline | `PATCH /report-cards/:id` | Gap (grids; remarks are done) |
| Approve a report card as class teacher | `POST /report-cards/:id/moderate` | By design (decision) |
| Create club sessions, fixtures, results; equipment issue | `/clubs/:id/sessions`, `/clubs/fixtures*`, `/clubs/equipment*` | Gap |
| Approve/decline a club join request | `POST /clubs/memberships/:id/decision` | By design (decision) |
| Plant a tree record (new plant) | `POST /sustainability/plants` | Gap |
| Create/edit quizzes and questions; publish a quiz | `/quizzes*` | Gap (authoring) / publish by design |
| Syllabus modules: create, edit, delete | `/syllabus/modules*` | Gap (progress is done) |
| Online class: edit, finish | `PATCH /lectures/:id`, `/finish` | Gap |
| Attendance photo (OCR) draft | `POST /attendance/ocr/draft` | By design (file) |
| Publish marks | `POST /exams/publish` | By design (decision) |
| Support plans | `/support-plans*` | Gap (new module; restricted data rules apply) |

### Principal / Admin
| Action | Route | Status |
|---|---|---|
| PTM rounds: create, update, cancel; book for a family | `/ptm/rounds*`, `POST /ptm/bookings` (staff) | Gap |
| Clubs, houses, house assignment | `POST /clubs`, `/clubs/houses*` | Gap |
| Showcase editions; rank entries | `/showcase/editions*` | Gap (draft entry is done) |
| Publish/withdraw a showcase edition; publish report cards; moderate alumni posts | various | By design (publishing/decisions) |
| Alumni events and records, transitions | `/alumni/events`, `/alumni/records`, `/alumni/transitions` | Gap |
| Digest sources | `/digest/sources*` | Gap (SSRF-checked URLs; admin only) |
| Social accounts connect/disconnect | `/social/accounts*` | By design (credentials) |
| Sustainability zones, teams, compost, sanitation duties | `/sustainability/*` | Gap |
| Certificates office: review, issue, reject | `/document-requests/:id/*` | Issue = Gap (needs file); approve/reject by design |
| Correspondence, compliance returns, governance meetings, contracts, org structure, budgets | `/correspondence/*`, `/compliance/*`, `/governance/*`, `/contracts/*`, `/org/*`, `/budgets/*` | Gap for drafting/logging (e.g. log an incoming letter, schedule a board meeting); submissions/decisions by design |
| Users, roles, permissions, schools, domains, customization, seats pricing | `/users`, `/roles`, `/permissions`, `/schools`, `/domains`, `/customization`, `/seats` | By design (credentials, self-widening authorization, platform admin) |
| Safeguarding cases | `/safeguarding/*` | By design (never in chat) |

### Finance / HR / Marketing / Compliance / Librarian / Warden
| Role | Action | Status |
|---|---|---|
| Finance | Approve, reject, refund, record payments; publish fee plans | By design |
| Finance/HR | Payroll runs and compensation | By design (individual pay stays off chat; run totals are readable) |
| HR | Background verification steps and decisions | By design (findings never in chat) |
| Marketing | Campaigns and assets; growth connectors | Gap (campaign drafting) |
| Compliance | Obligations, licences, policies, trainings, accreditation | Gap for record-keeping; submissions by design |
| Everyone on staff | Acknowledge a policy or training | Gap (`/compliance/my/*/acknowledge`, the person's own act) |
| Librarian | Generate accession numbers, print labels, mark a copy lost/damaged | Gap (`/library/copies/generate`, `PATCH /library/copies/:id`); labels are a file (by design) |
| Warden | Out-pass and hostel actions | In `platformOps.js` / existing hostel tools |

### Every role
Sign-in, OTP, profile switching, uploads, webhooks, device telemetry (`/fleet/telemetry`, `/camera/*`,
`/checkpoints/scan`) are not user actions in a conversation and are out of scope by design.

## Rules the new tools follow

- Each tool calls the module's service with the caller's actor and scope, exactly as its route does; the module's
  feature switch is honoured (a switched-off module is refused in chat as on the API).
- Writes are proposed with a concrete summary and run only on the same user's confirmation on the same channel;
  another user's "yes" is refused (tests prove it for PTM booking).
- Decisions are recorded only for the person who holds the authority and only on their explicit confirmation
  on the website (`verify_eco_activity`); none is named as a deciding tool, so `decisions.js` still refuses
  "approve/reject/publish ..." sentences and points to the screen.
- Parents act for their own children only; teachers for their own classes and pupils; families never reach staff
  tools (asserted per role in `tests/mcp.platformPeople.test.js`).
- Restricted data stays out: no private review-call notes, no safeguarding, no camera, no individual pay; digest
  headlines are external text quoted as data.
