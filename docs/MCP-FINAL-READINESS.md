# EduOS MCP — Final Pre-Staging Readiness

The last pass before staging. It closed the functional and testing gaps left
by the production-readiness pass. It added no MCP tools and changed no
architecture: the catalog is the same 137 tools, and every change below is a
bug fix, a test, a check or a document.

Nothing was deployed, nothing was committed, and the live Atlas database was
never connected to. Every result here was produced against the in-memory test
replica set (`tests/setup.js`).

Companion documents: [MCP-PRODUCTION-READINESS.md](./MCP-PRODUCTION-READINESS.md) (deployment and
operations), [MCP-STAGING-TEST-PLAN.md](./MCP-STAGING-TEST-PLAN.md) (manual staging checks),
[MCP-WRITE-TEST-MATRIX.md](./MCP-WRITE-TEST-MATRIX.md) (all 68 write tools),
[MCP-DATA-REVIEW.md](./MCP-DATA-REVIEW.md) (data exposure and write review),
[MCP-TOOLS.md](./MCP-TOOLS.md) (catalog and role matrix).

---

## 1. What this pass found and fixed

| # | Problem | Found by | Fix |
|---|---|---|---|
| 1 | A teacher asking "Show Rahul's attendance" got their own summary (`get_attendance`), not Rahul's: the named-student rule required school-wide `attendance.read`. | the report | Rule matches at any scope (`intent.js`); the student is resolved at the caller's own scope, so a teacher finds only their pupils. |
| 2 | Student names matched by substring: "Riya" answered for **Priya**. | `mcp.routing` | `resolveStudentId` requires whole-word matches; a near miss is offered as a question, never answered for. |
| 3 | "What is his attendance?" answered for nobody (or a teacher's whole class). | `mcp.routing` | The student is carried forward from the caller's own previous message; with no context the tool asks "Which student?". |
| 4 | A teacher's "my attendance" read out their class as if it were theirs. | `mcp.routing` | Says there is no personal record. |
| 5 | `bulk_mark_attendance` **never worked through MCP** — it passed rows in a shape the service did not read and refused every call. | `mcp.writes.coverage` | Rows translated to the service's contract. |
| 6 | `create_exam`, `create_exam_subject` and `upsert_timetable_slot` accepted another school's term, offering or section id. | `mcp.writes.coverage` (wrong-school tests) | Existence checks in `exam.service` and `timetable.service` — REST gets them too. |
| 7 | `notify_users` accepted recipient ids from another school. | `mcp.writes.coverage` design | `notification.service.recipientsInSchool()`, checked before confirmation. |
| 8 | `/health` did not check the database. | the report | Pings MongoDB; 503 when it does not answer; reveals nothing about the target. |
| 9 | Nothing stopped a non-production process connecting to production — and `backend/.env` points at live Atlas. | the report | Startup guard in `connectDB()` + `scripts/staging-preflight.js`. |

## 2. Evidence

### Full regression — `cd backend && AI_PROVIDER=rules npx vitest run`

| Files | Tests | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| **60** | **1,352** | **1,352** | **0** | **0** | 619 s |

Previous baseline: 56 files, 1,078 tests. This pass added 4 files and 274 tests (`mcp.routing` 11,
`mcp.writes.coverage` 243, `mcp.catalog` 13, `db.guard` 7).

The first full run of this pass finished 1,350 passed, 2 failed: one WhatsApp end-to-end scenario hit the 30 s limit
under full-suite load, and the cross-channel comparison that depends on it failed with it. The file passed 25/25 in
isolation; its limit was raised to 60 s (reason recorded in the file) and the full suite was run again — the result
above.

| Category | Tests (all passed) |
|---|---|
| MCP (14 `mcp.*` suites) | 548 |
| Website end-to-end (real HTTP) | 42 |
| WhatsApp end-to-end (signed webhook) | 69 |
| Security (MCP security, exposure, arbitrary access) | 86 |
| Authorization (role, scope, tenancy) | 188 |
| Action (writes executed or refused through MCP, e2e) | 53 |
| Confirmation (propose, confirm, replay, expiry, races) | 26 |
| RAG and RAG+MCP | 2 |
| Timeouts, concurrency, failure handling | 17 |
| Teacher named-student routing | 11 |
| Write-tool coverage — 68 tools through MCP | 243 |
| &nbsp;&nbsp;execution with DB + audit verified | 69 |
| &nbsp;&nbsp;outsider role refused | 69 |
| &nbsp;&nbsp;wrong scope refused | 20 |
| &nbsp;&nbsp;wrong school refused | 56 |
| &nbsp;&nbsp;confirmation battery (high-risk tools) | 28 |
| Catalog parity + health | 13 |
| Staging safety (database guard) | 7 |

Categories overlap (a WhatsApp confirmation test is both); each is defined by file and test path in the count
script, not estimated.

### Teacher routing — `tests/mcp.routing.test.js` (11 tests)

| Case | Result — tool verified from the MCP audit entry |
|---|---|
| 1 Student in the teacher's class | `get_student_attendance`, `studentName: "Rahul"`, Rahul's enrolment |
| 2 Student outside the teacher's scope | `get_student_attendance` → "No student named "Riya". Did you mean: Priya Verma (OAK-2)?" — no data; a school-wide reader does find her |
| 3 "What is my attendance?" | `get_attendance` — no pupil's data |
| 4 "show my attendance" | `get_attendance` |
| 5 "Show Rahul's attendance." | as case 1 |
| 6 "what is his attendance?" after a named question (WhatsApp) | `get_student_attendance`, `studentName: "Rahul"` carried forward; without context (website) → "Which student?" |
| 7 Ambiguous name (two Arjuns) | "More than one student matches "Arjun": … Which one?" — no data |
| 8 Similar names (Rahul Sharma in class, Rahul Verma not) | teacher: only their Rahul; administrator: asked which |
| + | parent → own child; student → classmate not found; same tool on WhatsApp as on the website |

### Write-tool coverage — `tests/mcp.writes.coverage.test.js`

All **68** write tools are executed **through MCP** (`executeToolCall` in an MCP session — the server path the MCP
client uses), by a person built exactly as the auth middleware builds them, against the real services and MongoDB.
For each: the database footprint changes as expected, and the MCP audit entry is `EXECUTED` for that person with the
right `confirmed` flag. Then: a role without the permission is refused (69 cases); a holder acting outside their
scope is refused (20); another school's administrator is refused (56); and for all 28 high-risk tools the full
confirmation battery passes. Per-tool results: [MCP-WRITE-TEST-MATRIX.md](./MCP-WRITE-TEST-MATRIX.md).

No write tool was left unexecuted. Two run against stand-ins, stated in the matrix: `send_whatsapp_message` against a
stubbed Meta Graph API (exactly one request, to exactly the confirmed number, with exactly the confirmed text), and
`generate_homework` without an AI model (the homework is created without a generated description, and the tool says so).

### Confirmation cannot be bypassed

For **every** high-risk tool (HIGH, CRITICAL or DELETE — 28), called straight at the MCP server:

| Attempt | Result | Database |
|---|---|---|
| No confirmation (direct call) | `confirmation_required` only | unchanged |
| Wrong token (never issued) | refused | unchanged |
| Token presented against another tool | refused; token not consumed | unchanged |
| Expired token | refused | unchanged |
| Another user's token (same role) | refused | unchanged |
| Another school's session | refused | unchanged |
| Permission removed before the yes | refused `FORBIDDEN` | unchanged |
| Two simultaneous confirmations | exactly one runs | changed once |
| Reused token | refused | unchanged after the one run |

"Unchanged" is asserted twice: the tool's database footprint is identical, and the MCP server recorded no
`EXECUTED`, `FAILED` or `ERROR` — the tool never started. The same seven cases also pass over real HTTP for a payment
(`mcp.confirmation`), including a permission removed in the database between proposal and yes.

### Role and scope for writes

Every case uses the real permission catalog: the performing role holds the permission at the scope the tool needs;
the outsider is the first seeded role whose live permission map lacks it; wrong-scope actors are real people holding
the permission at OWN (a second teacher, a parent for another child, a teacher on a school-wide tool); the wrong-tenant
actor is a real Riverside administrator. Nothing keys off a role name.

### Catalog — `tests/mcp.catalog.test.js`

- `node backend/scripts/mcp-catalog.js --write` → **137 tools** (69 GET, 21 CREATE, 12 UPDATE, 6 DELETE, 29 ACTION).
- **135 AVAILABLE**, **2 PARTIAL** (`get_growth_score` — heuristic stand-in service; `get_at_risk_students` — caches its computed rows), **2 compatibility aliases** (`apply_leave`, `record_fee_payment`), **1 deprecated** implementation entry (`record_fee_payment` in `agent/tools.js`, not in the catalog), **13 blocked** capabilities (no tool, with reasons).
- The generated `docs/mcp-tools.json` matches the running registry tool for tool (operation, permission, scope, risk, confirmation).
- For all 8 roles, `GET /ai/agent/capabilities`, MCP `tools/list` (through the real client) and the registry filter return **the same** tool list, matching the role matrix; unauthenticated → 401 / empty.

### Frontend

`npm run typecheck` (tsc) exit 0; `npm run build` (next build) exit 0. The `AgentTool` shape
(`{ name, description, mutates }`) the capabilities endpoint serves is asserted per role in `mcp.catalog`. No
frontend file was changed.

### Health — `GET /api/v1/health`

Implemented: production readiness needs it — a load balancer probing a process-only health check keeps routing to an
instance that has lost its database. It pings MongoDB with a 1.5 s limit: `200 { status: "ok", database: "ok" }` or
`503 { status: "degraded", database: "unavailable" }`, with no host, name or error text (tested both ways).

### Staging safety

- **Startup guard** (`config/db.js` → `assessDatabaseTarget()` in `config/env.js`): outside production, a host in `PRODUCTION_DB_HOSTS` is always refused, and any remote cluster needs `ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true`. Runs before connecting, so before `bootstrap()` can write. `tests/db.guard.test.js` (7).
- **Preflight** (`scripts/staging-preflight.js`): checks NODE_ENV, MONGO_URI, MONGO_URI_ATLAS, PRODUCTION_DB_HOSTS, the guard, the database name, the medical key (real, and different from production by SHA-256), JWT and WhatsApp secrets, payment mode. Connects to nothing; prints no secret or host.
- **Run against this checkout's current `backend/.env`, the preflight fails 6 checks** — NODE_ENV is not `staging`, `MONGO_URI_ATLAS` is set, `MONGO_URI` is a remote cluster, and the three staging-only settings are missing. That configuration must not be used for staging.
- No staging database exists in this environment, and none was created. The exact configuration required is in MCP-PRODUCTION-READINESS.md §3 and MCP-STAGING-TEST-PLAN.md §0.

## 3. Final status

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MCP single tool layer | COMPLETE | Only `mcp/tools/_shared.js` and `mcp/server.js` run a tool body; `mcp.architecture` source scans; every write in `mcp.writes.coverage` enters through `executeToolCall` |
| Website integration | COMPLETE | Real HTTP (JWT → middleware → controller → agent → MCP client/server → service → DB): `mcp.readiness.e2e`, `mcp.e2e`, `mcp.routing`, `mcp.confirmation`, `mcp.resilience`, `mcp.catalog` |
| WhatsApp integration | COMPLETE | Signed webhook → phone identity → tenant → memory → agent → MCP: `mcp.readiness.e2e`, `mcp.e2e`, `mcp.routing` (follow-up), `mcp.confirmation` (YES/second YES); same tool as the website asserted |
| GET | COMPLETE | 69 read tools × 8 roles (`mcp.contract`, `mcp.exposure`) |
| CREATE | COMPLETE | 21/21 executed through MCP with DB + audit (`mcp.writes.coverage`) |
| UPDATE | COMPLETE | 12/12 executed |
| ACTION | COMPLETE | 29/29 executed, including `bulk_mark_attendance` after its fix |
| DELETE | COMPLETE | 6/6 executed, each through the confirmation battery |
| Role filtering | COMPLETE | Capabilities = tools/list = registry for 8 roles (`mcp.catalog`); visible ⇔ executable for every role + custom role (`mcp.security`); outsider refused for all 68 writes |
| Scope | COMPLETE | 20 wrong-scope write refusals; teacher named-student scope (`mcp.routing`); OWN-scope reads (`mcp.security`) |
| Tenant isolation | COMPLETE | 56 wrong-school write refusals — which found and fixed 4 service gaps; cross-school tokens refused in every battery |
| Confirmation | COMPLETE | 28 high-risk tools × 9 attempts (`mcp.writes.coverage`); 7 cases over HTTP (`mcp.confirmation`); timeouts never double-run (`mcp.resilience`) |
| Audit | COMPLETE | Every execution asserts its `EXECUTED` entry (actor, confirmed flag); refusals assert the tool never started |
| Idempotency | COMPLETE | Simultaneous confirmation runs once for every high-risk tool; replay refused; service idempotency (`mcp.security`) |
| Data exposure | COMPLETE | Every read tool × 8 roles scanned for system fields, credentials, secrets, photo; overview per role (`mcp.exposure`); server-side redaction backstop |
| RAG separation | COMPLETE | RAG only when no tool fits; RAG+MCP adds text beside live data (`mcp.e2e`). Known limit: RAG indexes announcements only |
| Teacher routing | COMPLETE | `mcp.routing` — all 8 requested cases, tool verified from the audit trail |
| Write test coverage | COMPLETE | 68/68 write tools executed through MCP with DB + audit + authorization ([matrix](./MCP-WRITE-TEST-MATRIX.md)) |
| Frontend typecheck | COMPLETE | tsc exit 0; next build exit 0; `AgentTool` shape asserted |
| Staging readiness | PARTIAL | Guard, preflight, health check, test plan and exact configuration are in place and tested. The staging environment itself does not exist yet, and the current `.env` fails the preflight (6 checks) — by design it cannot be used |

## 4. Known limitations carried into staging

- **RAG corpus is announcements only** — not the documents module.
- **Website turns carry no conversation memory**, so "what is his attendance?" on the website asks which student; WhatsApp carries the subject forward.
- **A model is needed for** compound actions such as "send a message to Rahul's parent" (look up the guardian, then send) and "find students with pending fees and prepare a reminder" (the reminder is a separate, confirmed proposal). With `AI_PROVIDER=rules` the assistant says it is not sure rather than guessing.
- **`send_whatsapp_message` real delivery** is verified on staging (plan W8); automated tests use a stubbed Graph API.
- **Role policy**: FINANCE and LIBRARIAN hold `students.read` at ALL and can therefore request guardian contacts — a policy decision for the school, unchanged here.
- **Full-suite timing on this laptop**: the first full run of this pass timed out one WhatsApp end-to-end test at 30 s under load (it passes in isolation in about a second); that file's limit was raised to 60 s with the reason recorded.

## 5. Decision

Every functional and testing requirement is COMPLETE with executed evidence; the full suite passes 1,352 / 1,352.
The one PARTIAL row is the staging environment itself, which by instruction was not created: the code, the guard,
the preflight and the exact configuration are ready, and the preflight refuses the current production-pointing
configuration. Staging may begin once an operator provisions the separate staging database and
`NODE_ENV=staging node scripts/staging-preflight.js` passes — then the manual plan in
[MCP-STAGING-TEST-PLAN.md](./MCP-STAGING-TEST-PLAN.md) is run on both channels.

This is not a production-readiness statement. Production is a separate decision after staging validation.

**READY FOR STAGING**
