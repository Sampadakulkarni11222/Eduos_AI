# Can EduOS submit to boards and government directly?

Researched 2026-10-13 by web search. Short answer: **no public API was found for any of the filings a school or college makes**, so EduOS prepares print-ready documents and a person files them. This note records what was looked for and what was found, so the question can be reopened if an authority publishes an API.

| Authority and filing | How schools submit today (as found) | Public API for a school's software? | What EduOS does |
|---|---|---|---|
| Ministry of Education, **UDISE+** (school profile, enrolment, staff, infrastructure) and **SDMS** (student records) | Through the UDISE+ portal; an Excel template for bulk student upload is reported. Some states (for example Tamil Nadu and West Bengal) run their own systems and pass data on to UDISE+. | None found. Integration appears to run through state systems, not schools. | Builds the figures from records, flags gaps, prints the document; CSV export for re-keying or upload. |
| **CBSE** (OASIS school data, list of candidates for class 10 and 12, registration for class 9 and 11) | Online through CBSE's own portals; offline submission is not accepted for the list of candidates, and there is no correction window after upload. | None found. | Prints the list of candidates with the details boards ask for and flags missing data before anyone uploads it. |
| **CISCE** and **state boards** | Their own portals and forms. | None found. | Same as CBSE. |
| **AISHE** (higher education survey) | Through the AISHE portal. | None found. | Builds the institution profile figures and prints them. |
| **APAAR / Academic Bank of Credits / DigiLocker (NAD)** | Institutions are onboarded as issuers; APIs exist through API Setu and DigiLocker. | Yes, but for creating and verifying a student's academic ID and issuing credentials, not for filing returns. Onboarding goes through the government's own process. | Not integrated. Planned only if the institution is onboarded as an issuer and wants credentials pushed from EduOS. |
| **CBSE mandatory public disclosure** | Published on the school's own website in the board's format. | Not applicable. | Drafts the disclosure from the profile, licences and facilities, and lists what EduOS cannot fill (results, fees, staff qualifications). |

## What was built instead

- Every regulatory return prints as an official document: letterhead with affiliation number and UDISE+/AISHE codes, reference number, date, addressee, the figures with where they came from, a declaration, and signature blocks for the preparer, the verifier and the principal with the institution's seal.
- A return prints with a **DRAFT** mark until it is approved for submission, and with a warning mark if it still has unresolved errors. Each export is recorded on the return.
- Outgoing letters and replies print the same way, on letterhead, for the principal to sign.
- After filing, the person records the acknowledgement number in the Compliance Centre; a return cannot be marked submitted without it.

## Sources

- UDISE+ bulk upload and SDMS: https://educationforallinindia.com/?p=19129 (secondary source)
- State systems feeding UDISE+: https://journalsofindia.com/unified-district-information-on-school-education-udise/?print=pdf (secondary source)
- CBSE list of candidates, online only, no correction window: https://www.adda247.com/school/cbse-loc-submission-for-class-10-12/ and https://www.cbse.gov.in/cbsenew/list-of-circulars-related-to-student/Final%20loc%202020.pdf
- API Setu education use cases: https://docs.apisetu.gov.in/document-central/explore-apisetu/Use%20Cases.html
- APAAR and ABC: https://www.pib.gov.in/FactsheetDetails.aspx?id=150693

Confidence: medium. Absence of a public API is hard to prove; an authority may offer integration to state systems or large vendors on request. Ask the state MIS office or the board's IT helpdesk before relying on this.
