# Working on EduOS MCP Tools

How to add, change and test a tool. Read
[MCP-SECURITY.md](./MCP-SECURITY.md) first if you are adding anything that
writes.

---

## The one rule

**A tool is a schema, a permission, a risk level and a call into an existing
EduOS service.** It contains no business logic.

If a tool needs a rule of its own — "an invoice may not exceed the fee
structure", "a bed cannot be allocated twice" — that rule belongs in the
service the REST API already calls, so the screen and the assistant cannot
drift apart. Adding it to the tool means the next person to change the screen
will not know it exists.

Selection is not business logic: filtering `listInvoices()` down to the ones
that are not PAID is choosing what to show, and is fine.

## Adding a read tool

1. Find the service. It must already exist — check
   [MCP-AUDIT.md](./MCP-AUDIT.md) §C/D for the inventory. If the logic lives in
   a controller rather than a service (transport routes, audit logs, document
   deletion), extract a service first; do not copy it.
2. Add the entry to the right file in `backend/src/modules/ai/mcp/tools/`.
3. Regenerate the catalog: `node backend/scripts/mcp-catalog.js --write`.
4. Add a test in `backend/tests/mcp.server.test.js`.

```js
get_something: {
  module: 'Fees',
  operation: 'GET',
  risk: RISK.LOW,
  description:
    'One clear sentence on what it answers, then when to use it rather than a ' +
    'neighbouring tool, then what it returns. End with "Read-only."',
  inputSchema: {
    type: 'object',
    properties: {
      studentId: objectId('Preferred when known, e.g. from search_students'),
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,   // always
  },
  permission: 'fees.read',
  minScope: 'ALL',                 // only if it reaches past the caller's own records
  service: 'fee.service.getSomething()',
  async run(ctx, args) {
    const data = await fees.getSomething(ctx.actor, ctx.scope, args);
    return ok(data, { speak: `A sentence a person can read: ${data.count} things.` });
  },
},
```

`ctx` is `{ actor, scope, channel }`. `scope` is the caller's scope for **this
tool's** permission. If your tool needs to read something governed by a
different permission — looking a student up by name, say — use that
permission's scope instead (`studentScopeOf(ctx)` in `_shared.js`), or you will
widen a permission by accident.

## Adding a write tool

Everything above, plus:

```js
create_something: {
  module: 'Fees',
  operation: 'CREATE',             // or UPDATE / DELETE / ACTION
  risk: RISK.HIGH,
  confirm: true,                   // see the risk table in MCP-SECURITY.md
  description:
    '... State plainly that it changes ERP data and that it needs confirmation.',
  inputSchema: { /* ... */ },
  permission: 'fees.manage',
  minScope: 'ALL',
  affectsOthers: true,             // touches somebody else's record or money

  // Shown to the person before they approve. Name the real thing, with real
  // numbers -- "Record a ₹5,000 CASH payment against invoice INV-1042", not
  // "Record a payment".
  summarise: (args, actor, prepared) => `...`,

  // Optional. Runs BEFORE the confirmation prompt, so a refusal reaches the
  // user before they approve something that cannot succeed.
  async prepare(ctx, args) { return { /* stored with the proposal */ }; },

  // Optional. What the record looked like; called before and after the write.
  async snapshot(ctx, args, prepared) { return { /* ... */ }; },

  async run(ctx, args, prepared) {
    const result = await fees.createSomething(args);
    return action({
      type: 'something_created',
      id: result._id,
      data: result,
      speak: 'A sentence saying what actually happened.',
    });
  },
},
```

`confirmWhen: (args) => boolean` overrides `confirm` per call — used by
`generate_invoices`, where a dry run writes nothing and needs no approval.

### Rules for writes

- `summarise` is required. The registry validator fails the build without it.
- Never claim success the service did not report. If the backend refuses,
  throw — the envelope will carry a structured error and the agent will explain
  it. A cheerful "done" for something that did not happen is the worst outcome
  in this system.
- If repeating the operation would be harmful, check whether the service
  already guards it (most do — see MCP-SECURITY.md § Idempotency). If it does
  not and duplication would be serious, add the guard **to the service**.
- Patching a record? Use an allow-list. `applyFieldAllowList()` in
  `validate.js`, and follow `update_student` as the pattern.

## Writing descriptions

The description is the entire basis on which a model picks the tool. Vague
descriptions are the single biggest cause of bad routing.

Say, in order: what it answers or does; when to use it rather than the tool
next to it; what it returns; whether it writes; whether it confirms.

```
✗  "Gets student data."

✓  "Find students by name, admission number or class. Use this first whenever
    the user names a student but you do not have their id. Returns each match
    with class, roll number, student id and enrolment id. Read-only."
```

Cross-reference neighbours explicitly — `get_fees` says "use get_pending_fees
instead when the user asks about students in general", which is what stops a
model answering an administrator's question with a parent's balance.

## Wrapping an existing agent tool

`agent/tools.js` still holds implementations that MCP fronts. Use
`wrapAgentTool()`; do not copy the body.

```js
get_fees: wrapAgentTool('get_fees', {
  module: 'Fees',
  description: '... Read-only.',
  service: 'fee.service.getSummary()',
}),
```

The lookup is **lazy**, through the module namespace, and must stay that way.
There is a real import cycle in this repository —
`agent/tools.js → announcement.service → whatsapp.service → whatsapp.agent →
orchestrator → mcp` — and destructuring `TOOLS` at import time finds it
uninitialised (`Cannot access 'TOOLS' before initialization`).
`validateMcpRegistry()` does the eager checking at boot instead.

## The rule parser

`agent/intent.js` holds regex rules for the phrasings a school asks daily, so
the assistant works with `AI_PROVIDER=rules` and no model at all. It is **not**
one rule per tool — the catalog is far larger — and it should not become one.
Add a rule when a question is asked constantly and the answer should not depend
on a model being reachable.

If you add one:

- Give it `requires: { permission, scope }` when the same words mean different
  things to different roles. "How many are absent?" is a question about the
  school from a principal and about themselves from a student.
- Give it `exclude` patterns for the neighbouring tools it would otherwise
  steal from.
- Use the MCP tool name exactly.
- Non-Latin patterns take no `\b` anchors — JavaScript defines `\b` over
  `[A-Za-z0-9_]`, so `\bछुट्टी\b` never matches.

## Testing

```bash
cd backend
AI_PROVIDER=rules npx vitest run tests/mcp.server.test.js
AI_PROVIDER=rules npx vitest run tests/mcp.channels.test.js
AI_PROVIDER=rules npx vitest run                 # everything
```

`AI_PROVIDER=rules` matters. With a live key the model routes messages the
rules miss, which makes assertions about *which* tool answered non-deterministic
— these suites test the architecture, not a model's choices.

What a new tool should have a test for:

- it returns real data for a normal call
- an empty result is a success, not an error
- a caller without the permission is refused
- a caller from another school cannot reach it
- (writes) it proposes rather than performs, and performs after confirmation
- (writes) the audit entry exists and carries before/after where applicable

`tests/mcp.server.test.js` has a `call(tenant, actor, name, args, opts)` helper
that opens a session, runs the call and closes it.

## Checklist before opening a PR

- [ ] The tool calls an existing service and adds no business logic
- [ ] `additionalProperties: false` on the schema
- [ ] Permission is a real key from `PERMISSION_CATALOG`
- [ ] `minScope: 'ALL'` if it reaches past the caller's own records
- [ ] Description says what, when, what it returns, and whether it writes
- [ ] Writes: `summarise` names real values; `confirm` matches the risk table
- [ ] Patches: field allow-list applied
- [ ] Tests for the happy path, the refusal, and the tenant boundary
- [ ] `node backend/scripts/mcp-catalog.js --write` re-run and committed
- [ ] `AI_PROVIDER=rules npx vitest run` passes
