# School ERP Backend

A structured, scalable REST API backend for a School ERP system built with **Node.js**, **Express**, **MongoDB/Mongoose**, **Swagger**, and **Winston** logging. Uses **ES Modules** and bundles into a single file via **esbuild**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express.js 4 |
| Database | MongoDB via Mongoose 8 |
| API Docs | Swagger UI (OpenAPI 3.0) |
| Logging | Winston + daily-rotate-file + Morgan |
| Bundler | esbuild |
| Module System | ES Modules (`"type": "module"`) |
| Security | Helmet, CORS, express-rate-limit |

---

## Project Structure

```
School ERP Backend/
├── src/
│   ├── app.js                      ← Entry point — wires everything together
│   ├── config/
│   │   ├── env.js                  ← Typed, validated environment variables
│   │   ├── db.js                   ← Mongoose connection + reconnect listeners
│   │   └── swagger.js              ← OpenAPI 3.0 spec definition
│   ├── middleware/
│   │   ├── requestLogger.js        ← HTTP request logs via Morgan → Winston
│   │   ├── rateLimiter.js          ← IP-based rate limiting
│   │   └── errorHandler.js         ← Global error handler + 404 catcher
│   ├── routes/
│   │   └── index.js                ← Root API router (registers all module routes)
│   ├── models/                     ← Mongoose schemas (one file per domain area)
│   ├── modules/                    ← One folder per module: *.routes.js, *.controller.js, *.service.js
│   ├── constants/
│   │   └── permissions.js          ← Seed permission catalog + system role grants
│   ├── seed/
│   │   └── seed.js                 ← npm run seed — loads the catalog/roles/default owner
│   └── utils/
│       ├── logger.js               ← Winston logger (console + rotating files)
│       ├── AppError.js             ← Custom operational error class
│       ├── asyncHandler.js         ← Wraps async controllers, forwards errors
│       ├── response.js             ← Standardized JSON response helpers
│       ├── jwt.js                  ← Sign/verify auth tokens
│       ├── crypto.js               ← AES-256-GCM encrypt/decrypt for medical records
│       └── scope.js                ← Resolves OWN-scope IDs (teacher's sections, parent's children, etc.)
├── public/                          ← Served as static files at the app root
│   ├── status.html                  ← Live server/DB status dashboard
│   └── crypto-tool.html             ← Client-side AES-256-GCM encrypt/decrypt utility
├── docs/
│   └── ARCHITECTURE.md             ← Application flow and architecture guide
├── esbuild.config.js               ← Build config: bundles src/ → dist/app.js
├── .env                            ← Local environment (git-ignored)
├── .env.example                    ← Environment variable template
├── .gitignore
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18.x
- MongoDB running locally or a MongoDB Atlas URI

### 1. Clone and install

```bash
git clone <repo-url>
cd school-erp-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run in development

```bash
npm run dev
```

The server starts with Node's built-in `--watch` flag — it restarts automatically on file changes. No extra tools needed.

### 4. Build for production

```bash
npm run build       # minified production bundle → dist/app.js
npm start           # runs dist/app.js
```

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with hot-reload (nodemon) |
| `npm run seed` | Seed the permission catalog, system roles, and a default owner login |
| `npm run build` | Bundle → `dist/app.js` (minified) |
| `npm run build:dev` | Bundle → `dist/app.js` (with sourcemaps) |
| `npm run obfuscate` | Obfuscate the existing `dist/app.js` → `dist-obfuscated/app.js` |
| `npm run build:obfuscated` | `build` + `obfuscate` in one step — produces both versions |
| `npm start` | Run the plain production bundle (`dist/app.js`) |
| `npm run start:obfuscated` | Run the obfuscated bundle (`dist-obfuscated/app.js`) |

`npm run build:obfuscated` keeps **both** outputs on disk: `dist/` (plain, for your own debugging/sourcemaps) and `dist-obfuscated/` (control-flow flattened, string-array encoded, self-defending — for distributing to environments where you don't want the source readable). Both are git-ignored; generate them in CI/deploy.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` | `5000` | HTTP server port |
| `HOST` | `localhost` | HTTP server host |
| `MONGO_URI` | `mongodb://localhost:27017/school_erp` | MongoDB connection string |
| `LOG_LEVEL` | `info` | Winston log level (`error`, `warn`, `info`, `http`, `debug`) |
| `LOG_DIR` | `logs` | Directory where log files are written |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window in ms (default: 15 min) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `SWAGGER_ENABLED` | dev: `true`, prod: `false` | Mount/unmount `/api-docs` |
| `JWT_SECRET` | — | Secret used to sign auth JWTs |
| `MULTI_PROFILE_ENABLED` | `true` | `false` auto-selects the most recent profile instead of requiring `/auth/profile/select` |
| `ACCESS_TOKEN_EXPIRES_IN` | `15m` | Access JWT expiry |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime |
| `OTP_TTL_MINUTES` | `5` | How long a requested OTP stays valid |
| `OTP_MAX_ATTEMPTS` | `5` | Max wrong-code attempts before an OTP is locked out |
| `BCRYPT_SALT_ROUNDS` | `10` | Password hashing cost |
| `MEDICAL_ENCRYPTION_KEY` | — | Key used to encrypt medical record fields at rest |
| `WHATSAPP_VERIFY_TOKEN` | — | Token checked during the WhatsApp webhook handshake (stand-in) |

---

## Modules & API Endpoints

### Base URL

```
http://localhost:5000/api/v1
```

This project implements a single-school RBAC-driven ERP: every collection below lives in MongoDB, every endpoint is gated by a permission key resolved at login (see [Authentication & RBAC](#authentication--rbac)), and `OWN` scopes are enforced per-role (teacher's own classes, parent's own children, student's own record).

| Module | Base path | Permission keys | What it does |
|---|---|---|---|
| System | `/health` | — | Liveness check |
| Auth | `/auth` | — | Register, OTP login, password login, profile select, refresh, logout, current profile |
| Profiles | `/profiles` | — | List every profile linked to the current account (profile switcher) |
| Roles | `/roles` | `roles.manage` | CRUD roles, assign/revoke permissions dynamically |
| Permissions | `/permissions` | `permissions.manage` | CRUD the permission catalog itself |
| Academics | `/academics` | `academics.structure.manage` | Years, terms, grades, sections, subjects, offerings |
| Students | `/students` | `students.read`, `students.manage` | Student records, guardian links |
| Enrollments | `/enrollments` | `enrollments.manage` | Student-in-section-for-year records |
| Timetable | `/timetable` | `timetable.read`, `timetable.manage` | Weekly class slots |
| Attendance | `/attendance` | `attendance.read`, `attendance.mark` | Roster, bulk mark, summary counts |
| Assignments | `/assignments` | `assignments.read/manage`, `submissions.grade/submit` | Homework/projects + grading |
| Exams | `/exams` | `exams.manage`, `marks.read/enter/publish` | Exams, exam subjects, marks grid, publish |
| Fees | `/fees` | `fees.structure.manage`, `fees.read/manage/pay`, `fees.payments.refund` | Fee heads, structures, invoices, payments, refunds |
| Announcements | `/announcements` | `announcements.read/publish` | School-wide notices |
| Calendar | `/calendar` | `calendar.read/manage` | Holidays, exams, PTMs, events |
| Tickets | `/tickets` | `tickets.read/create/respond/manage` | Support ticket queue + threaded replies |
| Medical | `/medical` | `medical.read/manage` | Per-student medical record, fields encrypted at rest |
| Admissions | `/admissions` | `admissions.read/manage` | Lead pipeline (CRM-style) |
| Growth ⚠️ | `/growth` | `ai.insights.read` | **Stand-in** — heuristic score (60% marks + 40% attendance), not a trained model |
| Risk ⚠️ | `/risk` | `ai.insights.read` | **Stand-in** — rule-based thresholds, not a trained model |
| AI ⚠️ | `/ai` | `ai.copilot.use` | **Stand-in** — rule-based intent matcher, no LLM key configured |
| WhatsApp ⚠️ | `/whatsapp` | public webhook + `ai.copilot.use` for `/simulate` | **Stand-in** — no WhatsApp Business credentials; webhook logs payloads, `/simulate` exercises the flow locally |
| Observability | `/observability` | public | `/ready` (DB connection check), `/metrics` (uptime/memory) |

⚠️ = clearly-marked stand-in. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what swapping in a real provider would look like.

Full request/response schemas for every endpoint are in Swagger UI at `/api-docs` once the server is running.

### Authentication & RBAC

Identity is split into **Account** (a phone number — global, not role-bound) and **Profile** (a role-bound actor — every authenticated action happens *as* a profile, never directly as an account). One phone number can hold several profiles at once — e.g. a PARENT profile and a TEACHER profile on the same account — which is exactly the multi-profile pattern this mirrors.

**Login flows:**
- `POST /auth/otp/request` → `{ phone }` — creates the account if new, generates a 6-digit OTP. **Stand-in**: no SMS provider configured, so the code is logged server-side and echoed back as `devOtp` outside production only.
- `POST /auth/otp/verify` → `{ phone, code }` — verifies the OTP, then resolves a session (see below).
- `POST /auth/login` → `{ email, password }` — password login for staff/admin accounts, same session resolution.

**Session resolution** after either flow:
- **Exactly one profile** → auto-selected, returns a full `accessToken` + `refreshToken` + `permissions` map.
- **Zero profiles** → always errors, regardless of the setting below.
- **Multiple profiles** → behavior depends on `MULTI_PROFILE_ENABLED`:
  - `true` (default) → returns a *pre-session* `accessToken` (no profile bound yet) plus the profile list. A pre-session token can only call `/auth/profile/select`, `/profiles`, `/auth/refresh`, `/auth/logout` — every permission-gated route 403s until a profile is selected.
  - `false` → auto-selects the most recently created profile and returns a full session immediately (`autoSelected: true` in the response), skipping the selection step — use this when nobody in your deployment actually holds more than one role.
- `POST /auth/profile/select` → `{ profileId }` — upgrades a pre-session into a full session.

**Session lifecycle:**
- Access tokens are short-lived JWTs (`ACCESS_TOKEN_EXPIRES_IN`, default 15m).
- `POST /auth/refresh` → `{ refreshToken }` exchanges a refresh token for a new access+refresh pair, **rotating** it — the old refresh token is revoked immediately, so reuse fails.
- `POST /auth/logout` → revokes one refresh token if given, or every active session on the account if not (logout-everywhere).
- `GET /auth/me` and `GET /profiles` return the current profile and the full profile list respectively.

**Permission enforcement:** every protected route runs `authenticate` (verifies the JWT, loads the account + profile + role) then `requirePermission('<key>')` (403s if the resolved role lacks that key). Roles and permissions are MongoDB documents, not hardcoded — `npm run seed` loads the starter catalog (see [src/constants/permissions.js](src/constants/permissions.js)), but admins can create new permission keys and roles, and assign/revoke permissions on any role at runtime via `/roles` and `/permissions`, with zero redeploy.

**Onboarding new profiles:** `POST /auth/register` → `{ name, phone, roleKey, email?, password? }` attaches a new role-bound profile to an account, creating the account if it doesn't exist. Call it twice with the same phone and different `roleKey` to give one person two profiles.

**Demo users:** `npm run seed` creates one demo account per system role (see [src/constants/demoUsers.js](src/constants/demoUsers.js)) so every category can be logged into and tested immediately — change/remove these in production.

| Role | Login method | Credentials |
|---|---|---|
| OWNER | `POST /auth/login` | `owner@schoolerp.com` / `ChangeMe123!` |
| ADMIN | `POST /auth/login` | `admin@schoolerp.com` / `ChangeMe123!` |
| PRINCIPAL | `POST /auth/login` | `principal@schoolerp.com` / `ChangeMe123!` |
| TEACHER | `POST /auth/login` | `teacher@schoolerp.com` / `ChangeMe123!` |
| FINANCE | `POST /auth/login` | `finance@schoolerp.com` / `ChangeMe123!` |
| LIBRARIAN | `POST /auth/login` | `librarian@schoolerp.com` / `ChangeMe123!` |
| WARDEN | `POST /auth/login` | `warden@schoolerp.com` / `ChangeMe123!` |
| PARENT | OTP (`/auth/otp/request` → `/auth/otp/verify`) | phone `+910000000007`, no password set |
| STUDENT | OTP (`/auth/otp/request` → `/auth/otp/verify`) | phone `+910000000008`, no password set |

PARENT and STUDENT are OTP-only by design — they have no `passwordHash`, matching how guardians/students are expected to authenticate in production. Staff roles get both: a password *and* OTP would work for them since their accounts also have a phone number.

---

## Response Format

All endpoints return a consistent JSON envelope:

**Success**
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { }
}
```

**Paginated Success**
```json
{
  "success": true,
  "message": "Records fetched",
  "data": [ ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  }
}
```

**Error**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": ["Name is required", "Email is invalid"]
}
```

---

## Logging

Winston writes logs to three destinations simultaneously:

| Destination | Format | Details |
|---|---|---|
| Console | Colorized + human-readable (dev) / JSON (prod) | All levels |
| `logs/YYYY-MM-DD-error.log` | JSON | `error` level only |
| `logs/YYYY-MM-DD-combined.log` | JSON | All levels |
| `logs/YYYY-MM-DD-exceptions.log` | JSON | Uncaught exceptions |
| `logs/YYYY-MM-DD-rejections.log` | JSON | Unhandled promise rejections |

Log files rotate daily, are zipped after rotation, and are retained for **30 days**.

---

## Adding a New Module

Each module lives under `src/modules/<module-name>/` and follows this structure:

```
src/modules/students/
├── student.model.js       ← Mongoose schema
├── student.routes.js      ← Express Router + Swagger JSDoc comments
├── student.controller.js  ← Request/response handling
├── student.service.js     ← Business logic + DB queries
└── student.validation.js  ← Input validation rules
```

Then register the routes in `src/routes/index.js`:

```js
import studentRoutes from '../modules/students/student.routes.js';
router.use('/students', studentRoutes);
```

---

## Security

- **Helmet** — sets secure HTTP headers
- **CORS** — configurable allowed origins
- **Rate limiting** — 100 requests / 15 min per IP by default
- **Compression** — gzip response compression
- **Body size limit** — 10 MB max for JSON / URL-encoded payloads
- **Operational errors** — stack traces are never leaked in production responses

---

## License

ISC
