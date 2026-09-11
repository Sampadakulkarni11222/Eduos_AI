# EduOS MCP — Staging Manual Test Plan

For a person validating the assistant on a **staging** deployment, on both
channels, before production is considered. The automated suites already
prove each of these paths against the in-memory test database
(`tests/mcp.readiness.e2e.test.js`, `tests/mcp.routing.test.js`,
`tests/mcp.confirmation.test.js`); this plan repeats them against real
infrastructure — a real database, a real browser, a real Meta test number.

---

## 0. Before anything — staging safety

Do not start staging until **every** line below is true. Stop at the first one
that is not.

| Check | How |
|---|---|
| `NODE_ENV=staging` | the deployment's environment |
| `MONGO_URI` points at the **staging** database (e.g. `…/eduos_staging`), never production | the deployment's environment |
| `MONGO_URI_ATLAS` is **unset** | the deployment's environment |
| `PRODUCTION_DB_HOSTS` lists the production cluster host(s) | so the startup guard can refuse them |
| `ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true` **only** if staging uses its own Atlas cluster | otherwise leave unset |
| `MEDICAL_ENCRYPTION_KEY` is a staging-only key; `PRODUCTION_MEDICAL_KEY_SHA256` is set so the difference is provable | never the production key |
| Preflight passes | `cd backend && NODE_ENV=staging node scripts/staging-preflight.js` — exits 0 and prints "All checks passed." It connects to nothing. |
| Boot log | `Connecting to MongoDB… (target=[credentials-redacted]…/eduos_staging …)`, `✔ MCP server ready → 137 ERP tools`, and the intended WhatsApp mode |
| Health | `GET /api/v1/health` → `200`, `data.database = "ok"` |

**Never** run `npm run dev` or `npm start` from a checkout whose `backend/.env`
has `MONGO_URI` pointing at production. The startup guard now refuses that
(outside production, a remote cluster needs an explicit opt-in and a host in
`PRODUCTION_DB_HOSTS` is always refused) — but the rule stands regardless.

If no staging database exists, do not create one from this plan: the required
configuration is in [MCP-PRODUCTION-READINESS.md §3](./MCP-PRODUCTION-READINESS.md#3-test--staging-database).

### Test accounts

On the staging database (seeded test data only): an **administrator**, a
**finance** user, a **class teacher** of a section containing a student named
**Rahul**, a **parent** of Rahul with a WhatsApp-capable phone, a **student**,
and a second teacher who does **not** teach Rahul's class. For the WhatsApp
column, each person's Account phone must be the number they message from.

### How to verify each step

- **MCP tool used** — the audit trail. Admin → Audit screen, or ask the assistant "show audit logs for agent actions", or query:
  `db.auditlogs.find({ 'after.via': 'MCP' }).sort({ createdAt: -1 }).limit(5)` — `action` is `agent.<tool>`, `after.status` is `READ` / `CONFIRMATION_REQUIRED` / `EXECUTED` / a refusal, `channel` is `WEB` or `WHATSAPP`.
- **Database** — the screen that shows the record, or the query given.
- **Response** — what the assistant said. It must never claim something happened that the audit does not show as `EXECUTED`.

---

## 1. Website (Ask EduOS panel)

| # | As | Say | Expected MCP tool | Expected response | Database / audit check |
|---|---|---|---|---|---|
| W1 READ | Admin | "Which students have pending fees?" | `get_pending_fees` | Count, invoices, total outstanding | Audit `agent.get_pending_fees` `READ`, `WEB`; no `EXECUTED` rows |
| W2 READ | Teacher (Rahul's class) | "Show Rahul's attendance." | `get_student_attendance` (args `studentName: "Rahul"`) | Rahul's percentage | Audit `READ`, actor = the teacher. **Then** as the second teacher: same question → "No student named "Rahul"…" and no percentage |
| W3 READ | Teacher | "What is my attendance?" | `get_attendance` | Says there is no personal attendance record — not the class's figures | Audit `agent.get_attendance` `READ` |
| W4 CREATE | Admin | "Create an announcement saying tomorrow is a holiday." | `create_announcement` | A confirmation card naming the text and audience; nothing published yet | Before confirming: no new announcement, audit `CONFIRMATION_REQUIRED`. Confirm → announcement visible on the Announcements screen, audit `EXECUTED`, `after.confirmed: true` |
| W5 UPDATE | Admin | "Change Rahul's address to 12 MG Road" | `update_student` | Card: `Update Rahul Sharma: address → "12 MG Road"` | Confirm → student record shows the new address; audit `before.address` / `after.state.address` |
| W5b UPDATE (refused) | Admin | "Update Rahul's phone number to 98…" | none / `update_student` refused | "phone" is not something this action accepts; lists what is | No proposal (`db.agentactions` unchanged), record unchanged |
| W6 ACTION | Teacher | "Mark Rahul absent." | `mark_attendance` | Card: `Rahul Sharma → ABSENT in <class>` | Cancel → register unchanged, proposal `REJECTED`. Ask again, confirm → register shows ABSENT; audit has register before/after |
| W7 FINANCE | Finance | "Record Rahul's payment." | `record_payment` | Asks for amount and invoice — records nothing | No Payment row, no proposal |
| W7b FINANCE | Finance | "Record a payment of ₹500 against invoice <Rahul's invoice no.> in cash" | `record_payment` | Card naming amount, mode, invoice | Confirm → payment exists **pending admin approval**; then as Admin: approve it (`approve_payment`) → published, invoice paid amount rises |
| W8 CONFIRMATION | Admin | "Send a WhatsApp message to Rahul's parent saying the bus is late" | `get_student_overview` (guardians) → `send_whatsapp_message` — **needs a configured model**; with `AI_PROVIDER=rules` the assistant says it is not sure | Card with the exact text and number, risk HIGH | Before confirming: nothing sent. Confirm → the parent's phone receives it once; audit `EXECUTED`, no access token in the entry. Press confirm twice quickly → still one message |
| W9 DELETE | Admin | "Delete the old document <title>" (a disposable test document) | `delete_document` — needs a model to find the id (`list_documents` first) | Card: `Permanently delete … "<title>" — this cannot be undone` | Confirm → document gone from Documents; audit `before` holds its title/type |
| W10 MULTI-STEP | Admin | "Find students with pending fees and prepare a reminder" | `get_pending_fees`, then — with a model — a **separate** proposal (`create_announcement` or `notify_users`) that must be confirmed | The list of students; any reminder appears as its own confirmation card | Nothing is sent or published without a confirmation. There is **no bulk WhatsApp** tool — if the assistant is asked to "WhatsApp all parents" it must say it cannot |
| W11 SCOPE | Parent | "Which students have pending fees?" | `get_pending_fees` | Only their own child | Audit actor = parent; result only their child's invoices |
| W12 REFUSAL | Teacher | "Record a payment of ₹500 against invoice …" | `record_payment` | "not authorized" | Audit `FORBIDDEN`; no proposal |

## 2. WhatsApp (Meta test number)

Same people, messaging the school's staging WhatsApp number from their own
phones. The path under test:
WhatsApp → signed webhook → phone → actor → school scope → shared agent →
MCP client → MCP server → tool → EduOS → reply.

| # | As | Message | Expected MCP tool (same as Website) | Check |
|---|---|---|---|---|
| A1 | Admin | "Which students have pending fees?" | `get_pending_fees` | Same figures as W1; audit `channel: WHATSAPP`, same tool name as W1 |
| A2 | Teacher | "Show Rahul's attendance." then "what is his attendance?" | `get_student_attendance` both times | Second reply is Rahul's again; audit `after.request.studentName: "Rahul"` on both |
| A3 | Admin | "Create an announcement saying tomorrow is a holiday." then **YES** | `create_announcement` | Reply asks for YES; nothing published until YES |
| A4 | Admin | "Change Rahul's address to 12 MG Road" then **NO**, then again and **YES** | `update_student` | NO leaves the record; YES changes it |
| A5 | Teacher | "Mark Rahul absent." then **YES** | `mark_attendance` | Register updated once; a second **YES** does nothing more |
| A6 | Finance | "Record a payment of ₹500 against invoice … in cash" then **YES** | `record_payment` | Payment pending approval |
| A7 | Admin | "Send a WhatsApp message to all parents." | none | Says there is no bulk send; nothing sent |
| A8 | Unknown number | "Who is absent today?" | none | "isn't registered"; no MCP audit entry at all |
| A9 | Second teacher | "Show Rahul's attendance." | `get_student_attendance` | "No student named "Rahul"…" — scope holds on WhatsApp as on the web |

**Same tool on both channels:** for A1–A6 and A9, compare the `action`
of the newest `WEB` and `WHATSAPP` audit entries for the same person — they
must be the same `agent.<tool>`.

## 3. Sign-off

| | Result | Tester | Date |
|---|---|---|---|
| Staging safety (§0) all true | | | |
| Website W1–W12 | | | |
| WhatsApp A1–A9 | | | |
| Same tool on both channels | | | |
| Nothing claimed that the audit does not show as EXECUTED | | | |

Any failure is a blocker for production. Record the audit entry (`_id`) with the failure.
