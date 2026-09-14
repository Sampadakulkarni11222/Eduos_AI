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
first built around. All nine reach the assistant through the same path: there
is no role-specific server, intent file, question list or keyword table
anywhere, and adding one would be a regression. What differs between a warden
and a principal is only the permission map their session carries, from which
the same registry yields a different capability set.

| Role | Granted permissions | Capabilities visible | Writes |
|---|---|---|---|
| `SUPER_ADMIN` | 71 | 145 | 71 |
| `ADMIN` | 67 | 144 | 70 |
| `PRINCIPAL` | 32 | 73 | 20 |
| `TEACHER` | 28 | 58 | 17 |
| `STUDENT` | 22 | 53 | 7 |
| `PARENT` | 18 | 44 | 3 |
| `WARDEN` | 11 | 29 | 8 |
| `FINANCE` | 12 | 28 | 7 |
| `LIBRARIAN` | 9 | 26 | 6 |

`backend/tests/mcp.roleCoverage.test.js` compares the two surfaces for every
role, reading the roles from `SYSTEM_ROLES` rather than from a list of its own,
so a role added later is covered the day it is added.
`backend/tests/mcp.roles.askAi.test.js` then asks each role about its own work
through both doors people use — `POST /ai/agent` and the WhatsApp webhook.

### Permissions with no capability of their own

Thirteen granted permissions have no capability that declares them. None is a
missing feature; each is recorded in the `UNCOVERED` ledger in
`mcp.roleCoverage.test.js`, and the test fails both when a new permission
appears without a reason and when a recorded reason stops being true.

- **Reachable under another permission key** — `reportcards.read` (served by
  `get_report_card`, gated on `marks.read`, exactly as its REST route is);
  `fees.plan.review` (`plan.service.transitionFeePlan()` checks it itself, per
  transition, so the tool gates visibility on `fees.read` and the service
  enforces the real key); `analytics.school.read`, `analytics.class.read` and
  `analytics.child.read` (the dashboard views, plus `get_at_risk_students` and
  `get_growth_score`).
- **Blocked** — `fees.structure.manage`: `createFeeHead` and
  `createFeeStructure` are raw `Model.create(data)` pass-throughs with no
  actor, no scope, no tenant check, no validation and no audit, so exposing
  them would make the assistant an arbitrary-field writer over a school's fee
  configuration. They need the actor-aware service treatment documents and
  calendar received first. `settings.manage` and `attendance.regularize` have
  no module, route or service anywhere in `src/` — there is nothing to wrap.
- **Deliberately unavailable** — `users.manage`, `roles.manage` and
  `permissions.manage` administer the authorization system that constrains the
  assistant, so a capability there would let it widen its own reach (and bulk
  user import is a CSV upload, which MCP has no channel for). `schools.read`
  and `schools.manage` are cross-tenant and mint administrator credentials;
  every MCP call runs inside one tenant's `AsyncLocalStorage` state.
  `calendar.manage` **at `OWN` scope** is a fourteenth case of the same kind: a
  `CalendarEvent` has no section, so there is no event a section-scoped holder
  could safely create, and `calendar.service.create()` refuses a non-`ALL`
  actor for that reason. At `ALL` scope it is covered.

### Permissions the backend never enforces

Six catalog permissions — `settings.manage`, `attendance.regularize`,
`reportcards.read` and the three `analytics.*` keys — appear nowhere in `src/`
outside the catalog that declares them. They are granted to roles and checked
by nothing. This is not an MCP gap; the permission list is ahead of the
application. `mcp.roleCoverage.test.js` pins the set in both directions, so
implementing one of these features fails the test until a capability is exposed
alongside it.

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
✔  MCP server ready  →  137 ERP tools (69 GET, 21 CREATE, 12 UPDATE, 6 DELETE, 29 ACTION)
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
