/**
 * Spelling tolerance for what people type to the assistant: "atendance",
 * "fess", "hw", "tmrw", "class six A", "timetabel".
 *
 * Three layers, each conservative:
 *   1. Shorthand people really use ("hw", "att", "tmrw", "plz") -- an exact
 *      table, with context where one shorthand means two things ("hw many" is
 *      "how many", "hw" alone is homework).
 *   2. Class references said in words or roman numerals ("class six A",
 *      "std VI-B") -- written the way every reader already understands.
 *   3. Misspelt school words, by Damerau-Levenshtein distance against the
 *      assistant's own vocabulary (the words its readers and tools use).
 *
 * The rule for layer 3: correct only when unambiguous. A word is corrected
 * when it is not an English word or a name we know, and exactly one family of
 * school words is closest to it within a distance that grows with its length.
 * Two families equally close ("rote": route or note) is a question back --
 * "Did you mean …?" -- never a guess. Names are never corrected here at all:
 * a person is found by the directory's tolerant search, which OFFERS near
 * matches (utils/peopleNames.js) and never picks one; and a write always shows
 * its draft for confirmation, so nothing is acted on from a guessed target.
 *
 * Free text is left exactly as typed: the words of a message, a title, a
 * reason (everything after "saying", "titled", "because", ":" or a quote).
 */

/** Families of school words: [canonical, ...variants it may be misspelt from]. */
const FAMILIES = [
  ['attendance'], ['absent', 'absentees'], ['present'], ['late'],
  ['marks', 'mark'], ['result', 'results'], ['grades', 'grade'], ['report'], ['exam', 'exams', 'examination'],
  ['fees', 'fee'], ['invoice', 'invoices'], ['payment', 'payments'], ['pending'], ['balance'], ['receipt', 'receipts'], ['outstanding'], ['overdue'],
  ['homework'], ['assignment', 'assignments'], ['submission', 'submissions'],
  ['timetable'], ['schedule'], ['period', 'periods'],
  ['notice', 'notices'], ['announcement', 'announcements'], ['circular', 'circulars'],
  ['leave', 'leaves'], ['holiday', 'holidays'], ['application'],
  ['meeting', 'meetings'], ['parents', 'parent'], ['teacher', 'teachers'], ['student', 'students'], ['children', 'child'],
  ['class', 'classes'], ['section'], ['subject', 'subjects'], ['syllabus'],
  ['transport'], ['bus', 'buses'], ['route', 'routes'], ['driver'], ['library'], ['book', 'books'], ['issue', 'issued'], ['return', 'returned'],
  ['hostel'], ['rooms', 'room'], ['occupancy'], ['residents', 'resident'], ['collection', 'collections'], ['structure', 'structures'], ['profile'], ['certificate', 'certificates'], ['admission', 'admissions'], ['enquiry', 'enquiries'], ['visitor', 'visitors'],
  ['salary', 'payslip'], ['staff'], ['department'], ['calendar'], ['event', 'events'], ['complaint', 'complaints'], ['request', 'requests'],
  ['today'], ['tomorrow'], ['yesterday'], ['week'], ['month'], ['morning'], ['afternoon'],
  ['monday'], ['tuesday'], ['wednesday'], ['thursday'], ['friday'], ['saturday'], ['sunday'],
  ['january'], ['february'], ['march'], ['april'], ['august'], ['september'], ['october'], ['november'], ['december'],
  ['show'], ['list'], ['tell'], ['send'], ['message', 'messages'], ['apply'], ['create'], ['cancel'], ['approve'], ['reject'], ['update'], ['delete'], ['record'], ['schedule'],
  ['which'], ['what'], ['when'], ['where'], ['who'], ['how'], ['many'], ['much'], ['please'],
  ['mathematics', 'maths'], ['science'], ['english'], ['hindi'], ['history'], ['geography'], ['physics'], ['chemistry'], ['biology'], ['computer'], ['sanskrit'], ['marathi'], ['economics'], ['accountancy'],
  ['percentage'], ['average'], ['summary'], ['details'], ['total'], ['performance'], ['progress'],
  ['daughter'], ['son'], ['principal'], ['nurse'], ['warden'], ['librarian'], ['accountant'],
];

const CANON = new Map();
for (const family of FAMILIES) for (const w of family) if (!CANON.has(w)) CANON.set(w, family[0]);
const VOCAB = [...CANON.keys()];

/** Common English words: never "corrected" into a school word. */
const ENGLISH = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing done down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself
able add added address after ago all allow already always among another answer anyone anything april area around ask asked away back bad base based bed best better big bill bit black blue body boy boys bring brother build bus busy buy call came car care case cash change check checked city clear close cold come coming copy cost count course cover cut dad daily data date day days dear detail did die different dinner doctor door draft drop due early easy eat else email end enough entry even evening ever every everyone example face fact family far father feel field file fill final find fine first five floor follow food form four free friend front full fun game gave get getting girl girls give given go goes going gone good got great green group had half hall hand happy hard head health hear held hello help hi high hold home hope hour hours house idea info inside instead item join keep kept kind knew know last later learn least left less let letter level life like line link little live long look lost lot love low mail main make many may maybe mean meet member menu might mind minute miss mobile mom money more mother move mr mrs ms much must name names near need never new news next nice night nine none note nothing number off office often ok okay old once one online open order others out page paid paper part party pass past pay people per person phone pick place plan play plus point post power price print problem put question quick quiz rate read ready real really red rest right road room rule run said save saw say school score see seen sell set seven share short side sign since sir six size small soon sorry sort start state stay step still stop story study sure take taken talk team term test text thank thanks thing things think three time times title top total town tried true try turn two type unit upon us use used user using view visit wait want wanted was watch way well went whole why win wise word work world write wrong year years yes yet young zero
absence admin admit agenda allot alumni amount art assembly band bank belt bench bills blank board bonus books born box break brief bulk camp canteen card cards cell chair chart class clubs code coach coach cohort colour concern contact counsellor credit day desk diary diet drill dress duty exit fail fair fine fitness foot fund gate gender gift goal grant gym hand hindi hostel id ink jobs kit lab labs lane leader lesson loan log lunch map match meal medical merit mid mock mode model note notes oral pace pack pass pen pick pickup plan pool prize pupil quiz rank rate refund remark remarks rent roll room row rule safety scan seat seats shift sick slip slot sport sports staff stage star stock store sum swim tab tag task tax term tie tour track trip tuition uniform van ward wing zone
clash clashes chat chats lake river glass glasses wear wears reach reaches retire retired approval approvals compute computes computed reissue reissued markets market marking marker remind reminder reminded teach teacher learn study visit visits explain compare between across within without whose upcoming recent latest current previous overall weekly monthly yearly annual daily remaining left unpaid paid due dues owe owed collect collected collection outstanding available free busy open closed final first last next mark marked marking marks list listed lists show shows showed tell told send sent message apply applied create created cancel cancelled approve approved reject rejected update updated delete deleted record recorded issue issued return returned book booked pay paying paid`.split(/\s+/).filter(Boolean));

/** True when a word is a known word with an English ending ("visits", "teaches", "balances", "marked"). */
function knownInflection(lower) {
  const stems = [];
  if (lower.endsWith('ies')) stems.push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith('es')) stems.push(lower.slice(0, -2));
  if (lower.endsWith('s') && !lower.endsWith('ss')) stems.push(lower.slice(0, -1));
  if (lower.endsWith('ed')) stems.push(lower.slice(0, -2), lower.slice(0, -1));
  if (lower.endsWith('ing')) stems.push(lower.slice(0, -3), `${lower.slice(0, -3)}e`);
  if (lower.endsWith('er')) stems.push(lower.slice(0, -2), lower.slice(0, -1));
  if (lower.endsWith('ly')) stems.push(lower.slice(0, -2));
  return stems.some((w) => w.length >= 3 && (ENGLISH.has(w) || CANON.has(w)));
}

/** Romanised Hindi words (never names, never misspellings). */
const HINGLISH = new Set('aaj kal parso dikhao batao bata kaun kitni kitna kitne meri mera mere apna apni pichle agle mahine hafte mein hai hain tha thi aur kaisi kaisa kaise kya kab nahi nahin haazri hajri bachche ki ka ke karo bhejo chutti'.split(' '));

/** Shorthand typed for the whole word (exact, case-insensitive). */
const SHORTHAND = {
  att: 'attendance', attn: 'attendance', attnd: 'attendance', atten: 'attendance', attd: 'attendance', attendnc: 'attendance',
  tt: 'timetable', 't/t': 'timetable', 'time-table': 'timetable',
  'h/w': 'homework', 'home-work': 'homework', hmwk: 'homework', hmw: 'homework',
  tmrw: 'tomorrow', tmr: 'tomorrow', tmrrw: 'tomorrow', tomo: 'tomorrow', tomoro: 'tomorrow', tommorow: 'tomorrow', tommorrow: 'tomorrow', '2moro': 'tomorrow', '2mrw': 'tomorrow', '2mro': 'tomorrow', tmro: 'tomorrow',
  tdy: 'today', '2day': 'today', tday: 'today', yday: 'yesterday', ystrdy: 'yesterday', yest: 'yesterday', ysterday: 'yesterday',
  plz: 'please', pls: 'please', plzz: 'please', msg: 'message', msgs: 'messages', mesage: 'message',
  lib: 'library', asgmt: 'assignment', assgn: 'assignment', assgnmt: 'assignment', asmt: 'assignment',
  cls: 'class', clas: 'class', stdnt: 'student', stdnts: 'students', studnt: 'student', studnts: 'students',
  tchr: 'teacher', techer: 'teacher', mths: 'maths', sci: 'science', eng: 'english', hin: 'hindi',
  wat: 'what', wht: 'what', whn: 'when', whr: 'where',
  abs: 'absent', absnt: 'absent', ntc: 'notice', annc: 'announcement', anmt: 'announcement',
  pmt: 'payment', pymt: 'payment', bal: 'balance', inv: 'invoice', amt: 'amount',
  wk: 'week', mnth: 'month', tues: 'tuesday', thur: 'thursday', thurs: 'thursday',
  shw: 'show', sho: 'show', snd: 'send', lst: 'list', mrk: 'mark', mrks: 'marks', reslt: 'result', rslt: 'result',
};

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/** A request to change something (its target is never re-spelt; see correctSpelling). */
const WRITE_REQUEST = /\b(?:mark|record|send|message|apply|create|add|issue|cancel|approve|reject|book|pay|update|change|delete|set|assign|remove|move|reschedule|enter|publish|notify|remind|allot|allocate|return|renew|submit)\b/i;

/** Words that start free text: what follows is kept exactly as typed. */
const FREE_TEXT = /\b(?:saying|that\s+says|says|titled|title\s+is|called|reason(?:\s+is)?|because|body|note\s+that|tell\s+them|write)\b|["“”:]/i;

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** How far a word of this length may be from the one it was meant to be. */
function allowance(length) {
  if (length < 4) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

/**
 * A phonetic key for Indian names written in Latin letters, so the spellings
 * of one name meet: "Sharma"/"Sarma", "Pooja"/"Puja", "Kapoor"/"Kapur",
 * "Vikas"/"Wikas", "Shreya"/"Sreya", "Mohammad"/"Mohammed".
 */
export function phoneticKey(word) {
  let s = String(word ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/chh/g, 'c').replace(/ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'f')
    .replace(/([bdgkt])h/g, '$1').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/ck/g, 'k')
    .replace(/x/g, 'ks').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u').replace(/aa/g, 'a')
    .replace(/y$/, 'i').replace(/ie$/, 'i').replace(/([aeiou])h$/, '$1').replace(/e(?=d$)/, 'a');
  return s.replace(/(.)\1+/g, '$1');
}

/** 0..1: how alike two names sound (by phonetic key). */
export function phoneticSimilarity(a, b) {
  const x = String(a ?? '').split(/\s+/).map(phoneticKey).filter(Boolean).join(' ');
  const y = String(b ?? '').split(/\s+/).map(phoneticKey).filter(Boolean).join(' ');
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

/** "class six A", "std VI-B", "grade 6-a" -> "class 6 A". */
export function normaliseClassWords(text) {
  return String(text ?? '').replace(
    /\b(class|std|standard|grade)\s+([a-z]+|\d{1,2})(?:\s*(?:-|–)?\s*(?:section\s+)?([a-h]))?(?![\w'])/gi,
    (whole, cue, grade, section) => {
      // Digits are already read by every reader ("Class 6-A", "class 6a"); only words and numerals are rewritten.
      if (/^\d+$/.test(grade)) return whole;
      const g = NUMBER_WORDS[grade.toLowerCase()] ?? ROMAN[grade.toLowerCase()];
      // "class i" alone is the pronoun ("is it a class I can see"): only with a section.
      if (!g || g > 12) return whole;
      if (ROMAN[grade.toLowerCase()] && !section && /^(?:i|x|v)$/i.test(grade)) return whole;
      return `${cue} ${g}${section ? ` ${section.toUpperCase()}` : ''}`;
    },
  );
}

/** The closest school words to a token, with their distance. */
function candidatesFor(token) {
  const max = allowance(token.length);
  if (!max) return [];
  const out = [];
  for (const word of VOCAB) {
    if (Math.abs(word.length - token.length) > max) continue;
    const sameStart = word[0] === token[0] || (word[0] === token[1] && word[1] === token[0]);
    if (!sameStart) continue;
    const d = editDistance(token, word);
    if (d === 0 || d > max) continue;
    // One slip: a five-letter word or longer, or a four-letter one into the
    // handful of short school words ("fess" -> fees). Two slips: only in a long word.
    const ok = d === 1
      ? (token.length >= 5 || SHORT_TARGETS.has(word))
      : token.length >= 8 && d / Math.max(word.length, token.length) <= 0.2;
    if (ok) out.push({ word, canon: CANON.get(word), d });
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Four-letter words a four-letter slip may be corrected into. */
const SHORT_TARGETS = new Set(['fees', 'exam', 'book', 'mark', 'marks', 'leave', 'late', 'class', 'bus', 'room', 'rooms']);

/** Words of the message that make one candidate the obvious one ("bus rote" -> route). */
const CONTEXT = {
  route: /\b(?:bus|transport|stop|driver|van)\b/i, notice: /\b(?:board|school|new|latest|circular)\b/i,
  marks: /\b(?:exam|test|maths?|science|english|subject|result)\b/i, fees: /\b(?:pay|paid|pending|due|invoice|balance|amount)\b/i,
  book: /\b(?:library|issue|return|overdue|title|author)\b/i, leave: /\b(?:apply|sick|day|days|casual|half)\b/i,
};

/**
 * The message with its spelling corrected where that is unambiguous.
 *
 * @param {string} message
 * @param {{ protect?: Set<string>, people?: string[], known?: Set<string> }} [opts] lower-case words never to correct
 *   (`protect`: names the school holds; `known`: words the assistant's catalogue already uses)
 * @returns {{ text: string, corrections: Array<{from: string, to: string}>, ambiguous: Array<{from: string, options: string[]}> }}
 */
export function correctSpelling(message, { protect = new Set(), people = [], known = new Set() } = {}) {
  const original = String(message ?? '');
  const corrections = [];
  const ambiguous = [];
  if (!original.trim()) return { text: original, corrections, ambiguous };

  const cut = FREE_TEXT.exec(original);
  const head = cut ? original.slice(0, cut.index) : original;
  const tail = cut ? original.slice(cut.index) : '';

  let text = head;
  // 1. Shorthand ("hw many" is "how many"; "hw" on its own is homework).
  text = text.replace(/\bhw\b(?=\s+(?:many|much|is|are|to|do|does|was|did)\b)/gi, (m) => { corrections.push({ from: m, to: 'how' }); return 'how'; });
  text = text.replace(/(?<![\w/-])(h\/w|t\/t|hw|[a-z0-9]+(?:-[a-z]+)?)(?![\w/-])/gi, (m) => {
    const key = m.toLowerCase();
    const to = key === 'hw' ? 'homework' : SHORTHAND[key];
    if (!to) return m;
    corrections.push({ from: m, to });
    return to;
  });
  // "home work", "time table": one word to every reader.
  text = text.replace(/\bhome\s+work\b/gi, (m) => { corrections.push({ from: m, to: 'homework' }); return 'homework'; })
    .replace(/\btime\s+table\b/gi, (m) => { corrections.push({ from: m, to: 'timetable' }); return 'timetable'; });

  // 2. Classes in words or roman numerals.
  const classed = normaliseClassWords(text);
  if (classed !== text) { corrections.push({ from: text.trim(), to: classed.trim(), kind: 'class' }); text = classed; }

  // 3. People the school holds, typed loosely ("rahul sarma" -> Rahul Sharma) -- only when one person is clearly
  //    meant, and only in a READ. In a write the name is left as typed: the tool then asks "Did you mean
  //    Rahul Sharma (OAK-1)?" and the person answers -- the target of a change is never re-spelt for them.
  if (people.length && !WRITE_REQUEST.test(text)) text = correctPeopleNames(text, people, { protect, corrections });

  // 4. Misspelt school words.
  const words = [...text.matchAll(/[A-Za-z][A-Za-z]*(?:'s)?/g)];
  let out = '';
  let last = 0;
  words.forEach((m, i) => {
    const word = m[0];
    const bare = word.replace(/'s$/, '');
    const lower = bare.toLowerCase();
    let replacement = null;
    const possessive = /'s$/.test(word);
    const midSentenceCapital = i > 0 && /^[A-Z][a-z]/.test(bare);
    // "guptas attendance": a name the school holds, with its apostrophe left off.
    //    Never an English or school word ("this" is not "thi's": "thi" is protected only as romanised Hindi).
    if (!possessive && lower.length >= 4 && lower.endsWith('s') && protect.has(lower.slice(0, -1)) && !protect.has(lower)
      && !ENGLISH.has(lower) && !CANON.has(lower) && !HINGLISH.has(lower.slice(0, -1))) {
      const next = text.slice(m.index + word.length).match(/^\s+([a-z]+)/i)?.[1]?.toLowerCase();
      if (next && (CANON.has(next) || /^(?:report|bus|class|teacher)$/.test(next))) {
        corrections.push({ from: bare, to: `${bare.slice(0, -1)}'s` });
        out += text.slice(last, m.index) + `${bare.slice(0, -1)}'s`;
        last = m.index + word.length;
        return;
      }
    }
    // `known`: the catalogue's own words and the stems its resolver reads (prepare.js catalogueWords).
    if (!possessive && !midSentenceCapital && lower.length >= 4 && !CANON.has(lower) && !ENGLISH.has(lower) && !protect.has(lower) && !known.has(lower) && !knownInflection(lower)) {
      const found = candidatesFor(lower);
      if (found.length) {
        const best = found[0].d;
        const families = [...new Set(found.filter((c) => c.d === best).map((c) => c.canon))];
        let chosen = families.length === 1 ? found.find((c) => c.d === best).word : null;
        if (!chosen && families.length > 1) {
          const hinted = families.filter((f) => CONTEXT[f]?.test(original));
          if (hinted.length === 1) chosen = hinted[0];
          else ambiguous.push({ from: bare, options: families.slice(0, 3) });
        }
        if (chosen) {
          // Keep the family member the person wrote: "atendance" -> "attendance", "mrks" -> "marks".
          replacement = chosen;
          corrections.push({ from: bare, to: chosen });
        }
      }
    }
    out += text.slice(last, m.index) + (replacement ?? word);
    last = m.index + word.length;
  });
  out += text.slice(last);
  return { text: out + tail, corrections, ambiguous };
}

/**
 * Two words that are a person the school holds, spelt loosely: written as the
 * register writes them. Only when ONE person is clearly closest -- by sound
 * (phoneticKey) and by letters -- and never for words that are English or
 * school words. Anything less certain is left for the directory's own search,
 * which offers the near matches ("Did you mean …?") and never picks one. A
 * write still shows the person it names in its draft before anything runs.
 */
export function correctPeopleNames(text, people, { protect: _protect = new Set(), corrections = [] } = {}) {
  const tokens = [...String(text).matchAll(/[A-Za-z]+(?:'s)?/g)];
  if (tokens.length < 2) return text;
  const index = people.map((name) => ({ name, lower: name.toLowerCase() })).filter((p) => p.lower.split(' ').length === 2);
  if (!index.length) return text;
  const isWord = (w) => ENGLISH.has(w) || CANON.has(w) || knownInflection(w) || HINGLISH.has(w);
  let out = '';
  let last = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    // Adjacent words only (one space apart).
    if (!/^\s+$/.test(text.slice(a.index + a[0].length, b.index))) continue;
    const first = a[0].toLowerCase();
    const second = b[0].replace(/'s$/, '').toLowerCase();
    if (/'s$/.test(a[0]) || isWord(first) || isWord(second) || first.length < 2 || second.length < 2) continue;
    const typed = `${first} ${second}`;
    const scored = index.map((p) => {
      const sound = phoneticSimilarity(typed, p.lower);
      const letters = 1 - editDistance(typed, p.lower) / Math.max(typed.length, p.lower.length);
      return { ...p, sound, letters, score: Math.min(sound, letters + 0.15) };
    }).sort((x, y) => y.score - x.score);
    const best = scored[0];
    const nextBest = scored.find((x) => x.lower !== best.lower);
    if (!best || best.sound < 0.85 || best.letters < 0.72 || (nextBest && nextBest.score > best.score - 0.1)) continue;
    const possessive = /'s$/.test(b[0]) ? "'s" : '';
    const replacement = `${best.name}${possessive}`;
    const written = `${a[0]} ${b[0]}`;
    if (written !== replacement) corrections.push({ from: written, to: replacement, kind: best.lower === typed ? 'case' : 'name' });
    out += text.slice(last, a.index) + replacement;
    last = b.index + b[0].length;
    i += 1;
  }
  return out + text.slice(last);
}

/** "Did you mean …?" for the words that could be two things. */
export function didYouMean(ambiguous) {
  const first = ambiguous[0];
  const options = first.options.map((o) => `“${o}”`);
  const list = options.length > 1 ? `${options.slice(0, -1).join(', ')} or ${options.at(-1)}` : options[0];
  return `Did you mean ${list} (for “${first.from}”)? Please say which, and I'll carry on.`;
}

export const SPELLING_VOCABULARY = VOCAB;
