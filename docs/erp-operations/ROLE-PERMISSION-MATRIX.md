# Role and permission matrix — institution operations

Generated from `backend/src/constants/permissions.js` (the source of truth; roles are synced to the database on boot). It covers the 46 permission keys added for institution operations. Earlier keys (academics, fees, library and so on) are unchanged.

**A** = all records in the school. **O** = own records only. Blank = not granted.

Every API route checks its key on the server with `requirePermission`. The sidebar and pages use the same keys, so hiding a menu item is never the only protection. A school can change grants per role in Admin → Access Permissions, except the keys marked restricted.

| Permission | SA | Adm | Prin | Fin | HR | Mkt | Comp | Trus | Tch | Lib | Ward | Stu | Par | Alum |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `approvals.read` | A | A | A | A | O | O | O | O | O | O | O |  |  |  |
| `approvals.submit` | A | A | O | O | O | O | O |  | O | O | O |  |  |  |
| `approvals.decide` | A | A | A | A | A |  |  | O |  |  |  |  |  |  |
| `approvals.configure` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `governance.read` | A | A | A |  |  |  |  | O |  |  |  |  |  |  |
| `governance.manage` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `institution.read` | A | A | A | A | A | A | A | A | A | A | A | A | A | A |
| `institution.manage` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `org.read` | A | A | A | A | A | A | A | A | A | A | A |  |  |  |
| `org.manage` | A | A |  |  | A |  |  |  |  |  |  |  |  |  |
| `correspondence.read` | A | A | A |  |  |  | A |  |  |  |  |  |  |  |
| `correspondence.manage` | A | A |  |  |  |  |  |  |  |  |  |  |  |  |
| `compliance.read` | A | A | A |  | A |  | A | A |  |  |  |  |  |  |
| `compliance.manage` | A | A |  |  |  |  | A |  |  |  |  |  |  |  |
| `contracts.read` | A | A | A | A |  |  | A |  |  |  |  |  |  |  |
| `contracts.manage` | A | A |  |  |  |  |  |  |  |  |  |  |  |  |
| `verification.read` | A | A | A | A | A |  | A |  |  |  |  |  |  |  |
| `verification.manage` | A | A |  |  | A |  |  |  |  |  |  |  |  |  |
| `verification.decide` † | A |  | A |  |  |  |  |  |  |  |  |  |  |  |
| `events.read` | A | A | A | A | A | A | A |  | A | A | A |  |  |  |
| `events.manage` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `facilities.read` | A | A | A | A | A | A | A |  | A | A | A |  |  |  |
| `facilities.request` | A | A | A | O | O | O | O |  | O | O | O |  |  |  |
| `facilities.manage` | A | A |  |  |  |  |  |  |  |  |  |  |  |  |
| `safeguarding.report` | A | A | O | O | O | O | O |  | O | O | O | O | O | O |
| `safeguarding.manage` † |  |  |  |  |  |  | A |  |  |  |  |  |  |  |
| `payroll.read` | A | A | A | A | A | O | O |  | O | O | O |  |  |  |
| `payroll.prepare` | A | A |  | A | A |  |  |  |  |  |  |  |  |  |
| `payroll.approve` † | A |  | A |  |  |  |  |  |  |  |  |  |  |  |
| `payroll.sensitive.read` † |  |  |  | A | A |  |  |  |  |  |  |  |  |  |
| `procurement.read` | A | A | A | A | O | O | O |  | O | O | O |  |  |  |
| `procurement.request` | A | A | O | O | O | O | O |  | O | O | O |  |  |  |
| `procurement.manage` | A | A |  | A |  |  |  |  |  |  |  |  |  |  |
| `budget.read` | A | A | A | A |  |  |  | A |  |  |  |  |  |  |
| `budget.manage` | A | A |  | A |  |  |  |  |  |  |  |  |  |  |
| `funding.read` | A | A | A | A |  |  |  | A |  |  |  |  |  |  |
| `funding.manage` | A | A |  | A |  |  |  |  |  |  |  |  |  |  |
| `marketing.read` | A | A | A |  |  | A |  |  |  |  |  |  |  |  |
| `marketing.manage` | A | A |  |  |  | A |  |  |  |  |  |  |  |  |
| `community.read` | A | A | A | A | A | A | A | A | A | A | A | O | O | O |
| `community.post` | A | A | A | O | O | O | O |  | O | O | O | O |  | O |
| `community.moderate` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `mentoring.participate` | A | A |  |  |  |  |  |  |  |  |  | O |  | O |
| `campus.map.read` | A | A | A | A | A | A | A | O | A | A | A | O | O | O |
| `messaging.read` | A | A | A |  |  |  |  |  |  |  |  |  |  |  |
| `messaging.manage` | A | A |  |  |  |  |  |  |  |  |  |  |  |  |

† Restricted by default: `payroll.approve`, `payroll.sensitive.read`, `safeguarding.manage`, `verification.decide`. These are not given to the school administrator automatically; each must be granted on purpose to a named role.

## Role key

- **SA** — Super Admin: Platform administrator — manages schools and their School Admin accounts
- **Adm** — Administrator: Manages day-to-day school operations
- **Prin** — Principal: Oversight across the whole school
- **Fin** — Finance: Manages fees and payments
- **HR** — HR & Payroll: Recruitment, staff records, verification and payroll preparation
- **Mkt** — Marketing & Admissions: Campaigns, creative assets, enquiries, counselling and enrolment
- **Comp** — Compliance & Safeguarding Officer: Designated officer for safeguarding, statutory compliance, policies and training
- **Trus** — Trustee / Governing Body Member: Governance: meetings, resolutions, board-level approvals and institution health
- **Tch** — Teacher: Manages their own classes
- **Lib** — Librarian: Manages the school library catalog and lending
- **Ward** — Warden: Manages hostel facilities and student welfare
- **Stu** — Student: Views their own records
- **Par** — Parent: Views their own children's records
- **Alum** — Alumnus: Verified former student: newsroom, alumni circles and mentoring

## Separation of duties enforced in code

- Nobody can approve a request they raised (maker-checker), or one where they have declared a conflict.
- Payroll payment must be confirmed by a different person from the one who prepared the run.
- The principal makes the final background-verification decision (`verification.decide`); the administration team can only prepare the checks.
- Safeguarding case details are open only to holders of `safeguarding.manage`. Even the platform super admin does not hold it.
- Salary and bank details need `payroll.sensitive.read`.
- Request bodies for safeguarding, verification and payroll routes are withheld from the audit log.
