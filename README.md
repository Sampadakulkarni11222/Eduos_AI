# EduOS AI — AI-native School ERP

EduOS AI is a multi-portal School/College ERP: one platform with dedicated, role-scoped portals for **Super Admin, Admin, Principal, Teacher, Parent, Student, Finance, Librarian, and Hostel Warden**, plus an AI copilot and agentic assistant, AI-powered tutoring (Study Help), WhatsApp assistant (simulation mode), online fee payments, file uploads, in-app notifications, student leave management, and a fully backend-enforced RBAC system.

---

## 1. Repository layout

```
Eduos-AI/
├── backend/                ← Express + MongoDB REST API   (the entire backend)
│   ├── src/
│   │   ├── app.js              server bootstrap (helmet, CORS, Brotli/Gzip compression, rate limits, /uploads static)
│   │   ├── config/             env, db, swagger
│   │   ├── constants/          permission catalog, system roles, demo users
│   │   ├── middleware/         auth (JWT), requirePermission, rate limiters, error handler
│   │   ├── models/             Mongoose schemas (students, fees, assignments, hostel, …)
│   │   ├── modules/            one folder per domain: routes + controller + service
│   │   ├── providers/          swappable integrations: notification (SMS/email OTP), payment, AI
│   │   ├── routes/             top-level router that mounts all modules
│   │   ├── seed/               seed.js (roles/permissions/demo users) + migrate.js (demo data)
│   │   ├── tenancy/            AsyncLocalStorage scope + Mongoose plugin for per-school data isolation
│   │   └── utils/              jwt, otp, crypto, scope resolution, response helpers
│   ├── uploads/                uploaded files (served at /uploads/…)
│   └── .env                    backend configuration
│
├── frontend/               ← Next.js 15 App Router frontend  (the entire frontend)
│   ├── src/
│   │   ├── app/                one folder per portal: admin/ teacher/ parent/ student/ …
│   │   │   ├── (auth)/         login + select-profile
│   │   │   ├── [school]/       all school-scoped portals (admin, teacher, parent, student, …)
│   │   │   ├── super-admin/    platform-level console (outside [school])
│   │   │   └── api/            NextAuth route + dev-only Google demo exchange
│   │   ├── components/         shell (sidebar/topbar/guards), ui (toasts, cards…),
│   │   │                       file-input, ask-eduos, access-permissions, shared views
│   │   ├── lib/                api.ts (typed client + refresh rotation), auth.tsx,
│   │   │                       permissions.tsx (server-trusted gating), portals.ts,
│   │   │                       school-path.ts, login-door.ts, acting-school.ts, types.ts
│   │   └── types/              shared TypeScript type definitions
│   └── .env                    frontend configuration
│
├── .github/workflows/      CI: tests, lint, build, dependency audit
├── docker-compose.yml      Mongo + backend + frontend for local orchestration
├── render.yaml             Render deployment blueprint
└── package.json / *.yaml   ⚠ legacy leftovers from an earlier iteration — NOT used
```

**Only `backend/` and `frontend/` are the product.** The root `package.json`, lockfiles, and root `.env` are dead leftovers; the sibling `eduosaisite/` folder (outside this repo) is a static design reference only.

---

## 2. Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 15.5 (App Router), React 18, TypeScript 5.6, NextAuth 4 (Google), Tailwind/PostCSS, custom typed fetch client with refresh-token rotation |
| Backend | Node ≥ 18, Express 4.21, Mongoose 8 / MongoDB, JWT (access 15 min + rotating refresh tokens), bcryptjs, Helmet, Brotli/Gzip compression, express-rate-limit, Winston logging, Swagger docs |
| Auth | Phone OTP, Email OTP, Google Sign-In (ID-token verified server-side), password login (API), multi-profile accounts with profile selection |
| RBAC | DB-backed permission catalog × roles with ALL/OWN scopes, enforced by `requirePermission` on every route and mirrored to the UI from `/auth/me` |

---

## 3. Prerequisites

- **Node.js ≥ 18** (backend) / the frontend builds on the same
- **MongoDB** running locally on `mongodb://localhost:27017` (or set `MONGO_URI`)

---

## 4. Quick start (development)

### 4.1 Backend

```bash
cd backend
npm i                # first time only
npm run seed         # roles, permissions, demo users, demo books/hostel rooms
npm run migrate      # links demo data (enrollments, invoices, assignments, …)
npm run dev          # → http://localhost:5000
```

Useful backend URLs:
- API base: `http://localhost:5000/api/v1`
- Swagger docs: `http://localhost:5000/api-docs`
- Health check: `http://localhost:5000/api/v1/health`
- Readiness probe: `http://localhost:5000/api/v1/observability/ready`
- Uploaded files: `http://localhost:5000/uploads/<file>`

### 4.2 Frontend

```bash
cd frontend
npm i                # first time only
npm run dev          # → http://localhost:3000
```

Production build: `npm run build && npm start`.

### 4.3 Running against a throwaway database

`.env` may point `MONGO_URI` at a shared or remote cluster, which makes "just run
it and see" risky — a seed would overwrite real data. To boot the real backend
against an ephemeral in-memory MongoDB instead:

```bash
cd backend
npm run dev:local            # prints the in-memory MongoDB URI it created
npm run dev:local:seed       # same, with one admin account seeded
```

It overrides `MONGO_URI` for that process, so the configured cluster is
unreachable from the run. Everything is discarded when the process exits.

To load the full demo school into it, take the URI it printed:

```bash
MONGO_URI="<printed URI>" npm run seed:school
```

The in-memory server runs as a **single-node replica set**, not a standalone —
the fee ledger and admission numbering use transactions, which MongoDB only
supports on a replica set.

---

## 5. Demo accounts & how to sign in

Seeded by `npm run seed` (one account per role). **Shared demo password — rotate before any real pilot.**

| Role | Email | Phone | Password (API/Swagger) |
|---|---|---|---|
| Super Admin | superadmin@schoolerp.com | +910000000009 | `ChangeMe@123!` |
| Admin | admin@schoolerp.com | +910000000001 | `ChangeMe@123!` |
| Principal | principal@schoolerp.com | +910000000002 | `ChangeMe@123!` |
| Teacher | teacher@schoolerp.com | +910000000003 | `ChangeMe@123!` |
| Finance | finance@schoolerp.com | +910000000004 | `ChangeMe@123!` |
| Librarian | librarian@schoolerp.com | +910000000005 | `ChangeMe@123!` |
| Warden | warden@schoolerp.com | +910000000006 | `ChangeMe@123!` |
| Parent | — (OTP only) | +910000000007 | — |
| Student | — (OTP only) | +910000000008 | — |

### The Super Admin, and how it gets created

The **Super Admin** is the platform tier above any single school. It signs in
through the same auth flow, lands on `/super-admin` (its own portal, its own
accent theme), and is the only role holding `schools.read` / `schools.manage` —
every school-level role is refused those two keys by the same
`requirePermission` gate used everywhere else. What it manages is schools (the
tenant already carried by every profile) and their **School Admin** accounts,
which are ordinary `ADMIN` profiles, unchanged in what they can do.

It also reads every school-wide dashboard — operations, finance, hostel and
library — from the same `GET /api/v1/dashboard/:role` endpoints the school's own
portals use, gathered under *School Dashboards*. The per-person dashboards
(teacher/student/parent) stay out of reach by design: each aggregates one
signed-in profile's own classes, record or children, so there is nothing for a
platform actor to open.

There are two ways to create one, and neither seeds a password into the repo.

**1. Continue with Google (recommended).** Put the platform administrator's
Google address in `SUPER_ADMIN_EMAILS` (backend env; `SUPER_ADMIN_EMAIL`
singular is read too, and the value may be a comma-separated list):

```bash
SUPER_ADMIN_EMAILS=asha@example.com
```

The first time that address signs in through *Continue with Google*, the
account and its Super Admin profile are provisioned automatically. The address
is trusted only after the backend has verified Google's ID token — signature,
issuer, audience and `email_verified` — so nothing here can be claimed by
someone who merely knows the address. An address that is not on the list is
untouched and still gets the usual "no account is linked" response. Clearing
the variable stops further provisioning but does **not** revoke anyone: delete
the profile to do that.

**2. A provisioning script**, for a deployment without Google sign-in, or when
you want the account to have a real phone number:

```bash
SUPER_ADMIN_PASSWORD='…' npm run superadmin:create -- \
  --name "Asha Menon" --phone +919876543210 --email asha@example.com
```

The password comes from the environment, never a flag, so it stays out of shell
history and the process list; it is never printed. Add `--allow-remote` when the
target database is not local, and `--set-password` to rotate the password on an
account that already has one (which also clears a sign-in lockout). Re-running
is safe: an existing account gains a Super Admin profile rather than being
duplicated, and a suspended one is reactivated.

### Adding a school

A Super Admin creates a school in the console (*Schools & Admins → New School*)
by choosing its address and name and naming its first School Admin. Nothing else
is per-school: the address resolves, the sign-in screen brands itself, the
sidebar and browser tab take the school's name, and the school's data is
separate from every other school's — all from that one record.

The console shows each school's sign-in link so it can be handed to its staff.
The address is fixed once created; `npm run schools:rename` moves a school and
all of its data to a new one if it has to change.

The browser tab shows the EduOS AI mark on every page — the platform hosts many
schools, so the favicon belongs to none of them — with the school's name as the
tab title wherever a school is being shown.

### Seats

A school's size is a commercial arrangement, so it is two numbers rather than
one. `purchasedSeats` is what the school has paid for; `approvedSeats` is what
the platform has released for use, and it is the only one user creation reads.

    purchase → approved → used → available
      → School Admin requests extra seats  (Admin Console → Seats)
      → the server prices them             (this school's rate + volume tiers)
      → payment                            (the same gateway as fees)
      → the request becomes PAID
      → a Super Admin approves or rejects  (Super Admin → Seat Management)
      → only an approval makes them usable

Paying therefore buys seats it does not release: a paid-but-unapproved request
leaves the school exactly as full as it was, and the seat page says so in those
words. A request can only be decided once it is paid, only once, and never from
inside the school that raised it — `seats.manage` and `seats.approve` are
Super-Admin-only keys, and the service refuses a decision made from a school's
own console even by a platform account.

A school the platform has never sold seats to has no seat account, and no seat
limit: deployments that do not sell seats behave exactly as they did before.

**Per-seat pricing** is per school — School A at ₹100 a seat, School B at ₹120,
School C at ₹90 — and is set on *Super Admin → Per-Seat Pricing*. A price is a
*version*, never a field that is overwritten: raising a school's rate writes a
new version and closes the old one, so the row that priced last month's payment
is still there saying what it said. Requests snapshot the rate as well, so a
charge is explained twice over.

    additionalSeats × the school's rate in force  − platform volume discount

is computed server-side, from the rate the server resolves; an amount in the
request body is never read. A school with no price of its own resolves to the
platform default (`SEAT_UNIT_PRICE_PAISE`). Prices carry a currency and may be
dated forward to schedule a rise — resolution is a query against the clock, so
no scheduler is involved. Zero and negative prices are refused: a zero-amount
order cannot be raised with the gateway, and free seats already have a route
(the platform grants them directly). Only `seats.pricing.manage`, another
Super-Admin-only key, can change a price; a School Admin sees the rate it will
be charged and nothing more.

### School-wise theme and UI customisation

Each school is configured separately on *Super Admin → School Customization*:
its primary, secondary and accent colours, a logo and favicon, a display name
and tagline, what the header and sidebar show, and the option lists its forms
offer.

It is not a second theme system. The colours are published as the CSS custom
properties `design-system.css` already themes every portal with — `--accent`,
`--accent-2` and the sidebar text set — so a school's brand colour flows through
every component that already reads them. They are applied to the portal's own
element rather than to `:root`, so one school's colours cannot outlive its
subtree or tint the platform console. The foreground colours are *derived* from
the brand colour's luminance server-side, because the shipped role themes pair
each accent with hand-picked text colours and an arbitrary brand colour arrives
with no such pairing.

A school that has configured nothing has no document and publishes no variables:
it renders exactly as EduOS ships, with its role-tinted portals intact. *Reset to
default* deletes the document rather than writing the defaults into it, so
"reset" and "never customised" are the same state.

Dropdown values are per school and isolated by the same tenancy plugin that
confines students and invoices — School A's houses (Red, Blue, Green) and School
B's (Alpha, Beta, Gamma) live in different documents, and no query a school can
express returns the other's. Colours must be hex literals and assets must be an
uploaded `/uploads/…` path or an https URL; `javascript:`, `data:` and SVG are
refused, SVG because it is active content served from our own origin.

Changing any of it is `customization.manage`, a Super-Admin-only key — the rule
the Settings screen has always stated. A School Admin reads its own
configuration on `settings.manage`; the render-time theme carries no permission
at all, because every role has to paint its own portal.

### Two kinds of door

```
http://localhost:3000/            platform sign-in  — Super Admins only
http://localhost:3000/oakridge    Oakridge sign-in  — Oakridge accounts only
http://localhost:3000/nvmp        NVMP sign-in      — NVMP accounts only
```

Each screen admits one kind of person, and turning someone away names the
address that is theirs: a teacher at the platform door is pointed at
`/their-school`, a Super Admin at a school door is pointed back to `/login`, and
an Oakridge account at `/nvmp` is told so by name. The rule is a pure function
(`src/lib/login-door.ts`) with tests covering every combination.

This is not what keeps a school's data private — the backend does that, by
serving a profile its own school's rows whatever address was used. It is what
stops someone landing in a portal that looks broken.

### Each school has its own address

A school is a `School` record whose `slug` is both the tenant stamped on every
one of its documents and the first segment of its portal URL:

```
http://localhost:3000/oakridge                 → Oakridge's sign-in
http://localhost:3000/oakridge/admin           → its Admin Console
http://localhost:3000/oakridge/admin/users     → …and every page beneath it
http://localhost:3000/nvmp/teacher             → NVMP's Teacher Portal
```

The slug is resolved through `GET /api/v1/schools/public/:slug` (unauthenticated
— it returns the slug and display name only), which brands the form and lets a
URL naming no school say so instead of showing a login that could never work.
Signing in at one school with another school's account is refused by name; a
Super Admin is exempt, since it belongs to the platform rather than to a school.

Every portal lives under its school (`src/app/[school]/…`). Nav items and page
links are still written school-less — `/admin/users` — and the school is added
when they render (`src/lib/school-path.ts`), so a link cannot be written for the
wrong school. Opening another school's URL is corrected rather than obeyed: the
shell redirects to the signed-in profile's own school.

`/login`, `/select-profile` and the Super Admin console stay outside `[school]`.
The Super Admin spans every school, so `/super-admin` belongs to none of them.

Data isolation does not depend on the URL. The backend derives the acting school
from the signed-in profile, so an address that says otherwise changes nothing
about what the API returns.

### Data isolation between schools

Every school-owned collection carries a `tenantId` and is filtered by the acting
school through an `AsyncLocalStorage` scope plus a Mongoose plugin
(`src/tenancy/`), so a query written without a tenant clause — nearly all of
them — still cannot reach another school's rows. Identity and RBAC collections
(Account, Profile, Role, Permission, tokens) stay global, because sign-in
happens before any school is known.

A Super Admin acts on one school by sending `X-School-Id: <slug>`; the header is
ignored for every other role, so it cannot be used to read sideways. With no
header a Super Admin runs platform-wide, which is what the schools list needs.

**Migrating an existing database.** Data written before this change has no
school, and a scoped query will not return it — so the portals look empty until
the migration runs:

```bash
npm run schools:migrate                                   # dry run
npm run schools:migrate -- --apply                        # local
npm run schools:migrate -- --apply --allow-remote         # a real deployment
```

It creates the Oakridge record, repoints legacy `eduos-demo-tenant` profiles at
it, stamps every unowned document, and drops the unique indexes that were global
(admission numbers, grade/subject/fee-head names, room numbers) so a second
school can reuse those identifiers. Override the owner with
`--school=<slug> --name="..."`.

### The retired Owner role

`OWNER` has been removed — the Super Admin replaces it, and `ADMIN` covers
everything else it did. Boot-time role sync adds roles but never deletes one,
so a database created before the removal keeps an orphaned `OWNER` role and any
profiles pointing at it. Clear them with:

```bash
npm run owner:drop            # dry run — reports what would change
npm run owner:drop -- --apply # delete the profiles, then the role
```

Accounts are never deleted, so anyone who held another profile keeps it; the
script names any account left with none.

On the login page:
- **Staff** → *Continue via Email OTP* with the email above.
- **Parent / Student** → *Continue with Phone Number*.
- The 6-digit OTP is **shown directly in the login UI** — on both the email and the phone path — whenever the backend echoes `devOtp`: always in development, and in a production build that sets `ALLOW_DEV_OTP_IN_PRODUCTION=true`. **This project is in its testing phase, so that flag is on** (see the ⚠ note below). With it off, codes are only delivered through the configured SMS/email provider.
- *Continue with Google (demo)* — picker of the demo emails; it signs in by reading that same echoed code, so it needs `ALLOW_DEV_OTP_IN_PRODUCTION` on the backend plus `NEXT_PUBLIC_ALLOW_DEV_OTP=true` on the frontend to appear in a production build. It becomes real Google OAuth once credentials are configured (see §8).

> ⚠ **Testing phase only.** While `ALLOW_DEV_OTP_IN_PRODUCTION` is on, anyone who knows an email address or phone number can request a code and read it straight out of the HTTP response — that is account takeover for every account, including Super Admin. Set it (and `NEXT_PUBLIC_ALLOW_DEV_OTP`) to `false` and configure real SMS/email providers before real users sign in.

Accounts can hold **multiple role profiles** (e.g. the same phone as Parent *and* Teacher) — after OTP verification you'll get a profile picker.

---

## 6. Portals & modules

| Portal | Modules |
|---|---|
| **Admin** | Dashboard, Tickets, User Management, Student/Teacher Classes, Classroom Management (Subject Offerings & Elective Registrations), Admission CRM, Attendance, Calendar, Timetable Builder, Payments & Fees (+receipts), Announcements, Library, Transport, Documents (real uploads), Medical Records, WhatsApp Assistant, Audit Logs, Access & Permissions (live RBAC editor), Seats (purchase, usage, per-seat rate and extra-seat requests), Tenant Settings |
| **Teacher** | Dashboard, My Classes, Attendance (one-tap marking), Timetable, Assignments (create → submissions roster → grading), Exams & Performance, Course Material (uploads), Announcements, Calendar, Elective Registrations (review queue), Medical Records, Support Tickets |
| **Parent** | Dashboard, Performance, Student View (growth score), Attendance, Assignments (submission status), Timetable, Calendar, Announcements, Medical Records, Library, Transport, Course Materials, **Payments with online Pay Now**, Documents, Study Help (AI tutor), AI Credits, Support Tickets |
| **Student** | Dashboard, Timetable, **Assignments with submit/resubmit + attachments**, Performance, Attendance, Calendar, Announcements, Library, Transport, Documents, Course Materials, Subjects (elective registration), Study Help (AI tutor), AI Credits, Profile, Support Tickets |
| **Principal** | School Intelligence, Performance & Risk Scan, Teacher Workload, Attendance Trends, Fee Health, Staff Directory, Announcements, Escalated Tickets, Audit Logs |
| **Super Admin** | Dashboard (platform), Schools & Admins, Seat Management (sell seats, approve/reject paid extra-seat requests), Per-Seat Pricing (a rate per school, versioned), School Customization (theme, branding, dropdown values per school), School Dashboards (operations / finance / hostel / library), Audit Logs, Access & Permissions |
| **Finance** | Dashboard, Payments & Fees, Reports |
| **Librarian** | Dashboard, Catalog & Lending (issue/return + fines), Announcements, Tickets |
| **Warden** | Dashboard (live occupancy), Room Management (allocate/vacate), Hostel Students, Medical Lookup, Announcements, Tickets |

Every portal home is powered by a single role-scoped `GET /api/v1/dashboard/:role` aggregation.

---

## 7. Security & RBAC model

- **Server is the source of truth.** `/auth/me` returns the profile's resolved permission map (e.g. `fees.read: ALL`, `attendance.mark: OWN`); the same keys are enforced by `requirePermission` middleware on every API route. The frontend only mirrors that map for menu/page gating — nothing client-side grants data access.
- **Scopes**: `ALL` = whole school; `OWN` = the teacher's own sections, the parent's own children, the student's own record — resolved server-side per request.
- **Access & Permissions** is a live editor over the `roles` × `permissions` collections; toggles persist via the roles API and take effect immediately.
- **Ownership checks**: parents can only pay their own invoices; students always submit assignments as themselves (enrollment resolved from the session, never trusted from the client); the manual payment ledger is staff-only.
- Sessions: 15-min access tokens + rotating refresh tokens (revocable per device or account-wide on logout). Credential endpoints have a strict rate limit (30/15 min) separate from the general API limit (2000/15 min).
- Medical records are encrypted at rest (`MEDICAL_ENCRYPTION_KEY`).
- **Observability endpoints**: `GET /api/v1/observability/ready` (public — DB liveness for load balancers); `GET /api/v1/observability/metrics` (SUPER_ADMIN/ADMIN only — process uptime, memory, DB state). The metrics endpoint is auth-gated because runtime and version fingerprinting aids attackers.

---

## 8. Integrations (env-driven provider abstractions)

Everything below works out of the box in **safe development modes**; going live is credentials-only — no code changes for callers.

| Integration | Dev behavior (default) | To go live |
|---|---|---|
| **SMS OTP** | code logged + echoed as `devOtp` (shown in login UI) | implement the vendor case in `backend/src/providers/notification.provider.js`, set `SMS_PROVIDER` |
| **Email OTP** | same as above | same file, set `EMAIL_PROVIDER` |
| **Google Sign-In** | dev-only demo picker | set `GOOGLE_CLIENT_ID`(+`SECRET`), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`; backend verifies the ID token audience via Google |
| **Online payments** | `PAYMENT_PROVIDER=sandbox` — Pay Now captures instantly with `SANDBOX-…` refs on the **real** ledger, clearly labelled | add a gateway case in `src/providers/payment.provider.js` (Razorpay/Stripe), set `PAYMENT_PROVIDER`; `none` disables online payment cleanly |
| **WhatsApp** | SIMULATION mode — the in-app phone frame drives the real bot brain as the logged-in user | set `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, point Meta's webhook at `/api/v1/whatsapp/webhook` |
| **AI copilot / agent** | deterministic, data-grounded answers from the caller's own scoped data (attendance, fees, homework, timetable, exams), with confirm-before-commit on every write. **Needs no API key** | nothing — this is production behaviour, not a stub |
| **AI-written answers** (tutor explanations, register OCR, intent fallback) | off unless a provider is configured | `AI_PROVIDER=gemini` + `GEMINI_API_KEY`, or `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. Nothing else is implemented. Without one, tutor returns a labelled study plan from real data and charges no credits |
| **AI credits** | students/parents get `AI_FREE_MONTHLY_CREDITS` (default 50) free AI answers a month, then buy packs; staff are never metered | set `AI_FREE_MONTHLY_CREDITS=0` to sell credits outright; add a real gateway for the top-up charge |
| **In-app notifications** | all roles receive notifications (new announcements, assignment grades, fee receipts, elective decisions, etc.) via `GET /api/v1/notifications`; unread badge count via `/notifications/unread-count` | nothing — works in dev by default |
| **File uploads** | stored on local disk under `backend/uploads/`, served at `/uploads/…` (type/size validated) | swap the handler in `backend/src/modules/uploads/upload.routes.js` for S3/GCS — the `{ fileUrl }` contract is unchanged |
| **Growth/Risk scoring** | productized heuristics behind a service layer (deterministic, explainable) | replace the scoring services with an ML model when available |

---

## 9. Environment reference

### `backend/.env`

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `5000` / `localhost` | server bind |
| `MONGO_URI` / `MONGO_URI_ATLAS` | `mongodb://localhost:27017/school_erp` | database. **`MONGO_URI_ATLAS` is production-only**: outside `NODE_ENV=production` it is ignored entirely (and the boot log says so), so development always uses `MONGO_URI`. In production Atlas wins when set. The boot line prints `target=…, source=MONGO_URI\|MONGO_URI_ATLAS\|default` — check it before trusting a seed or migration. Note the shipped `.env` may point `MONGO_URI` at a remote cluster; see §4.3 for a way to run against a throwaway database instead |
| `NODE_ENV` | `development` | in production, `devOtp` is never returned (unless `ALLOW_DEV_OTP_IN_PRODUCTION=true`) and Swagger defaults off |
| `ALLOW_DEV_OTP_IN_PRODUCTION` | `false` (`true` in this repo's testing-phase config) | echoes the OTP as `devOtp` on every login path even in production, and lets the server boot on the `console` SMS/email providers. **Testing phase only** — it makes any known email or phone number a way into that account. Pair it with `NEXT_PUBLIC_ALLOW_DEV_OTP` on the frontend to keep the demo Google popup |
| `JWT_SECRET` | change-me | **must change in production** |
| `ACCESS_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_TTL_DAYS` | `15m` / `30` | session lifetimes |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` | `5` / `5` | OTP policy |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | `2000` / `30` per 15 min | general vs credential-endpoint limits |
| `MULTI_PROFILE_ENABLED` | `true` | profile picker for multi-role accounts |
| `MEDICAL_ENCRYPTION_KEY` | change-me | at-rest encryption for medical data |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `console` | OTP delivery (see §8) |
| `PAYMENT_PROVIDER` | `sandbox` | `sandbox` \| `none` \| future gateway |
| `SEAT_UNIT_PRICE_PAISE` | `50000` (₹500) | **default** list price of one extra seat, for schools the Super Admin has not priced specifically. Per-school prices override it; nothing a client sends is ever read |
| `GOOGLE_CLIENT_ID` | — | enables real Google sign-in verification |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | `uploads` / 15 MB | file uploads |
| `WHATSAPP_VERIFY_TOKEN`, `WA_*` | — | WhatsApp webhook / live mode. Setting `WA_APP_SECRET` makes signature verification mandatory for **every** inbound request |
| `AI_PROVIDER` | `rules` | `rules` (no model) \| `gemini` \| `anthropic`. No other value is implemented |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-3.6-flash` | required by `AI_PROVIDER=gemini` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-opus-5` | required by `AI_PROVIDER=anthropic` |
| `AI_FREE_MONTHLY_CREDITS` | `50` | free AI answers per student/parent per month. **`0` is honoured** and means credits must be bought |
| `RATE_LIMIT_AI_MAX` | `30`/min | HTTP limit on `/ai/*`, keyed on profile |
| `AGENT_RATE_LIMIT_PER_MIN` | `20` | per-**actor** agent limit, enforced in the core so it also covers WhatsApp |
| `AGENT_INJECTION_STRIKES` / `AGENT_INJECTION_BLOCK_MS` | `3` / `60000` | prompt-injection attempts before a cool-off, and its length |
| `SWAGGER_ENABLED`, `CORS_ORIGIN`, `LOG_LEVEL` | dev defaults | ops |

### `frontend/.env`

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:5000` | API base for the client and NextAuth exchange |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | NextAuth Google provider |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | — | switches the login button from demo → real Google |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | — | required when Google sign-in is enabled |

---

## 10. Testing & quality gates

```bash
cd backend  && npm test        # Vitest — 29 test suites
cd frontend && npm test        # 9 test suites
cd frontend && npm run lint    # ESLint — the baseline is zero warnings
cd frontend && npm run typecheck
```

**Backend** uses Vitest with `mongodb-memory-server`. Tests run against a real
MongoDB **replica set**, deliberately: `session.withTransaction` only works on
one, so a standalone would silently take the non-transactional fallback and let
the fee-ledger tests pass without exercising what they claim to cover. The first
run downloads a MongoDB binary and is slow; later runs are not.

| Suite | Covers |
|---|---|
| `fees.recordPayment` | Atomicity, concurrency, the overpayment guard |
| `fees.authorization` | Role-based fee payment and refund access |
| `admissions.admissionNo` | Sequence atomicity, seeding from existing numbering |
| `auth.lockout` / `auth.otp` | Lockout policy; OTP hashing, expiry, throttling |
| `authFlow.integration` | Refresh-token rotation, reuse detection, revocation |
| `auth.door` | School sign-in door logic for all role x address combinations |
| `medical.accessGate` | Per-role medical access matrix, read/denial auditing |
| `csvImport` | Bulk import: header normalisation, partial failure |
| `timetable` / `timetable.electives` | Scoping, slot upserts, elective visibility |
| `paginate` | Opt-in pagination and its backward compatibility |
| `registrations.notify`, `academics.updateOffering` | Elective workflow |
| `agent.bulkAuthorization` | AI agent bulk-write authorization |
| `announcements.audience` | Announcement audience filtering |
| `attendance.markScope` | Attendance marking scope enforcement |
| `audit.access` | Audit log access control |
| `authorization.matrix` | Cross-role permission matrix |
| `crm.leadAccess` | CRM lead assignment and access |
| `dashboard.visibility` | Role-scoped dashboard panel visibility |
| `documents.materialAccess` | Course material access by grant |
| `exams.recordAccess` | Marks and report card access by role |
| `platformView.scope` | Super Admin platform-wide view scoping |
| `schoolAdmin.isolation` | School Admin cross-school isolation |
| `seats.management` | Seat purchase, server-side pricing, payment, approval and isolation |
| `seats.webhook` | Routing a gateway order to the fee ledger or the seat ledger |
| `seats.pricing` | Per-school seat pricing: CRUD, calculation, snapshots, history, isolation, concurrency |
| `customization.school` | School theme, branding, dropdown isolation, defaults, invalid values, RBAC, MCP |
| `superAdmin.googleAccess` / `superAdmin.schools` | Super Admin provisioning and school management |
| `tenancy.isolation` | Multi-school data isolation |
| `transport.access` | Bus assignment scope enforcement |

**Frontend** uses Vitest + Testing Library (`jsdom`). Coverage is the pure
logic and the components where a regression is silent — the timetable layout
maths, the `clickable()` accessibility helper, the elective catalogue, the
login-door logic, the open-school guard, permissions gating, platform-view nav,
and division label formatting.

**CI** (`.github/workflows/ci.yml`) runs on push and PR: backend tests, build,
and a `node --check` on the built bundle (that bundle is what `npm start`
actually runs, so a bundle that does not parse is a broken deploy even when the
source is fine); frontend typecheck, lint at `--max-warnings 0`, tests and
build; plus an advisory `npm audit`.

---

## 11. Docker

```bash
docker compose up --build      # Mongo + backend :5000 + frontend :3000
```

Multi-stage builds, non-root user, production dependencies only. Compose starts
MongoDB as a **single-node replica set** for the same transaction reason as
above. `NEXT_PUBLIC_BACKEND_URL` is inlined at build time, so it must be the URL
the *browser* will use, not the docker-internal hostname.

> These images have not been built and run end to end — treat the setup as a
> starting point rather than a verified deployment.

---

## 12. Elective subject registration

Students opt into elective subjects; a teacher approves each request. Core
subjects stay automatic and are not registerable.

**The data chain.** If any link is missing the student sees an empty list with
no explanation:

```
Account → Profile (STUDENT) → Student.profileId → Enrollment (ACTIVE) → Section
                                                                          ▲
                                 SubjectOffering (isElective: true) ───────┘
                                 same section, term not yet ended
```

| Missing | What the student sees |
|---|---|
| `Student.profileId` | `STUDENT_NOT_LINKED` |
| No ACTIVE enrolment | `NO_ACTIVE_ENROLLMENT` |
| Offering not `isElective` | Nothing — core subjects are excluded by design |
| Offering in another section | Nothing — students only see their own class's |
| Term ended | Listed, but registering returns `TERM_CLOSED` |

`capacity: null` means unlimited. **Both PENDING and APPROVED hold a seat** —
otherwise approving a backlog of pending requests walks straight past the cap.

**Adding electives to a real database:**

```bash
cd backend
npm run electives:plan     # dry run — writes nothing
npm run electives:apply    # prompts for confirmation on a remote database
```

Edit the `ELECTIVES` block at the top of `backend/scripts/add-electives.js` to
set which subjects, which grades and what capacities. The script only ever
writes `Subject` and `SubjectOffering` rows — never an account, profile,
student, enrolment, grade, section or term. It is idempotent, additive only
(it never un-marks or deletes an offering, which would strand registered
students), and refuses to lower a capacity below the seats already taken.

Staff can also do this per-offering in **Classroom Mgmt → Subject Offerings**.

**Filling in registrations for existing students.** Offerings only say what a
class *may* take; until students register, `/student/subjects` lists electives
with no status and both staff queues are empty. To populate that:

```bash
cd backend
npm run registrations:plan     # dry run — writes nothing
npm run registrations:apply    # prompts for confirmation on a remote database
```

`backend/scripts/seed-registrations.js` gives every actively enrolled student
registrations for electives offered to *their own division* (2 by default,
`--per-student N` to change), in a mix of approved, pending and rejected. It
also fills in a class teacher on any elective offering that has none, so the
request lands in that teacher's queue rather than only an admin's.

Like `add-electives.js` it is narrow and additive: it writes only
`SubjectRegistration` rows plus that one `teacherId`, never an account,
profile, student, enrolment, grade, section, term or subject, and never edits a
registration that already exists. It respects `capacity` (recording a rejection
rather than overfilling), and the allocation is derived from each student's own
id, so re-running converges instead of duplicating. Accepts the same `--term`
and `--grades` flags as `add-electives.js`.

Run it *after* `electives:apply` — a registration has to point at an elective
offering, so it refuses to run when the term has none.

For a full local demo scenario with students, teachers and pre-seeded states,
use `npm run seed:electives` against a `dev:local` database — **never against
real data**, since it creates accounts.

> An approved elective only appears on a timetable once a `TimetableSlot` is
> scheduled for it. Registration decides *who attends*; the slot decides *when
> it meets*.

---

## 13. Backend scripts

| Command | What it does |
|---|---|
| `npm run dev` | nodemon dev server |
| `npm run seed` | idempotent: permission catalog, system roles, demo users, demo books & hostel rooms |
| `npm run migrate` | harmonizes/links demo data (enrollments, guardians, invoices, assignments, exams, timetable) |
| `npm run seed:school` | full demo school: 12 divisions, 720 students, timetable, fees |
| `npm run build` / `npm start` | esbuild bundle → `dist/`, run production build |
| `npm run build:obfuscated` / `start:obfuscated` | obfuscated production bundle |
| `npm test` / `npm run test:watch` | Vitest against an in-memory MongoDB replica set |
| `npm run dev:local` / `dev:local:seed` | run the server against a throwaway database (§4.3) |
| `npm run electives:plan` / `electives:apply` | add elective offerings to an existing database (§12) |
| `npm run registrations:plan` / `registrations:apply` | give existing students registrations for those electives (§12) |
| `npm run seed:electives` | full elective demo scenario — **local databases only** |
| `npm run superadmin:create` | provision a Super Admin account (§5) |
| `npm run owner:drop` | remove the retired OWNER role and its profiles (§5) |
| `npm run schools:migrate` | stamp tenantId on legacy data and create school records (§5) |
| `npm run schools:rename` | rename a school's slug and repoint all its data |

Frontend: `npm run dev`, `build`, `start`, `test`, `lint`, `lint:fix`, `typecheck`.

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits with `EADDRINUSE :5000` | another process holds the port — stop it or change `PORT` |
| `MongooseError` on boot | MongoDB isn't running / wrong `MONGO_URI` |
| Login page loads but sign-in fails with "Cannot reach the server" | backend not running, or `NEXT_PUBLIC_BACKEND_URL` doesn't match it |
| No dev OTP shown after "Send OTP" (email) | that email has no account — unknown emails are answered identically on purpose (no user enumeration). Use a seeded email or create the user first |
| `429 Too many sign-in attempts` | credential rate limit (30/15 min per IP) — wait, or raise `RATE_LIMIT_AUTH_MAX`. `npm run dev:local` already raises it, since scripting a walkthrough across many accounts trips it immediately |
| Student's Subject Registration page is empty | no elective offerings for their section — see §12 for the chain each student needs |
| A seed or migration hit the wrong database | check the `Connecting to MongoDB… (target=…, source=…)` boot line. `MONGO_URI_ATLAS` is ignored outside production |
| `querySrv ECONNREFUSED` on a `mongodb+srv://` URI | Node's DNS resolver cannot complete the SRV lookup (`nslookup` may still work). Use a direct `mongodb://` URI listing the shard hosts |
| Everything returns 403 | the role lacks that permission — check Admin → Access & Permissions |
| Uploaded file 404s | file was uploaded before a change of `UPLOAD_DIR`; files live in `backend/uploads/` |
| Notification bell shows no items | the notifications collection may be empty — announcements, fee receipts, and assignment grades each write a notification entry automatically |
| `/observability/metrics` returns 403 | the metrics endpoint requires SUPER_ADMIN or ADMIN — use a seeded staff account |

---

## 15. Production checklist

1. Set strong `JWT_SECRET` and `MEDICAL_ENCRYPTION_KEY`; set `NODE_ENV=production` (disables `devOtp` echo and Swagger).
2. **Remove `ALLOW_DEV_OTP_IN_PRODUCTION` and `NEXT_PUBLIC_ALLOW_DEV_OTP`** (both are set to `true` in `render.yaml` for the testing phase). Until they are gone, the OTP is handed to whoever asks for it.
3. Configure real `SMS_PROVIDER` / `EMAIL_PROVIDER` — with `console` in production, OTP requests fail loudly instead of pretending to send.
4. Decide `PAYMENT_PROVIDER`: a real gateway, or `none` until then (sandbox is for demos only).
5. Configure Google OAuth env on both apps, or leave unset (the button hides itself in production).
6. Lock `CORS_ORIGIN` to your frontend origin.
7. Replace/rotate all seeded demo accounts and the shared demo password.
8. Point uploads at object storage if the server disk isn't durable.
9. Run `npm test` in both packages and `npm run lint` in the frontend — CI gates on these.
10. Rebuild the backend bundle (`npm run build`); `npm start` runs `dist/`, which is gitignored and not deployed for you.
10. If upgrading an existing database, run `npm run electives:plan` before `apply` and read the plan, then `npm run registrations:plan` / `apply` to give students registrations for them.
11. If upgrading from a pre-multi-school database, run `npm run schools:migrate -- --apply` to stamp tenant IDs and create school records before starting the server.
