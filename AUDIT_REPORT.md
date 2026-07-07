# EduOS AI — Phase A Application Audit Report
_Audited: 2026-07-06 · Source: `Eduos-AI/Frontend/web` (Next.js 14 App Router) + `Eduos-AI/eduOs_backend` (Express/Mongoose)_

---

## A1. Codebase Summary

### Frontend (`Frontend/web/src`)
- **Structure**: App Router; 9 role portals (`admin, owner, teacher, parent, student, principal, finance, librarian, warden`) with ~85 pages, shared `PortalShell` (sidebar/topbar/guards), shared views (`tickets-view`, `announcements-view`, `calendar-view`, `timetable-grid`, `ask-eduos`, `access-permissions`), `lib/` (typed `api.ts` client with refresh rotation, `auth.tsx` context, `permissions.tsx`, `portals.ts` nav registry, `types.ts`).
- **Auth/session**: access token in memory, refresh token in localStorage, single-flight refresh; `AuthProvider.reload()` → `/auth/me`.
- **Data fetching**: per-page `useEffect` + `useState`; no cache layer.
- **Uploads**: URL-paste only (documents, course material).
- **AI/WhatsApp**: `ask-eduos` panel → `/ai/chat`; WhatsApp phone-frame simulator → `/whatsapp/simulate`.

### Backend (`eduOs_backend/src`)
- 29 route modules under `/api/v1`; JWT auth middleware resolves actor + role permission map; `requirePermission(key)` sets `req.scope` (ALL/OWN); services enforce OWN scoping (teacher sections, guardian children, own student record).
- **RBAC is real and DB-backed**: `permissions` + `roles` collections seeded from `constants/permissions.js`; `/auth/me` returns a resolved permission map. Roles API supports assign/revoke grants.
- **Dashboard module**: full per-role dashboard endpoints (`/dashboard/{owner,admin,finance,teacher,student,parent,warden,librarian}`) with a 27 KB aggregation service — **completely unused by the frontend**.
- **Hostel module**: full rooms/allocations/vacate/students/medical/inquiries API — **unused by the warden portal**.
- AI + WhatsApp are documented stand-ins; OTP logs to server console (`devOtp` returned outside production).

### Major technical risks found
1. **Security hole (P0)**: `app/api/auth/google-exchange/route.ts` and `app/api/otp/email/route.ts` "authenticate" by **brute-forcing hardcoded demo passwords** (`ChangeMe@123!`, `password123`) against `/auth/login`. Anyone who knows a user's email can obtain real tokens via the mock Google popup.
2. **Multi-profile login is broken (P0)**: when login returns `requiresProfileSelection`, `select-profile/page.tsx` renders only a spinner (no picker), `loginProfiles` is never populated, and `/auth/me` 403s → redirect loop back to `/login`.
3. **Global rate limit 100 req/15 min per IP** on `/api` — a handful of dashboard visits exhausts it; subsequent pages hang/fail. This is the primary cause of the reported "loading issues".
4. **Client-only permissions**: `lib/permissions.tsx` grid is localStorage-only, uses invented keys that don't exist on the backend; a user can unlock any gated page via devtools. Backend permission map is ignored.
5. `useAfterLogin` reads stale `me` from closure → always falls back to `/` (extra hop; masks profile-selection bug).

## A2. Static / Dead Functionality Report

| Portal / Page | Issue |
|---|---|
| Sidebar (all portals) | Hardcoded fake badges (Tickets "3", Admissions "6", Assignments "2", Announcements "1", Risk "12") |
| Admin sidebar | "Classroom Mgmt" permanently disabled (`ready:false`) pointing to non-existent `/admin/classrooms` |
| Admin dashboard | "Admissions Pipeline" stat card static "—  see CRM"; stat cards not clickable |
| Parent dashboard | "Subjects" and "Pending Tasks" cards static "—  after setup"; backend parent dashboard endpoint would fill both |
| Warden → Room Management | **Entire CRUD is localStorage-only** (`eduos.warden.rooms`) with seeded fake rooms, while a full backend hostel API exists. "Clear All Allocations" wipes local data only |
| Warden dashboard / students | Only fetch tickets/students; ignore `/hostel/summary`, `/hostel/students`, `/dashboard/warden` |
| Admin/Owner → Access & Permissions | Toggle grid persists to localStorage only; invented permission ids; "Save Changes" is a fake save w.r.t. the server |
| Student/Parent → Assignments | Read-only table; **no submission UI** although backend supports submit/grade; no submission status column |
| Teacher → Assignments | No visibility into submissions; no grading UI despite `/assignments/grade` |
| Parent → Payments | Read-only invoice list; no "Pay Now" although parent holds `fees.pay` |
| Login → Google | Fake Google popup (`google-mock-auth`) listing seed users; insecure email-only exchange |
| Login → Phone/Email OTP | User-facing copy says "Check the **backend terminal** for your OTP code" |
| Documents / Course material | "File URL" paste field only — no actual upload |
| AssignmentDto mismatch | Backend list omits `class`, `maxMarks`, `submissionCount` that the UI renders → permanent "—" cells |

## A3. Broken / Incomplete Flow Report
1. Multi-profile login loop (see A1-2).
2. Google OAuth: no backend `/auth/google`; NextAuth jwt callback calls it and gets 404 → `USER_NOT_FOUND` even for valid users; mock fallback is insecure.
3. Email OTP: OTP generated/stored in the Next.js process, then "authenticates" by guessing passwords — fails for any account with a real password.
4. Error-code mapping in login (`OTP_WRONG` etc.) never matches — backend errorHandler returns `{ success:false, message }` without codes; users see generic errors.
5. Assignment submissions: `POST /assignments/submit` trusts client-supplied `enrollmentId` (student could submit as another student); no GET for submissions.
6. Permissions: page gating uses spoofable localStorage; sidebar visibility likewise.
7. Payments: no online payment path or gateway abstraction.
8. Hostel: warden flows never persist.
9. Library model/DTO mismatches handled by mapper (OK), but `dashboard.service.getStudentDashboard` queries `BookIssue.dueDate/fineAmount` fields directly — consistent with model (OK).

## A4. Performance & Loading Issue Report
1. **Rate limiter 100 req/15 min** on all of `/api` (see A1-3) — the dominant cause of pages hanging.
2. Dashboards fire 3–5 parallel requests each; per-role `/dashboard/*` endpoints exist but unused (admin: students+tickets+announcements; teacher: 4 fetches + N timetable fetches; owner: 4).
3. Teacher dashboard fetches timetable per section serially after sections load.
4. `fees.getSummary` loads **all invoices** into memory to sum (no aggregate).
5. `assignments.list` populates offerings per row but the controller discards most fields (wasted populate) and omits fields the UI needs.
6. Unbounded list endpoints (`/students` capped at 50 with cursor — OK; `/fees/invoices`, `/tickets`, `/announcements` unbounded).
7. No stale-response guards on pages that refetch on filter change (attendance roster race).

## A5. Priority Fix Plan
- **P0** — token-leak security hole (google-exchange/email-OTP password guessing); multi-profile login loop; backend-trusted permissions for UI gating; rate-limiter starvation; assignment `enrollmentId` trust; warden localStorage CRUD → real hostel API; assignment submission flow (student submit / teacher grade / parent view); real file upload path.
- **P1** — wire per-role dashboard endpoints + fill placeholder cards + drill-downs; backend `/auth/google` + backend email OTP with provider abstraction; login UX (dev OTP surfaced in UI, real error messages); permissions editor persisted to roles API; parent "Pay Now" via payment-provider abstraction (sandbox mode, real ledger write); assignment DTO completion; remove fake badges.
- **P2** — replace `alert()` with toast notifications; aggregate fee summary; loading/race guards; responsive/table overflow checks; empty states (mostly present).
- **P3** — AI service upgraded to data-grounded scoped answers + LLM provider hook; WhatsApp provider contract + explicit simulation labeling; SMS/email provider env contract; docs.
