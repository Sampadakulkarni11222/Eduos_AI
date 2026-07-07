# Application Architecture & Request Flow

This document explains how the School ERP backend is structured, how a request travels through the system, and where each layer of code lives.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT / BROWSER                           │
│                  (Postman, Frontend App, Mobile)                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │  HTTP Request
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            src/app.js                               │
│                         (Express App Core)                          │
│                                                                     │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │   Helmet    │  │   CORS   │  │ Compression  │  │BodyParser  │  │
│  └─────────────┘  └──────────┘  └──────────────┘  └────────────┘  │
│                        Global Middleware                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Request Logger (Morgan)                        │
│              Logs: METHOD /path status ms - bytes                   │
│              Piped into Winston → logs/combined.log                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Rate Limiter Middleware                        │
│     100 req / 15 min per IP  →  429 Too Many Requests if exceeded  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                     ▼                       ▼
          ┌─────────────────┐     ┌──────────────────────┐
          │   /api-docs     │     │     /api/v1           │
          │  Swagger UI     │     │   API Router          │
          └─────────────────┘     └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  src/routes/index.js │
                                  │  (Route Registry)    │
                                  │                      │
                                  │  GET /health         │
                                  │  /auth  → authRoutes │
                                  │  /students → ...     │
                                  │  /teachers → ...     │
                                  │  /fees → ...         │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Module Router       │
                                  │  (e.g. student.      │
                                  │   routes.js)         │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Controller          │
                                  │  (asyncHandler wrap) │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Service Layer       │
                                  │  (Business Logic)    │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Mongoose Model      │
                                  │  (MongoDB Query)     │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │      MongoDB         │
                                  └──────────────────────┘
```

---

## Request Lifecycle — Step by Step

Below is the exact path a request takes from the moment it arrives to when the response is sent back.

### Step 1 — App Bootstrap (`src/app.js`)

When the server starts, `bootstrap()` runs:

1. `connectDB()` — opens Mongoose connection to MongoDB
2. `app.listen()` — starts the HTTP server
3. Logger prints the running URL and docs URL

### Step 2 — Global Middleware (applied to every request)

| Order | Middleware | Purpose |
|---|---|---|
| 1 | `helmet()` | Sets 15+ secure HTTP headers (XSS, clickjack, etc.) |
| 2 | `cors()` | Adds `Access-Control-Allow-Origin` header |
| 3 | `compression()` | gzip-compresses responses > 1 KB |
| 4 | `express.json()` | Parses `Content-Type: application/json` body |
| 5 | `express.urlencoded()` | Parses HTML form bodies |
| 6 | `requestLogger` | Logs the HTTP line via Morgan → Winston |
| 7 | `rateLimiter` | Checks IP request count; blocks at limit |

### Step 3 — Route Matching

Express matches the URL path:

```
/api-docs          →  Swagger UI (no auth needed)
/api-docs.json     →  Raw OpenAPI JSON
/api/v1/*          →  API router (src/routes/index.js)
```

Inside `/api/v1`, the route registry forwards to the matching module router:

```
/api/v1/health     →  inline health handler
/api/v1/auth/*     →  auth module routes  (future)
/api/v1/students/* →  student module routes  (future)
```

### Step 4 — Module Router

Each module has its own Express Router. Example for a future student module:

```
GET    /api/v1/students        → listStudents controller
POST   /api/v1/students        → createStudent controller
GET    /api/v1/students/:id    → getStudent controller
PUT    /api/v1/students/:id    → updateStudent controller
DELETE /api/v1/students/:id    → deleteStudent controller
```

### Step 5 — Controller (via `asyncHandler`)

The controller is wrapped in `asyncHandler` so any thrown error is automatically forwarded to Express's error middleware — no try/catch needed in every controller.

```js
// What you write:
export const getStudent = asyncHandler(async (req, res) => {
  const student = await StudentService.findById(req.params.id);
  sendSuccess(res, student, 'Student fetched');
});

// asyncHandler does this for you behind the scenes:
try {
  await fn(req, res, next);
} catch (err) {
  next(err);   // ← sends to errorHandler middleware
}
```

### Step 6 — Service Layer

The service layer holds all **business logic** and **database queries**. Controllers stay thin — they only read from `req` and write to `res`. Services are plain async functions (no Express types), which makes them easy to unit test.

```js
// student.service.js
export const findById = async (id) => {
  const student = await Student.findById(id);
  if (!student) throw new AppError('Student not found', 404);
  return student;
};
```

### Step 7 — Mongoose Model (Database)

The Mongoose model translates the service call into a MongoDB query. Schema validation, indexes, virtuals, and hooks (pre-save, post-save) all live here.

### Step 8 — Response

The response is sent using one of three helpers in `src/utils/response.js`:

| Helper | Status | Use case |
|---|---|---|
| `sendSuccess(res, data, message)` | 200 | Single resource or action result |
| `sendPaginated(res, data, meta, message)` | 200 | List endpoints with pagination |
| `sendError(res, message, statusCode, errors)` | 4xx/5xx | Called by error handler |

---

## Error Flow

When anything throws (controller, service, Mongoose), the error travels this path:

```
throw new AppError('Not found', 404)
          │
          ▼  (asyncHandler catches it)
      next(err)
          │
          ▼
  errorHandler middleware (src/middleware/errorHandler.js)
          │
          ├─ Mongoose CastError      →  400 Invalid ID
          ├─ Mongoose ValidationError →  422 Validation failed
          ├─ Mongoose Duplicate key  →  409 Conflict
          ├─ AppError (operational)  →  statusCode from AppError
          └─ Unknown error           →  500 Internal server error
                                         (stack hidden in prod)
          │
          ▼
  sendError(res, message, statusCode, errors)
```

In **development**, the raw stack trace is included in the `errors` array for unknown errors. In **production**, only `"Internal server error"` is returned.

---

## Logging Architecture

```
HTTP Request
    │
    ▼
Morgan (requestLogger middleware)
    │  writes a stream message
    ▼
Winston HTTP transport
    │
    ├──▶ Console   (colorized in dev, JSON in prod)
    ├──▶ logs/YYYY-MM-DD-combined.log
    └──▶ logs/YYYY-MM-DD-error.log   (errors only)

App code: logger.info() / logger.error() / logger.warn()
    │
    ├──▶ Console
    ├──▶ logs/YYYY-MM-DD-combined.log
    └──▶ logs/YYYY-MM-DD-error.log

Uncaught exceptions / unhandled rejections
    │
    └──▶ logs/YYYY-MM-DD-exceptions.log
         logs/YYYY-MM-DD-rejections.log
```

Logs rotate at midnight, old files are gzip-compressed, and files older than 30 days are deleted automatically.

---

## Build Pipeline

```
src/app.js  (ES Module source)
      │
      │  npm run build
      ▼
esbuild.config.js
      │
      │  Bundles all src/ files into one output
      │  External: node_modules (not bundled, loaded at runtime)
      │  Format: ESM
      │  Target: Node 18
      ▼
dist/app.js  (single file, minified for prod)
      │
      │  npm start
      ▼
node dist/app.js
```

---

## Module Anatomy (for future modules)

When you add a new module (e.g., `students`), create these five files:

```
src/modules/students/
│
├── student.model.js
│     └─ Mongoose Schema + Model export
│         - Field definitions with types, required, defaults
│         - Indexes for query performance
│         - Virtuals (computed fields)
│         - Pre/post hooks (e.g., hash password before save)
│
├── student.validation.js
│     └─ Input validation rules
│         - Validate req.body shape before hitting the controller
│         - Returns 422 with field-level error messages on failure
│
├── student.service.js
│     └─ Business logic layer
│         - All Mongoose queries go here (find, create, update, delete)
│         - Throws AppError for not-found, conflict, etc.
│         - No Express req/res — pure async functions
│
├── student.controller.js
│     └─ HTTP layer
│         - Reads from req.body / req.params / req.query
│         - Calls service functions
│         - Calls sendSuccess / sendPaginated
│         - Wrapped in asyncHandler (no try/catch needed)
│
└── student.routes.js
      └─ Express Router
          - Defines URL paths and HTTP methods
          - Applies validation middleware before controller
          - Contains JSDoc Swagger annotations
          - Exported and registered in src/routes/index.js
```

---

## Planned Modules

| Module | Description |
|---|---|
| `auth` | Login, register, JWT issue/refresh, logout |
| `students` | Student profiles, enrollment, transfers |
| `teachers` | Staff profiles, subjects, schedules |
| `classes` | Class/section management |
| `subjects` | Subject catalogue, assignment to classes |
| `attendance` | Daily attendance tracking |
| `fees` | Fee structure, payments, receipts |
| `exams` | Exam schedules, marks entry, results |
| `timetable` | Weekly timetable per class |
| `notices` | Announcements and circulars |
| `library` | Book inventory, issue/return |
| `transport` | Routes, buses, student allocation |

---

## Configuration Files at a Glance

| File | Purpose |
|---|---|
| `src/config/env.js` | Single source of truth for all env variables. Import `env` everywhere instead of reading `process.env` directly. |
| `src/config/db.js` | Mongoose connect with timeout options. Listens for disconnect/reconnect events and logs them. |
| `src/config/swagger.js` | OpenAPI spec definition: info, servers, shared component schemas, and security scheme. Routes add their own `@swagger` JSDoc comments. |
| `esbuild.config.js` | Bundles `src/` into `dist/app.js`. Keeps `node_modules` external. Minifies for prod, adds sourcemaps for dev. |
