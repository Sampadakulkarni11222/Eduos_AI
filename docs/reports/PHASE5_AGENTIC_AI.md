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
| **OCR attendance from a photo of a paper register** | **Not built.** The brief's flagship teacher workflow. The agent scaffolding is ready (`mark_attendance` is registered, gated on `attendance.mark`, and requires confirmation), but there is no image ingestion, no OCR, and no roster-matching step. |
| **Voice input / multilingual responses** | **Not built.** The rule parser matches Hindi and Hinglish stems, and the tutor prompt targets an Indian school context — but there is no speech-to-text, and responses are not translated to the user's language. |
| Payment-link generation from the agent | Not built (`record_fee_payment` is staff-only ledger recording, not a parent payment link). |
| "Generate this week's homework" / "schedule a PTM" | Not built — no tool backs either yet. |
| Live LLM behaviour | **Never exercised.** No `ANTHROPIC_API_KEY` was available, so every test ran on the deterministic path. The provider, refusal handling, and model-proposal containment are code-reviewed, not runtime-verified. This is the largest untested surface in the phase. |

## Verification summary

| Suite | Result |
|---|---|
| Agent core (RBAC, confirm-before-commit, injection, audit) | **30/30** |
| WhatsApp surface | **19/19** |
| Web surface | **11/11** |
| Tutor mode | **24/24** |

Two test failures during this phase turned out to be **my tests being wrong, not the code**: a librarian was expected to get 403 on the tutor (all roles hold `ai.copilot.use`, so 404 was correct), and an earlier "mark my attendance" case scored higher as a read than a write. Both are recorded rather than quietly corrected, because a careless "fix" to either would have loosened a working control.
