# EduOS AI — AI-native School ERP

EduOS AI is a multi-portal School/College ERP: one platform with dedicated, role-scoped portals for **Owner, Admin, Principal, Teacher, Parent, Student, Finance, Librarian, and Hostel Warden**, plus an AI copilot, WhatsApp assistant (simulation mode), online fee payments, file uploads, and a fully backend-enforced RBAC system.

> 📄 Project history: [AUDIT_REPORT.md](AUDIT_REPORT.md) (full stabilization audit) and [COMPLETION_REPORT.md](COMPLETION_REPORT.md) (coverage matrix, fix log, remaining credential-only gaps).

---

## 1. Repository layout

```
Eduos-AI/
├── backend/                ← Express + MongoDB REST API   (the entire backend)
│   ├── src/
│   │   ├── app.js              server bootstrap (helmet, CORS, rate limits, /uploads static)
│   │   ├── config/             env, db, swagger
│   │   ├── constants/          permission catalog, system roles, demo users
│   │   ├── middleware/         auth (JWT), requirePermission, rate limiters, error handler
│   │   ├── models/             Mongoose schemas (students, fees, assignments, hostel, …)
│   │   ├── modules/            one folder per domain: routes + controller + service
│   │   ├── providers/          swappable integrations: notification (SMS/email OTP), payment
│   │   ├── seed/               seed.js (roles/permissions/demo users) + migrate.js (demo data)
│   │   └── utils/              jwt, otp, crypto, scope resolution, response helpers
│   ├── uploads/                uploaded files (served at /uploads/…)
│   └── .env                    backend configuration
│
├── frontend/               ← Next.js 14 App Router frontend  (the entire frontend)
│   ├── src/
│   │   ├── app/                one folder per portal: admin/ teacher/ parent/ student/ …
│   │   │   ├── (auth)/         login + select-profile
│   │   │   └── api/            NextAuth route + dev-only Google demo exchange
│   │   ├── components/         shell (sidebar/topbar/guards), ui (toasts, cards…),
│   │   │                       file-input, ask-eduos, access-permissions, shared views
│   │   └── lib/                api.ts (typed client + refresh rotation), auth.tsx,
│   │                           permissions.tsx (server-trusted gating), portals.ts, types.ts
│   └── .env                    frontend configuration
│
├── AUDIT_REPORT.md         stabilization audit (what was broken and why)
├── COMPLETION_REPORT.md    final completion report (what was fixed, verified how)
├── render.yaml             Render deployment blueprint
└── package.json / *.yaml   ⚠ legacy leftovers from an earlier iteration — NOT used
```

**Only `backend/` and `frontend/` are the product.** The root `package.json`, lockfiles, and root `.env` are dead leftovers; the sibling `eduosaisite/` folder (outside this repo) is a static design reference only.

---

## 2. Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 14.2 (App Router), React 18, TypeScript 5.6, NextAuth 4 (Google), Tailwind/PostCSS, custom typed fetch client with refresh-token rotation |
| Backend | Node ≥ 18, Express 4.21, Mongoose 8 / MongoDB, JWT (access 15 min + rotating refresh tokens), bcryptjs, Helmet, express-rate-limit, Winston logging, Swagger docs |
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
- Uploaded files: `http://localhost:5000/uploads/<file>`

### 4.2 Frontend

```bash
cd frontend
npm i                # first time only
npm run dev          # → http://localhost:3000
```

Production build: `npm run build && npm start`.

---

## 5. Demo accounts & how to sign in

Seeded by `npm run seed` (one account per role). **Shared demo password — rotate before any real pilot.**

| Role | Email | Phone | Password (API/Swagger) |
|---|---|---|---|
| Owner | owner@schoolerp.com | +910000000000 | `ChangeMe@123!` |
| Admin | admin@schoolerp.com | +910000000001 | `ChangeMe@123!` |
| Principal | principal@schoolerp.com | +910000000002 | `ChangeMe@123!` |
| Teacher | teacher@schoolerp.com | +910000000003 | `ChangeMe@123!` |
| Finance | finance@schoolerp.com | +910000000004 | `ChangeMe@123!` |
| Librarian | librarian@schoolerp.com | +910000000005 | `ChangeMe@123!` |
| Warden | warden@schoolerp.com | +910000000006 | `ChangeMe@123!` |
| Parent | — (OTP only) | +910000000007 | — |
| Student | — (OTP only) | +910000000008 | — |

On the login page:
- **Staff** → *Continue via Email OTP* with the email above.
- **Parent / Student** → *Continue with Phone Number*.
- In development the 6-digit OTP is **shown directly in the login UI** (the backend echoes `devOtp` outside production). In production, codes are only delivered through the configured SMS/email provider.
- *Continue with Google (demo)* — dev-only picker of the demo emails; becomes real Google OAuth once credentials are configured (see §8), and disappears in production if unconfigured.

Accounts can hold **multiple role profiles** (e.g. the same phone as Parent *and* Teacher) — after OTP verification you'll get a profile picker.

---

## 6. Portals & modules

| Portal | Modules |
|---|---|
| **Admin** | Dashboard, Tickets, User Management, Student/Teacher Classes, Admission CRM, Attendance, Calendar, Timetable Builder, Payments & Fees (+receipts), Announcements, Library, Transport, Documents (real uploads), WhatsApp Assistant, Audit Logs, Access & Permissions (live RBAC editor), Tenant Settings |
| **Teacher** | Dashboard, My Classes, Attendance (one-tap marking), Timetable, Assignments (create → submissions roster → grading), Exams & Performance, Course Material (uploads), Announcements, Calendar, Parent Queries, Medical Records |
| **Parent** | Dashboard, Performance, Student View (growth score), Attendance, Assignments (submission status), Timetable, Calendar, Announcements, Medical Records, Library, Transport, **Payments with online Pay Now**, Documents, Support |
| **Student** | Dashboard, Timetable, **Assignments with submit/resubmit + attachments**, Performance, Attendance, Calendar, Announcements, Library, Transport, Documents |
| **Principal** | School Intelligence, Performance & Risk scan, Teacher Workload, Attendance Trends, Fee Health, Staff Directory, Announcements, Escalated Tickets, Audit Logs |
| **Owner** | Dashboard, Admissions CRM, Audit Logs, Access & Permissions, Tenant Settings |
| **Finance** | Dashboard, Payments & Fees, Reports |
| **Librarian** | Dashboard, Catalog & Lending (issue/return + fines), Announcements, Tickets |
| **Warden** | Dashboard (live occupancy), Room Management (allocate/vacate), Hostel Students, Medical Lookup, Announcements, Tickets |

Every portal home is powered by a single role-scoped `GET /api/v1/dashboard/:role` aggregation.

---

## 7. Security & RBAC model

- **Server is the source of truth.** `/auth/me` returns the profile's resolved permission map (e.g. `fees.read: ALL`, `attendance.mark: OWN`); the same keys are enforced by `requirePermission` middleware on every API route. The frontend only mirrors that map for menu/page gating — nothing client-side grants data access.
- **Scopes**: `ALL` = whole school; `OWN` = the teacher's own sections, the parent's own children, the student's own record — resolved server-side per request.
- **Admin/Owner → Access & Permissions** is a live editor over the `roles` × `permissions` collections; toggles persist via the roles API and take effect immediately.
- **Ownership checks**: parents can only pay their own invoices; students always submit assignments as themselves (enrollment resolved from the session, never trusted from the client); the manual payment ledger is staff-only.
- Sessions: 15-min access tokens + rotating refresh tokens (revocable per device or account-wide on logout). Credential endpoints have a strict rate limit (30/15 min) separate from the general API limit (2000/15 min).
- Medical records are encrypted at rest (`MEDICAL_ENCRYPTION_KEY`).

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
| **File uploads** | stored on local disk under `backend/uploads/`, served at `/uploads/…` (type/size validated) | swap the handler in `backend/src/modules/uploads/upload.routes.js` for S3/GCS — the `{ fileUrl }` contract is unchanged |
| **Growth/Risk scoring** | productized heuristics behind a service layer (deterministic, explainable) | replace the scoring services with an ML model when available |

---

## 9. Environment reference

### `backend/.env`

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `5000` / `localhost` | server bind |
| `MONGO_URI_ATLAS` / `MONGO_URI` | `mongodb://localhost:27017/school_erp` | database. **`MONGO_URI_ATLAS` wins when set** — if it is present in `.env`, setting `MONGO_URI` has no effect and your command silently talks to the Atlas cluster instead. Override `MONGO_URI_ATLAS` to point at a local database, and check the `MongoDB connected → …` boot line before trusting a seed or migration |
| `NODE_ENV` | `development` | in production, `devOtp` is never returned and Swagger defaults off |
| `JWT_SECRET` | change-me | **must change in production** |
| `ACCESS_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_TTL_DAYS` | `15m` / `30` | session lifetimes |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` | `5` / `5` | OTP policy |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | `2000` / `30` per 15 min | general vs credential-endpoint limits |
| `MULTI_PROFILE_ENABLED` | `true` | profile picker for multi-role accounts |
| `MEDICAL_ENCRYPTION_KEY` | change-me | at-rest encryption for medical data |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `console` | OTP delivery (see §8) |
| `PAYMENT_PROVIDER` | `sandbox` | `sandbox` \| `none` \| future gateway |
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

## 10. Backend scripts

| Command | What it does |
|---|---|
| `npm run dev` | nodemon dev server |
| `npm run seed` | idempotent: permission catalog, system roles, demo users, demo books & hostel rooms |
| `npm run migrate` | harmonizes/links demo data (enrollments, guardians, invoices, assignments, exams, timetable) |
| `npm run build` / `npm start` | esbuild bundle → `dist/`, run production build |
| `npm run build:obfuscated` / `start:obfuscated` | obfuscated production bundle |

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits with `EADDRINUSE :5000` | another process holds the port — stop it or change `PORT` |
| `MongooseError` on boot | MongoDB isn't running / wrong `MONGO_URI` |
| Login page loads but sign-in fails with "Cannot reach the server" | backend not running, or `NEXT_PUBLIC_BACKEND_URL` doesn't match it |
| No dev OTP shown after "Send OTP" (email) | that email has no account — unknown emails are answered identically on purpose (no user enumeration). Use a seeded email or create the user first |
| `429 Too many sign-in attempts` | credential rate limit (30/15 min per IP) — wait or raise `RATE_LIMIT_AUTH_MAX` in dev |
| Everything returns 403 | the role lacks that permission — check Admin → Access & Permissions |
| Uploaded file 404s | file was uploaded before a change of `UPLOAD_DIR`; files live in `backend/uploads/` |

---

## 12. Production checklist

1. Set strong `JWT_SECRET` and `MEDICAL_ENCRYPTION_KEY`; set `NODE_ENV=production` (disables `devOtp` echo and Swagger).
2. Configure real `SMS_PROVIDER` / `EMAIL_PROVIDER` — with `console` in production, OTP requests fail loudly instead of pretending to send.
3. Decide `PAYMENT_PROVIDER`: a real gateway, or `none` until then (sandbox is for demos only).
4. Configure Google OAuth env on both apps, or leave unset (the button hides itself in production).
5. Lock `CORS_ORIGIN` to your frontend origin.
6. Replace/rotate all seeded demo accounts and the shared demo password.
7. Point uploads at object storage if the server disk isn't durable.
