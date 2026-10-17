# Profile audit: Compliance & Safeguarding Officer

Part 4 profile audit, 16–17 Oct 2026, branch `feat/platform-part-3`. Portal `/oakridge/compliance`, demo login
`compliance@schoolerp.com`. Considered: the compliance officer / designated safeguarding officer of a CBSE school, the
principal and trustees who read compliance, and HR (police verification).

## 1. The role in an Indian school

**Answers to** the principal and the managing committee/trust; is the school's contact for inspections.

| When | What |
|---|---|
| Continuous | Safeguarding concerns (POCSO: mandatory reporting, s.19/21); visitor and camera policy; incoming circulars from CBSE, the state and the district; personal-data requests and incidents. |
| Monthly / quarterly | Deadlines calendar (returns, renewals); training sessions (POCSO, POSH, fire safety, first aid, data protection); committee meetings (POCSO, ICC, safety, SMC); mock drills. |
| Yearly | CBSE mandatory public disclosure on the website (Appendix IX); renewal of fire safety, building safety, drinking water and health/sanitation certificates; UDISE+; POSH Internal Committee annual report; committee re-constitution; policy review and staff acknowledgement; police verification of new staff, drivers and attendants. |
| Data protection (DPDP Act 2023, Rules notified Nov 2025, phased to May 2027) | Verifiable parental consent for children's data; notices; respond to data-principal requests (access, correction, erasure, grievance, nomination); breach intimation to the Data Protection Board without delay and a detailed report within 72 hours; retention and erasure; a grievance officer. |

**Reports owed:** disclosure on the website, certificate status to CBSE, POSH annual report, UDISE+, training coverage,
committee composition (displayed on notice board and website), breach reports to the Board.

**Pain points:** certificates expiring unnoticed; committees constituted once and never reviewed; DPDP requests by email
with no clock; no breach register; inspection days spent assembling evidence.

Sources: CBSE affiliation extension letters restating the certificate conditions (fire, building, drinking water,
health and hygiene), CBSE safety circular (2017) as reported (POCSO committee, police verification, safety audits,
training, display of committees), DPDP Rules 2025 summaries (EY, Protiviti, ORF, IIT BHU summary, Lexplosion), POSH Act.

## 2. Competitors

| Capability | Entab / Fedena compliance add-ons | GRC tools (e.g. Zoho / generic) | International (Veracross, iSAMS safeguarding: CPOMS) | EduOS before | EduOS now |
|---|---|---|---|---|---|
| Obligations catalogue, returns, licences with expiry tasks | partial | ✓ | partial | ✓ | ✓ |
| Policies with versions and acknowledgement; trainings with coverage | partial | ✓ | ✓ | ✓ | ✓ |
| Regulatory notices from official sources | — | — | — | ✓ | ✓ |
| Safeguarding concerns (restricted) | — | — | ✓ (CPOMS) | ✓ | ✓ |
| Statutory committee register (POCSO, ICC, safety, SMC) | — | partial | — | — (POSH-IC as an obligation only) | ✓ members, dates, display, review task |
| DPDP data-principal request register with response clock | — | partial | GDPR SAR tools | — | ✓ |
| Breach register with 72-hour clock | — | partial | GDPR tools | — | ✓ |
| Evidence-backed readiness checklist | — | partial | — | — | ✓ certificates, committees, requests, breaches, training |
| Assistant | — | — | — | deadlines, licences (read), eco, visitors | + readiness, requests, breaches, committees, training coverage, schedule training |

## 3. Hands-on test (findings)

- Compliance Centre covers obligations, returns, licences, policies, trainings and notices well; there was no place for
  committees or for DPDP requests and breaches. **Built.**
- The officer could not see at a glance whether the CBSE certificates were on file and in date. **Built:** readiness
  checklist that matches licences by title and states what it found.
- The assistant could list deadlines and licences but not act on any compliance register. **Added** 11 tools.

## 4. What was built

**Data protection & committees** page `/compliance/data-protection` (also principal and admin), backend
`modules/compliance/privacy.service.js`, routes `/compliance/privacy/*`, models `PrivacyRequest`, `DataBreach`,
`StatutoryCommittee`.

- Readiness: certificates (fire, building, water, health and sanitation, affiliation), required committees (POCSO, ICC,
  safety, SMC, grievance; display check for POCSO/ICC/grievance), data requests in time, breaches within 72 h, training
  coverage by topic. States: OK / Soon / Action / Missing, each with what was found. "OK means a record exists and is in
  date; the officer decides."
- Data requests: kind, requester (parent for a child), received date, response date (30 days by default, configurable
  per request, max 90), task; identity verification required before completion; closing needs the outcome in words.
- Breaches: discovered at, data categories, people affected, children flag, containment; Board intimated / report sent /
  people informed timestamps (recorded by a person; nothing is sent); 72-hour clock with a CRITICAL task; closing needs
  the report recorded.
- Committees: members (name, role, phone, external), constituted, review due (default a year), last meeting, displayed
  on website / notice board; review date becomes a task with 30- and 7-day lead.

API: `GET /compliance/privacy/overview|readiness|committees` (`compliance.read`); `GET|POST /compliance/privacy/requests`,
`GET|PATCH /compliance/privacy/requests/:id`, `GET|POST /compliance/privacy/breaches`, `PATCH .../breaches/:id`,
`POST /compliance/privacy/committees`, `PATCH .../committees/:id` (`compliance.manage`).

Sample data: POCSO, ICC (review overdue) and safety committees (SMC missing, so the checklist shows a gap), three data
requests (one past its date, one completed), a closed breach with its timestamps.

## 5. Assistant coverage

New tools (`p4Compliance.js`, 11): `get_compliance_readiness`, `list_data_requests`, `log_data_request`,
`update_data_request`, `list_data_breaches`, `log_data_breach` (web-only), `update_data_breach` (web-only),
`list_statutory_committees`, `save_statutory_committee`, `get_training_coverage`, `schedule_compliance_training`
(web-only: invites everyone in the audience). Compliance catalogue: 68 → 82. HR and trustees (compliance.read) see the
checklist and committees, not the registers.

Not in chat on purpose: safeguarding case details (restricted), deciding a regulatory notice, approving a policy,
filing a return.

## 6. What remains, and why

- **Consent register for children's data** (verifiable parental consent per purpose): the DPDP children's-data rules
  commence in phases; the online admission form and photo-consent flags exist and should feed a consent ledger next.
- **Retention schedule and erasure workflow** across modules: needs per-module retention decisions.
- **Mandatory public disclosure page generator** exists (`documents.service.disclosureData`); linking it to the
  readiness checklist is a small follow-up.
- **Police-verification coverage** in the checklist: lives in HR verification; adding a line needs a read of that
  module's counts (permission `verification.read` is already held by the officer).
