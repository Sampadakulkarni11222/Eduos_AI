/**
 * Builds assets/audio/voiceover.mp3 from the script in VOICEOVER.md.
 *
 *   node scripts/make-voiceover.mjs                 # default voice
 *   node scripts/make-voiceover.mjs en-IN-PrabhatNeural
 *
 * Each line is synthesised on its own and laid down at the timecode of the
 * beat it describes, so the narration tracks the cut instead of drifting
 * across it. A line that would run past its slot is re-synthesised slightly
 * faster (up to +18%) rather than being allowed to collide with the next one;
 * if it still does not fit, the build fails loudly instead of shipping
 * narration that talks over itself.
 *
 * Voices come from Microsoft's neural TTS via edge-tts (pip install edge-tts).
 * The wording is the script's; nothing here adds a claim of its own.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// Remotion ships its own ffmpeg/ffprobe with its compositor package. Calling
// those binaries directly avoids npx, whose .cmd shim Node refuses to spawn
// without a shell — and a shell would re-split these arguments.
const COMPOSITOR = path.join(ROOT, 'node_modules', '@remotion', `compositor-${process.platform}-${process.arch}-msvc`);
const EXE = process.platform === 'win32' ? '.exe' : '';
const FFMPEG = path.join(COMPOSITOR, `ffmpeg${EXE}`);
const FFPROBE = path.join(COMPOSITOR, `ffprobe${EXE}`);

const WORK = path.join(ROOT, '.work', 'vo');
// --minimal builds the text-led cut's narration (≈22 s of speech across five
// moments) into its own file, so the narrated cut keeps voiceover.mp3.
const MINIMAL = process.argv.includes('--minimal');
// --studio is the designed cut, whose scenes run to their own timeline
// (src/studio/timeline.ts: 0 / 7.4 / 27.3 / 31.2 / 51.1 / 68.5 / 82.4 s).
const STUDIO = process.argv.includes('--studio');
// --dynamic is the pacing pass (src/dynamic): sections start at 0 / 7 / 17 /
// 30 / 43 / 52 / 60 / 66 / 69 / 82 / 86.6 s.
const DYNAMIC = process.argv.includes('--dynamic');
const OUT = path.join(
  ROOT,
  'assets',
  'audio',
  DYNAMIC ? 'voiceover-dynamic.mp3' : STUDIO ? 'voiceover-studio.mp3' : MINIMAL ? 'voiceover-minimal.mp3' : 'voiceover.mp3',
);
// Chosen by ear from scripts/voice-samples.mjs: same Indian English as
// before, with the expressive delivery. Override by passing a voice id.
const VOICE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'en-IN-NeerjaExpressiveNeural';
// The dynamic cut is stretched by src/dynamic/kit.tsx's PACE; its lines are
// written on the 90 s cue sheet and scaled here to land on the same beats.
const DYNAMIC_PACE = 1.4;
const TOTAL = DYNAMIC ? 90 * DYNAMIC_PACE : 90;
// A touch above the voice's default pace: reads as confident rather than
// leisurely, and buys room inside the cut. Lines that still overrun their slot
// are re-synthesised faster still.
const BASE_RATE = 12;

/**
 * `at` is where the line starts, in seconds on the master timeline. The beat
 * times are the ones src/timeline.ts produces (scene starts 0 / 7.6 / 17.6 /
 * 38.1 / 59.6 / 79.6, beats weighted inside each scene).
 */
const FULL_LINES = [
  // Intro — lands with the wordmark and tagline.
  { at: 2.2, text: 'This is EduOS — the AI-native school OS.' },

  // One platform — sign-in door, customization, admin console.
  { at: 8.0, text: 'One platform for your entire school.' },
  { at: 11.0, text: 'Each school gets its own branded sign-in and its own theme,' },
  { at: 14.9, text: 'and one console for the day-to-day.' },

  // Every role — one line per portal beat.
  // The principal's own line lives in the day scene, where the risk scan is.
  { at: 17.9, text: 'Every role gets a portal built for its day.' },
  { at: 21.7, text: 'Teachers see their teaching day at a glance.' },
  { at: 25.1, text: "Parents follow their child's school life." },
  { at: 28.5, text: 'Students see their day, homework and results.' },
  { at: 31.9, text: 'Wardens run the hostel.' },
  { at: 35.2, text: 'Librarians run the lending desk.' },

  // A day in the school — each line on the beat it describes.
  { at: 38.25, text: "And it's all connected." },
  { at: 40.35, text: 'A teacher marks attendance, one tap per student.' },
  { at: 43.8, text: 'The family sees the same record,' },
  { at: 46.4, text: 'and can ask in their own language.' },
  { at: 50.9, text: 'Fees are paid online, with a receipt.' },
  { at: 53.9, text: 'And the principal sees risk flagged early,' },
  { at: 56.9, text: 'with the reason, and who to call next.' },

  // Ask Agent — the hero section, so it gets the most room: the read, the
  // permission contrast, the confirmation, the audit trail.
  { at: 59.9, text: "Then there's Ask Agent." },
  { at: 62.2, text: "Ask in plain language, and it answers from your school's own data." },
  { at: 66.6, text: 'The same question from a parent shows only their own child.' },
  { at: 70.6, text: 'Ask for a change, and nothing happens until you confirm it.' },
  { at: 77.1, text: 'And every action is on the record.' },

  // Trust and close.
  { at: 80.0, text: 'Permissions by role, data kept per school, and AI that asks first.' },
  { at: 85.4, text: 'EduOS — one platform, connected school, smarter management.' },
];

/**
 * The text-led cut speaks only five times: the opening claim, the promise the
 * roles montage proves, the assistant's one idea, the guarantee, and the
 * close. Everything else is carried by the screens and the on-screen text.
 */
const MINIMAL_LINES = [
  { at: 2.6, text: 'Meet EduOS — the AI-native school OS.' },
  { at: 17.9, text: 'One platform. Every role. One connected school.' },
  { at: 38.3, text: 'One school day, connected end to end.' },
  { at: 60.0, text: "Ask Agent answers from your school's own data, inside your permissions." },
  { at: 71.0, text: 'Nothing changes without your confirmation.' },
  { at: 85.4, text: 'EduOS — one platform, connected school, smarter management.' },
];

/** The designed cut: one line per section, the rest carried by the motion. */
const STUDIO_LINES = [
  { at: 1.9, text: 'EduOS — one intelligent platform for every school.' },
  { at: 9.6, text: 'Everything your school runs on, in one dashboard.' },
  { at: 27.9, text: 'Everything your school needs, in one place.' },
  { at: 51.7, text: 'Every role gets the view built for it.' },
  { at: 69.2, text: "Ask in plain language, and EduOS answers from your school's data, within your permissions." },
  { at: 83.3, text: 'EduOS. One intelligent platform. For every school.' },
];

/**
 * The dynamic cut speaks five times, ~15 s in all: the name, the product
 * message, the assistant's one idea, the guarantee, and the close. The montage
 * sections in between are carried by the screens and the type alone.
 */
const DYNAMIC_LINES = [
  { at: 0.5, text: 'Meet EduOS — the AI-native school OS.' },
  { at: 7.3, text: 'One platform. Every role. One connected school.' },
  { at: 69.3, text: "Ask Agent answers from your school's own data, inside your permissions." },
  { at: 79.6, text: 'Nothing changes without your confirmation.' },
  { at: 85.9, text: 'EduOS — one school, one connected platform.' },
];

const LINES = DYNAMIC ? DYNAMIC_LINES.map((l) => ({ ...l, at: +(l.at * DYNAMIC_PACE).toFixed(2) })) : STUDIO ? STUDIO_LINES : MINIMAL ? MINIMAL_LINES : FULL_LINES;

const GAP = 0.25; // the least silence left between one line and the next

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    // No shell: these arguments contain spaces and em dashes.
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('exit', (code) => (code === 0 ? resolve(out + err) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });

const ffprobeDuration = async (file) => {
  const out = await run(FFPROBE, [file]);
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`No duration for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/**
 * Synthesises one line and trims the silence the service pads it with, so the
 * line starts on its timecode instead of a fraction of a second later.
 */
/** Where speech actually starts and ends, from silencedetect's report. */
const speechBounds = async (file, duration) => {
  const out = await run(FFMPEG, ['-i', file, '-af', 'silencedetect=noise=-45dB:d=0.06', '-f', 'null', '-']);
  const starts = [...out.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...out.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  // Leading pad: a silence that begins at (or before) zero ends where speech does.
  const start = starts.length && starts[0] < 0.12 && ends.length ? ends[0] : 0;
  // Trailing pad: a silence that never ends is the tail.
  const trailing = starts.length && (ends.length < starts.length || starts[starts.length - 1] > ends[ends.length - 1]);
  const end = trailing ? starts[starts.length - 1] : duration;
  return { start: Math.max(0, start - 0.03), end: Math.min(duration, end + 0.06) };
};

const synth = async (text, file, ratePct) => {
  const raw = file.replace(/\.mp3$/, '.raw.mp3');
  const args = ['-m', 'edge_tts', '--voice', VOICE, '--text', text, '--write-media', raw];
  if (ratePct) args.push(`--rate=+${ratePct}%`);
  await run('python', args);
  // The service pads every clip with silence; left in, it delays the line past
  // its timecode and eats the slot the next line needs.
  const rawDur = await ffprobeDuration(raw);
  const { start, end } = await speechBounds(raw, rawDur);
  await run(FFMPEG, [
    '-i', raw,
    '-af', `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS`,
    '-c:a', 'libmp3lame', '-b:a', '192k', '-y', file,
  ]);
  return ffprobeDuration(file);
};

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });

const slots = LINES.map((l, i) => (i + 1 < LINES.length ? LINES[i + 1].at : TOTAL) - l.at - GAP);
const built = [];
const overruns = [];
for (let i = 0; i < LINES.length; i++) {
  const file = path.join(WORK, `${String(i).padStart(2, '0')}.mp3`);
  let dur = await synth(LINES[i].text, file, BASE_RATE);
  for (const rate of [18, 24, 30, 36]) {
    if (dur <= slots[i]) break;
    dur = await synth(LINES[i].text, file, rate);
  }
  const fits = dur <= slots[i];
  if (!fits) overruns.push({ at: LINES[i].at, dur, slot: slots[i], text: LINES[i].text });
  console.log(`${fits ? '✔' : '✖'} ${LINES[i].at.toFixed(2)}s  ${dur.toFixed(2)}s / ${slots[i].toFixed(2)}s  "${LINES[i].text.slice(0, 54)}"`);
  built.push({ file, dur, at: LINES[i].at });
}

// Every line is measured before anything is rejected, so one pass shows all
// the collisions rather than only the first.
if (overruns.length) {
  console.error(`
${overruns.length} line(s) overrun their slot even at +36%:`);
  for (const o of overruns) console.error(`  ${o.at}s needs ${o.dur.toFixed(2)}s, has ${o.slot.toFixed(2)}s — "${o.text}"`);
  throw new Error('Shorten those lines or move the next one later.');
}

const last = built[built.length - 1];
console.log(`\nnarration ends at ${(last.at + last.dur).toFixed(2)}s of ${TOTAL}s`);

// One silent 90 s bed, every line delayed onto it, then levelled for speech.
const inputs = built.flatMap((b) => ['-i', b.file]);
const delays = built.map((b, i) => `[${i}]adelay=${Math.round(b.at * 1000)}|${Math.round(b.at * 1000)}[d${i}]`).join(';');
const mix = `${built.map((_, i) => `[d${i}]`).join('')}amix=inputs=${built.length}:normalize=0:dropout_transition=0[m];[m]loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:${TOTAL}[out]`;
await run(FFMPEG, [...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', OUT]);

console.log(`\n${OUT}  ${(await ffprobeDuration(OUT)).toFixed(2)}s  voice=${VOICE}`);
if (!existsSync(OUT)) throw new Error('voiceover.mp3 was not written');
