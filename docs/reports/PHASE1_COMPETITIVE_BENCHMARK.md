# Phase 1 — Competitive Benchmark: Owner, Admin, Principal, Teacher, Parent, Finance, Librarian, Hostel Warden

_Date: 2026-07-29 · Companion to the Student Portal Competitive Analysis (its findings are incorporated, not repeated) · No code was changed in this phase._

## 0. Method & honesty notes

- **EduOS current state** is taken from `README.md` §6, `AUDIT_REPORT.md`, `COMPLETION_REPORT.md` §11.1, and direct code inspection — not assumptions. Where the uncommitted working tree already contains in-flight work (student fee portal pages, attendance calendar components, a new leave module, invoice/receipt PDF generators — all present but unmerged), features are rated as **not shipped**.
- **Competitor capabilities** are desk research from training knowledge (cutoff Jan 2026), not fresh product trials. Ratings are directionally reliable for long-stable products (PowerSchool, Fedena, ERPNext, Teachmint); treat any single cell as spot-checkable, not gospel. Flagged where confidence is lower.
- `comparision_ERP.docx` was **not found in the repo or its parent folder** — this benchmark uses the competitor set and dimensions specified in the engagement brief. If the docx adds dimensions, supply it and I'll extend the matrix.
- Rating scale (same as the student analysis): **Strong / Moderate / Missing**, with gap severity **Critical / High / Medium / Low**.

Competitor shorthand: **PS**=PowerSchool, **IC**=Infinite Campus, **ERPN**=ERPNext Education, **oSIS**=openSIS, **Fed**=Fedena, **TM**=Teachmint, **C365**=Campus 365, **MCC**=MyClassCampus, **Entab**=Entab CampusCare, **GC**=Google Classroom, **Moodle/Canvas**=LMS group.

---

## 1. Teacher Portal

Current EduOS state: dashboard (single fetch), classes, one-tap attendance, timetable, assignments with submissions roster + grading, course material uploads, announcements, calendar, parent queries, medical records view. **No marks-entry UI** (backend `/exams` routes exist, UI is read-only — COMPLETION_REPORT §11.4), no lesson planning, no gradebook, no messaging.

| Dimension | EduOS | PS | TM | GC | Canvas | Fed/C365 | Gap severity |
|---|---|---|---|---|---|---|---|
| Attendance marking | **Strong** (one-tap, OWN-scoped) | Strong | Strong | — | — | Strong | — |
| Gradebook / marks entry | **Missing (UI)** | Strong | Strong | Moderate | Strong | Strong | **Critical** — backend exists; this is the cheapest Critical fix in the app |
| Lesson planning / syllabus tracker | **Missing** | Moderate | Strong | Moderate | Strong | Moderate | High |
| Assignment lifecycle | Strong (create→roster→grade) | Strong | Strong | Strong | Strong | Moderate | Low (rich text + multi-attachment still pending, per student analysis) |
| Question-paper / quiz generation (AI) | **Missing** | — | Strong (AI) | Moderate | Moderate | — | High — TM/MagicSchool/Quizizz AI all ship this; Phase 5 tutor core covers it |
| Parent messaging (2-way) | Moderate (ticket-style queries only) | Strong | Strong | Moderate | Moderate | Strong | High |
| Leave application / substitution | **Missing (in-flight)** | Moderate | Moderate | — | — | Strong | Medium |
| Mobile-first marking UX | Moderate (web only, no PWA) | Strong (app) | **Strong (app-first)** | Strong | Strong | Strong | High |

**Verdict**: strongest EduOS portal relative to Indian peers except for the gradebook hole and no mobile app. Teacher-facing AI (homework generation, worksheet/question generation) is where TM + MagicSchool set the bar and where Phase 5 leapfrogs.

## 2. Parent Portal

Current: dashboard with real attendance/fees/exams cards, performance + growth score, attendance, assignments (status), timetable, calendar, announcements, medical, library, transport, **Pay Now online payments (sandbox)**, documents, support tickets.

| Dimension | EduOS | PS | Entab | TM | SchoolDiary | C365 | Gap severity |
|---|---|---|---|---|---|---|---|
| Fee visibility + online pay | Strong (ownership-enforced) | Strong | Strong | Strong | Moderate | Strong | Low — needs real gateway (credentials-only) + downloadable receipts/invoice PDFs (in-flight) |
| Push notifications / inbox | **Missing** | Strong | Strong | Strong | **Strong (core product)** | Strong | **Critical** — same finding as student portal; parents are the #1 notification audience |
| 2-way teacher communication | Moderate (support tickets only) | Strong | Strong | Strong | Strong | Strong | **High** — every Indian competitor leads with this |
| Multi-child switching | **Weak/unclear** — OWN scope supports children, UI lacks a first-class child switcher | Strong | Strong | Strong | Strong | Strong | High |
| Report card / progress PDF | **Missing** | Strong | Strong | Strong | Moderate | Strong | High |
| Transport live tracking (GPS) | **Missing** (static route/stop only) | Moderate | Strong | Moderate | Strong | Strong | Medium (hardware dependency; partner, don't build) |
| Consent forms / PTM booking | **Missing** | Strong | Moderate | Moderate | Strong | Moderate | Medium — Phase 5 "schedule a PTM" flow covers the booking half |
| Growth score / risk view | **Strong — differentiator** (explainable heuristics) | Moderate | — | — | — | — | Protect it |
| Multi-language UI | **Missing** | Strong | Strong | **Strong** | Strong | Strong | **High** — parents are the lowest-English-comfort audience in the Indian market; every Indian competitor ships vernacular UI |

## 3. Admin Portal

Current: dashboard, tickets, user management, classes, admission CRM, attendance, calendar, timetable builder, fees + receipts, announcements, library, transport, documents (real uploads), WhatsApp simulator, audit logs, live RBAC editor, tenant settings.

| Dimension | EduOS | Fed | ERPN | C365 | MCC | Entab | Gap severity |
|---|---|---|---|---|---|---|---|
| Student information mgmt | Moderate (create/enrol; thin profile — no photos, docs-per-student, custom fields) | Strong | Strong | Strong | Strong | Strong | High |
| Admissions | Moderate (internal CRM pipeline; **no public application form/portal**) | Strong | Strong | Strong | Strong | Strong | High — competitors take applications + fees online end-to-end |
| Timetable builder | Moderate (manual slots; no conflict detection/auto-generation) | Moderate | Moderate | Strong | Moderate | Moderate | Medium |
| Certificates (TC, bonafide, ID cards) | **Missing** | **Strong** | Strong | Strong | Strong | Strong | **High** — ubiquitous in Indian ERPs, mandatory paperwork for schools |
| HR / staff payroll | **Missing** | Strong | **Strong** | Strong | Strong | Strong | Medium-High (3+ competitors; big build — decide buy/partner vs build) |
| Bulk operations (CSV import/export, promote class) | **Missing** | Strong | Strong | Strong | Strong | Strong | **High** — onboarding a real school without bulk import is a non-starter |
| Exams: scheduling, hall tickets, report card templates | **Missing** | Strong | Strong | Strong | Strong | Strong | **Critical** (pairs with the teacher gradebook gap — together they are "academics", the #1 module schools evaluate) |
| RBAC editor (live, DB-backed) | **Strong — differentiator** | Moderate | Moderate | Moderate | Moderate | Weak | Protect; no Indian peer has per-permission ALL/OWN scoping UI |
| Audit logs | Strong (exists; coverage gaps → Phase 3) | Moderate | Strong | Moderate | Weak | Weak | Protect/extend |
| Multi-campus | **Missing** (single tenant) | Strong | Strong | Strong | Strong | Strong | Medium now, Critical if selling to groups (LEAD, chains) |

## 4. Principal Portal

Current: school intelligence dashboard, performance & risk scan, teacher workload, attendance trends, fee health, staff directory, announcements, escalated tickets, audit logs.

- vs **PS/IC**: their strength is configurable analytics + state compliance reporting; EduOS's curated "intelligence" pages are **more opinionated and more usable** than a generic BI screen — genuine edge for the Indian principal persona. **Missing**: any export (PDF/Excel board pack), period comparisons (this term vs last), and drill-through to individual student/teacher from a trend line. Severity: Medium.
- vs Indian peers: most give principals the admin portal with extra widgets; a dedicated decision-support portal is **rare — differentiator**. The risk scan (explainable, data-grounded) has no Indian-peer equivalent; Khanmigo/AI-first tools don't touch operations data.
- Biggest miss: **no natural-language query surface** ("who's absent today", "which class's fees are most overdue") — exactly Phase 5.3's principal capability, and no competitor in any group ships it today. This is the single most defensible Phase 5 payoff.

## 5. Owner Portal

Current: dashboard, admissions CRM, audit logs, access & permissions, tenant settings.

- Competitors don't have an "owner" persona as such; the equivalents are group-management consoles (C365 group plan, LEAD's network dashboards, Blackbaud's advancement suite). Against those: **Missing** multi-school consolidation, financial P&L view, staff cost overview, term-over-term enrolment trends. Severity: Medium today (single-school product), **Critical the day you pitch a group/chain**.
- What exists (RBAC editor + tenant settings + full audit trail at owner level) is coherent governance tooling that Indian single-school peers lack — keep it.
- Recommendation: don't build multi-campus speculatively; make tenant boundaries explicit in Phase 3 (tenant isolation review) so multi-campus is an extension, not a rewrite.

## 6. Finance Portal

Current: dashboard, payments & fees (invoice create, record payment, receipts list), reports (thin).

| Dimension | EduOS | ERPN | Fed | C365 | Entab | Gap severity |
|---|---|---|---|---|---|---|
| Fee structure engine (heads, class-wise plans, installments, late fines, concessions/scholarships, sibling discounts) | **Missing** — invoices are hand-created one at a time | **Strong** | Strong | Strong | Strong | **Critical** — this is the module bursars evaluate first; hand-created invoices don't survive a 720-student school (the seed data itself is 720 students) |
| Bulk invoice generation (per class/term) | **Missing** | Strong | Strong | Strong | Strong | **Critical** (same root cause as above) |
| Receipts/invoice PDFs | **Missing (in-flight — `utils/receiptPdf.js`, `invoicePdf.js` exist uncommitted)** | Strong | Strong | Strong | Strong | High |
| Payment gateway | Sandbox abstraction (real ledger) | Strong | Strong | Strong | Strong | Low — credentials-only by design |
| Reconciliation / defaulter tracking / dunning | Weak (fee health stats only) | Strong | Moderate | Strong | Strong | High — auto-reminders to defaulters is the #1 WhatsApp use-case competitors sell; Phase 5 does it agentically |
| Accounting export (Tally/GST) | **Missing** | **Strong (full accounting)** | Moderate | Moderate | Moderate | Medium — export CSV/Tally XML; do not build a ledger |
| Payroll | **Missing** | Strong | Strong | Strong | Strong | Medium (see Admin) |

**Verdict**: weakest portal relative to market, and the student-analysis security note applies here too — the fee data model must be extended (fee heads, plans, concessions) **before** the Phase 4 student fee portal is built on top of it, or it will be rebuilt twice. This is my one recommended change to the proposed sequencing.

## 7. Librarian Portal

Current: dashboard, catalog & lending (issue/return + fines), announcements, tickets.

- vs **Koha-class / Fed / oSIS**: **Missing** ISBN lookup/bulk import, barcode workflows, reservations/holds, member cards, overdue notices (auto), multiple copies/accession numbers. Present: clean issue/return with fines — covers a small school library honestly.
- Severity: Medium overall. Reservations + overdue auto-notification (rides the Phase 4 Notification Center) are the two worth building; barcode/ISBN import is a fast follow; full ILS parity is not worth chasing.
- The student-analysis differentiator applies: **AI library search/reservation via the assistant** ("do we have anything on the French Revolution for class 9?") — no competitor ties library search into a school assistant. Cheap, visible, defensible.

## 8. Hostel Warden Portal

Current: live occupancy dashboard, room CRUD/allocate/vacate (real API since the stabilization pass), hostel students, medical lookup, announcements, tickets.

- Only **Fed/C365/MCC/eSchool** (and boarding-school-focused Blackbaud/Veracross) have hostel modules at all — EduOS being here is already above median.
- **Missing** vs those: gate pass / leave & outing workflow with parent consent (**High** — this is child-safety, and the uncommitted leave module is the natural base), visitor log (Medium), mess management (Low — skip), hostel fee linkage to Finance (Medium), night attendance/roll-call (High for boarding schools — pairs with the attendance calendar work).
- Differentiator available: warden queries via assistant ("who hasn't returned from weekend leave?") — no competitor has it.

---

## 9. Cross-portal gap analysis — what 3+ competitors have that EduOS lacks

Ordered by how many benchmarked competitors ship it × how often it's a deal-breaker in evaluations:

1. **Exams/report-card engine** (scheduling → marks entry → grade computation → PDF report card → hall tickets): virtually all SIS competitors. *Deal-breaker tier.*
2. **Notification center + push** (in-app inbox now; FCM/PWA push next): all competitors in some form. *Deal-breaker tier; already Critical in student analysis — it is cross-portal, build it once.*
3. **Fee structure engine + bulk invoicing + defaulter workflows**: all ERP competitors. *Deal-breaker tier for the bursar.*
4. **Native/PWA mobile experience**: all Indian competitors are app-first. PWA (installable, push, offline timetable) is the pragmatic answer; a store-listed app can wait.
5. **Multi-language UI** (Hindi + 2–3 regional first): all Indian competitors.
6. **Bulk import/export + class promotion tooling**: all SIS competitors.
7. **Certificates/ID-card generation**: all Indian competitors.
8. **2-way parent–teacher messaging**: all communication-led competitors.
9. **Public online admission form** feeding the existing CRM: most competitors.
10. **HR/payroll, transport GPS, full accounting**: common but heavy — partner/integrate/export rather than build (judgment call, flagged).

## 10. Differentiators to build (defensible, specific)

1. **RBAC-scoped agentic assistant across web + WhatsApp** (Phase 5 as specified): every action authorized server-side at execution time, confirm-before-commit, audit-logged. Nobody in any of the three competitor groups has an assistant that *does ERP actions* — Khanmigo/MagicSchool are content-side; Indian ERPs' WhatsApp is one-way notification broadcast. Copy difficulty: **high** (requires the RBAC substrate EduOS already has; bolting it onto a legacy ERP is a rewrite).
2. **Explainable growth/risk scoring wired to interventions** (risk scan → suggested action → tracked outcome). PS has ML early-warning in premium tiers; no Indian peer does. Copy difficulty: medium-high.
3. **Photo-of-register OCR attendance** (Phase 5 teacher flow): uniquely suited to the Indian paper-register reality; no benchmarked competitor ships it. Copy difficulty: medium, but distribution + RBAC integration make it sticky.
4. **Principal natural-language operations queries** with AI summaries over live data. Copy difficulty: high for incumbents (their data models are siloed).
5. **Live per-permission RBAC editor with ALL/OWN scoping** — already built; market it as a security/compliance feature (pairs with the audit trail). Copy difficulty: high for legacy schemas.
6. **AI tutor scoped to the student's actual curriculum + their actual performance data** (Phase 5.3): Khanmigo-class tutoring, but grounded in the ERP's syllabus/marks — the combination is the moat, not the chatbot.

## 11. Master priority list (impact × copy-difficulty, merged with the student-portal backlog)

The student analysis's phasing is kept, with **one reorder** (flagged in §6): the fee data-model foundation moves ahead of the student fee portal UI so it isn't built twice.

**Wave 1 — parity blockers (build first, in Phase 4):**
1. Fee structure engine + bulk invoicing (Finance) → then Student/Parent Fee Portal (student-analysis Critical) + receipt/invoice PDFs (in-flight code as base)
2. Teacher marks-entry UI → letter grades/GPA (student-analysis High) → PDF report card (backend `/exams` already exists; highest value per line of code in the app)
3. Notification Center (cross-portal inbox + bell; student-analysis Critical) — design once for all 9 portals
4. Attendance Calendar + leave request (student-analysis Critical; uncommitted leave module + attendance components are the base)
5. Assignment enhancements + sidebar badges + timetable polish (student-analysis quick wins)

**Wave 2 — parity, high:**
6. Student Profile + digital ID; Admin bulk import/export + class promotion; certificates/TC/ID generation; 2-way parent messaging; multi-child switcher; Student Helpdesk; Unified Calendar; mobile card layouts (student-analysis High list)

**Wave 3 — moat (Phase 5, unchanged scope):**
7. Agentic core + WhatsApp + web assistant + tutor mode + OCR attendance + principal NL queries (§10.1–10.4, 10.6)

**Wave 4 — market expansion:**
8. PWA + push; multi-language UI; public admission form; library reservations/overdues; hostel gate-pass; PTM booking; analytics exports; Tally/GST export
9. Partner/defer: payroll, GPS transport, full accounting, mess management

**Deliberately not building** (flagged judgment calls): full LMS parity with Moodle/Canvas (integrate via assignment/material flows instead), state-compliance reporting (US-market feature; irrelevant until market choice says otherwise), biometric hardware integrations (partner-led).
