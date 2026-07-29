# Phase 2 — Accessibility Fixes Applied

_Date: 2026-07-29 · Follow-up to PHASE2_UX_ACCESSIBILITY_AUDIT.md, which listed 17 scoped items._

## Corrections to the audit first

Two claims in the original audit were wrong, found while fixing them:

1. **"The OTP field lacks `autocomplete="one-time-code"` and `inputMode="numeric"`."** It already had `inputMode="numeric"`. Only the autocomplete hint and an accessible name were missing; both are now added.
2. **`--sidebar-group` for the owner theme** was listed among the failing themes. It measured **6.80:1** and always passed. Seven themes failed, not eight.

## Fixed

### Colour contrast — 1.4.3 · **15/15 now pass, measured from the shipped stylesheet**

Rather than picking colours by eye, I computed the smallest hue-preserving adjustment that reaches 4.5:1 for each failing pair, then re-measured by **parsing the values back out of `design-system.css`** — so the numbers below describe what actually ships, not a list typed by hand.

| Token / use | Before | After | Ratio |
|---|---|---|---|
| `--text-muted` (all table headers) | `#A2957F` **2.94** | `#7e7463` | **4.60** |
| `--text-faint` (inactive tabs) | `#9A8F7C` 3.18 | `#7e7566` | 4.54 |
| `--text-2b` (every stat-card label) | `#8A7E6B` 3.98 | `#807564` | 4.52 |
| `--text-2` on parchment | `#7C7160` 3.92 | `#716757` | 4.55 |
| Amber pill text | `#946312` 4.42 | `#916112` | 4.56 |
| Gray pill text | `#7A7264` 3.85 | `#6e675a` | 4.54 |
| WhatsApp button (white on green) | `#1FA855` 3.09 | `#137A3C` | 5.42 |
| `--sidebar-group` × **7 themes** | 3.00–4.26 | per-theme | 4.50–4.57 |
| AI panel greys on dark | 3.09–3.60 | lightened | ≥4.5 |

The gold `#C9A23F` on white (2.41) is **not** changed: it is used as a decorative accent (badge backgrounds, the active-nav rail), not as text on white. Darkening it would cost the brand cue for no accessibility gain. If it is ever used for text, it must be darkened then.

### Structure & semantics

- **`<h1>`** — the topbar title was a `<div>`, so no portal page had a level-1 heading at all. It is now the document `h1`, which also makes the existing `h2`s legitimate. (1.3.1)
- **`aria-current="page"`** on the active nav item — previously conveyed by colour alone. (1.3.1, 1.4.1)
- **Disabled nav items** rendered as a `<span title="Ships in an upcoming phase">` — a tooltip keyboard and touch users can never reach. Replaced with a visible **"Soon"** chip. (1.3.1)
- **`role="alert"`** on the login error banner — validation failures were silent to screen readers. (4.1.3)
- **OTP field** — `autocomplete="one-time-code"` (enables SMS autofill) and `aria-label="6-digit verification code"`; its only label had been the placeholder `— — — — — —`. (3.3.2, 4.1.2)

### Shared primitives — so the remaining gaps close by construction

Two new components in `components/ui.tsx`:

- **`<Field>`** — associates a visible `<label>` with its control via `htmlFor`/`id`, wires `aria-describedby` for hints, and sets `aria-invalid` + `role="alert"` on errors. The app previously had **one** `htmlFor` in the entire codebase.
- **`<Modal>`** — `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-to-close, focus moved in on open, **focus returned to the trigger on close**, and Tab cycling kept inside the dialog. No modal in the app did any of this.

**`PayInvoiceModal` is migrated to both** as the reference implementation — deliberately chosen because it is the highest-stakes dialog a parent uses. The remaining ~14 modals and the 40+ unlabelled selects are mechanical migrations onto these primitives; they are **not yet done**.

### Touch targets — 2.5.5

Under `@media (pointer: coarse)`: buttons, tabs and nav items to a 44px minimum, and the modal close button from ~20px to 44px (it was below even WCAG 2.2's 24px AA floor).

### Navigation / IA

- **Finance dashboard was orphaned** — `app/finance/page.tsx` existed but the Finance nav never linked it. Added.
- **Duplicate icons disambiguated**: `☱` meant both Attendance and Transport; `▢` meant Library, Documents, Course Material *and* Catalog. Transport → `⛒`, Documents → `🗎`, Course Material → `❑`. Icons are the primary cue for low-literacy users, so duplicates defeated their purpose.

## Verified

- **15/15 contrast checks pass at 4.5:1**, measured by parsing `design-system.css` itself.
- `tsc --noEmit` clean; `next build` compiles **94/94 routes**.
- Not verified by machine: screen-reader announcement order and the focus-trap feel. Those need a manual NVDA/VoiceOver pass, which I cannot perform here — listed below.

## Still open from the original 17

| Item | Status |
|---|---|
| Migrate remaining ~20 modals to `<Modal>` | **behaviour delivered via `ModalA11yBridge`** (below); the structural migration is still worth doing but is no longer an accessibility blocker |
| Migrate 40+ `<select>`/inputs to `<Field>` | primitive ready, migrations pending |
| Tabs → `role="tablist"` + arrow-key navigation | not started |
| Parent multi-child switcher in the shell | **needs a product decision** (global switch vs per-page) — flagged, not chosen unilaterally |
| Manual NVDA/VoiceOver pass on login, pay-invoice, assignment submit | cannot be automated here |
| 375px device pass per portal | pending (Phase 4 device matrix) |


---

## Follow-up: `ModalA11yBridge`

21 screens still render dialogs as raw `.modal-overlay` markup. Rewriting all of
them at once is a large, risky diff, and leaving them unfixed meant keyboard and
screen-reader users kept waiting on that migration. So the behaviour is now
applied at the DOM level instead: a single component mounted in `PortalShell`
watches for `.modal` / `.side-panel` / `.ai-panel` nodes and gives each one
dialog semantics, focus management and Escape-to-close.

It is **strictly additive** — it never overrides a `role` or label a component
already declares, so screens migrated to `<Modal>` are untouched. Escape works by
clicking the dialog's own `.modal-close` button rather than unmounting anything,
so component state updates normally and a dialog that deliberately cannot be
dismissed (no close button, or a disabled one) is left alone.

**Verified 12/12 against real DOM (jsdom) using the app's actual legacy markup:**
`role="dialog"` and `aria-modal` applied; the dialog named from its `.modal-title`;
focus moved in on open; Tab and Shift+Tab wrapping at both ends; focus pulled back
when it escapes; Escape clicking the close button; **focus returned to the
triggering element** on close; and an already-correct dialog left unmodified.

This is a bridge, not the destination — delete it once
`grep -rl "modal-overlay"` comes back empty.
