# Integration status — institution operations

Last updated 2026-10-13. Nothing in this branch talks to a government portal, a bank or a payment system. The only outside service the new code can call is WhatsApp, and only when it is configured.

## Summary

| Integration | Status | What happens today | What is needed to go live |
|---|---|---|---|
| WhatsApp notifications (approvals, meetings, deadlines, notices) | **Simulated** until configured | The message is written to the outbox with status `SIMULATED` and logged. The person is always notified in the app as well. | See "WhatsApp" below. |
| Email for these notifications | **Built; simulated until configured** | Each notification can also go by email, with its own status in the outbox (`SIMULATED` while `EMAIL_PROVIDER=console`). People can turn email off. | Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`. |
| SMS for these notifications | **Planned** | Not sent. | Choose a provider and add a sender. |
| Online meetings (digital lectures) | **Built: Jitsi rooms; others by link** | A built-in room is a link on a Jitsi Meet server (default: the public meet.jit.si, where anyone holding the link can enter). Google Meet, Zoom and Teams are used by pasting the meeting's link. EduOS records who opened the link, not how long they stayed. | Set `JITSI_BASE_URL` to the institution's own Jitsi server to keep rooms private. A Google, Zoom or Microsoft integration would need their API keys and is not built. |
| Scheduled jobs (reminders, quiet-hours release, expiry checks, notice watching) | **Built** | The backend runs its own scheduler (`SCHEDULER_ENABLED`, on by default). Once a minute it runs whichever jobs are due for each active school: release held messages (every 15 minutes), expire lapsed clearances and send meeting reminders (hourly), and send correspondence and compliance deadline reminders and check watched notice pages (daily). Each job runs once per school per window even with several server processes, and each can still be triggered by hand. | Nothing. To run the jobs in one dedicated worker instead, set `SCHEDULER_ENABLED=false` on the other processes. |
| Government and board portals (UDISE+, AISHE, CBSE OASIS and list of candidates, state portals) | **No public API exists; print-ready documents instead** | Every return prints as an official document on letterhead, with a declaration and signature and seal blocks, marked DRAFT until approved. The principal prints, signs, stamps and files it, then records the acknowledgement. | Nothing, unless an authority publishes an API. See docs/research/board-submission-channels.md. |
| EPFO, ESIC, professional tax, TDS | **Simulated** (file export) | Payroll produces export files. Nothing is uploaded. | The school's accountant must check the formats against the current portal templates before first use. |
| Bank salary payment | **Simulated** (file export) | Payroll produces a bank file. A second person confirms payment from the bank statement. | The bank's own bulk-upload format; adjust the export to match. |
| Background verification agencies and police verification | **Not integrated** | Staff record each check's result and evidence by hand. | An agency contract and its API, if wanted. |
| Regulatory notice sources (board, government, district sites) | **Built, checked daily by the scheduler; not yet run against live sites** | For each source a school adds, the system fetches the page and detects that it changed. A person then reads it and records the notice. It does not interpret the notice. | Add the source addresses; run on a schedule; check each site permits automated fetching. |
| Social media and ad platforms | **Planned** | Creative is stored and approved in the system, then posted by hand. | Platform accounts and their APIs. |
| File uploads | **Existing** | Uses the upload service already in the platform. | Nothing new. |

## WhatsApp

A message is really sent only when all of these are true:

1. The platform's existing WhatsApp settings are in place (`WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, as described in `docs/WHATSAPP-CHATFLOW.md`).
2. The template for that message is approved by Meta and its name is set in the environment:

   | Variable | Used for |
   |---|---|
   | `WA_TEMPLATE_APPROVAL_PENDING` | A decision is waiting on you |
   | `WA_TEMPLATE_APPROVAL_DECIDED` | Your request was decided |
   | `WA_TEMPLATE_MEETING_SCHEDULED` | A board or committee meeting was scheduled |
   | `WA_TEMPLATE_MEETING_REMINDER` | Meeting reminder or agenda |
   | `WA_TEMPLATE_MEETING_MINUTES` | Minutes are available |
   | `WA_TEMPLATE_DEADLINE_REMINDER` | A reply or return is due |
   | `WA_TEMPLATE_GENERAL_NOTICE` | General notice |

3. The recipient has a phone number and has opted in to WhatsApp (Policies & Trainings page).
4. It is outside quiet hours (21:00–07:00 India time), unless the message is urgent.

Otherwise the outbox row says exactly why: `SIMULATED`, `SKIPPED_NO_CONTACT`, `SKIPPED_NO_CONSENT`, `SKIPPED_TEMPLATE_NOT_CONFIGURED`, `DEFERRED` or `FAILED`. Delivery receipts from the provider only ever move a status forward.

No live WhatsApp message was sent while building or testing this branch.

## Secrets

Safeguarding case details are encrypted with the platform's existing field-encryption key (`MEDICAL_ENCRYPTION_KEY`). Use a strong, unique value in production and keep it backed up: losing it makes those records unreadable.

## AI assistant (Ask Agent)

The assistant has sixteen read-only tools for the new modules and is available to every school role, including HR, marketing, compliance, trustees and alumni. It can report what is waiting on a person, approvals in their inbox, compliance deadlines and licences, open letters, board meetings, fests, repairs, purchase requests, budgets, payroll run totals, the admissions funnel, the organisation in numbers, newsroom posts and the campus right now.

It cannot approve, file, pay, clear or decide anything in these modules, and it has no access to safeguarding cases, individual pay or the contents of background checks. Without an AI model key it answers from built-in question matching; with one, it understands freer phrasing. The full list is in `docs/MCP-TOOLS.md`.

## Trying it locally

`npm run demo` in `backend` starts a throwaway in-memory database, seeds the fictional school, its people and sample data for every section, and serves the product at `http://localhost:3000/oakridge` (add `-- --build` after changing the frontend). The same sample data can be added to a local development database with `npm run seed:school`, `npm run seed` and `npm run seed:operations`, in that order. All of it is fictional; nothing is filed, paid or sent.

## Local development on Windows

The frontend's server side now reaches the backend at `http://127.0.0.1:5000` by default. Before this, it used `localhost`, which Node resolves to IPv6 on Windows while the backend listens on IPv4, so sessions could not be renewed and people were signed out on reload. Set `API_URL` if your backend is elsewhere.
