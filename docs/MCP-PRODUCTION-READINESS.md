# EduOS MCP — Production Readiness

What has to be true, configured and checked before the MCP-based Ask AI
(website chatbot and WhatsApp agent) is deployed, and how to operate and roll
it back. For how it works see [MCP-ARCHITECTURE.md](./MCP-ARCHITECTURE.md);
for the security model see [MCP-SECURITY.md](./MCP-SECURITY.md); for every
tool see [MCP-TOOLS.md](./MCP-TOOLS.md).

No real secret appears in this document. Values shown are placeholders.

---

## 1. Environments

| | DEVELOPMENT | STAGING | PRODUCTION |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` (anything but `production`) | `production` |
| Database | local MongoDB, or the in-memory test database for the test suite | a **separate** MongoDB replica set and database (`eduos_staging`) with its own credentials | the production cluster |
| Which URI is used | `MONGO_URI` (`MONGO_URI_ATLAS` is ignored) | `MONGO_URI` (`MONGO_URI_ATLAS` is ignored) | `MONGO_URI_ATLAS`, else `MONGO_URI` |
| AI provider | `rules` (no model) or a dev key | the production provider with a staging key | `anthropic` or `gemini` |
| WhatsApp | simulation (no `WA_PHONE_NUMBER_ID`/`WA_ACCESS_TOKEN`) | a Meta **test** number, real `WA_APP_SECRET` | the school's number, real `WA_APP_SECRET` |
| Payments | `sandbox` | `sandbox` or Razorpay test keys | Razorpay live keys, or `none` |
| OTP delivery | `console` | a real provider, test account | a real provider (the boot gate refuses `console`) |
| Swagger | on | on or off | off (default) |
| Boot safety gate (`config/env.js`) | not applied | not applied — run `scripts/staging-preflight.js` (§3) | **applied: refuses to start with any placeholder secret** |
| Database guard (`config/db.js`) | refuses a remote cluster unless opted in; refuses any `PRODUCTION_DB_HOSTS` host | same | not applied |

## 2. ⚠️ Keep the live database out of development and testing

`backend/.env` in this working copy sets **`MONGO_URI` to the live Atlas
cluster**. `config/env.js` ignores `MONGO_URI_ATLAS` outside production, but it
does *not* second-guess `MONGO_URI`. And `app.js`'s `bootstrap()` **writes on
every start**: it upserts every permission and every system role into whatever
database it has connected to.

So:

- **Never run `npm run dev` or `npm start` from a checkout whose `.env` points
  at production.** Point `MONGO_URI` at a local or staging database first.
- **Never run `npm run seed` against anything but a disposable database** — it
  drops collections.
- `connectDB()` logs the (credential-redacted) target and whether it is
  `ATLAS (remote)` or `LOCAL` before doing anything else. Read that line.
- **The startup guard now enforces this.** Before connecting — so before
  `bootstrap()` can write a role — `connectDB()` asks `assessDatabaseTarget()`
  (`config/env.js`). Outside production it refuses any host listed in
  `PRODUCTION_DB_HOSTS`, whatever else is set, and refuses any remote cluster
  unless `ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true`. Set `PRODUCTION_DB_HOSTS` on
  every non-production machine; with it set, the checkout's current `.env`
  cannot start against production at all. Tested in `tests/db.guard.test.js`.

The test suite never reads `.env`'s database: `tests/setup.js` starts an
in-memory MongoDB **replica set** (`mongodb-memory-server`, database
`eduos-test`) and connects to that. It needs no configuration.

## 3. Test / staging database

### What the tests use — sufficient for all integration testing

`AI_PROVIDER=rules npx vitest run` runs every suite, including the MCP
end-to-end suites that drive the real HTTP API and the signed WhatsApp webhook
against a real MongoDB. That MongoDB is `MongoMemoryReplSet` from
`tests/setup.js`:

- a single-node **replica set**, so transactions really run — the payment
  paths depend on `session.withTransaction`, and a standalone would silently
  take the non-transactional fallback;
- created fresh per run, collections cleared after every test;
- no network access, no credentials, nothing persistent.

For verifying MCP behaviour this is sufficient, and it is what every result in
the readiness report was produced against.

### When a persistent staging database is needed

For a staging *deployment* — people clicking through the website and messaging
a test WhatsApp number — the app needs a real, persistent database:

| Setting | Value |
|---|---|
| `NODE_ENV` | `staging` |
| `MONGO_URI` | `mongodb+srv://<staging-user>:<password>@<staging-cluster>/eduos_staging?retryWrites=true&w=majority` — or a local `mongod --replSet rs0` |
| `MONGO_URI_ATLAS` | **unset** |
| `PRODUCTION_DB_HOSTS` | the production cluster host(s), comma-separated — the guard refuses them |
| `ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION` | `true` only if staging runs on its own remote (Atlas) cluster |
| `PRODUCTION_MEDICAL_KEY_SHA256` | SHA-256 of the production medical key (never the key), so the preflight can prove staging's differs |

**Before every staging start:** `cd backend && NODE_ENV=staging node scripts/staging-preflight.js`.
It reads the configuration, connects to nothing, prints no secret or host, and exits non-zero
on any failed check. Run against this checkout's current `backend/.env` it fails six checks —
NODE_ENV is not staging, `MONGO_URI_ATLAS` is set, `MONGO_URI` is a remote cluster, and the
three staging-only settings above are missing — which is the point.

Requirements:

- a **replica set** (Atlas clusters are; a local `mongod` needs `--replSet` and `rs.initiate()`);
- a **separate cluster or project** from production, or at minimum a separate database with a user whose role is limited to `eduos_staging` — so a misconfigured staging box cannot write to production;
- seeded with test data only (`npm run seed` is acceptable here — never elsewhere);
- its own `MEDICAL_ENCRYPTION_KEY`, different from production's, so production medical ciphertext is never decryptable in staging.

## 4. Environment variables

### Core

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables the boot safety gate and Atlas. |
| `PORT` / `HOST` | `5000` / `0.0.0.0` | |
| `CORS_ORIGIN` | `http://localhost:3000` | Must name the frontend origin; `*` is refused in production. |
| `LOG_LEVEL` / `LOG_DIR` | `info` / `logs` | |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | 15 min / 2000 / 30 | Per-IP. The assistant also has its own per-actor limit. |
| `SWAGGER_ENABLED` | on outside production | |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | `uploads` / 15 MB | |
| `SCHOOL_NAME` | `Oakridge Academy` | Branding on generated documents. |

### Database

| Variable | Notes |
|---|---|
| `MONGO_URI` | Used everywhere except production-with-Atlas. |
| `MONGO_URI_ATLAS` | Used **only** when `NODE_ENV=production`. |
| `PRODUCTION_DB_HOSTS` | Hosts a non-production process must never connect to. |
| `ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION` | Opt-in for a remote cluster outside production (staging on Atlas). Default off. |

### Authentication and data protection

| Variable | Notes |
|---|---|
| `JWT_SECRET` | ≥ 32 characters in production (enforced). |
| `ACCESS_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_TTL_DAYS` / `REFRESH_ROTATION_GRACE_SECONDS` | `15m` / 30 / 30. |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` / `BCRYPT_SALT_ROUNDS` | 5 / 5 / 10. |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `twilio` / `resend` to enable OTP sign-in; `console` in production boots with a warning and OTP answers 503. Codes are never echoed in production. |
| `GOOGLE_CLIENT_ID` / `SUPER_ADMIN_EMAILS` | Optional Google sign-in and the Super Admin allow-list. |
| `MULTI_PROFILE_ENABLED` | Default true. |
| `MEDICAL_ENCRYPTION_KEY` | Encrypts medical records at rest. **Losing it makes every medical record unreadable** — store and back it up like a database credential. |

### AI

| Variable | Notes |
|---|---|
| `AI_PROVIDER` | `rules` (no model), `anthropic`, or `gemini`. With `rules` the assistant still answers everything the rule parser covers, through the same MCP tools. |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GEMINI_MODEL` | For the chosen provider. The model only routes and phrases; it never authorizes. |
| `AI_TIMEOUT_MS` | 10 000. A slow model falls back to the rules rather than holding the chat. |

### MCP

| Variable | Default | Notes |
|---|---|---|
| `MCP_TOOL_TIMEOUT_MS` | 20 000 | Wall-clock limit for one tool call, read on every call. A **read** past it is answered "took too long". A **write** past it is *not* abandoned: it keeps running, the person is told the outcome is not yet known, the proposal stays `EXECUTING` so its token cannot run it again, and when it settles the audit records `EXECUTED_AFTER_TIMEOUT` or `FAILED_AFTER_TIMEOUT`. |

The confirmation lifetime (10 minutes) is a code constant, `CONFIRM_TTL_MINUTES` in `mcp/confirm.js`.

### WhatsApp

| Variable | Notes |
|---|---|
| `WA_PHONE_NUMBER_ID` + `WA_ACCESS_TOKEN` | Both set = live mode. Either unset = simulation (replies logged, not sent). |
| `WA_APP_SECRET` | Authenticates inbound webhooks (X-Hub-Signature-256). **Required** once live; production refuses to start without it. |
| `WHATSAPP_VERIFY_TOKEN` | The webhook verification handshake. |
| `WHATSAPP_ENABLED`, `SCHOOL_WHATSAPP_NUMBER` | The "Chat on WhatsApp" entry point. |
| `WHATSAPP_SESSION_IDLE_MINUTES` / `WHATSAPP_HISTORY_TURNS` | 120 / 6. Relevance of conversation memory, not a security boundary. |
| `WA_APP_ID`, `WA_WABA_ID`, `WA_CALLBACK_ORIGIN` | Used only by `scripts/whatsapp-webhook-setup.js`. |

### Payments

`PAYMENT_PROVIDER` (`sandbox` refused in production), `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (required with Razorpay),
`RAZORPAY_API_BASE`, `RAZORPAY_CURRENCY`. The assistant never executes an
online payment; these affect only the payment-link flow.

## 5. MCP configuration

There is nothing to deploy for MCP. The server runs **in process** with the
API, connected to its client over `InMemoryTransport`: no port, no second
service, no separate credentials. The client connects on the first assistant
request (`mcp/client.js:getMcpClient`).

At boot, `app.js` validates the catalog — every tool names a real permission,
every write can describe itself for confirmation, every wrapped tool exists —
and logs either:

```
✔  MCP server ready  →  137 ERP tools (69 GET, 21 CREATE, 12 UPDATE, 6 DELETE, 29 ACTION)
```

or an error naming the problem. **Treat the error as a failed deploy**: a tool
that fails validation fails closed at call time, which looks exactly like
"you lack that permission".

## 6. Required permissions

- `ai.copilot.use` — reaching `POST /ai/agent`, `POST /ai/agent/confirm` and `GET /ai/agent/capabilities` at all.
- Each tool's own permission, at its own scope — see the matrix in
  [MCP-TOOLS.md](./MCP-TOOLS.md#permission-matrix-by-role). Checked live on
  every call and again at confirmation; revoking a permission takes effect on
  the next request (the auth middleware rebuilds the permission map from the
  database role each time).
- WhatsApp callers need an active Profile whose Account phone number matches
  the sender; the phone is the identity.

**Role review before go-live** (a policy decision, not a code change):
FINANCE and LIBRARIAN hold `students.read` at `ALL`, so they can ask the
assistant for a student's guardian contacts and personal details — exactly as
they can open the student panel on the website. If a librarian should not see
guardian phone numbers, narrow the role; the assistant follows automatically.

## 7. Startup order

1. MongoDB reachable, as a replica set.
2. Process starts; `config/env.js` loads configuration and, in production,
   **exits** if any secret is a placeholder.
3. `connectDB()` — logs the target, exits on failure.
4. Permission and system-role sync (upserts; custom roles untouched).
5. Agent-tool and MCP-catalog validation (§5).
6. WhatsApp mode logged (live and verified / live and unverified / simulation).
7. HTTP server listens.

## 8. Health checks

| Check | What it tells you |
|---|---|
| `GET /api/v1/health` | Process **and database**: pings MongoDB (1.5 s limit). `200 { status: "ok", database: "ok" }`, or `503 { status: "degraded", database: "unavailable" }` — no host, name or error text either way. Tested in `tests/mcp.catalog.test.js`. |
| Boot log | `MongoDB connected`, `MCP server ready → 137 ERP tools`, the WhatsApp line. |
| `GET /api/v1/ai/agent/capabilities` (authenticated) | The MCP catalog as a given user sees it — an end-to-end check of auth, MCP discovery and role filtering. |
| `GET /api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=123` | The webhook handshake Meta performs. |

Point the load balancer's health probe at `/api/v1/health`: an instance that
has lost its database answers 503 and stops receiving traffic. MCP itself has
no separate health — it is in-process — and `/ai/agent/capabilities` exercises
it end to end for an authenticated user.

## 9. Logging

- Application log: `LOG_DIR`, level `LOG_LEVEL`. Credentials in database URIs are redacted before logging.
- **Audit trail** (the durable record): every MCP call writes an `AuditLog` entry `agent.<tool>` with `after.via = 'MCP'`, the actor, channel, school, arguments, outcome, error code, duration, and — for writes that support it — the record's state before and after.

| `after.status` | Meaning |
|---|---|
| `READ` / `EXECUTED` | Success. |
| `CONFIRMATION_REQUIRED` | A write was proposed; nothing changed. |
| `REJECTED` | The person said no. |
| `FORBIDDEN`, `IDENTITY_ARGUMENT_REJECTED`, `SCHOOL_REQUIRED`, `UNKNOWN_TOOL` | Refused before anything ran. |
| `INVALID_INPUT`, `PREPARE_FAILED` | Refused on its arguments or on a check made before confirmation. |
| `CONFIRMATION_INVALID`, `CONFIRMATION_MISMATCH` | A bad, reused, expired or misdirected token. |
| `ERROR`, `FAILED` | The service refused or failed; the `code` says which. |
| `TIMEOUT` | A read exceeded `MCP_TOOL_TIMEOUT_MS`. |
| `TIMEOUT_OUTCOME_PENDING` → `EXECUTED_AFTER_TIMEOUT` / `FAILED_AFTER_TIMEOUT` | A write exceeded it, then settled. |

- **Never logged**: passwords, tokens (including confirmation tokens and their hashes), API keys, the WhatsApp access token. Results returned to the model additionally have tenant ids, credentials, hashes and encrypted fields stripped (`redactResultData` in `mcp/server.js`).
- `AgentAction` rows (proposals) are **ephemeral**: a TTL index deletes each one at its `expiresAt`, ten minutes after it was made, whatever its status. History lives in the audit trail.

## 10. Monitoring

Queries worth alerting on (run against the `auditlogs` / `agentactions` collections):

| Signal | Query | Why |
|---|---|---|
| Tool failure rate | `{ 'after.via': 'MCP', 'after.status': { $in: ['FAILED', 'ERROR'] } }` grouped by `action` | A service regression shows up here first. |
| Database errors | `{ 'after.via': 'MCP', 'after.code': 'DATABASE_ERROR' }` | Connectivity. |
| Writes of unknown outcome | `TIMEOUT_OUTCOME_PENDING` entries with no matching `*_AFTER_TIMEOUT` entry for the same `entityId` within a few minutes | A write that never settled — e.g. the process died mid-write. Review by hand. |
| Refusal spikes | `{ 'after.status': { $in: ['FORBIDDEN', 'IDENTITY_ARGUMENT_REJECTED'] } }` per actor | Probing, or a prompt-injection campaign. |
| Injection lockouts | `{ action: 'agent.injection_attempt', 'after.status': 'BLOCKED_REPEATED' }` | Third attempt in a window closes the surface for that person. |
| Stuck proposals | `agentactions.find({ status: 'EXECUTING', updatedAt: { $lt: <now − 5 min> } })` | Should be empty. |
| WhatsApp signature failures | 401s on `/api/v1/whatsapp/webhook` | A wrong `WA_APP_SECRET`, or someone forging webhooks. |

## 11. Migration procedure

No data migration is required.

- New `AgentAction` status values (`EXECUTING`, `FAILED`) and fields are additive.
- No new permission keys; roles are re-synced at boot as before.
- The TTL index on `agentactions.expiresAt` is declared by the model. Mongoose builds indexes on connect (no `autoIndex` override exists in this codebase). Confirm once after the first deploy: `db.agentactions.getIndexes()` shows `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.

Deploy order: backend first, then frontend. (The frontend change only removes
an unused client for the deleted `/ai/chat` endpoint.)

1. Deploy to staging; run the smoke checklist (§13).
2. Deploy the backend to production; confirm the three boot lines (§8).
3. Deploy the frontend.
4. Note the time the **last pre-MCP backend instance stopped** — the legacy-alias clock starts there (§12).

## 12. Legacy compatibility expiry

`LEGACY_TOOL_ALIASES` in `mcp/confirm.js` maps `apply_leave → apply_for_leave`
and `record_fee_payment → record_payment`, so a proposal the pre-MCP code
stored under an old name can still be confirmed — by the MCP tool.

- No new proposal is ever stored under a legacy name: `proposeAction()`
  canonicalises every name first and refuses anything that is not an MCP tool
  (`tests/mcp.architecture.test.js`).
- A stored legacy proposal can only be redeemed through MCP, with the same
  authorization, confirmation, tenancy and audit as any other call (same suite).

**Cleanup condition** — both must hold:

1. At least **11 minutes** have passed since the last pre-MCP backend instance
   stopped: 10 for the proposal lifetime, plus up to 60 seconds for MongoDB's
   TTL sweep. (In a rolling deploy, measure from the last old instance, not the
   first new one.)
2. This returns **0**:
   ```js
   db.agentactions.countDocuments({ tool: { $in: ['apply_leave', 'record_fee_payment'] } })
   ```

Then delete the two entries in `LEGACY_TOOL_ALIASES` and the alias assertions
in `tests/mcp.architecture.test.js`. Removing them any earlier could strand a
proposal a person has already been shown.

The pre-MCP agent tool `record_fee_payment` still exists in
`agent/tools.js` but nothing in the assistant can reach it (it is not in the
MCP catalog). It can be deleted together with the permission-metadata
assertions in `tests/agent.bulkAuthorization.test.js` that still name it.

## 13. Rollback procedure

1. Redeploy the previous backend build. There is no schema to roll back.
2. Proposals created by the MCP build use MCP tool names (e.g.
   `record_payment`) that the pre-MCP code does not know. They cannot be
   confirmed after a rollback and expire within ten minutes on their own; to
   close them immediately:
   ```js
   db.agentactions.updateMany({ status: 'PENDING' }, { $set: { status: 'EXPIRED' } })
   ```
3. Check for any `EXECUTING` rows first and let them settle — they are writes in flight.
4. The audit trail is unaffected in either direction: both builds write `agent.<tool>`.

### Staging smoke checklist (manual, after deploy)

- [ ] Boot log shows the staging database, `MCP server ready → 137 ERP tools`, and the intended WhatsApp mode.
- [ ] Website, as an administrator: "Which students have pending fees?" answers with figures.
- [ ] Website, as a teacher: "Mark <student> absent" asks for confirmation; "Cancel" changes nothing; confirming changes the register.
- [ ] Website, as finance: record a payment; it lands pending approval; an administrator approves it.
- [ ] WhatsApp test number: the same question gets the same answer; a write asks for YES.
- [ ] A parent asks about "all students' fees" and gets only their own child.
- [ ] `list_audit_logs` (or the audit screen) shows the `agent.*` entries for all of the above.

## 14. Security checklist

- [ ] `JWT_SECRET` is ≥ 32 random characters and differs per environment.
- [ ] `MEDICAL_ENCRYPTION_KEY` is set, differs per environment, and is backed up.
- [ ] `WHATSAPP_VERIFY_TOKEN` and `WA_APP_SECRET` are real values; the boot log says "inbound webhook signatures verified".
- [ ] `CORS_ORIGIN` names the frontend; Swagger is disabled in production.
- [ ] `SMS_PROVIDER` / `EMAIL_PROVIDER` are real providers (or OTP sign-in is knowingly off); `ALLOW_DEV_OTP_IN_PRODUCTION` is unset (it is ignored, but warns).
- [ ] `PAYMENT_PROVIDER` is not `sandbox` in production.
- [ ] The production database user can reach only the production database; network access is restricted to the app's hosts; TLS is on.
- [ ] No developer `.env` points at production (§2), and `PRODUCTION_DB_HOSTS` is set on every non-production machine.
- [ ] `scripts/staging-preflight.js` passes on staging.
- [ ] AI provider keys are scoped to this application and rotated on staff changes.
- [ ] Role review (§6) done — especially who holds `students.read`, `medical.read`, `fees.payments.approve` and `fees.payments.refund` at `ALL`.
- [ ] The full test suite passes: `cd backend && AI_PROVIDER=rules npx vitest run`.
- [ ] Monitoring queries (§10) are in place.
