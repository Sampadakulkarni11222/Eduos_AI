# Access & Permissions — how every role's tabs are gated

> **ERP feature: Role-Based Access Control (RBAC).**
> EduOS AI gives each of its nine roles a dedicated portal, and decides what each
> person can see and do from a single, database-backed permission matrix that is
> enforced on the server for every request. A tab that a role may not use is
> hidden from its sidebar, refused if opened by URL, and — independently of both —
> refused by the API behind it.

This document describes how that works, tab by tab, for every role. It is written
from the code as it stands; the file each rule lives in is named so it can be
checked.

---

## 1. The feature at a glance

| Capability | What it means |
|---|---|
| **Nine role portals** | Super Admin, Admin, Principal, Teacher, Parent, Student, Finance, Librarian, Warden — each with its own sidebar, theme and home dashboard. |
| **Granular permission keys** | About 90 keys such as `fees.read`, `attendance.mark`, `marks.publish`, grouped by area (admin, students, academics, fees, communication, support, sensitive, admissions, library, hostel, transport, AI, analytics). |
| **Two data scopes per grant** | `ALL` = the whole school. `OWN` = only the teacher's own classes, the parent's own children, or the student's own record. |
| **Server-enforced** | Every API route checks the permission key. The browser only mirrors the server's answer; nothing client-side can grant access. |
| **Live permission matrix** | The *Access & Permissions* screen shows roles × permissions with on/off toggles and an ALL/OWN switch. Changes save instantly and apply on the next request. |
| **Separation of duties** | "Prepare" and "approve" are different keys held by different roles (Finance prepares a payment plan, Admin approves it; a school requests seats, the platform approves them). |
| **Multi-school isolation** | Each school's data is filtered by tenant on every query. A school-level user cannot read another school, whatever the URL or headers say. |
| **Multi-profile accounts** | One login can hold several role profiles (e.g. Parent *and* Teacher). Permissions always follow the profile that is currently selected. |
| **Audit trail** | Sensitive reads and changes are written to the Audit Logs tab. |

---

## 2. How access is decided

A request passes four independent checks. Failing any one of them stops it.

```
 Sign in ──► pick profile ──► role ──► permission map { key: ALL | OWN }
                                              │
   ┌──────────────────────────────────────────┼─────────────────────────────────────────┐
   ▼                                          ▼                                         ▼
1. PORTAL GUARD                     2. TAB GUARD                            3. API GUARD
   Is this your role's portal          Does your role hold the key             requirePermission(key, minScope)
   and your own school?                mapped to this tab?                     on every backend route
   No → redirected to your             No → tab hidden in sidebar;             No → HTTP 403
   own portal home                     "Access Denied" if opened by URL
                                                                                        │
                                                                                        ▼
                                                                            4. SCOPE + TENANT FILTER
                                                                               OWN → only your classes /
                                                                               children / record
                                                                               Always → only your school
```

| # | Check | Where it lives | What it does |
|---|---|---|---|
| 1 | **Portal guard** | `frontend/src/components/shell.tsx` (`PortalShell`) | Each role maps to exactly one portal (`ROLE_TO_SLUG` in `frontend/src/lib/portals.ts`). A teacher who opens `/admin/...` is redirected to the teacher home. So is a user who opens another school's address. |
| 2 | **Tab guard** | `frontend/src/lib/permissions.tsx` (`ROUTE_PERMISSIONS`) | Tabs listed there need a specific key. Without it the sidebar item is hidden and the page shows *Access Denied*. Tabs not listed are shown to everyone in that portal and rely on checks 1 and 3. |
| 3 | **API guard** | `backend/src/middleware/permission.js` | `requirePermission(key)` rejects with 403 if the role lacks the key. `requirePermission(key, 'ALL')` also rejects an `OWN` grant, for school-wide reports. `requireRole(...)` additionally limits role-specific screens such as dashboards. |
| 4 | **Scope and tenant** | services + `backend/src/tenancy/` | The granted scope (`req.scope`) narrows the rows returned, and every school-owned collection is filtered to the caller's school. |

The permission map is built from the database on **every** request
(`backend/src/middleware/auth.js`), so a change made in the matrix takes effect
immediately for API calls. The browser refreshes its copy from `/auth/me`, so
sidebar changes appear on the next page load or sign-in.

---

## 3. Who can change permissions

| Action | Super Admin | School Admin | Everyone else |
|---|---|---|---|
| Open *Access & Permissions* (needs `roles.manage`) | Yes — editable | Yes — **read-only** | No (tab hidden, API 403) |
| Toggle a permission or switch ALL/OWN on a system role | Yes | No | No |
| Grant or revoke platform keys (`schools.*`, `seats.manage`, `seats.approve`, `seats.pricing.manage`, `customization.manage`, `domains.manage`) | Yes | No | No |
| Modify the Super Admin role itself | Yes | No | No |
| Create / rename / delete permission keys (`permissions.manage`) | Yes | No | No |
| Delete or rename a system role or system permission | No — protected for everyone | No | No |

Why a School Admin is read-only: the nine system roles are shared by every school
on the platform. Editing "Teacher" in one school would change it for all of them,
so the server (`backend/src/modules/roles/role.service.js`, `assertMayGovern`)
allows only the Super Admin to change them.

---

## 4. Role summary

| Role | Portal | Default reach | In one line |
|---|---|---|---|
| **Super Admin** | `/super-admin` | Platform — all schools | Every key except the AI assistant (`ai.copilot.use`). Onboards schools, sells seats, sets pricing, branding and domains, governs roles. Can open any school's portal in "platform view". |
| **Admin** | `/{school}/admin` | Whole school (`ALL`) | Every key except `permissions.manage`, `fees.payments.refund` and the platform keys. Runs daily operations and holds the approval keys. |
| **Principal** | `/{school}/principal` | Whole school (`ALL`) | Oversight: read across academics, fees, staff and audit; can publish marks and announcements, manage timetable, calendar and tickets. Cannot manage users or fees. |
| **Teacher** | `/{school}/teacher` | Own classes (`OWN`) | Attendance, assignments, quizzes, marks, materials and reviews for the sections they teach. |
| **Parent** | `/{school}/parent` | Own children (`OWN`) | Read their children's records, pay fees, manage medical details, raise tickets. |
| **Student** | `/{school}/student` | Own record (`OWN`) | Read their own records, submit work, take quizzes, pay fees, raise requests. |
| **Finance** | `/{school}/finance` | Whole school (`ALL`) | Fee structures, invoices, payments, refunds, plan drafting and review. **Cannot approve** plans or payments. |
| **Librarian** | `/{school}/librarian` | Whole school (`ALL`) | Catalogue, lending, book requests, notes and question papers. |
| **Warden** | `/{school}/warden` | Whole school (`ALL`) | Hostel rooms and allocations, read-only medical lookup, tickets. |

Defaults are defined in `backend/src/constants/permissions.js` (`SYSTEM_ROLES`).
The live database is the source of truth, so a deployment whose matrix has been
edited may differ from the tables below.

---

## 5. Tab-by-tab access

How to read the tables:

- **Tab guard** — the key the frontend checks before showing the tab. "—" means
  the tab is shown to everyone in that portal and is protected by the portal
  guard and the API guard only.
- **API permission** — the key(s) the backend checks for the data on that tab.
- **Scope** — what the role's default grant lets it see.
- **Can do** — view only, or which actions are available.

Common to every portal: **User Guide** needs no permission. The **notification
bell** needs only a signed-in profile. The **Ask Agent** button needs
`ai.copilot.use`.

### 5.1 Super Admin — Platform Administration

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | platform aggregates | All schools | View |
| Schools & Admins | `schools.read` | `schools.read`, `schools.manage` | All schools | Create/edit schools and their School Admin accounts |
| Seat Management | `seats.manage` | `seats.manage`, `seats.approve` | All schools | Sell seats, approve/reject extra-seat requests |
| Per-Seat Pricing | `seats.pricing.manage` | `seats.pricing.manage` | All schools | Set and version each school's seat price |
| School Customization | `customization.manage` | `customization.manage` | All schools | Theme, branding, dropdown values per school |
| Domain Management | `domains.manage` | `domains.manage` | All schools | Configure, verify, activate subdomain / custom domain |
| School Dashboards | `analytics.school.read` | dashboard routes + role check | One school at a time | View operations / finance / hostel / library dashboards |
| Audit Logs | `audit.read` | `audit.read` | All schools | View |
| Access & Permissions | `roles.manage` | `roles.manage`, `permissions.manage` | Platform | **Edit** the role × permission matrix |

All seven platform keys above are reserved (`SUPER_ADMIN_ONLY`); no school-level
role can be granted them by a School Admin. The Super Admin deliberately has no
AI assistant, because it is not confined to one school.

### 5.2 Admin — Admin Console

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `students.read` (school-wide) + role check | ALL | View |
| Tickets | — | `tickets.read`, `tickets.manage`, `tickets.respond` | ALL | Reply, assign, close |
| User Management | `users.manage` | `users.read`, `users.manage` | ALL | Create, edit, deactivate, bulk import |
| Student Classes | — | `students.read`, `students.manage`, `enrollments.manage` | ALL | Add students, assign sections |
| Teacher Classes | — | `academics.read` | ALL | View |
| Admission CRM | `admissions.read` | `admissions.read`, `admissions.manage` | ALL | Manage leads and pipeline |
| Medical Records | `medical.read` | `medical.read`, `medical.manage` | ALL | View and update |
| Classroom Mgmt | — | `academics.read`, `academics.structure.manage` | ALL | Manage grades, sections, subjects, offerings, terms |
| Subject Registrations | — | `registrations.review` | ALL | Approve / reject electives |
| Attendance | — | `attendance.read` (+ `attendance.regularize`) | ALL | View, correct |
| Calendar & Events | — | `calendar.read`, `calendar.manage` | ALL | Create events |
| Timetable Builder | — | `timetable.read`, `timetable.manage` | ALL | Edit slots |
| Payments & Fees | `fees.read` | `fees.*` incl. `fees.plan.approve`, `fees.payments.approve` | ALL | Invoices, record payments, **approve** plans and payments. No refund key by default. |
| Announcements | — | `announcements.read`, `announcements.publish` | ALL | Publish |
| Library Books | — | `library.read`, `library.manage` | ALL | Catalogue, issue, return |
| Transport Routes | — | `transport.read`, `transport.manage` | ALL | Routes, stops, enrolments |
| Transport Requests | — | `transport.manage` | ALL | Approve / reject |
| Documents | — | `materials.read`, `materials.manage` | ALL | Upload, delete |
| Document Requests | `students.manage` | `students.manage` (school-wide) | ALL | Review, approve, issue |
| Document Types | `settings.manage` | `settings.manage` | ALL | Configure |
| Audit Logs | `audit.read` | `audit.read` | ALL | View |
| Access & Permissions | `roles.manage` | `roles.manage` | — | **View only** |
| Seats | `seats.read` | `seats.read`, `seats.request` | Own school | View usage, request and pay for extra seats (cannot approve) |
| Tenant Settings | `settings.manage` | `settings.manage`, `domains.read` | Own school | View school configuration and domain |

### 5.3 Principal — Leadership

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| School Intelligence | — | `fees.read`, `users.read`, `ai.insights.read` | ALL | View |
| Performance & Risk | — | `ai.insights.read`, `academics.read` | ALL | View risk scan |
| Teacher Workload | — | `academics.read` | ALL | View |
| Attendance Trends | — | `attendance.read` | ALL | View |
| Fee Health | `fees.read` | `fees.read` | ALL | View only |
| Staff Directory | — | `users.read` | ALL | View only |
| Announcements | — | `announcements.read`, `announcements.publish` | ALL | Publish |
| Escalated Tickets | — | `tickets.read`, `tickets.manage` | ALL | Assign, close |
| Audit Logs | `audit.read` | `audit.read` | ALL | View |

### 5.4 Teacher — Teacher Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `timetable.read` + role check | OWN | View |
| My Classes | — | `students.read` | OWN | View students in own sections |
| Attendance | — | `attendance.read`, `attendance.mark` | OWN | Mark, bulk mark |
| Timetable | — | `timetable.read` | OWN | View |
| Assignments | — | `assignments.read`, `assignments.manage`, `submissions.grade` | OWN | Create, grade |
| Quizzes | — | `assignments.manage`, `submissions.grade` | OWN | Build, publish, see results |
| Exams & Performance | — | `marks.read`, `marks.enter`, `marks.publish` | OWN | Enter and publish marks |
| Course Material | — | `materials.read`, `materials.manage` | OWN | Upload, edit, delete |
| Announcements | — | `announcements.read` (ALL), `announcements.publish` (OWN) | OWN to publish | Publish to own classes |
| Calendar | — | `calendar.read` (ALL), `calendar.manage` (OWN) | OWN to manage | Add events |
| Parent Queries | — | `tickets.read`, `tickets.respond` | OWN | Reply |
| Subject Registrations | — | `registrations.review` | OWN | Approve / reject for own sections |
| Student Requests | `cocurricular.review` | `cocurricular.review`, `profile.edit.review` | OWN | Approve / reject as class teacher |
| Leave Requests | — | `leave.read`, `leave.review` | OWN | Approve / reject |
| Medical Records | `medical.read` | `medical.read` | OWN | **View only** |
| Transport | — | role-scoped roster (no key) | OWN | View only |

### 5.5 Parent — Parent Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `students.read` + role check | OWN | View |
| Performance | — | `marks.read`, `reportcards.read` | OWN | View, download report card |
| Student View | — | `students.read`, `ai.insights.read` | OWN | View — see note 1 |
| Attendance | — | `attendance.read` | OWN | View |
| Assignments | — | `assignments.read` | OWN | View |
| Timetable | — | `timetable.read` | OWN | View |
| Course Material | — | `materials.read` | OWN | View |
| Study Help | — | `ai.copilot.use` | OWN | Use AI tutor |
| Calendar & Events | — | `calendar.read` | ALL | View |
| Announcements | — | `announcements.read` | ALL | View |
| Medical Records | `medical.read` | `medical.read`, `medical.manage` | OWN | View and **update** own child's record |
| Library | — | `library.read` | — | See note 1 |
| Transport | — | role-scoped "my bus" (no key) | OWN | View |
| Payments | — | `fees.read`, `fees.pay` | OWN | Pay own invoices online |
| AI Credits | — | `ai.copilot.use` | OWN | Buy credits |
| Documents | — | `materials.read` | OWN | View, download |
| Support | — | `tickets.read`, `tickets.create` | OWN | Raise and follow tickets |

### 5.6 Student — Student Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `attendance.read` + role check | OWN | View |
| Subject Registration | — | `registrations.apply` | OWN | Register, withdraw |
| Timetable | — | `timetable.read` | OWN | View |
| Assignments | — | `assignments.read`, `submissions.submit` | OWN | Submit, resubmit |
| Quizzes | — | `submissions.submit` + student-only role check | OWN | Take quizzes |
| Performance | — | `marks.read`, `reportcards.read` | OWN | View |
| Attendance | — | `attendance.read` | OWN | View |
| Course Material | — | `materials.read` | OWN | View |
| Study Help | — | `ai.copilot.use` | OWN | Use AI tutor |
| Calendar & Events | — | `calendar.read` | ALL | View |
| Announcements | — | `announcements.read` | ALL | View |
| Library | — | `library.read`, `library.request` | OWN | Browse, request a book |
| Library Notes / Question Papers | — | `library.read` | OWN | View |
| Transport | — | `transport.request` | OWN | Request / cancel a route |
| Documents | — | `materials.read` | OWN | View, download |
| Payments | — | `fees.read`, `fees.pay` | OWN | Pay own invoices |
| AI Credits | — | `ai.copilot.use` | OWN | Buy credits |
| My Profile | — | `students.read`, `cocurricular.request`, `profile.edit.request` | OWN | Request corrections, activities, documents |
| Help & Support | — | `tickets.read`, `tickets.create` | OWN | Raise and follow tickets |

### 5.7 Finance — Finance Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `fees.read` (school-wide) + role check | ALL | View |
| Payments & Fees | `fees.read` | `fees.read`, `fees.manage`, `fees.pay`, `fees.structure.manage`, `fees.plan.request`, `fees.plan.review`, `fees.payments.refund` | ALL | Invoices, record payments, refund, draft and review plans. Approval goes to Admin. |
| Reports | `fees.read` | `fees.read` | ALL | View |

### 5.8 Librarian — Library Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `library.read` + role check | ALL | View |
| Catalog & Lending | — | `library.read`, `library.manage` | ALL | Add books, issue, return |
| Book Requests | — | `library.manage` | ALL | Approve / reject |
| Library Notes / Question Papers | — | `library.read`, `library.manage` | ALL | Manage shelves |
| Announcements | — | `announcements.read` | ALL | View only |
| Support Tickets | — | `tickets.read`, `tickets.respond` | ALL | Reply |

### 5.9 Warden — Hostel Portal

| Tab | Tab guard | API permission | Scope | Can do |
|---|---|---|---|---|
| Dashboard | — | `hostel.read` + role check | ALL | View |
| Room Management | `hostel.read` | `hostel.read`, `hostel.manage` | ALL | Create rooms, allocate, vacate |
| Hostel Students | `hostel.read` | `hostel.read`, `students.read` | ALL | View |
| Medical Records | `medical.read` | `medical.read` | ALL | **View only** |
| Announcements | — | `announcements.read` | ALL | View only |
| Support Tickets | — | `tickets.read`, `tickets.manage`, `tickets.respond` | ALL | Reply, assign, close |

**Note 1 — two Parent tabs to verify.** With the default grants, the Parent role
does not hold `library.read` (needed by the Library tab's book and issue lists) or
`ai.insights.read` (needed by Student View's growth score). The tabs appear in the
sidebar because neither has a tab guard, but the API would answer 403 unless those
keys have been granted in the live matrix. This was read from the code, not
tested against a running system.

---

## 6. Built-in separation of duties

| Workflow | Prepares / requests | Approves | Enforced by |
|---|---|---|---|
| Student installment plan | Finance (`fees.plan.request`, `fees.plan.review`) | Admin (`fees.plan.approve`) | Finance is never granted the approve key |
| Fee payment record | Finance records (`fees.pay`) | Admin (`fees.payments.approve`) | Payment stays pending until approved |
| Refund | Finance (`fees.payments.refund`) | — | Admin does not hold the refund key by default |
| Extra seats | School Admin (`seats.request`) | Super Admin (`seats.approve`) | Approve key is platform-only |
| Per-seat price | — | Super Admin (`seats.pricing.manage`) | A school can see its rate, never set it |
| Elective registration | Student (`registrations.apply`) | Teacher / Admin / Principal (`registrations.review`) | Separate keys |
| Co-curricular and profile corrections | Student (`*.request`) | Class teacher / Principal (`*.review`) | Separate keys |
| Leave | Student (`leave.apply`) | Teacher / Principal (`leave.review`) | Separate keys |
| Book issue | Student (`library.request`) | Librarian (`library.manage`) | Separate keys |
| Transport seat | Student (`transport.request`) | Admin (`transport.manage`) | Separate keys |
| Medical record | Parent / Admin edit (`medical.manage`) | — | Teacher and Warden are read-only (`medical.read`) |

---

## 7. Changing what a role can access

1. Sign in as **Super Admin** and open **Access & Permissions**.
2. Find the permission row (grouped by area) and the role column.
3. Switch the toggle on or off. On a granted cell, click the `ALL` / `OWN` label
   to change scope.
4. The change is saved immediately and enforced on the user's next API call. The
   sidebar updates when they next load the app.

To put a tab behind a permission in the UI, add its route to `ROUTE_PERMISSIONS`
in `frontend/src/lib/permissions.tsx`. The backend route must carry the matching
`requirePermission(...)`, since the frontend entry only hides the tab.

If a user sees **Access Denied** or every request returns 403, their role lacks
that key — check the matrix.

---

## 8. Source files

| Concern | File |
|---|---|
| Permission catalogue and default role grants | `backend/src/constants/permissions.js` |
| Token → profile → permission map, tenant scope | `backend/src/middleware/auth.js` |
| `requirePermission`, `requireRole` | `backend/src/middleware/permission.js` |
| Who may edit roles | `backend/src/modules/roles/role.service.js` |
| Sidebar tabs per portal | `frontend/src/lib/portals.ts` |
| Tab → permission map, `hasAccess` | `frontend/src/lib/permissions.tsx` |
| Portal guard, Access Denied screen | `frontend/src/components/shell.tsx` |
| Permission matrix UI | `frontend/src/components/access-permissions.tsx` |
