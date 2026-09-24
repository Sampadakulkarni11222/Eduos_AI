# EduOS promo (Remotion)

A 90-second, 1920×1080, 30 fps promotional video built from **real captures of
the running EduOS app** — Oakridge Academy's seeded demo data, Ask Agent in
Rules mode. Isolated from the product: nothing under `backend/` or `frontend/`
is modified by anything here.

```
remotion/
  capture/          Playwright pipeline
    stack.mjs         isolated stack: in-memory Mongo + seeds + backend :5055 + frontend copy :3055
                      (--skip-build reuses the last build, --api-only skips the frontend entirely)
    lib.mjs           sign-in (real OTP flow, dev echo), session cache, settle/screenshot helpers
    capture.mjs       every screen, in story order → assets/screenshots
    hindi.mjs         the Hindi exchange: panel language set to हिन्दी, question typed
    parent-postpay.mjs  the parent's fee answer, re-asked after the invoice is paid
    explore.mjs       quick low-res survey of routes (.work/explore)
    extra.mjs         read-only supplementary screens → .work/extra, reviewed before
                      any is copied into assets (manifest.extra.json)
  assets/
    screenshots/      53 real captures, 3840×2160 (1920×1080 viewport @2x) + manifest.json
    logo/             eduos-mark.svg (copied from frontend/src/app/icon.svg)
    fonts/            Newsreader + Hanken Grotesk (self-hosted, OFL)
    audio/            voiceover.mp3 (generated; see VOICEOVER.md); music.mp3 (synthesised,
                      scripts/make-music.py) — the dynamic cut's bed, ducked under the voice
    clips/            (unused so far — the promo animates stills)
  src/
    config.ts         format + brand tokens (from design-system.css)
    timeline.ts       the only place timing lives — shared by both cuts
    Promo.tsx         narrated cut (EduOSPromo)
    scenes/           its scenes: Intro, Platform, Roles, Day, Agent, Trust
    text/             text-led cut (EduOSPromoText): same captures and camera
                      moves, short on-screen text, minimal voice
    studio/           designed cut (EduOSPromoStudio): EduOS redrawn in code —
                      ui.tsx is the kit, then dashboard, features, roles, AI
    dynamic/          pacing pass (EduOSPromoDynamic): real captures, a new
                      beat every 1–2 s; kit.tsx lays beats out in seconds
    components/       Shot (camera + highlights), Caption, Crop, ShotSequence, Brand
  scripts/            stills.mjs + contact-sheet.mjs for review,
                      make-voiceover.mjs (neural TTS, line-by-line, timed),
                      voice-samples.mjs (candidate voices, to choose by ear)
  VOICEOVER.md        narration synced to the timeline
```

## Re-capture

```bash
cd remotion
npm install
npm run stack          # terminal 1 — wait for "[stack] READY"
npm run capture        # terminal 2 — ~3 min, 51 screens
node capture/hindi.mjs         # the Hindi exchange
node capture/parent-postpay.mjs  # parent fee answer, after paying
```

The stack never touches Atlas: `MONGO_URI`/`MONGO_URI_ATLAS` are overridden
with a throwaway in-memory replica set, AI runs in `rules` mode with no keys,
payments use the `sandbox` provider, and WhatsApp is switched off. Runs on
:5055/:3055 so a dev server on :5000/:3000 is untouched. `npm run stack:fast`
reuses the last frontend build.

The seed randomises attendance, so risk counts differ between stacks. Always
capture all screens from **one** stack run so every screen agrees.

## Preview and render

```bash
npm run preview        # Remotion Studio
npm run render:draft   # out/eduos-promo-draft.mp4   (960×540)
npm run render         # out/eduos-promo-1080p.mp4  (1920×1080, H.264)
                       # the shipped cut is out/eduos-promo-final.mp4, same settings
npm run stills         # review frames every 2.5 s → out/stills
npm run voiceover      # rebuild assets/audio/voiceover.mp3 (needs: pip install edge-tts)
npm run voiceover:minimal  # assets/audio/voiceover-minimal.mp3 — the text-led cut's ~25 s
npm run render:vo      # out/eduos-promo-final-with-voiceover.mp4 — the narrated cut
npm run render:text    # out/eduos-promo-text-focused.mp4 — the text-led cut
npm run voiceover:studio   # assets/audio/voiceover-studio.mp3
npm run render:studio  # out/eduos-promo-studio.mp4 — the designed (no-capture) cut
npm run voiceover:dynamic  # assets/audio/voiceover-dynamic.mp3 — five lines, on the 126 s cut
npm run music          # assets/audio/music.mp3 — 122 BPM bed for the dynamic cut (needs numpy + scipy)
npm run render:dynamic # out/eduos-promo-studio-dynamic.mp4 — the pacing pass, with music
node scripts/stills.mjs --comp=EduOSPromoDynamic --out=stills-dynamic   # review frames
```

## Two cuts

| Composition | Story carried by | Narration | Output |
|---|---|---|---|
| `EduOSPromo` | continuous narration + captions | ~175 words, 24 lines | `eduos-promo-final-with-voiceover.mp4` |
| `EduOSPromoText` | on-screen text and the UI | 6 lines, ≈25 s | `eduos-promo-text-focused.mp4` |
| `EduOSPromoStudio` | **recreated** UI, animated in code | 6 lines | `eduos-promo-studio.mp4` |
| `EduOSPromoDynamic` | real captures, a beat every ~1.5–3 s (`PACE` 1.4 in `src/dynamic/kit.tsx`) | 5 lines, ≈21 s | `eduos-promo-studio-dynamic.mp4` (126 s) |

All three are 90.00 s and share the brand tokens. The first two animate the
real captures; the third displays **no capture at all** — its dashboard,
cards, role panels and assistant are drawn from the same design tokens, using
the product's own module names, with sample data. It has its own running order
(dashboard first, then features) in `src/studio/timeline.ts`.

Change `VIDEO.fps` in `src/config.ts` or scene lengths in `src/timeline.ts`;
every scene re-times itself.
