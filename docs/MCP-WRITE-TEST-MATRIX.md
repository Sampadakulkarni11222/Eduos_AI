# EduOS MCP — Write-Tool Test Matrix

> Generated from `backend/tests/mcp.writes.coverage.test.js` results. A ✓ means that test ran and passed
> for that tool in the recorded run; nothing here is asserted by hand.

Every write tool is entered **through MCP** — `executeToolCall` via an MCP session, the same server path the
MCP client uses — as a person built exactly as the auth middleware builds them, against the real services and a
real MongoDB. Columns:

- **MCP test** — proposed (where confirmation is required), confirmed, executed; the database footprint changed as expected (**DB verified**); the MCP server wrote an `EXECUTED` audit entry for that person with the right `confirmed` flag (**Audit verified**).
- **Authorization** — a role that lacks the permission (found from the live permission map) is refused `FORBIDDEN`; no proposal; nothing written.
- **Wrong scope** — a holder of the permission acting outside their own records (a second teacher, a parent for another child, an OWN-scoped holder of a school-wide tool) is refused; nothing written.
- **Wrong school** — a Riverside administrator naming Oakridge records is refused; nothing written in Oakridge. "—" where the tool names no existing record (creating in one's own school is legitimate).
- **Confirmation battery** — high-risk tools only: direct call proposes only; bogus token, token for another tool, expired, another user, another school and permission-removed are all refused with nothing written; two simultaneous confirmations run exactly once; the spent token does nothing.

| Module | Tool | Operation | Risk | Role | MCP test | DB verified | Audit verified | Authorization | Wrong scope | Wrong school | Confirmation battery |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Academics | `assign_teacher_to_subject` | ACTION | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Academics | `create_section` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Academics | `update_section` | UPDATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Academics | `update_subject_offering` | UPDATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Admissions | `create_admission_lead` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Admissions | `update_admission_lead — approve (ENROLLED)` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Admissions | `update_admission_lead — reject (LOST)` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | covered by the approve case |
| Assignments | `create_assignment` | CREATE | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Assignments | `generate_homework` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ NOT_FOUND | ✓ NOT_FOUND | n/a (not high-risk) |
| Assignments | `grade_submission` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Assignments | `submit_assignment` | ACTION | MEDIUM | STUDENT | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Attendance | `bulk_mark_attendance` | ACTION | HIGH | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ INVALID_INPUT | ✓ |
| Attendance | `mark_attendance` | ACTION | HIGH | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ NOT_FOUND | ✓ NOT_FOUND | ✓ |
| Communication | `create_announcement` | CREATE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | — | — | ✓ |
| Communication | `create_calendar_event` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN_SCOPE | — | n/a (not high-risk) |
| Communication | `notify_users` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN_SCOPE | ✓ NOT_FOUND | ✓ |
| Communication | `send_whatsapp_message` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN_SCOPE | — | ✓ |
| Documents | `delete_document` | DELETE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | ✓ |
| Exams | `create_exam` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Exams | `create_exam_subject` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Exams | `enter_marks` | ACTION | HIGH | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | ✓ |
| Exams | `publish_marks` | ACTION | HIGH | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | ✓ |
| Fees | `approve_payment` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `create_fee_plan` | CREATE | HIGH | FINANCE | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `create_invoice` | CREATE | HIGH | FINANCE | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `decide_payment_change_request` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `generate_invoices` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `publish_fee_plan` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `record_payment` | ACTION | HIGH | FINANCE | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | ✓ FORBIDDEN_SCOPE | ✓ NOT_FOUND | ✓ |
| Fees | `refund_payment` | ACTION | HIGH | FINANCE | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ FORBIDDEN | ✓ |
| Fees | `reject_payment` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `transition_fee_plan` | ACTION | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | ✓ FORBIDDEN | ✓ NOT_FOUND | ✓ |
| Fees | `update_fee_plan` | UPDATE | HIGH | FINANCE | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Fees | `update_payment` | UPDATE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Hostel | `allocate_hostel_bed` | ACTION | MEDIUM | WARDEN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Hostel | `create_hostel_inquiry` | CREATE | MEDIUM | WARDEN | ✓ (no confirmation by policy) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Hostel | `create_hostel_room` | CREATE | MEDIUM | WARDEN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Hostel | `update_hostel_inquiry` | UPDATE | MEDIUM | WARDEN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Hostel | `update_hostel_room` | UPDATE | MEDIUM | WARDEN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Hostel | `vacate_hostel_bed` | ACTION | MEDIUM | WARDEN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Leave | `apply_for_leave` | CREATE | MEDIUM | STUDENT | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Leave | `review_leave` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Library | `create_book` | CREATE | MEDIUM | LIBRARIAN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Library | `delete_book` | DELETE | HIGH | LIBRARIAN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Library | `issue_book` | ACTION | MEDIUM | LIBRARIAN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Library | `return_book` | ACTION | MEDIUM | LIBRARIAN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Library | `update_book` | UPDATE | MEDIUM | LIBRARIAN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Medical | `remove_medical_record` | DELETE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | ✓ NOT_FOUND | ✓ NOT_FOUND | ✓ |
| Medical | `upsert_medical_record` | UPDATE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | ✓ NOT_FOUND | ✓ NOT_FOUND | ✓ |
| Registrations | `decide_registration` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Registrations | `register_for_elective` | CREATE | MEDIUM | STUDENT | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Registrations | `withdraw_elective_registration` | DELETE | MEDIUM | STUDENT | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Student requests | `decide_cocurricular` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Student requests | `decide_profile_edit` | ACTION | MEDIUM | TEACHER | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ FORBIDDEN | ✓ NOT_FOUND | n/a (not high-risk) |
| Student requests | `request_cocurricular` | CREATE | MEDIUM | STUDENT | ✓ (no confirmation by policy) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Student requests | `request_profile_edit` | CREATE | MEDIUM | STUDENT | ✓ (no confirmation by policy) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Students | `anonymise_student` | DELETE | CRITICAL | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Students | `archive_student` | DELETE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Students | `create_student` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Students | `enroll_student` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Students | `update_enrollment_status` | UPDATE | HIGH | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | ✓ |
| Students | `update_student` | UPDATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Tickets | `create_ticket` | CREATE | MEDIUM | PARENT | ✓ (no confirmation by policy) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Tickets | `reply_to_ticket` | ACTION | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ PARENT refused | ✓ NOT_FOUND | ✓ NOT_FOUND | n/a (not high-risk) |
| Tickets | `update_ticket` | UPDATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Timetable | `upsert_timetable_slot` | UPDATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Transport | `create_transport_route` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | — | n/a (not high-risk) |
| Transport | `create_transport_stop` | CREATE | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |
| Transport | `enroll_in_transport` | ACTION | MEDIUM | ADMIN | ✓ (confirmed) | ✓ | ✓ | ✓ TEACHER refused | — | ✓ NOT_FOUND | n/a (not high-risk) |

**68 write tools; 68 executed through MCP with database and audit verification; 69 matrix rows complete (executed + outsider refused).**

### Execution notes

- `send_whatsapp_message` is executed against a stubbed Meta Graph API (live mode, `fetch` replaced): the test proves exactly one request to exactly the confirmed number with exactly the confirmed text. A real delivery is checked on staging (MCP-STAGING-TEST-PLAN.md W8/A7).
- `generate_homework` runs with `AI_PROVIDER=rules`, so the homework is created without an AI-written description (the tool says so in its confirmation). With a model configured the description is generated; creation, scope and audit are the same.
- `anonymise_student` is executed (it is irreversible, and the test database is disposable).
- `generate_invoices` in another school's session runs and bills nobody in this school — it names only an academic year, which is not found there; the test asserts Oakridge's invoices are unchanged.
