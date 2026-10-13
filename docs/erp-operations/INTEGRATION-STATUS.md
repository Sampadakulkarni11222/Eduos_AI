# Integration status — institution operations

Last updated 2026-10-13. Nothing in this branch talks to a government portal, a bank or a payment system. The only outside service the new code can call is WhatsApp, and only when it is configured.

## Summary

| Integration | Status | What happens today | What is needed to go live |
|---|---|---|---|
| WhatsApp notifications (approvals, meetings, deadlines, notices) | **Simulated** until configured | The message is written to the outbox with status `SIMULATED` and logged. The person is always notified in the app as well. | See "WhatsApp" below. |
| SMS and email for these notifications | **Planned** | The outbox can hold SMS and email rows, but no sender is connected for them. | Choose a provider and add a sender. |
| Scheduled jobs (reminders, quiet-hours release, expiry checks, notice watching) | **Blocked on deployment choice** | There is no scheduler in the app. Each job has a route that does it once and is safe to repeat: correspondence reminders (`POST /correspondence/reminders/run`) and releasing messages held for quiet hours (`POST /messaging/outbox/release`, which re-checks consent before sending). Until something calls them on a timer, they run only when an administrator triggers them. | A scheduler (cron, a cloud scheduler or a worker) calling those routes. |
| Government and board portals (UDISE+, AISHE, CBSE OASIS, state portals) | **Not integrated, by design** | The system prepares the data and a person files it on the portal, then records the acknowledgement number and proof. A return cannot be marked submitted without that evidence. | These portals offer no general filing API to schools. Keep manual. |
| EPFO, ESIC, professional tax, TDS | **Simulated** (file export) | Payroll produces export files. Nothing is uploaded. | The school's accountant must check the formats against the current portal templates before first use. |
| Bank salary payment | **Simulated** (file export) | Payroll produces a bank file. A second person confirms payment from the bank statement. | The bank's own bulk-upload format; adjust the export to match. |
| Background verification agencies and police verification | **Not integrated** | Staff record each check's result and evidence by hand. | An agency contract and its API, if wanted. |
| Regulatory notice sources (board, government, district sites) | **Built, not run against live sites** | For each source a school adds, the system fetches the page and detects that it changed. A person then reads it and records the notice. It does not interpret the notice. | Add the source addresses; run on a schedule; check each site permits automated fetching. |
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
