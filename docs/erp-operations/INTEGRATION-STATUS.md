# Integration status — institution operations

Last updated 2026-10-17 (branch `feat/platform-part-4`). Nothing here talks to a government portal or a bank. Email, WhatsApp, SMS, ad platforms, social networks, cameras, GPS trackers and ID readers are **simulated until a provider is connected**: the work is recorded with an honest status and nothing is claimed as sent. The providers' adapters are built from their documented API shapes and have never been run against a live provider. Online fee payment uses a sandbox unless `PAYMENT_PROVIDER` is set to a gateway.

## Summary

| Integration | Status | What happens today | What is needed to go live |
|---|---|---|---|
| WhatsApp notifications (approvals, meetings, deadlines, notices) | **Simulated** until configured | The message is written to the outbox with status `SIMULATED` and logged. The person is always notified in the app as well. | See "WhatsApp" below. |
| Email for these notifications | **Built; simulated until configured** | Each notification can also go by email, with its own status in the outbox (`SIMULATED` while `EMAIL_PROVIDER=console`). People can turn email off. | Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`. |
| SMS for these notifications and OTP | **Not connected; simulated** | Not sent. OTP codes are logged and, in development, shown on the sign-in screen. | Choose a provider (not chosen yet) and set `SMS_PROVIDER`. |
| Online meetings (digital lectures) | **Built: Jitsi rooms; others by link** | A built-in room is a link on a Jitsi Meet server (default: the public meet.jit.si, where anyone holding the link can enter). Google Meet, Zoom and Teams are used by pasting the meeting's link. EduOS records who opened the link, not how long they stayed. | Set `JITSI_BASE_URL` to the institution's own Jitsi server to keep rooms private. A Google, Zoom or Microsoft integration would need their API keys and is not built. |
| Scheduled jobs (reminders, quiet-hours release, expiry checks, notice watching) | **Built** | The backend runs its own scheduler (`SCHEDULER_ENABLED`, on by default). Once a minute it runs whichever jobs are due for each active school: release held messages (every 15 minutes), expire lapsed clearances and send meeting reminders (hourly), and send correspondence and compliance deadline reminders and check watched notice pages (daily). Each job runs once per school per window even with several server processes, and each can still be triggered by hand. | Nothing. To run the jobs in one dedicated worker instead, set `SCHEDULER_ENABLED=false` on the other processes. |
| Government and board portals (UDISE+, AISHE, CBSE OASIS and list of candidates, state portals) | **No public API exists; print-ready documents instead** | Every return prints as an official document on letterhead, with a declaration and signature and seal blocks, marked DRAFT until approved. The principal prints, signs, stamps and files it, then records the acknowledgement. | Nothing, unless an authority publishes an API. See docs/research/board-submission-channels.md. |
| EPFO, ESIC, professional tax, TDS | **Simulated** (file export) | Payroll produces export files. Nothing is uploaded. | The school's accountant must check the formats against the current portal templates before first use. |
| Bank salary payment | **Simulated** (file export) | Payroll produces a bank file. A second person confirms payment from the bank statement. | The bank's own bulk-upload format; adjust the export to match. |
| Background verification agencies and police verification | **Not integrated** | Staff record each check's result and evidence by hand. | An agency contract and its API, if wanted. |
| Regulatory notice sources (board, government, district sites) | **Built, checked daily by the scheduler; not yet run against live sites** | For each source a school adds, the system fetches the page and detects that it changed. A person then reads it and records the notice. It does not interpret the notice. | Add the source addresses; run on a schedule; check each site permits automated fetching. |
| Social media and ad platforms | **Built; simulated until connected; not yet verified against live providers** | Meta, Google, LinkedIn and X connect by OAuth (Connectors and Social pages): live daily ad sync into campaign spend/leads, Meta lead-ads webhook, live posting to Facebook, Instagram, LinkedIn and X with post ids, links and engagement. Without the provider app configured or the school's account connected, ad figures come from CSV imports and posts are recorded as "Simulated — not posted". YouTube community posts have no API (marked not supported). | The platform administrator registers each provider app and sets its env variables; the school connects its accounts. See `INTEGRATIONS-SETUP.md`. |
| Camera events (class presence, safety) | **Simulated; pilot, off by default** | No camera or model is connected. Test events enter through `POST /camera/events`; every observation stays unverified until a person reviews it, and none appears in alerts or the campus map. | A camera vendor, a model evaluation plan and the school's decision to run the pilot. |
| Bus GPS | **Simulated** | `POST /fleet/telemetry` accepts signed device reports (HMAC, nonce, de-duplication); the repo's simulator feeds it. The parent's ETA is labelled an estimate. | Real trackers or a driver app that send signed reports. |
| ID card, gate and checkpoint readers (QR, RFID) | **Simulated** | Scans are entered by staff or sent by the simulator. Lost cards can be revoked. Scans only suggest attendance. | Reader hardware and its device keys. |
| AI model (drafts, report narrative, free-form assistant, newsletter AI) | **Not configured** | Drafts are template text labelled "Template draft (no AI key configured)". The assistant answers from built-in question matching. | An AI model key (`AI_PROVIDER` and its key). |
| Opportunities newsletter | **Built; email simulated** | Editions are built from a curated catalogue and sent through the same email channel, so they are `SIMULATED` until an email provider is set. Google Alerts feeds and AI extraction are not finished (work in progress). | An email provider; for Google Alerts, feeds created by hand in a Google account (Google Alerts has no API). |
| Digest of allowlisted feeds (RSS/Atom) | **Built; opt-in** | Fetched through an SSRF-safe fetcher from allowlisted sources only. | Add sources. |
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

The assistant is available in the web app (Ask EduOS) and, once WhatsApp is connected, over WhatsApp (simulation mode until then). It works through a catalogue of 470 tools (`docs/MCP-TOOLS.md`, generated; `docs/mcp-tools.json`): 243 read tools and 227 that create, change, delete or perform an action.

- **Per role.** The tools a person is offered are computed from their live permissions on every call and checked again at confirmation. An own-scope holder (a parent, a student, a teacher) is refused tools that reach beyond their own records. The catalogue has a permission matrix by role.
- **Reads** run at once and return the person's own, permitted data.
- **Writes need confirmation.** A write tool does not run on the first call: it returns a summary and a token, and runs only after the person approves in the same channel. Some calls are conditional (a dry run is not confirmed). Money, admission decisions, external messages, sensitive data and other people's records are the higher-risk classes.
- **It never decides.** It does not approve, reject, clear, check a payment, file with an authority or settle anything on its own. These are done by the person with authority, who confirms on the website. Safeguarding case contents, individual pay and the contents of background checks are not available to it.
- **Not exposed at all:** raw database access, arbitrary HTTP or shell, online payment execution, bulk messages to all parents and a few others (the "Blocked" section of the catalogue).
- **Gaps.** Some actions are still done by clicking on the website, not by asking; `MCP-AUTOMATION-GAPS.md` lists them.
- **AI model key.** Without one, the assistant answers by built-in question matching; with one, it understands freer phrasing. Drafts are template text without one.

## Trying it locally

`npm run demo -- --build` in `backend` (drop `-- --build` when the frontend has not changed) starts a throwaway in-memory database, seeds the fictional school, its people and sample data for every section, and serves the product at `http://localhost:3000/oakridge`. Staff sign in with `role@schoolerp.com` (for example `principal@schoolerp.com`) and the shared demo password `ChangeMe@123!` (the sign-in page itself offers an emailed OTP, shown on screen in the demo). Parents, students and alumni sign in by phone with an OTP shown on screen in development (student `+910000003001`, parent `+910000004001`, alumnus `+910000000033`). The same sample data can be added to a local development database with `npm run seed:school`, `npm run seed` and `npm run seed:operations`, in that order. All of it is fictional; nothing is filed, paid or sent.

## Local development on Windows

The frontend's server side now reaches the backend at `http://127.0.0.1:5000` by default. Before this, it used `localhost`, which Node resolves to IPv6 on Windows while the backend listens on IPv4, so sessions could not be renewed and people were signed out on reload. Set `API_URL` if your backend is elsewhere.
