# Profile audit: Finance (bursar / school accountant)

Demo login: `finance@schoolerp.com`. Audited 16–17 Oct 2026 (part 4). Companion audits: [hr.md](hr.md), [nurse.md](nurse.md).

## 1. The role in an Indian school

The school accountant (often titled bursar or accounts officer) reports to the principal and, for money matters, to the trust or society's treasurer and the statutory auditor. In a CBSE, ICSE or state-board private school the work is the same in outline.

**Every day**
- Collects fees at the counter (cash, UPI with its 12-digit UTR, cheque, DD, bank transfer) and reconciles them with the online gateway. Issues serially numbered receipts for each financial year.
- Closes the cash at the end of the day: counts notes and coins, matches the count to the cash book, deposits the cash and keeps the deposit slip.
- Answers parents' questions about dues, concessions and receipts.

**Every week**
- Follows up defaulters by phone or WhatsApp. Families are grouped by how long they have owed: 0–30, 31–60, 61–90 and 90+ days.
- Reconciles the bank account and passes the vendor bills that are due.

**Every month**
- Posts vouchers to Tally (receipts, sales, credit notes, payments).
- Prepares payroll inputs with HR (LOP, arrears and recoveries) and pays salaries through the bank file.
- Deposits TDS by the 7th, and EPF and ESI by the 15th.
- Files GST returns when the school charges GST on non-tuition items (transport by a third party, uniforms, books, events).
- Prepares the MIS for management: billed, collected, outstanding and spend against budget.

**Every quarter and every year**
- Files the TDS returns (24Q for salaries, 26Q for vendors) and issues Form 16 and 16A.
- Supports the statutory audit (the trust's audit under the state's public trusts act, plus a 12A/80G audit where those registrations apply).
- Draws up the annual budget and the fee proposal. In regulated states (for example Delhi, Maharashtra, Gujarat and Tamil Nadu) the fee proposal goes to the fee regulatory committee.
- Supplies the fee details asked for in CBSE affiliation and the school's own disclosures.

**Pain points**
- A long counter queue at the start of each term.
- No single figure for "today's collection by mode".
- Receipt numbers that are not gap-free.
- The cash count is kept on paper, and nobody checks it a second time.
- The defaulter list is chased by hand.
- Tally re-keying.
- Audit queries such as "why does this UTR appear twice?"
- Cash of ₹2 lakh or more from one family in a day breaches s.269ST of the Income-tax Act, and the school pays a penalty equal to the amount.

Sources: school accountant job postings ([Qureos](https://app.qureos.com/jobs/accountant-1757574948857), [GoHire, Shri Educare](https://jobs.gohire.io/shri-educare-limited-o9lf3xun/accounts-executive-mrg-school-67854/)), which list fee receipts, collection reports, reconciliations, defaulter follow-up, Tally, GST, TDS, PF and ESI. Entab's fee module pages ([1](https://www.entab.in/10-key-functions-of-entab-fee-collection-module.html), [2](https://www.entab.in/entab-blog-fee-bill.html)).

## 2. Competitors: who has what

| Capability | Entab CampusCare | Fedena | Teachmint / Edunext | Tally / Zoho Books | EduOS before | EduOS now |
|---|---|---|---|---|---|---|
| Counter receipts with UPI UTR, cheque, DD | yes | yes | yes | n/a | yes (UPI with UTR, s.269ST warning) | same |
| Gap-free receipt series per financial year | yes | yes | yes | yes | yes (RCPT/2026-27/…) | same |
| Concessions with approval | yes | yes | partial | n/a | yes | same |
| Collection report by day, mode, cashier and head | yes | yes | yes | yes | **no** (client-side class and status totals only) | **yes**, computed on the server, with CSV day book |
| Defaulter ageing buckets | yes | partial | yes | yes (receivables ageing) | **no** | **yes**, with CSV |
| Automated fee reminders (WhatsApp/SMS) | yes | yes | yes, with a payment link | n/a | template existed but was never used | **yes**: a person sends them after seeing who receives them; once a week per family |
| Day-end cash close with denominations | partial | no | no | cash book | **no** | **yes**, with a second-person check |
| Audit / anomaly flags | no | no | no | partial | **no** | **yes**: duplicate UTR, s.269ST, out-of-hours, back-dated, large round cash, receipt after close |
| Tally XML export and GST summary | yes | yes | partial | native | yes | same |
| Budget vs actual | partial | no | no | yes | procurement only (bills not posted) | same (see remaining) |
| Payroll prepare, bank file, ECR | partial | yes | no | Zoho Payroll | yes | same; now reachable by the assistant too |

## 3. Hands-on test findings

What was tested:
- API probes on the running demo as `finance@schoolerp.com` (scratchpad `p4-fhn/probe.mjs`).
- Sidebar sweep at desktop and phone width (scratchpad `p4-fhn/sweep.mjs`; screenshots in `p4-fhn/ui/`). The sweep covered Finance only: the shared demo API stopped while the HR and Nurse runs were starting, so those two were checked through API probes, code review and component tests.
- Code review of the fee, payroll, procurement and bills modules.

The part-1 findings are fixed in the current code: refund ledger corruption, the UPI mode, the s.269ST guard, the receipt series, ECR caps, off-cycle runs, cancelled invoices in the summary, and the Due On date format.

Found in this audit:

| # | Finding | Severity | Status |
|---|---|---|---|
| F-1 | **Finance → Reports** downloads every invoice (`GET /fees/invoices`: 3,610 rows, 2.3 MB; it ignores `limit`) and builds class and status totals in the browser. It has no date range, day book, mode-wise, cashier-wise or head-wise view, no ageing and no export. | high (role's daily work, performance) | Built **Finance Reports** (server-side). The old page is left as it was. |
| F-2 | No end-of-day cash count. Nothing ties the drawer to the system, and nobody checks it. | high | Built **Cash close**: denominations, float, variance needing a note, deposit slip, a check by a different person. |
| F-3 | The `FEE_REMINDER` template existed but nothing used it. Defaulters were chased by hand. | medium | Built reminders: preview, then send, idempotent per family per week. Families on a fee plan are excluded by default. |
| F-4 | No audit flags. A repeated UTR or a back-dated cash entry was invisible. | medium | Built **Audit flags**: six rules, each with its evidence rows. |
| F-5 | Budget "actual" is 0 for every line in the demo. Only procurement payments post to budgets; paid utility bills and payroll do not. | medium | Not changed (see remaining). |
| F-6 | The assistant could read fees but had no collection, ageing, cash or payroll tools for Finance. | medium | 9 tools added (section 5). |
| F-7 | Finance *Today* (phone width): the greeting says "7 decisions are waiting on you" while the Finance card says "8 money decisions waiting". There is also a LEARNING card ("0 live now") that has nothing to do with the role. | low | Not changed: the role dashboards belong to another engineer's scope. Reported to the lead. |

## 4. What was built

- **Backend** `backend/src/modules/p4ops/collections.service.js`, routes at `/api/v1/finance-reports`:
  - `GET /collections?from&to`: totals, by mode, day, cashier, head (each receipt split pro rata over its invoice lines, so the heads add up to the receipt exactly) and class; refunds paid; amount awaiting approval.
  - `GET /day-book.csv`: the receipt register. Formula-safe cells and a UTF-8 BOM, so Excel shows ₹ correctly. Audited.
  - `GET /ageing`, `GET /ageing.csv`: buckets per student, oldest due date, last paid on, on a fee plan or not.
  - `POST /reminders/preview`, `POST /reminders/send` (needs `fees.manage`).
  - `GET /anomalies`.
  - `GET /cash-close`, `GET /cash-close/expected?day`, `POST /cash-close` (needs `fees.pay`), `POST /cash-close/:id/check` (needs `fees.payments.approve`, and must be a different person).
- **Model** `CashClose` in `backend/src/models/p4People.model.js`.
- **Screen** *Finance Reports* (`/finance/finance-reports`, also for admin and principal), with tabs Collections, Overdue & reminders, Audit flags and Cash close (`frontend/src/components/ops/p4-ops-views.tsx`).
- **Sample data** (`seed_p4_finance_hr_nurse.js`): two closed cash days, one checked, one with an explained ₹100 shortfall.

**AI and automation**
- In plain language ("collection today by mode", "who is 90+ days overdue in Class 8 B") the assistant answers from the same service as the screen.
- Anomaly flags are explained with their evidence.
- Reminders and the cash close are drafted and confirmed. Nothing approves, refunds or records money.

## 5. Assistant coverage (Finance)

New tools in `backend/src/modules/ai/mcp/tools/p4FinanceHrNurse.js`:

| Tool | Kind | Rule |
|---|---|---|
| `get_fee_collections` | read | `fees.read` ALL |
| `get_fee_ageing` | read | `fees.read` ALL |
| `get_fee_receipt_flags` | read | `fees.read` ALL |
| `get_cash_position` | read | `fees.read` ALL |
| `close_cash_day` | write | HIGH; confirmed on the website only; asks why if the count is off |
| `send_fee_reminders` | write | HIGH, affects others; the draft names who receives it; website only |
| `get_payroll_run` | read | lines only with `payroll.sensitive.read` |
| `update_payroll_inputs` | write | LOP and arrears for one employee; HIGH; website only; own line refused by the service |
| `calculate_payroll_run` | write | Confirmed. Submitting for approval stays on the screen. |

Finance's assistant catalogue went from 90 tools to 113 (42 writes). The total includes tools other part-4 engineers added. Still screen-only, on purpose:
- recording, approving and refunding a payment (`record_payment` and `refund_*` are reserved deciding names);
- submitting payroll;
- the bank file;
- statutory submissions.

## 6. What remains, and why

- **Budget actuals from bills and payroll.** This needs a mapping from bill category and payroll to budget lines, which is the school's decision. Today budgets track procurement only.
- **Bank-statement import and auto-matching** (CSV/MT940 against UTRs). Statement formats vary by bank, and it needs a sample from the school's bank.
- **TDS on vendor payments** (194C/194J), 26Q working, Form 16A. TDS rates and thresholds change every year and need the adviser's verified rule table, the same pattern as payroll's statutory rules.
- **Payment links in reminders.** The gateway order is created on the parent's own Payments page, and a link with an embedded order would expire.
- **Locking a closed day.** Payments keyed after a close are flagged (`AFTER_CLOSE`), not blocked, so that recording behaviour that already works was left unchanged.
