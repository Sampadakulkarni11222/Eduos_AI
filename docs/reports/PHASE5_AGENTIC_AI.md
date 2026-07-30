# Phase 5 — Agentic AI Layer

_Date: 2026-07-30 · Commits `7ae58e3`, `644d379`, `4e261b0`, `1703da2` · All results below are from HTTP calls against a running instance with the 720-student seeded database._

## The security model, in one line

**The language layer chooses; the tool layer authorizes.**

Intent parsing — rules today, an LLM now wired in behind them — may propose any tool with any arguments. Nothing happens until `checkAuthorization()` validates that proposal against the caller's **live** permission map, and no write happens until a human confirms the exact summary they were shown. A model that is confused, wrong, or fully jailbroken can therefore cause a refusal or a bad suggestion — never an unauthorized read or write.

Prompt-injection detection exists and is logged, but it is explicitly **defence in depth, not the defence**. If it were the defence, the system would be one clever phrasing away from failure.

## 5.1 Shared core (`7ae58e3`) — 30/30

One orchestrator, called by both surfaces, so behaviour, authorization and audit are identical regardless of origin; only the audit `source` differs.

- **`tools.js`** — registry; each tool declares its permission and `minScope`, and calls **the same service functions the REST API uses**, inheriting their ownership checks rather than re-implementing (and eventually diverging from) them.
- **`orchestrator.js`** — authorize → validate → (read: run) / (write: propose) → confirm → execute → audit. Re-authorizes **at confirmation time**, since permissions may have been revoked in between.
- **`AgentAction` model** — proposed arguments are stored server-side and the caller holds only an opaque single-use token. If the arguments round-tripped through the client, a user could confirm something different from what they were shown — the precise failure confirm-before-commit exists to prevent.

**Bug found in my own code while testing:** `create_announcement` declared permission `announcements.create`, which is not a real catalog key (`announcements.publish` is). The tool failed *closed* — safe, but silently unusable for everyone including admins, and indistinguishable from "you lack that permission" at the call site. Fixed, plus a **boot-time validator** that logs any tool naming an unknown permission so that class of typo cannot hide again.

**Verified:** a student is refused attendance marking, fee recording, and school-wide queries exactly as the UI refuses them; confirm tokens are single-use (replay → 409) and useless to another user (403); declining changes nothing; every action including blocked injection attempts is audited.

## 5.2 WhatsApp + 5.3 web bot (`644d379`) — 19/19 and 11/11

Neither surface reimplements anything — both resolve an actor and hand it to `runAgent()`.

- **WhatsApp**: webhook parses Meta's envelope; signature verified first (added in Phase 3, now load-bearing). Phone → actor is built exactly like the `authenticate` middleware, including the resolved permission map. Confirmation works with a plain **YES/NO**, because that is how people actually reply. Multi-role accounts are told which profile they are acting as rather than silently guessed at. Non-text messages get a useful reply; delivery receipts acknowledge cleanly.
- **Web**: the assistant panel renders proposed writes as an inline confirmation card showing the **server's** summary — not re-composed on the client — with an explicit warning when an action touches other people's records. A 403 shows the server's reason: the refusal *is* the answer.

**Two real bugs found while testing:**
1. The webhook swallowed authorization refusals as "something went wrong", leaving users retrying something that could never work. Refusals now reach the user as themselves.
2. **A stray "yes" could confirm a forgotten earlier proposal** — an unconfirmed action from a previous run got executed by a "yes" meant for something else. Proposals are now superseded per actor, so only the newest can be confirmed. Fixed **in the core**, so it holds on every surface.

> **Honest limitation — WhatsApp identity is weaker than a logged-in session.** Whoever controls the handset (or the number after a SIM swap) is treated as that user. That is inherent to phone-addressed bots. It is why the signature check, the confirmation step, and strict own-permissions-only matter more here than on the web.

## 5.3 Tutor mode (`4e261b0`) — 24/24

The differentiator is **grounding, not the chat**. Subjects come from the student's own active enrolment; marks from their own published results; both server-side.

- **There is no parameter for whose syllabus.** A student cannot request another class's curriculum because the API does not accept one.
- A subject outside their own syllabus is refused outright, naming their real subjects back to them.
- Five modes: explain, questions, flashcards, notes, mindmap.

**When no LLM is configured**, the response is `generated: false` with `content: null` and a study scaffold built from their real timetable and topic. Fabricating an explanation and presenting it as a model answer would be worse than useless — **a student cannot tell a plausible wrong answer from a right one.**

**Verified:** off-syllabus refusal, every mode, class name and grounding echoed back, unknown mode and missing topic rejected, parent gets their child's syllabus, and a teacher or librarian with no student record gets a clean 404 rather than a leak.

## LLM provider + intent parsing (`1703da2`)

`ai.provider.js` follows the same shape as the payment and notification providers: real behaviour with credentials, an honest labelled fallback without. Uses `claude-opus-5` with adaptive thinking, checks `stop_reason` for a refusal **before** reading content, and degrades rather than throwing on provider errors.

Intent parsing tries the deterministic rules **first** — cheaper, instant, predictable — and only falls through to the model for phrasings they miss. Three containments, none of which rely on the model behaving:

1. The tool list handed to the model is already filtered to what the actor may use, so it is never shown a capability it could propose out of scope.
2. A proposal naming a tool the caller lacks (or one that does not exist) is dropped before it reaches the tool layer, and logged.
3. The proposal still goes through `checkAuthorization()`, and writes still need explicit human confirmation.

**Regression-tested:** agent core 30/30 and WhatsApp 19/19 still pass with the LLM path wired in and no key configured — behaviour is unchanged until a provider is actually set.

## What is NOT built

Stated plainly rather than left to be discovered:

| Item | Status |
|---|---|
| **OCR attendance from a photo of a paper register** | **Built** (`0fa2342`) — see the section below. |
| **Voice input / multilingual responses** | **Built** (`e5a1b0f`) — see the section below. WhatsApp *voice notes* remain unbuilt (they need server-side STT). |
| Payment-link generation from the agent | **Built** — see the section below. |
| "Generate this week's homework" | **Built** — see the section below. |
| "Schedule a PTM" | Not built — no scheduling service backs it yet. |
| Live LLM behaviour | **Never exercised.** No `ANTHROPIC_API_KEY` was available, so every test ran on the deterministic path. The provider, refusal handling, and model-proposal containment are code-reviewed, not runtime-verified. This is the largest untested surface in the phase. |

## Verification summary

| Suite | Result |
|---|---|
| Agent core (RBAC, confirm-before-commit, injection, audit) | **30/30** |
| WhatsApp surface | **19/19** |
| Web surface | **11/11** |
| Tutor mode | **24/24** |

Two test failures during this phase turned out to be **my tests being wrong, not the code**: a librarian was expected to get 403 on the tutor (all roles hold `ai.copilot.use`, so 404 was correct), and an earlier "mark my attendance" case scored higher as a read than a write. Both are recorded rather than quietly corrected, because a careless "fix" to either would have loosened a working control.


---

## OCR attendance from a register photo (`0fa2342`) — 25/25 + 12/12

`POST /attendance/ocr/draft` — photo → vision transcription → match against the
**real** roster → confidence-classify every row → propose → teacher confirms →
write through the ordinary `markAttendance()` path (which already enforces
section ownership and rejects enrollmentIds smuggled in from other sections).

Vision is the OCR engine rather than a classical library: a phone photo of a
handwritten register — skewed, mixed handwriting, ticks and crosses — is exactly
the input classical OCR handles worst.

### Two invariants

A misread register writes a wrong absence onto a real child's record, so the
cost of being wrong is not symmetric with the convenience of being fast.

1. **It never invents a student.** `enrollmentId`s come from the roster, never
   from the photo. A name matching nobody is surfaced to the teacher, never
   guessed into a record.
2. **It never auto-commits a low-confidence read.** Only exact, unambiguous,
   legible rows with an understood mark are attached to the confirmation token,
   so even a teacher who confirms without reading cannot write anything
   uncertain.

Rows go to **review** when: flagged illegible by the reader, the mark is
unreadable or blank, two rows claim the same student, the match was name-only
(no roll number), or the roll number and handwritten name disagree.

### Two bugs found by testing

**The one that mattered.** The roll/name disagreement check compared the read
name against the *best match anywhere in the roster* — so a name belonging to a
**different real student** scored 1.0 and the check never fired. The
confident-looking wrong row would have been committed. It now compares against
the roll-matched student's own name. This was caught by the test written
specifically for "confident-looking but wrong", which is why that case was
worth writing a test for at all.

**Ordering.** Provider-availability was checked before ownership, so a teacher
probing a section they don't teach got `501` instead of `403`. Nothing leaked,
but authorization must not be short-circuited by feature availability — or the
answer to "may I touch this section?" depends on whether an unrelated
integration is switched on. Ownership now runs first; verified `403` with
"You do not teach this section".

### Verified

- **Matcher, 25/25** — clean reads commit; illegible rows, unknown marks and
  blank cells never guess a status; duplicate rows cannot double-write one
  student; students not on the roster are never created; name-only matches
  still require review; name similarity handles slips, case and punctuation.
- **Endpoint, 12/12** — students and parents refused (same `attendance.mark`
  permission as marking by hand, so the photo path is never softer); validation
  runs before any model call; honest `501` with a "use the roster instead"
  message when unconfigured; `data:` URL prefixes accepted; `403` on a section
  the teacher doesn't teach.

**Not verified:** live vision transcription accuracy. No `ANTHROPIC_API_KEY` was
available, so the model call itself is code-reviewed only — the matcher that
consumes its output is fully tested against hand-built transcriptions.


---

## Voice input and multilingual replies (`e5a1b0f`)

### Multilingual

Detection is **deterministic** — Unicode script ranges plus a short
romanised-Hindi marker list — not model-based, because a parent must be
answered in their own language whether or not an LLM is configured.

Agent tools now return a **message key + params** rather than a finished
English sentence, so the orchestrator renders the same result in any
catalogued language. A tool still returning a literal string keeps working; it
just stays English.

**The catalogue covers English and Hindi only, deliberately.** Those are the two
I can write to a standard a school would put in front of parents. Machine-
translating the other nine detected languages and shipping them would look like
more coverage while quietly putting bad Tamil in front of a Tamil-speaking
parent. So: other languages are still *detected*, canned replies fall back to
English, and LLM-generated prose (the tutor) is produced directly in the user's
language, which a model does properly. Adding a language is a data change to
`MESSAGES` and should be done by a native speaker.

Applied across the web agent, WhatsApp — where it matters most, since parents
are the least English-comfortable audience — and the tutor. An explicit `lang`
from the UI overrides detection, so one English message doesn't flip a Hindi
user back.

### Voice

`lib/speech.ts` wraps the Web Speech API with 10 Indian locales. Kept
**client-side deliberately**: server-side STT would mean another provider, its
credentials, and per-minute cost for something every Chromium and Safari browser
already ships. Firefox has no support, so the button is hidden rather than shown
broken. The spoken language drives the reply language, so a parent sets it once.

### Two bugs found by testing

**The one my own test hid.** JavaScript's `` is defined on `[A-Za-z0-9_]`, so
every Devanagari pattern (`/छुट्टी/` and friends) **silently never
matched**. Hindi questions were being answered *in Hindi* with "I'm not sure
what you need" — and the first test **passed**, because it only asserted the
reply's language, not that the question had been understood. The anchors are
gone, the file carries a note explaining why they must not come back, and the
tests now assert comprehension (`!UNSURE.test(reply)`) rather than script.

**Validation in the wrong place.** `apply_leave` validated dates but not the
reason the leave service requires, so a Hindi request was proposed, **confirmed
by the user**, and only then failed. Confirm-before-commit is worthless if the
thing you confirmed cannot succeed — validation now mirrors the service, so the
user is asked for a reason *before* confirming.

### Verified

- **11/11** comprehension and end-to-end Hindi leave, including Devanagari
  (`बुखार के कारण`) and Hinglish (`kyunki shaadi hai`) reason extraction, plus
  English regression.
- **25/26** detection and catalogue (the one failure was the leave bug above,
  now fixed).
- No regressions: agent core **30/30**, WhatsApp **19/19**, OCR matcher
  **25/25**, `next build` 96/96.

### Not built

**WhatsApp voice notes.** They arrive as audio files on the webhook and cannot
use a browser API; transcribing them needs a server-side STT provider. The
webhook already answers non-text messages with a usable reply rather than
silence, so the failure mode is graceful.

---

## Payment links and homework generation — 29/29

Two tools, deliberately built to opposite designs, because they carry opposite
risks.

### `get_payment_link` — a read, not a payment

`fees.pay` · **does not mutate** · no confirmation step

A parent asking "I want to pay my fees" gets back their outstanding invoices
and a link into the payment page of their own portal. It never charges
anything.

That is a judgment call worth stating outright: an agent that can *take a
payment* from a chat message is a different and much worse product, and
confirm-before-commit is not a good enough guard for money moving on the back
of a sentence someone typed. A one-word "yes" against a summary is not the same
as a payer seeing an itemised invoice on a page they navigated to. So the tool
hands over a link and stops; the existing payment screen does the rest, with
its own UI and its own audit trail. `record_fee_payment` remains separate and
staff-only — that is a cashier recording money already received at a counter,
not a parent being charged.

Links are produced by `payment.provider.createPaymentLink()`, kept distinct
from `chargeOnline()` so the two can never be confused at a call site, and are
labelled honestly: `linkKind: 'IN_APP'` when it points at the portal,
`'NONE'` when no gateway is configured. No fake gateway URL is ever returned.

Scoping is inherited, not re-implemented: `fees.getPaymentLinks()` reads
through the same `listInvoices()` the REST API uses, so a parent sees only
their own children's invoices for the same reason the fees page does.

### `generate_homework` — a write, and it refuses to guess

`assignments.manage` · **mutates** · `affectsOthers: true` · confirmation required

Two-step by design. `prepare()` drafts the homework when the *proposal* is
made and the draft is stored server-side on the pending action, so the summary
the teacher approves describes homework that already exists in full. Without
that split, a teacher would be confirming a promise to generate something
unseen, and the text finally written could differ from what they agreed to.

The more interesting behaviour is what it does when it is *not sure*. Asked to
"create homework on fractions for Mathematics", for a teacher who teaches
Mathematics to four classes, it does not pick one. It refuses with
`OFFERING_AMBIGUOUS` and names the real options:

> Which class did you mean? You teach: Mathematics — Class 5 A; Mathematics —
> Class 6 B; Mathematics — Class 8 A; Mathematics — Class 9 B.

A confirmation prompt does not save you here — the teacher would be shown one
plausible class and would very likely say yes. The fix has to be upstream of
the confirmation, in refusing to guess at all. Missing topic and missing due
date are likewise rejected at *propose* time, not at execution, for the same
reason: approving a summary that then fails makes the confirmation step feel
like theatre.

### Pre-existing High fixed along the way

`assignment.create` checked that the subject offering **existed** but never
that the caller **taught it**. A live probe confirmed it: one teacher created
an assignment on another teacher's offering and got HTTP 200. This predates
the agent work — it was reachable from the plain REST API — and the agent tool
would have inherited it.

**Before:** any user with `assignments.manage` at `OWN` scope could set
homework for any class in the school by passing another teacher's
`subjectOfferingId`.
**After:** `scope === 'OWN'` requires `offering.teacherId === actor.profileId`,
else `403 NOT_YOUR_CLASS`. `ALL` scope (admin) is unchanged.
**Verified:** the probe now returns `403 NOT_YOUR_CLASS`; admin still gets
`201`; the probe row created during discovery was deleted.

### Verified

29/29, live against `eduos_qa`:

- Payment link is a read — invoice count and payment ledger unchanged after the
  call; `action` is `null`, so no confirmation is even offered.
- Per-role URLs: `/parent/payments?invoice=…` and `/student/payments?invoice=…`.
- Another family's invoice ID → `404 INVOICE_NOT_PAYABLE`. Teacher (no
  `fees.pay`) → `403`.
- Hindi request answered in Hindi: `3 बिल में कुल ₹85,000 बकाया है…`.
- Homework: ambiguity refused with the real class list; proposed only once the
  class is explicit; **nothing written** on propose or on decline; the created
  assignment matches the confirmed summary.
- Capabilities are role-shaped: parent sees `get_payment_link` and not
  `generate_homework`; teacher, the reverse.
- No regressions: agent core **30/30**, WhatsApp **19/19**, OCR matcher
  **25/25**, Phase 3 security **10/10**.

**One test failure that was mine, not the code's.** The suite initially
asserted that "create homework on fractions for Mathematics" would produce a
proposal. It produced the ambiguity refusal instead — which is the designed
and safer behaviour. The test was corrected to assert the refusal; the code was
not touched.

---

## §5.4 guardrails: audit state, rate limiting, injection monitoring — 24/24

Re-reading your brief against what was actually built, two of the three §5.4
guardrails were only partly done. Both are now closed.

### "Log every agentic action (who, what, source, **before/after state**)"

Who, what and source were logged from the start. **Before/after state was not.**
The audit entry recorded the *request* — the tool name and its arguments — which
answers a different question from the one an audit exists to answer. Knowing
`agent.record_fee_payment` was called with some arguments does not tell you what
the invoice said beforehand, and that is exactly what a parent disputing a
payment, or an auditor checking a cashier, needs.

Tools now opt in with a `snapshot()` hook, captured either side of the write:

| Tool | Snapshot |
|---|---|
| `record_fee_payment` | invoice status, total, paid total, payment count |
| `mark_attendance` | per-status tally for the section/date, plus the status of each row this call touches |
| creations (`generate_homework`, `apply_leave`, `create_announcement`) | `before: null` — nothing existed, and faking a before-state would be worse than admitting it |

A real entry, from the test run:

```
before: { invoiceNo: "INV-…-60", status: "PENDING", totalPaise: 2500000, paidPaise: 0,     paymentCount: 0 }
after:  { request: {…}, status: "EXECUTED",
          state: { invoiceNo: "INV-…-60", status: "PARTIAL", totalPaise: 2500000, paidPaise: 10000, paymentCount: 1 } }
```

`before` is recorded on failures too — it shows the state a half-applied write
would have started from. A snapshot that throws degrades to a logged `null`
rather than blocking a write the user already authorized.

**A second bug found while verifying this.** The state was being written and
then **thrown away by the read API**: `GET /audit/logs` built a DTO that omitted
`before` and `after` entirely, so every consumer could see *that* something
happened and never *what changed*. Fixed, passed through the same redactor the
request logger uses, since these payloads can carry OTPs and medical fields.
That endpoint also hardcoded `limit = 20` while accepting a `limit` query
parameter it silently ignored; it now honours it, capped at 200.

### "Rate-limit … specifically on this surface"

There was **no agent-specific limit at all** — only the general 2000-per-15-min
API limiter, on the most expensive and most abusable surface in the product.

Two layers now, and the important one is not the middleware:

- **`agent/throttle.js`, in the core** — 20 calls/minute **per actor**, enforced
  inside `runAgent()`. It lives here rather than in Express because both the web
  and WhatsApp surfaces call `runAgent()` and only one of them passes through
  middleware; a guard in the route would be bypassed by the webhook.
- **`aiRateLimiter` on `/ai/*`** — 30/minute, keyed on the resolved profile,
  as cheap early rejection.

**Keying is the design decision worth stating.** Both key on profile, not IP.
The general limiter keys on `req.ip`, which is right for a browser and useless
here: every WhatsApp message arrives from Meta's infrastructure, so the whole
school shares one address. IP keying would be either so loose it never fires or
so tight that one chatty parent locks out everybody. Keying on the actor also
means the limit follows a person across surfaces.

**Known limitation:** counters are in process memory — correct for one instance,
per-instance behind a load balancer. Moving to Redis is a change to two `Map`
operations, and is required before running a second replica.

### "…and monitor for prompt-injection attempts"

Attempts were logged individually, but nothing counted them, so a probing
attacker was indistinguishable from noise. Attempts are now counted per actor:
three inside a minute escalates to an **error**-level log (so it surfaces in
monitoring rather than a warn stream nobody reads), is marked
`BLOCKED_REPEATED` in the audit trail with the attempt count, and cools the
surface off for that actor.

**I shortened that cool-off from 15 minutes to 60 seconds after building it, and
the reasoning matters more than the number.** A prompt injection on this surface
cannot actually achieve anything — the tool layer authorizes every action against
live permissions, so the detector is defence in depth, not the defence. The
security benefit of a long lockout is therefore near zero, while the cost of a
false positive is a parent who quoted an unlucky sentence losing attendance and
fee lookups for a quarter of an hour. A minute breaks a scripted probe loop,
which is the thing worth stopping. The durable response is the log and the audit
entry.

### Verified

24/24 against a **default-configured** server, so the limits were exercised at
their real values rather than the relaxed ones the other suites use:

- Payment write: `before` matches the invoice's pre-write paid total, `after`
  shows the money moved (`0 → 10000`), request preserved alongside, actor and
  channel recorded.
- Creation: `before` is `null`, not fabricated; status `EXECUTED`.
- Injection: refused on attempts 1 and 2, escalates on 3, then `429
  AGENT_TEMPORARILY_BLOCKED` — and **a different actor is unaffected**, so the
  block is per-account, not a global outage.
- Flood: `429 AGENT_RATE_LIMITED` for the flooding actor, others unaffected.
- No regressions: agent core **30/30**, WhatsApp **19/19**, tools **29/29**,
  fee engine **18/18**, OCR **25/25**, QA-4/5/8 **22/22**, QA-6 **32/32**,
  Phase 3 security **10/10**, RBAC matrix 0 violations, dashboard matrix 0
  exposures, `next build` clean.

**One regression I caused and fixed.** The strike limit initially broke the
existing WhatsApp and tools suites: `agent-test` legitimately probes injection
several times, which blocked that actor for the following suite. That is the
guardrail working, but it revealed the 15-minute block was too blunt — see
above. The suites now run with the escalation relaxed via
`AGENT_INJECTION_STRIKES`, exactly as they already relax the HTTP rate limiter,
and the guardrail itself is verified at defaults by its own suite.

**One test flaw it exposed in the QA-6 probe.** That probe asserted the warden's
pending-leave list *grew* by one. The list is capped at 10, so once there were
more than ten pending it could never grow and the check silently stopped testing
anything. Fixed to assert a new `pendingLeaveCount` total — which the endpoint
did not previously return, meaning a warden looking at ten rows had no way to
tell whether that was all of them or the first ten of forty. The dashboard now
shows the total when the list is capped.
