# Automation audit (Part 7)

What each role does by hand on a fixed rhythm, whether EduOS now does it for them, and how. "Automated now" means it
happens without anybody pressing a button; anything that would write a record for someone is a **draft** that the person
confirms, and every message goes through the operational outbox (WhatsApp only with the recipient's opt-in and outside
their quiet hours; **Simulated** when no provider is configured; the in-app copy always goes).

Legend: **AUTO**: scheduled or event-driven. **AUTO (draft)**: prepared automatically and confirmed by a person.
**SEMI**: one click or one Ask AI request, confirmed. **MANUAL**: still done by hand. **NEW** marks something built in Part 7.

Where to switch things: **Automations** page (every portal, `/<portal>/automations`). The school's automations are switched
on or off there, with their hour, weekday, audience and a preview of the message. Ask AI can do the same: "turn on fee
reminders", "show the school automations", "remind me every Friday to submit lesson plans", "show my reminders",
"stop the Friday reminder", "what needs me today".

## Rules every automation follows

| Rule | How |
|---|---|
| Switch per school | `AutomationSetting` (one row per automation, catalogue default until the school chooses). The module's own feature switch also applies (a school without the health room gets no health automations). |
| Once per day / week | `runOnce()` claims `automation:<key>:<school>:<date>` in `AutomationRun` (unique). Every message, task and draft also has its own idempotency key, so a retried tick or a manager's "Run now" repeats nothing. |
| Quiet hours | No school automation runs between 21:00 and 07:00 school time; hours can only be set from 07:00 to 20:00. The outbox still applies each person's own quiet hours to WhatsApp (held, then released in the morning). |
| Consent | WhatsApp only to people who opted in (`ContactPreference`); weekly child digest and birthday greetings also need an opt-in for that automation (`AutomationOptIn`). Family-facing automations (fees, library) default to off. |
| Scoping | Jobs run inside one school's tenant context; reads made for a person (briefing, reports, follow-up queue) are made **as that person** (`actorFromProfile`), so they see only what they may see. Health data never appears in a message or task title (reference numbers only). |
| No decisions | Cover is suggested, never assigned; a purchase request is only a DRAFT after the nurse confirms, and still goes for approval. |

## Role by role

### Teacher

| Task | Rhythm | Before Part 7 | Automated now |
|---|---|---|---|
| Take the day register | Daily | Manual; a "sections not marked" KPI for leadership only | **AUTO NEW**: class teacher nudged at 10:00 (setting) on school days if no marks; principal gets one list of still-unmarked classes two hours later (`attendanceRegisterNudge`). |
| Tell parents of absentees | Daily | AUTO (event): `notifyGuardiansOfAbsence` after the register is saved | AUTO (unchanged). Ask AI after an absentee list offers "Message their parents" (chip). |
| Homework reminders to students | Daily | Manual | **AUTO NEW**: students with homework due tomorrow and not submitted reminded at 17:00 (`homeworkDueReminders`); parents can be added as an audience. |
| Submit lesson plans / weekly chores | Weekly | Manual (memory) | **SEMI NEW**: personal reminder in Ask AI ("remind me every Friday at 4 pm to submit lesson plans"), confirmed once, then AUTO. |
| PTM reminders and follow-ups | Per PTM | AUTO: day-before and hour-before reminders; follow-up tasks from outcomes | AUTO (unchanged). |
| Report-card readiness per class | Term | Manual ("papers still unmarked" readable in Ask AI) | MANUAL. Listed below as a larger gap. |
| What needs me today | Daily | Today page (teachers had tasks only) | **AUTO NEW**: "what needs me today" in Ask AI and on the Automations page: tasks, unmarked registers, drafts, reminders. |

### Principal / head

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Morning briefing | Daily | Pull only (Today page, `get_my_day`) | **AUTO NEW**: at 07:00 on school days, in the app and by email: decisions waiting, tasks (overdue), deadlines (`principalDailyBriefing`, read as the principal). |
| Chase unmarked registers | Daily | Manual from the KPI | **AUTO NEW**: escalation list at nudge hour + 2. |
| Arrange cover for absent teachers | Daily | SEMI: cover screen / `suggest_cover_teachers` | **AUTO (draft) NEW**: at 07:00 a draft per absent teacher with the best free substitute per period; Confirm assigns them through the cover service (`staffCoverSuggestions`). |
| Absent staff list | Daily | Manual | **SEMI NEW**: "every morning send me the list of absent staff" (personal report). |
| Pending approvals | Daily | Approvals page | **SEMI NEW**: personal report "Approvals waiting on me"; chip after `get_pending_items_for_me`. |
| Switch school automations | As needed | Not possible | **NEW**: Automations page or Ask AI (confirmed on the website; `settings.manage` or `institution.manage`). |

### Administrator

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Licence, insurance, AMC, agreement renewals | Daily/annual | AUTO: `bills.due` + `syncRenewals`, `compliance.reminders` | AUTO (unchanged). |
| Vehicle documents and checks | Per vehicle | AUTO: tasks on save (`vehicle:<id>:doc:*`) | AUTO (unchanged). |
| Lab expiries, calibrations, reorder | Daily | AUTO: `labs.due` tasks; reorder is a one-click draft | AUTO tasks (unchanged); SEMI reorder. |
| Quiet-hour messages | Every 15 min | AUTO: `messaging.release` | AUTO (unchanged). |
| Daily briefing | Daily | Pull only | **AUTO NEW** if added to the audience. |
| Run an automation now | As needed | n/a | **NEW**: "Run now" on the Automations page (idempotent). |

### Finance office

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Fee due / overdue reminders | Daily / weekly | SEMI: `send_fee_reminders` (confirmed) | **AUTO NEW (off by default)**: 3 days before due, 1 day overdue, 15 days overdue: once per invoice per stage (`feeReminders`). |
| Escalate long-overdue fees | Monthly | Manual | **AUTO NEW**: at 15 days overdue a HIGH task for the finance office (`automation:fee:<invoice>:followup`). |
| Overdue fees summary | Weekly | Manual | **SEMI NEW**: "every Monday at 9 send me the overdue fees" (personal report). |

### Parent

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Know my child was absent | Daily | AUTO (event) | AUTO (unchanged). |
| Weekly picture of each child | Weekly | Manual (open each page) | **AUTO NEW (opt-in)**: Friday 17:00: days present, homework due next week, whether a fee is due (`weeklyParentDigest`). "Send me a weekly summary of my child" in Ask AI opts in. |
| Fee due reminders | Monthly | Only when the office sent them | AUTO if the school switches `feeReminders` on. |
| Personal reminders (pay the bus fee, sign the diary) | Any | n/a | **SEMI NEW**: Ask AI or WhatsApp ("remind me on the 5th of every month to pay the bus fee"). |
| What needs me today | Daily | Family page | **NEW**: each child's homework and fees in "what needs me today". |

### Student

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Homework due tomorrow | Daily | Manual | **AUTO NEW** (`homeworkDueReminders`). |
| Library book overdue | Daily | SEMI (librarian's button) | AUTO if the school switches `libraryOverdueDaily` on. |
| Birthday greeting | Yearly | None | **AUTO NEW (opt-in, off by default)**: in the app only (`birthdayGreetings`). |
| Personal reminders | Any | n/a | **SEMI NEW** ("remind me tomorrow at 6 pm to finish my homework", offered as a chip after homework). |

### Librarian

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Overdue reminders | Daily | SEMI: `send_library_overdue_reminders` | **AUTO NEW (off by default)**: the same routine, daily at 09:00 (`libraryOverdueDaily`). |
| Expired holds | Hourly | AUTO: `library.holds.expire` | AUTO (unchanged). |
| Overdue summary | Daily | Desk briefing | **SEMI NEW**: personal report "Overdue library books". |

### Nurse

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Follow up a child sent home or referred | Per visit | Manual | **AUTO NEW**: next-day task with the visit reference only (`healthVisitFollowups`). |
| Restock low first-aid / medicines | Weekly | Low flag only | **AUTO (draft) NEW**: Monday draft listing items at reorder level with a suggested quantity; Confirm creates a DRAFT purchase request (`lowStockPurchaseDrafts`). |
| Expiring medicines | Per batch | AUTO: expiry task on stock save | AUTO (unchanged). |

### Admissions / marketing

| Task | Rhythm | Before | Automated now |
|---|---|---|---|
| Follow up enquiries | Daily | SEMI: follow-up queue | **AUTO NEW**: each counsellor told at 09:00 how many are overdue, due today, never contacted (`admissionsFollowupReminder`, read as them). |
| Ad metrics sync | 6-hourly | AUTO (when connected) | AUTO (unchanged). |

### Transport, warden, HR, compliance, alumni

| Role | Task | Before | Automated now |
|---|---|---|---|
| Transport | Bus delay alerts | AUTO to the transport office (`fleet.alerts`); parents only on cancel / no-show / return | Unchanged. **Gap**: delay alerts to the families on the bus (below). |
| Warden | Late out-pass returns, night roll | AUTO (`hostel.outpass.late`) | Unchanged. |
| HR | Leave decided | AUTO message on decision | Cover suggestions now drafted (above). |
| Compliance | Deadlines, notices, licences | AUTO (`compliance.reminders`, `compliance.notices`) | Unchanged. |
| Alumni office | Event invites | AUTO in-app on creation | Unchanged. **Gap**: reminders and outbox delivery (below). |
| Everyone | Own reminders and scheduled reports | n/a | **NEW**, in Ask AI and on the Automations page. |

## Ask AI (Part 7)

| Capability | How |
|---|---|
| Suggested next steps | After an answer the assistant may add up to three chips that fit it (after absentees: "Message their parents", "Students with low attendance", "Send me this every morning"; after overdue books: "Send reminders" …). Only for capabilities the person holds; never on a draft, a refusal or a question back. Tapping sends the question; a write still comes back as a draft. |
| What needs me today | `get_what_needs_me_today` for any role; also the first suggested question in an empty chat. |
| Natural-language automation | `create_my_reminder` (reminders and reports, read from words: every Friday / every weekday / every morning / on the 5th of every month / tomorrow at 3 pm), `list_my_reminders`, `stop_my_reminder` ("stop the Friday reminder", "reminder 2", "all"). Reports re-check the owner's permission at every send and stop if it is gone. |
| School automations | `list_school_automations` (with message preview), `set_school_automation` (website only: affects others). |
| Drafts and opt-ins | `list_automation_drafts`, `confirm_automation_draft` (website only), `dismiss_automation_draft`, `set_my_automation_optin`. |

## Small fixes made while auditing

- The empty assistant suggested no way to ask "what needs me today"; it is now the first suggestion for every role.
- Low health-room stock was only a flag; it now produces a purchase draft each week.
- The "sections not marked" figure had no follow-up; the class teacher is now nudged and the principal escalated.
- A follow-up with no schedule ("remind me to …") is asked "When?", and the answer finishes the reminder.

## Larger gaps (not built; proposed next)

1. **Report-card readiness checklist per class**: N days before the term's report date, a per-class list (marks entered per subject, co-scholastic grades, remarks, moderation) as a task for the class teacher and a summary for the principal. Needs a term report date and a readiness query over `reportcards` + marks.
2. **Exam timetable → seating and invigilation drafts**: no seating or invigilation model exists (`modules/seats` is licence seats). Needs rooms with capacity, an invigilation duty model and a draft generator (one draft per exam day).
3. **Bus delay alerts to families on that trip**: `fleet.alerts` raises `TRIP_DELAY` to the transport office only. Sending `TRIP_UPDATE` to the guardians of riders on a delayed trip (consented channel, once per trip per threshold) needs a rider list per trip and a delay threshold setting.
4. **Alumni event reminders through the outbox**: invites are in-app only with no reminder; a day-before reminder through `sendOperational` with alumni consent.
5. **Staff birthdays / work anniversaries**: staff have no date of birth or joining date on the profile; add the fields (opt-in) before greeting staff.
6. **Admissions follow-ups to families**: the counsellor is now reminded; messaging the family automatically should stay a confirmed draft per enquiry (contact consent is per enquiry).
7. **Quiet hours by school time zone**: `messaging.inQuietHours` assumes IST (+05:30); the automation window uses the school time zone (`SCHOOL_TIMEZONE`). Align the outbox to the school's zone for schools outside India.
8. **Fee reminder policy per school**: stages are fixed at 3 days before / 1 day / 15 days overdue. A per-school ladder (and excluding families on an approved fee plan) belongs in fee settings.
9. **WhatsApp next steps**: chips appear on the website; on WhatsApp the reply could end with "You could also ask: …" once the WhatsApp agent's message-length budget is agreed.

## Files

Backend: `backend/src/modules/automations/` (catalogue, runtime, jobs, personal, service, routes), `backend/src/models/automation.model.js`,
`backend/src/modules/ai/mcp/tools/p7Automation.js`, `backend/src/modules/ai/agent/p7Automation.js`; one hook each in
`agent/orchestrator.js` and `agent/intent.js`; two entries in `jobs/scheduler.js`; templates appended in `messaging.service.js`;
route mounted at `/api/v1/automations`.
Frontend: `components/ops/automations-view.tsx`, `lib/automations-api.ts`, the `automations` page in `lib/ops-routes.json`
(all portals), guide topic, chips in `components/ask-eduos.tsx`.
Tests: `backend/tests/automations.jobs.test.js`, `backend/tests/automations.askAi.test.js`, `frontend/tests/automations.test.tsx`.
