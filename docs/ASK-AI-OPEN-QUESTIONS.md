# Ask AI — requirements findings and open questions

Two access questions were raised during Ask AI QA (BUG-002 and BUG-007). This
records what the codebase itself says about each, what Ask AI does as a
result, and the one decision that is still a product owner's to make. Nothing
here changes a permission.

## 1. Teacher access to medical records — CLEAR, implemented as designed

**Finding: a class teacher may READ the medical record of a student in a
section they are class teacher of. Nobody else on the teaching staff may, and
no teacher may edit one.**

| Evidence | Where |
|---|---|
| The role matrix grants `medical.read` at `OWN` scope to TEACHER, with the comment "Read-only — allergy/emergency-contact visibility for a teacher's own students; `medical.manage` stays parent/admin-only." | `backend/src/constants/permissions.js` (TEACHER grants) |
| The service narrows `OWN` for a teacher to students whose section's `classTeacherId` is that teacher. A subject teacher of the same class is refused. | `backend/src/modules/medical/medical.service.js` → `assertCanAccess` |
| The website has a teacher screen for it. | `frontend/src/app/[school]/teacher/medical/page.tsx` |
| Ask AI goes through the same service; a student outside the teacher's class is answered exactly like one who does not exist, and every read is audited. | `backend/tests/askAi.securityDefects.test.js` |

The QA report that "a teacher can see medical information" (BUG-002) is
therefore the approved behaviour, not a leak, **provided the teacher is the
student's class teacher**. If the school's policy is that teachers must see no
medical data at all, that is a change to the role matrix (remove
`medical.read` from TEACHER), and the teacher medical screen goes with it.

## 2. Parent leave — applying is CLEAR (not supported); viewing is AMBIGUOUS

### 2a. A parent applying for leave — clear: not supported

| Evidence | Where |
|---|---|
| `leave.apply` is granted to STUDENT only. PARENT is not granted it. | `backend/src/constants/permissions.js` |
| `POST /leave/apply` requires `leave.apply`, and files the leave against the **caller's own** enrolment. A parent has no enrolment. | `backend/src/modules/leave/leave.routes.js`, `leave.service.js` → `apply` |
| The website has no parent leave screen. | `frontend/src/app/[school]/parent/` has no `leave` directory |

Ask AI therefore declines, and says why: "Applying for leave isn't enabled for
your account — in this school's setup a leave application is made from the
student's own account, or through the school office." It does this for the
request on its own and inside a joined sentence, without calling any tool.

The same applies to staff: there is no staff-leave module. A teacher asking to
apply is told that a leave application in EduOS is a student's, that staff
leave is not handled here, and that they can review their students' requests.

### 2b. A parent VIEWING their child's leave — ambiguous, decision needed

PARENT holds `leave.read` at `OWN` scope, but nothing serves it:

- `GET /leave/mine` resolves the caller's **own** enrolment
  (`resolveOwnActiveEnrollmentId`), which a parent does not have.
- `GET /leave` (the review list) is refused for every scoped role except
  TEACHER.
- There is no parent leave page.

So the grant exists and cannot be used, on the website or in Ask AI. Either it
is a leftover, or a "my child's leave requests" view was intended and never
built. The code cannot say which.

**Decision required (product owner):**

1. Should a parent be able to **see** their child's leave applications and
   their status? If yes: `listMine` needs a guardian branch (the child's
   enrolments, via the existing guardian link), a parent screen, and the Ask AI
   capability follows from the service. If no: remove `leave.read` from PARENT
   so the matrix says what the product does.
2. Should a parent be able to **apply** on a child's behalf? That is a new
   permission grant and a new rule about whose enrolment the leave is filed
   against — it is not implied by anything in the current code, so it has not
   been added.

Until that is decided, Ask AI keeps the secure reading: a parent can neither
apply for nor list leave.

## 3. External configuration that code cannot settle

**The second, unrelated reply on WhatsApp** (the "Samsung / iPhone" answer in
the QA screenshot). That text is not in this repository, and EduOS sends
exactly one reply per inbound message (asserted in
`backend/tests/askAi.writeWorkflows.channels.test.js`). By elimination it is
the Chatflow-Pro workspace's own AI agent / auto-reply answering the same
message in parallel. It has to be switched off in the Chatflow-Pro dashboard;
see "Troubleshooting" in [WHATSAPP-CHATFLOW.md](./WHATSAPP-CHATFLOW.md).
`npm run chatflow:check` reports automation flags where Chatflow's API exposes
them. This has **not** been verified against the live workspace.

**The school's timezone.** "Today", "tomorrow" and "my next class" are read
from the server's local clock. Set `SCHOOL_TIMEZONE=Asia/Kolkata` (or `TZ`) in
the deployment environment; a host left on UTC is 5h30m behind.

## 4. What the automated tests do and do not cover

Covered, with a scripted model and signed webhooks, no network
(`backend/tests/askAi.modelPath.test.js`, `askAi.*.test.js`, `mcp.e2e.test.js`,
`whatsapp.*.test.js`): routing, MCP authorization and validation, confirmation
and cancellation, conversation state, duplicate-delivery and duplicate-write
prevention, on both channels.

**Not covered by any automated test, and not claimed:** the behaviour of a
live language model (OpenAI / Gemini) on real phrasing, and actual message
delivery through Meta or Chatflow-Pro. Those need a staging run with real
credentials.
