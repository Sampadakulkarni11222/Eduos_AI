# Phase 3 — Security Audit & Hardening

_Date: 2026-07-29 · Scope: backend auth/authz, injection & input handling, transport/infra, data protection, AI surfaces. Critical and High findings are **fixed**; Medium/Low are documented with recommendations._

**Verification constraint, stated up front:** no live instance was available to attack (the Atlas credential was rotated in the P0 pass and no local MongoDB is installed). Verification was therefore done by **Express router-stack introspection** (proves which middleware actually guards a route — not a code reading) and **executable unit tests** against the changed modules, both reproduced below. Findings marked *code-review only* have not been exercised at runtime and should be re-tested in Phase 4 against a live instance.

---

## Findings summary

| # | Finding | Severity | Status |
|---|---|---|---|
| C1 | `POST /auth/register` fully public → anyone can mint an OWNER profile | **Critical** | **Fixed** |
| C2 | `GET /api/v1/admin-seed` public, hardcoded default secret → reseeds demo accounts with known password | **Critical** | **Fixed (removed)** |
| H1 | Helmet mounted *after* static handlers → uploads/status page served with no security headers | High | **Fixed** |
| H2 | SVG accepted by uploader + served inline from own origin → stored XSS | High | **Fixed** |
| H3 | Plaintext passwords & OTP codes written to the audit log | High | **Fixed** |
| H4 | Production boots with default `JWT_SECRET` / `MEDICAL_ENCRYPTION_KEY` / `CORS_ORIGIN=*` | High | **Fixed (fail-fast)** |
| H5 | `POST /auth/refresh` unauthenticated *and* unthrottled; no refresh-token reuse detection | High | **Fixed** |
| H6 | `req.ip` behind proxy → all users share one rate-limit bucket | High | **Fixed** |
| H7 | WhatsApp webhook accepts unsigned payloads | High (for Phase 5) | **Fixed** |
| M1 | No per-account OTP issuance cap (SMS flooding / cost abuse) | Medium | **Fixed** |
| M2 | JWT algorithm not pinned | Medium | **Fixed** |
| M3 | User enumeration on OTP request endpoints | Medium | Documented — product decision |
| M4 | No account lockout on repeated password failures | Medium | Open |
| M5 | Tenant isolation is nominal (`tenantId` defaulted, not enforced) | Medium | Open — blocks multi-campus |
| M6 | OTP hashed with unsalted SHA-256 | Low-Med | Open |
| M7 | Audit-log coverage gaps (no read-access logging for medical/PII) | Medium | Open |
| L1 | No `iss` check on Google ID token | Low | Open |
| L2 | Response compression + secrets in body (BREACH class) | Low | Accepted |

**Not found (checked, clean):** NoSQL injection — no `$where`, no user-controlled query operators, all lookups go through Mongoose casting; XSS in React — zero `dangerouslySetInnerHTML` in the frontend; path traversal in uploads — filename is basename-stripped and character-filtered; assignment/fee ownership checks from the prior pass are still in place (spot-checked `assignments.submit`, `fees.payments`).

---

## Critical findings — detail, fix, verification

### C1 — Public registration endpoint allowed full tenant takeover

**Vulnerable:** `POST /api/v1/auth/register` had no `authenticate`, no `requirePermission`, and no rate limiter. The handler takes an arbitrary `roleKey` and creates a profile bound to that role, optionally setting a password:

```
POST /api/v1/auth/register
{ "name":"x", "phone":"+919000000000", "email":"x@x.com",
  "password":"...", "roleKey":"OWNER" }
```

That returns a real OWNER profile; the attacker then signs in normally via `/auth/login`. Complete compromise of every student record, fee ledger, and medical note in the system, reachable by anyone who can hit the API. This was **not** in the prior audit reports — it is a live hole, not a documented-closed one.

**Fixed:** `auth.routes.js` — route now runs `authenticate` + `requirePermission('users.manage')`.

**Verified** by router-stack introspection (comparing middleware function identity, since the handlers are anonymous wrappers):

```
BEFORE   OPEN    POST /auth/register  → [handler]
AFTER    AUTHED  POST /auth/register  → [authenticate, handler(requirePermission), handler]
```

### C2 — Public seed endpoint with a hardcoded secret

**Vulnerable:** `routes/index.js` exposed `GET /api/v1/admin-seed?secret=…`, defaulting to the literal `'eduos-seed-2026'` when `SEED_SECRET_KEY` was unset — a value committed to the repo. Calling it recreated the entire demo user set, including OWNER/ADMIN, with the shared password `ChangeMe@123!`. On a deployment where those accounts had been deleted or renamed, this restores an attacker-known credential. Its own comment said "Remove this endpoint after first seed is complete."

**Fixed:** endpoint deleted; seeding is now an operator task (`npm run seed` with shell access). A comment records why it must not come back.

**Verified:** `grep -r "admin-seed" backend/src` returns nothing; `node --check` passes on the modified file.

---

## High findings — detail, fix, verification

**H1/H2 — Uploads served without headers, and SVG allowed.** `helmet()` was mounted at `app.js:109`, *after* `express.static` for `/public` and `/uploads` at `:97-100`, so uploaded files were served with no `X-Content-Type-Options`, no CSP, and inline `Content-Disposition`. Combined with `svg` in the uploader's allowlist, any authenticated user (including a student) could upload an SVG containing `<script>` and get stored XSS executing on the API origin.
**Fixed:** helmet + CORS moved above all static mounts; `/uploads` now sets `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox`; `svg` removed from the allowlist. *Code-review-only verification — re-test header presence against a live server in Phase 4.*

**H3 — Credentials in the audit log.** `auditLogger` wrote `req.body` verbatim into `AuditLog.before/after` for every successful write. `POST /auth/login` carries `password`; OTP verify carries the live `code`. Passwords were being persisted in plaintext to the database, defeating bcrypt entirely for anyone with read access to the audit collection.
**Fixed:** recursive `redact()` replaces `password`, `code`, `otp`, `token`, `refreshToken`, `idToken`, `secret` (and variants) with `[REDACTED]` before persisting.
**Verified** by unit test: password redacted ✓, nested OTP code redacted ✓, non-sensitive fields preserved ✓.

**H4 — Production would boot with development secrets.** `JWT_SECRET` defaulted to `'change-this-secret-in-production'` and `CORS_ORIGIN` to `'*'`, both committed. Anyone with the repo could forge access tokens for any account. The README listed these as manual checklist items — a checklist is not a control.
**Fixed:** `env.js` now refuses to start when `NODE_ENV=production` and any of `JWT_SECRET` (default or <32 chars), `MEDICAL_ENCRYPTION_KEY`, `WHATSAPP_VERIFY_TOKEN`, or `CORS_ORIGIN='*'` is insecure.
**Verified:** production + defaults → **exit code 1** with an itemized message; production + strong values → loads cleanly; development + defaults → still boots (developer experience preserved).

**H5 — Refresh endpoint unthrottled, no reuse detection.** `/auth/refresh` had neither `authenticate` (correct — it *is* the credential) nor any rate limit, allowing unlimited guessing against the token store, and rotation revoked the old token without reacting to a revoked token being replayed — the classic signal of token theft.
**Fixed:** `authRateLimiter` applied; presenting an already-revoked token now revokes **every** session on that account and logs a warning with the source IP.
**Verified:** router introspection shows `LIMITED POST /auth/refresh → [authRateLimiter, handler]`. Reuse-revocation path is *code-review only* (needs a DB) — Phase 4 test case: refresh twice with the same token, expect `REFRESH_REUSE_DETECTED` and all sessions dead.

**H6 — Rate limiting broken behind a proxy.** Without `trust proxy`, `req.ip` on Render is the proxy's address, so all users shared one bucket: one active user could 429 the entire school, and per-IP credential throttling was meaningless.
**Fixed:** `app.set('trust proxy', 1)`. *Code-review only — verify on Render with `X-Forwarded-For`.*

**H7 — Unsigned WhatsApp webhooks accepted.** `POST /whatsapp/webhook` parsed any payload without verifying Meta's `X-Hub-Signature-256`. Today the handler only logs, so impact is low — but **Phase 5 makes webhook payloads drive real actions** (attendance writes, fee updates), at which point forged inbound "messages" from any phone number become remote command execution against the ERP. Fixed now, before that lands.
**Fixed:** `verifySignature()` does a timing-safe HMAC-SHA256 comparison over the raw body (retained via `express.json({ verify })`); returns `true` only when no `WA_APP_SECRET` is configured, i.e. simulation mode with nothing to impersonate.
**Verified** by unit test: valid signature accepted ✓, forged rejected ✓, missing rejected ✓, tampered body rejected ✓.

**M1/M2 (fixed alongside):** per-account OTP cap of 5 per 15 min (`OTP_THROTTLED`) prevents SMS-cost abuse the IP limiter can't stop; JWT algorithm pinned to HS256 on sign **and** verify — verified by test that an HS512-signed token is now rejected.

---

## Open findings — recommendations (not yet fixed)

- **M3 user enumeration**: `/auth/otp/request` returns `PHONE_NOT_REGISTERED` / `EMAIL_NOT_REGISTERED`, letting anyone test whether a phone or email belongs to the school. **This contradicts README §11 and the prior audit, which claim unknown identifiers are answered identically.** It was apparently changed deliberately for UX (a real error beats a dead OTP screen). Genuine trade-off, so I did not silently revert it: for a school roster — where knowing a parent's number is in the system is itself sensitive — I recommend a uniform response plus in-app guidance, but that is your call.
- **M4 account lockout**: add progressive delay/lockout per account on repeated `BAD_CREDENTIALS`, independent of the IP limiter.
- **M5 tenant isolation**: `tenantId` is defaulted (`'eduos-demo-tenant'`) in the profile summary and not enforced in queries. Single-tenant today, so not exploitable — but multi-campus (Phase 1 gap) must not ship before queries are tenant-scoped, or it becomes cross-school data leakage.
- **M6 OTP hashing**: unsalted SHA-256 over a 6-digit space is trivially reversible if the DB leaks. Use HMAC with a server-side pepper.
- **M7 audit coverage**: writes are logged; **reads are not**. "Who viewed this medical record" is unanswerable — a compliance gap for exactly the data the brief flags as child-safety-sensitive. Recommend read-logging on medical, and on any cross-student data access.
- **AI prompt injection**: the current copilot is a deterministic keyword scorer over pre-scoped aggregates — it has no instruction-following surface, so it is structurally immune, and I confirmed data is loaded per-role from the same scoped services as dashboards (a PARENT actor can only reach `getParentDashboard(actor.profileId)`). **This immunity disappears in Phase 5** the moment an LLM sits in the loop. The Phase 5 design must keep authorization at the tool/execution layer (never in the prompt) — carried into that phase as a build constraint, not an audit item.

---

## Files changed

`backend/src/`: `app.js`, `config/env.js`, `utils/jwt.js`, `middleware/auditLogger.js`, `modules/auth/auth.routes.js`, `modules/auth/auth.service.js`, `modules/uploads/upload.routes.js`, `modules/whatsapp/whatsapp.service.js`, `modules/whatsapp/whatsapp.controller.js`, `routes/index.js`.

**Note on `routes/index.js`:** this file contains your in-flight uncommitted work (the `/leave` module route). The C2 fix edits it, so I left it **unstaged** rather than committing your work-in-progress along with my change — review and commit it with your own changes. Every other file above was clean and is committed.

All ten changed files pass `node --check`. No existing behavior was refactored; each change is additive or a deletion of the vulnerable path.
