# Profile audit: Warden

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/warden`, demo login
`warden@schoolerp.com`. Considered: a residential (boarding) school warden or housemaster/housemistress, the night duty
warden, and the principal who reads the hostel's figures.

## 1. The role in an Indian school

**Answers to** the principal (in larger schools a chief warden / dean of residential life). Works with the school nurse,
the mess contractor or kitchen, security at the gate, class teachers and, constantly, parents.

| When | What |
|---|---|
| Morning | Wake-up and morning roll call, room inspection, breakfast, residents leave for school; sick residents to the health room. |
| Evening | Residents return; out-pass returns; games; supervised study (prep); dinner; night roll call (head count, room by room); lights out; night rounds. |
| Any time | Leave / out-pass requests (guardian confirmation, approval, gate exit and return), visitors on visiting days, illness and medication with the nurse, homesickness, conflicts and discipline, calls from and to parents. |
| Weekly | Mess menu with the kitchen committee; outing day; laundry; room inspection; report to the principal. |
| Termly / yearly | Room allocation and change requests; hostel fee and mess-bill queries with accounts; fire drills; hostel rules signed by parents; incident and discipline review. |

**Reports owed:** daily strength (present, on leave, sick), incident register, out-pass register, visitor register,
mess headcount, room allocation list.

**Pain points:** the night head count on paper, with no instant alarm if someone is missing; out-pass leave not
reflected in the count; the mess cooking for residents who are away; allergy lists kept in a notebook; incident notes and
the "I called the parent" record scattered across phones.

Sources: OpenEduCat hostel module (roll call, mess headcount and menus, leave, visitor log, night rounds, incident SLAs),
boarding-school practice (house systems), NCPCR safety manual and CBSE safety circulars for residential care.

## 2. Competitors

| Capability | OpenEduCat hostel | Fedena / Entab hostel | Boarding-school tools (e.g. Reach, Orah) | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Rooms, beds, allocation, CSV import | ✓ | ✓ | ✓ | ✓ | ✓ |
| Out-pass with guardian confirmation and gate scan | ✓ | partial | ✓ | ✓ | ✓ |
| Night / morning roll call | ✓ | partial | ✓ (roll calls) | — | ✓ pre-marks out-pass leave; missing → instant alert + critical task |
| Mess menu and headcount | ✓ | ✓ (mess billing) | — | — | ✓ weekly menu, tonight's headcount less residents away |
| Allergy list for the kitchen | ✓ (dietary) | — | ✓ | per-resident medical lookup | ✓ list for residents with allergies, every view audited |
| Incident / discipline log | ✓ (SLAs) | partial | ✓ | tickets only | ✓ categories, severity, HIGH → task, safeguarding referral flag |
| Parent-contact log | — | — | ✓ | — | ✓ per incident (who, how, what was said) |
| Visitors | ✓ | ✓ | ✓ | gate module (admin/compliance) | unchanged (see section 6) |
| Assistant | — | — | — | rooms, allocation, enquiries, out-pass decisions | + briefing, roll call (open, mark, submit), mess menu, incidents, parent contact |

## 3. Hands-on test (findings)

- Home (Hostel Overview) showed rooms and occupancy but nothing about tonight. **Fixed:** "Hostel tonight" card
  (residents, away, dinners to cook, last roll call, late out-passes, pending decisions, open incidents) linking to Hostel life.
- No roll call anywhere in the product: a resident missing at night could only be found by the paper register.
  **Built.**
- The mess was not modelled at all. **Built:** menu, headcount, allergy list.
- Incidents went into support tickets, which mix maintenance with welfare and have no parent-contact record. **Built:**
  incident log.
- Mobile: the roll call rows wrap with the status pill and buttons under the name at 390 px.

## 4. What was built

**Hostel life** page `/warden/hostel-life` (also for the principal), backend `modules/hostel/life.service.js`, routes
`/hostel/life/*`, models `HostelRollCall`, `MessMenu`, `HostelIncident`.

- Roll call: one per date, session (NIGHT / MORNING) and block; residents with an out-pass OUT (or APPROVED and in its
  window) are pre-marked ON_LEAVE with the pass number. Mark present/absent/sick bay, or "everyone else present"; submit.
  On submit anyone UNMARKED or ABSENT counts as not accounted for: every holder of `hostel.manage` is told (urgent,
  in-app; WhatsApp when connected) and a CRITICAL task opens; marking them LATE (arrived) closes it.
- Mess: menu per week (Monday start, four meals), headcount for dinner (residents less those away at 7 pm), the kitchen
  allergy list from the medical record (needs `medical.read`; each view is a PII-read audit entry).
- Incidents: residents, category (discipline, late return, damage, conflict, homesickness, safety, health referral),
  severity (HIGH opens a task), action, safeguarding-referral flag (details stay on the Safeguarding page), the
  parent-contact log, resolution.
- Briefing: counts with the records behind them.

API: `GET /hostel/life/briefing|residents|rollcalls|rollcalls/:id|mess/menu|mess/headcount|mess/diet|incidents|incidents/:id`,
`POST /hostel/life/rollcalls`, `POST /hostel/life/rollcalls/:id/mark|submit`, `PUT /hostel/life/mess/menu`,
`POST /hostel/life/incidents`, `POST /hostel/life/incidents/:id/contact|resolve`. Reads `hostel.read`, writes
`hostel.manage`, the diet list also `medical.read`.

Sample data: last night's roll call (submitted, one late arrival), this week's menu, an open incident with a call home,
a resolved homesickness case.

## 5. Assistant coverage

New tools (`p4Warden.js`, 11): `get_hostel_night_briefing`, `start_hostel_roll_call`, `get_hostel_roll_call`, `mark_hostel_roll_call`,
`submit_hostel_roll_call` (web-confirmed: alerts others), `get_mess_menu`, `update_mess_menu`, `log_hostel_incident`,
`list_hostel_incidents`, `log_parent_contact`, `resolve_hostel_incident`. Residents are named in words and matched only
against current residents. Warden catalogue: 70 → 83 tools.

Not in chat on purpose: the allergy list (medical data stays on the page), contacting parents (the warden calls; the
assistant records it), decisions on out-passes beyond the existing confirmed tool.

## 6. What remains, and why

- **Hostel visitors on visiting day**: the gate module handles visitors; the warden role lacks `visitors.manage`.
  Granting it is a permissions decision for the lead.
- **Mess billing / extra-meal charges** to the fee ledger: needs a finance decision.
- **Night rounds with check-in points** (QR at corridors): the ID-checkpoint feature exists but is off by default and
  needs readers.
- **Room inspection checklist** and room-change requests: small follow-ups on the existing rooms module.
