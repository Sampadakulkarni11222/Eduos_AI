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

## 5. Other issues found (not yet fixed — need your call)

| # | Issue | Severity | Note |
|---|---|---|---|
| QA-3 | `npm run migrate` **crashes** after `npm run seed:school` — `E11000 duplicate key … academicyears index: name_1 dup key: { name: "2026-27" }` | Medium | Documented setup sequence in README is broken for a fresh full-data environment. Fix = make the year/term upsert idempotent. |
| QA-4 | `/observability/metrics` and `/ready` are **unauthenticated** | Medium | Confirm what `metrics` exposes before public deployment. |
| QA-5 | `/academics/*` reads (years, terms, grades, sections, subjects, offerings) are authenticated but ungated | Low | Any signed-in user can enumerate school structure. Low sensitivity, but it is roster metadata. |
| QA-6 | 4 of 8 dashboard endpoints (`owner`, `finance`, `warden`, `librarian`) are **not called by any frontend page** | Low | Dead surface — either wire the portals to them or retire them. Owner/Finance/Warden/Librarian portal homes currently assemble data another way. |

---

## 6. Files changed this phase

`backend/src/middleware/permission.js` (added `minScope` + `requireRole`), `backend/src/modules/dashboard/dashboard.routes.js`, `backend/src/modules/audit/audit.routes.js`.

No service/business logic was touched — all changes are route-level guards, so no previously-verified flow was refactored.

## 7. What remains in Phase 4

1. **Your issues sheet** → mapped closure log (blocked on the sheet).
2. **Wave-1 feature build**, in the Phase 1 priority order: fee structure engine → student/parent Fee Portal (your in-flight `student/payments` + `invoicePdf.js`/`receiptPdf.js` are the base), teacher marks-entry → letter grades → PDF report card, Notification Center, Attendance Calendar + leave (your in-flight leave module is the base), assignment enhancements.
3. **Frontend UI QA** per portal at 375px, plus the Phase 2 accessibility fixes.
