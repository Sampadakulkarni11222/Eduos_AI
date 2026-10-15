# EduOS MCP Tool Catalog

> **Generated file — do not edit by hand.**
> Regenerate with `node backend/scripts/mcp-catalog.js --write`.
> The source of truth is `backend/src/modules/ai/mcp/registry.js`.

**318 tools** — 165 GET, 65 CREATE, 29 UPDATE, 14 DELETE, 45 ACTION.

Risk mix: 197 LOW, 32 HIGH, 88 MEDIUM, 1 CRITICAL.

Status: 316 AVAILABLE, 2 PARTIAL (see below). 1 compatibility aliases, 1 deprecated implementation entry, 13 capabilities deliberately blocked.

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
| `ADMIN` | 309 | 161 | 63 | 29 | 43 | 13 | 33 | 148 |
| `PRINCIPAL` | 183 | 121 | 27 | 14 | 19 | 2 | 11 | 62 |
| `TEACHER` | 127 | 83 | 17 | 8 | 16 | 3 | 6 | 44 |
| `PARENT` | 87 | 68 | 8 | 4 | 4 | 3 | 3 | 19 |
| `STUDENT` | 90 | 70 | 10 | 1 | 3 | 6 | 1 | 20 |
| `FINANCE` | 84 | 54 | 15 | 7 | 7 | 1 | 10 | 30 |
| `LIBRARIAN` | 61 | 41 | 7 | 4 | 7 | 2 | 1 | 20 |
| `WARDEN` | 64 | 42 | 8 | 6 | 7 | 1 | 1 | 22 |
| `HR` | 50 | 33 | 8 | 3 | 5 | 1 | 2 | 17 |
| `MARKETING` | 51 | 34 | 9 | 3 | 4 | 1 | 2 | 17 |
| `COMPLIANCE` | 62 | 42 | 10 | 5 | 4 | 1 | 1 | 20 |
| `TRUSTEE` | 22 | 20 | 0 | 1 | 1 | 0 | 1 | 2 |
| `ALUMNUS` | 14 | 12 | 0 | 1 | 1 | 0 | 0 | 2 |
| `COUNSELLOR (custom, example)` | 19 | 19 | 0 | 0 | 0 | 0 | 0 | 0 |

Custom roles are database rows, created per school, so none can be listed here in advance. The COUNSELLOR row is the custom role the test suites create; any custom role is computed exactly this way from its own grants.

<details><summary>High-risk actions visible to each role</summary>

- **SUPER_ADMIN** (0): _none_
- **ADMIN** (33): `add_guardian`, `update_enrollment_status`, `archive_student`, `anonymise_student`, `mark_attendance`, `bulk_mark_attendance`, `create_invoice`, `generate_invoices`, `create_fee_plan`, `update_fee_plan`, `update_payment`, `transition_fee_plan`, `create_fee_structure`, `enter_marks`, `update_admission_lead`, `create_announcement`, `update_announcement`, `notify_users`, `send_whatsapp_message`, `delete_book`, `upsert_medical_record`, `remove_medical_record`, `delete_document`, `request_extra_seats`, `send_social_post`, `verify_eco_activity`, `record_bill_payment`, `verify_bill_payment`, `request_fee_adjustment`, `record_concession_decision`, `record_outpass_consent`, `record_outpass_decision`, `record_staff_leave_decision`
- **PRINCIPAL** (11): `transition_fee_plan`, `create_announcement`, `update_announcement`, `notify_users`, `send_whatsapp_message`, `delete_document`, `send_social_post`, `verify_eco_activity`, `record_concession_decision`, `record_outpass_decision`, `record_staff_leave_decision`
- **TEACHER** (6): `mark_attendance`, `bulk_mark_attendance`, `enter_marks`, `create_announcement`, `delete_document`, `verify_eco_activity`
- **PARENT** (3): `upsert_medical_record`, `remove_medical_record`, `record_outpass_consent`
- **STUDENT** (1): `record_outpass_consent`
- **FINANCE** (10): `create_invoice`, `generate_invoices`, `create_fee_plan`, `update_fee_plan`, `transition_fee_plan`, `create_fee_structure`, `record_bill_payment`, `verify_bill_payment`, `request_fee_adjustment`, `record_concession_decision`
- **LIBRARIAN** (1): `delete_book`
- **WARDEN** (1): `record_outpass_decision`
- **HR** (2): `record_concession_decision`, `record_staff_leave_decision`
- **MARKETING** (2): `update_admission_lead`, `send_social_post`
- **COMPLIANCE** (1): `verify_eco_activity`
- **TRUSTEE** (1): `record_concession_decision`
- **ALUMNUS** (0): _none_
- **COUNSELLOR (custom, example)** (0): _none_

</details>

## Catalog summary

| Tool | Module | Operation | Permission | Scope | Risk | Confirm | Status |
|---|---|---|---|---|---|---|---|
| `add_guardian` | Students | CREATE | `students.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `add_ptm_availability` | PTM | CREATE | `ptm.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `add_review_call_note` | Review calls | ACTION | `reviewcalls.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `add_visitor` | Safety | CREATE | `visitors.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `allocate_hostel_bed` | Hostel | ACTION | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `anonymise_student` | Students | DELETE | `students.manage` | ALL | CRITICAL | REQUIRED | AVAILABLE |
| `apply_for_leave` | Leave | CREATE | `leave.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `apply_staff_leave` | Staff leave | CREATE | `staffleave.apply` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `archive_student` | Students | DELETE | `students.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `assign_cover` | Cover | CREATE | `cover.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `assign_teacher_to_subject` | Academics | ACTION | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `block_id_card` | Safety | ACTION | `checkpoints.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `bulk_mark_attendance` | Attendance | ACTION | `attendance.mark` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `cancel_book_request` | Library | DELETE | `library.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_certificate_request` | Certificates | DELETE | `students.read` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_cocurricular_request` | Student requests | DELETE | `cocurricular.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_cover` | Cover | ACTION | `cover.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `cancel_due_item` | Tasks | ACTION | `tasks.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_online_class` | Lectures | DELETE | `lectures.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `cancel_outpass` | Hostel | ACTION | `hostel.outpass.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_profile_edit_request` | Student requests | DELETE | `profile.edit.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_ptm_booking` | PTM | DELETE | `ptm.book` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `cancel_staff_leave` | Staff leave | ACTION | `staffleave.apply` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `cancel_transport_request` | Transport | DELETE | `transport.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `change_bill_status` | Bills | UPDATE | `bills.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `checkin_copy_by_accession` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `complete_due_item` | Tasks | UPDATE | `tasks.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `complete_service_visit` | Bills | UPDATE | `bills.manage` | ALL | LOW | REQUIRED | AVAILABLE |
| `confirm_pickup_delegation` | Safety | UPDATE | `transport.tracking.read` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `consent_to_club_join` | Clubs | ACTION | `clubs.join` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_academic_year` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_admission_lead` | Admissions | CREATE | `admissions.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_announcement` | Communication | CREATE | `announcements.publish` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `create_assignment` | Assignments | CREATE | `assignments.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_book` | Library | CREATE | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_calendar_event` | Communication | CREATE | `calendar.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_course_material` | Documents | CREATE | `materials.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_due_item` | Tasks | CREATE | `tasks.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `create_exam` | Exams | CREATE | `exams.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_exam_subject` | Exams | CREATE | `exams.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_fee_head` | Fees | CREATE | `fees.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_fee_plan` | Fees | CREATE | `fees.plan.request` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `create_fee_structure` | Fees | CREATE | `fees.structure.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `create_grade` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_hostel_inquiry` | Hostel | CREATE | `hostel.read` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_hostel_room` | Hostel | CREATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_invoice` | Fees | CREATE | `fees.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `create_purchase_request` | Procurement | CREATE | `procurement.request` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_section` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_student` | Students | CREATE | `students.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_subject` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_term` | Academics | CREATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_ticket` | Tickets | CREATE | `tickets.create` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_transport_route` | Transport | CREATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `create_transport_stop` | Transport | CREATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `delete_assignment` | Assignments | DELETE | `assignments.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `delete_book` | Library | DELETE | `library.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `delete_document` | Documents | DELETE | `materials.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `draft_lab_reorder` | Labs | CREATE | `labs.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `draft_showcase_entry` | Showcase | CREATE | `showcase.publish` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `draft_social_post` | Social | CREATE | `social.publish` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `enroll_in_transport` | Transport | ACTION | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `enroll_student` | Students | CREATE | `enrollments.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `enter_marks` | Exams | ACTION | `marks.enter` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `find_library_copy` | Library | GET | `library.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `generate_homework` | Assignments | ACTION | `assignments.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `generate_invoices` | Fees | ACTION | `fees.manage` | ALL | HIGH | CONDITIONAL | AVAILABLE |
| `get_absent_students` | Attendance | GET | `attendance.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_admission_lead` | Admissions | GET | `admissions.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_admissions` | Admissions | GET | `admissions.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_ai_draft` | AI drafts | GET | `ai.drafts.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_analytics_overview` | Analytics | GET | `analytics.workspace.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_announcements` | Communication | GET | `announcements.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_assignments` | Assignments | GET | `assignments.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_at_risk_students` | Analytics | GET | `ai.insights.read` | ALL | LOW | NOT_REQUIRED | PARTIAL |
| `get_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_calendar` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_roster` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_statistics` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_attendance_trend` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_bill_costs` | Bills | GET | `bills.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_bill_review_queue` | Bills | GET | `bills.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_book` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_book_requests` | Library | GET | `library.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_budget_position` | Budgets | GET | `budget.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_calendar_events` | Communication | GET | `calendar.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_camera_review_count` | Safety | GET | `camera.events.review` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_campus_status` | Campus | GET | `campus.map.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_class_attendance_summary` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_class_marks` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_cover_arrangements` | Cover | GET | `staffleave.apply` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_cover_needs` | Cover | GET | `cover.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_dashboard` | Analytics | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_due_items_summary` | Tasks | GET | `tasks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_eco_points` | Sustainability | GET | `sustainability.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_editable_fields` | Student requests | GET | `profile.edit.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_emergency_roster` | Safety | GET | `visitors.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_plans` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_statistics` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fee_structures` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_fees` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_growth_score` | Analytics | GET | `ai.insights.read` | ALL | LOW | NOT_REQUIRED | PARTIAL |
| `get_gst_summary` | Fees | GET | `accounts.export` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_hostel_residents` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_hostel_summary` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_invoice` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_labs_overview` | Labs | GET | `labs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_leave_requests` | Leave | GET | `leave.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_lecture_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_library_summary` | Library | GET | `library.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_live_bus_status` | Transport | GET | `transport.tracking.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_marketing_funnel` | Marketing | GET | `marketing.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_marks_grid` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_medical_record` | Medical | GET | `medical.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_book_requests` | Library | GET | `library.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_bus` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_certificate_requests` | Certificates | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_child_bus` | Transport | GET | `transport.tracking.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_child_checkpoints` | Safety | GET | `checkpoints.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_classes` | Academics | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_club_memberships` | Clubs | GET | `clubs.join` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_day` | Operations | GET | `institution.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_digest` | Digest | GET | `digest.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_electives` | Registrations | GET | `registrations.apply` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_profile` | Profile | GET | `ai.copilot.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_profile_edit_requests` | Student requests | GET | `profile.edit.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_quiz_results` | Quizzes | GET | `submissions.submit` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_term_report_cards` | Report cards | GET | `reportcards.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_my_transport_requests` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_organisation_structure` | Organisation | GET | `org.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_overdue_books` | Library | GET | `library.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_change_requests` | Fees | GET | `fees.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_history` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_payment_link` | Fees | GET | `fees.pay` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_pending_fees` | Fees | GET | `fees.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_pending_items_for_me` | Approvals | GET | `approvals.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_performance` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_performance_history` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_ptm_slots` | PTM | GET | `ptm.book` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_quarterly_report` | Analytics | GET | `reports.quarterly.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_registration_reviews` | Registrations | GET | `registrations.review` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_report_card` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_results` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_school_customization` | Customization | GET | `settings.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_school_domain` | Domains | GET | `domains.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_seat_requests` | Seats | GET | `seats.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_seat_summary` | Seats | GET | `seats.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_showcase` | Showcase | GET | `institution.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_staff_leave_balance` | Staff leave | GET | `staffleave.apply` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_overview` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_student_requests` | Student requests | GET | `cocurricular.review` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_subject_attendance` | Attendance | GET | `attendance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_subjects` | Academics | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_submissions` | Assignments | GET | `submissions.grade` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_syllabus_progress` | Syllabus | GET | `syllabus.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_term_report_remark_draft` | Report cards | GET | `reportcards.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_ticket` | Tickets | GET | `tickets.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_timetable` | Timetable | GET | `timetable.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_requests` | Transport | GET | `transport.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_roster` | Transport | GET | `transport.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_transport_routes` | Transport | GET | `transport.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_verification_counts` | Verification | GET | `verification.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `get_visitors_on_site` | Safety | GET | `visitors.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `grade_submission` | Assignments | ACTION | `submissions.grade` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `issue_book` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `issue_lab_stock` | Labs | ACTION | `labs.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `join_club` | Clubs | CREATE | `clubs.join` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `lend_copy_by_accession` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `list_academic_years` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_alumni_events` | Alumni | GET | `alumni.directory.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_audit_logs` | Audit | GET | `audit.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_bills` | Bills | GET | `bills.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_board_meetings` | Governance | GET | `governance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_book_issues` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_books` | Library | GET | `library.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_certificate_types` | Certificates | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_classes` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_club_sessions` | Clubs | GET | `clubs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_clubs` | Clubs | GET | `clubs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_cocurricular` | Student requests | GET | `cocurricular.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_compliance_deadlines` | Compliance | GET | `compliance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_concession_schemes` | Fees | GET | `fees.concessions.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_conversations` | Conversations | GET | `conversations.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_digital_lectures` | Lectures | GET | `lectures.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_documents` | Documents | GET | `materials.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_due_items` | Tasks | GET | `tasks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_eco_activities` | Sustainability | GET | `sustainability.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_enrollments` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_exams` | Exams | GET | `marks.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_fee_adjustments` | Fees | GET | `fees.concessions.manage` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_fest_plans` | Events | GET | `events.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_guardians` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_allocations` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_inquiries` | Hostel | GET | `hostel.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_hostel_rooms` | Hostel | GET | `hostel.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_lab_equipment` | Labs | GET | `labs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_lab_incidents` | Labs | GET | `labs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_lab_stock` | Labs | GET | `labs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_licences` | Compliance | GET | `compliance.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_maintenance_work` | Facilities | GET | `facilities.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_my_child_delegates` | Safety | GET | `transport.tracking.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_my_maintenance_reports` | Facilities | GET | `facilities.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_my_outpasses` | Hostel | GET | `hostel.outpass.request` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_my_ptm_bookings` | PTM | GET | `ptm.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_newsroom_posts` | Newsroom | GET | `community.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_notifications` | Notifications | GET | `ai.copilot.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_online_applications` | Admissions | GET | `admissions.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_open_correspondence` | Correspondence | GET | `correspondence.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_outpasses` | Hostel | GET | `hostel.outpass.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_payroll_runs` | Payroll | GET | `payroll.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_pending_approvals` | Approvals | GET | `approvals.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_practical_sessions` | Labs | GET | `labs.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_ptm_rounds` | PTM | GET | `ptm.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_purchase_requests` | Procurement | GET | `procurement.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_quarterly_reports` | Analytics | GET | `reports.quarterly.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_quizzes` | Quizzes | GET | `assignments.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_renewals` | Bills | GET | `bills.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_review_calls` | Review calls | GET | `reviewcalls.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_service_visits` | Bills | GET | `bills.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_social_posts` | Social | GET | `social.publish` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_staff_leave` | Staff leave | GET | `staffleave.apply` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_subjects` | Academics | GET | `academics.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_term_report_cards` | Report cards | GET | `reportcards.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_tickets` | Tickets | GET | `tickets.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_transport_routes` | Transport | GET | `transport.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_transport_stops` | Transport | GET | `transport.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_trips` | Transport | GET | `transport.trips.operate` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_users` | Users | GET | `users.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `list_vehicles` | Transport | GET | `transport.fleet.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `log_eco_activity` | Sustainability | CREATE | `sustainability.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `log_meter_reading` | Sustainability | CREATE | `sustainability.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `log_plant_check` | Sustainability | ACTION | `sustainability.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `log_review_call_attempt` | Review calls | ACTION | `reviewcalls.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `log_syllabus_progress` | Syllabus | ACTION | `syllabus.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `log_vehicle_event` | Transport | CREATE | `transport.fleet.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `log_waste` | Sustainability | CREATE | `sustainability.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `mark_attendance` | Attendance | ACTION | `attendance.mark` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `mark_club_attendance` | Clubs | ACTION | `clubs.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `mark_staff_absent` | Cover | CREATE | `cover.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `note_bill_flag` | Bills | UPDATE | `bills.manage` | ALL | LOW | REQUIRED | AVAILABLE |
| `notify_users` | Communication | ACTION | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `open_review_call` | Review calls | CREATE | `reviewcalls.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `plan_practical_session` | Labs | CREATE | `labs.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `read_conversation` | Conversations | GET | `conversations.use` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `reassign_due_item` | Tasks | UPDATE | `tasks.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `receive_lab_stock` | Labs | CREATE | `labs.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `record_bill` | Bills | CREATE | `bills.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `record_bill_payment` | Bills | CREATE | `bills.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `record_concession_decision` | Fees | ACTION | `approvals.decide` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `record_lab_calibration` | Labs | UPDATE | `labs.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `record_lab_stock_use` | Labs | ACTION | `labs.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `record_outpass_consent` | Hostel | ACTION | `hostel.outpass.request` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `record_outpass_decision` | Hostel | ACTION | `hostel.outpass.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `record_outpass_gate` | Hostel | ACTION | `hostel.outpass.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `record_staff_leave_decision` | Staff leave | ACTION | `staffleave.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `record_trip_boarding` | Transport | ACTION | `transport.trips.operate` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `regenerate_quarterly_report` | Analytics | CREATE | `reports.quarterly.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `register_for_elective` | Registrations | CREATE | `registrations.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `remove_medical_record` | Medical | DELETE | `medical.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `reply_to_ticket` | Tickets | ACTION | `tickets.respond` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `report_lab_incident` | Labs | CREATE | `labs.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `report_repair` | Facilities | CREATE | `facilities.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `request_book` | Library | CREATE | `library.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `request_certificate` | Certificates | CREATE | `students.read` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `request_cocurricular` | Student requests | CREATE | `cocurricular.request` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_extra_seats` | Seats | CREATE | `seats.request` | ALL | HIGH | REQUIRED | AVAILABLE |
| `request_facility_reservation` | Facilities | CREATE | `facilities.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `request_fee_adjustment` | Fees | CREATE | `fees.concessions.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `request_outpass` | Hostel | CREATE | `hostel.outpass.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `request_payment_change` | Fees | CREATE | `fees.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_pickup_delegation` | Safety | CREATE | `transport.tracking.read` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_profile_edit` | Student requests | CREATE | `profile.edit.request` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `request_transport_route` | Transport | CREATE | `transport.request` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `reschedule_ptm_booking` | PTM | UPDATE | `ptm.book` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `reserve_ptm_slot` | PTM | CREATE | `ptm.book` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `return_book` | Library | ACTION | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `revoke_pickup_delegation` | Safety | ACTION | `transport.tracking.read` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `rsvp_alumni_event` | Alumni | ACTION | `alumni.directory.read` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `save_term_report_remarks` | Report cards | UPDATE | `reportcards.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `schedule_online_class` | Lectures | CREATE | `lectures.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `schedule_service_visit` | Bills | CREATE | `bills.manage` | ALL | LOW | REQUIRED | AVAILABLE |
| `search_alumni` | Alumni | GET | `alumni.directory.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `search_students` | Students | GET | `students.read` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `send_conversation_message` | Conversations | CREATE | `conversations.use` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `send_social_post` | Social | ACTION | `social.publish` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `send_whatsapp_message` | Communication | ACTION | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `snooze_due_item` | Tasks | UPDATE | `tasks.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `submit_assignment` | Assignments | ACTION | `submissions.submit` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `suggest_cover_teachers` | Cover | GET | `cover.manage` | OWN or ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `transition_fee_plan` | Fees | ACTION | `fees.read` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_admission_lead` | Admissions | ACTION | `admissions.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_announcement` | Communication | UPDATE | `announcements.publish` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_assignment` | Assignments | UPDATE | `assignments.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_book` | Library | UPDATE | `library.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_course_material` | Documents | UPDATE | `materials.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_enrollment_status` | Students | UPDATE | `enrollments.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_fee_plan` | Fees | UPDATE | `fees.plan.request` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `update_hostel_inquiry` | Hostel | UPDATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_hostel_room` | Hostel | UPDATE | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_my_digest_interests` | Digest | UPDATE | `digest.read` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `update_payment` | Fees | UPDATE | `fees.payments.approve` | ALL | HIGH | REQUIRED | AVAILABLE |
| `update_review_call_schedule` | Review calls | UPDATE | `reviewcalls.manage` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_section` | Academics | UPDATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_student` | Students | UPDATE | `students.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_subject_offering` | Academics | UPDATE | `academics.structure.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_ticket` | Tickets | UPDATE | `tickets.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_transport_route` | Transport | UPDATE | `transport.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `update_visitor` | Safety | UPDATE | `visitors.manage` | OWN or ALL | LOW | REQUIRED | AVAILABLE |
| `upsert_medical_record` | Medical | UPDATE | `medical.manage` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `upsert_timetable_slot` | Timetable | UPDATE | `timetable.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `vacate_hostel_bed` | Hostel | ACTION | `hostel.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |
| `verify_bill_payment` | Bills | ACTION | `bills.manage` | ALL | HIGH | REQUIRED | AVAILABLE |
| `verify_eco_activity` | Sustainability | ACTION | `sustainability.verify` | OWN or ALL | HIGH | REQUIRED | AVAILABLE |
| `who_is_absent_today` | Attendance | GET | `attendance.read` | ALL | LOW | NOT_REQUIRED | AVAILABLE |
| `withdraw_elective_registration` | Registrations | DELETE | `registrations.apply` | OWN or ALL | MEDIUM | REQUIRED | AVAILABLE |
| `withdraw_fee_adjustment` | Fees | ACTION | `fees.concessions.manage` | ALL | MEDIUM | REQUIRED | AVAILABLE |

## Partially implemented

- `get_growth_score` — growth.service.getScore() is a documented stand-in heuristic (60% published marks + 40% attendance for the month), not the ML model its name suggests. It also upserts the computed score as a cache row, as its REST route does.
- `get_at_risk_students` — risk.service.scan() upserts its computed risk rows as a cache, as its REST route does — a read with a side effect on derived data, not on anything a person entered.

## Compatibility aliases

| Legacy name | Redeemed by | Removable when |
|---|---|---|
| `apply_leave` | `apply_for_leave` | No AgentAction row with tool "apply_leave" is PENDING or EXECUTING, and at least 10 minutes have passed since the first MCP deployment. |

## Deprecated

- `record_fee_payment` (`backend/src/modules/ai/agent/tools.js`) — Not in the MCP catalog and not reachable from either channel. Recording a payment is a decision made on the Payments screen; the assistant has no tool for it. Kept only because agent.bulkAuthorization.test.js exercises its permission metadata; safe to delete together with those assertions.

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

## AI drafts

### `get_ai_draft`

Draft a letter, a circular, meeting minutes from notes, a lesson-plan outline or a report-card remark, for the caller to read and edit. Contact numbers and any health or safeguarding detail are removed before drafting. Nothing is sent, published or saved.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ai.drafts.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `drafts.service.draft()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_ai_draft` |

**Input**

`kind`: string **(required)** — one of: LETTER, CIRCULAR, MINUTES, LESSON_PLAN, REPORT_REMARK<br>`recipient`: string<br>`subject`: string<br>`purpose`: string<br>`points`: array<br>`tone`: string — one of: FORMAL, WARM<br>`signOff`: string<br>`title`: string<br>`audience`: string<br>`date`: string<br>`details`: string<br>`actionRequired`: string<br>`meetingTitle`: string<br>`attendees`: string<br>`notes`: string<br>`grade`: string<br>`topic`: string<br>`durationMinutes`: integer<br>`objectives`: array

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

`gradeId`: string<br>`grade`: string — The grade as a person names it, e.g. "Class 7". Alternative to gradeId.<br>`name`: string **(required)** — e.g. "A"<br>`classTeacherId`: string — Teacher profile id<br>`classTeacher`: string — The class teacher as a person names them. Alternative to classTeacherId.

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

Create a term inside an academic year, e.g. "Term 1", with its start and end dates. Name the year ("2026-27"), or leave it out for the current one. Needs confirmation.

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

`academicYearId`: string<br>`academicYear`: string — The year as a person names it, e.g. "2026-27". Omit for the current year.<br>`name`: string **(required)** — e.g. "Term 1"<br>`startsOn`: string **(required)**<br>`endsOn`: string **(required)**

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

`sectionId`: string<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`name`: string — A NEW name for the section<br>`classTeacherId`: string<br>`classTeacher`: string — The new class teacher as a person names them. Alternative to classTeacherId.

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

`subjectId`: string<br>`subject`: string — The subject as a person names it, e.g. "Science". Alternative to subjectId.<br>`sectionId`: string<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`termId`: string<br>`term`: string — The term as a person names it, e.g. "Term 1". Omit for the running term.<br>`teacherId`: string — Teacher profile id<br>`teacherName`: string — The teacher as a person names them. Alternative to teacherId.

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

`offeringId`: string<br>`subject`: string — The subject of the offering as a person names it, e.g. "Art". Identifies the offering with className.<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`termId`: string<br>`term`: string — The term, when the class teaches the subject in more than one<br>`teacherId`: string<br>`teacherName`: string — The new teacher as a person names them. Alternative to teacherId.<br>`isElective`: boolean<br>`capacity`: integer

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

`stage`: string — one of: NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION, ENROLLED, LOST<br>`limit`: integer — Leads per stage, only when the user asks for a number

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

Move an admission enquiry along the pipeline (NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION), or change its notes, assignee or next action date. Admitting (ENROLLED) or turning down (LOST) an applicant is a decision made on the admissions screen, never through the assistant. Each stage change is written to the interaction history. Needs confirmation.

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

`leadId`: string<br>`childName`: string — The applicant child as a person names them, e.g. "Kabir Kapoor". Alternative to leadId.<br>`stage`: string — one of: NEW, CONTACTED, TOUR_SCHEDULED, APPLICATION<br>`notes`: string<br>`assigneeProfileId`: string<br>`nextActionAt`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_online_applications`

Applications received through the online admission form, newest first: the reference, child, class applied for, guardian, the documents attached (names only) and the stage of the enquiry. Move an enquiry along with update_admission_lead. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `admissions.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `admissions/online.service.listApplications()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_online_applications` |

**Input**

`limit`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Alumni

### `search_alumni`

Search the alumni directory by name, batch year or kind (former students or staff). Only people who chose to be listed appear; profession, city and links only where each person agreed to share them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `alumni.directory.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `alumni.service.directory()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.search_alumni` |

**Input**

`search`: string<br>`batchYear`: integer<br>`kind`: string — one of: FORMER_STUDENT, FORMER_STAFF

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_alumni_events`

Alumni reunions and events the caller is invited to (all of them for alumni managers): date, venue, status and the caller's own reply. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `alumni.directory.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `alumni.service.listEvents()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_alumni_events` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `rsvp_alumni_event`

For an alumnus: reply yes, no or maybe to an alumni event they are invited to. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `alumni.directory.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `alumni.service.listEvents() + rsvp()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.rsvp_alumni_event` |

**Input**

`event`: string<br>`response`: string **(required)** — one of: YES, NO, MAYBE

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

`attendanceBelowPct`: integer — Only students whose 30-day attendance is below this percentage, e.g. 75<br>`level`: string — one of: LOW, MEDIUM, HIGH — Risk level<br>`type`: string — one of: ATTENDANCE, ACADEMIC_DECLINE, FEE_DEFAULT — Risk type<br>`sectionId`: string<br>`gradeName`: string<br>`search`: string<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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
| **Scope** | ALL |
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

### `get_analytics_overview`

The analytics workspace in words: the headline figures (or one department's) for a period — this month, quarter, year, academic or financial year — with the change against the previous period or last year, and how complete each figure is. Within the caller's own departments or classes. The CSV is downloaded on the Analytics screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `analytics.workspace.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `analytics.service.overview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_analytics_overview` |

**Input**

`preset`: string — one of: today, week, month, quarter, year, academicYear, financialYear<br>`department`: string — e.g. finance, academics, admissions, people, facilities, procurement; default all (headlines)<br>`compare`: string — one of: previous, lastYear, none

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_quarterly_reports`

The quarterly decision reports addressed to the caller: each quarter and version, its status and when it was generated. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reports.quarterly.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `quarterly.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_quarterly_reports` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_quarterly_report`

One quarterly report (the latest by default, or e.g. "FY2026-27-Q2"): the summary figures with their change on the prior quarter and last year, limited to the sections the caller receives. The PDF is downloaded on the Reports screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reports.quarterly.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `quarterly.service.get()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_quarterly_report` |

**Input**

`quarter`: string — e.g. FY2026-27-Q2

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `regenerate_quarterly_report`

Generate a new version of a quarterly report (the previous quarter by default) from the live records, with the reason. Earlier versions stay as they were. It is NOT sent: distribution to the recipients is done on the Reports screen. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reports.quarterly.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `quarterly.service.regenerate(deliver: false)` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.regenerate_quarterly_report` |

**Input**

`quarter`: string<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Approvals

### `list_pending_approvals`

Approval requests waiting on the caller to decide right now. Read-only: decisions are made on the Approvals page.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `approvals.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `approval.service.inbox()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_pending_approvals` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_pending_items_for_me`

Everything waiting on the caller to decide: payments and payment changes awaiting approval, fee plans, leave applications, elective registrations, co-curricular and profile-correction requests, book and transport requests, and the approvals inbox. Only the queues the caller is the decider for, each with how many are waiting and the screen to open. Read-only: every decision is made by the caller on that screen, never by the assistant.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `approvals.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `approval.service.inbox() + each review queue listForReview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_pending_items_for_me` |

**Input**

_(no arguments)_

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

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string — Narrow to one subject, e.g. "Mathematics"<br>`status`: string — one of: PENDING, SUBMITTED, ALL — For a student or parent: their work still to submit (PENDING), already handed in (SUBMITTED), or both<br>`dueFrom`: string — Only work due on or after this day<br>`dueTo`: string — Only work due on or before this day<br>`first`: boolean — true for "which one is due first / next": only the assignment with the earliest due date that has not passed

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

### `update_assignment`

Change homework the caller set: its title, instructions, chapter or due date (to extend a deadline, say). The class sees the change. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `assignments.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `assignment.service.list() + update()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_assignment` |

**Input**

`homework`: string — The title of the homework to change<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`title`: string — The new title<br>`description`: string<br>`chapter`: string<br>`dueAt`: string — The new due date

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `delete_assignment`

Withdraw homework the caller set: it leaves every list; work already submitted is kept. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `assignments.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `assignment.service.list() + remove()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.delete_assignment` |

**Input**

`homework`: string<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"

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

### `get_class_attendance_summary`

Attendance compared ACROSS classes over a period, plus the figure for all of them together: each class with its attendance percentage, ranked. Use for "which class has the lowest/highest attendance", "class-wise attendance", "rank classes by attendance" and "overall attendance" of the school. The period is one date, one month, or a from/to range; with none it is the current month to date, and the answer always states the period. A school-wide reader sees every class; a teacher sees only the classes they teach. For ONE class use get_attendance_roster, for one student get_student_attendance. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `attendance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `attendance.service.getClassWiseSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_class_attendance_summary` |

**Input**

`date`: string — One day<br>`month`: string — YYYY-MM — one calendar month<br>`from`: string — Start of a range<br>`to`: string — End of a range<br>`order`: string — one of: LOWEST, HIGHEST — Rank from the lowest or the highest attendance; lowest first by default<br>`limit`: integer — Only when the user asks for a number of classes ("bottom 3")

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

`action`: string — Exact action name, e.g. "agent.mark_attendance"<br>`roleKey`: string — Only actions by holders of this role, e.g. FINANCE<br>`actorProfileId`: string — Only actions by this person<br>`from`: string<br>`to`: string<br>`month`: string — YYYY-MM<br>`year`: string — YYYY<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything<br>`cursor`: string — From a previous call, to fetch the next page

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Bills

### `list_bills`

Recurring bills (electricity, water, internet, AMC, rent ...) with amount, outstanding, due date and status. Filter: open, overdue, payments awaiting a bank check, paid; and "due within N days" (e.g. 7 for "what bills are due this week"). Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `bills.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.listBills()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_bills` |

**Input**

`status`: string — one of: open, overdue, unconfirmed, PAID, all — Default open<br>`dueWithinDays`: integer<br>`category`: string — one of: ELECTRICITY, WATER, INTERNET, PHONE, GAS, AMC, SOFTWARE, RENT, SECURITY, HOUSEKEEPING, WASTE, INSURANCE, LIFT, TRANSPORT, FUEL, OTHER<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_service_visits`

AMC and service-contract visits: scheduled (and overdue) by default, or done, missed or cancelled. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `bills.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.listVisits()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_service_visits` |

**Input**

`status`: string — one of: SCHEDULED, DONE, MISSED, CANCELLED<br>`withinDays`: integer

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_renewals`

Everything up for renewal in one list: licences and certificates, agreements and their notice dates, warranties, service contracts and AMCs, lab calibrations and software. With when a decision is needed, the cost where known, the owner and what happens if nothing is done. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `bills.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `renewals.service.renewals()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_renewals` |

**Input**

`withinDays`: integer — Default 90

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_bill_review_queue`

Bills flagged for a person to check: an amount well above usual, a possible duplicate, a consumption jump, a bill past due, a payment with no evidence or not yet confirmed with the bank, an invoice that does not match its order. Each flag states its rule and numbers; flags are prompts, not findings. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `bills.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `review.service.reviewQueue()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_bill_review_queue` |

**Input**

`show`: string — one of: open, reviewed, all

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_bill_costs`

What the school spends on recurring bills, by category, for a period, compared with the same period last year; plus what is outstanding now. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `bills.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `review.service.dashboard()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_bill_costs` |

**Input**

`preset`: string — one of: month, quarter, year, financialYear, academicYear — Default financialYear

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `record_bill`

Record a bill that has arrived against a service account (e.g. "the electricity bill for October is ₹48,200, due 25 October"). Its reminder joins the due-items queue. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.createBill()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_bill` |

**Input**

`account`: string **(required)** — The service, e.g. "electricity"<br>`amountRupees`: number **(required)**<br>`dueOn`: string **(required)** — YYYY-MM-DD<br>`billDate`: string — YYYY-MM-DD<br>`billNo`: string<br>`units`: number — Consumption, e.g. kWh

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_bill_payment`

Record a payment made against a bill (amount, mode, reference). It does NOT settle the bill: a different person confirms it against the bank statement. Money, so it is confirmed on the website. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.recordPayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_bill_payment` |

**Input**

`billRef`: string — The bill reference, e.g. "BIL-000042"<br>`billNo`: string — The provider's bill number<br>`account`: string — The service named in words, e.g. "electricity" or "lift AMC"<br>`amountRupees`: number **(required)**<br>`mode`: string **(required)** — one of: BANK, UPI, CHEQUE, CASH, CARD, AUTO_DEBIT, OTHER<br>`reference`: string — UTR, cheque number or transaction id<br>`paidOn`: string — YYYY-MM-DD<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `verify_bill_payment`

The bank check of a recorded bill payment: CONFIRM it with the bank reference (UTR / statement line), or REJECT it with a reason. Only when the checker says so in their own words; a person can never check a payment they recorded themselves. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `bills.service.confirmPayment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.verify_bill_payment` |

**Input**

`billRef`: string — The bill reference, e.g. "BIL-000042"<br>`billNo`: string — The provider's bill number<br>`account`: string — The service named in words, e.g. "electricity" or "lift AMC"<br>`decision`: string **(required)** — one of: CONFIRM, REJECT — The checker's own decision<br>`bankReference`: string — Required to confirm<br>`reason`: string — Required to reject

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `change_bill_status`

Dispute a bill, resolve a dispute (optionally with the revised amount), or cancel a wrongly recorded bill — always with a reason; nothing is deleted. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.setBillStatus()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.change_bill_status` |

**Input**

`billRef`: string — The bill reference, e.g. "BIL-000042"<br>`billNo`: string — The provider's bill number<br>`account`: string — The service named in words, e.g. "electricity" or "lift AMC"<br>`step`: string **(required)** — one of: DISPUTE, RESOLVE_DISPUTE, CANCEL<br>`reason`: string **(required)**<br>`revisedAmountRupees`: number

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `schedule_service_visit`

Schedule an AMC or service visit for a service account on a date. Its reminder joins the due-items queue. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.createVisit()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.schedule_service_visit` |

**Input**

`account`: string **(required)**<br>`date`: string **(required)** — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `complete_service_visit`

Close a scheduled AMC/service visit: DONE (needs the service report — give a link to it, or attach the file on the Bills screen), MISSED or CANCELLED (with the reason). The next visit is scheduled from it. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `bills.service.completeVisit()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.complete_service_visit` |

**Input**

`account`: string **(required)** — The service, e.g. "lift AMC"<br>`outcome`: string **(required)** — one of: DONE, MISSED, CANCELLED<br>`reportLink`: string — An https link to the service report or photos<br>`technician`: string<br>`findings`: string<br>`reason`: string — For MISSED or CANCELLED<br>`doneOn`: string — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `note_bill_flag`

Record what was found on a flagged bill in the review queue: EXPLAINED (with the explanation), DISMISSED (with why) or ESCALATED. Name the flag by its words, e.g. "the duplicate water bill". Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `bills.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `review.service.reviewFlag()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.note_bill_flag` |

**Input**

`flag`: string **(required)** — Words from the flag title<br>`status`: string **(required)** — one of: EXPLAINED, DISMISSED, ESCALATED<br>`note`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Budgets

### `get_budget_position`

Each budget with what was planned, what is committed to orders and what has been spent. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `budget.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `procurement.service.listBudgets()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_budget_position` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Campus

### `get_campus_status`

The campus right now: rooms in use and free by the timetable and bookings, spaces out of use, and events today. Scheduled use, not live tracking. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `campus.map.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `campus.service.campusMap()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_campus_status` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Certificates

### `list_certificate_types`

The certificates and documents a student or parent can request from the school office (bonafide, transfer, character certificate and so on), with what each needs. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `documentType.service.listRequestable()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_certificate_types` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_certificate_requests`

A student's own, or a parent's children's, certificate requests and where each stands (pending, in review, approved, issued, rejected, cancelled). Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `documentRequest.service.listMine()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_certificate_requests` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_certificate`

For a student or parent: ask the school office for a certificate (bonafide, transfer, character certificate ...) with the purpose it is for. The office reviews and issues it. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `documentType.service.listRequestable() + documentRequest.service.createRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_certificate` |

**Input**

`document`: string **(required)** — Which certificate, e.g. "Bonafide certificate"<br>`purpose`: string **(required)**<br>`studentName`: string — For a parent with several children<br>`requiredBy`: string — When it is needed by<br>`additionalInformation`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_certificate_request`

Cancel one of the caller's own certificate requests that the office has not started on yet. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `students.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `documentRequest.service.listMine() + cancelMine()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_certificate_request` |

**Input**

`document`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Clubs

### `list_clubs`

The clubs, sports teams and activities the school runs: category, activity, who it is for, when it meets, seats and whether it is taking requests to join. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `clubs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `clubs.service.listClubs()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_clubs` |

**Input**

`category`: string — one of: SPORTS, ARTS, ACADEMIC, SERVICE, OTHER<br>`search`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_club_memberships`

A student's own, or a parent's children's, club requests and memberships: status (waiting for consent, waiting for approval, waiting list, member), and whether a parent's consent is still needed. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `clubs.join` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `clubs.service.myMemberships()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_club_memberships` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `join_club`

Ask to join a club: a student for themselves, a parent for their child. A request from a minor waits for a parent's consent; the teacher in charge then approves. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `clubs.join` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `clubs.service.listClubs() + requestJoin()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.join_club` |

**Input**

`club`: string **(required)**<br>`studentName`: string<br>`admissionNo`: string<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `consent_to_club_join`

For a parent: give (or refuse) consent for their own child's request to join a club. Only the child's parent can do this, and only for a request waiting for consent. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `clubs.join` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `clubs.service.myMemberships() + decideConsent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.consent_to_club_join` |

**Input**

`club`: string<br>`studentName`: string<br>`decision`: string — one of: GIVE, REFUSE — Default GIVE

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_club_sessions`

Club sessions in a date range (default the next two weeks): for a family, the clubs their children belong to; for a teacher, the clubs they run; for school-wide staff, every club. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `clubs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `clubs/sessions.service.listSessions()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_club_sessions` |

**Input**

`club`: string<br>`from`: string<br>`to`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `mark_club_attendance`

For the teacher in charge of a club: take the register for a session (default today's). Everyone on the register is marked present except the members named as absent or excused. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `clubs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `clubs/sessions.service.listSessions() + register() + takeAttendance()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.mark_club_attendance` |

**Input**

`club`: string **(required)**<br>`date`: string — The session day; default today<br>`absent`: array — Names of members who were absent<br>`excused`: array

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`recipientProfileIds`: array — Profile ids, e.g. from list_users<br>`recipient`: string — Who to notify, by name -- one person, or several separated by "and" or commas. Alternative to recipientProfileIds.<br>`title`: string — Defaults to the start of the message<br>`body`: string **(required)**<br>`link`: string — In-app path to open, e.g. /admin/payments

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

## Compliance

### `list_compliance_deadlines`

Dated compliance items coming up or overdue: regulatory returns, licence and certificate renewals, policy reviews, mandatory trainings and agreement notice dates. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `compliance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `compliance.service.calendar()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_compliance_deadlines` |

**Input**

`days`: integer — How many days ahead to look (default 60).

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_licences`

Licences, certificates, recognitions and registrations with their expiry dates and renewal status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `compliance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `compliance.service.listLicences()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_licences` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Conversations

### `list_conversations`

The caller's parent–teacher conversations about a child, newest first, with how many messages are unread. unreadOnly lists just the ones with unread messages. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `conversations.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `conversations.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_conversations` |

**Input**

`unreadOnly`: boolean<br>`status`: string — one of: OPEN, CLOSED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `read_conversation`

The messages of one of the caller's conversations, found by the other person's name or the child. Reading it marks the messages as read, as opening it on the screen does.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `conversations.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `conversations.service.list() + getThread()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.read_conversation` |

**Input**

`withName`: string — The teacher or parent<br>`studentName`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `send_conversation_message`

Send a message about a child. A parent writes to their child's class teacher (the default), a subject teacher or the principal; a teacher writes to a guardian of a pupil they teach. It goes into the open conversation between the two, or starts one. Phone numbers typed into it are removed. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `conversations.use` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `conversations.service.contacts() + start()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.send_conversation_message` |

**Input**

`message`: string **(required)**<br>`studentName`: string<br>`admissionNo`: string<br>`toName`: string — Who it is for: a teacher's name, their subject, "class teacher" or "principal"; for a teacher, the guardian's name<br>`subject`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Correspondence

### `list_open_correspondence`

Open letters and circulars from boards, government and other bodies, with their due dates and status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `correspondence.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `correspondence.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_open_correspondence` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Cover

### `get_cover_arrangements`

Substitute cover on a day (default today): who is covering which class and period in place of whom (e.g. "who is covering 7B period 3"), or with mine=true the covers the caller is taking. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `staffleave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cover.service.coverFor() / myCovers()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_cover_arrangements` |

**Input**

`date`: string — YYYY-MM-DD<br>`className`: string<br>`periodNo`: integer<br>`mine`: boolean

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_cover_needs`

For the cover coordinator: who is away on a day (default today) — on approved leave or marked absent — and which of their periods still need cover. Absence reasons are not given. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `cover.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cover.service.needs()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_cover_needs` |

**Input**

`date`: string — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `suggest_cover_teachers`

For the cover coordinator: the best substitutes for one class and period on a day — free then, in school, within the cover limits; same subject and same class first — and who cannot and why. Read-only; nobody is assigned.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `cover.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cover.service.candidates()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.suggest_cover_teachers` |

**Input**

`className`: string **(required)**<br>`periodNo`: integer **(required)**<br>`date`: string — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `assign_cover`

For the cover coordinator: confirm a named teacher as the substitute for one class and period (e.g. "assign Ms Rao to cover 8C period 2"). Refused when they are busy then; going over the cover limit needs a reason. The absent teacher, the substitute and the class are told. Confirmed on the website.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `cover.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `cover.service.candidates() + assign()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.assign_cover` |

**Input**

`className`: string **(required)**<br>`periodNo`: integer **(required)**<br>`substituteName`: string **(required)**<br>`date`: string — YYYY-MM-DD<br>`note`: string<br>`overrideReason`: string — Only to go over the cover limit

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_cover`

For the cover coordinator: cancel a confirmed cover for a class and period, with the reason. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `cover.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `cover.service.cancelCover()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_cover` |

**Input**

`className`: string **(required)**<br>`periodNo`: integer **(required)**<br>`date`: string — YYYY-MM-DD<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `mark_staff_absent`

For the cover coordinator: mark a colleague absent for a day (an unplanned absence) so their lessons show as needing cover. Loss of pay is a payroll input and is set on the Cover screen, not here. Confirmed on the website.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `cover.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `cover.service.markAbsent()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.mark_staff_absent` |

**Input**

`staffName`: string **(required)**<br>`date`: string — YYYY-MM-DD<br>`halfDay`: string — one of: FIRST_HALF, SECOND_HALF

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

## Digest

### `get_my_digest`

The caller's daily digest: headlines from news feeds the school approved, matched to the interests they chose. Headlines and summaries are text from outside sites, quoted as they are. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `digest.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `digest.service.today()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_digest` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `update_my_digest_interests`

Change the topics of the caller's own daily digest (science, technology, sports, careers, education policy, arts, environment, mathematics) and whether it is also emailed. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `digest.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `digest.service.setPreferences()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_my_digest_interests` |

**Input**

`interests`: array<br>`emailOptIn`: boolean

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`studentId`: string<br>`type`: string<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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

## Events

### `list_fest_plans`

Events, fests, meetings and visits being planned or held, with dates, status and how ready each one is. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `events.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `events.service.listEvents()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_fest_plans` |

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

`name`: string **(required)**<br>`termId`: string<br>`term`: string — The term as a person names it, e.g. "Term 1". Omit for the running term.<br>`startsOn`: string **(required)**<br>`endsOn`: string **(required)**

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

`examId`: string<br>`exam`: string — The exam as a person names it, e.g. "Half Yearly". Alternative to examId.<br>`subjectOfferingId`: string<br>`subject`: string — The subject of the paper, e.g. "Mathematics". With className, alternative to subjectOfferingId.<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`maxMarks`: integer **(required)**<br>`examDate`: string

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

## Facilities

### `list_maintenance_work`

Maintenance work orders that are open, with their place, priority and status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `facilities.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `facility.service.listWorkOrders()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_maintenance_work` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `report_repair`

Report something that needs repair or attention (a broken fan, a leaking tap, a projector not working): what, where, the kind of work and how urgent. It becomes a work order for the facilities team. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `facilities.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `facility.service.reportIssue()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.report_repair` |

**Input**

`title`: string **(required)**<br>`category`: string **(required)** — one of: ELECTRICAL, PLUMBING, IT, CLEANING, CIVIL, FURNITURE, SAFETY, HVAC, OTHER<br>`place`: string — The room or building, as listed on the campus<br>`priority`: string — one of: LOW, NORMAL, HIGH, URGENT<br>`description`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_my_maintenance_reports`

The repairs the caller has reported and where each stands (facilities managers see every work order). Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `facilities.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `facility.service.listWorkOrders()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_my_maintenance_reports` |

**Input**

`status`: string — one of: OPEN, DONE, CLOSED, CANCELLED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_facility_reservation`

Ask to book a room, hall, lab or ground for a time slot (a meeting, a rehearsal). A clash with another booking is refused; the facilities manager confirms the request. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `facilities.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `facility.service.listFacilities() + requestBooking()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_facility_reservation` |

**Input**

`place`: string **(required)**<br>`title`: string **(required)** — What it is for<br>`date`: string **(required)** — The day<br>`from`: string **(required)** — Start time<br>`to`: string **(required)** — End time<br>`attendees`: integer

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

`search`: string — One student by name or admission number, or an invoice number<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string<br>`academicYearId`: string<br>`limit`: integer — Invoices to return, only when the user asks for a number; omit for all

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

Fee payments that have been recorded — receipt number, invoice, student, amount, mode, date and verification status. Also the answer to fee collection over a period: how much was collected this month, today or between two dates. Staff see the school; a family sees only their own settled payments. Read-only.

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

`search`: string — Student name, admission number or receipt/invoice number<br>`invoiceId`: string<br>`from`: string<br>`to`: string<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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

`enrollmentId`: string<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`invoiceNo`: string **(required)** — The new invoice number, unique in the school<br>`dueOn`: string **(required)**<br>`lines`: array **(required)**

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

`academicYearId`: string<br>`academicYear`: string — The year as a person names it, e.g. "2026-27". Omit for the current year; the confirmation names it.<br>`gradeId`: string — Restrict to one grade; omit to bill the whole year<br>`grade`: string — Restrict to one grade by name, e.g. "Class 6"<br>`dueOn`: string<br>`dryRun`: boolean — Count and total without writing anything

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

`enrollmentId`: string<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`mode`: string **(required)** — one of: ONE_TIME, PARTIAL, INSTALLMENT<br>`totalPaise`: integer **(required)** — Whole paise<br>`installments`: array **(required)** — Installments in due-date order. Their amounts must add up exactly to totalPaise. ONE_TIME has exactly one; PARTIAL and INSTALLMENT at least two.<br>`name`: string — Defaults to "Fee plan"<br>`feeHeadId`: string — The fee head this plan settles, if one<br>`notes`: string

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

`planId`: string<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`mode`: string — one of: ONE_TIME, PARTIAL, INSTALLMENT<br>`totalPaise`: integer<br>`installments`: array — Installments in due-date order. Their amounts must add up exactly to totalPaise. ONE_TIME has exactly one; PARTIAL and INSTALLMENT at least two.<br>`name`: string<br>`feeHeadId`: string<br>`notes`: string

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

`paymentId`: string<br>`invoiceNo`: string — The invoice the payment is on, e.g. "INV-1042". Alternative to paymentId.<br>`amountPaise`: integer — Only on a REJECTED payment<br>`mode`: string — one of: CASH, CHEQUE, DD, BANK<br>`paidOn`: string<br>`receiptNo`: string — The NEW receipt number<br>`notes`: string<br>`instrument`: object — Required for CHEQUE, DD and BANK: number, bankName, instrumentDate and a proofUrl (image or PDF). Not used for CASH.<br>`reason`: string — Why the record is being corrected — recorded with the change

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

`paymentId`: string<br>`invoiceNo`: string — The invoice the payment is on, e.g. "INV-1042". Alternative to paymentId.<br>`field`: string **(required)** — one of: amountPaise, mode, paidOn, receiptNo, notes, instrument.number, instrument.referenceNo, instrument.bankName, instrument.instrumentDate<br>`requestedValue`: string **(required)** — The new value; paise for amountPaise, YYYY-MM-DD for dates<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `transition_fee_plan`

Send a fee plan on along its workflow: submit (draft → finance review) or requestApproval (finance-reviewed → admin approval). Reviewing, approving, rejecting and publishing a plan are decisions a person makes on the fee plan screen, never through the assistant. Each step needs its own permission. Needs confirmation.

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

`planId`: string<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`step`: string **(required)** — one of: submit, requestApproval<br>`note`: string

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

`feeHeadId`: string — From get_fee_structures<br>`feeHead`: string — The fee head by name, e.g. "Tuition". Omit when the structure name starts with an existing fee head. Alternative to feeHeadId.<br>`academicYearId`: string — The year this charge applies to<br>`academicYear`: string — The year as a person names it, e.g. "2026-27". Omit for the current year; the confirmation names it.<br>`gradeId`: string — One grade only; omit for every grade<br>`grade`: string — One grade by name, e.g. "Class 6". Omit for every grade.<br>`name`: string **(required)** — e.g. "Tuition — Term 1"<br>`amountPaise`: integer **(required)** — The amount in paise, so ₹4,000 is 400000<br>`dueOn`: string **(required)** — When it falls due

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_fee_adjustments`

Fee concessions, credit notes and voids on issued invoices, with the student, amount, reason and where each stands (open ones by default). Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.concessions.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `adjustment.service.listAdjustments()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_fee_adjustments` |

**Input**

`status`: string — one of: PENDING_APPROVAL, APPLIED, REJECTED, WITHDRAWN<br>`kind`: string — one of: CONCESSION, CREDIT_NOTE, VOID

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_concession_schemes`

The school's fee concession schemes (sibling, staff ward, merit ...) with how each is worked out and who is eligible. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `fees.concessions.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `adjustment.service.listConcessionTypes()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_concession_schemes` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_fee_adjustment`

Request a fee concession (under a scheme), a credit note or a void on an issued invoice, with the reason. It goes to the approvals engine and changes nothing until an approver decides. A credit note or void also needs fees.manage. Money, so it is confirmed on the website.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.concessions.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `adjustment.service.requestAdjustment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_fee_adjustment` |

**Input**

`invoiceNo`: string **(required)** — e.g. "INV-1001"<br>`kind`: string **(required)** — one of: CONCESSION, CREDIT_NOTE, VOID<br>`scheme`: string — For a concession: the scheme name or code<br>`amountRupees`: number — For a credit note, or a discretionary concession<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `withdraw_fee_adjustment`

Withdraw a fee concession, credit note or void that is still waiting for approval. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `fees.concessions.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `adjustment.service.withdrawAdjustment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.withdraw_fee_adjustment` |

**Input**

`ref`: string — e.g. "CON-000012"<br>`invoiceNo`: string<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_concession_decision`

Record the approver's own decision on a fee concession, credit note or void waiting at their approval stage: APPROVE, REJECT (with a reason) or RETURN for changes. Only when the approver says so in their own words; never suggested. Nobody decides a request they raised. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `approvals.decide` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `approval.service.decide() on a FeeAdjustment request` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_concession_decision` |

**Input**

`ref`: string — The adjustment reference, e.g. "CON-000012"<br>`studentName`: string — Or the student it is for<br>`decision`: string **(required)** — one of: APPROVE, REJECT, RETURN — The approver's own decision<br>`comment`: string — Required to reject or return

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_gst_summary`

GST on fee lines for a period, by HSN/SAC and rate (taxable value, CGST, SGST), with untaxed lines and credits on taxed invoices — for the accountant. Not tax advice. The Tally voucher file is downloaded on the Accounts export screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `accounts.export` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `accounts-export.service.gstSummary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_gst_summary` |

**Input**

`from`: string **(required)** — YYYY-MM-DD<br>`to`: string **(required)** — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Governance

### `list_board_meetings`

Board, trustee and committee meetings with their dates and status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `governance.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `governance.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_board_meetings` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

Raise a hostel enquiry — a subject and optional description, optionally about one student. It is recorded as raised by the caller. It is filed in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `hostel.service.createInquiry()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_hostel_inquiry` |

**Input**

`subject`: string **(required)**<br>`description`: string<br>`studentId`: string — The student it concerns, if any

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`inquiryId`: string<br>`subject`: string — The enquiry as its subject is written, e.g. "Fan not working". Alternative to inquiryId.<br>`status`: string **(required)** — one of: OPEN, IN_PROGRESS, RESOLVED

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

### `list_my_outpasses`

The caller's own (a student's) or own children's (a parent's) hostel out-passes and where each stands. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.outpass.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `outpass.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_my_outpasses` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_outpasses`

Hostel out-passes for the warden: waiting for a decision (default), approved, out now, overdue back, or all. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `hostel.outpass.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `outpass.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_outpasses` |

**Input**

`view`: string — one of: pending, approved, out, overdue, all

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_outpass`

Request a hostel out-pass (e.g. "request an out-pass for my son on Saturday 10 am to Sunday 6 pm to go home"). A parent's request goes straight to the warden; a student's first goes to their guardian. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.outpass.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `outpass.service.request()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_outpass` |

**Input**

`childName`: string — A parent's child; a student requests for themselves<br>`fromDate`: string **(required)** — YYYY-MM-DD<br>`fromTime`: string **(required)** — HH:MM, leaving<br>`toDate`: string **(required)** — YYYY-MM-DD<br>`toTime`: string **(required)** — HH:MM, back<br>`reason`: string **(required)**<br>`destination`: string **(required)**<br>`escortName`: string<br>`escortRelationship`: string<br>`escortPhone`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_outpass`

Cancel an own (or own child's) out-pass that has not been used yet. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.outpass.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `outpass.service.cancel()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_outpass` |

**Input**

`ref`: string<br>`studentName`: string<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_outpass_consent`

For a parent: record their own consent (APPROVED) or refusal (REJECTED) for an out-pass their child asked for. Only when the parent says so themselves. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.outpass.request` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `outpass.service.parentDecision()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_outpass_consent` |

**Input**

`ref`: string<br>`studentName`: string<br>`decision`: string **(required)** — one of: APPROVED, REJECTED — The parent's own decision<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_outpass_decision`

For the warden: record their own decision on an out-pass waiting for them — APPROVED, or REJECTED with the reason. Only when the warden says so in their own words; never suggested. The guardians are told. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.outpass.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `outpass.service.wardenDecision()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_outpass_decision` |

**Input**

`ref`: string<br>`studentName`: string<br>`decision`: string **(required)** — one of: APPROVED, REJECTED — The warden's own decision<br>`note`: string — Required to reject

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_outpass_gate`

Record a resident leaving (EXIT, on an approved out-pass) or coming back (RETURN) at the gate by hand; a late return alerts the wardens. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `hostel.outpass.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `outpass.service.recordManual()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_outpass_gate` |

**Input**

`ref`: string<br>`studentName`: string<br>`event`: string **(required)** — one of: EXIT, RETURN<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Labs

### `get_labs_overview`

Each laboratory the caller may see, in figures: items, low stock, expired and expiring batches, quarantined stock, instruments out of service or overdue for calibration, computers in repair, practicals this week and open incidents. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `labs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.overview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_labs_overview` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_lab_stock`

Lab stock: what is on hand, what is low, and which batches have expired or expire soon (e.g. "which chemicals expire this month" = show expiring, withinDays 30). Optionally one lab or one item. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `labs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.listItems()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_lab_stock` |

**Input**

`show`: string — one of: expiring, low, hazardous, all — Default all<br>`withinDays`: integer — For show=expiring: how many days ahead (default 30); expired batches are always included<br>`labName`: string<br>`item`: string<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_lab_equipment`

Lab instruments with their calibration due dates, overdue calibrations and those out of service. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `labs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.assets.listEquipment()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_lab_equipment` |

**Input**

`show`: string — one of: calibration_due, out_of_service, all<br>`withinDays`: integer — For show=calibration_due (default 30)<br>`labName`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_practical_sessions`

Practical sessions: the ones the caller teaches or runs the lab for, from a date (default today) for N days (default 7), with class, lab, time and readiness status. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `labs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.sessions.listSessions()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_practical_sessions` |

**Input**

`from`: string — YYYY-MM-DD<br>`days`: integer<br>`status`: string — one of: open, COMPLETED, CANCELLED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_lab_incidents`

Lab incidents (spills, breakages, near misses, equipment failures ...) with their lab, kind, severity and status — open ones by default. The people involved are not given here. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `labs.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.sessions.listIncidents()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_lab_incidents` |

**Input**

`status`: string — one of: OPEN, CLOSED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `issue_lab_stock`

Issue lab stock for use (e.g. "issue 2 beakers to 9A practical"). Taken from the batches that expire first; expired or quarantined stock is never issued, and hazardous items go to the supervising teacher. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.suggestFefo() + moveOut(ISSUE)` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.issue_lab_stock` |

**Input**

`item`: string **(required)** — The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"<br>`labName`: string — Which lab, when more than one holds it<br>`quantity`: number **(required)**<br>`unit`: string — g, kg, mg, mL, L or pcs; default the item's unit<br>`issuedTo`: string — Who or what it is for, e.g. "9A practical" or "Mr Iyer"<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_lab_stock_use`

Record lab stock used up (CONSUMED) or broken/spoilt (DAMAGED, with the reason). Disposal needs evidence and is recorded on the Labs screen. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.moveOut(CONSUMED|DAMAGED)` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_lab_stock_use` |

**Input**

`item`: string **(required)** — The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"<br>`labName`: string — Which lab, when more than one holds it<br>`kind`: string **(required)** — one of: CONSUMED, DAMAGED<br>`quantity`: number **(required)**<br>`unit`: string<br>`batch`: string — The batch code, when it matters which bottle<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `receive_lab_stock`

Receive new lab stock as a batch (quantity, expiry printed on the container, supplier, lot). A chemical needs its expiry date or "no expiry". Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.receive()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.receive_lab_stock` |

**Input**

`item`: string **(required)** — The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"<br>`labName`: string — Which lab, when more than one holds it<br>`quantity`: number **(required)**<br>`unit`: string<br>`expiresOn`: string — YYYY-MM-DD<br>`noExpiry`: boolean<br>`supplier`: string<br>`lotNo`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_lab_calibration`

Record that a lab instrument was calibrated: certificate number, date and validity (default: its calibration interval). Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.assets.recordCalibration()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_lab_calibration` |

**Input**

`instrument`: string **(required)** — Name or code<br>`labName`: string<br>`certificateNo`: string **(required)**<br>`calibratedOn`: string — YYYY-MM-DD<br>`validUntil`: string — YYYY-MM-DD<br>`by`: string — Who calibrated it

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `plan_practical_session`

Plan a practical in a lab for a class at a date and time (the lab is checked for clashes). Materials are added on the Labs screen. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.sessions.createSession()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.plan_practical_session` |

**Input**

`labName`: string **(required)**<br>`title`: string **(required)**<br>`className`: string — e.g. "Class 9 A"<br>`subject`: string<br>`date`: string **(required)** — YYYY-MM-DD<br>`startTime`: string **(required)** — HH:MM<br>`durationMinutes`: integer

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `report_lab_incident`

Report a lab incident (spill, injury, breakage, fire, exposure, near miss, equipment failure ...). The lab's in-charge is told; a high-severity incident or injury also goes to the principal and administrator. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.sessions.reportIncident()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.report_lab_incident` |

**Input**

`labName`: string **(required)**<br>`kind`: string **(required)** — one of: SPILL, INJURY, BREAKAGE, FIRE, EXPOSURE, NEAR_MISS, EQUIPMENT_FAILURE, DEVICE_DAMAGE, OTHER<br>`severity`: string — one of: LOW, MEDIUM, HIGH<br>`description`: string **(required)**<br>`actionsTaken`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `draft_lab_reorder`

Draft a purchase request to reorder a lab item (default: its reorder quantity). Only a DRAFT: it is completed and submitted through Procurement by a person. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `labs.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `labs.service.reorder()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.draft_lab_reorder` |

**Input**

`item`: string **(required)** — The item as people call it, e.g. "beaker 250 mL" or "hydrochloric acid"<br>`labName`: string — Which lab, when more than one holds it<br>`quantity`: number<br>`unit`: string

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

## Lectures

### `list_digital_lectures`

Upcoming digital lectures and online meetings the caller hosts or is invited to, with their time and host. The join link is not included: a class is joined from its page. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `lectures.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `lecture.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_digital_lectures` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `schedule_online_class`

Schedule an online class (or a doubt session) for a class the caller teaches, on a day and time; the class is told and a meeting room is made. Weekly repeats are possible. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `lectures.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `lecture.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.schedule_online_class` |

**Input**

`title`: string **(required)**<br>`className`: string **(required)** — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`date`: string **(required)** — The day<br>`time`: string **(required)** — Start time, e.g. 17:00<br>`durationMinutes`: integer<br>`kind`: string — one of: LECTURE, DOUBT_SESSION, WEBINAR, OTHER<br>`repeatWeekly`: integer — How many weeks in a row (default 1)<br>`includeGuardians`: boolean

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_online_class`

Cancel an online class the caller hosts that has not finished; everyone invited is told the reason. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `lectures.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `lecture.service.list() + cancel()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_online_class` |

**Input**

`title`: string **(required)**<br>`date`: string<br>`reason`: string **(required)**

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

`search`: string — Title, author, ISBN, category or publisher<br>`category`: string<br>`author`: string<br>`resourceKind`: string — one of: BOOK, NOTE, QUESTION_PAPER<br>`availableOnly`: boolean — Only items with a copy on the shelf<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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

`status`: string — one of: ACTIVE, RETURNED, OVERDUE — ACTIVE means currently on loan and not yet due; OVERDUE is past its return date<br>`bookId`: string<br>`title`: string — The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.<br>`studentId`: string<br>`outstanding`: boolean — true for everything not yet returned (on loan or overdue) — "who has this book"<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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

Ask the library to issue a book to the caller. Name it by title or by id. The book must be a physical copy in this school's catalogue — an online resource is read where it lives and cannot be issued. The request goes to the librarian and changes nothing until it is approved. It files a request in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `library.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `library.service.listBooks() + requestBook()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_book` |

**Input**

`bookId`: string — From list_books<br>`title`: string — The book as a person names it, e.g. "Introduction to Algorithms". An ambiguous title is refused, never guessed.

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`status`: string — one of: PENDING, APPROVED, REJECTED, CANCELLED, ALL<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

### `find_library_copy`

Find a physical library copy by its accession number (what is on its barcode label): the book, shelf, status and, when it is out, who has it and when it is due. Or list the copies of a book by its title. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `library.copies.scan() / listCopies()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.find_library_copy` |

**Input**

`accessionNo`: string — e.g. ACC-000123<br>`title`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `lend_copy_by_accession`

Issue a physical copy by its accession number to a student by their admission number, as scanning at the desk does. Due in 14 days unless a date is given. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `library.copies.scan() + scanIssue()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.lend_copy_by_accession` |

**Input**

`accessionNo`: string **(required)**<br>`admissionNo`: string **(required)**<br>`dueOn`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `checkin_copy_by_accession`

Take back a physical copy by its accession number, as scanning it at the desk does; any late fine is calculated by the library. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `library.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `library.copies.scan() + scanReturn()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.checkin_copy_by_accession` |

**Input**

`accessionNo`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Marketing

### `get_marketing_funnel`

The admissions funnel in totals: enquiries by stage and by source, conversion and response time. No enquiry details. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `marketing.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `marketing.service.analytics()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_marketing_funnel` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

## Newsroom

### `list_newsroom_posts`

Recent newsroom stories, achievements and event posts the caller may see. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `community.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `community.service.feed()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_newsroom_posts` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

`unreadOnly`: boolean<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Operations

### `get_my_day`

What needs the caller today: their headline figures, tasks due, deadlines and decisions waiting on them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `institution.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `insights.service.home()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_day` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Organisation

### `get_organisation_structure`

The organisation in numbers: departments, positions sanctioned and filled, vacancies and staff not yet placed. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `org.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `org.service.chart()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_organisation_structure` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## PTM

### `list_ptm_rounds`

Parent–teacher meeting (PTM) rounds the caller can see: their dates, mode, whether booking is open and until when. A family sees the rounds for their children's classes, a teacher the rounds for their classes. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ptm.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.listRounds()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_ptm_rounds` |

**Input**

`status`: string — one of: OPEN, CLOSED, DRAFT, CANCELLED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_ptm_slots`

For a parent: each of their children in a PTM round, each of that child's teachers, the free meeting slots with each, and what is already booked. Read-only; book with reserve_ptm_slot.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ptm.book` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.bookingOptions()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_ptm_slots` |

**Input**

`round`: string — The PTM round title; default the round open for booking<br>`studentName`: string<br>`admissionNo`: string<br>`teacherName`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `reserve_ptm_slot`

Book parent–teacher meeting slots for the caller's own children: one or several (a child with several teachers, or several children). Each booking names the child, the teacher and the time; the earliest free slot is taken when no time is given. Shown in full before anything is booked; needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `ptm.book` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.bookingOptions() + book()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.reserve_ptm_slot` |

**Input**

`round`: string<br>`studentName`: string — The child's name; omit when you have one child<br>`admissionNo`: string<br>`teacherName`: string — The teacher's name, their subject ("maths teacher"), "class teacher" or "principal". Default: the class teacher<br>`time`: string — Start time, e.g. 16:20 or 4:20 pm. Default: the earliest free slot<br>`date`: string — The day, when the PTM runs over several days<br>`mode`: string — one of: IN_PERSON, ONLINE — Only for slots offered both ways<br>`bookings`: array — Several bookings at once

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_my_ptm_bookings`

The caller's upcoming PTM meetings: for a parent, their bookings for each child; for a teacher, the families booked with them. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `ptm.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.myBookings()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_my_ptm_bookings` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `reschedule_ptm_booking`

Move one of the caller's own PTM bookings to another free slot with the same teacher. Changes close a few hours before the meeting. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `ptm.book` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.myBookings() + bookingOptions() + reschedule()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.reschedule_ptm_booking` |

**Input**

`bookingRef`: string — The booking reference, e.g. PTB-0004<br>`studentName`: string<br>`teacherName`: string<br>`time`: string **(required)** — The new start time<br>`date`: string — The new day<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_ptm_booking`

Cancel one of the caller's own PTM bookings; the slot is offered to the waiting list. Needs confirmation.

| | |
|---|---|
| **Operation** | DELETE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `ptm.book` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.myBookings() + cancelBooking()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_ptm_booking` |

**Input**

`bookingRef`: string<br>`studentName`: string<br>`teacherName`: string<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `add_ptm_availability`

For a teacher: open their own PTM meeting slots between two times on a PTM day; slots are cut at the round's slot length. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `ptm.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ptm.service.addAvailability()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.add_ptm_availability` |

**Input**

`round`: string<br>`date`: string **(required)** — The PTM day<br>`from`: string **(required)** — Start time, e.g. 15:00<br>`to`: string **(required)** — End time, e.g. 17:00<br>`venue`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Payroll

### `list_payroll_runs`

Payroll runs by month with their status, headcount and totals. Totals only: nobody's individual pay or bank details. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `payroll.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `payroll.service.listRuns()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_payroll_runs` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Procurement

### `list_purchase_requests`

Purchase requests with their amount and stage. The caller sees their own, or the whole school's if they manage purchasing. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `procurement.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `procurement.service.listRequests()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_purchase_requests` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_purchase_request`

Draft a purchase request: a title, the items with quantity and estimated unit price in rupees, and why. It is saved as a draft; adding quotes, submitting it for approval and every approval happen on the Purchasing page. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `procurement.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `procurement.service.createRequestDraft()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_purchase_request` |

**Input**

`title`: string **(required)**<br>`items`: array **(required)**<br>`justification`: string<br>`department`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

## Quizzes

### `list_quizzes`

Quizzes: for a student, the ones open to them with their own attempt and score; for a teacher, the quizzes they set with how many have attempted. Taking a quiz happens on the Quizzes page. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `assignments.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `quiz.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_quizzes` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_my_quiz_results`

A student's own submitted quiz attempts: score, right and wrong answers, subject and when. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `submissions.submit` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `quiz.service.myAttempts()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_quiz_results` |

**Input**

_(no arguments)_

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

## Report cards

### `get_my_term_report_cards`

The caller's own (a student) or their child's (a parent) published term report cards: overall percentage and grade, the result line, each subject's grade, attendance, co-scholastic grades and the class teacher's remarks. Only published cards; the latest version of each. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reportcards.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reportcards.service.published()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_term_report_cards` |

**Input**

`studentName`: string<br>`admissionNo`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_term_report_cards`

For staff: the term report cards of the classes the caller prepares, with each card's stage (draft, class-teacher approved, principal approved, published) and whether marks and remarks are complete. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reportcards.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reportcards.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_term_report_cards` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`status`: string — one of: DRAFT, CLASS_TEACHER_APPROVED, PRINCIPAL_APPROVED, PUBLISHED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_term_report_remark_draft`

A suggested class-teacher remark for one pupil's term report card, drafted from the card's subject grades and attendance (an AI draft, or a template when no AI is configured). Nothing is saved: read it, edit it, then save it with save_term_report_remarks.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reportcards.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reportcards.service.list() + drafts.service.draft()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_term_report_remark_draft` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`term`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `save_term_report_remarks`

Write the class teacher's remarks on one pupil's term report card (the class teacher or the principal). An approved card goes back to draft for re-approval. Approving and publishing stay on the Report cards page. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reportcards.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `reportcards.service.list() + update()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.save_term_report_remarks` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`term`: string<br>`remarks`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Review calls

### `list_review_calls`

Parent review calls the caller works on or oversees: the pupil, the reason, priority, status, when the call is scheduled, the next follow-up and open actions. Private call notes are not included; read them on the Review calls page. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `reviewcalls.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reviewcalls.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_review_calls` |

**Input**

`status`: string — one of: open, all, CLOSED<br>`mine`: boolean — Only the calls assigned to the caller

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `open_review_call`

Open a parent review call about a pupil the caller teaches (attendance, academics, behaviour support, fees, wellbeing or other), assigned to the caller. A safeguarding concern never goes here: it is reported through the safeguarding route. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reviewcalls.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `reviewcalls.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.open_review_call` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`reason`: string **(required)** — one of: ATTENDANCE, ACADEMICS, BEHAVIOUR_SUPPORT, FEES, WELLBEING, OTHER<br>`summary`: string — What the call is about<br>`priority`: string — one of: LOW, NORMAL, HIGH, URGENT<br>`nextFollowUpOn`: string — When to follow up

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `log_review_call_attempt`

Log an attempt to reach the family on a review call: the channel and whether they were reached, with a short note. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reviewcalls.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reviewcalls.service.list() + logAttempt()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_review_call_attempt` |

**Input**

`caseRef`: string — The review call reference, e.g. RVC-0003<br>`studentName`: string — The pupil the call is about<br>`channel`: string **(required)** — one of: PHONE, WHATSAPP, VIDEO, IN_PERSON, EMAIL, SMS<br>`reached`: boolean **(required)**<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `add_review_call_note`

Add a private note to a review call (context, discussion, the parent's view, an agreement). A safeguarding concern is never written here. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reviewcalls.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reviewcalls.service.list() + addNote()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.add_review_call_note` |

**Input**

`caseRef`: string — The review call reference, e.g. RVC-0003<br>`studentName`: string — The pupil the call is about<br>`text`: string **(required)**<br>`kind`: string — one of: CONTEXT, DISCUSSION, PARENT_VIEW, AGREEMENT, OTHER

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_review_call_schedule`

Schedule a review call with the family: the day, the time and the channel. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `reviewcalls.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `reviewcalls.service.list() + schedule()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_review_call_schedule` |

**Input**

`caseRef`: string — The review call reference, e.g. RVC-0003<br>`studentName`: string — The pupil the call is about<br>`date`: string **(required)** — The day of the call<br>`time`: string — e.g. 11:30; default 10:00<br>`channel`: string — one of: PHONE, WHATSAPP, VIDEO, IN_PERSON, EMAIL, SMS

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Safety

### `get_visitors_on_site`

Visitors and contractors: on site now (default), expected today, or waiting for their host. With host, purpose, check-in time and overstays. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `visitors.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `visitors.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_visitors_on_site` |

**Input**

`view`: string — one of: onsite, today, pending

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `add_visitor`

Pre-register a visitor or contractor: name, purpose, host, expected time. A visitor for someone else waits for that host's approval; a contractor needs the work order or check done. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `visitors.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `visitors.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.add_visitor` |

**Input**

`name`: string **(required)**<br>`purpose`: string **(required)**<br>`kind`: string — one of: VISITOR, CONTRACTOR, VENDOR, PARENT_VISIT, OFFICIAL<br>`organisation`: string<br>`phone`: string<br>`hostName`: string — The member of staff they are meeting; default the caller<br>`expectedDate`: string — YYYY-MM-DD<br>`expectedTime`: string — HH:MM<br>`expectedHours`: number<br>`contractorCheckNote`: string — For a contractor: the work order or the check done

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `update_visitor`

Check a visitor in (only after their photo ID has been seen — say so), check them out, or cancel an expected visit. Only the ID's type and last four characters are kept. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `visitors.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `visitors.service.checkIn() / checkOut() / cancel()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.update_visitor` |

**Input**

`visitor`: string **(required)** — Name or reference<br>`step`: string **(required)** — one of: CHECK_IN, CHECK_OUT, CANCEL<br>`idVerified`: boolean — For check-in: the photo ID was seen<br>`idType`: string<br>`idLast4`: string<br>`badgeNumber`: string<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_emergency_roster`

Who should be on campus now, for an evacuation or emergency count: students marked present and not released or out on a pass (by class), released today, on out-pass, and visitors checked in. A roster to account for people in person, not a location tracker; the named list is printed from the Gate screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `visitors.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `pickup.service.emergencyRoster()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_emergency_roster` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_my_child_delegates`

For a parent: the adults authorised to collect their own child (standing and time-limited delegates) and the child's recent gate releases. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `pickup.service.guardianList()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_my_child_delegates` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `request_pickup_delegation`

For a parent: let another adult collect their own child for a while (e.g. "let my brother Sunil collect Aarav on Friday"). A one-time code is sent to the parent's phone; the delegation starts once the parent gives that code back. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `pickup.service.guardianRequest()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_pickup_delegation` |

**Input**

`childName`: string<br>`delegateName`: string **(required)**<br>`relationship`: string **(required)**<br>`phone`: string<br>`fromDate`: string — YYYY-MM-DD<br>`toDate`: string **(required)** — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `confirm_pickup_delegation`

For a parent: confirm a pending pickup delegation with the one-time code sent to their phone. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `pickup.service.guardianConfirm()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.confirm_pickup_delegation` |

**Input**

`delegateName`: string<br>`code`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `revoke_pickup_delegation`

For a parent: end a pickup delegation or authorisation they gave for their own child. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `pickup.service.revoke()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.revoke_pickup_delegation` |

**Input**

`delegateName`: string **(required)**<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_my_child_checkpoints`

ID-card checkpoints on a day (default today). A parent sees their own child's gate and bus scans; school-wide staff see counts by checkpoint and how many were flagged. A scan shows a card was presented there and then, not where someone is now. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `checkpoints.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `checkpoints.service.myChildren() / events()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_child_checkpoints` |

**Input**

`date`: string — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `block_id_card`

Block a student's or staff member's ID card as LOST or REVOKED, so scans of it are refused from now on. A replacement is issued on the Gate screen. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `checkpoints.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `checkpoints.service.blockCard()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.block_id_card` |

**Input**

`holderName`: string **(required)**<br>`status`: string **(required)** — one of: LOST, REVOKED<br>`reason`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `get_camera_review_count`

For trained camera reviewers only: how many camera observations are waiting for review. A count and nothing else; the observations themselves are reviewed on the Camera review screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `camera.events.review` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `CameraObservation count (status UNVERIFIED or NEEDS_FOLLOW_UP)` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_camera_review_count` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

## Showcase

### `get_showcase`

The school's published achievement and top-ranker showcase: each edition and its entries. Only published entries of children whose media consent allows it. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `institution.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `showcase.service.published()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_showcase` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `draft_showcase_entry`

For showcase publishers: draft an achievement entry for a student in a showcase edition (default the latest one still being prepared). It stays a draft: someone else reviews it, and consent is checked again when the edition is published on the Showcase page. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `showcase.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `showcase.service.listEditions() + addEntry()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.draft_showcase_entry` |

**Input**

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`edition`: string<br>`title`: string **(required)** — e.g. "Gold, district chess championship"<br>`category`: string **(required)** — one of: ACADEMIC, SPORTS, ARTS, OLYMPIAD, SERVICE, OTHER<br>`detail`: string<br>`level`: string — e.g. School, District, State, National

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Social

### `list_social_posts`

Posts drafted for the school's social media accounts and what happened on each network (queued, simulated — not posted, failed). Staff only. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `social.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `social.service.listPosts()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_social_posts` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `draft_social_post`

For staff who publish: draft a post for the school's social accounts on the chosen networks (Facebook, Instagram, X, LinkedIn, YouTube). Every child in it must be tagged (by admission number) and have public media consent, or the post must say no child can be identified. Drafting sends nothing. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `social.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `social.service.compose()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.draft_social_post` |

**Input**

`text`: string **(required)**<br>`networks`: array **(required)**<br>`link`: string — An https:// link<br>`taggedAdmissionNos`: array — Every child who appears<br>`noIdentifiableStudents`: boolean — True when no child can be identified in the post

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `send_social_post`

Send a drafted social post to its networks, at the explicit request of a staff member who publishes. Consent of every tagged child is checked again first. Without provider credentials the outcome is recorded as SIMULATED — not posted; nothing claims to have been posted. Confirmed on the website only.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `social.publish` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `social.service.listPosts() + publish()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.send_social_post` |

**Input**

`search`: string — Words from the post; default the latest unsent draft

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Staff leave

### `get_staff_leave_balance`

Leave balance for this leave year (April–March): entitled, carried forward, used, pending and available per leave type. The caller's own by default; HR and the principal may name a colleague. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `staffleave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `staffLeave.service.balanceFor()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_staff_leave_balance` |

**Input**

`staffName`: string — HR / principal only

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_staff_leave`

Staff leave applications: the caller's own, or — for HR and the principal — everyone's (pending by default for them), optionally on a date or for one colleague. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `staffleave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `staffLeave.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_staff_leave` |

**Input**

`status`: string — one of: PENDING, APPROVED, REJECTED, CANCELLED<br>`date`: string — YYYY-MM-DD, who is on leave that day<br>`staffName`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `apply_staff_leave`

Apply for the caller's own staff leave (e.g. "apply for casual leave on Monday because of a family function"): type, dates (or a half day), reason. The draft shows the working days it counts and the balance left. HR and the principal are told. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `staffleave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `staffLeave.service.apply()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.apply_staff_leave` |

**Input**

`type`: string **(required)** — one of: CL, SL, EL, ML, PL, DL, LWP — CL casual, SL sick, EL earned, ML maternity, PL paternity, DL duty, LWP without pay<br>`fromDate`: string **(required)** — YYYY-MM-DD<br>`toDate`: string — YYYY-MM-DD; default the same day<br>`halfDay`: string — one of: FIRST_HALF, SECOND_HALF<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_staff_leave`

Withdraw the caller's own pending leave, or cancel an approved leave that has not started (its balance is restored and cover for the days ahead is cancelled). Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `staffleave.apply` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `staffLeave.service.cancel()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_staff_leave` |

**Input**

`ref`: string<br>`fromDate`: string — YYYY-MM-DD<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `record_staff_leave_decision`

For HR and the principal: record their own decision on a colleague's pending leave — APPROVE (the balance is deducted) or REJECT with the reason. Only when the approver says so in their own words; never suggested. Nobody decides their own leave. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `staffleave.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `staffLeave.service.decide()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_staff_leave_decision` |

**Input**

`ref`: string<br>`staffName`: string<br>`decision`: string **(required)** — one of: APPROVE, REJECT — The approver's own decision<br>`note`: string — Required to reject

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

Ask for a co-curricular activity or achievement to be added to the caller's own profile. The activity date cannot be in the future. It goes to the class teacher for review and changes nothing until approved. It files a request in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `cocurricular.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `cocurricular.service.request()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_cocurricular` |

**Input**

`name`: string **(required)** — The activity, e.g. "Inter-school football tournament"<br>`activityDate`: string **(required)** — When it took place<br>`category`: string — one of: SPORTS, ARTS, MUSIC, DANCE, DRAMA, LITERARY, SCIENCE, SOCIAL_SERVICE, LEADERSHIP, CLUB, OTHER<br>`level`: string — one of: SCHOOL, INTER_SCHOOL, DISTRICT, STATE, NATIONAL, INTERNATIONAL, OTHER<br>`achievement`: string — e.g. "Runner-up"<br>`description`: string

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

Ask for a correction to the caller's own profile. Only first name, last name, date of birth, gender and address can be corrected this way. Only one request may be pending at a time. Changes nothing until a class teacher approves. It files a request in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `profile.edit.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `profileEdit.service.request()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_profile_edit` |

**Input**

`changes`: object — The corrected values<br>`field`: string — The field to correct, as a person names it, e.g. "address" or "date of birth"<br>`value`: string — The corrected value<br>`note`: string — Why the correction is needed

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

`query`: string — Name, admission number or class, e.g. "Rahul", "OAK-12", "Class 6 A". Omit to list everyone in scope.<br>`sectionId`: string — Restrict to one section<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

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

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`guardianProfileId`: string — The parent's profile id, e.g. from list_users<br>`guardianName`: string — The parent's name as a person writes it, e.g. "Mr Sharma". An existing parent profile; alternative to guardianProfileId.<br>`relation`: string **(required)** — one of: FATHER, MOTHER, GUARDIAN<br>`isPrimary`: boolean — Whether this is the primary contact<br>`pickupAuthorized`: boolean — Whether they may collect the child; defaults to yes

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

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section<br>`academicYearId`: string<br>`academicYear`: string — The year as a person names it, e.g. "2026-27". Omit for the current year.<br>`rollNo`: integer

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

`enrollmentId`: string — From search_students or list_enrollments<br>`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`status`: string **(required)** — one of: ACTIVE, TRANSFERRED, WITHDRAWN, GRADUATED

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

## Sustainability

### `get_eco_points`

The eco-points board: verified points of each class, house and club team, the school total and recent verified activities. Team totals only, no individual pupils. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `sustainability.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.ecoPoints()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_eco_points` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_eco_activities`

Eco activities logged by the teams the caller works with (every team at school-wide scope), with status: submitted (waiting for verification), verified or rejected. Staff only. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `sustainability.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.listActivities()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_eco_activities` |

**Input**

`status`: string — one of: SUBMITTED, VERIFIED, REJECTED

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `log_eco_activity`

Log an eco activity for a class, house or club team the caller leads or teaches (a clean-up, planting drive, awareness session). It earns points only once someone else verifies it. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `sustainability.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.listTeams() + logActivity()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_eco_activity` |

**Input**

`team`: string **(required)** — The eco team, e.g. "Class 6 A"<br>`title`: string **(required)**<br>`category`: string — one of: PLANTING, CLEANUP, WASTE_SEGREGATION, COMPOSTING, WATER_SAVING, ENERGY_SAVING, AWARENESS, LIFE_ACTION, OTHER<br>`date`: string — When it happened; default today<br>`participants`: integer<br>`description`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `verify_eco_activity`

For a verifier, at their explicit request: verify (award points) or reject an eco activity someone else logged. The person who logged it can never verify it; verifying needs evidence on file or the verifier's statement that they saw it. Confirmed on the website only.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | HIGH |
| **Confirmation** | REQUIRED |
| **Permission** | `sustainability.verify` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `sustainability.service.listActivities() + decideActivity()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.verify_eco_activity` |

**Input**

`activity`: string **(required)** — Its reference (ECO-0004) or title<br>`decision`: string **(required)** — one of: VERIFY, REJECT<br>`points`: integer<br>`note`: string — Required when rejecting<br>`evidenceSeen`: boolean — The verifier saw the activity in person

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `log_waste`

Record waste the school generated or handed over: the stream (wet, dry, e-waste, sanitary, hazardous lab), the weight in kg, the day and where it went. E-waste, sanitary and hazardous waste handed to a vendor needs the vendor and their receipt number. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `sustainability.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.createWaste()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_waste` |

**Input**

`stream`: string **(required)** — one of: WET, DRY, E_WASTE, SANITARY, HAZARDOUS_LAB<br>`weightKg`: number **(required)**<br>`date`: string — Default today<br>`destination`: string — one of: VENDOR, COMPOST, MUNICIPAL, STORED, OTHER<br>`vendorName`: string<br>`receiptNo`: string<br>`notes`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `log_meter_reading`

Record a month's water, electricity, rainwater-harvested or solar-generated figure: the quantity, or the opening and closing meter readings. Recording the same month again corrects it. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `sustainability.manage` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.recordMeter()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_meter_reading` |

**Input**

`kind`: string **(required)** — one of: WATER, ELECTRICITY, RAINWATER_HARVESTED, SOLAR_GENERATED<br>`period`: string **(required)** — The month, e.g. 2026-09<br>`quantity`: number<br>`startReading`: number<br>`endReading`: number<br>`meterLabel`: string — Default "Main"<br>`notes`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `log_plant_check`

Record a survival check on a tree or plant (alive, needs care, dead, replaced). A check needs a photo already uploaded to EduOS, given as its link; there is no photo upload in a chat. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `sustainability.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `sustainability.service.listPlants() + recordPlantCheck()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_plant_check` |

**Input**

`plant`: string **(required)** — Its code (TRE-0012) or species<br>`status`: string **(required)** — one of: ALIVE, NEEDS_CARE, DEAD, REPLACED<br>`note`: string<br>`photoUrl`: string — Link to a photo already uploaded to EduOS (/uploads/...) or an https:// link

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Syllabus

### `get_syllabus_progress`

Syllabus progress by subject and class: the module being taught now, how much is covered, and whether it is on track, behind or has no recent update. A teacher sees their own subjects, a student or parent their class, the principal the whole school. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `syllabus.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `syllabus.service.overview()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_syllabus_progress` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `log_syllabus_progress`

For the teacher of a subject: record what was taught in a lesson — the topics covered in the current module (or a named one), a note and any homework given. Updates the class's syllabus progress. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `syllabus.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `syllabus.service.myOfferings() + plan() + recordProgress()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_syllabus_progress` |

**Input**

`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`subject`: string **(required)**<br>`module`: string — Default the module being taught now<br>`topics`: array — The topics covered<br>`note`: string<br>`homework`: string<br>`taughtOn`: string — Default today

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

## Tasks

### `list_due_items`

Due items and reminders: bills to pay, renewals, service visits, inspections, follow-ups and anything else with a due date. The caller sees their own (or, with school-wide access, everybody's). Filter by open, overdue or done, by department, or by how many days ahead. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `tasks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_due_items` |

**Input**

`status`: string — one of: open, overdue, done, all — Default open<br>`dueWithinDays`: integer — Only items due within this many days, e.g. 7 for "this week"<br>`department`: string — one of: ADMINISTRATION, FINANCE, ACADEMICS, LABS, TRANSPORT, FACILITIES, COMPLIANCE, HR, HOSTEL, LIBRARY, ENGAGEMENT, SUSTAINABILITY, HEALTH, IT, OTHER<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_due_items_summary`

How much is due, in totals: open, overdue, due this week and this month, critical and unassigned items, by department, with the expected cost of the next 90 days. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `tasks.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.summary()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_due_items_summary` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `create_due_item`

Add a due item (a reminder with an owner and a due date), e.g. "remind me to renew the fire NOC by 30 November". Owned by the caller; someone who manages every task may give it to a named colleague. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `tasks.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.createItem()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_due_item` |

**Input**

`title`: string **(required)**<br>`department`: string **(required)** — one of: ADMINISTRATION, FINANCE, ACADEMICS, LABS, TRANSPORT, FACILITIES, COMPLIANCE, HR, HOSTEL, LIBRARY, ENGAGEMENT, SUSTAINABILITY, HEALTH, IT, OTHER<br>`dueOn`: string **(required)** — YYYY-MM-DD<br>`severity`: string — one of: LOW, NORMAL, HIGH, CRITICAL<br>`category`: string — one of: BILL, LICENCE, SERVICE, INSPECTION, VEHICLE_CHECK, LAB_EXPIRY, CALIBRATION, SANITATION, WATER_TEST, TRAINING, PTM_FOLLOWUP, RENEWAL, MAINTENANCE, OTHER<br>`description`: string<br>`amountRupees`: number — Expected cost, if any<br>`repeat`: string — one of: WEEK, MONTH, YEAR — Repeats every week, month or year<br>`ownerName`: string — A colleague to own it (school-wide task managers only)

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `snooze_due_item`

Put an open task off until a later date, with the reason (e.g. "snooze the AMC visit to Friday because the vendor is on leave"). A critical task can be put off by one day at most, others by 30 days. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `tasks.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.snooze()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.snooze_due_item` |

**Input**

`taskRef`: string — The task reference, e.g. "TSK-000123"<br>`title`: string — The task named in words, e.g. "AMC visit" — an ambiguous match is asked about<br>`until`: string **(required)** — YYYY-MM-DD, a future day<br>`reason`: string **(required)**

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `complete_due_item`

Mark an open task done, with a note of what was done (for a task that needs evidence the note describes it; files are attached on the Tasks screen). A repeating task creates its next one. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `tasks.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.complete()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.complete_due_item` |

**Input**

`taskRef`: string — The task reference, e.g. "TSK-000123"<br>`title`: string — The task named in words, e.g. "AMC visit" — an ambiguous match is asked about<br>`note`: string — What was done, e.g. "Paid by NEFT, UTR 1234"

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `reassign_due_item`

Give an open task to a named colleague. For those who manage every task. Needs confirmation.

| | |
|---|---|
| **Operation** | UPDATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `tasks.manage` |
| **Scope** | ALL |
| **Affects others** | Yes |
| **EduOS service** | `tasks.service.reassign()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.reassign_due_item` |

**Input**

`taskRef`: string — The task reference, e.g. "TSK-000123"<br>`title`: string — The task named in words, e.g. "AMC visit" — an ambiguous match is asked about<br>`ownerName`: string **(required)** — The colleague, e.g. "Ms Rao"<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `cancel_due_item`

Cancel an open task that is no longer needed, with the reason. Needs confirmation.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `tasks.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `tasks.service.cancel()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.cancel_due_item` |

**Input**

`taskRef`: string — The task reference, e.g. "TSK-000123"<br>`title`: string — The task named in words, e.g. "AMC visit" — an ambiguous match is asked about<br>`reason`: string **(required)**

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

Raise a support ticket with a subject, routed to the admin office, warden, librarian or — for a question about a child — the class teacher. A ticket carries only a subject; add the details with reply_to_ticket. It files a ticket in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `tickets.create` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `ticket.service.create()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.create_ticket` |

**Input**

`subject`: string **(required)**<br>`routedToRoleKey`: string — one of: ADMIN, WARDEN, LIBRARIAN, CLASS_TEACHER<br>`studentId`: string — Required when routing to the class teacher<br>`priority`: string — Default NORMAL

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`day`: string — Weekday name, today/tomorrow/yesterday, or "week" for the whole week<br>`next`: boolean — true for "what is my next class/period?": only the next period after the current time, not the whole day<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`sectionId`: string — The class section, when the id is already known

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

`sectionId`: string<br>`className`: string — The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"<br>`dayOfWeek`: integer — 1 = Monday … 7 = Sunday<br>`day`: string — The weekday by name, e.g. "Monday". Alternative to dayOfWeek.<br>`periodNo`: integer **(required)**<br>`startTime`: string **(required)** — HH:MM<br>`endTime`: string **(required)** — HH:MM<br>`subjectOfferingId`: string — Omit for a break<br>`subject`: string — The subject taught in the period, e.g. "Mathematics". Omit for a break.

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

`routeId`: string<br>`routeName`: string — The route as it is written, e.g. "Route 7". Alternative to routeId.<br>`name`: string **(required)**<br>`sequenceNo`: integer **(required)** — Position along the route, 1 = first<br>`etaMinutesFromStart`: integer

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

`studentId`: string — Preferred when known, e.g. from search_students<br>`admissionNo`: string — Admission number, e.g. "OAK-12"<br>`studentName`: string — Full or partial name; an ambiguous match is refused, never guessed<br>`routeId`: string<br>`routeName`: string — The route as it is written, e.g. "Route 7". Alternative to routeId.<br>`stopId`: string — A stop on that route, from list_transport_stops<br>`stopName`: string — The stop as it is written, e.g. "Market". Alternative to stopId.<br>`academicYearId`: string<br>`direction`: string — one of: BOTH, PICKUP, DROP — Default BOTH

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

Ask for a place on a bus route, from a particular stop. Name the route the way it is written ("Route 2") and, where the route has more than one stop, name the stop too. The stop must be one on that route. The request goes to the school office and changes nothing until it is approved — the fare is only charged once a place is granted. It files a request in the name of the caller, so it needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | LOW |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.request` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `transport.service.listRoutesForStudent() + requestRoute()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.request_transport_route` |

**Input**

`routeId`: string — From get_transport_routes<br>`routeName`: string — The route as it is written, e.g. "Route 2"<br>`stopId`: string — A stop on that route<br>`stopName`: string — The stop as it is written<br>`direction`: string — one of: BOTH, PICKUP, DROP — Both ways by default

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

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

`status`: string — one of: PENDING, APPROVED, REJECTED, CANCELLED, ALL<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

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

### `get_my_child_bus`

Where my child's bus is today: their trip, its status, their stop, the estimated arrival (an estimate), and whether they have boarded, got off or been handed over. Only the caller's own child (or own trips); never other children. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `trips.service.myTrips()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_my_child_bus` |

**Input**

`childName`: string

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `get_live_bus_status`

Every bus right now: whether its location is live, stale or offline, when it was last seen, and the trip it is running. For the transport office and the principal. The map is on the Fleet screen. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.tracking.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `telemetry.service.livePositions()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_live_bus_status` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `list_trips`

Bus trips on a day (default today): vehicle, status, seats used and free, and how many have boarded, got off or not shown up. A teacher on bus duty sees only their own trips. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.trips.operate` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `trips.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_trips` |

**Input**

`date`: string — YYYY-MM-DD

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `record_trip_boarding`

Record a student boarding (BOARDED), getting off (ALIGHTED) or not at the stop (NO_SHOW) on a trip the caller runs. A no-show tells the guardians. A wrong vehicle is refused and raised as an alert. Safe handover at a drop is recorded on the Fleet screen. Confirmed on the website.

| | |
|---|---|
| **Operation** | ACTION |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.trips.operate` |
| **Scope** | OWN or ALL |
| **Affects others** | Yes |
| **EduOS service** | `trips.service.board() / alight() / markNoShow()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.record_trip_boarding` |

**Input**

`studentName`: string **(required)**<br>`event`: string **(required)** — one of: BOARDED, ALIGHTED, NO_SHOW<br>`tripRef`: string — When more than one trip is running<br>`note`: string

**Output** — `{ success: true, data: { … } }`, plus `action: { type, id, status: "completed" }` once performed.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`. `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.

### `list_vehicles`

School vehicles with status, capacity, and papers (permit, insurance, fitness, PUC) expired or expiring within 30 days, plus safety checks and service due. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `transport.fleet.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `vehicles.service.list()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.list_vehicles` |

**Input**

`show`: string — one of: papers_due, off_road, all

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

### `log_vehicle_event`

Log a fuel fill, a service, a breakdown (which takes the vehicle off the road unless told otherwise), an odometer reading or a fire-extinguisher / first-aid check for a vehicle. Needs confirmation.

| | |
|---|---|
| **Operation** | CREATE |
| **Risk** | MEDIUM |
| **Confirmation** | REQUIRED |
| **Permission** | `transport.fleet.manage` |
| **Scope** | OWN or ALL |
| **Affects others** | No |
| **EduOS service** | `vehicles.service.addLog()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.log_vehicle_event` |

**Input**

`vehicle`: string **(required)** — Registration number, e.g. "KA01AB1234"<br>`kind`: string **(required)** — one of: FUEL, SERVICE, BREAKDOWN, ODOMETER, SAFETY_CHECK<br>`odometerKm`: number<br>`litres`: number<br>`amountRupees`: number<br>`vendor`: string<br>`note`: string<br>`severity`: string — one of: LOW, NORMAL, HIGH, CRITICAL<br>`check`: string — one of: FIRE_EXTINGUISHER, FIRST_AID<br>`nextDueOn`: string — YYYY-MM-DD<br>`keepOnRoad`: boolean — For a minor breakdown that does not take the vehicle off the road

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

`search`: string<br>`roleKey`: string — Deprecated — use ofRole. The server discards this name before the tool runs.<br>`ofRole`: string — one of: ADMIN, PRINCIPAL, TEACHER, FINANCE, LIBRARIAN, WARDEN, PARENT, STUDENT — Only users holding this role, e.g. TEACHER<br>`status`: string<br>`sectionId`: string<br>`limit`: integer — Only when the user asks for a number ("top 10", "first 5"); omit it to return everything

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Verification

### `get_verification_counts`

How many background verifications are in progress, awaiting the principal, not cleared, expired or due for re-check. Counts only, no person or finding. Read-only.

| | |
|---|---|
| **Operation** | GET |
| **Risk** | LOW |
| **Confirmation** | NOT_REQUIRED |
| **Permission** | `verification.read` |
| **Scope** | ALL |
| **Affects others** | No |
| **EduOS service** | `verification.service.stats()` |
| **Status** | AVAILABLE |
| **Audited** | Yes — `agent.get_verification_counts` |

**Input**

_(no arguments)_

**Output** — `{ success: true, data: { … } }`.

**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), `NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), `TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.

## Permission coverage

123 of the 184 permissions in the catalog are reachable through MCP.

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
- `leave.review` — Approve or reject leave applications
- `marks.publish` — Publish marks / report cards
- `fees.payments.refund` — Refund a fee payment
- `fees.plan.review` — Review a submitted installment plan and send it for admin approval
- `fees.plan.approve` — Approve, reject and publish student installment plans
- `profile.edit.review` — Approve or reject student profile edit requests
- `analytics.school.read` — View school-wide analytics
- `analytics.class.read` — View class-level analytics
- `analytics.child.read` — View a child's analytics
- `approvals.submit` — Raise an approval request
- `approvals.configure` — Configure approval stages, thresholds and delegations
- `governance.manage` — Schedule meetings, prepare agendas, record minutes, resolutions and actions
- `institution.manage` — Edit the institution profile, campuses, affiliations and terminology
- `org.manage` — Manage departments, positions, reporting lines and appointments
- `correspondence.manage` — Register, assign, draft replies to and dispatch correspondence
- `compliance.manage` — Prepare returns, track licences, publish policies, review notices and run trainings
- `contracts.read` — View agreements and their obligations
- `contracts.manage` — Draft, track and renew agreements
- `verification.manage` — Run background verification checks and attach evidence
- `verification.decide` — Give the final institutional clearance decision
- `events.manage` — Propose and run events, fests, meetings and visits
- `facilities.manage` — Manage facilities, confirm bookings and run work orders
- `safeguarding.report` — Report a safeguarding concern (you see only your own reports)
- `safeguarding.manage` — Designated officer: handle safeguarding, POCSO, POSH and anti-ragging cases
- `payroll.prepare` — Maintain pay structures and statutory rules; calculate payroll runs
- `payroll.approve` — Approve a calculated payroll run
- `payroll.sensitive.read` — See salary components and bank details of other employees
- `procurement.manage` — Run procurement: quotes, orders, receipts, invoices and payment status
- `budget.manage` — Prepare budgets and explain variances
- `funding.read` — View funding proposals, grants and loans
- `funding.manage` — Prepare funding proposals and compare offers
- `marketing.manage` — Plan campaigns and manage creative assets
- `community.post` — Draft newsroom stories and post in circles
- `community.moderate` — Review, publish, hide and take down posts and comments
- `mentoring.participate` — Offer or request mentoring from seniors and alumni
- `messaging.read` — View the outbound message log and delivery states
- `messaging.manage` — Configure message templates and send operational notifications
- `analytics.export` — Download analytics tables as CSV or PDF (exports respect the same scope as the screen)
- `camera.devices.manage` — Register cameras, approved locations and purposes, retention and health
- `alumni.manage` — Verify alumni, manage batches, reunions and transitions to alumni access
- `digest.manage` — Choose approved sources and review digest items before they are published
- `social.connect` — Connect and disconnect the school's social media accounts
- `supportplans.read` — See student support plans (OWN: students you teach or plans you own; families: the plan summary and goals for their own child, never internal notes)
- `supportplans.manage` — Open and run student support plans: goals, actions, reviews and closure (OWN: students you teach)
- `supportplans.referral.view` — See whether a support plan was referred to safeguarding (the flag only; the case stays in safeguarding)
- `portfolios.read` — See competency portfolios (OWN: students you teach, your own child, or yourself)
- `portfolios.manage` — Add evidence and rubric ratings to competency portfolios (OWN: students you teach)
- `portfolios.reflect` — Write your own reflections in your competency portfolio
- `scenarios.read` — See saved what-if projections (enrolment, fees, staffing, transport, budget)
- `scenarios.manage` — Create, edit and compare what-if projections

