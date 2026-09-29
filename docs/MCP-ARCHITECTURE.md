# EduOS MCP Architecture

How the Ask AI feature works after the MCP migration, and why it is shaped this
way. For the tool list see [MCP-TOOLS.md](./MCP-TOOLS.md); for the security
model see [MCP-SECURITY.md](./MCP-SECURITY.md); for the repository audit this
was built from see [MCP-AUDIT.md](./MCP-AUDIT.md).

---

## The shape

```
                         USER
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   Website chatbot                WhatsApp agent
   ask-eduos.tsx                  Meta webhook
   POST /ai/agent                 resolveActorByPhone
            │                           │
            └─────────────┬─────────────┘
                          ▼
              SHARED AI AGENT  (agent/orchestrator.js)
              rate limit · injection check · intent → plan
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        MCP CLIENT                RAG  (agent/rag.js)
      (mcp/client.js)         school's written material
              │                       │
              ▼                       │
        MCP SERVER                    │
      (mcp/server.js)                 │
   identity · authorization ·         │
   tenancy · validation ·             │
   confirmation · audit               │
              │                       │
              ▼                       │
       MCP TOOL REGISTRY              │
      (mcp/tools/*.js)                │
              │                       │
              ▼                       │
       EXISTING EduOS SERVICES        │
       src/modules/*/*.service.js     │
              │                       │
              ▼                       │
           DATABASE                   │
              │                       │
              └───────────┬───────────┘
                          ▼
              RESPONSE COMPOSITION  (agent/response.js)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        Website reply           WhatsApp reply
```

The two channels differ in exactly four things: how the caller is
authenticated, how conversation history is stored, how the reply is formatted,
and how a confirmation is collected. Everything between — tool selection,
authorization, tenancy, execution, audit — is one code path.

## Files

| Path | Role |
|---|---|
| `backend/src/modules/ai/mcp/server.js` | **MCP server.** The security boundary: identity, authorization, tenancy, validation, confirmation, execution, audit. Also `executeToolCall()`, callable directly by tests and by a future transport. |
| `backend/src/modules/ai/mcp/client.js` | **MCP client.** One shared instance, connected over an in-process transport. `listTools()`, `callTool()`, `withMcpSession()`. |
| `backend/src/modules/ai/mcp/registry.js` | **Tool registry.** Assembles the catalog, computes role-filtered discovery, validates itself at boot. |
| `backend/src/modules/ai/mcp/tools/*.js` | The tools themselves, one file per module area. |
| `backend/src/modules/ai/mcp/session.js` | Trusted identity. Opaque per-turn handles; the list of argument names the server refuses to read. |
| `backend/src/modules/ai/mcp/protocol.js` | The result envelope and the error codes. |
| `backend/src/modules/ai/mcp/validate.js` | JSON Schema validation and the field allow-list helper. |
| `backend/src/modules/ai/mcp/confirm.js` | The confirmation store, on top of the existing `AgentAction` collection. |
| `backend/src/modules/ai/agent/orchestrator.js` | The shared AI agent. Unchanged in purpose; its tool execution now goes through MCP. |
| `backend/src/modules/ai/agent/intent.js` | Intent → tool plan. Rules first, then a model given the MCP tool schemas. |
| `backend/src/modules/ai/agent/response.js` | Turns MCP results into an answer, without letting the model invent facts. |
| `backend/src/modules/ai/agent/rag.js` | Knowledge retrieval over the school's written material. Unchanged. |
| `backend/scripts/mcp-catalog.js` | Generates `docs/MCP-TOOLS.md` and `docs/mcp-tools.json` from the registry. |

## One execution layer

Every ERP read and write the assistant performs is executed by the MCP server
and nothing else. That is a property of the *absence* of any other path, so it
is enforced by `backend/tests/mcp.architecture.test.js`, which reads the source:

| Claim | How it is enforced |
|---|---|
| Only the MCP layer runs a tool implementation | The only `.execute(` on a tool in `src/` is the wrapper in `mcp/tools/_shared.js`. |
| The agent executes nothing | `orchestrator.js` contains no `.execute(`, `getTool(`, `legacyTurn`, `confirmLegacyAction` or `snapshotState`. |
| Only MCP creates action proposals | `AgentAction.create(` appears only in `mcp/confirm.js`, and `proposeAction()` refuses any name that is not an MCP tool. |
| `agent/tools.js` is an implementation library, not a path | It is imported only by the MCP registry and wrapper — and by `intent.js` for a discovery fallback that executes nothing. |

What used to sit outside MCP, and where it went:

- **The degraded fallback** (`runAgentSafely`, when the model fails) used to run
  the matched tool directly, skipping authorization-by-MCP, tenancy re-entry
  and the audit entry. It now calls the same MCP tool through a fresh session.
- **The legacy turn and legacy confirmation paths** are deleted. A proposal
  stored by the pre-MCP code under an old name (`apply_leave`,
  `record_fee_payment`) is redeemed by the MCP tool that replaced it, via
  `LEGACY_TOOL_ALIASES` in `mcp/confirm.js`. Proposals expire after ten minutes
  and the collection's TTL index deletes them, so that two-entry map can be
  removed any time after the first MCP deploy plus ten minutes.
- **Register-photo drafts** (`attendance/ocr.service.js`) used to write
  `AgentAction` rows directly — a proposal the MCP server had never validated,
  whose `note` field its schema then refused at confirmation. They now propose
  through the MCP `mark_attendance` tool like any typed request.
- **The WhatsApp arrival briefing** reads through MCP.
- **`/ai/chat`** and `ai.service.js` — a second assistant with its own intent
  handlers and its own copy of retrieval, called by no screen — are removed.

## Roles and capability coverage

The authorization system defines **nine** roles, not the five the assistant was
first built around. Eight of them reach the assistant through the same path —
SUPER_ADMIN is deliberately excluded, see below — and there is no
role-specific server, intent file, question list or keyword table anywhere;
adding one would be a regression. What differs between a warden and a principal
is only the permission map their session carries, from which the same registry
yields a different capability set. The exclusion works the same way: it is a
permission SUPER_ADMIN does not hold, not a rule about its name.

The registry holds **173 capabilities, 89 of them writes**: GET 84, CREATE 33,
UPDATE 15, DELETE 10, ACTION 31.

| Role | Granted permissions | Capabilities visible | Writes |
|---|---|---|---|
| `SUPER_ADMIN` | 80 | **0 — excluded** | 0 |
| `ADMIN` | 72 | 172 | 88 |
| `PRINCIPAL` | 32 | 77 | 24 |
| `STUDENT` | 24 | 62 | 13 |
| `TEACHER` | 28 | 58 | 17 |
| `PARENT` | 18 | 43 | 3 |
| `FINANCE` | 12 | 31 | 10 |
| `WARDEN` | 11 | 29 | 8 |
| `LIBRARIAN` | 9 | 28 | 7 |

The route-by-route audit of 2026-09-24 found six single-row web operations with
no capability, each hidden by a neighbour that already declared its permission:
`create_academic_year`, `create_term`, `create_grade`, `create_subject`
(ADMIN, PRINCIPAL), `add_guardian` (ADMIN) and `request_payment_change`
(ADMIN, FINANCE). Adding them also tightened two services the web shares:
`addGuardian()` now only links a profile from the acting school and writes only
the link's own fields, and `createTerm()` refuses an academic year from another
school. Pinned by `mcp.structureParity.test.js`.

### The parity model

What the assistant may do is defined by what the signed-in person may already
do on the web, and by nothing else:

```
   WEB OPERATION                    a real route, with its own gate
        │                           requirePermission(key[, 'ALL']) (+ requireRole)
        ▼
   AUTHORIZED SERVICE               the same actor-aware service the route calls
        │
        ▼
   MCP CAPABILITY                   declares that permission, and its minScope
        │
        ▼
   SAME ACTOR / SCOPE / TENANT      identity from the session; scope from the
                                    live permission map; tenant from the
                                    request's own AsyncLocalStorage state
```

Two properties are asserted rather than asserted-to-be-true:

- **MCP never exceeds the web.** No capability declares a permission that no
  route uses, no role is offered a capability whose permission it does not
  hold, and no role is offered an `ALL`-scoped capability at `OWN` scope.
- **MCP covers what the web offers**, for every MCP-eligible operation. The
  exclusions below are the operations that are *not* eligible, each for a
  stated reason.

`backend/tests/mcp.roleCoverage.test.js` compares the two surfaces for every
role, reading the roles from `SYSTEM_ROLES` rather than from a list of its own,
so a role added later is covered the day it is added.
`backend/tests/mcp.roles.askAi.test.js` then asks each role about its own work
through both doors people use — `POST /ai/agent` and the WhatsApp webhook.

A caution learned the hard way: **permission-level coverage can hide an
operation-level gap.** A permission counts as covered when any capability
declares it, so a key whose read is exposed and whose write is not looks
complete. Both gaps found in the final parity audit were of that shape, which
is why the audit is built from route declarations rather than from permission
keys, and why the tests below call capabilities directly instead of only
through natural language.

### SUPER_ADMIN is excluded from the assistant

The platform role does not hold `ai.copilot.use`, and that single withheld
permission is the whole exclusion. Every route into the assistant already
requires it — the web agent, its confirm and capabilities endpoints, the tutor,
AI credits, and both WhatsApp entry points — so withholding it closes all of
them at once. It is **permission-based, not a role-name check**, and it is
enforced at three depths:

| Layer | Effect |
|---|---|
| `mcpToolsFor()` | returns an empty catalogue, so nothing is described |
| `authorize()` in `mcp/server.js` | refuses **before** the tool's own permission is consulted |
| the `/ai/*` routes and WhatsApp resolution | 403, and `ASSISTANT_NOT_PERMITTED` |

The middle layer is the one that matters most, and it was added because the
first two are not sufficient on their own: SUPER_ADMIN still holds
`students.read`, `attendance.read` and every other key a tool names, so an
empty catalogue alone would have left execution-by-name open. Hiding a tool is
not refusing to run it.

Result: **0 capabilities, AI assistant denied, MCP execution denied** — no tool
runs and no audit entry is written, and it cannot be bypassed by naming another
role, tenant or user in a request, because identity is re-resolved from the
session and those argument names are stripped before any tool sees them.

Why exclude it at all: SUPER_ADMIN acts across schools. A request it makes
without naming one runs outside any tenant, where the filter that confines every
other caller is absent, so an assistant answer could span schools. Writes in
that state were already refused (`assertSchoolContext`), but the assistant is a
school-level tool and a platform administrator has the console for platform
work. Nothing else about the role changes: it keeps the other 72 permissions,
`ai.insights.read` included, which drives the risk and analytics screens rather
than the assistant. Enforced end to end by
`backend/tests/ai.superAdminExcluded.test.js`.

### Dashboards are authorized by the route's own rules

`get_dashboard` takes a `view`, and the rules deciding who may read which one
live once, in `dashboard.service` as `DASHBOARD_ACCESS`. `canReadDashboard()`
reads the role from the session-resolved actor and the scope from its live
permission map; the capability calls that rather than keeping a second copy, and
`mcp.dashboardAccess.test.js` reads `dashboard.routes.js` and asserts the table
still states what the middleware states, so the two cannot drift.

Both halves of each rule matter. An earlier version authorized a view on its
permission alone, which was weaker than the route: that also requires a role
whose job the dashboard is and, for the school-wide views, the permission at
`ALL` scope. Because `students.read` and `fees.read` are held at `OWN` by
families, holding the permission at all was enough — a student asking for
`view: 'finance'` received the school's whole fee position, and `view: 'admin'`
its roll. The test is a matrix of all nine roles against all seven views,
invoked directly, asserted against what the web would answer.

### Fee configuration

`create_fee_head` and `create_fee_structure` expose what a school charges, to
`ADMIN` and `FINANCE` — the roles holding `fees.structure.manage` on the web —
school-wide only, both confirmed, and `create_fee_structure` at HIGH risk
because invoices are generated from it.

They were not exposed until the service behind them was safe to call as an
actor. `createFeeHead` and `createFeeStructure` were raw `Model.create(data)`:
they took whatever object they were handed, with no actor, no scope, no check
that the ids in it belonged to this school, no validation and no audit entry,
and authorization for them existed only on the route.
`createFeeHeadForActor()` and `createFeeStructureForActor()` add, in the shape
`document.service` established:

- **scope** — `ALL` required; there is no narrower version of what a school charges
- **a writable-field allow-list** — nothing else in the payload reaches the model, `tenantId` included, which comes from the request's own tenant state
- **tenant validation** — every referenced fee head, academic year and grade must resolve *inside* this school, so an id from another school is refused rather than stored and billed from later
- **input validation** — a whole number of paise above zero, a real date, a name within length
- **audit** — recorded with the acting profile
- **execution-time authorization** — the MCP server re-authorizes at confirmation, as for every write

Validation is split from the write (`resolveFeeStructureInput`,
`assertFeeHeadNameFree`) so the tools' `prepare()` can refuse an impossible
structure *before* a person is asked to approve it — a year or grade from
another school, a fractional amount, a name already in use. The controller now
goes through the same functions, so the route and the assistant meet identical
rules, and the unguarded pass-throughs were deleted rather than left as a way
around them.

### Permissions with no capability of their own

Twelve granted permissions have no capability that declares them, plus
`calendar.manage` at `OWN` scope, which is scope-conditional. None is a missing
feature; each is recorded in the `UNCOVERED` ledger in
`mcp.roleCoverage.test.js`, and the test fails both when a new permission
appears without a reason and when a recorded reason stops being true.

- **Reachable under another permission key** — `reportcards.read` (served by
  `get_report_card`, gated on `marks.read`, exactly as its REST route is);
  `fees.plan.review` (`plan.service.transitionFeePlan()` checks it itself, per
  transition, so the tool gates visibility on `fees.read` and the service
  enforces the real key); `analytics.school.read`, `analytics.class.read` and
  `analytics.child.read` (the dashboard views, plus `get_at_risk_students` and
  `get_growth_score`).
- **No implementation to wrap** — `settings.manage` and `attendance.regularize`
  have no module, route or service anywhere in `src/`.
- **Deliberately unavailable** — `users.manage`, `roles.manage` and
  `permissions.manage` administer the authorization system that constrains the
  assistant, so a capability there would let it widen its own reach (and bulk
  user import is a CSV upload, which MCP has no channel for). `schools.read`
  and `schools.manage` are cross-tenant and mint administrator credentials;
  every MCP call runs inside one tenant's `AsyncLocalStorage` state.
  `calendar.manage` **at `OWN` scope** is the same kind of case: a
  `CalendarEvent` has no section, so there is no event a section-scoped holder
  could safely create, and `calendar.service.create()` refuses a non-`ALL`
  actor for that reason. At `ALL` scope it is covered.

### Operations intentionally excluded from MCP

An exclusion does **not** mean the role is incomplete. The requirement is that
every MCP-**eligible** web operation is represented; these are the operations
that are not eligible, and each is pinned by an assertion rather than by prose
alone.

| Excluded | Roles affected | Why |
|---|---|---|
| The assistant itself | `SUPER_ADMIN` | Cross-school platform role; see above |
| Role and permission administration (`roles.manage`, `permissions.manage`) | `ADMIN` | Administers the authorization system that constrains the assistant |
| User management that mints credentials (`users.manage`) | `ADMIN` | Creates accounts and credentials; bulk import is a file upload |
| Student photo upload (`POST /students/:id/photo`) | all | File upload; MCP has no upload channel |
| Bulk CSV imports (students, users, grades, books, routes, invoices) | `ADMIN` | File upload |
| Gateway payment execution (`payOnline`, `verifyCheckout`) | `STUDENT`, `PARENT`, `ADMIN`, `FINANCE` | See below |
| Teacher calendar creation | `TEACHER` | Holds `calendar.manage` at `OWN` only, and the service requires `ALL` because a `CalendarEvent` has no section |
| Attendance register photo (OCR) | `TEACHER`, `ADMIN` | File upload |
| Cross-school reads and writes (`schools.*`) | — | Held only by SUPER_ADMIN, which has no MCP at all |

### Taking a payment: a deliberate limitation

A STUDENT or PARENT holds `fees.pay` at OWN scope and pays on the web through
`fee.service.payOnline()`. The assistant deliberately will not.

`payOnline()` cannot be exposed without breaking payment integrity. On a real
gateway it returns an `orderId`, a `keyId` and a payment-intent id that only a
browser checkout SDK can consume — unusable in a chat channel, and on WhatsApp
it would write gateway session material into a logged, forwardable transcript.
It also creates an `INITIATED` payment row as a side effect of merely asking,
leaving a dangling intent nobody can complete for reconciliation to explain.
And when the provider is the sandbox it takes its other branch and marks the
invoice `PAID` outright with no gateway interaction at all — the assistant
settling a bill on the strength of a sentence.

Nothing is actually missing. `get_payment_link` exposes the same intent safely:
it runs `listInvoices()` at the caller's own scope, refuses an invoice that is
not theirs or not outstanding, and hands back the real checkout URL so the
person pays on the gateway's own page. `record_payment` stays school-wide for
finance — it is the counter-payment ledger write, not a family paying their own
bill, and is not widened to make an operation count match. Pinned by
`mcp.capabilityCoverage.test.js`.

### The security model, per capability

Every capability, read or write, is subject to all of the following. None is
optional and none is per-tool.

| Property | How |
|---|---|
| Actor from the authenticated session | Opaque per-turn session handles (`mcp/session.js`); the actor is the one the request authenticated as |
| The LLM cannot supply identity | `STRIPPED_ARGS` removes identity-shaped argument names before validation, so they are neither honoured nor reported as unknown |
| The LLM cannot override tenant or school | Tenancy is the request's own `AsyncLocalStorage` state; no capability takes a tenant argument |
| The LLM cannot override role or scope | Both are read from the live permission map, never from arguments |
| OWN cannot become ALL | `minScope: 'ALL'` gating in the registry, re-checked at execution |
| Tenant isolation | The `tenantScoped` plugin on every school-owned model; a foreign id does not resolve |
| Foreign records refused | Resolution runs at the caller's own scope, so somebody else's record is not found rather than refused |
| Execution-time re-authorization | `authorize()` runs again when a confirmation is redeemed — permissions can be revoked between a proposal and the "yes" |
| Confirmation for high-impact writes | Server-enforced, single-use, claimed atomically; replay, expiry, cross-tool and another-user's token all refused |
| Audit | Every call audited with the acting profile; writes carry before/after state |
| No arbitrary execution | No raw SQL, no arbitrary HTTP, no shell, no arbitrary model or field access — every write goes through a named service with an explicit field allow-list |

Asserted by `mcp.security.test.js` (a discovery-vs-execution matrix for every
role), `mcp.writes.coverage.test.js` (all 81 writes, each with an outsider,
wrong-scope and wrong-school case, plus a confirmation-bypass battery for every
high-risk tool), `mcp.dashboardAccess.test.js`, `mcp.parityGaps.test.js` and
`ai.superAdminExcluded.test.js`.

### Permissions the backend never enforces

Six catalog permissions — `settings.manage`, `attendance.regularize`,
`reportcards.read` and the three `analytics.*` keys — appear nowhere in `src/`
outside the catalog that declares them. They are granted to roles and checked
by nothing. This is not an MCP gap; the permission list is ahead of the
application. `mcp.roleCoverage.test.js` pins the set in both directions, so
implementing one of these features fails the test until a capability is exposed
alongside it. (`fees.plan.review` is a near case worth distinguishing: it has no
route of its own, but it *is* enforced inside `transitionFeePlan()`, per
transition.)

## Behaviour added in the production-readiness pass

- **A write that times out is not abandoned.** Past `MCP_TOOL_TIMEOUT_MS` a
  read is answered "took too long"; a write is reported as *outcome not yet
  known*, left to finish, and settled and audited when it does
  (`handleTimeout` in `mcp/server.js`). See MCP-SECURITY.md.
- **Every result is filtered on the way out.** Tenant ids, credentials, hashes
  and encrypted fields are stripped from `data` whatever a tool returns
  (`redactResultData`).
- **Writes refuse before they ask.** `delete_document`, `create_transport_stop`,
  `enroll_in_transport` and `transition_fee_plan` now check, before the
  confirmation prompt, what their services check at execution — the record
  exists in this school, the caller may act on it, the state allows it — using
  functions exported by those services, so the rule has one home.
- **Confirmation prompts show values, not only field names** —
  `Update Rahul Sharma: address → "12 MG Road"`,
  `Approve fee plan "…" (PENDING_ADMIN_APPROVAL → APPROVED)`.
- **An argument a tool does not accept is refused plainly.** "Change Rahul's
  phone number" gets *"phone" is not something this action accepts. It
  accepts only: …* — not "I need a bit more", which no further detail could
  satisfy.
- **A delete request is not answered with a list.** When a message opens with
  delete / remove / erase / archive / deactivate / cancel / revoke / withdraw
  and the rule parser matched only read tools (e.g. "delete the old bus
  circular" → the announcements list), the rules' match is set aside: the
  model routes it, or, with no model, the assistant says it is not sure.

## Behaviour added in the final pre-staging pass

- **A teacher asking about a named pupil gets that pupil.** "Show Rahul's
  attendance" used to route a teacher to `get_attendance` (their own summary),
  because the named-student rule required school-wide `attendance.read`. The
  rule now matches at any scope; the name is resolved at the caller's own
  scope, so a teacher finds only their own pupils and anyone else is "not
  found". `tests/mcp.routing.test.js`.
- **A name must match whole words.** Student lookup used the list search's
  substring match, so "Riya" found Priya. `resolveStudentId` now requires the
  name to match whole words of the student's name; a near miss is offered
  ("Did you mean: Priya Verma?"), never answered for. Ambiguity is a question.
- **"What is his attendance?"** carries the student forward from the caller's
  own previous message (WhatsApp keeps the conversation), into a tool that
  takes a student — never widening scope, never reading the assistant's own
  replies. With no such context the tool asks "Which student?" instead of
  answering for nobody (or for a whole class).
- **"My attendance" from a teacher** says there is no personal record, instead
  of reading out the class as if it were theirs.
- **More services check that ids belong to this school**: `createExam`
  (term), `createExamSubject` (offering), `upsertSlot` (section, and that the
  offering is that section's), and `notify_users` (every recipient is a person
  in this school). Each was found by the wrong-school tests in
  `tests/mcp.writes.coverage.test.js`, and each fix is in the service, so REST
  gets it too.
- **`bulk_mark_attendance` works.** It had never worked through MCP: the
  service reads rows as its CSV importer parses them (`rollno`, `admissionno`,
  strings), and the tool passed its own shape. Rows are now translated.

## Why the server runs in-process

The MCP server is a real MCP server built on `@modelcontextprotocol/sdk`, but
it is connected to its client over `InMemoryTransport` rather than stdio or
HTTP. A tool call is therefore a function call with a protocol boundary around
it.

That is deliberate:

- **No second service to deploy.** The alternative is another process with its
  own configuration, its own database connection, its own health checks and its
  own failure mode, added to a school ERP that currently deploys as one Node
  app.
- **No new listening surface.** An MCP server on a port is an authorization
  problem of its own. In-process, the only way to reach a tool is to already be
  running inside an authenticated EduOS request.
- **Tenancy works.** EduOS confines schools with `AsyncLocalStorage`. A network
  hop loses that context; the MCP server instead captures it at session open
  and re-enters it explicitly (`runInTenantState`), so a tool call runs in the
  same school as the request that triggered it.

Nothing about the tools depends on this. Moving to stdio or HTTP is a change to
the ~20 lines in `client.js` that construct the transport — the catalog, the
authorization and the audit trail are untouched.

## A turn, end to end

1. **Channel** authenticates the caller. Website: `authenticate` middleware →
   `req.actor`. WhatsApp: `resolveActorByPhone()` from the number in Meta's
   signed webhook, then `runInActorScope()` to enter their school.
2. **Agent** (`runAgentSafely` → `runAgent`) applies the per-actor rate limit
   and the prompt-injection check, then opens an MCP session for the turn.
3. **Discovery**: `tools/list` returns the tools this actor's permissions allow.
4. **Planning**: the rule parser tries first — deterministic, instant, free. If
   it misses, or the message is a bare follow-up, a model is given the MCP tool
   schemas (narrowed to ~45 by relevance) and returns a plan of up to 3 tools.
5. **Execution**: each step goes out as `tools/call`. The server authorizes,
   re-enters the school, validates, and either performs the call or returns a
   confirmation request.
6. **Composition**: one result speaks for itself, verbatim from the tool.
   Several results are joined — by a model when one is configured, and by
   concatenation when not. Either way every fact comes from a tool result.
7. **Reply** goes back to the channel, which formats it.

## Confirmation

A write with `confirm: true` never happens on the first call. The server
prepares the payload, writes an `AgentAction` row, and returns:

```json
{
  "success": true,
  "action": {
    "id": "...",
    "type": "mark_attendance",
    "status": "confirmation_required",
    "confirmationToken": "...",
    "summary": "Mark attendance for 30 student(s) in section … on 2026-09-10",
    "risk": "HIGH",
    "expiresInMinutes": 10
  }
}
```

The website carries the token in its UI and posts it to `/ai/agent/confirm`.
WhatsApp cannot carry a hidden token, so a bare "yes" finds the caller's newest
pending proposal and a fresh token is issued for that single confirmation —
which keeps the execution path identical rather than adding a second one that
skips the check.

On redemption the server re-authorizes, re-enters the school, runs the
**stored** arguments (not anything sent with the token), snapshots the record
before and after, and audits the result.

The redemption is claimed **atomically**: one conditional update moves the
proposal from `PENDING` to `EXECUTING`, so two simultaneous "yes" requests — a
double-tap, a client retry, a webhook redelivered before the first finished —
run the action exactly once. A token presented against the wrong tool is
refused *before* the claim, so it is not consumed by the mistake.

This reuses the mechanism EduOS already had for the agent's five write tools.
There is one confirmation system, one `AgentAction` collection, and one answer
to "what did the assistant do and who approved it".

## MCP and RAG

The agent chooses between them by what the question is:

| Question | Path |
|---|---|
| "Who is absent today?" | MCP — `get_absent_students` |
| "Which students have pending fees?" | MCP — `get_pending_fees` |
| "Mark Rahul absent." | MCP — `mark_attendance`, confirmed |
| "What did the circular about the bus route say?" | RAG |
| "Hello" | RAG (greeting handling) |

RAG runs when no tool fits. It is not a fallback source for live data — a
question about a number is answered by a tool call or not at all.

Some questions need both: *"According to the attendance policy, which students
are below 75%?"* The MCP tool answers who is below the threshold; when the
message also refers to a written rule (policy, according to, as per, rules,
handbook, guidelines, circular, regulations), the retrieved text is added
beside the answer. The records answer is never replaced or adjusted by it, and
the reply reports `sources: ['RAG', 'MCP']`.

| Question | Path |
|---|---|
| "What did the announcement about the bus route say?" | RAG — what a notice *says* is text |
| "According to the attendance policy, who is below 75%?" | MCP `get_at_risk_students` + RAG |

**Known limitation:** RAG's corpus is announcements only. It does not index the
`documents` module, so "what does our attendance policy say?" only works if the
policy was published as an announcement. See MCP-AUDIT.md §H.

## Environment variables

MCP adds one optional setting; everything else is existing configuration.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TOOL_TIMEOUT_MS` | `20000` | Wall-clock ceiling for one tool call, so a stuck query cannot hold a chat open. |

Existing settings that affect the agent: `AI_PROVIDER` (`rules`, `anthropic`,
`gemini`), `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, `AI_TIMEOUT_MS`,
`WHATSAPP_SESSION_IDLE_MINUTES`, `WHATSAPP_HISTORY_TURNS`.

With `AI_PROVIDER=rules` — no model at all — the assistant still answers every
question the rule parser covers, through the same MCP tools. The model improves
routing and multi-result phrasing; it is not required for the system to work.

## Running it

```bash
cd backend
npm install
npm run dev
```

Startup logs two lines that matter:

```
✔  Agent tool permissions validated against the catalog
✔  MCP server ready  →  161 ERP tools (80 GET, 26 CREATE, 14 UPDATE, 10 DELETE, 31 ACTION)
```

If the catalog is inconsistent — a tool naming a permission that does not
exist, a write that cannot summarise itself — the second line is an error
naming the problem, because a tool that fails closed looks exactly like "you
lack that permission" at the call site.

Regenerate the catalog docs after changing tools:

```bash
node backend/scripts/mcp-catalog.js --write
```

## Deployment

No deployment change. The MCP server has no port, no process and no
configuration of its own; it starts with the API. The only new dependency is
`@modelcontextprotocol/sdk`, already in `backend/package.json`.
