# EduOS promo — voiceover

Two cuts share this file: the **narrated cut** (`EduOSPromo`, continuous
narration) and the **text-led cut** (`EduOSPromoText`, where on-screen text
carries the story and the voice speaks six times).

---

## Narrated cut (≈90 s)

Timed to `src/timeline.ts` at 30 fps. Every line describes something on screen
and verified in the running app: no customer numbers, pricing, statistics or
outcomes. Keep it that way if you edit it.

**As delivered:** `assets/audio/voiceover.mp3` — Microsoft neural TTS
(`en-IN-NeerjaExpressiveNeural`) at +18% pace, each line synthesised separately and laid
on its own timecode. Build it with:

```bash
pip install edge-tts
node scripts/make-voiceover.mjs                    # default voice
node scripts/make-voiceover.mjs en-IN-PrabhatNeural  # male Indian English
```

The builder measures every line, re-synthesises anything that would overrun
its slot (up to +24%), and refuses to write a track where a line would talk
over the next one. Replacing it with a human recording needs only a 90-second
`voiceover.mp3` starting at 0:00, laid out on the timings below; the
composition picks it up automatically. Optional `assets/audio/music.mp3` is
ducked to 0.18 under the voice — **no music is included in the current cut.**

The video still works without any audio: the on-screen captions carry the
same story.

---

## Lines, as narrated

| At | Line | Scene |
|---|---|---|
| 0:02.2 | This is EduOS — the AI-native school OS. | Intro |
| 0:08.0 | One platform for your entire school. | One platform |
| 0:11.0 | Each school gets its own branded sign-in and its own theme, | |
| 0:14.9 | and one console for the day-to-day. | |
| 0:17.9 | Every role gets a portal built for its day. | Every role |
| 0:21.7 | Teachers see their teaching day at a glance. | |
| 0:25.1 | Parents follow their child's school life. | |
| 0:28.5 | Students see their day, homework and results. | |
| 0:31.9 | Wardens run the hostel. | |
| 0:35.2 | Librarians run the lending desk. | |
| 0:38.25 | And it's all connected. | A day in the school |
| 0:40.35 | A teacher marks attendance, one tap per student. | |
| 0:43.8 | The family sees the same record, | |
| 0:46.4 | and can ask in their own language. | ← the Hindi exchange |
| 0:50.9 | Fees are paid online, with a receipt. | |
| 0:53.9 | And the principal sees risk flagged early, | |
| 0:56.9 | with the reason, and who to call next. | |
| 0:59.9 | Then there's Ask Agent. | **Ask Agent (hero)** |
| 1:02.2 | Ask in plain language, and it answers from your school's own data. | |
| 1:06.6 | The same question from a parent shows only their own child. | |
| 1:10.6 | Ask for a change, and nothing happens until you confirm it. | |
| 1:17.1 | And every action is on the record. | |
| 1:20.0 | Permissions by role, data kept per school, and AI that asks first. | Trust |
| 1:25.4 | EduOS — one platform, connected school, smarter management. | Close |

Narration ends at **1:29.72** of 1:30.0. Measured onset drift against these
timecodes: **0.03 s** in the track, **0.08 s** in the rendered MP4.

## Notes on the wording

The lines above are the earlier draft tightened to fit the cut — the meaning
and the claims are unchanged, but nothing is allowed to run into the next
shot. What changed, and why:

- The principal's introduction moved out of the roles montage (that beat is
  3.4 s and the line needed 4.7 s). Principals still get their own line at
  0:53.9, over the risk scan, where the point actually lands.
- "Audit logs" as a separate trust line was folded into the 1:20.0 line: the
  audit trail is already narrated at 1:17.1 and shown on its own pillar card.
- Em dashes became commas in the tightest lines — the synthesiser pauses on a
  dash, which cost roughly a third of a second each time.

## Hindi

The narration stays in English throughout. The Hindi exchange at 0:45.6–0:48.6
speaks for itself on screen — a typed Hinglish question, `fees kitni baki hai`,
answered `₹45,000 फीस बकाया है।` — and the English line at 0:46.4 ("and can ask
in their own language") sits under it without translating it.

**Pronunciation:** "EduOS" = *ED-yoo-oh-ess*.

## Voice

All three cuts use **`en-IN-NeerjaExpressiveNeural`** — Indian English, chosen
by ear from `node scripts/voice-samples.mjs`, which renders the same two lines
in eight candidate voices (plus `out/voice-samples/all-voices.mp3` to listen
straight through). It reads slower than the previous voice, so four lines in
the narrated cut are synthesised at a higher rate to hold their slots; the
builder does that automatically and refuses to ship a track where a line would
run into the next.

Switching voice is one argument:

```bash
node scripts/make-voiceover.mjs <voice-id>            # narrated
node scripts/make-voiceover.mjs <voice-id> --minimal  # text-led
node scripts/make-voiceover.mjs <voice-id> --studio   # designed
```

The previous voice's tracks and renders are kept in `.work/audio-archive/`
and `out/archive/`.


---

## Text-led cut — minimal narration

`assets/audio/voiceover-minimal.mp3`, same voice and builder:

```bash
npm run voiceover:minimal
```

Six lines, ≈25 s of clips and **17.8 s of voiced audio — 20% of the video**.
The rest is deliberate silence: the screens and the on-screen text carry it,
and the cut is built to be understood with the sound off.

| At | Line | Lands on |
|---|---|---|
| 0:02.6 | Meet EduOS — the AI-native school OS. | the mark and tagline |
| 0:17.9 | One platform. Every role. One connected school. | the first portals |
| 0:38.3 | One school day, connected end to end. | the register being marked |
| 1:00.0 | Ask Agent answers from your school's own data, inside your permissions. | the read and its answer |
| 1:11.0 | Nothing changes without your confirmation. | the confirmation card — also on screen |
| 1:25.4 | EduOS — one platform, connected school, smarter management. | the end card |

Everything else in that cut is on-screen text: role labels with the modules
each portal actually carries, four day-in-the-school instructions, the
Ask → Review → Confirm → Done flow across the write, and five trust cards.
