# EduOS advanced features and competitor research

Prepared for the EduOS product owner • 14 October 2026

## Executive recommendation

EduOS should next become a platform that closes operational loops: identify a problem, assign an owner, complete the work, retain evidence and measure the result. Its strongest opportunity is connecting academics, finance, facilities, family engagement and school governance through reliable workflows. More dashboards alone will not accomplish that.

Prioritise trustworthy analytics, laboratory operations, asset and service lifecycles, complete PTM workflows, vehicle capacity and child handover, and student support plans. Build shared permissions, data definitions and reliable background processing alongside these features. Then add competency portfolios, sustainability evidence, alumni continuity, external publishing and school-group planning. Camera intelligence should remain a controlled optional pilot, with human review and explicit limits.

The recommendations below extend the earlier implementation prompt. They include additional needs discovered through school-role analysis and comparison with seven relevant products or product families. They are a proposed product roadmap, not a claim that the recommended capabilities have been implemented.

## Evidence and comparison method

The code baseline is commit `d359a48`, with targeted inspection of backend models, services, permissions, scheduler and frontend campus integration. The preceding audit ran 71 existing backend tests across six suites successfully. This research adds source inspection, not a new full regression or a live-school certification.

Status terms used here:

- **Existing foundation:** substantive code exists; the recommendation extends it.
- **Partial workflow:** part of the user journey exists, but the complete recommended workflow was not established.
- **Not found:** no dedicated implementation was identified in the inspected areas; verify repository-wide before estimating development.
- **Needs validation:** implementation or production operation needs deeper testing or configuration inspection.

Competitor entries describe capabilities documented on official product or support pages. They do not establish implementation quality, inclusion in every subscription, Indian regulatory suitability or negotiated price. “Not documented” must never be converted into “competitor does not have it.” Vendor pricing, deployment times and satisfaction figures from the earlier competitor report are not carried forward because they were not independently established.

“Standard” has three distinct meanings: common school ERP workflows, published technical standards, and jurisdiction-specific educational or regulatory requirements. A vendor feature is not a legal mandate. A voluntary technical benchmark is not a certification.

## Competitor comparison and the practical lessons

| Benchmark | Officially documented capability | EduOS position | Recommended response |
|---|---|---|---|
| Fedena | Broad school ERP modules; its advanced catalogue also describes visitor/gate management and alumni functions. [Fedena features](https://fedena.com/feature-tour), [advanced modules](https://fedena.com/feature-tour/ultimate-modules) | Core ERP and alumni foundations exist. A complete visitor and dismissal workflow was not established. | Complete daily operations and alumni transition before positioning the product as comprehensive. |
| Entab CampusCare | Admissions-to-alumni records, management dashboards, fees, bus tracking, competency/rubric assessment, holistic progress cards and CPD tracking. [CampusCare](https://www.entab.in/school-erp-software.html) | Admissions, fees and academic records exist. Broad period comparisons, connected transport and competency portfolios need extension or validation. | Treat Indian-school academic reporting and operational integration as expected product depth. |
| Arbor | Scheduled/custom reports, interventions, staff cover, special educational needs records and configurable workflows. [School MIS](https://arbor-education.com/school-mis/), [reporting help](https://support.arbor-education.com/hc/en-us/articles/360016570258-Begin-Introduction-to-Reporting-in-Arbor) | Rule-based risk indicators exist. Closed-loop support plans and a general report builder were not found. | Connect concerns to support actions and measure follow-up; introduce governed reporting and reusable workflow templates. |
| Veracross | Tuition and incidental billing, payment reminders, family billing access and a distinct portal for other bill payers. [Tuition management](https://www.veracross.com/tuition-management/) | Invoices and payments exist. A separately scoped payer relationship needs validation. | Separate permission to pay from permission to see a child's academic or medical information. |
| ManageBac+ | Mobile academic tasks, service-learning activities, goals and portfolios; its curriculum material describes criterion-based assessment. [Mobile](https://www.managebac.com/mobile), [curriculum brief](https://www.managebac.com/wp-content/uploads/2022/03/ManageBac-Solution-Brief-1.pdf) | Assignments, quizzes, syllabus and achievement records provide a foundation. A linked competency/evidence portfolio was not found. | Develop longitudinal learning evidence and configurable rubrics; do not copy IB-specific rules into every school. |
| SchoolsBuddy | Activity preferences/sign-ups, attendance, bookings, parent conferences, transport/dismissal and payment workflows. [Product catalogue](https://www.schoolsbuddy.com/) | PTM meetings and achievement records exist, but do not cover allocation, complete booking or dismissal. | Connect activity choice, capacity, consent, payment, attendance and how the child goes home. |
| Finalsite | Communications products emphasise multiple channels; support documentation identifies Messages XR Enterprise as the current replacement for legacy Mass Notifications, with automation and reporting. [Current product comparison](https://mxresupport.finalsite.com/hc/en-us/articles/35307729755149-Mass-Notifications-and-Messages-XR-Enterprise-compared), [channel tour](https://www.finalsite.com/mass-notifications-guided-tour) | Messaging/outbox foundations exist; delivery depends on provider configuration. | Build an actionable family inbox and tested escalation/fallback instead of treating “message queued” as “family informed.” |

The product opportunity is the combined workflow: a broken lab instrument produces a work order, budget commitment, replacement purchase, revised practical timetable and management report, while the relevant people see only their own tasks. This is a design recommendation; no claim of market uniqueness is established by the comparison.

## Code backed gap assessment

| Area | Evidence in the repository | Assessment and next step |
|---|---|---|
| Analytics | `backend/src/modules/dashboard/dashboard.service.js`; marketing analytics | Existing current-state summaries. Add common date/comparison definitions, historical snapshots and cross-department drill-down. |
| Invoices and procurement | `modules/fees/`, `models/fee.model.js`, `modules/finance-ops/procurement.service.js`, `models/finance.model.js` | Existing billing, quotations, purchase orders, receiving and matching. Extend recurring bills, reconciliation and lifecycle links. |
| Licences and contracts | `models/compliance.model.js`, `models/administration.model.js` | Existing expiry, renewal, contract dates, notice periods and obligations. Unify ownership and recurring service execution. |
| Laboratories | Facility LAB type and asset register | Partial physical-space foundation. Dedicated chemical/device stock and practical-session operations were not found. |
| Transport | `models/transport.model.js`, `modules/transport/` | Routes, stops, fares and enrolments exist. Dedicated trip capacity, telemetry and handover need work. |
| PTM | `models/onlineClass.model.js`, `modules/lectures/lecture.service.js`; PTM events | Meetings exist. Family slot booking and structured review follow-up were not found. |
| Sports and arts | `models/coCurricular.model.js` | Approved student achievement records exist. Club/team scheduling and session operations need extension. |
| Community and alumni | `models/community.model.js`, `modules/community/`, alumnus frontend portal | Substantial foundation including moderation, circles and mentoring. Verify leaving/graduation continuity, directory consent and former-teacher access. |
| Student support | `models/growthRisk.model.js`, `modules/risk/risk.service.js` | Current risk service uses thresholds, not a validated predictive model. Add support plans and outcome tracking. |
| Health | `models/medicalRecord.model.js` | Encrypted allergies, medication text and history exist. This does not establish medication administration or clinic-visit workflows. |
| Guardian pickup | `models/student.model.js` has `pickupAuthorized` | Useful foundation; a boolean does not establish time-limited pickup delegation, ID checks or release reconciliation. |
| Jobs and reporting | `jobs/scheduler.js`, `models/jobRun.model.js` | Scheduled operations exist. Quarterly report delivery and crash-safe recovery need extension. |
| 3D campus | `components/campus/`, `modules/campus/` | Existing role-aware campus. Extend contextual tasks and real entity links, not decorative duplicates. |
| Identity assurance | `models/account.model.js` has `mfaSecret` | A field is insufficient proof of working MFA. Enrollment, challenge, recovery and privileged-action enforcement need validation. |
| Interoperability and offline use | Existing APIs and responsive frontend | Dedicated OneRoster exchange and robust offline conflict handling were not found in the targeted inspection. |

## Priority model and recommended delivery order

**P0** means essential operating controls or foundational work. **P1** means high-value workflow completion. **P2** means advanced differentiation after foundations. **Pilot** means an optional capability needing operational validation before general use. Effort is relative: M is an extension across an existing domain, L is a new workflow across several components, and XL spans multiple domains or external systems. These are planning bands, not time or cost estimates.

| ID | Feature | Priority | Effort | Accountable owner | Critical dependency |
|---|---|---|---|---|---|
| F01 | Shared data definitions and historical reporting | P0 | L | Admin and finance | Stable entity IDs and event dates |
| F02 | Principal and department analytics | P0 | XL | Principal | F01 and data scopes |
| F03 | Common tasks and reliable reminders | P0 | L | Operations admin | Durable jobs and owners |
| F04 | Finance reconciliation and recurring bills | P0 | L | Finance | Existing ledger and approvals |
| F05 | Asset service and licence lifecycle | P0 | L | Facilities/compliance | Asset registry and F03 |
| F06 | Science and computer laboratories | P0 | XL | Lab heads | Inventory ledger and facilities |
| F07 | Vehicle capacity and safe handover | P0 | L | Transport head | Trip model and guardian authority |
| F08 | PTM and parent review workflows | P1 | L | Academic coordinator | Calendar and booking locks |
| F09 | Student support plans | P1 | L | Academic/support team | Reliable observations and restricted cases |
| F10 | Competency portfolios and progress cards | P1 | XL | Academic head | Curriculum/versioned rubrics |
| F11 | Cover and timetable coordination | P1 | L | Timetable coordinator | Availability and constraints |
| F12 | Sports arts clubs and trips | P1 | L | Activities coordinator | Capacity, consent and fees |
| F13 | Family action inbox | P1 | L | Parent engagement lead | Scoped relationships and delivery |
| F14 | Health visits and medication records | P1 | L | Authorised health staff | Health permissions and consent |
| F15 | Visitors emergencies and reunification | P0 | L | Safety lead | Current rosters and pickup controls |
| F16 | Sustainability and recognition evidence | P1 | L | Eco Club/facilities | Measurements and verification |
| F17 | Alumni lifecycle and mentoring outcomes | P1 | M | Alumni coordinator | Access transition and verification |
| F18 | Achievement showcase and social publishing | P2 | L | Communications lead | Publicity consent and provider access |
| F19 | Curated daily learning digest | P2 | M | Editorial/academic lead | Licensed/approved sources |
| F20 | Quarterly decision reports | P1 | L | Principal and admin | F01–F03 and access-controlled delivery |
| F21 | Mobile offline and language support | P0/P1 | XL | Product/IT | Sync policy and accessible design |
| F22 | Interoperability and onboarding | P1 | XL | IT/data administrator | Data contracts and import staging |
| F23 | Identity privacy and operational resilience | P0 | XL | IT/compliance | Policy, recovery and access review |
| F24 | Capacity and budget scenario planning | P2 | L | Principal/finance | Clean historical data |
| F25 | Evidence-based staff AI assistance | P2 | L | Department owners | Authorised tools and evaluation |
| F26 | Operational 3D campus | P1 | M | Admin | Canonical facility/entity APIs |
| F27 | Optional camera event review | Pilot | XL | Safety/IT | Provider, purpose and measured accuracy |

## Detailed feature recommendations

### F01 Shared data definitions and historical reporting

Establish one dictionary for student strength, attendance, revenue, collections, dues, utilisation and cost. Store academic year, financial year, effective dates, campus and department explicitly. Preserve historical enrolment, fee structures, published results and organisational assignments so a prior-year report does not use today's status.

Add data-quality queues for duplicate students, unlinked payments, missing owners, invalid units and incomplete imports. Corrections need a reason and history. A missing baseline must display “not available,” not zero. Completion means that the same metric agrees across the dashboard, export and quarterly report, with source records and a versioned definition.

### F02 Principal and department analytics

Provide an executive overview followed by department workspaces. Each should answer: what changed, why it needs attention, who owns the response and which records support it. Offer custom periods, equivalent prior periods, same elapsed prior-year periods, multiple academic years and saved comparisons. Include student counts, admissions, results, attendance, staffing, fees, procurement, labs, transport, maintenance, compliance, engagement and sustainability.

Advanced functions include cohort retention, actual versus budget, renewal forecasts, cost per occupied seat and source-linked exception queues. Label cash collections separately from billed or recognised revenue. Do not imply causation from a trend. Completion requires reconciled totals, accessible tables alongside charts and scoped drill-down for every supported metric.

### F03 Common tasks and reliable reminders

Create one work queue for approvals, bills, inspections, service visits, PTM follow-ups and stock expiry. Every task needs an owner, backup, due date, priority, evidence, recurrence and escalation. Department leaders should see workload and overdue bottlenecks; a leaving employee's tasks must transfer explicitly.

Use durable schedules, recoverable worker claims and an outbox. Record queued, attempted, sent, delivered and failed separately; retry without duplicate delivery. Add holiday/quiet-hour policies and justified urgent overrides. Completion includes a crash-recovery test and an overdue item progressing to the next responsible person.

### F04 Finance reconciliation and recurring bills

Extend the existing finance foundation with bank/payment matching, unallocated-payment review, partial settlement, refunds, credit adjustments, recurring utilities/AMC bills and invoice ageing. Connect purchase commitment, receiving, supplier invoice and payment without counting the same expenditure multiple times.

Add explainable review flags for duplicate supplier invoices, mismatches and unusual costs, not automatic fraud labels. Support a payer relationship separate from academic guardianship, with split responsibility where the school needs it. Verify tax and accounting exports for the school's jurisdiction rather than assuming all schools use one format. Completion means a period can close with reconciled balances and a documented exception list.

### F05 Asset service and licence lifecycle

Connect procurement to installation, custodian, room, warranty, AMC, inspections, repair, replacement and disposal. Include fire equipment, electrical installations, drinking water, lifts if present, sanitary services, vehicles, lab equipment and software seats. Track both contract end dates and notice deadlines that precede auto-renewal.

Advanced features: life-cycle cost, repeat-failure history, downtime, repair-versus-replace comparison and forecast renewal spend. A completed service needs evidence and the next scheduled instance. Completion means an administrator can identify everything due next quarter, its cost, owner and consequence of non-renewal without opening separate registers.

### F06 Science and computer laboratories

Science labs need batch/lot stock, expiry/opened dates, units, safe storage metadata, safety data sheets, controlled access, issue/return, consumption, breakage, calibration and authorised disposal evidence. Computer labs need serialised equipment, workstation allocation, software licences, warranty/AMC, repair and e-waste records. Reuse existing facilities and assets.

Connect practical planning to room booking, technician preparation, safe equipment availability and supervised attendance. Use an auditable stock ledger with atomic issue/return, stocktake adjustments and reorder suggestions. Completion includes preventing expired stock issue and negative quantities under concurrent requests, while an unavailable instrument visibly affects the practical plan.

### F07 Vehicle capacity and safe handover

Model vehicle, route and trip separately. Store permitted capacity, assignments, driver/attendant credentials, service/fitness/insurance dates and emergency equipment. Distinguish enrolled, allocated, boarded and safely released counts. Include substitution, missed stop, no-show and end-of-trip reconciliation.

GPS and RFID/QR are optional adapters with stale/offline status, duplicate detection and manual fallback. Guardians see only their child's authorised trip. A checkpoint does not prove continuous presence. Completion means the system prevents over-allocation, identifies unmatched boarding/alighting and records authorised pickup without exposing other children.

### F08 PTM and parent review workflows

Build on existing meetings: teacher availability, buffers, multiple children, appointment conflict checks, assisted booking, cancellation, waitlists and online/offline venues. Add a concise child briefing and a structured outcome record.

Review calls need attempt history, reached/not-reached outcome, agreed actions, owner, due date and subsequent review. Sensitive safeguarding notes remain separate. Measure completed meetings, unresolved actions and families needing another channel. Completion requires a parent booking two children without clashes and a teacher closing the resulting follow-up action.

### F09 Student support plans and inclusion

Move from risk flags to a support cycle: observed concern → staff review → agreed support plan → sessions/actions → progress review → continue, adjust or close. Include attendance support, subject remediation, language assistance and authorised learning accommodations. Track baseline, goal, support frequency, responsible adult and review date.

The current risk service explicitly uses thresholds and stores values under a probability field. Present these as rule-based indicators unless predictive validity is established. Fee difficulty must not become a child's academic or conduct label. Completion means staff can explain why support was offered and whether it helped, without exposing restricted information to unrelated teachers or peers.

### F10 Competency portfolios and holistic progress cards

Link curriculum outcomes to tasks, rubrics, teacher observations and evidence. Show learning progress across terms, student reflection and appropriate family input, alongside exam results. Maintain published-report versions and teacher moderation. PARAKH supplies a relevant Indian reference for competency-oriented holistic assessment; the school's board and stage determine the adopted template. [PARAKH HPC](https://parakh.ncert.gov.in/index.php/hpc)

Allow different assessment structures rather than one universal scoring formula. Do not infer personality or mental health from a portfolio. Completion means a teacher can trace a reported competency to reviewed evidence, correct it through an audited process and publish the authorised progress card.

### F11 Staff cover and timetable coordination

Connect approved leave to affected lessons, eligible substitutes, workload limits, room capacity and lab availability. Provide proposed cover choices with clear conflicts; a coordinator confirms the change and the affected people receive one consistent update.

Later, add a constraint-based timetable planner with locked lessons, teacher availability, shared rooms and a preview of changes. Keep manual override and reasons. Completion means a teacher absence produces a confirmed cover plan and consistent timetable/campus views, with no duplicate room or staff booking. Do not score teacher quality from presence or examination averages alone.

### F12 Sports arts clubs and trips

Extend achievements into seasons, teams, clubs, coaches, rehearsals, practice sessions, fixtures and competitions. Add preference-based enrolment, eligibility, fair allocation, capacity/waitlist, attendance, equipment, consent, charges, transport and safe dismissal. Include arts and service activities, not only sports.

Track participation access, development goals, workload and verified accomplishments. Scholarships or waivers should avoid exposing financial circumstances. Completion means a club's allocation, payment, attendance and transport change remain consistent; a cancelled session updates families and room bookings together.

### F13 Family action inbox and relationships

Give a family one prioritised list: sign consent, book PTM, pay a bill, explain absence, review progress or acknowledge an urgent notice. Combine siblings where authorised and respect different guardian, payer and pickup permissions. Include contact verification, language preferences and accessible forms.

Separate an unread announcement from an outstanding required action. Provide two-way threads linked to the relevant child/task and an unresolved-message queue for staff. Completion means the school can identify who still needs assistance without assuming message delivery equals comprehension or consent.

### F14 Health visits and medication administration

Extend encrypted health information with clinic visits, authorised medication instructions, administration records, missed-dose handling, medicine stock/expiry, guardian notification and emergency action plans. Authorised health personnel define procedures; the platform must not diagnose or generate treatment instructions.

Give teachers only necessary accommodation/emergency instructions, not the full medical history. Include allergy-aware event/meal planning where applicable. Completion means a trained staff member can record an administered dose with who, when and instruction reference, while preventing an accidental duplicate record and preserving corrections.

### F15 Visitors emergencies and reunification

Add pre-authorised visitors, contractor checks, host approval, purpose/location, badge expiry and checkout. Link child pickup to verified authorised adults, temporary delegations, time limits and custody restrictions. Do not rely on a static guardian checkbox alone.

Emergency workflows need drill schedules, current occupancy/attendance reconciliation, assembly groups, missing/unconfirmed status, controlled broadcast and family reunification. Supply protected offline rosters and manual continuity procedures. Completion requires a simulated evacuation and authorised child release with an audit trail, including a network outage scenario. This recommendation complements existing safeguarding and safety records; it does not replace school emergency procedures.

### F16 Sustainability and recognition evidence

Track waste by stream and measured weight, authorised collection receipts, water/energy use, leak repairs, composting, tree locations and survival. Use baselines normalised for school size or occupied days. Teacher-verified activities can earn transparent, capped house/class points; no hazardous waste handling by children and no rewards tied to spending.

Provide separate evidence packs for relevant programmes. Eco Clubs for Mission LiFE supports environmental engagement; SHVR supplies a government cleanliness/green-rating route; CSE GSP is a separate non-government environmental audit. Store eligibility, cycle, source, owner and actual result. Do not promise awards or reuse old deadlines. [Eco Clubs](https://ecoclubs.education.gov.in/), [SHVR announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2149668&lang=2&reg=48), [GSP 2026–27](https://www.cseindia.org/gsp-audit-2026-13190)

Completion means measured impact and evidence are reviewable; planting counts are distinguished from survival, and platform badges are clearly separate from official recognition.

### F17 Alumni lifecycle and mentoring outcomes

Extend existing circles and mentoring with verified former-student/former-teacher affiliation, batches, reunions, voluntary career updates and directory visibility controls. Graduation or leaving should end operational access while preserving opted-in community access. Social profile links are user-provided, not covertly monitored.

Match mentoring by subject/interests and availability, retain staff supervision for minors and measure completed sessions and useful outcomes. Donations or scholarships can be a later extension with finance review. Completion means a former student can recover their community account without regaining old classroom/finance privileges.

### F18 Achievement showcase and external publishing

Generate draft ranker and achievement stories from approved published results, with tie rules, year/class, corrections and publicity consent. Include improvement, arts, sports and service achievements. Do not expose the full class ranking as publicity.

Authorised staff choose connected school social destinations; parents/students cannot publish externally. Add preview, approval, per-network result, retry and withdrawal handling. Recheck consent before dispatch. Completion means a queued post is stopped when consent changes and a provider retry cannot publish duplicates. Provider APIs, account permissions and media formats must be verified before activation.

### F19 Curated daily learning digest

Offer opt-in, role/subject/age-appropriate updates from approved RSS feeds, official sources or licensed providers. Each item needs date, source link, short attributed summary and topic. Add teacher-curated discussion prompts, bookmarks and moderation.

Use explicit interests rather than sensitive behavioural profiles. Prevent duplicate/stale items, unsafe fetched content and fabricated updates when sources fail. Completion means readers can reach the original source, opt out and see corrections. This is an editorial product, not an undocumented Google Alerts integration or unrestricted automatic news scraping.

### F20 Quarterly decision reports

Produce a principal/admin summary with department appendices: current and comparison KPIs, budget variance, renewal forecasts, completed work, unresolved issues and decisions required. Every action needs an owner and review date. Freeze source cut-off and report version; display incomplete history.

Generate deterministic figures and use AI, if desired, only for a reviewable narrative grounded in them. Separate restricted appendices. Deliver securely with retry and recipient permission checks. Completion means a failed worker can recover without duplicate reports, and a corrected report is visibly a new version rather than a silent rewrite.

### F21 Mobile offline language and accessibility

Prioritise fast attendance, boarding, stock scans and family actions on affordable phones. Start with a responsive/PWA experience and offline queues for specifically supported tasks. Define what may be stored locally, device protection, expiry, conflict resolution and resynchronisation. High-risk actions should remain unavailable offline unless a safe protocol is designed.

Support school-selected languages, readable forms, keyboard operation and screen readers. Use WCAG 2.2 AA as a design/testing target, not a certification claim. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Completion includes a tested offline attendance reconciliation and usable non-3D alternatives. Native apps should follow demonstrated device/integration needs rather than being an automatic first investment.

### F22 Interoperability and school onboarding

Create staged imports with column mapping, validation, duplicate review, dry run, error download and reconciliation. Include opening balances, academic history, contacts and consent. Provide stable scoped APIs, versioning, webhook signing, idempotency and integration health.

Evaluate OneRoster for roster/gradebook exchange with learning platforms; implement only the services the school needs. It is a published interoperability specification, not a universal integration with government portals. [OneRoster 1.2](https://standards.1edtech.org/oneroster/specifications/standards/v1p2) Completion means a staged import can be corrected safely and a failed external sync can resume without duplicates. Add academic-year rollover previews and explicit handling of graduating, repeating and transferring students.

### F23 Identity privacy and operational resilience

Validate working MFA for privileged users, session/device revocation, account recovery and temporary delegation. Run access recertification for staff role changes. Extend data retention, legal holds, consent history and deletion/export workflows across domains, preserving obligations without retaining everything indefinitely.

Use an explicit security verification plan informed by OWASP ASVS; include tenant isolation, file access, injection, secure secrets, audit protection and API authorisation. [OWASP ASVS](https://owasp.org/projects/asvs) Add backup-restore drills, monitored jobs, rate limiting, incident ownership and agreed recovery objectives. Verify current Indian data-protection commencement and applicability with official materials before claiming legal compliance. [MeitY DPDP materials](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025)

Completion means another school's records cannot be accessed through any interface, revoked users lose downloads/jobs as well as menus, and a restore exercise recovers verified data.

### F24 Capacity and budget scenario planning

Once historical data is reliable, let leaders model a new section, fee change, additional bus, lab upgrade or staffing change. Show assumptions, capacity constraints, one-time and recurring costs, expected collections and sensitivity ranges. Distinguish scenario projections from approved budget and actual results.

School groups can compare campuses using agreed definitions and authorised aggregates. Cross-school comparisons need comparable cohorts and protection against identifying small groups; do not build public child or school rankings. Completion means a decision-maker can change an assumption and trace every changed result without affecting live records.

### F25 Evidence based staff AI assistance

Build on the existing assistant rather than adding another chatbot. Useful extensions include a principal's sourced briefing, meeting-note action drafts, document-to-task extraction, natural-language report selection and explanations of reconciliation exceptions. Each answer should identify underlying authorised records and distinguish missing data.

Use allowlisted operations, explicit confirmation for consequential writes and evaluations for incorrect amounts, dates, permissions and malicious source text. Do not let AI independently decide admissions, discipline, medical action or payments. Completion means staff can verify and correct the output, and malicious text in a document cannot trigger tools or bypass scope.

### F26 Operational 3D campus

Make rooms and assets gateways to real tasks: lab preparation, available equipment, sports bookings, open repairs, transport readiness, gardens and waste stations. Show data age and explain representations based on timetable/register data. A rendered teacher or student is not a live camera observation.

Retain fast search, accessible 2D/list views and role-limited payloads. Restricted cases, health details and identifiable child movement must not appear on a shared map. Completion means each map action opens the same canonical record as the ordinary UI and no business state is duplicated in scene code.

### F27 Optional camera event review

Implement only after a school defines purpose, locations, retention, accountable reviewers and a response process. Start with device health and possible unattended-room observations, reconciled with timetable, teacher check-in and substitutions. Camera presence cannot establish whether good teaching occurred.

Possible aggression alerts should be unverified events for trained human review, never automated bullying findings or discipline. Measure missed incidents, false alerts, delay and reviewer burden before expansion. Exclude face identification, emotion inference, covert tracking and private-space cameras. Completion for a pilot means documented evaluation and correct restricted evidence handling; an adapter or demo video alone is not a validated safety system.

## Standard workflow and screen format

Use one consistent module structure: overview, work queue, calendar, records, reports and settings. Show the next useful action, accountable person and due date near the record. Every module needs loading, empty, error, partial-data and permission-denied states. Tables need search, filters, saved views and scoped export. A chart must have a readable table equivalent.

Every consequential workflow should follow: create or detect → validate → assign → approve where needed → execute → retain evidence → notify → review outcome → close or renew. Corrections, cancellation, delegation and reopening are part of the workflow, not administrative afterthoughts.

| Role | First screen should answer | Primary actions | Boundaries |
|---|---|---|---|
| Principal | What threatens learning, safety or delivery, and what decision is needed? | Review exceptions, assign actions, inspect trends | Sensitive cases only through explicit authority |
| Admin | What must happen today and who owns it? | Tasks, schedules, capacity, renewals | No automatic access to all health/payroll details |
| Teacher | Which classes and learners need action? | Register, lesson, support, PTM, club session | Assigned pupils and necessary support information |
| Parent | What do I need to do for each child? | Consent, booking, payment, absence response | Authorised children and relationships only |
| Student | What is next and where can I get help? | Learning, activities, requests, mentoring | Own records and age-appropriate community |
| Finance | What is due, unmatched or awaiting approval? | Reconcile, invoice, approve, report | Financial scope, not unrestricted child records |
| Lab and facilities | What is unavailable, unsafe or due? | Prepare, issue, inspect, repair | Relevant rooms/assets; restricted student data |
| Transport | Who should board, who boarded and who was released? | Allocate, reconcile, escalate | Active authorised trips and pickup information |
| Alumni | Where can I contribute or reconnect? | Mentoring, events, batch updates | Community-only access after leaving |

## Analytics definitions that must be agreed before implementation

| Metric | Recommended definition | Common error to prevent |
|---|---|---|
| Student strength | Enrolments active as of the selected date | Applying today's active status to old years |
| Admission conversion | Accepted/enrolled applicants divided by a defined eligible cohort | Mixing application periods and changing denominators |
| Attendance rate | Attended eligible sessions divided by scheduled eligible sessions, with explicit status rules | Treating unmarked sessions as absence or ignoring excused rules |
| Billed fees | Valid issued charges by defined billing date, with explicit adjustment treatment | Calling billed amounts cash revenue |
| Net collections | Settled receipts less settled refunds in the selected payment period | Counting invoice creation as payment |
| Outstanding fees | Charges less applicable credits and allocations as of cut-off | Subtracting all-time payments from period-only invoices |
| Budget utilisation | Defined actual expenditure divided by approved budget; commitments shown separately | Adding PO and supplier invoice as two expenses |
| Vehicle utilisation | Allocated or boarded count divided by usable permitted seats, labelled separately | Using route enrolment as live occupancy |
| Lab utilisation | Used/booked hours divided by defined available hours, labelled separately | Treating bookings as completed sessions |
| Support effectiveness | Goal progress after a recorded support interval, with context | Claiming the intervention caused every improvement |
| Waste diversion | Verified diverted weight divided by measured total weight for the same boundary | Comparing counts of bags with kilograms |
| Tree survival | Verified living planted trees divided by eligible planted cohort at a review date | Equating planting activity with long-term survival |

Custom ranges must define timezone boundaries. Year comparisons should offer equal elapsed periods and clearly label partial years. Zero denominators require an explicit non-comparable result. Monetary values must retain currency and minor-unit precision. Historical corrections must not silently rewrite previously published reports.

## Acceptance scenarios for competitors and EduOS

Use these same scripts during vendor demos and internal acceptance. Require the presenter to complete the workflow with records and permissions, not just show a slide. Product package, paid add-on and integration requirements should be recorded separately.

1. A parent books meetings for two children, reschedules one, and receives the correct follow-up tasks.
2. A teacher is absent; cover is assigned without conflicts and all schedules agree.
3. Two users request the last bus seat simultaneously; only one succeeds, and a substitute vehicle preserves safe capacity.
4. An expired chemical is scanned for issue; the issue is blocked and a replacement preparation path is available.
5. A supplier delivers partially and invoices fully; the discrepancy remains visible through payment approval.
6. Compare a partial current academic year with the same elapsed prior-year period and reconcile the export.
7. A quarterly worker crashes after generating a report; recovery does not duplicate recipient deliveries.
8. A guardian's authority is revoked; existing sessions, scheduled messages and report links no longer disclose the child.
9. A student graduates; community access survives but former operational access ends.
10. Publicity consent is withdrawn while a social post is queued; the external post is stopped.
11. Attendance is taken offline; a conflicting server correction is reconciled with history rather than overwritten.
12. A safety drill includes an unconfirmed child and a restricted pickup adult; release is controlled and recorded.
13. A student receives support; the teacher can review progress without exposing confidential counselling details.
14. A user from another school requests an export, nested asset or AI answer; every access path refuses it.
15. A backup is restored in an isolated environment and the school verifies totals, attachments and permissions.

## Delivery roadmap and measurable outcomes

### Wave one Establish trustworthy operations

Deliver F01–F07, the core of F15 and F23, and the minimum mobile/offline design needed for those workflows. Validate complete financial and stock records, safe allocation, task ownership and recovery. Define support/deployment responsibilities and production provider status.

Exit criteria: reconciled metric examples, tested permission matrix, no demonstrated duplicate/negative stock or capacity races, visible failed-job recovery and a successful restore exercise. Establish baseline measures before promising time savings.

### Wave two Complete school and family journeys

Deliver F08–F14, F16–F17, F20–F22 and corresponding F26 surfaces, staging larger items into usable slices. Prioritise the school's actual mix of labs, transport, boarding and special support rather than enabling every module for every tenant.

Measure PTM completion and overdue follow-ups, staff time per daily workflow, resolved data-quality issues, laboratory stock accuracy, renewal completion, unmatched boarding events and family task completion. Set targets with pilot schools after baseline measurement.

### Wave three Add advanced capabilities

Deliver F18–F19 and F24–F25 once data, consent and integration reliability are established. Evaluate F27 only with a willing school's defined operating process and measured performance. Keep external/provider activation separate from software readiness.

Measure source accuracy and correction rates for digests/AI, publishing failures, scenario usefulness, mentoring outcomes and verified environmental progress. Avoid vanity metrics such as total posts, total alerts or total features.

The strongest candidate differentiation is a principal decision workspace supported by auditable operational workflows, measurable learner support and environmental evidence. Validate that proposition with schools; a 3D view or camera feature alone is not evidence of product-market fit.

## Source register and research limits

All links below were consulted on 14 October 2026. Dates in programme names identify the referenced cycle, not a guarantee that applications are currently open. Product capabilities can vary by edition; obtain written confirmation before procurement or comparative sales claims.

| Source | What it supports | Applicability |
|---|---|---|
| [Fedena feature tour](https://fedena.com/feature-tour) and [advanced modules](https://fedena.com/feature-tour/ultimate-modules) | ERP breadth, gate/visitor and alumni catalogue | Vendor-described baseline |
| [Entab CampusCare](https://www.entab.in/school-erp-software.html) | Indian-school SIS, assessment, reporting and transport claims | Vendor-described baseline |
| [Arbor School MIS](https://arbor-education.com/school-mis/) and [reporting help](https://support.arbor-education.com/hc/en-us/articles/360016570258-Begin-Introduction-to-Reporting-in-Arbor) | Interventions, workflows and report construction | UK product workflow reference, not Indian statutory guidance |
| [Veracross tuition](https://www.veracross.com/tuition-management/) | Billing and separate payer access | Billing experience reference |
| [ManageBac mobile](https://www.managebac.com/mobile) and [curriculum brief](https://www.managebac.com/wp-content/uploads/2022/03/ManageBac-Solution-Brief-1.pdf) | Portfolio, academic mobile and assessment patterns | Curriculum-specific product reference; brief is older |
| [SchoolsBuddy](https://www.schoolsbuddy.com/) | Activities, conferences, bookings, transport/dismissal | Specialist workflow reference |
| [Finalsite current product](https://mxresupport.finalsite.com/hc/en-us/articles/35307729755149-Mass-Notifications-and-Messages-XR-Enterprise-compared) and [channel tour](https://www.finalsite.com/mass-notifications-guided-tour) | Communications product status and channel workflow | Confirm capabilities in the quoted package |
| [PARAKH HPC](https://parakh.ncert.gov.in/index.php/hpc) | Holistic competency-oriented assessment | Board/stage adoption must be verified |
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Accessibility benchmark | Proposed engineering target |
| [1EdTech OneRoster](https://standards.1edtech.org/oneroster/specifications/standards/v1p2) | Roster and gradebook interoperability | Implement selected services; no certification implied |
| [OWASP ASVS](https://owasp.org/projects/asvs) | Security verification requirements | Engineering review framework |
| [MeitY DPDP materials](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025) | Official privacy rules and related materials | Check commencement, amendments and school-specific applicability |
| [Eco Clubs](https://ecoclubs.education.gov.in/) | Environmental education and participation | Government initiative; school obligations vary |
| [SHVR announcement](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2149668&lang=2&reg=48) | Government school cleanliness/green-rating initiative | Referenced 2025–26 cycle; verify current instructions |
| [CSE GSP 2026–27](https://www.cseindia.org/gsp-audit-2026-13190) | Environmental audit across school resource use | Non-government recognition; verify current application conditions |

This is a code-informed product recommendation, not a full production audit, legal opinion or hands-on ranking of vendors. No application features were changed for this report. The existing implementation prompt remains the detailed engineering handoff; this document supplies the product priorities, additional advanced features and comparison framework.
