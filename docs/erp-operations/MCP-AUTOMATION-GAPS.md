# Assistant automation: what a user can do by asking, and what is still a click

Status as of 2026-10-15, branch `feat/platform-part-2`; updated 2026-10-17 on `feat/platform-part-4` with the
part-4 role tools and the part-5 gap tools (see "Built in part 5" below). The catalogue now has **516 tools**.

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

## Built in part 5 (`tools/p5Gaps.js`, 43 tools)

Every tool below calls the module's own service with the caller's actor and scope (so the module's rules decide:
coach of this club, own child, own slot, own quiz, a second teacher approves a result), is behind the module's
feature switch, and every write is a draft that runs only when the same person confirms it in the same channel.
Tools marked *web* land on other people's records (`affectsOthers` or HIGH risk) and are confirmed on the website
only. Proven in `tests/mcp.p5Gaps.test.js`; every one is reachable by its own name (`tests/mcp.reachability.test.js`).

| Module | Read | Write (draft, then the same user confirms) |
|---|---|---|
| Clubs | — | `schedule_club_session` (*web*; weekly repeats; books a listed venue), `cancel_club_session` (*web*), `schedule_club_fixture` (*web*; club, team or houses), `record_club_fixture_result` (*web*; stays PENDING_APPROVAL until ANOTHER teacher approves on the Clubs page), `cancel_club_fixture` (*web*), `withdraw_club_membership` (student/parent, own child), `create_club` (admin/principal; names the teacher in charge) |
| PTM | — | `join_ptm_waitlist`, `accept_ptm_slot_offer`, `cancel_ptm_waitlist_entry` (parent, own child); `check_in_ptm_meeting`, `mark_ptm_no_show` (*web*), `record_ptm_outcome` (*web*; staff actions become tasks; safeguarding refused), `block_ptm_slot`, `unblock_ptm_slot` (teacher, own slots); `create_ptm_round`, `update_ptm_round` (*web*), `cancel_ptm_round` (HIGH, *web*) for the principal/administration |
| Review calls | — | `add_review_call_action`, `complete_review_call_action`, `close_review_call`, `reopen_review_call` |
| Conversations | — | `close_conversation` (staff), `set_conversation_office_hours` (staff) |
| Quizzes | — | `add_quiz_question`, `update_quiz`, `delete_quiz` (never one that was attempted). Publishing stays on the Quizzes page |
| Syllabus | — | `update_syllabus_module` (title, dates, add topics), `delete_syllabus_module` (never one with lessons recorded) |
| Online classes | — | `reschedule_online_class` (*web*; a move is announced), `finish_online_class` (summary, recording link) |
| Policies (own) | `get_my_policies`, `get_my_trainings` | `acknowledge_policy`, `acknowledge_my_training` (staff, their own acknowledgement) |
| Sustainability | — | `add_eco_planting` (a teacher only for their own eco team) |
| Correspondence | — | `log_correspondence` (incoming letter or outgoing draft), `draft_correspondence_reply` (saved as a draft; approval and dispatch stay on screen) |
| Compliance | — | `add_compliance_obligation` (starts "under review"; deciding applicability stays on screen) |
| Budgets | — | `draft_budget` (DRAFT; submitting for approval stays on screen) |
| Library | — | `update_library_copy_status` (lost, damaged, withdrawn, back on shelf), `generate_library_accession_numbers` (labels are printed on the page) |
| Portfolios | — | `add_portfolio_reflection` (student, own portfolio) |

Already built by the part-4 role tools and now closed in the tables below: report-card manual marks and
co-scholastic grades (`save_report_card_component_marks`, `save_co_scholastic_grades`), quiz authoring
(`create_quiz_draft`, `make_quiz_from_paper`), adding syllabus modules (`plan_syllabus_module`), messaging
preferences (`set_my_message_preferences`), board meetings (`schedule_board_meeting`, `set_board_agenda`), marketing
campaigns (`create_marketing_campaign`), compliance trainings and registers (`schedule_compliance_training`,
`log_data_request`, `save_statutory_committee`), library desk tools (`p4Librarian.js`).

## Still not automatable, per role

"Gap" = recommended next (safe, the user's own act). "By design" = stays on the screen.

### Parent
| Action on screen | Route | Status |
|---|---|---|
| Join the PTM waiting list / accept a freed slot | `POST /ptm/waitlist`, `/waitlist/:id/accept` | **Built** (`join_ptm_waitlist`, `accept_ptm_slot_offer`, `cancel_ptm_waitlist_entry`) |
| Leave a club for a child | `POST /clubs/memberships/:id/leave` | **Built** (`withdraw_club_membership`) |
| Download a certificate, invoice or receipt PDF | `GET /document-requests/mine/:id/file`, `/fees/invoices/:id/pdf`, `/fees/payments/:id/pdf` | By design (file; the chat gives the link to the page) |
| Pay a fee online | `POST /fees/pay` | By design (checkout cannot be completed in chat; `get_payment_link` instead) |
| Record media consent for a child | `POST /community/consents` | Gap (own child; needs a careful consent wording) |
| Acknowledge a support plan | `POST /support-plans/family/:id/acknowledge` | Gap, held back: support plans are restricted data and parent access through the assistant awaits review |
| Mark notifications read | `POST /notifications/read(-all)` | By design (no permission on the endpoint) |
| Messaging preferences | `PUT /messaging/preferences` | **Built** (`set_my_message_preferences`, part 4) |

### Student
| Action | Route | Status |
|---|---|---|
| Take a quiz | `/quizzes/:id/start`, `/submit` | By design (timed, interactive; done on the Quizzes page) |
| Leave a club | `POST /clubs/memberships/:id/leave` | **Built** (`withdraw_club_membership`) |
| Write a portfolio reflection | `/portfolios/*` (`portfolios.reflect`) | **Built** (`add_portfolio_reflection`) |
| Upload homework files | `POST /uploads` then `submit_assignment` | By design (no file channel; links to uploaded files work) |

### Teacher
| Action | Route | Status |
|---|---|---|
| Block/unblock a PTM slot; check in, mark no-show, record a meeting outcome | `/ptm/slots/:id/block`, `/ptm/bookings/:id/check-in`, `/no-show`, `/outcome` | **Built** (`block_ptm_slot`, `unblock_ptm_slot`, `check_in_ptm_meeting`, `mark_ptm_no_show`, `record_ptm_outcome`) |
| Review-call actions: agree, complete, close, reopen | `/review-calls/:id/actions`, `/close`, `/reopen` | **Built** (`add_review_call_action`, `complete_review_call_action`, `close_review_call`, `reopen_review_call`) |
| Close a conversation; office-hours note | `POST /conversations/:id/close`, `PUT /conversations/settings` | **Built** (`close_conversation`, `set_conversation_office_hours`) |
| Term report card: manual marks, co-scholastic grades, discipline | `PATCH /report-cards/:id` | **Built** (part 4: `save_report_card_component_marks`, `save_co_scholastic_grades`) |
| Approve a report card as class teacher | `POST /report-cards/:id/moderate` | By design (decision) |
| Create club sessions, fixtures, results; equipment issue | `/clubs/:id/sessions`, `/clubs/fixtures*`, `/clubs/equipment*` | **Built** for sessions, fixtures and results (`schedule_club_session`, `cancel_club_session`, `schedule_club_fixture`, `record_club_fixture_result`, `cancel_club_fixture`; the result waits for a second teacher). Team sheets and equipment issue/return: Gap (students are picked from a list on screen) |
| Approve/decline a club join request | `POST /clubs/memberships/:id/decision` | By design (decision) |
| Plant a tree record (new plant) | `POST /sustainability/plants` | **Built** (`add_eco_planting`) |
| Create/edit quizzes and questions; publish a quiz | `/quizzes*` | **Built** for authoring (`create_quiz_draft`, `add_quiz_question`, `update_quiz`, `delete_quiz`); publishing by design |
| Syllabus modules: create, edit, delete | `/syllabus/modules*` | **Built** (`plan_syllabus_module`, `update_syllabus_module`, `delete_syllabus_module`) |
| Online class: edit, finish | `PATCH /lectures/:id`, `/finish` | **Built** (`reschedule_online_class`, `finish_online_class`) |
| Attendance photo (OCR) draft | `POST /attendance/ocr/draft` | By design (file) |
| Publish marks | `POST /exams/publish` | By design (decision) |
| Support plans | `/support-plans*` | Gap, held back (restricted data; needs a privacy review before any chat access) |

### Principal / Admin
| Action | Route | Status |
|---|---|---|
| PTM rounds: create, update, cancel; book for a family | `/ptm/rounds*`, `POST /ptm/bookings` (staff) | **Built** for rounds (`create_ptm_round`, `update_ptm_round`, `cancel_ptm_round` HIGH, web only). Booking on a family's behalf: Gap |
| Clubs, houses, house assignment | `POST /clubs`, `/clubs/houses*` | **Built** for clubs (`create_club`); houses and house assignment: Gap |
| Showcase editions; rank entries | `/showcase/editions*` | Gap (draft entry is done) |
| Publish/withdraw a showcase edition; publish report cards; moderate alumni posts | various | By design (publishing/decisions) |
| Alumni events and records, transitions | `/alumni/events`, `/alumni/records`, `/alumni/transitions` | Gap |
| Digest sources | `/digest/sources*` | Gap (SSRF-checked URLs; admin only) |
| Social accounts connect/disconnect | `/social/accounts*` | By design (credentials) |
| Sustainability zones, teams, compost, sanitation duties | `/sustainability/*` | Gap |
| Certificates office: review, issue, reject | `/document-requests/:id/*` | Issue = Gap (needs file); approve/reject by design |
| Correspondence, compliance returns, governance meetings, contracts, org structure, budgets | `/correspondence/*`, `/compliance/*`, `/governance/*`, `/contracts/*`, `/org/*`, `/budgets/*` | **Built**: `log_correspondence`, `draft_correspondence_reply`, `add_compliance_obligation`, `draft_budget`, board meetings (part 4). Gap: contracts and org-structure edits. Submissions, approvals and dispatch by design |
| Users, roles, permissions, schools, domains, customization, seats pricing | `/users`, `/roles`, `/permissions`, `/schools`, `/domains`, `/customization`, `/seats` | By design (credentials, self-widening authorization, platform admin) |
| Safeguarding cases | `/safeguarding/*` | By design (never in chat) |

### Finance / HR / Marketing / Compliance / Librarian / Warden
| Role | Action | Status |
|---|---|---|
| Finance | Approve, reject, refund, record payments; publish fee plans | By design |
| Finance/HR | Payroll runs and compensation | By design (individual pay stays off chat; run totals are readable) |
| HR | Background verification steps and decisions | By design (findings never in chat) |
| Marketing | Campaigns and assets; growth connectors | **Built** for campaign drafting (`create_marketing_campaign`, part 4); assets and connectors on screen |
| Compliance | Obligations, licences, policies, trainings, accreditation | **Built**: `add_compliance_obligation`, `schedule_compliance_training`, registers (part 4). Licences, policy versions, accreditation: Gap; submissions by design |
| Everyone on staff | Acknowledge a policy or training | **Built** (`get_my_policies`, `acknowledge_policy`, `get_my_trainings`, `acknowledge_my_training`) |
| Librarian | Generate accession numbers, print labels, mark a copy lost/damaged | **Built** (`generate_library_accession_numbers`, `update_library_copy_status`); labels are a file (by design) |
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

## Still Gap after part 5

Safe, the user's own act, not yet built: club team sheets and equipment issue/return (students are picked from a
list on screen), houses and house assignment, booking a PTM slot on a family's behalf, showcase editions and
ranking, alumni events/records/transitions, digest sources (SSRF-checked URLs), sustainability zones, teams,
compost and sanitation duties, contracts and org-structure edits, licences and policy versions, media consent
for a child (needs agreed consent wording), and support plans (restricted data; held back pending a privacy
review). Everything marked "By design" stays on its screen.
