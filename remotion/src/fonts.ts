import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/**
 * The product's two faces (frontend/src/app/globals.css): Newsreader for
 * headings, Hanken Grotesk for everything else.
 *
 * Self-hosted from assets/fonts (Google Fonts' variable Latin files, both
 * SIL Open Font License) rather than fetched at render time, so a render
 * never depends on the network and never falls back to a system face.
 */
export const DISPLAY = "'Newsreader', Georgia, serif";
export const BODY = "'Hanken Grotesk', system-ui, sans-serif";

const FACES = [
  { family: 'Newsreader', file: 'fonts/Newsreader-latin.woff2' },
  { family: 'Hanken Grotesk', file: 'fonts/HankenGrotesk-latin.woff2' },
];

if (typeof document !== 'undefined') {
  const handle = delayRender('Loading EduOS fonts');
  Promise.all(
    FACES.map(async ({ family, file }) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, { weight: '200 900', style: 'normal' });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    // Fail loudly: a promo silently rendered in a fallback face is worse than no render.
    .catch((err) => cancelRender(err));
}
