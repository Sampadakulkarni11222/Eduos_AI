/**
 * Indian scripts: which one a word is written in, and a Latin spelling of a
 * word nobody has a dictionary entry for (a person's name, a book title).
 *
 * Every Brahmic script in Unicode is laid out on the same plan (they all
 * descend from ISCII): the letter for "ka" sits at offset 0x15 of the
 * Devanagari block, of the Bengali block, of the Tamil block, and so on. So
 * ONE table of offsets transliterates all nine scripts used in Indian schools.
 *
 * This is transliteration, never translation: "राहुल शर्मा" becomes
 * "Rahul Sharma" (the same name, in Latin letters) so the student directory,
 * which stores names in Latin script, can be searched -- and the search is the
 * tolerant one (utils/peopleNames.js), which offers near matches and never
 * picks one on the person's behalf. The original words are always kept.
 */

export const SCRIPTS = [
  { script: 'deva', base: 0x0900, langs: ['hi', 'mr'] },
  { script: 'beng', base: 0x0980, langs: ['bn'] },
  { script: 'guru', base: 0x0a00, langs: ['pa'] },
  { script: 'gujr', base: 0x0a80, langs: ['gu'] },
  { script: 'orya', base: 0x0b00, langs: ['or'] },
  { script: 'taml', base: 0x0b80, langs: ['ta'] },
  { script: 'telu', base: 0x0c00, langs: ['te'] },
  { script: 'knda', base: 0x0c80, langs: ['kn'] },
  { script: 'mlym', base: 0x0d00, langs: ['ml'] },
];

/** The script block a character belongs to, or null for anything else. */
export function scriptOf(ch) {
  const cp = ch.codePointAt(0);
  for (const s of SCRIPTS) if (cp >= s.base && cp < s.base + 0x80) return s;
  return null;
}

/** The dominant Indic script of a text (by letter count), or null. */
export function dominantScript(text) {
  const counts = new Map();
  for (const ch of String(text ?? '')) {
    const s = scriptOf(ch);
    if (s) counts.set(s.script, (counts.get(s.script) ?? 0) + 1);
  }
  let best = null;
  for (const [script, n] of counts) if (!best || n > best.n) best = { script, n };
  return best ? SCRIPTS.find((s) => s.script === best.script) : null;
}

export const hasIndicScript = (text) => /[ऀ-ൿ]/.test(String(text ?? ''));

/* Offsets within a block. */
const INDEPENDENT_VOWELS = {
  0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo', 0x0b: 'ri', 0x0c: 'li',
  0x0d: 'e', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au',
  0x60: 'ri', 0x61: 'li',
};
const CONSONANTS = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'n',
  0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'n',
  0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n',
  0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
  0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm',
  0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh', 0x35: 'v',
  0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
  // Nukta letters (Devanagari) and their look-alikes.
  0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'r', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
};
const VOWEL_SIGNS = {
  0x3e: 'a', 0x3f: 'i', 0x40: 'i', 0x41: 'u', 0x42: 'u', 0x43: 'ri', 0x44: 'ri',
  0x45: 'e', 0x46: 'e', 0x47: 'e', 0x48: 'ai', 0x49: 'o', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au',
  0x62: 'li', 0x63: 'li', 0x57: 'au',
};
const VIRAMA = 0x4d;
const NUKTA = 0x3c;
const SIGNS = { 0x01: 'n', 0x02: 'n', 0x03: 'h' };
/* Gurmukhi tippi / addak, Malayalam chillus, Bengali khanda ta. */
const EXTRA = { guru: { 0x70: 'n', 0x71: '' }, mlym: { 0x7a: 'n', 0x7b: 'n', 0x7c: 'r', 0x7d: 'l', 0x7e: 'l', 0x7f: 'k' }, beng: { 0x4e: 't' } };
/* Scripts whose words end in a spoken consonant (the inherent vowel is dropped). */
const SCHWA_DELETING = new Set(['deva', 'beng', 'guru', 'gujr', 'orya']);

/** Indic digits (any block) -> ASCII digits. */
export function asciiDigits(text) {
  return String(text ?? '').replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g,
    (ch) => String((ch.codePointAt(0) & 0x0f) - 6));
}

/**
 * A Latin spelling of one word written in an Indian script.
 * "राहुल" -> "rahul", "शर्मा" -> "sharma", "ராகுல்" -> "rakul".
 */
export function transliterateWord(word) {
  const chars = [...String(word ?? '')];
  let out = '';
  let pending = false; // a consonant waiting for its vowel
  let script = null;
  const flush = () => { if (pending) { out += 'a'; pending = false; } };
  for (const ch of chars) {
    const s = scriptOf(ch);
    if (!s) { flush(); out += ch; continue; }
    script = script ?? s.script;
    const off = ch.codePointAt(0) - s.base;
    if (off === NUKTA) continue;
    if (EXTRA[s.script]?.[off] !== undefined) { flush(); out += EXTRA[s.script][off]; continue; }
    if (CONSONANTS[off]) { flush(); out += CONSONANTS[off]; pending = true; continue; }
    if (VOWEL_SIGNS[off]) { out += VOWEL_SIGNS[off]; pending = false; continue; }
    if (off === VIRAMA) { pending = false; continue; }
    if (INDEPENDENT_VOWELS[off]) { flush(); out += INDEPENDENT_VOWELS[off]; continue; }
    if (SIGNS[off]) { flush(); out += SIGNS[off]; continue; }
    if (off >= 0x66 && off <= 0x6f) { flush(); out += String(off - 0x66); continue; }
    flush();
  }
  // The inherent vowel at the end of a word is not spoken in Hindi, Marathi,
  // Gujarati, Punjabi or Bengali ("कमल" is "kamal", not "kamala").
  if (pending && !SCHWA_DELETING.has(script)) out += 'a';
  return out;
}

/** Every Indic word in a text transliterated, other text left as it is. */
export function transliterate(text) {
  return String(text ?? '').replace(/[ऀ-ൿ]+/g, (w) => transliterateWord(w));
}

/** "rahul" -> "Rahul". */
export const capitalise = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
