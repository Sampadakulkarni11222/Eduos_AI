# Profile audit: HR & Payroll

Demo login: `hr@schoolerp.com`. Audited 16–17 Oct 2026 (part 4). Companion audits: [finance.md](finance.md), [nurse.md](nurse.md).

## 1. The role in an Indian school

The school HR manager (in smaller schools, the HR and admin officer) reports to the principal and to the management or trust.

**Every day**
- Handles staff attendance and leave: CL, SL and EL, and maternity leave under the Maternity Benefit Act.
- Arranges cover with the academic coordinator.
- Answers staff questions.
- Keeps personnel files and documents up to date.

**Every month**
- Sends the payroll inputs (LOP, arrears, recoveries) to accounts.
- Deposits EPF (with the ECR) and ESI by the 15th, and professional tax by the state's due date.
- Records joiners and leavers.
- Runs probation reviews.

**Through the year**
- **Recruitment**: manpower plan, vacancy approval, sourcing, screening, demo lesson, panel interview, offer, background verification. The checks include police verification and the child-safety declaration that CBSE and POCSO practice expects for anyone working with children.
- **Onboarding and induction.**
- **Training**: CBSE requires 50 hours of CPD a year per teacher.
- **Appraisal**: goal setting, then mid-term and end-term reviews.
- **Increments.**
- **POSH committee.**
- **Statutory registers** kept ready for inspection: muster roll, wages, leave, PF/ESI and gratuity nominations.
- **Exits**: resignation, notice period, department clearances, exit interview, full-and-final, relieving and experience letters.

**Pain points**
- Recruitment runs on email and spreadsheets: who is at which stage, and where are the panel's scores?
- Background verification gets forgotten when a teacher joins in a hurry.
- The full-and-final is worked out by hand: gratuity under the Payment of Gratuity Act 1972, s.4 (15/26 × last basic + DA × completed years, payable after 5 years, capped at ₹20 lakh), leave encashment, notice recovery and department dues.
- Relieving letters wait on clearances that nobody tracks.

Sources: school HR job postings ([Qureos](https://app.qureos.com/jobs/school-hr-1764329981835), [Weekday, BBUL Jain Vidyalaya](https://jobs.weekday.works/human-resources-specialist-at-bbul-jain-vidyalaya-wkdyn2w6il), [TSUS Hyderabad](https://tsushyderabad.com/?p=22993554)). greytHR help pages on [full-and-final settlement](https://www.greythr.com/help-admin/payroll/settle-contract-employee-process/) and [Form 16](https://www.greythr.com/help-admin/payroll/generate-form-16-greythr/).

## 2. Competitors: who has what

| Capability | greytHR / Keka / Zoho People | Fedena HR | Entab | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Leave policies, balances, approval, LOP to payroll | yes | yes | yes | yes | same; now on the assistant too |
| Payroll, EPF ECR, ESI, PT, bank file | yes | yes | partial | yes | same |
| Background verification with non-waivable checks | add-on | no | no | yes | same; started from the candidate |
| **Recruitment pipeline** (vacancy, stages, scorecards, offer) | yes (Keka Hire, Zoho Recruit) | partial | partial | **no** | **yes** |
| Offer letter draft | yes | templates | templates | **no** | **yes** (draft only, nothing sent) |
| **Exit and full-and-final** (clearances, gratuity, encashment) | yes | partial | partial | **no** (only an empty FULL_AND_FINAL run kind) | **yes**: worksheet, then a FULL_AND_FINAL run that follows normal approval |
| Relieving and experience letters | yes | templates | templates | no | **yes** (drafts) |
| Appraisal (goals, reviews) | yes | partial | partial | no | no (see remaining) |
| Employee self-service mobile | yes | yes | yes | payslips, leave, profile | same |

## 3. Hands-on test findings

What was tested:
- API probes on the running demo as `hr@schoolerp.com`.
- A browser sweep was attempted, but the shared demo API was down during it. The new screens are covered instead by component tests (`frontend/tests/p4-finance-hr-nurse.test.tsx`).
- Code review of payroll, staff leave, verification and credentials.

The part-1 HR findings are fixed: inputs merge instead of wiping, ECR caps and `#~#` text, ESI rounded up, the professional-tax warning, rupee rounding, off-cycle runs, consent evidence, non-waivable checks, and staff leave with LOP.

| # | Finding | Severity | Status |
|---|---|---|---|
| H-1 | No recruitment anywhere: an `approval` category `RECRUITMENT` exists, but there are no vacancy or candidate records. | high | Built **Recruitment**. |
| H-2 | No exit process. FULL_AND_FINAL runs exist but take only hand-typed adjustments. Gratuity, encashment and notice recovery are worked out outside the system. | high | Built **Staff Exits** with the worksheet, and "put on a full-and-final run". |
| H-3 | A child-facing hire could be onboarded without the verification case ever being started. | high (child safety) | A candidate for a child-facing post cannot be marked JOINED until verification is CLEARED or CLEARED_WITH_CONDITIONS. Verification can be started from the candidate. |
| H-4 | In the demo every pay structure has `designation`, `department` and `workState` null, so PT warnings fire for everyone. | low (sample data) | Not changed: the seed is shared and other suites pin those warnings. Noted. |
| H-5 | The assistant had only leave-decision and cover tools for HR: no balances, LOP, verification list, recruitment or exits. | medium | 14 HR tools added, plus the 3 shared payroll tools (section 5). |

## 4. What was built

- **Backend** `backend/src/modules/p4ops/people.service.js`:
  - Recruitment, at `/api/v1/recruitment` (needs `org.manage` ALL):
    - vacancies: create, status;
    - candidates: add (duplicate email per vacancy refused), move (state machine APPLIED → SCREENED → DEMO_LESSON → INTERVIEW → OFFERED → ACCEPTED → JOINED, plus REJECTED with a reason and WITHDRAWN);
    - scorecards on a six-criterion rubric (subject knowledge, teaching method, communication, classroom management, child safeguarding, values), one per interviewer per stage;
    - offer drafted from the vacancy and terms, and needed before OFFERED;
    - verification started through the existing verification service;
    - a joining task created on acceptance.
  - Exits, at `/api/v1/exits`:
    - start (not your own; one open exit per person);
    - department clearances (CLEARED or DUES);
    - exit interview;
    - the settlement worksheet (needs `payroll.sensitive.read`);
    - put on payroll (needs `payroll.prepare`; refused while clearances are pending; creates or reuses a DRAFT FULL_AND_FINAL run for the month of the last working day, adds the lines as adjustments, and sets the exit date on the pay structure);
    - letters;
    - close or withdraw.
- **Settlement maths** (tested):
  - gratuity: 15/26 × (basic + DA) × completed years, where a final part-year over six months counts as a year; payable at 5 years of service, or on death or disablement; capped at ₹20 lakh;
  - EL encashment: balance × wage / 26 (or 30);
  - notice recovery: shortfall days × gross / 30;
  - clearance dues are deducted.
- **Models** `Vacancy`, `Candidate`, `ExitCase` in `backend/src/models/p4People.model.js`.
- **Screens** *Recruitment* (`/hr/recruitment`) and *Staff Exits* (`/hr/staff-exits`), also for the principal.
- **Sample data**:
  - 3 vacancies (one on hold) and 5 candidates across stages, with scorecards, an offer draft and one rejection with a reason;
  - one resignation with library dues, IT cleared, the exit interview and the worksheet.

**AI and automation**
- Offer, relieving and experience letters are drafted from the record for HR to edit and sign.
- The assistant can run the whole pipeline (open a vacancy, add a candidate, move, score, draft the offer) and the exit steps, each as a confirmed draft.
- It never approves payroll, waives a check or pays anyone.

## 5. Assistant coverage (HR)

New tools:

| Tool | Kind | Rule |
|---|---|---|
| `get_staff_leave_balances` | read | `staffleave.manage` |
| `get_staff_leave_lop` | read | `staffleave.manage` |
| `list_verification_cases` | read | `verification.read` |
| `list_recruitment_vacancies` | read | `org.manage` |
| `open_vacancy` | write | confirmed |
| `list_candidates` | read | `org.manage` |
| `add_candidate` | write | confirmed |
| `move_candidate` | write | confirmed; asks for a reason before rejecting |
| `add_candidate_scorecard` | write | confirmed |
| `draft_offer_letter` | write | confirmed; nothing sent |
| `list_staff_exits` | read | `org.manage` |
| `start_staff_exit` | write | HIGH, affects others; website only |
| `update_exit_clearance` | write | confirmed |
| `estimate_full_and_final` | write | `payroll.sensitive.read`; confirmed |

The shared payroll tools `get_payroll_run`, `update_payroll_inputs` and `calculate_payroll_run` (listed under Finance) are available to HR too.

HR's catalogue went from 56 tools to 89 (34 writes), including other engineers' additions. Still screen-only, on purpose:
- sending the settlement to payroll (it creates a payroll run);
- recording verification check outcomes;
- payroll submission.

## 6. What remains, and why

- **Appraisal cycle** (goal sheets, self, HOD and principal review, increment letter feeding a new pay-structure version). A large module that needs the school's rubric and its approval chain. Lesson observations and CPD hours from the teacher audit are the inputs to build on.
- **Employee master fields** (date of joining shown to HR, qualifications, documents with expiry) and a single "Hire" flow that creates the account, pay structure and verification. Creating accounts needs `users.manage`, which HR does not hold, and granting it is a product decision. The joining task created on acceptance is the interim.
- **Form 16 / 24Q and investment declarations.** The ERP deliberately does not compute income tax (`monthlyTdsPaise` comes from the tax adviser).
- **Statutory registers as printable forms** (muster roll, wages register in state formats). The formats vary by state.
