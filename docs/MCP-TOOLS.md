# EduOS MCP Tool Catalog

> **Generated file — do not edit by hand.**
> Regenerate with `node backend/scripts/mcp-catalog.js --write`.
> The source of truth is `backend/src/modules/ai/mcp/registry.js`.

**173 tools** — 84 GET, 33 CREATE, 15 UPDATE, 10 DELETE, 31 ACTION.

Risk mix: 90 LOW, 30 HIGH, 52 MEDIUM, 1 CRITICAL.

Status: 171 AVAILABLE, 2 PARTIAL (see below). 2 compatibility aliases, 1 deprecated implementation entry, 13 capabilities deliberately blocked.

## What each column means

| Column | Meaning |
|---|---|
| **Operation** | GET reads; CREATE, UPDATE and DELETE change one record; ACTION performs a business operation that is not plain CRUD. |
| **Risk** | LOW = read. MEDIUM = ordinary single-record change. HIGH = money, admission decisions, bulk reach, external messages, sensitive data, or somebody else's record. CRITICAL = irreversible. |
| **Confirm** | REQUIRED means the tool never runs on the first call: it returns a summary and a token, and a person must approve it. CONDITIONAL means only some calls need it (a dry run does not). |
| **Permission** | Checked against the caller's live permission map on every call, and again at confirmation. |
| **Scope** | ALL means the tool reaches beyond the caller's own records, so an OWN-scoped holder of the permission is refused. "OWN or ALL" means it serves both, and the service narrows OWN callers to their own records. |
| **Status** | AVAILABLE, or PARTIAL where the service it fronts is less than the name suggests (explained below). |

## Permission matrix by role

Computed from each role's grants in `backend/src/constants/permissions.js`, the same way `tools/list` computes discovery at runtime — never from the role name. **High-risk actions** are write tools of risk HIGH or CRITICAL.

| Role | Tools | GET | CREATE | UPDATE | ACTION | DELETE | High-risk actions | Need confirmation |
|---|---|---|---|---|---|---|---|---|
| `SUPER_ADMIN` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ADMIN` | 172 | 84 | 33 | 15 | 30 | 10 | 30 | 82 |
| `PRINCIPAL` | 77 | 53 | 8 | 6 | 9 | 1 | 7 | 24 |
| `TEACHER` | 56 | 41 | 3 | 1 | 10 | 1 | 6 | 15 |
| `PARENT` | 43 | 40 | 1 | 1 | 0 | 1 | 2 | 2 |
| `STUDENT` | 63 | 50 | 7 | 0 | 1 | 5 | 0 | 8 |
| `FINANCE` | 31 | 21 | 5 | 1 | 4 | 0 | 8 | 10 |
| `LIBRARIAN` | 28 | 21 | 1 | 1 | 4 | 1 | 1 | 7 |
| `WARDEN` | 29 | 21 | 2 | 3 | 3 | 0 | 0 | 7 |
| `COUNSELLOR (custom, example)` | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 0 |

Custom roles are database rows, created per school, so none can be listed here in advance. The COUNSELLOR row is the custom role the test suites create; any custom role is computed exactly this way from its own grants.

<details><summary>High-risk actions visible to each role</summary>

- **SUPER_ADMIN** (0): _none_
- **ADMIN** (30): `add_guardian`, `update_enrollment_status`, `archive_student`, `anonymise_student`, `mark_attendance`, `bulk_mark_attendance`, `create_invoice`, `generate_invoices`, `create_fee_plan`, `update_fee_plan`, `update_payment`, `record_payment`, `approve_payment`, `reject_payment`, `decide_payment_change_request`, `transition_fee_plan`, `publish_fee_plan`, `create_fee_structure`, `enter_marks`, `publish_marks`, `update_admission_lead`, `create_announcement`, `update_announcement`, `notify_users`, `send_whatsapp_message`, `delete_book`, `upsert_medical_record`, `remove_medical_record`, `delete_document`, `request_extra_seats`
- **PRINCIPAL** (7): `transition_fee_plan`, `publish_marks`, `create_announcement`, `update_announcement`, `notify_users`, `send_whatsapp_message`, `delete_document`
- **TEACHER** (6): `mark_attendance`, `bulk_mark_attendance`, `enter_marks`, `publish_marks`, `create_announcement`, `delete_document`
- **PARENT** (2): `upsert_medical_record`, `remove_medical_record`
- **STUDENT** (0): _none_
- **FINANCE** (8): `create_invoice`, `generate_invoices`, `create_fee_plan`, `update_fee_plan`, `record_payment`, `refund_payment`, `transition_fee_plan`, `create_fee_structure`
- **LIBRARIAN** (1): `delete_book`
- **WARDEN** (0): _none_
- **COUNSELLOR (custom, example)** (0): _none_

</details>

## Catalog summary

| Tool | Module | Operation | Permission | Scope | Risk | Confirm | Status |
|---|---|---|---|---|---|---|---|
| `add_guardian` | Students | CREATE | `students.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `allocate_hostel_bed` | Hostel | ACTION | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `anonymise_student` | Students | DELETE | `students.manage` | ALL | CRITICAL | REQUIRED | AVAILABLE |
| `apply_for_leave` | Leave | CREATE | `leave.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `approve_payment` | Fees | ACTION | `fees.payments.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `archive_student` | Students | DELETE | `students.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `assign_teacher_to_subject` | Academics | ACTION | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `bulk_mark_attendance` | Attendance | ACTION | `attendance.mark` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `cancel_book_request` | Library | DELETE | `library.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_cocurricular_request` | Student requests | DELETE | `cocurricular.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_profile_edit_request` | Student requests | DELETE | `profile.edit.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_transport_request` | Transport | DELETE | `transport.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `create_academic_year` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_admission_lead` | Admissions | CREATE | `admissions.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_announcement` | Communication | CREATE | `announcements.publish` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `create_assignment` | Assignments | CREATE | `assignments.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_book` | Library | CREATE | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_calendar_event` | Communication | CREATE | `calendar.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_course_material` | Documents | CREATE | `materials.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_exam` | Exams | CREATE | `exams.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_exam_subject` | Exams | CREATE | `exams.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_fee_head` | Fees | CREATE | `fees.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_fee_plan` | Fees | CREATE | `fees.plan.request` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `create_fee_structure` | Fees | CREATE | `fees.structure.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `create_grade` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_hostel_inquiry` | Hostel | CREATE | `hostel.read` | OWN or ALL | MEDIUM | NOT_REQUIRED | AVAILABLE |
| `create_hostel_room` | Hostel | CREATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_invoice` | Fees | CREATE | `fees.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `create_section` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_student` | Students | CREATE | `students.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_subject` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_term` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_ticket` | Tickets | CREATE | `tickets.create` | OWN or ALL | MEDIUM | NOT_REQUIRED | AVAILABLE |
| `create_transport_route` | Transport | CREATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_transport_stop` | Transport | CREATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `decide_book_request` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `decide_cocurricular` | Student requests | ACTION | `cocurricular.review` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `decide_payment_change_request` | Fees | ACTION | `fees.payments.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `decide_profile_edit` | Student requests | ACTION | `profile.edit.review` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `decide_registration` | Registrations | ACTION | `registrations.review` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `decide_transport_request` | Transport | ACTION | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `delete_book` | Library | DELETE | `library.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `delete_document` | Documents | DELETE | `materials.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `enroll_in_transport` | Transport | ACTION | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `enroll_student` | Students | CREATE | `enrollments.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `enter_marks` | Exams | ACTION | `marks.enter` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `generate_homework` | Assignments | ACTION | `assignments.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `generate_invoices` | Fees | ACTION | `fees.manage` | ALL | HIGH | CONDITIONAL | AVAILABLE |
| `get_absent_students` | Attendance | GET | `attendance.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_admission_lead` | Admissions | GET | `admissions.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_admissions` | Admissions | GET | `admissions.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_announcements` | Communication | GET | `announcements.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_assignments` | Assignments | GET | `assignments.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_at_risk_students` | Analytics | GET | `ai.insights.read` | ALL | LOW | NOT_REQUIRED | PARTIAL |
| `get_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_calendar` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_roster` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_statistics` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_trend` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_book` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_book_requests` | Library | GET | `library.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_calendar_events` | Communication | GET | `calendar.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_class_marks` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_dashboard` | Analytics | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_editable_fields` | Student requests | GET | `profile.edit.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_plans` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_statistics` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_structures` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fees` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_growth_score` | Analytics | GET | `ai.insights.read` | OWN or ALL | LOW | NOT_REQUIRED | PARTIAL |
| `get_hostel_residents` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_hostel_summary` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_invoice` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_leave_requests` | Leave | GET | `leave.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_lecture_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_library_summary` | Library | GET | `library.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_marks_grid` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_medical_record` | Medical | GET | `medical.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_book_requests` | Library | GET | `library.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_bus` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_classes` | Academics | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_electives` | Registrations | GET | `registrations.apply` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_profile` | Profile | GET | `ai.copilot.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_profile_edit_requests` | Student requests | GET | `profile.edit.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_transport_requests` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_overdue_books` | Library | GET | `library.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_change_requests` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_history` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_link` | Fees | GET | `fees.pay` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_pending_fees` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_performance` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_performance_history` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_registration_reviews` | Registrations | GET | `registrations.review` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_report_card` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_results` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_school_customization` | Customization | GET | `settings.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_school_domain` | Domains | GET | `domains.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_seat_requests` | Seats | GET | `seats.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_seat_summary` | Seats | GET | `seats.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_overview` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_requests` | Student requests | GET | `cocurricular.review` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_subject_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_subjects` | Academics | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_submissions` | Assignments | GET | `submissions.grade` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_ticket` | Tickets | GET | `tickets.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_timetable` | Timetable | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_requests` | Transport | GET | `transport.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_roster` | Transport | GET | `transport.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_routes` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `grade_submission` | Assignments | ACTION | `submissions.grade` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `issue_book` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `list_academic_years` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_audit_logs` | Audit | GET | `audit.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_book_issues` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_books` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_classes` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_cocurricular` | Student requests | GET | `cocurricular.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_documents` | Documents | GET | `materials.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_enrollments` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_exams` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_guardians` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_allocations` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_inquiries` | Hostel | GET | `hostel.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_rooms` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_notifications` | Notifications | GET | `ai.copilot.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_subjects` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_tickets` | Tickets | GET | `tickets.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_transport_routes` | Transport | GET | `transport.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_transport_stops` | Transport | GET | `transport.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_users` | Users | GET | `users.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `mark_attendance` | Attendance | ACTION | `attendance.mark` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `notify_users` | Communication | ACTION | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `publish_fee_plan` | Fees | ACTION | `fees.plan.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `publish_marks` | Exams | ACTION | `marks.publish` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `record_payment` | Fees | ACTION | `fees.pay` | ALL | HIGH | REQUIRED | AVAILABLE |
| `refund_payment` | Fees | ACTION | `fees.payments.refund` | ALL | HIGH | REQUIRED | AVAILABLE |
| `register_for_elective` | Registrations | CREATE | `registrations.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `reject_payment` | Fees | ACTION | `fees.payments.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `remove_medical_record` | Medical | DELETE | `medical.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `reply_to_ticket` | Tickets | ACTION | `tickets.respond` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_book` | Library | CREATE | `library.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `request_cocurricular` | Student requests | CREATE | `cocurricular.request` | OWN or ALL | MEDIUM | NOT_REQUIRED | AVAILABLE |
| `request_extra_seats` | Seats | CREATE | `seats.request` | ALL | HIGH | REQUIRED | AVAILABLE |
| `request_payment_change` | Fees | CREATE | `fees.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_profile_edit` | Student requests | CREATE | `profile.edit.request` | OWN or ALL | MEDIUM | NOT_REQUIRED | AVAILABLE |
| `request_transport_route` | Transport | CREATE | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `return_book` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `review_leave` | Leave | ACTION | `leave.review` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `search_students` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `send_whatsapp_message` | Communication | ACTION | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `submit_assignment` | Assignments | ACTION | `submissions.submit` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `transition_fee_plan` | Fees | ACTION | `fees.read` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_admission_lead` | Admissions | ACTION | `admissions.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_announcement` | Communication | UPDATE | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_book` | Library | UPDATE | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_course_material` | Documents | UPDATE | `materials.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_enrollment_status` | Students | UPDATE | `enrollments.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_fee_plan` | Fees | UPDATE | `fees.plan.request` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `update_hostel_inquiry` | Hostel | UPDATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_hostel_room` | Hostel | UPDATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_payment` | Fees | UPDATE | `fees.payments.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_section` | Academics | UPDATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_student` | Students | UPDATE | `students.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_subject_offering` | Academics | UPDATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_ticket` | Tickets | UPDATE | `tickets.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_transport_route` | Transport | UPDATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `upsert_medical_record` | Medical | UPDATE | `medical.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `upsert_timetable_slot` | Timetable | UPDATE | `timetable.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `vacate_hostel_bed` | Hostel | ACTION | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `who_is_absent_today` | Attendance | GET | `attendance.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `withdraw_elective_registration` | Registrations | DELETE | `registrations.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |

## Partially implemented

- `get_growth_score` — growth.service.getScore() is a documented stand-in heuristic (60% published marks + 40% attendance for the month), not the ML model its name suggests. It also upserts the computed score as a cache row, as its REST route does.
- `get_at_risk_students` — risk.service.scan() upserts its computed risk rows as a cache, as its REST route does — a read with a side effect on derived data, not on anything a person entered.

## Compatibility aliases

| Legacy name | Redeemed by | Removable when |
|---|---|---|
| `apply_leave` | `apply_for_leave` | No AgentAction row with tool "apply_leave" is PENDING or EXECUTING, and at least 10 minutes have passed since the first MCP deployment. |
| `record_fee_payment` | `record_payment` | No AgentAction row with tool "record_fee_payment" is PENDING or EXECUTING, and at least 10 minutes have passed since the first MCP deployment. |

## Deprecated

- `record_fee_payment` (`backend/src/modules/ai/agent/tools.js`) — Not in the MCP catalog and not reachable from either channel. Replaced by the MCP tool record_payment. Kept only because agent.bulkAuthorization.test.js exercises its permission metadata; safe to delete together with those assertions.

## Blocked — deliberately not exposed

| Capability | Why |
|---|---|
| execute_sql / run_query / raw database access | By design. Every tool calls an existing EduOS service; no tool accepts a query, collection, model or update document (enforced by tests/mcp.architecture.test.js). |
| arbitrary HTTP / API call, shell | By design. No tool accepts a URL to call or a command to run. |
| arbitrary field update | By design. update_student, update_ticket, update_book and update_hostel_room apply explicit field allow-lists; student.service.update() enforces its own for every caller. |
| online payment execution (payOnline / verifyCheckout) | Charging a family from a chat message is not something confirm-before-commit makes safe enough. Families pay through the payment link; staff record payments with record_payment. |
| bulk WhatsApp / email to all parents | announcement.service.dispatch() writes a log line for the email and WhatsApp channels and sends nothing, and Meta requires approved templates for business-initiated messages. A tool would report a delivery that never happened. One-to-one send_whatsapp_message exists. |
| update a phone number | No service writes Account.phoneE164 after creation; phone lives on the Account, not the Student. Would need new business logic. |
| send_email | Only OTP email exists, and EMAIL_PROVIDER=console logs rather than sends. |
| generate_certificate / transfer certificate | No generator exists; the PDF generators that do exist stream to an HTTP response and return nothing reusable. |
| promote_student / transfer_student | No service; updateEnrollmentStatus() only sets one enrolment's status (exposed as update_enrollment_status). |
| generate_fee_report / export | No report service; MCP returns the data (get_fee_statistics, get_pending_fees), not a file. |
| delete_student (hard delete) | Only soft delete (archive_student) and irreversible anonymisation (anonymise_student) exist, both confirmed. Correct as-is. |
| regularize_attendance | The permission exists in the catalog but no route or service implements it. |
| HR / payroll / inventory / events | The modules do not exist. |

## Academics

### `list_classes`

The school's grades and class sections, with each section's id and class teacher. Use this to turn a class name like "Class 6 A" into the sectionId other tools need. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `academics.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.listGrades() + listSections()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_classes` |

**Input**

`gradeId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_subjects`

Every subject configured for the school, and the subject offerings that link a subject to a section and a teacher. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `academics.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.listSubjects() + listOfferings()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_subjects` |

**Input**

`sectionId`: string<br>`termId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_academic_years`

Academic years and terms, with which year is current. Use this to get the academicYearId other tools require. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `academics.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.listYears() + listTerms()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_academic_years` |

**Input**

`academicYearId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_classes`

The caller's own sections and subject offerings — for a teacher, the classes they teach. Can be narrowed to one of those classes. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `timetable.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.getMySections() + getMyOfferings()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_classes` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — One of the caller's own sections

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_section`

Create a class section within a grade, optionally assigning a class teacher. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.createSection()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_section` |

**Input**

`gradeId`: string **(required)**<br>`name`: string **(required)** — e.g. "A"<br>`classTeacherId`: string — Teacher profile id

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_academic_year`

Create an academic year, e.g. "2027-28", with its start and end dates. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.createYear()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_academic_year` |

**Input**

`name`: string **(required)** — e.g. "2027-28"<br>`startsOn`: string **(required)**<br>`endsOn`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_term`

Create a term inside an academic year, e.g. "Term 1", with its start and end dates. Use list_academic_years for the year id. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.createTerm()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_term` |

**Input**

`academicYearId`: string **(required)**<br>`name`: string **(required)** — e.g. "Term 1"<br>`startsOn`: string **(required)**<br>`endsOn`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_grade`

Create a grade (a class level such as "Class 5") with its level number, used to order grades. Sections are added to it with create_section. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.createGrade()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_grade` |

**Input**

`name`: string **(required)** — e.g. "Class 5"<br>`level`: integer **(required)** — e.g. 5 for Class 5

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_subject`

Add a subject to the school's subject list, e.g. "Physics", with an optional short code. Teaching it in a class is a separate step, assign_teacher_to_subject. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.createSubject()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_subject` |

**Input**

`name`: string **(required)** — e.g. "Physics"<br>`code`: string — e.g. "PHY"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_section`

Rename a section or change its class teacher. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.updateSection()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_section` |

**Input**

`sectionId`: string **(required)**<br>`name`: string<br>`classTeacherId`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `assign_teacher_to_subject`

Create a subject offering — the link between a subject, a section, a term and the teacher who teaches it. This is how a teacher is assigned to a class. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `academics.service.createOffering()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.assign_teacher_to_subject` |

**Input**

`subjectId`: string **(required)**<br>`sectionId`: string **(required)**<br>`termId`: string **(required)**<br>`teacherId`: string — Teacher profile id

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_subject_offering`

Change a subject offering — most often to reassign the teacher. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `academics.structure.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `academics.service.updateOffering()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_subject_offering` |

**Input**

`offeringId`: string **(required)**<br>`teacherId`: string<br>`isElective`: boolean<br>`capacity`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_subjects`

The subjects the caller (or their child) studies this year, with the teacher for each. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `timetable.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `academics.service.getMyOfferings()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_subjects` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Admissions

### `get_admissions`

The admissions pipeline: how many enquiries sit at each stage (new, contacted, tour scheduled, application, enrolled, lost) and who they are. Use for "how is admissions going" and "which applications are pending". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `admissions.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `admission.service.getPipeline()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_admissions` |

**Input**

`stage`: string — one of: NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION, ENROLLED, LOST<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_admission_lead`

One admission enquiry in full, with its recorded interaction history newest first. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `admissions.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `admission.service.getLeadById()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_admission_lead` |

**Input**

`leadId`: string **(required)**

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_admission_lead`

Record a new admission enquiry. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `admissions.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `admission.service.createLead()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_admission_lead` |

**Input**

`childName`: string **(required)**<br>`guardianName`: string **(required)**<br>`phone`: string **(required)** — Guardian's phone number<br>`email`: string<br>`gradeApplying`: string<br>`source`: string — one of: WHATSAPP, WEB, WALK_IN, REFERRAL<br>`notes`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_admission_lead`

Move an admission enquiry to a new stage, or change its notes, assignee or next action date. Setting the stage to ENROLLED is how an admission is approved; LOST is how it is rejected. Each stage change is written to the interaction history. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `admissions.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `admission.service.updateLead()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_admission_lead` |

**Input**

`leadId`: string **(required)**<br>`stage`: string — one of: NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION, ENROLLED, LOST — ENROLLED approves the admission; LOST rejects it<br>`notes`: string<br>`assigneeProfileId`: string<br>`nextActionAt`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Analytics

### `get_at_risk_students`

Students flagged at risk from the last 30 days of attendance, published marks and overdue fees. Use for school-wide or class-wide queries asking which students are below an attendance percentage threshold, such as "which students are below 75% attendance" (pass attendanceBelowPct: 75) — it returns each student whose day-level attendance over the last 30 days is below that figure, with the percentage. Do not use for one named student. Students with no attendance marked in the last 30 days cannot be assessed and are not included. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ai.insights.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `risk.service.scan()` |
| **Status** | PARTIAL |
| **Audited** | Yes — `agent.get_at_risk_students` |

**Input**

`attendanceBelowPct`: integer — Only students whose 30-day attendance is below this percentage, e.g. 75<br>`level`: string — one of: LOW, MEDIUM, HIGH — Risk level<br>`type`: string — one of: ATTENDANCE, ACADEMIC_DECLINE, FEE_DEFAULT — Risk type<br>`sectionId`: string<br>`gradeName`: string<br>`search`: string<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_growth_score`

A student's growth score for a period, blending attendance, academics and participation. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ai.insights.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `growth.service.getScore()` |
| **Status** | PARTIAL |
| **Audited** | Yes — `agent.get_growth_score` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`period`: string — Month as YYYY-MM; defaults to the current month

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_dashboard`

The school's dashboard figures. Pass a `view` to choose which: admin (roll, tickets, announcements), finance (collection), teacher, student, parent, warden or librarian. Omit it and the caller's own role decides. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `dashboard.service.get*Dashboard()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_dashboard` |

**Input**

`view`: string — one of: admin, finance, teacher, student, parent, warden, librarian

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Assignments

### `get_assignments`

Homework and assignments. For a student or parent with no filters, the work still to be submitted, soonest deadline first. For a teacher, the work they have set — narrow it with a subject, a class, or both. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `assignments.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `assignment.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_assignments` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string — Narrow to one subject, e.g. "Mathematics"<br>`status`: string — one of: PENDING, SUBMITTED, ALL — For a student or parent: their work still to submit (PENDING), already handed in (SUBMITTED), or both

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_submissions`

The submissions for one assignment, with each student's status and marks where graded. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `submissions.grade` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `assignment.service.listSubmissions()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_submissions` |

**Input**

`assignmentId`: string **(required)**

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_assignment`

Set an assignment or homework for a class. Identify the class and subject by name -- "Mathematics" for "Class 5-A" -- or by subjectOfferingId when you have one. Every student in that section sees it, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `assignments.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `homework.service.resolveOffering() + assignment.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_assignment` |

**Input**

`subjectOfferingId`: string — The class and subject it is for, when known<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string — The subject, as a person names it, e.g. "Mathematics"<br>`title`: string **(required)** — What the work is -- the task, or its topic<br>`description`: string<br>`dueAt`: string **(required)** — When it must be handed in<br>`maxMarks`: integer<br>`type`: string — one of: HOMEWORK, PROJECT, WORKSHEET, LAB<br>`chapter`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `generate_homework`

Draft homework with AI for a class you teach and set it. The draft is written before you are asked to confirm, so you approve homework that already exists in full rather than a promise to generate it. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `assignments.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `homework.service.draftHomework() + commitHomework()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.generate_homework` |

**Input**

`subject`: string<br>`className`: string<br>`topic`: string **(required)** — What the homework is about<br>`dueAt`: string **(required)**<br>`maxMarks`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `grade_submission`

Grade one student's assignment submission: record a mark and optional feedback. Name the student, and the assignment by its title or subject when they have submitted more than one. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `submissions.grade` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `assignment.service.gradeSubmission()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.grade_submission` |

**Input**

`assignmentId`: string — The assignment, when the id is already known<br>`enrollmentId`: string — The student's enrolment, when the id is already known<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`title`: string — The assignment as a person names it, e.g. "Fractions worksheet"<br>`subject`: string — The subject of the assignment, e.g. "Mathematics"<br>`marks`: number **(required)**<br>`feedback`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `submit_assignment`

Submit one of the caller's own assignments. Name it by its subject or title, e.g. "my Mathematics assignment"; with only one still to submit, no name is needed. Needs confirmation, because a submission is a deadline-bearing act the student should mean to make.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `submissions.submit` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `assignment.service.list() + submit()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.submit_assignment` |

**Input**

`assignmentId`: string — Omit it and name the subject or title instead<br>`subject`: string — The subject, e.g. "Mathematics"<br>`title`: string — The assignment title, when the subject has several<br>`link`: string — A link to the work, e.g. a Google Drive link<br>`enrollmentId`: string — Omit to use the caller's own enrolment<br>`attachments`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Attendance

### `get_student_attendance`

Use only when the user asks about the attendance of one specific named student: days present, working days and the percentage. Name a student to look up theirs; name nobody and it answers for the caller (or their child). Do not use for cohort queries, percentage-threshold queries, or "which students" questions (use get_at_risk_students instead). Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_student_attendance` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`month`: string — YYYY-MM<br>`from`: string<br>`to`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_absent_students`

Today's absence snapshot for the whole school: how many students are absent, present, late and excused, and whether the register has been marked at all. Use for "who is absent today" and "how many are absent". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getDailyAbsenceSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_absent_students` |

**Input**

`date`: string — Defaults to today

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_attendance_roster`

Attendance for one whole class, for one date or one calendar month: on a date, every enrolled student with the status marked for them and who is absent; for a month, the class summary. This is the class-level answer — use it for "show the attendance of Class 5-A" and "who is absent in Class 5-A today". There is no class figure over a longer range. Name the class with className; sectionId is for when an id is already known. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getRoster()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_attendance_roster` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section, when the id is already known<br>`date`: string — Defaults to today<br>`month`: string — YYYY-MM — the class summary for a whole month<br>`periodNo`: integer — Omit for day-level attendance

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_attendance_trend`

Month-by-month attendance percentages for a student, for spotting a decline over time. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getTrend()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_attendance_trend` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`months`: integer — How many months back, default 6

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_subject_attendance`

A student's attendance broken down per subject. Note the `basis` field: DAY means the day's status was attributed to each subject scheduled that weekday, PERIOD means true per-period marks. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getSubjectWiseSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_subject_attendance` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`month`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_attendance_calendar`

A day-by-day attendance calendar for one student for one month, showing the status recorded on each date. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getCalendar()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_attendance_calendar` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`month`: string — YYYY-MM; defaults to the current month

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_lecture_attendance`

Lecture-by-lecture attendance for one student over a month or a date range: each period with its subject, time and the status recorded. Only periods actually marked per lecture are counted — a whole-day mark says nothing about an individual lecture. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getLectureAttendance()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_lecture_attendance` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`month`: string — YYYY-MM<br>`from`: string<br>`to`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_attendance_statistics`

Attendance statistics. For staff, the school's register for a date with the present percentage; for a student or parent, their own summary. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getDailyAbsenceSummary() / getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_attendance_statistics` |

**Input**

`date`: string<br>`month`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `who_is_absent_today`

Today's school-wide absence snapshot for leadership. Equivalent to get_absent_students. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getDailyAbsenceSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.who_is_absent_today` |

**Input**

`date`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_attendance`

The caller's own attendance summary — or, for staff, today's school register. Use get_student_attendance instead when the user names a particular student. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getSummary() / getDailyAbsenceSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_attendance` |

**Input**

`month`: string<br>`date`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `mark_attendance`

Record attendance on a date. Say who in one of two ways: `students` — name them (by name, admission number or id) each with a status, which is how "mark Rahul absent" works; or `sectionId` plus `entries` of enrolment ids, as returned by get_attendance_roster. Everyone in one call must be in the same class. This writes to the attendance register — the record a family may dispute later — so it always needs confirmation and is fully audited. Re-marking the same student and date updates the existing entry rather than adding a second one.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `attendance.mark` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `attendance.service.markAttendance()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.mark_attendance` |

**Input**

`students`: array — Students named directly, each with the status to record<br>`everyone`: object — Mark every pupil on the named class register with this status; pupils named in `students` are the exceptions<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section, when giving entries<br>`entries`: array — One entry per enrolment, when marking a register from get_attendance_roster<br>`date`: string — Defaults to today<br>`periodNo`: integer — Omit for day-level attendance

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `bulk_mark_attendance`

Mark a whole section at once from a list of rows, typically "everyone present except these". Bulk register changes always need confirmation. Use mark_attendance for a handful of named students.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `attendance.mark` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `attendance.service.markAttendanceBulk()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.bulk_mark_attendance` |

**Input**

`sectionId`: string **(required)**<br>`date`: string — Defaults to today<br>`periodNo`: integer<br>`rows`: array **(required)** — One row per student, named by roll number or admission number within the section. (To mark by enrolment id, use mark_attendance with entries.)

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Audit

### `list_audit_logs`

The audit trail: who did what and when, including every action the assistant performed (action names beginning "agent."). Defaults to staff activity; narrow it by action, role, person, a date range, a month (YYYY-MM) or a year. Import and export entries are shown only to callers who may manage users. Sensitive fields in the entries are redacted. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `audit.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `audit.service.listLogs()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_audit_logs` |

**Input**

`action`: string — Exact action name, e.g. "agent.mark_attendance"<br>`roleKey`: string — Only actions by holders of this role, e.g. FINANCE<br>`actorProfileId`: string — Only actions by this person<br>`from`: string<br>`to`: string<br>`month`: string — YYYY-MM<br>`year`: string — YYYY<br>`limit`: integer<br>`cursor`: string — From a previous call, to fetch the next page

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Communication

### `get_announcements`

Recent announcements addressed to the caller. The same audience filter the announcements screen uses applies, so a notice the caller was not addressed in is never read out. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `announcements.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `announcement.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_announcements` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_announcement`

Publish or send an announcement. Name a class to address that class alone; otherwise the audience is decided by the school's own rules from the publisher's permissions — a teacher reaches the classes they teach, a school-wide publisher the school. This is visible to many people at once, so it always needs confirmation and the summary names the real audience.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `announcements.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `announcement.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_announcement` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`title`: string **(required)**<br>`content`: string<br>`audience`: object — Optional narrowing. Omit to let the school's rules decide what this publisher may address.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_announcement`

Correct an announcement the caller posted — its message, or its title. Identify it by id, or name the class it was sent to and say "latest"; when more than one could be meant it asks which rather than choosing. A school-wide publisher may correct any notice; anybody else only their own. Everyone who was addressed sees the change, so it always needs confirmation and nothing is written until that confirmation is accepted.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `announcements.publish` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `announcement.service.update()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_announcement` |

**Input**

`announcementId`: string — When the id is already known<br>`className`: string — The class it was addressed to, e.g. "Class 5 A" or "Class 5-A"<br>`latest`: boolean — Take the most recent one that matches<br>`title`: string — A new title<br>`content`: string — The new message

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_calendar_events`

School calendar events in a date range — holidays, exams, functions. Defaults to the next 30 days. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `calendar.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `calendar.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_calendar_events` |

**Input**

`from`: string<br>`to`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_calendar_event`

Add an event to the school calendar, such as a holiday or a function. Everyone sees it, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `calendar.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `calendar.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_calendar_event` |

**Input**

`title`: string **(required)**<br>`description`: string<br>`startsAt`: string **(required)** — ISO date or date-time<br>`endsAt`: string **(required)** — ISO date or date-time; the same day for a one-day event<br>`type`: string — e.g. HOLIDAY, EXAM, EVENT

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `notify_users`

Send an in-app notification to named people, by their profile ids. This appears in their EduOS notification bell — it does not send an email or a WhatsApp message. Reaches other people, so it always needs confirmation and the summary states how many recipients.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `announcements.publish` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `notification.service.notify()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.notify_users` |

**Input**

`recipientProfileIds`: array **(required)** — Profile ids, e.g. from list_users<br>`title`: string **(required)**<br>`body`: string **(required)**<br>`link`: string — In-app path to open, e.g. /admin/payments

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `send_whatsapp_message`

Send one WhatsApp message to one number through the school's WhatsApp account. This leaves the school and cannot be recalled, so it always needs confirmation and the exact text is shown first. There is no bulk-send tool: the school has no approved WhatsApp broadcast capability, and Meta only permits free-form messages inside a 24-hour reply window.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `announcements.publish` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `whatsapp.service.sendMessage()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.send_whatsapp_message` |

**Input**

`to`: string **(required)** — Recipient number in international format, e.g. +919999900001<br>`text`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Customization

### `get_school_customization`

This school's own branding and the option lists its forms offer — houses, zones, and any other dropdown the platform has configured for it. Use it to answer what values a field accepts at this school. Read-only, and always about the caller's own school.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `settings.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `customization.service.getCustomization()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_school_customization` |

**Input**

`dropdownKey`: string — Narrow to one list, e.g. "house". Omit for all of them.

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Documents

### `list_documents`

Documents published to the caller — report cards, transfer certificates, letters and course material. Returns titles and types; the files themselves are downloaded from the Documents screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `materials.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `document.service.listForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_documents` |

**Input**

`studentId`: string<br>`type`: string<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `delete_document`

Permanently delete a published document — a report card, certificate, letter or course material. A school-wide holder of the permission may delete any document; anyone else only documents they uploaded themselves. Always needs confirmation. Use list_documents to find the document id.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `materials.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `document.service.listForActor() + deleteForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.delete_document` |

**Input**

`documentId`: string — From list_documents<br>`title`: string — The document as a person names it. An ambiguous title is refused, never guessed.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_course_material`

Publish course material to a class — notes, a worksheet or a handout already uploaded to this system. The file must be one uploaded here (an /uploads/ path); a link to anywhere else is refused. A teacher may publish only to a class they teach, and only course material. A whole class sees it, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `materials.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `document.service.createForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_course_material` |

**Input**

`title`: string **(required)**<br>`fileUrl`: string **(required)** — The path the upload endpoint returned, e.g. /uploads/chapter-3.pdf<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class this material is for<br>`mimeType`: string<br>`visibleToRoles`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_course_material`

Correct course material already published — its title, the uploaded file it points at, or the class it is for. A teacher may change only material they published themselves, and only course material. Use list_documents to find the id. A class sees the result, so it needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `materials.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `document.service.listForActor() + updateForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_course_material` |

**Input**

`documentId`: string — From list_documents<br>`title`: string<br>`newTitle`: string — The new title, when renaming material named by its current title<br>`fileUrl`: string — The path the upload endpoint returned<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string<br>`mimeType`: string<br>`visibleToRoles`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Domains

### `get_school_domain`

This school's portal address — a platform subdomain or its own custom domain — whether it is verified, whether its certificate works, whether it is live, the DNS records still required, and the domain from the website on the School Admin profile ("Not Provided" when there is none) with whether it has been applied. Read-only, and always about the caller's own school.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `domains.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `domain.service.getDomain()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_school_domain` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Exams

### `get_results`

Published exam results and the report-card summary for the caller (or their child). Use get_report_card when the user names another student. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.getReportCard()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_results` |

**Input**

`exam`: string — Exam name, e.g. "Unit Test 1"

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_report_card`

A student's report card: subject marks, percentage, grade and GPA for a published exam. Only published results are visible. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.getReportCard()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_report_card` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string<br>`exam`: string<br>`subject`: string — Narrow to one subject, e.g. "Mathematics"

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_class_marks`

How a whole class performed: every student's marks for the class's exam papers, with the class average, highest and lowest, and how many papers are still unmarked. Name the class, and optionally one subject or exam. This is the class-level answer — for one student's report card use get_report_card. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.listExamSubjects() + getMarksGrid()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_class_marks` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section, when the id is already known<br>`subject`: string — Narrow to one subject, e.g. "Mathematics"<br>`exam`: string — Narrow to one exam, e.g. "Unit Test 2"

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_marks_grid`

The mark-entry grid for one exam subject: every enrolled student with the marks recorded so far and the maximum. Use before enter_marks. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.getMarksGrid()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_marks_grid` |

**Input**

`examSubjectId`: string **(required)**

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_exams`

Exams configured for a term, and their exam subjects with maximum marks. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.listExams() + listExamSubjects()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_exams` |

**Input**

`termId`: string<br>`examId`: string — List the subjects of one exam

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_performance_history`

A student's published results across exams over time, for spotting a trend. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.getPerformanceHistory()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_performance_history` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_performance`

A student's published marks as they stand — each graded paper with its subject and score. Distinct from get_performance_history, which reports results across years and terms to show a trend. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.getPerformance()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_performance` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`enrollmentId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_exam`

Create an exam within a term. Add exam subjects afterwards with create_exam_subject. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `exams.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.createExam()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_exam` |

**Input**

`name`: string **(required)**<br>`termId`: string **(required)**<br>`startsOn`: string **(required)**<br>`endsOn`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_exam_subject`

Add a subject to an exam, with its maximum marks and exam date. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `exams.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `exam.service.createExamSubject()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_exam_subject` |

**Input**

`examId`: string **(required)**<br>`subjectOfferingId`: string **(required)**<br>`maxMarks`: integer **(required)**<br>`examDate`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `enter_marks`

Record, enter, submit or update marks for students in one exam paper. Name the paper by class, subject and exam, and each student by name or admission number with their marks; re-entering a student's marks updates them. Marks stay unpublished until publish_marks, so students do not see them yet, and marks already published cannot be changed. Writes to other people's academic records, so it needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `marks.enter` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `exam.service.enterMarks()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.enter_marks` |

**Input**

`examSubjectId`: string — The exam paper, when the id is already known<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string — The subject of the paper, e.g. "Mathematics"<br>`exam`: string — The exam, e.g. "Unit Test 2"<br>`students`: array — Students named directly, each with their marks<br>`entries`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `publish_marks`

Publish the marks for one exam subject, making them visible to students and parents. This is what families see, and it is hard to walk back, so it always needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `marks.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `exam.service.publishMarks()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.publish_marks` |

**Input**

`examSubjectId`: string — The exam paper, when the id is already known<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string — The subject of the paper, e.g. "Mathematics"<br>`exam`: string — The exam, e.g. "Unit Test 2"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Fees

### `get_pending_fees`

Unpaid and partly paid fee invoices with the amount still owed on each, and the outstanding total. Use for "who has pending fees", "how much is outstanding", and "what are Rahul's fees" (pass search). With a search or section the totals cover only what matched; without one they cover everything the caller may see. Staff see the school; a family sees their own. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.listInvoices() + getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_pending_fees` |

**Input**

`search`: string — One student by name or admission number, or an invoice number<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string<br>`academicYearId`: string<br>`limit`: integer — Invoices to return, default 25

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_fee_statistics`

Fee collection statistics: total billed, total collected, collection percentage, and what is outstanding and overdue. Use for "how much have we collected" and collection-rate questions. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_fee_statistics` |

**Input**

`academicYearId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_payment_history`

Fee payments that have been recorded — receipt number, invoice, student, amount, mode, date and verification status. Staff see the school; a family sees only their own settled payments. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.listPayments()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_payment_history` |

**Input**

`search`: string — Student name, admission number or receipt/invoice number<br>`invoiceId`: string<br>`from`: string<br>`to`: string<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_invoice`

One fee invoice in full — line items, total, amount paid, status, due date and the payments settled against it. Name it by invoiceId or by its invoice number. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.getInvoiceDetail()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_invoice` |

**Input**

`invoiceId`: string<br>`invoiceNo`: string — Alternative to invoiceId, e.g. "INV-1042"

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_fee_plans`

Installment and part-payment plans, with the approval stage each is at. Use for "which installment plans are waiting for approval". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `plan.service.listFeePlans()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_fee_plans` |

**Input**

`status`: string — one of: DRAFT, PENDING_FINANCE_REVIEW, FINANCE_REVIEWED, PENDING_ADMIN_APPROVAL, APPROVED, REJECTED, PUBLISHED<br>`studentId`: string<br>`enrollmentId`: string<br>`academicYearId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_payment_change_requests`

Requests to amend a finalised payment record, with what was asked for and the current decision. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.listPaymentChangeRequests()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_payment_change_requests` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED<br>`paymentId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_fee_structures`

The fee heads and fee structures configured for the school, by academic year and grade. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.listFeeHeads() + listFeeStructures()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_fee_structures` |

**Input**

`academicYearId`: string<br>`gradeId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_fees`

The caller's own outstanding fee balance and payment status. Use get_pending_fees instead when the user asks about students in general or names one. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_fees` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_payment_link`

A link the caller can use to pay their own outstanding invoice online. Returns links only — it never moves money. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.pay` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.getPaymentLinks()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_payment_link` |

**Input**

`invoiceId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_invoice`

Raise one fee invoice against one enrolment, with its line items. The invoice number must be unique; a duplicate is refused. Creates a financial record, so it always needs confirmation. To bill a whole year or grade from the fee structures, use generate_invoices.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.createInvoice()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_invoice` |

**Input**

`enrollmentId`: string **(required)**<br>`invoiceNo`: string **(required)**<br>`dueOn`: string **(required)**<br>`lines`: array **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `generate_invoices`

Generate invoices in bulk for every active enrolment in an academic year (optionally one grade) from the configured fee structures. Enrolments already billed for a structure are skipped, so running it twice does not bill anyone twice. This bills many families at once, so it needs confirmation — run it with dryRun: true first to see how many invoices it would create, which needs none.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | CONDITIONAL |
| **Permission** | `fees.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.generateInvoices()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.generate_invoices` |

**Input**

`academicYearId`: string **(required)**<br>`gradeId`: string — Restrict to one grade; omit to bill the whole year<br>`dueOn`: string<br>`dryRun`: boolean — Count and total without writing anything

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_fee_plan`

Draft an installment or part-payment plan for one enrolment. This creates a DRAFT only — it approves and publishes nothing; those are separate, separately-permissioned steps (transition_fee_plan, publish_fee_plan). Installment amounts must add up exactly to totalPaise. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.plan.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `plan.service.createFeePlan()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_fee_plan` |

**Input**

`enrollmentId`: string **(required)**<br>`mode`: string **(required)** — one of: ONE_TIME, PARTIAL, INSTALLMENT<br>`totalPaise`: integer **(required)** — Whole paise<br>`installments`: array **(required)** — Installments in due-date order. Their amounts must add up exactly to totalPaise. ONE_TIME has exactly one; PARTIAL and INSTALLMENT at least two.<br>`name`: string — Defaults to "Fee plan"<br>`feeHeadId`: string — The fee head this plan settles, if one<br>`notes`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_fee_plan`

Amend a fee plan that is still a draft or came back rejected. A plan under review, approved or published cannot be edited — the service refuses. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.plan.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `plan.service.updateFeePlan()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_fee_plan` |

**Input**

`planId`: string **(required)**<br>`mode`: string — one of: ONE_TIME, PARTIAL, INSTALLMENT<br>`totalPaise`: integer<br>`installments`: array — Installments in due-date order. Their amounts must add up exactly to totalPaise. ONE_TIME has exactly one; PARTIAL and INSTALLMENT at least two.<br>`name`: string<br>`feeHeadId`: string<br>`notes`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_payment`

Correct a payment record: its mode, paid-on date, receipt number, notes or instrument details. The amount can only be changed on a rejected payment. Every field changed is individually audited by the fee service, and changing a verified payment needs payment-approval rights. Give a reason. Always needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.payments.approve` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.updatePayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_payment` |

**Input**

`paymentId`: string **(required)**<br>`amountPaise`: integer — Only on a REJECTED payment<br>`mode`: string — one of: CASH, CHEQUE, DD, BANK<br>`paidOn`: string<br>`receiptNo`: string<br>`notes`: string<br>`instrument`: object — Required for CHEQUE, DD and BANK: number, bankName, instrumentDate and a proofUrl (image or PDF). Not used for CASH.<br>`reason`: string — Why the record is being corrected — recorded with the change

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_payment`

Record a fee payment received against an invoice. Name the invoice by its number (e.g. "INV-1042") or id; the amount is in whole paise (₹500 is 50000). Staff only — a family cannot mark its own invoice paid and must use the online payment link. When the person recording cannot approve payments, the payment is saved pending admin approval. CHEQUE, DD and BANK payments need instrument details with a proof URL; CASH needs none. Money moves in the ledger, so this always needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.pay` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.recordPayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_payment` |

**Input**

`invoiceId`: string — Preferred when known<br>`invoiceNo`: string — Alternative to invoiceId<br>`amountPaise`: integer **(required)** — Whole paise. ₹500 is 50000.<br>`mode`: string — one of: CASH, CHEQUE, DD, BANK — Cash unless another mode is named<br>`paidOn`: string<br>`receiptNo`: string<br>`notes`: string<br>`instrument`: object — Required for CHEQUE, DD and BANK: number, bankName, instrumentDate and a proofUrl (image or PDF). Not used for CASH.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `approve_payment`

Approve a payment that is pending admin approval, making it final and visible to the family. Requires the payment-approval permission, which Finance deliberately does not hold. Needs confirmation. A payment already approved cannot be approved again.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.payments.approve` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.approvePayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.approve_payment` |

**Input**

`paymentId`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `reject_payment`

Reject a payment awaiting approval. A reason is required and is recorded. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.payments.approve` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.rejectPayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.reject_payment` |

**Input**

`paymentId`: string **(required)**<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `refund_payment`

Refund a captured payment and deduct it from the invoice. Needs confirmation. The service refuses a second refund of the same payment, so a retry cannot deduct twice.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.payments.refund` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.refundPayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.refund_payment` |

**Input**

`paymentId`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `request_payment_change`

Ask for a correction to a published (finalised) payment — one field, its new value and why. Nothing changes until someone with payment-approval rights approves it. Editable fields: amountPaise, mode, paidOn, receiptNo, notes and the instrument details. A payment still awaiting approval is corrected with update_payment instead. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `fee.service.createPaymentChangeRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_payment_change` |

**Input**

`paymentId`: string **(required)**<br>`field`: string **(required)** — one of: amountPaise, mode, paidOn, receiptNo, notes, instrument.number, instrument.referenceNo, instrument.bankName, instrument.instrumentDate<br>`requestedValue`: string **(required)** — The new value; paise for amountPaise, YYYY-MM-DD for dates<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `decide_payment_change_request`

Approve or reject a request to amend a finalised payment. Approving applies the requested change. A reason is needed to reject. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.payments.approve` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.decidePaymentChangeRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_payment_change_request` |

**Input**

`requestId`: string **(required)**<br>`approve`: boolean **(required)**<br>`reason`: string — Required when rejecting

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `transition_fee_plan`

Move a fee plan along its approval workflow: submit (draft → finance review), review (finance reviewed), requestApproval (→ admin approval), approve, or reject. Each step needs its own permission — whoever drafts a plan is deliberately not whoever approves it. Rejecting needs a reason. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.read` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `plan.service.transitionFeePlan()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.transition_fee_plan` |

**Input**

`planId`: string **(required)**<br>`step`: string **(required)** — one of: submit, review, requestApproval, approve, reject<br>`reason`: string — Required for reject<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `publish_fee_plan`

Publish an approved fee plan, which raises one invoice per installment — the point at which the family sees it. Requires the plan-approval permission. Installments that already have an invoice are skipped, so publishing twice bills nobody twice. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.plan.approve` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `plan.service.publishFeePlan()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.publish_fee_plan` |

**Input**

`planId`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_fee_head`

Add a fee head — the thing a charge is for, such as "Tuition" or "Transport". A fee head is school-wide configuration and every future structure and invoice is billed against it, so it needs confirmation. The name must be one the school does not already use.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.structure.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.createFeeHeadForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_fee_head` |

**Input**

`name`: string **(required)** — e.g. "Tuition"<br>`category`: string — Optional grouping, e.g. "TUITION"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_fee_structure`

Set what a fee head costs for an academic year, and optionally for one grade only — omit the grade and it applies to every grade. This is what invoices are generated from, so it decides what families are billed and always needs confirmation. Use get_fee_structures for the existing configuration and the fee head id.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.structure.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `fee.service.createFeeStructureForActor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_fee_structure` |

**Input**

`feeHeadId`: string **(required)** — From get_fee_structures<br>`academicYearId`: string **(required)** — The year this charge applies to<br>`gradeId`: string — One grade only; omit for every grade<br>`name`: string **(required)** — e.g. "Tuition — Term 1"<br>`amountPaise`: integer **(required)** — The amount in paise, so ₹4,000 is 400000<br>`dueOn`: string **(required)** — When it falls due

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Hostel

### `get_hostel_summary`

Hostel occupancy: beds occupied and free, occupancy rate, room count and open enquiries. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_hostel_summary` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_hostel_residents`

The students currently allocated a hostel bed, with room and block. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.listHostelStudents()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_hostel_residents` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_hostel_rooms`

Hostel rooms with capacity, beds occupied and beds free — use it to find a room with space. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.listRooms()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_hostel_rooms` |

**Input**

`roomNo`: string — The room as a person names it, e.g. "101"<br>`type`: string — one of: BOYS, GIRLS, STAFF, GENERAL<br>`status`: string — one of: ACTIVE, MAINTENANCE, CLOSED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_hostel_allocations`

Bed allocations — which student is in which room, active or vacated. Narrow to one room by number, or to one student by name or admission number. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.listAllocations()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_hostel_allocations` |

**Input**

`roomId`: string<br>`roomNo`: string — The room as a person names it, e.g. "101"<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`status`: string — one of: ACTIVE, VACATED — Default ACTIVE

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_hostel_inquiries`

Hostel enquiries raised by students, parents or staff, and their status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.listInquiries()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_hostel_inquiries` |

**Input**

`status`: string — one of: OPEN, IN_PROGRESS, RESOLVED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_hostel_room`

Add a hostel room with its bed capacity. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.createRoom()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_hostel_room` |

**Input**

`roomNo`: string **(required)**<br>`block`: string — Default Main<br>`floor`: string<br>`capacity`: integer **(required)**<br>`type`: string — one of: BOYS, GIRLS, STAFF, GENERAL — Default GENERAL<br>`amenities`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_hostel_room`

Change a hostel room's number, block, floor, capacity, type, status or amenities. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.listRooms() + updateRoom() — behind an MCP field allow-list` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_hostel_room` |

**Input**

`roomId`: string<br>`roomNo`: string<br>`block`: string<br>`floor`: string<br>`capacity`: integer<br>`type`: string — one of: BOYS, GIRLS, STAFF, GENERAL<br>`status`: string — one of: ACTIVE, MAINTENANCE, CLOSED<br>`amenities`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_hostel_inquiry`

Raise a hostel enquiry — a subject and optional description, optionally about one student. It is recorded as raised by the caller. Low impact, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.createInquiry()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_hostel_inquiry` |

**Input**

`subject`: string **(required)**<br>`description`: string<br>`studentId`: string — The student it concerns, if any

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `update_hostel_inquiry`

Move a hostel enquiry to OPEN, IN_PROGRESS or RESOLVED. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.updateInquiry()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_hostel_inquiry` |

**Input**

`inquiryId`: string **(required)**<br>`status`: string **(required)** — one of: OPEN, IN_PROGRESS, RESOLVED

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `allocate_hostel_bed`

Allocate a bed in a hostel room to a student, named by name, admission number or id. A student who already holds an active allocation is refused rather than given a second bed. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `hostel.service.allocate()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.allocate_hostel_bed` |

**Input**

`roomId`: string<br>`roomNo`: string — The room as a person names it, e.g. "101"<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`academicYearId`: string<br>`allottedAt`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `vacate_hostel_bed`

Vacate a hostel allocation, freeing the bed. An allocation already vacated is refused. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `hostel.service.vacate()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.vacate_hostel_bed` |

**Input**

`allocationId`: string<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Leave

### `get_leave_requests`

Leave applications. For someone who reviews leave, the ones waiting on them (default status PENDING); for anyone else, their own. Use for "which leave requests are pending". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `leave.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `leave.service.listForReview() / listMine()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_leave_requests` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED<br>`mine`: boolean — The caller's own applications, even if they can review<br>`from`: string — Only leave overlapping this date or later<br>`to`: string — Only leave overlapping this date or earlier

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `apply_for_leave`

Submit a leave application for the caller, with a start date, end date and reason. Needs confirmation, so the dates and reason are approved before the application is filed.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `leave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `leave.service.apply()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.apply_for_leave` |

**Input**

`fromDate`: string<br>`toDate`: string<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `review_leave`

Approve or reject somebody's leave application, with optional remarks. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `leave.review` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `leave.service.listForReview() + review()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.review_leave` |

**Input**

`requestId`: string — From get_leave_requests. Omit it and name the student instead.<br>`studentName`: string — Who raised it, e.g. "Rahul". More than one pending match is refused, never guessed.<br>`leaveId`: string — Alternative to requestId<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`remarks`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Library

### `get_library_summary`

Library totals: catalog size, unique titles, books currently on loan and how many are overdue. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.getSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_library_summary` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_overdue_books`

Books past their return date, with who is holding each and when it was due. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listIssues({ status: OVERDUE })` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_overdue_books` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_books`

Search the library catalog by title, author, ISBN, category or publisher, with how many copies are available. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_books` |

**Input**

`search`: string — Title, author, ISBN, category or publisher<br>`category`: string<br>`author`: string<br>`resourceKind`: string — one of: BOOK, NOTE, QUESTION_PAPER<br>`availableOnly`: boolean — Only items with a copy on the shelf<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_book`

One catalog item in full, with total and available copies. Name it by title or by id. Use it for "how many copies of X are available". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks() + getBookById()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_book` |

**Input**

`bookId`: string<br>`title`: string — The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_book_issues`

Lending records — what is on loan, to whom, when it is due, and what has been returned. A student or parent sees only their own. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listIssues()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_book_issues` |

**Input**

`status`: string — one of: ACTIVE, RETURNED, OVERDUE — ACTIVE means currently on loan<br>`bookId`: string<br>`studentId`: string<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_book`

Add an item to the library catalog. A BOOK is a physical title with shelf copies; a NOTE or QUESTION_PAPER is digital and needs a resourceUrl. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.createBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_book` |

**Input**

`title`: string **(required)**<br>`author`: string **(required)**<br>`isbn`: string<br>`category`: string — Defaults to General<br>`totalCopies`: integer — Physical copies; default 1<br>`resourceKind`: string — one of: BOOK, NOTE, QUESTION_PAPER — Default BOOK<br>`resourceUrl`: string — Required for NOTE and QUESTION_PAPER<br>`publisher`: string<br>`publishedYear`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_book`

Correct a catalog entry — title, author, ISBN, category, publisher, year or total copies. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks() + updateBook() — behind an MCP field allow-list` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_book` |

**Input**

`bookId`: string<br>`title`: string<br>`author`: string<br>`isbn`: string<br>`category`: string<br>`publisher`: string<br>`publishedYear`: integer<br>`totalCopies`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `delete_book`

Remove an item from the library catalog. It is hidden from the catalog, not erased, and its lending history is kept. It does not check for copies currently on loan, so make sure they are returned first. Always needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks() + deleteBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.delete_book` |

**Input**

`bookId`: string<br>`title`: string — The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `issue_book`

Lend a library item to a student until a due date. Name the student by name, admission number or id. A copy is claimed atomically, so two simultaneous requests cannot both take the last one. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `library.service.issueBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.issue_book` |

**Input**

`bookId`: string<br>`title`: string — The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`dueAt`: string — When it must be returned

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `return_book`

Record the return of a lent item. Name the item by title, and the borrower by name if more than one copy is out. Returning an item already returned is refused rather than counted twice. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `library.service.listIssues() + returnBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.return_book` |

**Input**

`issueId`: string — From list_book_issues<br>`title`: string — The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `request_book`

Ask the library to issue a book to the caller. Name it by title or by id. The book must be a physical copy in this school's catalogue — an online resource is read where it lives and cannot be issued. The request goes to the librarian and changes nothing until it is approved, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks() + requestBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_book` |

**Input**

`bookId`: string — From list_books<br>`title`: string — The book as a person names it, e.g. "Introduction to Algorithms". An ambiguous title is refused, never guessed.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_book_requests`

The caller's own book requests and what was decided on each. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listMyBookRequests()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_book_requests` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_book_requests`

Book requests waiting for the librarian to decide, with who asked and whether a copy is free. Defaults to the pending ones. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBookRequestsForReview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_book_requests` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED, CANCELLED, ALL<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `decide_book_request`

Approve or reject a book request. Name the request by the student who made it, by the book, or by id. Approving issues the book to the student and takes a copy off the shelf; if no copy is free the approval is refused and the request stays waiting. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `library.service.listBookRequestsForReview() + decideBookRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_book_request` |

**Input**

`requestId`: string — From get_book_requests<br>`studentName`: string — The student who asked, e.g. "Rahul". More than one pending request matching is refused, never guessed.<br>`title`: string — The book that was asked for<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`note`: string — Shown to the student with the decision<br>`dueAt`: string — When the book is due back; defaults to a fortnight from today

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_book_request`

Withdraw the caller's own book request, while the librarian has not yet decided on it. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `library.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listMyBookRequests() + cancelBookRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_book_request` |

**Input**

`requestId`: string — From get_my_book_requests. Omit it when you have only one pending request.<br>`title`: string — The book the request is for, e.g. "Clean Code"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Medical

### `get_medical_record`

A student's medical record: blood group, height, weight, allergies, medications, history and emergency contact. Sensitive — the service limits it to the student's class teacher, medical staff and family, and every read is audited. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `medical.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `medical.service.getByStudentId()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_medical_record` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `upsert_medical_record`

Create or update a student's medical record. Only the fields given are changed. This is sensitive health data a school may act on in an emergency, so it always needs confirmation and is audited.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `medical.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `medical.service.upsert()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.upsert_medical_record` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`bloodGroup`: string<br>`heightCm`: number<br>`weightKg`: number<br>`allergies`: array<br>`medications`: array<br>`history`: string — Relevant medical history and conditions<br>`emergencyContact`: object

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `remove_medical_record`

Delete a student's medical record. The school may need it in an emergency, so this always needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `medical.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `medical.service.remove()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.remove_medical_record` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Notifications

### `list_notifications`

The caller's own in-app notifications, and how many are unread. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ai.copilot.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `notification.service.list() + unreadCount()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_notifications` |

**Input**

`unreadOnly`: boolean<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Profile

### `get_my_profile`

The caller's own profile, from their signed-in identity: name, role, school, contact details, account status and when the profile was created. Use it for any question a person asks about themselves — "what is my name", "show my profile", "tell me about myself", "what is my designation", "what is my employee id", "when did I join". Pass `field` to answer one category, or omit it for everything. It answers only about the caller — there is no way to name another person — and it says plainly when the school does not record something rather than guessing. For the classes someone teaches use get_my_classes, for their subjects get_subjects, for their timetable get_timetable. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ai.copilot.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `auth.service.me() + academics.service.getMySections()/getMyOfferings()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_profile` |

**Input**

`field`: string — one of: all, employeeId, reportingManager, joined, department, designation, email, phone, contact, name, school, status, role — Which category to answer: all (default), name, role, school, contact, status, joined, employeeId, designation, department, reportingManager

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Registrations

### `get_registration_reviews`

Elective subject registrations waiting for a decision, with the student and subject each asked for. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `registrations.review` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `registration.service.listForReview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_registration_reviews` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED<br>`from`: string — Only requests made on this date or later<br>`to`: string — Only requests made on this date or earlier

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_electives`

The elective subjects open to the caller and the ones they have already registered for. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `registrations.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `registration.service.listAvailable() + listMine()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_electives` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `register_for_elective`

Register the caller for an elective subject open to their class, named as a person names it, e.g. "Music". It goes for review before it takes effect. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `registrations.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `registration.service.listAvailable() + register()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.register_for_elective` |

**Input**

`subjectOfferingId`: string — From get_my_electives. Omit it and name the subject instead.<br>`subject`: string — The elective as a person names it, e.g. "Music"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `withdraw_elective_registration`

Withdraw the caller's own elective registration. Name the elective by its subject; with only one registration, no name is needed. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `registrations.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `registration.service.listMine() + withdraw()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.withdraw_elective_registration` |

**Input**

`registrationId`: string — From get_my_electives<br>`subject`: string — The elective as a person names it, e.g. "Music"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `decide_registration`

Approve or reject an elective subject registration. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `registrations.review` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `registration.service.listForReview() + decide()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_registration` |

**Input**

`requestId`: string — From get_registration_reviews. Omit it and name the student instead.<br>`studentName`: string — Who raised it, e.g. "Rahul". More than one pending match is refused, never guessed.<br>`registrationId`: string — Alternative to requestId<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Seats

### `get_seat_summary`

How many seats this school has bought, how many the platform has approved for use, how many are in use and how many are free. Also reports the school's own per-seat price — what extra seats would cost it — and seats that are paid for but still waiting for platform approval, which cannot be used yet. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `seats.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `seat.service.getSeatSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_seat_summary` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_seat_requests`

This school's extra-seat requests and where each one has got to: awaiting payment, paid and waiting for the platform to decide, approved, or rejected. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `seats.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `seat.service.listSeatRequests()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_seat_requests` |

**Input**

`status`: string — one of: PENDING_PAYMENT, PAID, APPROVED, REJECTED — Narrow to one stage of the request lifecycle

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_extra_seats`

Ask the platform for extra seats for this school. The price is calculated by the server from the seat count and this school's own per-seat rate — it cannot be set here. Raising the request allocates nothing: it has to be paid for on the seat page and then approved by the platform before the seats can be used.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `seats.request` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `seat.service.createSeatRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_extra_seats` |

**Input**

`seats`: integer **(required)** — How many extra seats to ask for<br>`reason`: string — Why the school needs them

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Student requests

### `get_student_requests`

Student-raised requests waiting for a decision: co-curricular achievements to add to a profile, and profile-correction requests. Profile corrections are included only for callers who may review them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `cocurricular.review` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cocurricular.service.listForReview() + profileEdit.service.listForReview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_student_requests` |

**Input**

`kind`: string — one of: COCURRICULAR, PROFILE_EDIT, BOTH — Default BOTH<br>`status`: string — one of: PENDING, APPROVED, REJECTED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_cocurricular`

Co-curricular activities and achievements on a student's record, in every state — approved, pending and rejected. Distinct from the review queue: this is what the record holds, not what is waiting for a decision. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `cocurricular.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cocurricular.service.listForStudent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_cocurricular` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`status`: string — one of: ALL, PENDING, APPROVED, REJECTED — Default: every state

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_cocurricular`

Ask for a co-curricular activity or achievement to be added to the caller's own profile. The activity date cannot be in the future. It goes to the class teacher for review and changes nothing until approved, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `cocurricular.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cocurricular.service.request()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_cocurricular` |

**Input**

`name`: string **(required)** — The activity, e.g. "Inter-school football tournament"<br>`activityDate`: string **(required)** — When it took place<br>`category`: string — one of: SPORTS, ARTS, MUSIC, DANCE, DRAMA, LITERARY, SCIENCE, SOCIAL_SERVICE, LEADERSHIP, CLUB, OTHER<br>`level`: string — one of: SCHOOL, INTER_SCHOOL, DISTRICT, STATE, NATIONAL, INTERNATIONAL, OTHER<br>`achievement`: string — e.g. "Runner-up"<br>`description`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `decide_cocurricular`

Approve or reject a co-curricular request. Approving adds it to the student's profile. A reason is expected when rejecting. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `cocurricular.review` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `cocurricular.service.listForReview() + decide()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_cocurricular` |

**Input**

`requestId`: string — From get_student_requests. Omit it and name the student instead.<br>`studentName`: string — Who raised it, e.g. "Rahul". More than one pending match is refused, never guessed.<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`rejectionReason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_editable_fields`

The profile fields a student may request a correction to. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `profile.edit.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `profileEdit.service.EDITABLE_FIELD_LIST` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_editable_fields` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_profile_edit`

Ask for a correction to the caller's own profile. Only first name, last name, date of birth, gender and address can be corrected this way. Only one request may be pending at a time. Changes nothing until a class teacher approves, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `profile.edit.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `profileEdit.service.request()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_profile_edit` |

**Input**

`changes`: object — The corrected values<br>`field`: string — The field to correct, as a person names it, e.g. "address" or "date of birth"<br>`value`: string — The corrected value<br>`note`: string — Why the correction is needed

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `decide_profile_edit`

Approve or reject a profile-correction request. Approving writes the new values to the student's record. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `profile.edit.review` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `profileEdit.service.listForReview() + decide()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_profile_edit` |

**Input**

`requestId`: string — From get_student_requests. Omit it and name the student instead.<br>`studentName`: string — Who raised it, e.g. "Rahul". More than one pending match is refused, never guessed.<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`rejectionReason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_cocurricular_request`

Withdraw the caller's own co-curricular request, while the class teacher has not yet decided on it. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `cocurricular.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cocurricular.service.listForStudent() + withdraw()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_cocurricular_request` |

**Input**

`requestId`: string — From list_cocurricular. Omit it when you have only one pending request.<br>`name`: string — The activity, e.g. "football"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_profile_edit_request`

Withdraw the caller's own profile-correction request, while it has not yet been decided. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `profile.edit.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `profileEdit.service.listMine() + withdraw()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_profile_edit_request` |

**Input**

`requestId`: string — From get_my_profile_edit_requests. Omit it when you have only one pending request.<br>`field`: string — The field the correction is to, e.g. "address"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_my_profile_edit_requests`

The caller's own profile-correction requests and what was decided on each. A parent sees their children's. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `profile.edit.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `profileEdit.service.listMine()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_profile_edit_requests` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Students

### `search_students`

The student directory: find students by name, admission number or class, or list the students the caller may see when no search is given. Use this first whenever the user names a student but you do not have their id. Returns each match with class, roll number, student id and enrolment id. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.search_students` |

**Input**

`query`: string — Name, admission number or class, e.g. "Rahul", "OAK-12", "Class 6 A". Omit to list everyone in scope.<br>`sectionId`: string — Restrict to one section<br>`limit`: integer — Default 20

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_student`

One student's record: name, admission number, class, roll number and enrolment status. Identify the student by id, admission number or name. Reading this is recorded as a personal-data access. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.getById() + listEnrollments()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_student` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_student_overview`

Several facets of one student in one call. Choose only what the question needs with `include`: profile (class, roll number, class teacher's name), personal (date of birth, gender, address), guardians (names, relation, contact numbers), attendance (this month), performance (published results), assignments (submission status), medical (only returned if the caller may read medical records). Defaults to profile, attendance and performance. For a single fact prefer the narrower tool. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.getOverview() — narrowed to the requested sections` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_student_overview` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`include`: array — Any of: profile, personal, guardians, attendance, performance, assignments, medical. Default: profile, attendance, performance

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_guardians`

The guardians linked to a student — name, relation and whether they are the primary contact. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.listGuardians()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_guardians` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `add_guardian`

Link an existing parent profile to a student as their father, mother or guardian. Once linked, that parent can see the child's attendance, marks and fees, so this always needs confirmation. The guardian's profile id comes from list_users.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `students.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.addGuardian()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.add_guardian` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`guardianProfileId`: string **(required)** — The parent's profile id, e.g. from list_users<br>`relation`: string **(required)** — one of: FATHER, MOTHER, GUARDIAN<br>`isPrimary`: boolean — Whether this is the primary contact<br>`pickupAuthorized`: boolean — Whether they may collect the child; defaults to yes

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_enrollments`

Enrolment rows — student, class, roll number and enrolment status — optionally narrowed to one class, one student, or one academic year. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.listEnrollments()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_enrollments` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string<br>`studentId`: string<br>`academicYearId`: string<br>`status`: string — one of: ACTIVE, TRANSFERRED, WITHDRAWN, GRADUATED<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_student`

Create a new student record. Requires an admission number and first name. This creates ERP data and needs confirmation before it happens. It does NOT enrol the student in a class — use enroll_student afterwards.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `students.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `student.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_student` |

**Input**

`admissionNo`: string **(required)** — Unique within the school<br>`firstName`: string **(required)**<br>`lastName`: string<br>`dob`: string — YYYY-MM-DD<br>`gender`: string<br>`address`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `enroll_student`

Enrol an existing student into a section for an academic year, optionally with a roll number. Changes ERP data; needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `enrollments.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.enroll()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.enroll_student` |

**Input**

`studentId`: string **(required)** — The student to enrol<br>`sectionId`: string **(required)** — The class section<br>`academicYearId`: string **(required)**<br>`rollNo`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_student`

Correct a student's personal details. Only first name, last name, date of birth, gender and address may be changed here — admission number, class, roll number and enrolment status are the school's own record and are refused. Changes ERP data; needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `students.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.update() — behind an MCP field allow-list` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_student` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`fields`: object **(required)** — The values to change. Only firstName, lastName, dob, gender and address are accepted.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_enrollment_status`

Change an enrolment's status to ACTIVE, TRANSFERRED, WITHDRAWN or GRADUATED. This is the school's formal record of whether a student is on roll. Changes ERP data; needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `enrollments.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.updateEnrollmentStatus()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_enrollment_status` |

**Input**

`enrollmentId`: string **(required)** — From search_students or list_enrollments<br>`status`: string **(required)** — one of: ACTIVE, TRANSFERRED, WITHDRAWN, GRADUATED

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `archive_student`

Deactivate a student record and withdraw their active enrolments. This is a soft delete — the record is retained and can be reviewed afterwards. It does NOT erase personal data; use anonymise_student for that. Always needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `students.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.softDelete()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.archive_student` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `anonymise_student`

IRREVERSIBLE. Permanently erase a student's personal data (name, date of birth, gender, address, photo) while keeping the anonymous academic record. Use only for a data-erasure request. Cannot be undone. Always needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | CRITICAL |
| **Confirmation** | REQUIRED |
| **Permission** | `students.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `student.service.anonymiseStudent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.anonymise_student` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`reason`: string **(required)** — Why erasure was requested — recorded in the audit trail

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Tickets

### `list_tickets`

Support tickets — the caller's own, or the ones routed to them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `tickets.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ticket.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_tickets` |

**Input**

`status`: string — one of: NEW, OPEN, WAITING, RESOLVED, CLOSED<br>`limit`: integer<br>`from`: string — Only tickets raised on this date or later<br>`to`: string — Only tickets raised on this date or earlier

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_ticket`

One support ticket with its full reply thread. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `tickets.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ticket.service.getById()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_ticket` |

**Input**

`ticketId`: string **(required)**

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_ticket`

Raise a support ticket with a subject, routed to the admin office, warden, librarian or — for a question about a child — the class teacher. A ticket carries only a subject; add the details with reply_to_ticket. Low impact and reversible, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `tickets.create` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ticket.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_ticket` |

**Input**

`subject`: string **(required)**<br>`routedToRoleKey`: string — one of: ADMIN, WARDEN, LIBRARIAN, CLASS_TEACHER<br>`studentId`: string — Required when routing to the class teacher<br>`priority`: string — Default NORMAL

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `reply_to_ticket`

Post a reply on a support ticket. The other party sees it, so it needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `tickets.respond` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `ticket.service.list() + reply()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.reply_to_ticket` |

**Input**

`ticketId`: string — From list_tickets<br>`subject`: string — The ticket as a person names it, e.g. "ID card". An ambiguous subject is refused, never guessed.<br>`body`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_ticket`

Change a ticket's status, priority or assignee. Only those three fields can be changed here. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `tickets.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `ticket.service.list() + update() — behind an MCP field allow-list` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_ticket` |

**Input**

`ticketId`: string — From list_tickets<br>`subject`: string — The ticket as a person names it, e.g. "ID card". An ambiguous subject is refused, never guessed.<br>`status`: string — one of: NEW, OPEN, WAITING, RESOLVED, CLOSED<br>`priority`: string<br>`assigneeProfileId`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Timetable

### `get_timetable`

The timetable for a day or the whole week, with the subject and the teacher for each period. Name a class to see that class alone; without one, a teacher sees the periods they teach, a student or parent their own section, and a school-wide reader the school. Accepts a weekday name, today/tomorrow/yesterday, or "week" for the weekly timetable. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `timetable.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `timetable.service.getTimetable()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_timetable` |

**Input**

`day`: string — Weekday name, today/tomorrow/yesterday, or "week" for the whole week<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section, when the id is already known

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `upsert_timetable_slot`

Create or replace one timetable period for a section — its day, period number, times and subject offering. Changes what a whole class sees as its schedule, so it needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `timetable.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `timetable.service.upsertSlot()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.upsert_timetable_slot` |

**Input**

`sectionId`: string **(required)**<br>`dayOfWeek`: integer **(required)** — 1 = Monday … 7 = Sunday<br>`periodNo`: integer **(required)**<br>`startTime`: string **(required)** — HH:MM<br>`endTime`: string **(required)** — HH:MM<br>`subjectOfferingId`: string — Omit for a break

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Transport

### `get_my_bus`

The caller's own (or their child's) bus assignment: route, vehicle, driver and pickup stop. Use for "which bus am I on" and "what is my pickup point". Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.getOwnBus()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_bus` |

**Input**

`studentId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_transport_roster`

Which students travel on which route, optionally for one section. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listTransportRoster()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_transport_roster` |

**Input**

`sectionId`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_transport_routes`

Active bus routes with vehicle, driver, number of stops and number of students enrolled. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listRoutes()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_transport_routes` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_transport_stops`

One route's stops, in the order the bus reaches them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listStops()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_transport_stops` |

**Input**

`routeId`: string **(required)**

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_transport_route`

Create a bus route with its vehicle and driver. Add stops afterwards with create_transport_stop. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.createRoute()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_transport_route` |

**Input**

`name`: string **(required)**<br>`operatorName`: string<br>`vehicleNo`: string<br>`driverName`: string<br>`driverPhone`: string<br>`fareAmountPaise`: integer — What a place on this route costs for the year, in paise, so ₹12,000 is 1200000. Omit for a route that carries no charge.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_transport_route`

Correct a bus route — its vehicle, its driver, whether it is running, or what a place on it costs for the year. Changing the fare does not re-bill anyone: each approved request was invoiced at the fare it was granted at, so this decides what the next approval costs. Use list_transport_routes to find the route id. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `transport.service.updateRoute()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_transport_route` |

**Input**

`routeId`: string — From list_transport_routes<br>`routeName`: string — The route as it is written, e.g. "Route 2". An ambiguous name is refused, never guessed.<br>`name`: string — A NEW name for the route<br>`operatorName`: string<br>`vehicleNo`: string<br>`driverName`: string<br>`driverPhone`: string<br>`status`: string — one of: ACTIVE, INACTIVE, SUSPENDED<br>`fareAmountPaise`: integer — The yearly fare in paise, so ₹12,000 is 1200000. Zero means the route carries no charge.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `create_transport_stop`

Add a stop to a bus route at a position in its order. Two stops cannot share a position on one route. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.createStop()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_transport_stop` |

**Input**

`routeId`: string **(required)**<br>`name`: string **(required)**<br>`sequenceNo`: integer **(required)** — Position along the route, 1 = first<br>`etaMinutesFromStart`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `enroll_in_transport`

Put a student on a bus route and stop for an academic year (the current one if not given). A student has one enrolment per year, so enrolling again moves them. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `transport.service.enrollStudent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.enroll_in_transport` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`routeId`: string **(required)**<br>`stopId`: string **(required)** — A stop on that route, from list_transport_stops<br>`academicYearId`: string<br>`direction`: string — one of: BOTH, PICKUP, DROP — Default BOTH

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_transport_routes`

The bus routes the caller can ask for, with each route's stops and what a place on it costs for the year. Also says whether the caller already has a request or a place. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listRoutesForStudent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_transport_routes` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_transport_route`

Ask for a place on a bus route, from a particular stop. Name the route the way it is written ("Route 2") and, where the route has more than one stop, name the stop too. The stop must be one on that route. The request goes to the school office and changes nothing until it is approved — the fare is only charged once a place is granted, so it runs without confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listRoutesForStudent() + requestRoute()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_transport_route` |

**Input**

`routeId`: string — From get_transport_routes<br>`routeName`: string — The route as it is written, e.g. "Route 2"<br>`stopId`: string — A stop on that route<br>`stopName`: string — The stop as it is written<br>`direction`: string — one of: BOTH, PICKUP, DROP — Both ways by default

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_transport_requests`

The caller's own transport requests and what was decided on each. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listMyTransportRequests()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_transport_requests` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_transport_requests`

Transport requests waiting for a decision, with who asked, which route and stop, and the fare. Defaults to the pending ones. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listTransportRequestsForReview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_transport_requests` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED, CANCELLED, ALL<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `decide_transport_request`

Approve or reject a request for a place on a bus route. Approving puts the student on the route and, when the route carries a fare, raises an invoice for it against their fees. Use get_transport_requests to find the request id. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `transport.service.listTransportRequestsForReview() + decideTransportRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.decide_transport_request` |

**Input**

`requestId`: string — From get_transport_requests. Omit it and name the student instead.<br>`studentName`: string — Who raised it, e.g. "Rahul". More than one pending match is refused, never guessed.<br>`status`: string **(required)** — one of: APPROVED, REJECTED<br>`note`: string — Shown to the student with the decision

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_transport_request`

Withdraw the caller's own request for a place on a bus route, while the school office has not yet decided on it. A request already granted or refused cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listMyTransportRequests() + cancelTransportRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_transport_request` |

**Input**

`requestId`: string — From get_my_transport_requests. Omit it when you have only one pending request.<br>`routeName`: string — The route the request is for, e.g. "Route 2"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Users

### `list_users`

Staff and user accounts, searchable by name, phone or email and filterable by role. Returns each person's profile id, which the notification tool needs. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `users.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `user.service.listUsers()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_users` |

**Input**

`search`: string<br>`roleKey`: string — e.g. TEACHER, FINANCE<br>`status`: string<br>`sectionId`: string<br>`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Permission coverage

65 of the 81 permissions in the catalog are reachable through MCP.

Permissions **not** reachable through any tool:

- `users.manage` — Create, update, deactivate users
- `roles.manage` — Create roles and assign permissions to them
- `permissions.manage` — Create or modify permission keys
- `schools.read` — View the schools on the platform and their School Admins
- `schools.manage` — Create schools and manage their School Admin accounts
- `seats.manage` — Sell a school seats and correct its seat balance
- `seats.approve` — Approve or reject a paid extra-seat request
- `seats.pricing.manage` — Set a school's per-seat price and manage its pricing history
- `customization.manage` — Configure a school's theme, branding and dropdown values
- `domains.manage` — Configure, verify and activate a school's subdomain or custom domain
- `attendance.regularize` — Correct/regularize past attendance
- `reportcards.read` — View report cards
- `fees.plan.review` — Review a submitted installment plan and send it for admin approval
- `analytics.school.read` — View school-wide analytics
- `analytics.class.read` — View class-level analytics
- `analytics.child.read` — View a child's analytics

