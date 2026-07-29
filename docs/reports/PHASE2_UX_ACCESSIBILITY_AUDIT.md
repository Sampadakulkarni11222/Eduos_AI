# Phase 2 — UX & Accessibility Audit (all 9 portals)

_Date: 2026-07-29 · Method: static audit of the frontend codebase (shared shell, design system, nav registry, forms, modals, sampled portal pages) plus computed WCAG contrast ratios for every design-token pair in `design-system.css`. Audit-only — no code changed. `Student_Portal.pdf` was not available (not in repo/folder); its role as presentation reference is noted where relevant._

## 1. What's already good (so we don't re-fix it)

- Global `*:focus-visible` outline (`design-system.css:220`) and `prefers-reduced-motion` support (`:221`) exist.
- Mobile table→card pattern (`.data-table-cards`, `:399-460`) is **adopted in 42 of 43** files that render data tables — the student-analysis "Mobile UX: table→card" item is materially further along than the analysis assumed; what remains is verification per page, not a build.
- RBAC matrix and timetable have dedicated mobile alternates (`.rbac-mobile`, `.calendar-mobile-only`).
- Sidebar nav is permission-filtered server-truth (`shell.tsx:141-147`); icons are `aria-hidden` (`shell.tsx:156`); hamburger/close buttons have `aria-label`s.
- Toasts announce via `aria-live="polite"` (`ui.tsx:126`); spinner has `role="status"` (`ui.tsx:58`).
- Loading/empty states are systematized (`Spinner`, `SkeletonRows`, `EmptyState`) and widely used.

## 2. Accessibility findings (tagged by WCAG 2.1 criterion)

### Color contrast — 1.4.3 (AA)
Computed ratios (script in scratchpad; normal text needs ≥4.5:1, large ≥3:1):

| Token pair | Ratio | Verdict | Where it bites |
|---|---|---|---|
| `--text-muted #A2957F` on white | **2.94** | **FAIL** | every `data-table thead th` (11px uppercase — small text), `design-system.css:156` |
| Gold `#C9A23F` on white | **2.41** | **FAIL** | any gold-on-light accent use |
| `--text-faint #9A8F7C` (inactive tabs, 13px) | 3.18 | FAIL at size | `.tab`, `design-system.css:177` |
| `--text-2b #8A7E6B` (stat labels 12px) | 3.98 | FAIL at size | every StatCard label |
| `--text-2 #7C7160` on parchment `#EFE8D8` | 3.92 | FAIL at size | topbar desc, misc secondary text on page background |
| Sidebar group labels (10.5px): teacher 3.23, parent 3.00, librarian 3.03, principal 3.53, warden 3.80, admin 4.09, student 4.26 | — | **FAIL in 7/8 themes** | `.nav-group-label` in every portal |
| Amber pill `#946312/#F7ECD4` 4.42, gray pill 3.85 | — | FAIL at 11.5px | status pills app-wide |
| AI panel: placeholder/tools `#6f6a5f` on near-black | 3.09–3.60 | FAIL at size | `ask-eduos` panel |
| WhatsApp button white on `#1FA855` | 3.09 | FAIL (13px text) | `.btn-whatsapp` |

Passing and fine: body text (12.4:1), card text, td text (5.7:1), accent buttons (≥9:1), green/red pills, nav badge on gold.

### Labels & names — 1.3.1, 3.3.2, 4.1.2
- **One `htmlFor` in the entire app** (`login/page.tsx:514`). Every other form field — all admin CRUD modals, fee forms, `pay-invoice-modal.tsx:47` (`div.field-label`), 40+ `<select>`s — has a visual label with **no programmatic association**. Screen readers announce bare "edit text"/"combo box".
- OTP code input's only label is placeholder `"— — — — — —"` (`login/page.tsx:202`) — 3.3.2 fail on the single highest-stakes field for the lowest-tech users.
- `alt=` count is zero, but so are content `<img>` tags (avatars are initials) — not currently a violation; will become one when photos ship.

### Keyboard — 2.1.1, 2.1.2, 2.4.3, 2.4.7
- **No modal in the app traps focus, sets `role="dialog"`/`aria-modal`, restores focus on close, or closes on Escape** — except `ask-eduos.tsx:32-35` (Escape only). Affects: pay-invoice, bulk-upload, apply-leave, medical panel, every inline page modal (~15+). Keyboard/SR users can tab out of an open modal into the page behind it (2.4.3), and can't dismiss it (2.1.2-adjacent).
- Mobile sidebar drawer: overlay closes on click only (`shell.tsx:70`); drawer gets no focus when opened, no trap, no Escape.
- Disabled nav items render as `<span title="Ships in an upcoming phase">` (`shell.tsx:171-179`) — tooltip unreachable by keyboard/touch, item meaningless to SRs.
- Zero `onKeyDown` handlers app-wide — needs a sweep for click-only interactive `div`s (found none in shared components; portal pages need Phase 4 spot-checks).

### Announcements & structure — 4.1.3, 1.3.1, 2.4.6
- Inline error banners (`ErrBanner`, login and forms) have **no `role="alert"`** — validation failures are silent to SRs (4.1.3). Only toasts announce.
- Active nav item styled visually but no `aria-current="page"` (`shell.tsx:165`).
- Tabs (`.tab`, `.chip-tab`) are plain buttons — no `role="tablist"/tab`, no `aria-selected`.
- Heading structure: topbar title is a `div`, not `<h1>` (`shell.tsx:81`); Access-Denied uses `<h2>` with no h1 ancestor.
- `<html lang="en">` is set (`layout.tsx:15`) — fine until multi-language ships (Phase 1 gap).

### Touch targets — 2.5.5 (AAA in 2.1, but explicitly in scope for parent/student mobile)
- Nav items ≈34px, buttons ≈36px, `btn-sm` ≈30px, modal close `×` ≈20px, table row actions — all below the 44px comfortable minimum; modal close is below even WCAG 2.2's 24px AA floor. Parent/student flows (Pay Now, OTP entry, assignment submit) hit these constantly.

## 3. UX findings (per portal / cross-cutting)

1. **Finance portal's dashboard is orphaned**: `app/finance/page.tsx` exists but the Finance nav (`portals.ts:225-234`) lists only Payments & Reports — a Finance user landing on `/finance` has no way back to it. Also Finance reuses `role-admin` theme (minor identity blur).
2. **No notification surface in any shell** — no bell, no inbox (confirms student-analysis Critical, but it's true for all 9 portals; topbar is the natural home).
3. **Parent portal is the deepest nav (17 items, 4 groups) with no child switcher** — a parent of two must rely on per-page child dropdowns where they exist. Their most common task (check today's attendance/homework for child X) is 2–3 interactions where a teacher's equivalent is 1–2 — violating the "parent never needs more clicks than teacher" rule.
4. **Icon language is muddled**: `☱` means both Attendance and Transport; `▢` means Library, Documents, Course Material *and* Catalog (`portals.ts`). Low-literacy/low-English users lean on icons — these don't disambiguate.
5. **Click depth is otherwise healthy**: sidebar is flat, 1 click to any module, dashboards have drill-down stat cards; parent Pay Now = 2 clicks. Good.
6. **Dashboard cognitive load**: admin sidebar has 19 items in 6 groups — acceptable for admin; student (12) and parent (17) could merge SCHOOL LIFE/ACCOUNT on mobile. Stat-card grids collapse properly via the 1100px/768px rules.
7. **Login UX**: dev-OTP echo in UI is good for demos but the OTP field lacks `autocomplete="one-time-code"` and `inputMode="numeric"` — mobile users don't get the numeric keypad or SMS autofill; error copy is real (good).
8. **Blanket mobile CSS overrides** (`design-system.css:363-389`) rewrite any inline `display:flex` row to wrap/stack — pragmatic, but it makes mobile layout behavior non-obvious per page; Phase 4's device pass must verify each screen rather than trusting the safety net.
9. `tsconfig.tsbuildinfo` is tracked/modified in git — noise, should be ignored (housekeeping, not UX).

## 4. Concrete improvement list (each independently implementable & verifiable)

**A. Design-token fixes (one file, app-wide effect) — do first:**
1. Darken `--text-muted` → ≥#8A7D66, `--text-faint` → ≥#8A7F6C, `--text-2b` → ≥#7C7160; verify with the contrast script. (1.4.3)
2. Bump `.nav-group-label` per-theme `--sidebar-group` values to ≥4.5:1 (or raise size/weight to qualify as large text). Seven themes to touch.
3. Fix amber/gray pill pairs; darken `#946312`→`#7d530f`-ish, gray text `#7A7264`→`#6a6254`.
4. WhatsApp button: keep brand green as background but use dark text or darken green to ≥4.5:1 with white.
5. AI panel: lighten placeholder/tools grays on dark.

**B. Shared-component fixes (one component each):**
6. `Modal` primitive: add `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, Escape close, focus restore — then migrate the ~15 inline modals onto it (mechanical, per-page PRs).
7. `Input`/`Select`/`Field` primitives: auto-generate `id` + `htmlFor` association; migrate `field-label` divs to `<label>`.
8. `ErrBanner`: add `role="alert"`.
9. Sidebar: `aria-current="page"` on active item; drawer focus management + Escape; replace disabled-item `title` with visible "Soon" chip text.
10. Tabs: proper `tablist/tab/tabpanel` roles + arrow-key movement (or swap to underlying radio pattern).
11. Topbar title → `<h1>`.
12. Touch targets: raise `.btn`/`.nav-item` min-height to 44px on coarse pointers (`@media (pointer: coarse)`), modal close to 32px+.
13. OTP input: `inputMode="numeric" autocomplete="one-time-code"` + real `<label>`.

**C. Navigation/IA (portals.ts only):**
14. Add Dashboard item to Finance nav.
15. De-duplicate icons (give Transport 🚌-class glyph, differentiate Library/Documents/Material).
16. Reserve a topbar slot for the Phase-4 notification bell (design now, build in Phase 4).
17. Parent child-switcher in the shell topbar (design decision — flagged: needs product sign-off on whether switch is global or per-page).

**Verification per item**: re-run the contrast script for A; keyboard-only walkthrough (tab/shift-tab/Escape/enter) per component for B; NVDA/VoiceOver smoke on login, pay-invoice, assignment-submit; 375px-viewport pass per portal in Phase 4's device matrix.

**Judgment calls flagged:** (a) I treated touch-target sizing under the 44px comfortable standard rather than strict 2.1-AA (which has no normative AA target size) because the brief explicitly prioritizes parent/student mobile; (b) contrast fixes propose darkening text tokens rather than lightening backgrounds to preserve the parchment brand; (c) the blanket mobile flex overrides were left as-is pending Phase 4 device verification rather than proposing their removal now.
