# Profile audit: Marketing & Admissions

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/marketing`, demo login
`marketing@schoolerp.com`. Considered: the admissions/marketing head, admission counsellors at the front desk, and the
principal who reads the funnel.

## 1. The role in an Indian school

**Answers to** the principal and the management/trust. Works with the front office, accounts (fees, concessions),
teachers (entrance tests, interactions), transport, and outside agencies (ads, events).

| When | What |
|---|---|
| Daily | New enquiries (walk-ins, calls, website, WhatsApp, social lead forms, referrals); first call within hours; follow-ups; campus tours and counselling sessions; application forms and documents; updating the CRM. |
| Weekly | Funnel review (enquiries → visits → applications → admissions) per counsellor and per source; campaign spend vs enquiries; open-house planning. |
| Season (Oct–Mar for April intake) | Admission notice; open houses, school fairs, society stalls, pamphlets, newspaper, social ads; entrance tests/interactions; offers and seat allotment against capacity; waitlists; fee payment deadlines. RTE 25% lottery (state process) for entry classes in private unaided schools. |
| Year | Brand: website, social media, alumni stories, results showcase; referral programme; reports to management on cost per admission. |

**Reports owed:** daily enquiry count, funnel and conversion by source and counsellor, campaign cost per enquiry and per
admission, seat status by grade.

**Pain points:** enquiries that never get a first call; follow-ups that live in a counsellor's phone; no idea which
enquiries are worth calling first; families who asked not to be called being called again; management asking "which
campaign worked?".

Sources: Meritto (NoPaperForms) and LeadSquared education CRM pages, Fuzen and TeleCRM school-CRM workflow articles,
counsellor job descriptions (Weekday), RTE Act s.12(1)(c).

## 2. Competitors

| Capability | Meritto / NoPaperForms | LeadSquared | Edunext / Entab admission CRM | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Enquiry capture (web form, lead webhooks, walk-in, CSV) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pipeline board, stages, assignee | ✓ | ✓ | ✓ | ✓ | ✓ |
| Campaigns, offline codes, QR, attribution, ad connectors | ✓ | ✓ | partial | ✓ | ✓ |
| Counselling appointments, seat capacity, offers, waitlist | ✓ | partial | ✓ | ✓ | ✓ |
| Follow-up queue (overdue, due today, SLA on first response) | ✓ | ✓ | partial | — (nextActionAt stored, never surfaced) | ✓ four buckets, first-response window 24 h |
| One-step follow-up logging (call + outcome + next action + stage) | ✓ | ✓ | partial | partial (notes, stage separately) | ✓ |
| Lead scoring | ✓ (rules) | ✓ (rules/AI) | — | — | ✓ explained score: every point has its reason |
| Counsellor performance | ✓ | ✓ | partial | funnel only | ✓ open, overdue, conversion, median first response |
| Contact-consent enforcement | partial | partial | — | consent stored | ✓ do-not-contact flagged; call/WhatsApp/email refused |
| Assistant | — | — | — | enquiries, funnel, social, ads | + queue, score, log follow-up, counsellor stats, appointments, campaigns, capacity |

## 3. Hands-on test (findings)

- The admissions CRM showed every enquiry on a board but not "who do I call now"; `nextActionAt` was saved and never
  shown as a list. **Built:** Follow-ups page.
- New enquiries with no response for days were invisible. **Built:** "Never contacted" bucket (24 h window).
- Logging a call meant a note, then a separate stage change, then a separate next-action edit. **Built:** one step.
- A family that withdrew contact consent could still be logged as called. **Fixed** in the follow-up path (refused).
- The assistant could create and update enquiries but not see the day's follow-ups or book a counselling slot. **Added.**

## 4. What was built

**Follow-ups** page `/marketing/followups` (also admin), backend `modules/marketing/followups.service.js`, routes
`/admissions/followups/*`; no new model (uses `Lead`, `LeadInteraction`, `CounsellingAppointment`, capacity).

- Queue: open enquiries in four buckets (overdue, due today, never contacted after 24 h, no next step), each sorted by
  the warmth score; "only my enquiries" filter.
- Score (0–100, HOT ≥ 65, WARM ≥ 40): stage, visits done, missed appointments, days since last contact, how the
  enquiry's source converted over the last year (when there are ≥ 5 enquiries from it), consent recorded/withdrawn, no
  seats left in the grade. Each component is listed as a reason; the score never moves an enquiry.
- Log follow-up: channel, what happened, next action, optional stage (through the admissions service, so ENROLLED still
  creates the student; LOST needs a reason); first response stamped; NEW moves to CONTACTED.
- Counsellors: per person over 90 days.

API: `GET /admissions/followups` (`admissions.read`), `GET /admissions/followups/counsellors`,
`GET /admissions/followups/:leadId/score`, `POST /admissions/followups/:leadId` (`admissions.manage`).

Sample data: next-action dates on open enquiries (overdue, today, later) and logged calls.

## 5. Assistant coverage

New tools (`p4Marketing.js`, 9): `get_followup_queue`, `get_enquiry_score`, `log_admission_followup`,
`get_counsellor_stats`, `list_counselling_appointments`, `create_counselling_appointment`, `list_marketing_campaigns`,
`create_marketing_campaign`, `get_admission_capacity`. Marketing catalogue: 60 → 71 tools.

Not in chat on purpose: offering a seat and approving a campaign or a showcase entry (second-person rules on screen),
recording spend (money).

## 6. What remains, and why

- **Automated drip messages** (WhatsApp templates after a visit, reminders before a tour): needs approved WhatsApp
  templates per school and consent per channel; the outbox exists.
- **Entrance test scheduling and results** as a module: today an appointment kind; marks entry is a follow-up.
- **RTE 25% lottery**: run by the state portal; EduOS can import the allotted list later.
- **Telephony (click-to-call, call recording)**: provider integration decision.
