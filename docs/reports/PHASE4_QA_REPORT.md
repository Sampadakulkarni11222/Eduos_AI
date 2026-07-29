# Phase 4 — Application QA & Issue Resolution (Part 1: verification pass)

_Date: 2026-07-29 · Environment: local MongoDB 8.2 (`eduos_qa`), full seed — **720 students, 720 enrollments, 720 invoices, 1461 accounts** — backend on :5055. All results below are from HTTP calls against a running instance with real seeded data, not code reading._

> **Scope note:** your issues sheet was still not available, so this pass is my own systematic run. The sheet-mapped closure log remains outstanding — send the sheet and I'll map findings to it. The Wave-1 **feature build** (Fee Portal, Notification Center, etc.) has **not** started; this report covers the verification half of Phase 4 only.

---

## 1. Headline: two confirmed data-exposure bugs, both fixed

### QA-1 — Any signed-in user could read the entire school audit log · **High** · FIXED

`GET /audit/logs` carried `authenticate` but **no permission check**. Verified live: a STUDENT account received the same 20 audit rows as ADMIN, including `action`, `entityType`, actor profile IDs and **source IP addresses** for every staff action in the school.

- **Fix:** `requirePermission('audit.read')` (the permission already existed in the catalog, granted to OWNER/ADMIN/PRINCIPAL only).
- **Verified after fix:** ADMIN 200, PRINCIPAL 200 · TEACHER / STUDENT / PARENT / LIBRARIAN **403**.

### QA-2 — Students and parents could read school-wide admin & finance dashboards · **High** · FIXED

The per-role dashboards were gated by permissions that low-privilege roles legitimately hold **at OWN scope**, while the aggregation services ignore scope entirely. `requirePermission` only checked that the permission existed, never at what scope.

Verified live before the fix — a STUDENT calling `/dashboard/admin` received:

```
{"totalStudents":720, "recentStudents":[{"admissionNo":"ADM-2026-0720","firstName":"Aarav","lastName":"Bh…
```

…i.e. other children's names and admission numbers. A STUDENT and PARENT could also read `/dashboard/finance` — 5.2 KB of school-wide fee collection totals (`pendingAmount`, `collectedAmount`).

A full 8-dashboard × 9-role sweep found **29 cross-role exposures**.

- **Fix (two parts, both in shared middleware so the class of bug is closed, not just the instances):**
  1. `requirePermission(key, minScope)` — an optional minimum scope; `'ALL'` now rejects an actor holding the permission only at OWN.
  2. New `requireRole(...roles)` — permissions answer *"may this actor touch this data"*; they don't answer *"is this actor the audience for this screen"*. Role-specific aggregations need both.
- Applied across all 8 dashboard routes.
- **Verified after fix:** 29 exposures → **3**, and all 3 are deliberate (ADMIN may read `/owner`; PRINCIPAL may read `/admin` and `/finance` — school-wide oversight roles). Flagged only because my expectation table was deliberately strict.
- **No regression:** the only 4 dashboards the frontend actually calls still work for their own role — ADMIN→`/admin` 200, TEACHER→`/teacher` 200, STUDENT→`/student` 200, PARENT→`/parent` 200.

---

## 2. RBAC cross-check — 16 probes × 9 roles

Every role was logged in and made to attempt actions belonging to other roles. Final state: **0 real violations**.

| Probe | Result |
|---|---|
| list roles / RBAC editor | only OWNER, ADMIN — all 7 other roles 403 |
| **grant self a permission** (`POST /roles/:id/permissions`) | refused for all 7 non-admin roles — no privilege-escalation path |
| read audit logs | OWNER/ADMIN/PRINCIPAL only *(after QA-1 fix)* |
| admin dashboard | OWNER/ADMIN/PRINCIPAL only *(after QA-2 fix)* |
| mark attendance | refused for PARENT/STUDENT — **the exact scenario the brief calls out** |
| record manual payment | PARENT/STUDENT get `403 "Manual payment recording requires staff access. Use online payment instead."` on a **real** invoice id |
| create student / hostel room / announcement | correctly refused per role |
| hostel, library, admissions | correctly scoped to their own staff |

**Two apparent violations were investigated and are false positives** — worth recording so they aren't "re-fixed" later:

- `GET /students` returns 200 for PARENT and STUDENT, but is correctly OWN-scoped: ADMIN sees **720** records, PARENT sees **1** (their child, "Diya Sharma"), STUDENT sees **1** (themselves).
- `POST /fees/payments` returns 404 for PARENT/STUDENT *with a fabricated invoice id* — the lookup fails before the staff check. With a real id it correctly 403s (above).

**Ownership boundaries verified with real IDs:** a PARENT requesting another family's student record gets `404 Student not found`; the same for `GET /medical/:id`. Using 404 rather than 403 is the right call — it avoids confirming the record exists.

---

## 3. Input handling & error states

| Test | Result |
|---|---|
| `/students/notanobjectid`, `/fees/invoices/zzz`, `/medical/notanid`, `/library/books/999` | clean `400` JSON (`Invalid _id: …`) — no stack traces |
| `/students/000000000000000000000000` (well-formed, absent) | clean `404` |
| **NoSQL operator injection** — `POST /auth/login` with `{"email":{"$ne":null},"password":{"$ne":null}}` | `400` rejected by the email validator; no operator reaches Mongo |
| Unhandled 500s across the whole session | **0** |
| Frontend `tsc --noEmit` (incl. your in-flight work) | clean |

---

## 4. Phase 3 items closed out with live evidence

Four Phase 3 fixes were code-review-only for lack of a database. All now verified against the running server (11/11):

- `/auth/register` unauthenticated OWNER creation → **401** ✓
- `/admin-seed` → **404** (endpoint gone) ✓
- Refresh-token **reuse detection** → replay returns `REFRESH_REUSE_DETECTED` and the rotated token is dead too (whole session family revoked) ✓
- Upload hardening → `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `CSP: default-src 'none'; sandbox` all present; `.svg`, `.html`, `.exe` rejected **415**, `.png` accepted ✓
- **Path traversal** — `x-filename: ../../../../etc/passwd.txt` stored safely as `passwd.txt` inside the upload dir ✓
- Audit-log redaction → **0** rows containing a plaintext password or OTP ✓

Both new rate limits also proved themselves by accident: my own test volume tripped the per-account OTP cap and then the per-IP credential limiter, forcing me to switch the harness to password login.

---

## 5. Other issues found

| # | Issue | Severity | Status |
|---|---|---|---|
| QA-3 | `npm run migrate` **crashes** after `npm run seed:school` — `E11000 duplicate key … academicyears index: name_1 dup key: { name: "2026-27" }` | Medium | **FIXED** — see §5.1 |
| QA-4 | `/observability/metrics` and `/ready` are **unauthenticated** | Medium | **FIXED** — see §5.2 |
| QA-5 | `/academics/*` reads (years, terms, grades, sections, subjects, offerings) are authenticated but ungated | Low | **FIXED** — see §5.3 |
| QA-8 | `/academics/sections/mine` and `/offerings/mine` returned the **entire school** to every role except TEACHER | **High** | **FIXED** — see §5.3. Found while fixing QA-5. |
| QA-6 | 4 of 8 dashboard endpoints (`owner`, `finance`, `warden`, `librarian`) are **not called by any frontend page** | Low | **Open — needs your call**, see §5.4 |

### 5.1 QA-3 — `npm run migrate` crashed on the documented setup sequence · Medium · FIXED

**Root cause was wider than first reported.** `migrate.js` pins fixed `_id`s so it can be re-run, which works on a database only it has touched. But documents created by `seed:school` have their own `_id` and the same natural key, and inserting a second one violates a unique index. Six upserts were exposed to this, not one: `academicyears` (`name`), `terms`, `enrollments` (`{studentId, academicYearId}`), `examsubjects` (`{examId, subjectOfferingId}`), `submissions` (`{assignmentId, enrollmentId}`) and `assignments`. `academicyears` simply crashed first.

**Before:** `npm run seed` → `npm run seed:school` → `npm run migrate` died with `E11000 … academicyears index: name_1 dup key: { name: "2026-27" }`.

**After:** a single `upsertByNaturalKey()` helper resolves each document by its natural key and **adopts whatever `_id` is already there**, using the pinned `_id` only when nothing exists. Downstream references use the returned id, so they stay consistent whichever seed created the row. `createdAt` also moved to `$setOnInsert`, so re-running no longer rewrites the creation time of existing rows.

**Verified:** the full documented sequence completes, and `migrate` then ran a **second** time cleanly — no `E11000`, exactly one `2026-27` academic year, no duplicate `academicyears.name` / `students.admissionNo` / `accounts.email`.

### 5.2 QA-4 — process metrics were unauthenticated · Medium · FIXED

**Before:** `GET /observability/metrics` was public and returned uptime, resident/heap memory, database state and **`process.version`**. The Node build in particular tells a reader which runtime CVEs to try.

**After:** `authenticate` + `requireRole('OWNER', 'ADMIN')`, and `process.version` is no longer in the payload at all.

**`/ready` is deliberately left public.** A load balancer or platform health check cannot hold a session, and the response says only whether the database is reachable. Gating it would break deployment health checks to hide nothing.

**Trade-off, stated rather than hidden:** a metrics scraper now needs a service account. Adding a shared bearer token here would have meant another secret to rotate, and a half-designed one at that.

**Verified:** unauthenticated → `401`; parent → `403 ROLE_NOT_PERMITTED`; admin → `200`; response contains no `nodeVersion`; `/ready` still `200` anonymously.

### 5.3 QA-5 + QA-8 — school structure was readable by any signed-in user · Low → **High** · FIXED

Fixing QA-5 surfaced a materially worse bug underneath it.

**QA-5, before:** the six `/academics/*` list reads were authenticated but ungated, so any signed-in user could enumerate every year, term, grade, section, subject and teaching assignment.

**QA-5, after:** a new `academics.read` permission, granted at `ALL` to every staff role (OWNER, ADMIN, PRINCIPAL, TEACHER, FINANCE, LIBRARIAN, WARDEN) and **not** to STUDENT or PARENT.

**QA-8 — the hole gating alone would have missed.** `getMySections()` and `getMyOfferings()` special-cased TEACHER and then **fell through to the unscoped full list for every other role**. So a student or parent could read the school's entire section and offering roster from `/academics/sections/mine`; gating `/academics/sections` on its own would only have moved the same data one URL over, while looking like a fix. Students and parents are now resolved to their own — or their children's — enrolled sections, and staff still get the full list because they hold `academics.read` anyway.

**Side effect worth knowing about.** The student and parent timetable pages render `<TimetableCalendar>` with no section and default to `sections[0]`. Because `mySections()` used to return the whole school, those pages were defaulting to an arbitrary class and offering a picker for every other one. They now default to the family's actual class.

**Verified:** all six list endpoints → parent `403`, student `403`, admin `200`. `/sections/mine` → student 1 of 12 sections, parent 1 of 12, admin 12 of 12. `/offerings/mine` → student 5 of 60, and every one belongs to a section they are actually in.

**Deployment note:** `academics.read` is a new catalog key, so **an existing database must be re-seeded (`npm run seed`) for staff to keep access to these routes.** Without it they will get `403`.

**Two matrix rows that looked like violations and were not.** The RBAC matrix flagged PARENT/STUDENT reaching `GET /students` (200) and `POST /fees/payments` (404). Both are correct: `students.read` is granted at `OWN` scope and the list comes back filtered — measured at **1 of 720**, not 720 of 720 — and parents legitimately hold `fees.pay` for their own invoices, then get stopped by ownership (`403` on a real invoice belonging to another family). The matrix only compares status codes, so it cannot tell a scoped 200 from a leak. Expectations corrected there rather than "fixing" working controls.

### 5.4 QA-6 — four dashboard endpoints nothing calls · Low · open

Not a defect, a decision, so I have not made it unilaterally. `/dashboard/owner`, `/finance`, `/warden` and `/librarian` each aggregate in the database in one round trip, and the portal homes ignore them: `owner/page.tsx` makes four separate calls (`students`, `pipeline`, `feeSummary`, `auditLogs`) that the one endpoint already returns, and `finance/page.tsx` makes two.

**Recommendation: wire the portals to them, don't retire them** — fewer round trips and one place where the aggregation lives. But that means rewriting four working portal home pages, which is structural, so it needs your go-ahead before I touch verified flows.

---

## 6. Files changed this phase

`backend/src/middleware/permission.js` (added `minScope` + `requireRole`), `backend/src/modules/dashboard/dashboard.routes.js`, `backend/src/modules/audit/audit.routes.js`.

No service/business logic was touched — all changes are route-level guards, so no previously-verified flow was refactored.

## 8. Wave-1 build started: fee structure engine · **built & tested**

Phase 1 ranked this first because everything else in the fee track (student/parent Fee Portal, receipts, defaulter workflows) sits on top of it.

**Correction to Phase 1 first.** Reading the module properly showed the gap was narrower than my benchmark claimed. Already present: `FeeHead`/`FeeStructure`/`InvoiceLine` schemas (with `concessionPaise`) and **CSV-driven** bulk invoicing. Actually missing: fee heads and structures could be *created but never listed*, and nothing generated invoices *from* structures. The Phase 1 report has been corrected rather than left to read better than reality.

**Built** (`fee.service.js` / `fee.controller.js` / `fee.routes.js`):

| Endpoint | Purpose |
|---|---|
| `GET /fees/heads` | list the fee-head catalog (was write-only) |
| `GET /fees/structures?academicYearId&gradeId` | list structures; a grade filter also returns `gradeId: null` structures, which apply to every grade |
| `POST /fees/invoices/generate` | **the engine** — bill every active enrollment in scope from the matching structures; `dryRun` previews without writing |

Design decisions worth flagging:

- **Idempotency is per fee structure, not per run.** Re-running after adding a structure bills only the new one and never double-charges a family. This is the granularity that matches how the endpoint will actually be used (re-run whenever something changes), and it's the behaviour I'd most expect to be wrong, so it's explicitly tested.
- Enrollments are scoped by `academicYearId` **and** status, so billing year X can't touch year Y's enrollments.
- The new listing endpoints use `requirePermission('fees.read', 'ALL')` — the scope guard added earlier this phase — so a parent's `fees.read: OWN` cannot enumerate the school's fee plans.

**Verified live — 18/18 passing** against the 720-student database:

- 120 Class-5 students billed **₹30,00,000** (₹25,000 each) in one call; dry-run count matched the real run exactly, and wrote nothing.
- **Idempotency:** immediate re-run → `0 generated, 120 already billed`.
- **Incremental billing:** adding a Term-2 structure (₹15,000) and re-running charged **₹18,00,000** — exactly the new structure, not the old one again.
- **Authorization:** parent gets 403 on both generate and the new listing endpoints.
- **Input handling:** missing `academicYearId` → 400; no matching structures → 404 `NO_FEE_STRUCTURES`.

> **Not committed — needs your review.** These three fee files also contain your in-flight work (invoice detail, invoice/receipt PDFs, refunds). As in Phase 3, I did not commit your work-in-progress under my commit message. My additions are in your working tree; commit them together with your own changes when you're ready.

**Still missing from a complete fee engine** (not built): installments/instalment plans, automatic late fines, concession & scholarship rules, sibling discounts, and Tally/GST export.

## 9. Wave-1 build: grading, report cards & a marks-entry bug · **built & tested**

**Second correction to Phase 1.** The benchmark listed "Gradebook / marks entry — **Missing (UI)**" as the cheapest Critical fix, quoting COMPLETION_REPORT §11.4. That is out of date: a working `MarksEntryModal` exists in `teacher/exams/page.tsx`, and I drove it end-to-end (teacher → 4 papers → 60-student grid → marks saved). Marks entry is **done**. What was genuinely missing was everything *downstream* of the raw score.

### QA-7 — Marks above the paper maximum were accepted · **High** · FIXED

While testing, I saved **77 marks on a paper whose maximum is 50** and the API returned `201`. `enterMarks` never validated against `examSubject.maxMarks`. Every percentage, letter grade, GPA and rank computed downstream would inherit the corruption — silently, since nothing else re-checks.

- **Fix:** the batch is rejected with `400 MARKS_OUT_OF_RANGE` (listing the offending entries) if any score is `< 0` or `> maxMarks`. Rejecting the batch rather than dropping bad rows means the teacher sees the mistake instead of losing an entry.

### Built

| Item | Detail |
|---|---|
| `utils/grading.js` | CBSE-style 10-point scale as **data, not conditionals** (A1…E with grade points + descriptors), `percentage()`, and `summarise()` for totals/GPA/pass-fail |
| Auto letter grades | `enterMarks` now derives `gradeLabel` from the score. It was previously accepted **from the client**, so the same score could carry different grades for different students |
| `GET /exams/report-card` | Per-subject marks, %, letter grade, grade points; summary with total, %, overall grade, GPA, pass/fail and failed-subject list. Optional `?exam=` filter |
| `GET /exams/report-card/pdf` | Printable A4 report card (pdfkit, no template assets — same approach as the existing ID-card/receipt renderers), including a grading-scale key |

Design decisions worth flagging:

- **The report card is built on `getPerformance()` rather than querying marks directly.** That function already encodes the full ownership model — a parent sees only their child, and a *subject* teacher sees only the subjects they teach in that section, not the whole record. Re-implementing that query would have been the single easiest place in this codebase to introduce a data leak.
- **Unmarked ≠ zero.** A subject with no mark is excluded from totals and GPA rather than counted as 0, so a partly-marked exam shows an honest interim result; the PDF says "Interim result — N of M subjects published."
- Only `PUBLISHED` marks appear — a report card must never show a draft the teacher is still editing.

### Verified live — 32/32

- **Scale unit tests:** band boundaries (91→A1, 90.5→A2 — no gap), pass mark (33→D), fail (32→E, 0 points), `null` percentage stays `null`.
- **Aggregation:** totals exclude the unmarked subject (75/100), GPA 7.5 from points 9 and 6, interim flag "2 of 3", failing-subject detection.
- **The bug:** `maxMarks + 27` → **400** (was 201); negative → 400; valid → 201.
- **Auto grades:** 100% → `A1`, 60% → `C1`, derived server-side.
- **Report card:** real student (Diya Sharma) — 77.82%, GPA 8.33, grade B1; exam filter works; unknown exam → 404.
- **PDF:** 200 `application/pdf`, valid `%PDF` header, 2,530 bytes.
- **Authorization:** parent gets their own child with no id passed; a parent requesting **Kabir Sharma** (verified to be a different family's child) gets **403** on both JSON and PDF; librarian (no `marks.read`) → 403.

**Not built:** rank/class position, term-over-term comparison, co-scholastic/attendance blocks on the report card, and school-configurable grading scales (the scale is a shared constant — it becomes a per-tenant setting the moment multi-school ships).

## 7. What remains in Phase 4

1. **Your issues sheet** → mapped closure log (blocked on the sheet).
2. **Wave-1 feature build**, in the Phase 1 priority order: fee structure engine → student/parent Fee Portal (your in-flight `student/payments` + `invoicePdf.js`/`receiptPdf.js` are the base), teacher marks-entry → letter grades → PDF report card, Notification Center, Attendance Calendar + leave (your in-flight leave module is the base), assignment enhancements.
3. **Frontend UI QA** per portal at 375px, plus the Phase 2 accessibility fixes.
