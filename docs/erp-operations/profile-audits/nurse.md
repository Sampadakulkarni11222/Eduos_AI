# Profile audit: School Nurse

Demo login: `nurse@schoolerp.com`. Audited 16–17 Oct 2026 (part 4). Companion audits: [finance.md](finance.md), [hr.md](hr.md).

## 1. The role in an Indian school

A qualified staff nurse is on duty in school hours. They report to the principal and work with the school doctor (visiting or on panel), the counsellor and class teachers.

**Every day**
- Health-room visits: first aid, temperature and other vitals, rest, sending a child home or referring them.
- Telling parents.
- Giving medicines only against a prescription and the parent's written consent. A controlled medicine needs a second person.
- Keeping the health-room register.
- Checking first-aid kits and stock (expiry, EpiPens, the asthma inhaler policy).

**Every week**
- Restocking.
- Following up children who keep coming back.
- Watching for clusters: several children in one class with fever, vomiting, conjunctivitis or a rash. These are possible outbreaks to tell the principal about, and the local health authority for a notifiable disease.

**Every term or year**
- The annual health check and health card. CBSE schools collect a health card certified by a registered practitioner, and the school's own screening (height, weight, BMI, vision, dental, hearing) goes on it.
- Immunisation records and camps (Td, HPV where offered, catch-up doses).
- The Rashtriya Bal Swasthya Karyakram (RBSK) screening where it applies.
- First-aid training for staff.
- Allergy and care-plan lists for teachers and the canteen.
- Disaster and medical drill.

**Health-data rules**
- Health information is sensitive personal data under the DPDP Act 2023.
- It is shared on a need-to-know basis: a parent sees their own child's record; a teacher gets only the care note the parent agreed to share; management gets counts.

**Pain points**
- Paper registers.
- No view across visits, so a cluster or a frequent visitor is noticed late.
- Immunisation due dates sit in individual cards.
- Screening coverage is unknown until the annual check.

Sources: an Indian CBSE school's health policy ([NPS HRD](https://npshrd.com/school-health-medicalpolicy.html)); a school nurse job description ([Gibraltar Department of Education](https://www.gibraltar.gov.gi/uploads/VACANCIES/Schol%20Counsellor/School%20Nurse%20-%20Department%20of%20Education.pdf)); medication administration regulation ([Massachusetts 105 CMR 210](https://www.mass.gov/doc/105-cmr-210-the-administration-of-medications-in-public-and-non-public-schools/download)); Magnus Health ([Veracross](https://www.veracross.com/?p=982), [FitGap review](https://us.fitgap.com/products/magnus-health)).

## 2. Competitors: who has what

| Capability | Magnus Health (Veracross) | SchoolCare / Point and Click | EduOS before (part 3) | EduOS now |
|---|---|---|---|---|
| Visit log with vitals and outcome; parent told | yes | yes | yes (encrypted, audited) | same |
| Medication plans, parent consent, dose log, controlled countersign | yes | yes | yes | same |
| Stock and expiry | partial | yes | yes (expiry becomes a task) | same; now on the assistant too |
| Immunisations and compliance list | yes (against state rules) | yes | per-child entries only | **immunisations due / overdue list** |
| Screenings and the health card | yes | yes | yes | **coverage by class, follow-up list** (BMI, vision > 6/9, dental, hearing) |
| Illness surveillance (clusters) | no | partial (reports) | **no** | **yes**: same complaint category, same class, within N days |
| Frequent-visitor alert | no | partial | **no** | **yes**: 4+ visits in 30 days |
| Register export | yes | yes | no | **yes** (CSV, audited) |
| Care notes shared with teachers by consent | yes | yes | yes | same |

## 3. Hands-on test findings

What was tested:
- API probes as `nurse@schoolerp.com`: today, summary, visits, stock and settings.
- A browser sweep was attempted, but the shared demo API was down during it. The new screens are covered instead by component tests (`frontend/tests/p4-finance-hr-nurse.test.tsx`).
- Code review of `modules/health`.

| # | Finding | Severity | Status |
|---|---|---|---|
| N-1 | No view across visits: a class with three fevers in two days, or a child seen every week, is visible only by reading the list. | high | Built **Health Watch**: clusters and frequent visitors, with the visits behind each. |
| N-2 | Immunisation next-due dates were recorded per child, but nothing listed what is due or overdue. | medium | Due / overdue list (default 30 days ahead). |
| N-3 | No screening coverage by class, and no list of results needing follow-up. | medium | Coverage per class (least covered first) and a follow-up list. |
| N-4 | No register export for an inspection or the school's records. | medium | CSV register for any range (audited: a PII read plus an audit row). |
| N-5 | The assistant had only "today", "log visit" and "log dose": no visit search, stock, immunisation/screening entry or closing a visit. | medium | 6 tools added (section 5). |
| N-6 | The nurse portal's navigation lists generic staff pages (procurement, newsroom and others) but only one health page. | low | Health Watch added to the HEALTH group. The generic pages are left as they were. |

## 4. What was built

- **Backend** `backend/src/modules/p4ops/healthInsights.service.js`, routes `/api/v1/health-insights` (needs the `healthRoom` feature and `health.manage` ALL, so the nurse only):
  - `GET /`: the watch list.
  - `GET /register.csv`: the register.
- How the watch list works:
  - Complaint text is decrypted on the server and sorted into categories: fever, gastro, respiratory, skin, eye, headache.
  - Clusters are three or more children (configurable) in one section within 3 days (configurable).
  - Every read is audited as `health.read` via `health.insights`.
- **Screen** *Health Watch* (`/nurse/health-watch`).
- **Sample data**: three "fever" visits in the demo teacher's class over two days (a cluster to see), and a Td dose coming due in ten days.

**Health-data rules, kept**
- Nothing reaches the principal, the administrator, analytics, feeds, search or the map. The principal keeps the counts-only summary.
- A cluster is a prompt for the nurse, and telling anyone is the nurse's decision.
- The insights and the register are refused to every other role (tested for admin, principal, finance, teacher and HR).
- The assistant's health tools carry `forRoles: ['NURSE']`, plus the `health.manage` ALL check.

**AI and automation**
- The watch list is a rule-based, explainable signal with its evidence. It is not a diagnosis.
- The nurse can do the routine writes by voice or chat (close a visit, update stock, add an immunisation or screening), each a confirmed draft.

## 5. Assistant coverage (Nurse)

New tools, all nurse-only:

| Tool | Kind | Rule |
|---|---|---|
| `get_health_watchlist` | read | |
| `list_health_visits` | read | date, student or outcome |
| `close_health_visit` | write | time out and outcome; confirmed |
| `list_health_stock` | read | |
| `update_health_stock` | write | confirmed |
| `add_health_entry` | write | immunisation or screening; confirmed (WhatsApp allowed: MEDIUM risk, the nurse's own work) |

The nurse's catalogue went from 52 tools to 62 (20 writes). Still screen-only, on purpose:
- care notes (they are not chat content);
- prescriptions and consent (the parent's);
- countersigning a controlled medicine (a second person at the cabinet).

## 6. What remains, and why

- **Immunisation compliance against a national schedule** (which doses a child of a given age should have had). Needs the school's chosen schedule (UIP or IAP) as a verified rule table.
- **Sending a cluster alert to the principal or the class parents from the page.** Left as a human step outside the system for now. Any message must carry no names or clinical words, and the wording is the nurse's and principal's call.
- **RBSK and district reporting formats.** These vary by state.
