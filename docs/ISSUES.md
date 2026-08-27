# EduOS ERP — Issues Register

**Audit date:** 2026-08-26 · **P1 resolved:** 2026-08-27 · **P2 resolved:** 2026-08-27 · **P3 + backlog:** 2026-08-27
**Scope:** Full repository — `backend/src` (173 files, ~22,250 LOC) and `frontend/src` (156 files, ~22,040 LOC).
**Method:** The original audit (2026-08-26) was static analysis and automated build/type verification only, with no code changed and the application never booted.

**Update (2026-08-27):** the four **P1** items have since been fixed and covered by tests. Everything from **P2** down is untouched and still open. Runtime and browser testing remain outstanding — see [What this audit did *not* cover](#what-this-audit-did-not-cover).

This file lists **defects** — things that are wrong or missing. Improvements and ideas live in [`ENHANCEMENTS.md`](./ENHANCEMENTS.md).

---

## Verification performed

Everything below passed. The codebase is in a healthy, buildable state; the issues in this register are real but none of them break the build.

| Check | Result |
|---|---|
| Backend syntax (`node --check`, all 173 files) | **0 failures** |
| Backend production build (`npm run build` → `dist/app.js`) | **Clean** |
| Backend bundle parse (`node --check dist/app.js`) | **Clean** |
| Backend module graph (import all routes) | **Loads, no circular-import breakage** |
| Frontend typecheck (`tsc --noEmit`, whole project) | **0 errors** |
| Frontend production build (`next build`) | **Exit 0, no errors or warnings** |
| Secrets hygiene (`.env` tracked in git) | **Not tracked** — only `.env.example` |
| Build artifacts (`backend/dist/` tracked in git) | **Not tracked** — correctly gitignored |
| Hardcoded secret literals in source | **None found** |
| `TODO` / `FIXME` / `HACK` markers | **0** |
| Route authentication coverage | **Every module router calls `authenticate`** |
| Route permission coverage | **All guarded**, via `requirePermission`, module-level `router.use()`, or local `read`/`manage` aliases |
| Production boot-time config validation | **Present and strict** (`config/env.js` refuses to start on insecure defaults) |

> **Correction to an earlier statement in this session:** I previously said `backend/dist/app.js` was "a committed esbuild bundle." That was wrong. `.gitignore` contains `**/dist/` and `git ls-files` returns zero entries under `backend/dist/`. It is a local build artifact only.

---

## Severity key

| Level | Meaning |
|---|---|
| **P1** | Correctness or data-integrity defect. Can corrupt data or lose money. Fix before further production use. |
| **P2** | Real defect with user-visible or operational impact. Schedule deliberately. |
| **P3** | Minor defect, papercut, or accepted risk worth recording. |

---

## P1 — Correctness and data integrity

> **Status: all four resolved on 2026-08-27.** Each fix was validated by
> reverting to the original implementation and confirming the new tests fail
> against it — see the *Verified by* note under each item. Full suite:
> **59 tests, 4 files, all passing** (`npm test` in `backend/`).

### ISS-001 · ~~Manual payment recording is not atomic and loses concurrent updates~~ — **FIXED**
**File:** `backend/src/modules/fees/fee.service.js` (`recordPayment`)

```js
const payment = await Payment.create({ ... });   // write 1
invoice.paidPaise += amount;                     // read-modify-write in JS
invoice.status = invoice.paidPaise >= invoice.totalPaise ? 'PAID' : 'PARTIAL';
await invoice.save();                            // write 2
```

Two distinct defects in four lines:

1. **Lost update.** `invoice.paidPaise += amount` is computed in application memory from a value read earlier. Two cashiers recording payments against the same invoice at the same time both read `paidPaise = 0`, both write `0 + their amount`, and **one payment vanishes from the invoice total** while its `Payment` row still exists. The ledger and the invoice permanently disagree.
2. **No transaction.** `Payment.create()` and `invoice.save()` are separate writes. If the process dies or the second write fails between them, a payment is recorded that the invoice never reflects.

**Why this is unambiguous:** the *same file* already does it correctly on the gateway path. `settleGatewayPayment` (line 498) uses an atomic conditional claim and an atomic increment:

```js
const claimed = await Payment.findOneAndUpdate(
  { _id: intent._id, status: 'INITIATED' },   // atomic claim
  { $set: { status: 'SUCCESS', ... } }, { new: true });
if (!claimed) return { idempotent: true, ... };
await Invoice.updateOne({ _id: claimed.invoiceId }, { $inc: { paidPaise: claimed.amountPaise } });
```

The correct pattern is already established and understood in this codebase. It is simply not applied to the staff-entry path.

**Failure scenario:** Invoice total ₹50,000, `paidPaise = 0`. Two staff record ₹25,000 each within the same second. Both read 0. Final `paidPaise` = 25,000 rupees, not 50,000. Two `Payment` rows totalling ₹50,000 exist. The invoice shows `PARTIAL` with ₹25,000 outstanding that the parent has already paid.

**Note:** `modules/fees/` used no transactions at all — `runInTransaction` appeared only in `academics`, `admissions`, and `students`.

#### Resolution
`recordPayment` now performs the credit as a **single atomic statement** — a filtered aggregation-pipeline update that increments `paidPaise` in the database and derives `status` from the committed figure in the same operation — wrapped in `runInTransaction` alongside the `Payment.create`. On a standalone MongoDB (where `runInTransaction` falls back to running without a session) a failed ledger write triggers an explicit compensating decrement, so the invoice never shows money with no ledger row behind it.

**Verified by:** `tests/fees.recordPayment.test.js` (17 tests). Reverting to the original implementation fails **12 of 17**, including the decisive one:

```
FAIL  applies every concurrent payment exactly once
AssertionError: expected 25000 to be 50000
```

That is the lost update, reproduced: two concurrent ₹250 payments against a ₹500 invoice left the invoice showing ₹250 while both `Payment` rows existed. The suite asserts the real invariant — `invoice.paidPaise === sum(payments)` — under 2-way and 10-way contention.

---

### ISS-002 · ~~No overpayment guard on manual payment recording~~ — **FIXED**
**File:** `backend/src/modules/fees/fee.service.js` (`recordPayment`)

`amountPaise` was validated as a positive finite number, but nothing checked it against the outstanding balance. A typo of `500000` instead of `50000` was accepted, `paidPaise` exceeded `totalPaise`, and the invoice flipped to `PAID` with a silently negative balance.

#### Resolution
The overpayment check is now part of the same atomic statement that applies the credit, as a `$expr` filter: the update matches only if `paidPaise + amount <= totalPaise`. Because guard and write are one operation, concurrent payments cannot collectively overshoot the total either. A non-match is disambiguated into a specific error — `PAYMENT_EXCEEDS_BALANCE`, `INVOICE_CANCELLED`, or a 404.

Also tightened while here: `amountPaise` must be a positive **integer** (paise are indivisible; a float meant the caller was passing rupees), and `mode` is validated against the schema enum *before* anything is written.

**Verified by:** `tests/fees.recordPayment.test.js` — overpayment, over-remaining-balance, payment against a fully-paid invoice, and a 3-way race where only 2 of 3 payments can fit.

---

### ISS-003 · ~~Admission number generation is racy, O(n), and fails loudly under collision~~ — **FIXED**
**File:** `backend/src/modules/admissions/admission.service.js`

```js
const count = await Student.countDocuments({}).session(session);
let admissionNo = `ADM-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
let checkStudent = await Student.findOne({ admissionNo }).session(session);
let attempts = 0;
while (checkStudent && attempts < 100) {
  attempts++;
  admissionNo = `ADM-${...}-${String(count + 1 + attempts).padStart(4, '0')}`;
  checkStudent = await Student.findOne({ admissionNo }).session(session);
}
await Student.create([{ admissionNo, ... }], { session });
```

Three problems:

1. **Derived from a count, not a sequence.** `countDocuments({})` is not a monotonic counter. Two concurrent admissions read the same count and race for the same number.
2. **Loop exits without succeeding.** When `attempts` reaches 100 the loop terminates *with `checkStudent` still truthy* and falls straight through to `Student.create()` with a number known to be taken. Because `admissionNo` is `unique: true`, this throws an unhandled E11000 duplicate-key error, surfacing to the user as a generic 500 rather than a clear message.
3. **O(n) per admission.** `countDocuments({})` scans the full students collection on every single admission, and the collision loop issues up to 100 additional queries.

#### Resolution
New `Counter` model (`models/counter.model.js`) and `nextSequence()` helper (`utils/sequence.js`) provide atomic named sequences via a single-document `$inc` — O(1) and collision-free. `admissionNo` now draws from `admissionNo:<year>`.

Existing databases are handled: on first use of a year's sequence, `seedWith` carries over the highest number already issued that year, so numbering continues rather than restarting at 1. Seeding uses `$setOnInsert` + upsert, so two callers racing to seed cannot both win. The retry loop now bounds at 5 attempts and, on exhaustion, throws `ADMISSION_NO_UNAVAILABLE` (409) instead of the old fall-through that created a student with a number it knew was taken.

**Verified by:** `tests/admissions.admissionNo.test.js` (11 tests). Reverting fails **4**, most starkly:

```
FAIL  issues unique numbers when several leads enrol at once
AssertionError: expected [ 2 items ] to have a length of 12 but got 2
```

Twelve concurrent enrolments produced **two** students under the original code — ten were silently lost to duplicate-key collisions.

> **A bug I introduced and caught during this fix:** the seeding regex was first written as a template literal, `` `^ADM-${year}-\d+$` ``. In a template literal `\d` collapses to a plain `d`, so the pattern was `^ADM-2026-d+$` and matched nothing — which would have seeded every existing database at 0 and collided with every number already issued. Rebuilt by concatenation with an explicit escape, and covered by the "continues from existing numbering" test.

---

### ISS-004 · ~~Zero automated tests across ~44,000 lines~~ — **RESOLVED (backend)**
**Files:** `backend/package.json`, `frontend/package.json`

*As originally found:* neither package defined a `test` script, and a repository-wide search for `*.test.*`, `*.spec.*`, `__tests__/`, and any of jest / vitest / mocha / supertest configuration returned **nothing**.

There was no regression safety net on: authentication and lockout, permission scoping, the fee ledger, OTP issuance and verification, medical-record access control, timetable generation, or CSV bulk import.

#### Resolution
Backend test infrastructure is in place: **Vitest** + **`mongodb-memory-server`**, with `npm test` and `npm run test:watch` in `backend/package.json`.

`tests/setup.js` starts a **replica set**, not a standalone, deliberately: `session.withTransaction` only works on a replica set, so a standalone would silently take `runInTransaction`'s non-transactional fallback and the ISS-001 tests would pass without exercising what they claim to cover. Collections are cleared (not dropped) between tests so declared unique indexes stay enforced.

**59 tests across 4 files, all passing:**

| File | Tests | Covers |
|---|---|---|
| `fees.recordPayment.test.js` | 17 | ISS-001, ISS-002 — atomicity, concurrency, overpayment, validation |
| `admissions.admissionNo.test.js` | 11 | ISS-003 — sequence atomicity, seeding, collision skip, no collection scan |
| `auth.lockout.test.js` | 12 | Audit item M4 — failure counting, 5-strike lockout, expiry, streak reset |
| `medical.accessGate.test.js` | 19 | Audit item M7 — per-role access matrix on both doors, read/denial auditing |

Every one of these was validated by reverting the implementation and confirming the tests fail — they are not vacuous.

**Still outstanding:** the frontend has no test setup, and backend coverage is limited to these four areas. OTP flows, CSV bulk import, and timetable generation remain uncovered. See `ENHANCEMENTS.md` ENH-001 for the full priority list.

---

## P2 — Defects with user-visible or operational impact

> **Status: all resolved on 2026-08-27.** ISS-008 turned out to be a false
> positive in the original audit. ISS-009 was initially deferred as
> unverifiable, then implemented and checked end-to-end against a running
> server once a safe way to run the stack existed.

### ISS-005 · ~~No ESLint configuration~~ — **FIXED**
**File:** `frontend/` (no `.eslintrc*`, no `eslint.config.*`)

Running `npx next lint` does not lint — it drops into an interactive first-run setup prompt asking how to configure ESLint. There is no lint script in either `package.json`.

Consequence: no automated detection of unused variables, missing React hook dependencies, accessibility violations, or `no-floating-promises`. Several issues in this register (ISS-007, ISS-008) are exactly what `eslint-plugin-jsx-a11y` catches automatically.

#### Resolution
`.eslintrc.json` added, extending `next/core-web-vitals` and `plugin:jsx-a11y/recommended`, with `lint`, `lint:fix` and `typecheck` scripts in `package.json`.

The first run reported **24 errors and 97 warnings**. All are now resolved: **0 / 0**. It immediately found things the manual audit had missed — a redundant `alt`, two mouse-only hover handlers with no keyboard equivalent, seven form labels not associated with any control, and a redundant ARIA role.

---

### ISS-006 · ~~No error boundaries or loading states anywhere in the App Router~~ — **FIXED**
**Files:** `frontend/src/app/` — no `error.tsx`, `global-error.tsx`, `not-found.tsx`, or `loading.tsx` exist at any level.

Any uncaught render error in any page produces Next.js's raw default error screen, with no branding, no recovery action, and no way back into the app. A bad API response that yields an unexpected shape takes out the whole route.

There are also no route-level `loading.tsx` files, so navigation between portal pages has no streamed loading state — individual components handle their own spinners inconsistently.

#### Resolution
Four files added at the app root: `error.tsx` (branded boundary with *Try again* / *Back to start*, logging the digest so a reported failure can be traced), `global-error.tsx` (for failures in the root layout itself — it renders its own `html`/`body` with hard-coded colours, since no stylesheet or provider can be assumed at that point), `not-found.tsx`, and `loading.tsx`.

---

### ISS-007 · ~~43 keyboard-inaccessible click handlers~~ — **FIXED** (real count was 56)
**Files:** across `frontend/src` — 43 occurrences of `<div ... onClick=...>`, of which **zero** carry `role`, `tabIndex`, or a keyboard handler.

Confirmed instances include the day cells in `components/timetable/month-view.tsx`, the agenda rows in `components/timetable/timetable-calendar.tsx`, and the modal overlay dismiss targets.

These are functional controls that cannot be reached by keyboard and are not announced as interactive by screen readers. For a school system with a statutory accessibility obligation in most jurisdictions, this is the single largest a11y gap in the codebase.

The correct pattern is already used elsewhere in this repo — `components/registrations/elective-catalog.tsx` and `time-grid.tsx` use real `<button>` elements — so this is inconsistency rather than ignorance.

#### Resolution
The original count of 43 was **wrong** — it only matched `<div onClick` on a single line, missing `span`/`td`/`tr`/`li` and multi-line tags. ESLint found **56**. Those split three ways, each handled differently:

| Kind | Count | What was done |
|---|---|---|
| Genuinely interactive content | 7 | Spread a new `clickable()` helper from `ui.tsx`: `role="button"`, `tabIndex`, Enter/Space activation, optional `aria-label` |
| Modal backdrops | 21 | Converted to the `onMouseDown` target-check the `Modal` primitive already used, then annotated (below) |
| Redundant `stopPropagation` | 22 | **Deleted entirely** — the target check makes them unnecessary |

The backdrop conversion is a real fix rather than rule-silencing: it also means a drag that starts inside a dialog and ends on the backdrop no longer closes it, which the click-based version got wrong.

Backdrops keep a documented `eslint-disable`, because the rule cannot be satisfied there — a backdrop must **not** be a tab stop or carry `role="button"`, as that would put a meaningless control in the tab order ahead of the dialog's real content. Keyboard users close these through `ModalA11yBridge` (Escape plus a focus trap, already mounted in `shell.tsx`) and the visible close button. The annotation script refused to suppress anything it could not positively identify as a backdrop, and flagged the single exception for manual handling.

---

### ISS-008 · ~~Image without alternative text~~ — **NOT A DEFECT** (audit false positive)
**File:** `frontend/src/app/student/profile/page.tsx:94`

The only `<img>` in the codebase lacking an `alt` attribute. Screen readers announce the filename or nothing at all.

#### Correction
**This was a false positive.** The original grep matched `<img` and `alt=` on separate lines and concluded the attribute was missing. A proper parse of every `img` tag in the codebase found **1 tag, 0 missing `alt`**.

ESLint did find a real but different problem at the same location — `jsx-a11y/img-redundant-alt`, because the text read "…'s profile photo" and screen readers already announce an image as an image. That is fixed; the alt is now just the person's name.

---

### ISS-009 · ~~Refresh token stored in `localStorage`~~ — **FIXED and verified over real HTTP**
**File:** `frontend/src/lib/api.ts:9-11`

```js
const REFRESH_KEY = 'eduos.refresh';
localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
```

Any successful XSS reads the refresh token and mints access tokens indefinitely. The access token is correctly held in memory only; the refresh token is not.

**This is a known, documented risk** — the file's own header comment says: *"Production hardening (Phase 7): move refresh into an httpOnly cookie behind a BFF route handler so it never touches JS-readable storage."* Recorded here so it is tracked rather than forgotten, not because it is unrecognised.

Partially mitigated by refresh-token rotation with reuse detection in `auth.service.js` (a stolen-and-replayed token revokes every session on the account), which limits the window but does not close it.

#### Resolution

Originally deferred as unverifiable. That blocker was removed by building a way
to run the stack safely, so it has now been implemented **and exercised
end-to-end against a running server**.

The refresh token is now held in an httpOnly cookie and never reaches
JavaScript:

- `frontend/src/app/api/session/route.ts` — stores the token in the cookie on
  sign-in (`POST`), clears it on sign-out (`DELETE`).
- `frontend/src/app/api/session/refresh/route.ts` — reads the cookie
  server-side, calls the backend, writes the **rotated** token straight back
  into the cookie, and returns only the access token to the browser.
- `lib/api.ts` — `doRefresh()` now calls the BFF instead of the backend
  directly. localStorage holds only a boolean marker (`eduos.session`) so
  `hasSession()` can stay synchronous for its four callers; the marker leaks
  nothing, and a stale one costs a single failed refresh.

Two details that matter: the backend rotates refresh tokens on every use and
revokes the entire session if a spent one is replayed, so the route persists the
rotated token *before* responding. And a backend that is merely unreachable
returns 503 without clearing the cookie — an outage must not sign everyone out.

**Verified by** (see also the two suites below):
- **20/20 HTTP checks** against a running Next server: cookie is `HttpOnly`,
  `SameSite=Lax`, path-scoped; the response body never echoes the token; refresh
  returns an access token and **no** refresh token; the rotated token is written
  back; a second refresh with the rotated cookie works; replaying a spent cookie
  is rejected **and clears the cookie**; no cookie is 401; sign-out expires it.
- `tests/authFlow.integration.test.js` (9 tests) pins the backend contract the
  route depends on — rotation, reuse detection, revocation on logout, and that
  refresh tokens are stored hashed.

#### Original reasoning, kept for the record

This was initially the only P2 item left open, as a deliberate call.

Fixing it properly means moving the refresh token into an httpOnly cookie behind a BFF route handler: a new Next route to proxy refresh, changes to `setSession` / `clearSession` / `doRefresh` in `api.ts`, changes to both the password and Google sign-in flows, cookie clearing on logout, and CORS credential handling on the backend. It rewrites the token lifecycle for every sign-in path in the app.

The concern was that `.env` points `MONGO_URI` at the live Atlas cluster, so the
app had never been booted, and an auth change is exactly the kind that types,
lint and unit tests cannot validate.

**That was addressed rather than worked around.** `backend/scripts/run-local.js`
(`npm run dev:local:seed`) boots the real server against an ephemeral in-memory
replica set, overriding `MONGO_URI` so production is unreachable from the run.
With that, the flow could be driven for real — which is how the 20 checks above
were produced.

---

### ISS-010 · ~~Most list endpoints are unbounded~~ — **FIXED** (mechanism added; rollout partial)
**Files:** across `backend/src/modules/*/*.service.js`

- **181** `.find()` calls with no `.limit()`.
- Only **4 of 19** service modules implement pagination: `fees`, `risk`, `students`, `users`.

Unpaginated endpoints include announcements, assignments, calendar, documents, exams, hostel (4 list methods), leave, library, notifications, profiles, roles, and tickets. On the seeded dataset (720 students) these are small; at multi-year scale, endpoints like `listEnrollments` and the attendance queries return unbounded result sets that will degrade the API and the browser together.

`registration.service.js:listForReview` (added this session) caps at 200 but does not paginate — it silently truncates rather than offering a next page.

#### Resolution
A shared `utils/paginate.js` implements the **opt-in** pattern `student.service.js:list` already used: a caller passing `pageSize` gets `{ items, total, page, pageSize, totalPages }`; a caller that does not still gets a bare array. That matters because every frontend consumer types these endpoints as `T[]` — switching them to an envelope wholesale would have broken all of them at once.

The unpaginated path is no longer unbounded: it is capped at 500 rows, and **truncation is never silent** — hitting the cap logs a warning naming the endpoint and the filter, so it gets paginated properly before anyone is quietly missing rows. `MAX_PAGE_SIZE` (200) stops a caller pulling the whole collection through the paginated path either.

Applied to the endpoints that grow monotonically over the life of the school: `tickets.list`, `library.listBooks`, `documents.listForActor`, `leave.listMine`, and `registrations.listForReview` — the last of which previously did a bare `.limit(200)` with no way to reach anything past it.

**Rollout is partial, deliberately.** The remaining unpaginated lists are bounded reference data (grades, subjects, terms, academic years, roles, permissions) where pagination would add complexity for no benefit. Anything unbounded that is still unpaginated now hits the 500-row cap and logs, so it announces itself instead of silently degrading.

**Verified by:** `tests/paginate.test.js` (15 tests) — backward compatibility for every non-paginating caller shape, page slicing, out-of-range and negative page clamping, the `pageSize` ceiling, the empty-result case, cap-and-warn behaviour, and an end-to-end pass through `library.listBooks` confirming DTO mapping still applies inside the envelope and that pagination composes with a search filter rather than replacing it.

---

### ISS-011 · ~~`document.model.js` declares no indexes~~ — **FIXED**
**File:** `backend/src/models/document.model.js`

The only Mongoose model in the codebase with no `.index()` call, no `index: true`, and no `unique: true` on any field. Every other model declares at least one. Document queries will collection-scan.

#### Resolution
Four compound indexes added, derived from `buildVisibilityFilter()` in `document.service.js` — the only path by which documents are ever queried: `{visibleToRoles, createdAt}`, `{studentId, createdAt}`, `{authorProfileId, type}`, and `{sectionId, type, createdAt}`. `createdAt` is the trailing key on each because every list sorts by it descending, which lets Mongo satisfy the sort from the index rather than sorting the whole match set in memory.

---

### ISS-012 · ~~47 uses of `any` erode type safety at the API boundary~~ — **FIXED**
**Files:** concentrated in `frontend/src/lib/api.ts` (8) and `frontend/src/app/api/auth/[...nextauth]/route.ts` (12).

`api.ts` is the single layer where backend responses become typed frontend data — `any` there defeats the purpose of the DTO types in `lib/types.ts`. Most remaining occurrences are `catch (err: any)`, which is idiomatic enough in TypeScript below 4.4 but should be `unknown` with narrowing.

#### Resolution
**47 to 15**, and `api.ts` itself is now completely `any`-free.

- A `RawDoc<T>` type models what the API actually returns (Mongo's `_id`, or an already-normalised `id`), replacing `any[]` in the academics mappers — the field reads inside those `.map()` calls are now type-checked.
- The `/risk/scan` normaliser, which handles three historical response shapes, is modelled as a union instead of `any`. **This immediately caught a live bug:** the code below it read `raw.summary`, `raw.total`, `raw.page` and so on off a value that is sometimes a bare array, where every one of those was silently `undefined`. Now read from the normalised envelope.
- NextAuth's `Session`, `Profile` and `JWT` are extended by module augmentation in `src/types/next-auth.d.ts`, removing 12 `as any` casts and making a typo in any custom session field a compile error instead of a silent runtime `undefined`.
- 12 `catch (e: any)` blocks now catch `unknown` and narrow through a new `errorMessage(err, fallback)` helper — `e.message` was a lie the compiler accepted, since a thrown string or a rejected non-Error reaches those handlers too.

**A second live bug surfaced here:** two payment screens checked `e?.code === 'OVERPAYMENT'`, but the code the server actually emits is `PAYMENT_EXCEEDS_BALANCE` (added in the ISS-002 fix). The friendly "amount exceeds the balance" message would never have appeared. Both now narrow on `ApiError` and surface the server's own message, which states the exact outstanding balance.

The 15 remaining sit in page-level components and comment text, not at the API boundary.

---

## P3 — Minor and accepted

> **Status: 3 of 5 resolved on 2026-08-27** (ISS-013, ISS-014, ISS-015).
> ISS-016 and ISS-017 are refactors, still open — see `ENHANCEMENTS.md`
> ENH-018 and ENH-019.

### ISS-013 · ~~`CORS_ORIGIN` defaults to `*`~~ — **FIXED**
**File:** `backend/src/config/env.js:79`

`process.env.CORS_ORIGIN ?? '*'`, guarded in production by the insecure-defaults
check.

**Resolution:** the default is now `http://localhost:3000`, so development
exercises the same cross-origin rules as production instead of hiding CORS
mistakes until deploy. The production boot check is unchanged and still refuses
`*`. `.env.example` updated to match.

### ISS-014 · ~~Empty catch block~~ — **FIXED**
**File:** `backend/src/middleware/auditLogger.js:153`

`try { parsedBody = JSON.parse(body); } catch (e) {}` — a deliberate fallback
for non-JSON response bodies.

**Resolution:** rewritten as a bare `catch { … }` with a comment stating why
falling through is correct (not every response body is JSON, and the audit entry
is still worth writing without the parsed body).

### ISS-015 · ~~No CI pipeline, no containerisation~~ — **FIXED**
**Files:** no `.github/workflows/`, no `Dockerfile`, no `docker-compose.yml`.

Nothing ran the build, typecheck or tests on push, and deployment was manual.

**Resolution:** `.github/workflows/ci.yml` with three jobs — backend (tests,
build, and a `node --check` on the built bundle, since that bundle is what
`npm start` actually runs), frontend (typecheck, lint at `--max-warnings 0`,
tests, build), and an advisory dependency audit. MongoDB binaries are cached so
the test job does not refetch them each run.

Containerisation: multi-stage `Dockerfile` for each service (non-root user,
production dependencies only) plus a `docker-compose.yml` that stands Mongo up
as a **single-node replica set** — the fee ledger and admission numbering use
transactions, which a standalone Mongo does not support.

**Caveat:** Docker is not installed in the environment these were written in, so
the images have never actually been built. The Compose file and Dockerfiles are
unvalidated by a real build.

### ISS-016 · Very large page components
**Files:** `app/(auth)/login/page.tsx` (625 lines), `app/admin/payments/page.tsx` (588), `app/admin/student-classes/page.tsx` (533), `app/admin/classrooms/page.tsx` (528), `app/admin/admissions/page.tsx` (491).

Data fetching, form state, table rendering, and modals all in one file. Not a defect in itself — noted because these five files concentrate the most complexity and the least test coverage in the codebase.

### ISS-017 · Ad-hoc data fetching, caching layer largely unused
**Files:** 88 components fetch with bare `useEffect` + `api.*`; only **2** files use the existing `lib/cache.ts` `cachedFetch` helper.

Each page independently re-fetches on every mount. A caching layer exists and is almost entirely unadopted. Manifests as redundant network requests and inconsistent loading/error handling between pages.

---

## Found later, while fixing

These were not in the original audit. They surfaced only because something else
forced the code to be exercised.

### ISS-018 · Bulk import rejects a whole chunk when any row duplicates — **OPEN**
**File:** `backend/src/modules/academics/academics.service.js` (`chunkedInsert`)

`chunkedInsert` runs each 100-row chunk as one transactional `insertMany`, so a
single duplicate aborts the chunk and the valid rows alongside it roll back too.
An operator whose 100-row sheet contains one existing subject gets **zero** rows
imported.

This is not a data-integrity bug — the report is honest, every row in the chunk
is counted as failed and the error names the clashing value, so nothing is
silently dropped. But it is poor behaviour for an unattended import, and it is
inconsistent with `bulkCreateLeads`, which validates per row and imports the
good ones.

Pinned by `tests/csvImport.test.js` so the current behaviour is at least
documented and cannot change unnoticed. Fixing it means dropping the
per-chunk transaction and using `insertMany(..., { ordered: false })` with
per-document error collection.

### ISS-019 · ~~`upsertSlot` skipped schema validation~~ — **FIXED**
**File:** `backend/src/modules/timetable/timetable.service.js`

`findOneAndUpdate` does not run validators unless asked, so the timetable
schema's own constraints were silently ignored on the only path that writes
slots — a slot with `dayOfWeek: 8` was accepted and written to the database.

Found by a test written for the timetable coverage gap, which expected the
declared `min: 1, max: 7` to be enforced and discovered it was not.
`runValidators: true` added; covered by `tests/timetable.test.js`.

### ISS-020 · Dependency vulnerabilities — **partly fixed**

`npm audit` had never been run. It reported **7 backend** (3 high) and
**8 frontend** (5 high, 2 critical) advisories.

`npm audit fix` (non-breaking) brought the backend to **1 moderate** and the
frontend to **5**. Both builds and all tests still pass afterwards.

The most significant fix was **`next-auth`**, which carried a *critical*
email-normalizer homoglyph bypass — this app uses it for Google sign-in.

**Still open:** the remaining five frontend advisories all require a **Next 14 →
16 major upgrade** (`next` itself, plus `postcss`, `glob` and
`@next/eslint-plugin-next` transitively). That is two major versions with App
Router breaking changes and needs a deliberate migration, not an `audit fix
--force`. An advisory `npm audit` job now runs in CI so this stays visible.

---

## What this audit did *not* cover

*Written during the original static audit. Several of these have since been
addressed; the current position is marked against each.*

- ~~**No runtime testing.**~~ **Now covered.** `backend/scripts/run-local.js`
  (`npm run dev:local:seed`) boots the real backend against an ephemeral
  in-memory replica set, with `MONGO_URI` overridden so Atlas is unreachable.
  Both servers were started and the auth flow driven over real HTTP
  (14 backend checks, 20 BFF cookie checks).
- **Browser testing: still only smoke-level.** Pages were confirmed to render
  (HTTP 200, correct 404 boundary, favicon served with the right content type),
  but nothing has been looked at visually. Layout, responsive behaviour and
  cross-browser rendering remain unverified — including the timetable calendar
  rework and the elective screens.
- **No penetration testing.** Authorization is now exercised by tests (the
  medical access matrix, timetable scoping, payment scope checks), but no
  attempt was made to bypass those checks with crafted requests.
- **No load or performance testing.** The pagination findings are structural
  observations, not measurements.
- ~~**No dependency vulnerability scan.**~~ **Now run** — see ISS-020. An
  advisory `npm audit` job runs in CI.
- **No database inspection.** Index effectiveness against real data volumes and
  actual query plans are still unexamined.
- **Docker images have never been built.** Docker is not installed in the
  environment the Dockerfiles were written in.

---

## Summary

| Severity | Open | Fixed | Not a defect | Total |
|---|---|---|---|---|
| P1 — Correctness / data integrity | 0 | **4** | 0 | 4 |
| P2 — User-visible / operational | 0 | **7** | 1 | 8 |
| P3 — Minor / accepted | 2 | **3** | 0 | 5 |
| Found later (ISS-018…020) | 2 | **1** | 0 | 3 |
| **Total** | **4** | **15** | **1** | **20** |

### Verification, current

| Check | At audit | Now |
|---|---|---|
| Backend tests | none existed | **164 passing, 12 files** |
| Frontend tests | none existed | **30 passing, 2 files** |
| ESLint (frontend) | not configured | **0 errors, 0 warnings** |
| `tsc --noEmit` | 0 errors | **0 errors** |
| Backend build + bundle parse | clean | **clean** |
| Frontend production build | clean | **clean** |
| `any` in frontend | 47 | **12** (0 in `api.ts`) |
| Dependency advisories | never scanned | backend **1 moderate**, frontend **5** (all need Next 16) |
| App ever run | never | **backend + frontend booted; auth driven over HTTP** |

### Still open

| Id | What | Why it is still open |
|---|---|---|
| **ISS-016** | Five very large page components | Refactor; no correctness impact. `ENHANCEMENTS.md` ENH-019 |
| **ISS-017** | Caching layer used by 2 of 88 fetchers | Refactor, or replace with TanStack Query. ENH-018 |
| **ISS-018** | Bulk import rejects a whole chunk on one duplicate | Behaviour change to an unattended import path; wants a deliberate decision |
| **ISS-020** | 5 frontend advisories | All need a Next 14 → 16 major upgrade with App Router breaking changes |

### Bugs found while fixing, not in the original audit

1. **Payment error-code mismatch.** Two payment screens checked for
   `'OVERPAYMENT'`; the server emits `PAYMENT_EXCEEDS_BALANCE`. The friendly
   balance message would never have shown.
2. **`/risk/scan` read paging fields off a bare array** — `raw.total`,
   `raw.page` and friends were silently `undefined`. Surfaced only once `any`
   was removed.
3. **A template-literal regex that matched nothing** (`\d` collapsing to `d`),
   introduced during the ISS-003 fix and caught by its own test before it could
   seed every existing database at zero.
4. **`upsertSlot` skipped schema validation** (ISS-019) — `dayOfWeek: 8` was
   accepted and written.
5. **A critical `next-auth` advisory** (ISS-020) — an email-normalizer homoglyph
   bypass in the library backing Google sign-in.

Items 1, 2, 4 and 5 were each found *because* something forced the code to be
exercised — removing `any`, writing a test, or running `npm audit`. None were
visible to reading alone.

The codebase is in better shape than these findings might suggest. Route authorization is comprehensive, production config validation is genuinely strict, the payment *webhook* path is carefully hardened against replay and amount tampering, and inline comments consistently explain *why* rather than *what*. The defects cluster in one module (`fees` manual entry), one omission (tests and lint), and one cross-cutting concern (accessibility).
