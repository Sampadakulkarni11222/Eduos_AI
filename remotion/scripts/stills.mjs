/**
 * Renders review stills across the whole timeline (one bundle, many frames).
 *   node scripts/stills.mjs            # every 2.5 s at 40% scale → out/stills/
 *   node scripts/stills.mjs 12.5 64    # specific seconds
 */
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// `--out=<dir>` (relative to out/) keeps one cut's review frames from overwriting another's.
const outDir = path.join(root, 'out', (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=stills').split('=')[1]);
mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, 'src', 'index.ts'), publicDir: path.join(root, 'assets') });
// `--comp=<id>` picks the cut to review; the default is the narrated one.
const COMPOSITION = (process.argv.find((a) => a.startsWith('--comp=')) ?? '--comp=EduOSPromo').split('=')[1];
const composition = await selectComposition({ serveUrl, id: COMPOSITION });
const fps = composition.fps;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const seconds = args.length ? args : Array.from({ length: Math.floor(composition.durationInFrames / fps / 2.5) + 1 }, (_, i) => i * 2.5);

for (const s of seconds) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(s * fps));
  const output = path.join(outDir, `t${String(s.toFixed(1)).padStart(5, '0')}.jpg`);
  await renderStill({ composition, serveUrl, output, frame, scale: 0.4, imageFormat: 'jpeg', jpegQuality: 80 });
  console.log(`✔ ${s}s → ${path.basename(output)}`);
}
