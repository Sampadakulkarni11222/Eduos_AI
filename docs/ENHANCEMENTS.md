# EduOS ERP — Enhancement Backlog

**Compiled:** 2026-08-26
**Companion to:** [`ISSUES.md`](./ISSUES.md)

This file lists **improvements** — things that work but could be better, and capability gaps worth closing. Nothing here is a defect; defects are in `ISSUES.md`.

**Nothing in this document has been implemented.** These are proposals with rationale, sized for planning.

---

## How to read the sizing

| Size | Rough meaning |
|---|---|
| **S** | Under a day |
| **M** | A few days |
| **L** | A week or more |

Value is judged as *risk reduced or capability gained per unit of effort*, not as a feature wish-list ranking.

---

## Tier 1 — Foundations (highest leverage)

These three unblock everything else. Without them, every subsequent change carries avoidable risk.

### ENH-001 · Test infrastructure · **L** · Highest value
Addresses `ISS-004`.

There is no way to change this system safely today. Recommended shape:

**Backend** — Vitest (fast, ESM-native, matches the `"type": "module"` setup) + `mongodb-memory-server` for real Mongo semantics without touching Atlas + `supertest` for HTTP-level route tests.

Seed the suite with the paths where a bug costs the most:

| Priority | Area | Why first |
|---|---|---|
| 1 | Fee ledger — `recordPayment`, `settleGatewayPayment`, refunds | Real money; `ISS-001` proves it is already wrong |
| 2 | Permission scoping — `requirePermission`, OWN-scope narrowing per role | The entire authorization model rests on this |
| 3 | Medical access gate — `assertCanAccess` across all roles and both doors | Privacy obligation; already has a documented access matrix |
| 4 | Auth — lockout counter, OTP issue/verify/throttle, refresh rotation and reuse detection | Account-takeover surface |
| 5 | CSV bulk import — partial failure, chunking, malformed rows | Runs unattended over large inputs |

**Frontend** — Vitest + React Testing Library for the logic-bearing components; Playwright for two or three end-to-end journeys (parent pays an invoice, teacher marks attendance, student registers for an elective).

> **Note:** several pure-logic modules are *already* structured for this. `lib/timetable-layout.ts` was deliberately extracted from the calendar component during this session so its overlap and windowing maths could be tested in isolation — 23 assertions were written and passed against it, but they were run ad hoc and **not committed**. That file is the natural first frontend test target, and re-creating those cases is the cheapest possible start.

---

### ENH-002 · ESLint + Prettier + `npm test`/`npm run lint` scripts · **S** · Very high value
Addresses `ISS-005`.

`eslint-config-next` with `eslint-plugin-jsx-a11y` would have caught `ISS-007` (43 inaccessible click handlers) and `ISS-008` (missing alt text) automatically. For the backend, `eslint` with `import/no-unresolved` and `no-floating-promises` catches a class of async bugs that are invisible to `node --check`.

Add matching `lint` and `test` scripts to both `package.json` files so there is one obvious command per check.

---

### ENH-003 · CI pipeline · **S** · Very high value
Addresses `ISS-015`.

A single GitHub Actions workflow on push and PR: install → typecheck → lint → test → build both packages. Every verification in this audit was run by hand; all of it is scriptable and none of it is currently enforced.

Natural follow-on: build `backend/dist/` in CI rather than relying on a developer remembering `npm run build` before deploy. This session produced two situations where source was fixed but the running bundle was stale until rebuilt manually.

---

## Tier 2 — Correctness hardening

### ENH-004 · Transactions across all multi-document writes · **M** · High value
Related to `ISS-001`.

`runInTransaction` already exists and is used correctly in `academics`, `admissions`, and `students`. The `fees` module — the one handling money — uses it nowhere. Extend it to every operation that writes more than one document, starting with `recordPayment`, `refundPayment`, and `generateInvoices`.

### ENH-005 · Atomic counters for human-readable identifiers · **S** · High value
Addresses `ISS-003`.

`admissionNo` derives from `countDocuments()`. Invoice numbers and receipt numbers should be checked for the same pattern. A single `counters` collection with `$inc`-and-return gives atomic, O(1), collision-free sequences for all of them.

### ENH-006 · Pagination across remaining list endpoints · **M** · Medium value
Addresses `ISS-010`.

Four modules (`fees`, `risk`, `students`, `users`) already implement a consistent `{ items, total, page, pageSize, totalPages }` shape, and the frontend has a `Pagination` component and `Paged<T>` type ready. This is applying an established in-house pattern to 15 more services, not designing something new.

### ENH-007 · Index review against real query patterns · **S** · Medium value
Related to `ISS-011`.

`document.model.js` has no indexes at all. Beyond that, run `explain()` over the highest-traffic queries (attendance by section and month, invoices by status and due date, audit log by actor) and confirm the declared indexes are actually used.

### ENH-008 · Replace `any` at the API boundary with `unknown` + narrowing · **S** · Medium value
Addresses `ISS-012`. Highest value in `lib/api.ts`, which is the one place backend responses become typed data. A shared `isApiError(e): e is ApiError` guard would replace most `catch (err: any)` sites at once.

---

## Tier 3 — User-facing capability

### ENH-009 · Admin UI for elective flags and capacity · **S** · High value
**Gap from this session's work.** `SubjectOffering.isElective` and `.capacity` are settable only through the API or a re-seed. Staff cannot create an elective or adjust its seat cap from the UI.

Add both controls to the existing Classroom Management screen. Without this, the elective registration feature added this session is not fully operable by its intended users.

### ENH-010 · Approved electives on the student timetable · **M** · High value
**Gap from this session's work.** Registration and timetable slots are separate systems. A student whose elective is approved sees it under *Subject Registration* but not on their *Timetable*, which is where they will actually look.

Requires deciding how an elective occupies a period — the seed deliberately keeps elective offerings out of the timetable generator, because that generator's no-double-booking stagger assumes exactly five subjects per section. This needs design, not just wiring.

### ENH-011 · Notify students of registration decisions · **S** · High value
**Gap from this session's work.** Approval and rejection are recorded in the audit trail and shown on the catalogue, but nothing tells the student. They have to remember to check.

A `notifications` module already exists. Emitting a notification from `registration.service.js:decide` is a small, well-scoped addition.

### ENH-012 · Registration windows · **M** · Medium value
Currently a student can register any time before the term ends. Real schools open and close elective registration on set dates. Would need `registrationOpensOn` / `registrationClosesOn` on `Term` or the offering, plus a clear closed-state in the UI.

### ENH-013 · Waitlists for full electives · **M** · Medium value
A full elective currently shows "Full" with no recourse. A waitlist that auto-promotes when an approved student withdraws would be a meaningful improvement — the seat-accounting logic in `registration.service.js` already tracks `PENDING` and `APPROVED` as seat-holding, so the counting groundwork exists.

### ENH-014 · Bulk approve/reject in the review queue · **S** · Medium value
The review queue decides one request at a time. A teacher facing forty requests for one elective needs multi-select with a shared decision note.

---

## Tier 4 — Quality and operations

### ENH-015 · Error boundaries and loading states · **S** · High value
Addresses `ISS-006`. A branded `error.tsx` with a retry action at the app root plus per-portal boundaries, a `not-found.tsx`, and `loading.tsx` for the heavier routes. Small work, disproportionate effect on how the app behaves when something goes wrong.

### ENH-016 · Accessibility pass · **M** · High value
Addresses `ISS-007` and `ISS-008`. Convert the 43 `<div onClick>` handlers to real `<button>` elements — the correct pattern is already used in `elective-catalog.tsx` and `time-grid.tsx`, so this is mostly mechanical. Then audit focus management in modals, colour contrast against the role accent themes, and keyboard traversal of the timetable grid.

Enable `eslint-plugin-jsx-a11y` (ENH-002) first so the fixes stay fixed.

### ENH-017 · Move the refresh token to an httpOnly cookie · **M** · High value
Addresses `ISS-009`. Already scoped in a code comment as "Phase 7": a BFF route handler holds the refresh token in an httpOnly, SameSite cookie so JavaScript — and therefore XSS — cannot read it.

### ENH-018 · Adopt the existing cache layer, or a data-fetching library · **M** · Medium value
Addresses `ISS-017`. `lib/cache.ts` exists and 2 of 88 fetching components use it. Either adopt it consistently or replace both with TanStack Query / SWR, which would also standardise the loading and error handling that is currently reimplemented per page.

### ENH-019 · Extract logic from the five largest page components · **M** · Medium value
Addresses `ISS-016`. Pull data fetching and form state into hooks, tables into components. Makes the most complex screens testable, which is currently the main reason they are not tested.

### ENH-020 · Audit log retention and query surface · **M** · Medium value
The PII/medical read auditing added this session means the `auditlogs` collection now grows with every *read*, not just every write — substantially faster than before. Needs a retention policy (TTL index or archival), and the audit UI needs filtering by actor, entity, and date range to be usable for a real privacy investigation. The API currently filters on exact `action` only.

### ENH-021 · Dependency and container hygiene · **S** · Medium value
No `npm audit` in CI, no Dockerfile, no lockfile-integrity check. Containerising both services would also remove the environment drift that makes the manual build/deploy steps fragile.

### ENH-022 · Structured error codes end to end · **S** · Low value
`AppError` supports a machine-readable `code` and the login screen maps codes to friendly copy — but coverage is partial. Many `AppError`s throw with a message only, so the frontend falls back to raw server text. Worth completing the convention so UI copy is never dependent on backend phrasing.

### ENH-023 · OpenAPI coverage check · **S** · Low value
Swagger JSDoc annotations are thorough on some routers and absent on others. A CI step asserting every registered route has a spec entry would keep the generated docs honest.

---

## Suggested sequencing

**Do first — one to two weeks, unblocks everything else**
ENH-002 (lint) → ENH-003 (CI) → ENH-001 (tests, starting with the fee ledger)

**Then — correctness, guarded by the tests just written**
ENH-004 (transactions) and ENH-005 (counters), which together close `ISS-001`, `ISS-002`, and `ISS-003`

**Then — finish what this session started**
ENH-009, ENH-011, ENH-010 — the elective feature is functional but not yet fully operable by staff or discoverable by students

**Then — quality**
ENH-015 (error boundaries), ENH-016 (a11y), ENH-017 (token storage)

**Ongoing**
ENH-006 (pagination) and ENH-008 (`any` removal) are both incremental and suit being done module by module alongside other work.

---

## A note on what is already good

Worth recording, because a backlog read alone gives an unfairly negative picture of this codebase:

- **Route authorization is comprehensive.** Every module router authenticates, and every endpoint carries a permission guard. No gaps found.
- **Production config validation is genuinely strict.** `config/env.js` refuses to boot on insecure defaults — wildcard CORS, console OTP providers, sandbox payments, missing webhook secrets — with a specific message per problem. This is better than most production systems.
- **The payment webhook path is carefully hardened.** Idempotency via atomic claim, amount-mismatch refusal, and re-verification against the gateway rather than trusting the payload. `ISS-001` exists precisely *because* the correct pattern is visible elsewhere in the same file.
- **Comments explain why, not what.** Consistently across the codebase, non-obvious decisions carry their reasoning — the timetable generator's double-booking stagger, the medical module's class-teacher-only narrowing, the refresh-token reuse policy. This is rare and materially speeds up work on unfamiliar areas.
- **Zero `TODO`/`FIXME` markers and one empty catch** across 44,000 lines. The codebase is not carrying hidden debt markers.
