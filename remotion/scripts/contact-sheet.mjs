// Tiles out/stills/*.jpg into contact sheets for review: out/stills/sheet-N.png
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const dir = path.resolve(import.meta.dirname, '..', 'out', process.argv[3] ?? 'stills');
const files = readdirSync(dir).filter((f) => /^t.*\.jpg$/.test(f)).sort();
const per = Number(process.argv[2] ?? 12);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (let s = 0; s * per < files.length; s++) {
  const chunk = files.slice(s * per, s * per + per);
  const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(3,640px);gap:0">${chunk
    .map((f) => `<div style="position:relative"><img style="width:640px;display:block" src="data:image/jpeg;base64,${readFileSync(path.join(dir, f)).toString('base64')}"><span style="position:absolute;left:6px;top:4px;background:#000;color:#ff0;font:bold 20px sans-serif;padding:2px 6px">${f.slice(1, -4)}s</span></div>`)
    .join('')}</body>`;
  await page.setContent(html);
  await page.screenshot({ path: path.join(dir, `sheet-${s + 1}.png`), fullPage: true });
  console.log(`sheet-${s + 1}.png: ${chunk[0]} … ${chunk.at(-1)}`);
}
await browser.close();
