/**
 * People's names as they appear in a sentence, and how close two names are.
 *
 * Two failures this exists to fix, both from manual testing:
 *
 *   "Show Aarav Mishra's attendance for today."  →  matched only "Mishra", so
 *   several students came back and the question was answered for nobody. The
 *   capture took a single token before "'s".
 *
 *   "Arav Mishra"  →  a generic fallback. The student directory searches by
 *   substring, and "Arav" is not a substring of "Aarav", so a one-letter typo
 *   found nothing at all.
 *
 * So: a full name is captured whole, and a near miss produces CANDIDATES —
 * never a silent choice. Nothing here reads the database or decides
 * authorization; resolving a name to a student the caller may see stays in the
 * tool layer (resolveStudentId in mcp/tools/_shared.js).
 */

import { looksLikeMonth } from './naturalDates.js';
import { classFromText } from './classNames.js';

/**
 * Words that look like a name in the grammar but are not one.
 *
 * "my attendance", "his marks", "today's homework" all put a non-name in the
 * possessive slot, and treating them as students is how a self-question became
 * a lookup for a pupil called "Today".
 */
/**
 * Words that bind a name into the sentence around it -- "as", "to", "for",
 * "today". They can sit at either END of a captured run but never inside a
 * name, and they are the only words trimmed from the END of a capture:
 * trimming a domain noun there would turn "my Science class" into a pupil
 * called Science.
 */
const BINDING_WORDS = [
  'as', 'to', 'for', 'of', 'on', 'in', 'at', 'and', 'with', 'from', 'by', 'into',
  'today', 'tomorrow', 'yesterday', 'now',
];

const NOT_A_NAME = new Set([
  // Imperatives and interrogatives. A sentence opens with one of these, and
  // the possessive capture takes the LONGEST run of name-shaped words before
  // "'s" — so without them "Show Aarav Mishra's attendance" yielded the name
  // "Show Aarav Mishra", and no such student exists.
  'show', 'give', 'list', 'display', 'get', 'tell', 'find', 'fetch', 'see', 'view', 'open', 'check', 'pull',
  'what', 'which', 'whats', 'when', 'where', 'how', 'please', 'kindly', 'can', 'could', 'would', 'do', 'does', 'did', 'is', 'are',
  'my', 'mine', 'me', 'myself', 'i', 'his', 'her', 'hers', 'their', 'theirs', 'them', 'your', 'yours', 'our', 'ours', 'its',
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'year', 'term', 'class', 'classes', 'section', 'grade', 'std',
  'student', 'students', 'pupil', 'teacher', 'school', 'everyone', 'everybody', 'somebody', 'anyone', 'nobody',
  // Kinship. A parent says "my child's marks", "my son's attendance" — the
  // possessive slot holds a REFERENCE to a person, not their name, and the
  // person referred to is already known from the session. Without these,
  // "my child's marks" was answered with 'No student named "child".' while
  // the parent's own child sat one lookup away: nameFromText claimed a name,
  // which is what stops entityIntent from reading the question as being about
  // the caller's own record (see selfStudentId in mcp/tools/_shared.js).
  // 'child' was already among DOMAIN_STEMS, but those guard only the bare-name
  // branch, never the possessive one.
  'child', 'children', 'son', 'daughter', 'kid', 'kids', 'ward', 'wards',
  // ...and the other way round: "Rahul's FATHER" refers to a parent, and read
  // as a name it became a person called "Rahul's father saying".
  'father', 'mother', 'parent', 'parents', 'guardian', 'guardians', 'dad', 'mom', 'mum',
  'homework', 'assignment', 'attendance', 'marks', 'results', 'exam', 'subject', 'timetable', 'profile', 'announcement',
  // Domain nouns that pair with those words in ordinary questions. Without
  // them "absent count" and "absence report" read as people's names, and a
  // school-wide question was answered as a lookup for a pupil.
  'count', 'total', 'number', 'report', 'summary', 'snapshot', 'percentage', 'average', 'register', 'roster', 'list',
  'absent', 'absence', 'present', 'fees', 'fee', 'leave', 'library', 'hostel', 'transport', 'notice', 'circular',
  'bed', 'beds', 'room', 'rooms',
  // What a student registers for or requests: "for the Robotics ELECTIVE" names
  // a course, and "the" being trimmed off left "Robotics elective" looking
  // like a person.
  'elective', 'activity', 'activities', 'registration',
  'to', 'of', 'for', 'in', 'on', 'at', 'with', 'by', 'from', 'about', 'into', 'over', 'under', 'and', 'or',
  'policy', 'policies', 'rule', 'rules', 'guideline', 'guidelines', 'handbook', 'threshold',
  'criterion', 'criteria', 'requirement', 'requirements', 'standard', 'standards',
  'regulation', 'regulations', 'procedure', 'procedures', 'protocol', 'protocols',
  'this', 'that', 'the', 'a', 'an', 'all', 'each', 'every', 'whose', 'who',
  // Auxiliaries and determiners. The status branch takes the word before
  // "absent" as the person marked, so "who WAS absent" looked up a pupil called
  // "was", and "ANOTHER school's attendance" one called "another school".
  'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had', 'will', 'shall', 'should',
  'another', 'other', 'others', 'any', 'some', 'there', 'here',
  // A name never contains one of these, and the greedy captures below took the
  // one next to it: "Record Rahul Sharma as present" read the person as
  // "Rahul Sharma as", "attendance of Rahul Sharma as present" as "of Rahul
  // Sharma".
  ...BINDING_WORDS,
]);

/**
 * Word beginnings that belong to the school's vocabulary rather than a person.
 *
 * Matched as PREFIXES, so every inflection is covered at once — "absent",
 * "absence", "absentees"; "notice", "notices"; "mark", "marks", "marking".
 * Used only where there is no grammatical evidence of a name (see
 * nameFromText's final branch), because a prefix test would otherwise reject
 * real people: "Markus" begins with "mark".
 */
const DOMAIN_STEMS = [
  'absent', 'absence', 'attend', 'present', 'register', 'roster',
  'mark', 'score', 'result', 'grade', 'exam', 'gpa', 'report',
  'homework', 'assign', 'worksheet', 'submission',
  'notice', 'announce', 'circular', 'news', 'policy', 'guideline', 'rule', 'regulation', 'threshold',
  'fee', 'invoice', 'payment', 'due', 'receipt',
  'leave', 'holiday', 'librar', 'book', 'hostel', 'transport', 'bus', 'route',
  'bed', 'room',
  'timetable', 'period', 'schedul', 'lesson',
  'profile', 'detail', 'information', 'summar', 'count', 'total', 'percent', 'average', 'statistic',
  'student', 'pupil', 'teacher', 'staff', 'parent', 'guardian', 'child',
  'class', 'section', 'division', 'subject', 'ticket', 'medical',
  'material', 'course', 'note', 'handout', 'document', 'resource', 'task',
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'year', 'term', 'session',
];

/** True when any word of a phrase stems to the school's own vocabulary. */
function looksLikeDomainPhrase(phrase) {
  return clean(phrase)
    .split(' ')
    .filter(Boolean)
    .some((word) => {
      const w = word.toLowerCase().replace(/['’].*$/, '');
      return DOMAIN_STEMS.some((stem) => w.startsWith(stem));
    });
}

/**
 * A capitalised-or-not word that could be part of a person's name.
 *
 * A name STARTS with a letter but may carry digits or an underscore after it.
 * Requiring letters throughout was a statement about typography rather than
 * about people: schools run accounts like "test_Stud" and "Aarav2", and a
 * register that holds one still has to be markable by name. The first
 * character stays a letter, so a bare number or a code is still not a name,
 * and every other test a phrase must pass is unchanged.
 */
const NAME_WORD = "[\\p{L}][\\p{L}\\p{N}_'’.-]*";
const NAME_PHRASE = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,2}`;

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');

/**
 * The statuses a register can be marked with, mirroring AttendanceRecord.
 *
 * Here because they are GRAMMAR as well as data: "mark Rahul Sharma absent"
 * names a person the same way "student Rahul Sharma" does, and the evidence is
 * the status word that follows. Without it the name went unclaimed, and the
 * word before the status -- a surname -- was then read as a school subject,
 * which every attendance capability was then penalised for not being able to
 * express. Kept as words rather than imported from the model because a utility
 * that reads sentences should not open a database schema; a status missing
 * here costs a little accuracy and nothing else.
 */
const MARKED_STATUS = 'absent|present|late|excused|half[\\s-]?day';

/**
 * True when every word of a phrase is a real name candidate.
 *
 * Checked word by word rather than on the whole phrase, because "my Aarav"
 * and "student Aarav" both carry a stopword that must not end up in the name.
 */
/**
 * Strips leading words that are grammar rather than name.
 *
 * "Show Aarav Mishra" → "Aarav Mishra". Only the LEADING run is removed: a
 * stopword in the middle means the phrase is not a name at all.
 */
function trimLeadingNonNames(phrase) {
  const words = clean(phrase).split(' ').filter(Boolean);
  while (words.length && isNotAName(words[0])) words.shift();
  return words.join(' ');
}

/**
 * True when a word is grammar or a domain noun rather than part of a name.
 *
 * Singular and plural are treated alike. Listing only the singular left a hole
 * a plural walked straight through: "notices" was not in the set, so "any new
 * notices?" read as somebody called Notices and an announcements question was
 * answered with a student search.
 */
function isNotAName(word) {
  const w = String(word ?? '').toLowerCase();
  if (NOT_A_NAME.has(w)) return true;
  // "notices" → "notice", "classes" → "class", "marks" → "mark".
  if (w.endsWith('es') && NOT_A_NAME.has(w.slice(0, -2))) return true;
  if (w.endsWith('s') && NOT_A_NAME.has(w.slice(0, -1))) return true;
  return false;
}

/**
 * Strips trailing binding words: "Rahul Sharma as" → "Rahul Sharma",
 * "Rahul Sharma today" → "Rahul Sharma". The captures take up to three
 * name-shaped words, and the word after a name is as often a preposition or a
 * day as it is a surname.
 */
function trimTrailingBindings(phrase) {
  const words = clean(phrase).split(' ').filter(Boolean);
  while (words.length > 1 && BINDING_WORDS.includes(words.at(-1).toLowerCase())) words.pop();
  return words.join(' ');
}

function isNameLike(phrase) {
  const words = clean(phrase).split(' ').filter(Boolean);
  if (!words.length || words.length > 3) return false;
  if (words.some((w) => isNotAName(w))) return false;
  if (looksLikeMonth(clean(phrase))) return false;
  if (classFromText(clean(phrase))) return false;
  // A bare number or a single letter is not a name.
  return words.every((w) => /^[\p{L}][\p{L}\p{N}_'’.-]*$/u.test(w) && w.length >= 2);
}

/**
 * The person a sentence is about, or null.
 *
 * Tried in order of how explicit the reference is: a possessive ("Aarav
 * Mishra's attendance"), an introduced name ("for student Aarav Mishra"), then
 * a preposition ("attendance of Aarav Mishra"). The possessive form takes the
 * LONGEST run of name words before "'s", which is the fix for the surname-only
 * capture.
 */
export function nameFromText(text) {
  const str = String(text ?? '');

  const possessive = new RegExp(`(${NAME_PHRASE})['’]s\\b`, 'u').exec(str)?.[1];
  if (possessive) {
    const trimmed = trimLeadingNonNames(possessive);
    if (trimmed && isNameLike(trimmed)) return clean(trimmed);
  }

  const introduced = trimTrailingBindings(new RegExp(`\\b(?:student|pupil|child)\\s+(${NAME_PHRASE})`, 'iu').exec(str)?.[1]);
  if (introduced) {
    const trimmed = trimLeadingNonNames(introduced);
    if (trimmed && isNameLike(trimmed)) return clean(trimmed);
  }

  const prepMatch = new RegExp(
    `\\b(?:(?:of|for)\\s+(${NAME_PHRASE})|(?<!\\b(?:according|due|prior|introduction|guide|welcome|belong|refer)\\s+)to\\s+(${NAME_WORD}(?:\\s+${NAME_WORD}){1,2}))`,
    'iu',
  ).exec(str);
  const prepositional = trimTrailingBindings(prepMatch?.[1] || prepMatch?.[2]);
  if (prepositional) {
    const trimmed = trimLeadingNonNames(prepositional);
    if (trimmed && isNameLike(trimmed)) return clean(trimmed);
  }

  // "mark Rahul Sharma absent", "Diya Patel present in Class 5-A". The status
  // is the grammatical evidence, exactly as the word "student" is in the
  // branch above: what sits immediately before it is who is being marked.
  // Held to the same isNameLike test as every other branch, so "mark
  // attendance present" still yields no person.
  const marked = new RegExp(`\\b(${NAME_PHRASE})\\s+(?:as\\s+)?(?:${MARKED_STATUS})\\b`, 'iu').exec(str)?.[1];
  if (marked) {
    const trimmed = trimTrailingBindings(trimLeadingNonNames(marked));
    if (trimmed && isNameLike(trimmed)) return clean(trimmed);
  }

  // "Vacate Diya Sharma bed", "assign Rahul Verma room". The domain noun
  // (bed, room) identifies the person preceding it.
  const facilityPerson = new RegExp(`\\b(${NAME_PHRASE})\\s+(?:bed|room)s?\\b`, 'iu').exec(str)?.[1];
  if (facilityPerson) {
    const trimmed = trimLeadingNonNames(facilityPerson);
    if (trimmed && isNameLike(trimmed)) return clean(trimmed);
  }

  // "Give Priya 8 marks", "award Rahul Sharma 5 points": the person is the one
  // given a number. The number is the evidence, as the status is above -- and
  // it is evidence on its own when the verb has already been read off the
  // front ("Priya 8 marks for her assignment").
  const given = new RegExp(
    `(?:\\b(?:give|award)\\s+|^\\s*)(${NAME_PHRASE})\\s+\\d{1,3}(?:\\.\\d{1,2})?\\s*(?:marks?|points?)\\b`, 'iu',
  ).exec(str)?.[1];
  if (given && isNameLike(given)) return clean(given);

  // A message that is nothing but a name — "Arav Mishra" — which is how a
  // teacher looks somebody up after being shown a list.
  //
  // This branch is the dangerous one: it can claim ANY two-word message, so it
  // is held to a stricter test than the possessive and introduced forms above.
  // Those carry grammatical evidence ("X's attendance", "student X") and are
  // judged on exact words, which keeps a real name that happens to begin with
  // a domain stem — "Markus", "Marker" — working. Here there is no such
  // evidence, so anything that smells of the domain is refused: a word stemming
  // to a domain noun, or a possessive anywhere in the phrase.
  //
  // Three leaks taught this. "any new notices?" (plural absent from the word
  // list), "marks" (noun colliding with a verb stem) and "today's absentees"
  // (an inflection nobody had enumerated) each reached the student directory,
  // and each would have been fixed by adding one more word — leaving the next
  // inflection open. Stems close the family.
  const whole = clean(str);
  if (
    whole
    && /^[\p{L}][\p{L}'’.\s-]*$/u.test(whole)
    && whole.split(' ').length >= 2
    && !/['’]s\b/.test(whole)
    && !looksLikeDomainPhrase(whole)
    && isNameLike(whole)
  ) {
    return whole;
  }
  return null;
}

/** Levenshtein distance, iterative and bounded by the shorter string. */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();

/**
 * How close two names are, 0..1, where 1 is identical.
 *
 * Compared whole and word by word, so "Arav Mishra" scores highly against
 * "Aarav Mishra" (one insertion) and a shared surname alone does not.
 */
export function nameSimilarity(query, candidate) {
  const a = norm(query);
  const b = norm(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const whole = 1 - distance(a, b) / Math.max(a.length, b.length);

  // Every word of the query should find a close word in the candidate;
  // otherwise "Mishra" alone would look like a good match for every Mishra.
  const queryWords = a.split(' ');
  const candidateWords = b.split(' ');
  const perWord = queryWords.map((qw) => {
    const best = Math.max(...candidateWords.map((cw) => 1 - distance(qw, cw) / Math.max(qw.length, cw.length)));
    return Number.isFinite(best) ? best : 0;
  });
  const coverage = perWord.reduce((sum, x) => sum + x, 0) / queryWords.length;

  return Math.max(whole, coverage * 0.95);
}

/**
 * The plausible spellings of a name among some candidates, best first.
 *
 * Returns candidates for a person to choose from — deliberately never one
 * "winner". A write may not act on a guess about which child was meant, and a
 * read is more useful offering the shortlist than silently picking.
 */
export function nameCandidates(query, candidates, { threshold = 0.72, max = 5 } = {}) {
  return candidates
    .map((c) => ({ candidate: c, score: nameSimilarity(query, c.name ?? c) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
