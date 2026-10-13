/**
 * Renders the launcher icons in public/icons from the EduOS AI mark.
 *
 * The geometry is the one in src/app/icon.svg (the 32-unit "E" on the cream
 * plate), redrawn here at two framings:
 *
 *   any       the rounded plate, as the favicon shows it
 *   maskable  a full-bleed plate with the mark inside the central 80% safe
 *             zone, so Android can crop it to a circle, squircle or teardrop
 *             without cutting into the letter
 *
 * The PNGs are committed, so this only needs running when the mark changes:
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));

const GRADIENT = `
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#F2E4CC"/>
      <stop offset="1" stop-color="#D8B98A"/>
    </linearGradient>
  </defs>`;

// The "E" exactly as icon.svg draws it, in that file's 32-unit space.
const MARK = `
  <g fill="#591620">
    <rect x="10.4" y="8" width="3.6" height="16" rx="1"/>
    <rect x="10.4" y="8" width="11.2" height="3.4" rx="1"/>
    <rect x="10.4" y="14.4" width="8.6" height="3.1" rx="1"/>
    <rect x="10.4" y="20.6" width="11.2" height="3.4" rx="1"/>
  </g>`;

const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${GRADIENT}
  <rect width="32" height="32" rx="8" fill="url(#brand)"/>${MARK}
</svg>`;

// Scaled to 62% about the centre: the mark's bounding box then sits well
// inside the 80%-diameter circle every Android mask is guaranteed to keep.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${GRADIENT}
  <rect width="32" height="32" fill="url(#brand)"/>
  <g transform="translate(16 16) scale(0.62) translate(-16 -16)">${MARK}</g>
</svg>`;

const TARGETS = [
  { file: 'icon-192.png', svg: any, size: 192 },
  { file: 'icon-512.png', svg: any, size: 512 },
  { file: 'icon-maskable-192.png', svg: maskable, size: 192 },
  { file: 'icon-maskable-512.png', svg: maskable, size: 512 },
  // iOS draws its own corners and does not honour transparency, so it gets the
  // full-bleed plate with the mark at its usual size.
  { file: 'apple-touch-icon.png', svg: any.replace('rx="8" fill', 'rx="0" fill'), size: 180 },
];

await mkdir(OUT, { recursive: true });
for (const { file, svg, size } of TARGETS) {
  await sharp(Buffer.from(svg), { density: 72 * (size / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}${file}`);
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}
