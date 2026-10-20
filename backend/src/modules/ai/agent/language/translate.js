/**
 * A request written in an Indian language, read as the English request it is,
 * for ROUTING only -- from the curated lexicon (language/lexicon.js), with no
 * model.
 *
 * "राहुल की उपस्थिति दिखाओ"            -> "show Rahul's attendance"
 * "आज 6A में कौन अनुपस्थित है?"        -> "who is absent in class 6 A today?"
 * "माझ्या मुलाची फी किती बाकी आहे?"     -> "how much my child's fees pending?"
 * "நாளை வீட்டுப்பாடம் என்ன?"            -> "what is homework tomorrow?"
 *
 * What it does NOT do:
 *   - translate a name: a word the lexicon does not know is transliterated
 *     ("शर्मा" -> "Sharma"), and the directory search that follows is the
 *     tolerant one, which offers near matches and never picks one;
 *   - touch free text: everything after "कि" / "saying" / ":" or inside quotes
 *     (the words of a message, a reason) is kept exactly as written;
 *   - decide anything: the English sentence goes through the same readers, and
 *     every call still through the MCP server, with the same confirmation.
 * The person's own words are what the transcript keeps and what decides the
 * reply language.
 */
import { asciiDigits, capitalise, dominantScript, hasIndicScript, transliterateWord } from './scripts.js';
import { LEXICON, MARATHI_MARKERS, bestLexiconLanguage, entriesFor } from './lexicon.js';

const PAST_WORDS = /\b(?:attendance|absent|present|marks|result|late)\b|(?:था|थी|थे|आया|आई|गया|गई|हुआ|हुई|ছিল|ਸੀ)/u;

/** Which language an Indian-script text is in (null for Latin text). */
export function indicLanguageOf(text) {
  const s = String(text ?? '');
  if (!hasIndicScript(s)) return null;
  const script = dominantScript(s);
  if (!script) return null;
  if (script.script === 'deva') {
    const best = bestLexiconLanguage(s, ['hi', 'mr']);
    // A Marathi-only word settles it when the counts tie.
    const marathi = bestLexiconLanguage(s, ['mr']).hits;
    const hindi = bestLexiconLanguage(s, ['hi']).hits;
    if (marathi > hindi) return 'mr';
    if (marathi === hindi && MARATHI_MARKERS.test(s) && !/(?:है|हैं|दिखाओ|बताओ|कितनी|कितना|मेरी|मेरा|मेरे|कौन|क्या)/u.test(s)) return 'mr';
    return best.lang === 'mr' && marathi > hindi ? 'mr' : 'hi';
  }
  return script.langs[0];
}

const TOKEN = /[0-9]+|[ऀ-ൿ‌‍]+|[A-Za-z][A-Za-z'’.-]*|[?!.,;:।|"“”'()]/gu;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const COUNTABLE = /\b(?:students|children|absent|present|books|periods|subjects|notices|days)\b/i;
const RECORD_NOUN = /^(?:attendance|marks|fees|result|homework|timetable|report card|leave)$/;

/** Split off free text: "...कि <message>" keeps <message> as typed. */
function splitFreeText(text, idx) {
  const quote = /["“”]/u.exec(text);
  const colon = text.indexOf(':');
  let cut = -1;
  for (const e of idx.words) {
    if (e.kind !== 'f') continue;
    const re = new RegExp(`(^|[\\s,])${e.form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,]|$)`, 'u');
    const m = re.exec(text);
    if (m && (cut < 0 || m.index < cut)) cut = m.index + m[1].length;
  }
  const marks = [cut, quote ? quote.index : -1, colon].filter((n) => n >= 0);
  if (!marks.length) return { head: text, tail: '', intro: 'saying' };
  const at = Math.min(...marks);
  let tail = text.slice(at);
  let intro = 'saying';
  // Drop the introducing word itself ("कि", ":"), keep the words.
  for (const e of [...idx.words].sort((a, b) => b.form.length - a.form.length)) {
    if (e.kind === 'f' && tail.startsWith(e.form)) { tail = tail.slice(e.form.length); intro = e.en || 'saying'; break; }
  }
  return { head: text.slice(0, at), tail: tail.replace(/^\s*:\s*/, '').trim(), intro };
}

/** Longest lexicon match starting at token i (phrases of up to 5 words). */
function matchAt(tokens, i, idx) {
  for (let n = Math.min(5, tokens.length - i); n >= 1; n -= 1) {
    const words = tokens.slice(i, i + n);
    if (words.some((w) => !/[ऀ-ൿ]/u.test(w) && !/^[-]$/.test(w))) {
      if (n > 1) continue;
    }
    const form = words.join(' ');
    const hit = idx.byForm.get(form) ?? (n > 1 ? idx.byForm.get(words.join('-')) : null);
    if (hit) return { entry: hit, length: n };
  }
  return null;
}

/** A word with a case ending joined to it: "राहुलची" -> Rahul + 's. */
/* The virama of each script: Tamil "மகனின்" is "மகன்" + "இன்", written without the stem's pulli. */
const VIRAMA_OF = { ta: '்', te: '్', kn: '್', hi: '्', mr: '्', gu: '્', bn: '্', pa: '੍' };

function stripSuffix(word, idx, lang) {
  let fallback = null;
  for (const [suffix, kind, en] of idx.suffixes) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
    const stem = word.slice(0, -suffix.length);
    const known = idx.byForm.get(stem) ?? (VIRAMA_OF[lang] ? idx.byForm.get(stem + VIRAMA_OF[lang]) : null)
      // Tamil drops a word's final -u before a vowel ending ("வகுப்பு" + "இல்" = "வகுப்பில்").
      ?? (lang === 'ta' ? idx.byForm.get(`${stem}ு`) : null);
    if (known) return { stem: known, kind, en };
    // An unknown stem is taken as a name only when it is a real word on its own (two letters or more).
    if (!fallback && [...stem].length >= 2) fallback = { stem: null, stemWord: stem, kind, en };
  }
  return fallback;
}

/**
 * The English routing reading of an Indian-language message, or null when
 * the message is not in an Indian script.
 * Returns { text, lang, coverage, names } -- coverage is the share of words the
 * lexicon understood (names excluded), used to decide whether a model
 * translation would help.
 */
export function nativeToEnglish(message, { lang: hinted } = {}) {
  const original = String(message ?? '').normalize('NFC');
  if (!hasIndicScript(original)) return null;
  const lang = (hinted && LEXICON[hinted] && indicLanguageOf(original) === hinted) ? hinted : indicLanguageOf(original);
  const idx = entriesFor(lang);
  if (!idx) {
    // No lexicon for this language (Malayalam, Odia): names can still be read.
    const text = asciiDigits(original).replace(/[ऀ-ൿ]+/gu, (w) => capitalise(transliterateWord(w)));
    return { text, lang, coverage: 0, names: [] };
  }

  // A whole message that is "yes" or "no".
  const bare = original.trim().replace(/[\s।.!?]+$/u, '');
  const yn = idx.words.find((e) => (e.kind === 'y' || e.kind === 'x') && e.form === bare);
  if (yn) return { text: yn.en, lang, coverage: 1, names: [] };

  const { head, tail, intro } = splitFreeText(asciiDigits(original), idx);
  const raw = head.match(TOKEN) ?? [];
  const items = [];
  let known = 0;
  let unknown = 0;
  const names = [];
  for (let i = 0; i < raw.length; i += 1) {
    const tok = raw[i];
    if (/^[?!.,;:।|"“”'()]$/u.test(tok)) { items.push({ kind: 'punct', en: tok === '।' ? '.' : tok }); continue; }
    if (/^[0-9]+$/.test(tok)) { items.push({ kind: 'num', en: tok }); continue; }
    if (/^[A-Za-z]/.test(tok)) {
      const lower = tok.toLowerCase();
      if (NUMBER_WORDS[lower] && /^class$/i.test(items.at(-1)?.en ?? '')) items.push({ kind: 'num', en: String(NUMBER_WORDS[lower]) });
      else items.push({ kind: 'n', en: tok, latin: true });
      continue;
    }
    const hit = matchAt(raw, i, idx);
    if (hit) {
      known += hit.length;
      items.push({ kind: hit.entry.kind, en: hit.entry.en });
      i += hit.length - 1;
      continue;
    }
    // Tamil joins a doubled consonant to the next word ("அறிவிப்புகளைக் காட்டு"): read the word without it.
    if (lang === 'ta' && /[கசதப]்$/u.test(tok) && [...tok].length > 3) {
      const bare = tok.slice(0, -2);
      const again = idx.byForm.get(bare);
      if (again) { known += 1; items.push({ kind: again.kind, en: again.en }); continue; }
      raw[i] = bare;
      i -= 1;
      continue;
    }
    const split = stripSuffix(tok, idx, lang);
    if (split) {
      if (split.stem) { known += 1; items.push({ kind: split.stem.kind, en: split.stem.en }); }
      else { const name = capitalise(transliterateWord(split.stemWord)); names.push(name); items.push({ kind: 'name', en: name }); }
      if (split.kind === 's') items.push({ kind: 's', en: "'s" });
      else if (split.kind === 'p') items.push({ kind: 'p', en: split.en });
      continue;
    }
    unknown += 1;
    const name = capitalise(transliterateWord(tok));
    names.push(name);
    items.push({ kind: 'name', en: name });
  }

  const text = assemble(items, { original, tail, intro });
  const coverage = known + unknown ? known / (known + unknown - Math.min(unknown, names.length > 0 ? 2 : 0) || 1) : 0;
  return { text, lang, coverage: Math.max(0, Math.min(1, coverage)), names };
}

/* Assemble English from the lexicon items: verbs and question words first, then content, then places, then time. */
function assemble(items, { original, tail, intro = 'saying' }) {
  const verbs = [];
  let question = null;
  const content = [];
  const places = [];
  const times = [];
  let np = [];
  const flushNp = () => { content.push(...np); np = []; };
  const pps = [];

  // Class references: "कक्षा 6 ए", "6ए", "छठी कक्षा ए", "class 6 B".
  const merged = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const next = items[i + 1];
    const after = items[i + 2];
    if (it.kind === 'c' && next && (next.kind === 'num' || next.kind === 'o')) {
      const section = after && (after.kind === 'z' || (after.latin && /^[A-Ha-h]$/.test(after.en))) ? ` ${after.en.toUpperCase()}` : '';
      merged.push({ kind: 'n', en: `class ${next.en}${section}`, classRef: true });
      i += section ? 2 : 1;
      continue;
    }
    if ((it.kind === 'num' || it.kind === 'o') && next && (next.kind === 'z' || (next.latin && /^[A-Ha-h]$/.test(next.en)))) {
      // "6 ए", "छठी ए" -- optionally followed by "कक्षा".
      merged.push({ kind: 'n', en: `class ${it.en} ${next.en.toUpperCase()}`, classRef: true });
      i += 1;
      if (after?.kind === 'c') i += 1;
      continue;
    }
    if (it.kind === 'o' && next?.kind === 'c') {
      const section = after && after.kind === 'z' ? ` ${after.en}` : '';
      merged.push({ kind: 'n', en: `class ${it.en}${section}`, classRef: true });
      i += section ? 2 : 1;
      continue;
    }
    if (it.kind === 'c') { merged.push({ kind: 'n', en: 'class' }); continue; }
    if (it.kind === 'z' || it.kind === 'o') { merged.push({ kind: 'n', en: it.kind === 'o' ? it.en : it.en }); continue; }
    if (it.latin && /^\d{1,2}[A-Ha-h]$/.test(it.en)) { merged.push({ kind: 'n', en: `class ${it.en.slice(0, -1)} ${it.en.slice(-1).toUpperCase()}`, classRef: true }); continue; }
    merged.push(it);
  }

  // "आणि 5A?", "और कल?": a follow-up that starts with "and" stays one ("and class 5 A?"),
  // so the follow-up readers continue the last question.
  if (merged[0]?.kind === 'j') {
    const rest = merged.slice(1).filter((it) => !['d', 'punct', 'j'].includes(it.kind))
      .map((it) => (it.en === '@kal' ? (PAST_WORDS.test(original) ? 'yesterday' : 'tomorrow') : it.en));
    if (rest.length && rest.length <= 4) return `and ${rest.join(' ')}?`;
  }
  const anyVerb = merged.some((it) => it.kind === 'v');
  const sends = merged.some((it) => it.kind === 'v' && /^(?:send|tell me)$/.test(it.en));
  let endsQuestion = /[?？]\s*$/u.test(original);
  let prevName = false;
  for (const it of merged) {
    const wasName = prevName;
    prevName = it.kind === 'name';
    switch (it.kind) {
      case 'v': if (!verbs.includes(it.en)) verbs.push(it.en); break;
      case 'q': if (!question) question = it.en; endsQuestion = true; break;
      case 't': {
        const en = it.en === '@kal' ? (PAST_WORDS.test(merged.map((m) => m.en).join(' ') + original) ? 'yesterday' : 'tomorrow') : it.en;
        if (!times.includes(en)) times.push(en);
        break;
      }
      case 'd': case 'f': case 'y': case 'x': break;
      case 's': {
        const last = np.at(-1);
        if (last && !/^(?:class\b|\d|today|tomorrow|yesterday|my|his)/i.test(last) && !/'s$/.test(last)) np[np.length - 1] = `${last}'s`;
        break;
      }
      case 'p': {
        if (!np.length) break;
        if (it.en === 'to' && !sends) { flushNp(); break; }
        if (it.en === 'to' || it.en === 'from') { pps.push(`${it.en} ${np.join(' ')}`); np = []; break; }
        if (it.en === 'in' && np.every((w) => /^class\b/i.test(w) || /^\d/.test(w))) { places.push(`in ${np.join(' ')}`); np = []; break; }
        pps.push(`${it.en} ${np.join(' ')}`);
        np = [];
        break;
      }
      case 'punct': if (it.en === '?') endsQuestion = true; break;
      default:
        // "ராகுல் வருகை": a name straight before a record word is whose record it is.
        if (RECORD_NOUN.test(it.en) && wasName && np.length && !/'s$/.test(np.at(-1))) np[np.length - 1] = `${np.at(-1)}'s`;
        np.push(it.en);
    }
  }
  flushNp();

  let lead = '';
  const action = verbs.filter((v) => !/^(?:show|tell me)$/.test(v));
  if (question && !action.length) {
    const body = content.join(' ');
    lead = question === 'how much' && COUNTABLE.test(body) ? 'how many'
      : question === 'who' ? 'who is'
        : question === 'what' ? 'what is'
          : question === 'when' ? 'when is'
            : question === 'where' ? 'where is'
              : question;
  } else if (verbs.length) {
    lead = (action.length ? action : verbs).join(' ');
  } else if (content.length) {
    lead = 'show';
  }
  // "my child's attendance" stays together; a place ("in class 6 A") and the
  // other phrases follow the content, the time comes last.
  const parts = [lead, content.join(' '), ...pps, ...places, ...times].filter(Boolean);
  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (tail) text = `${text} ${intro} ${tail}`;
  else if (endsQuestion && !/[?]$/.test(text)) text = `${text}?`;
  void anyVerb;
  return text;
}
