/**
 * Renders the same two EduOS lines in each candidate voice, so the voice can
 * be chosen by ear rather than by name.
 *
 *   node scripts/voice-samples.mjs
 *
 * Output: out/voice-samples/<voice>.mp3, plus all-voices.mp3 — one file that
 * announces each voice and then speaks, for listening straight through.
 *
 * The multilingual voices are Microsoft's newest and generally the most
 * natural; the en-IN pair are the ones that sound local to this market.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const COMPOSITOR = path.join(ROOT, 'node_modules', '@remotion', `compositor-${process.platform}-${process.arch}-msvc`);
const EXE = process.platform === 'win32' ? '.exe' : '';
const FFMPEG = path.join(COMPOSITOR, `ffmpeg${EXE}`);
const OUT = path.join(ROOT, 'out', 'voice-samples');

const VOICES = [
  { id: 'en-IN-NeerjaNeural', label: 'Neerja, Indian English, female — the current voice' },
  { id: 'en-IN-NeerjaExpressiveNeural', label: 'Neerja Expressive, Indian English, female' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat, Indian English, male' },
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava, US English, female' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew, US English, male' },
  { id: 'en-US-EmmaMultilingualNeural', label: 'Emma, US English, female' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia, British English, female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan, British English, male' },
];

// Two lines actually used in the promos: an opener and the assistant line.
const LINE = "EduOS — one intelligent platform for every school. Ask in plain language, and EduOS answers from your school's data, within your permissions.";
const RATE = 12;

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`))));
  });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const parts = [];
for (const v of VOICES) {
  const solo = path.join(OUT, `${v.id}.mp3`);
  await run('python', ['-m', 'edge_tts', '--voice', v.id, `--rate=+${RATE}%`, '--text', LINE, '--write-media', solo]);
  // For the combined reel, the voice introduces itself first.
  const intro = path.join(OUT, `.${v.id}.intro.mp3`);
  await run('python', ['-m', 'edge_tts', '--voice', v.id, `--rate=+${RATE}%`, '--text', `${v.label}.`, '--write-media', intro]);
  parts.push(intro, solo);
  console.log(`✔ ${v.id}`);
}

const inputs = parts.flatMap((f) => ['-i', f]);
const filter = `${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`;
await run(FFMPEG, [...inputs, '-filter_complex', filter, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', path.join(OUT, 'all-voices.mp3')]);
console.log(`\n${path.join(OUT, 'all-voices.mp3')} — every candidate, in order`);
